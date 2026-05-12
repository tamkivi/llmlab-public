"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { OPEN_AUTH_PANEL_EVENT } from "@/lib/auth-panel-events";
import { parseApiMessage } from "@/lib/parse-api-message";
import {
  clearPendingCheckoutIntent,
  currentCheckoutPath,
  markPendingCheckoutIntentForRedirect,
  readPendingCheckoutIntent,
  RESUME_PENDING_CHECKOUT_EVENT,
  type PendingCheckoutIntent,
} from "@/lib/pending-checkout-intent";

type AuthUser = {
  id: number;
  email: string;
  role: "ADMIN" | "DEV" | "USER";
  createdAt: string;
};

type MeResponse = {
  user: AuthUser | null;
};

type AuthMode = "login" | "register";

export function AuthPanel() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<AuthMode>("login");
  const [isMobile, setIsMobile] = useState(false);
  const [hasPendingCheckoutIntent, setHasPendingCheckoutIntent] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const positionFrameRef = useRef<number | null>(null);
  const [panelPosition, setPanelPosition] = useState({ top: 0, left: 0 });

  const positionPanel = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const panelWidth = Math.min(360, Math.floor(window.innerWidth * 0.92));
    const left = Math.max(8, Math.min(window.innerWidth - panelWidth - 8, rect.right - panelWidth));
    const top = Math.min(window.innerHeight - 12, rect.bottom + 8);
    setPanelPosition((current) => (current.top === top && current.left === left ? current : { top, left }));
  }, []);

  const schedulePositionPanel = useCallback(() => {
    if (positionFrameRef.current !== null) return;

    positionFrameRef.current = window.requestAnimationFrame(() => {
      positionFrameRef.current = null;
      positionPanel();
    });
  }, [positionPanel]);

  async function refreshMe() {
    const response = await fetch("/api/auth/me", { cache: "no-store" });
    const data = (await response.json()) as MeResponse;
    setMe(data);
  }

  const refreshPendingCheckoutState = useCallback(() => {
    const pending = readPendingCheckoutIntent();
    if (pending.stale) clearPendingCheckoutIntent();
    setHasPendingCheckoutIntent(Boolean(pending.intent));
    return pending;
  }, []);

  async function resumeCheckoutFromAuth(intent: PendingCheckoutIntent) {
    if (intent.isProfileBuild) {
      clearPendingCheckoutIntent();
      setHasPendingCheckoutIntent(false);
      setMessage("Saved build checkout could not be resumed automatically. Please use the purchase button on the build page to confirm the order price.");
      setOpen(true);
      return;
    }

    setMessage("Signed in. Continuing checkout...");
    const response = await fetch("/api/payments/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemType: intent.itemType, itemId: intent.itemId }),
    });

    clearPendingCheckoutIntent();
    setHasPendingCheckoutIntent(false);

    if (!response.ok) {
      const apiMessage = await parseApiMessage(response);
      setMessage(apiMessage ?? "Saved checkout could not be resumed. The item may now require a quote, fresh pricing, or manual review.");
      setOpen(true);
      return;
    }

    const data = (await response.json()) as { checkoutUrl?: string };
    if (!data.checkoutUrl) {
      setMessage("Saved checkout could not be resumed because Stripe did not return a checkout link.");
      setOpen(true);
      return;
    }

    window.location.href = data.checkoutUrl;
  }

  async function resumePendingCheckoutAfterAuth() {
    const pending = refreshPendingCheckoutState();
    if (pending.stale) {
      setMessage("Signed in. The saved checkout request expired, so please click purchase again.");
      return;
    }
    if (!pending.intent) return;

    if (pending.intent.intendedPath !== currentCheckoutPath()) {
      const updated = markPendingCheckoutIntentForRedirect();
      setHasPendingCheckoutIntent(Boolean(updated));
      setMessage("Signed in. Returning to the item to continue checkout...");
      window.location.assign(updated?.intendedPath ?? pending.intent.intendedPath);
      return;
    }

    const resumeEvent = new CustomEvent(RESUME_PENDING_CHECKOUT_EVENT, {
      cancelable: true,
      detail: { intent: pending.intent },
    });
    const handledByPurchaseButton = !window.dispatchEvent(resumeEvent);
    if (handledByPurchaseButton) {
      setMessage("Signed in. Continuing checkout...");
      setOpen(false);
      setHasPendingCheckoutIntent(false);
      return;
    }

    await resumeCheckoutFromAuth(pending.intent);
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((response) => response.json() as Promise<MeResponse>)
      .then((data) => {
        if (!cancelled) setMe(data);
      })
      .catch(() => {
        if (!cancelled) setMessage("Failed to load account session.");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleOpenAuthPanel = (event: Event) => {
      const detail = (event as CustomEvent<{ mode?: AuthMode }>).detail;
      setMode(detail?.mode === "register" ? "register" : "login");
      setMessage(null);
      refreshPendingCheckoutState();
      setOpen(true);
    };

    window.addEventListener(OPEN_AUTH_PANEL_EVENT, handleOpenAuthPanel);
    return () => window.removeEventListener(OPEN_AUTH_PANEL_EVENT, handleOpenAuthPanel);
  }, [refreshPendingCheckoutState]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const apply = () => setIsMobile(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      const insideButton = Boolean(target && buttonRef.current?.contains(target));
      const insidePanel = Boolean(target && panelRef.current?.contains(target));
      if (!insideButton && !insidePanel) setOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open || isMobile) return;

    positionPanel();
    const handleViewportChange = () => schedulePositionPanel();
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      if (positionFrameRef.current !== null) {
        window.cancelAnimationFrame(positionFrameRef.current);
        positionFrameRef.current = null;
      }
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [open, isMobile, positionPanel, schedulePositionPanel]);

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const messageFromApi = await parseApiMessage(response);
        setMessage(messageFromApi ?? "Registration failed.");
        return;
      }

      setMessage("Account created and signed in.");
      await refreshMe();
      await resumePendingCheckoutAfterAuth();
    } catch {
      setMessage("Signup request failed. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const messageFromApi = await parseApiMessage(response);
        setMessage(messageFromApi ?? "Login failed.");
        return;
      }

      setMessage("Signed in successfully.");
      await refreshMe();
      await resumePendingCheckoutAfterAuth();
    } catch {
      setMessage("Login request failed. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    setLoading(true);
    setMessage(null);
    await fetch("/api/auth/logout", { method: "POST" });
    clearPendingCheckoutIntent();
    setHasPendingCheckoutIntent(false);
    setLoading(false);
    setMessage("Signed out.");
    await refreshMe();
    setOpen(false);
  }

  return (
    <div className="relative z-[200]">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          refreshPendingCheckoutState();
          setOpen((current) => !current);
        }}
        className="nav-pill cursor-pointer"
      >
        Account
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div className={`fixed z-[2147483647] ${isMobile ? "inset-0 bg-black/50 p-3 flex items-end" : "inset-0 pointer-events-none"}`}>
              <div
                ref={panelRef}
                className={`wireframe-panel ${isMobile ? "w-full max-h-[85vh] overflow-auto rounded-2xl p-4 pointer-events-auto" : "fixed p-4 pointer-events-auto"}`}
                style={isMobile ? undefined : { top: panelPosition.top, left: panelPosition.left, width: "min(92vw, 360px)" }}
              >
                {message ? <p className="mb-3 text-xs text-[color:var(--muted)]">{message}</p> : null}
                {me?.user ? (
                  <div>
                    <p className="font-semibold">Signed in</p>
                    <p className="mt-1 text-sm text-[color:var(--muted)]">{me.user.email}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Link href="/orders" className="nav-pill">
                        My Orders
                      </Link>
                      {me.user.role === "ADMIN" ? (
                        <Link href="/admin/orders" className="nav-pill">
                          Admin Orders
                        </Link>
                      ) : null}
                    </div>
                    <button
                      className="mt-3 rounded-md bg-[color:var(--accent-2)] px-4 py-2 text-sm font-semibold text-white"
                      onClick={handleLogout}
                      type="button"
                      disabled={loading}
                    >
                      Logout
                    </button>
                  </div>
                ) : (
                  <div>
                    <div className="mb-3 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setMode("login")}
                        className={`rounded-md border px-3 py-1 text-sm ${mode === "login" ? "border-transparent bg-[color:var(--accent-2)] text-white" : "border-[color:var(--panel-border)] bg-[color:var(--panel)] text-[color:var(--foreground)]"}`}
                      >
                        Login
                      </button>
                      <button
                        type="button"
                        onClick={() => setMode("register")}
                        className={`rounded-md border px-3 py-1 text-sm ${mode === "register" ? "border-transparent bg-[color:var(--accent)] text-white" : "border-[color:var(--panel-border)] bg-[color:var(--panel)] text-[color:var(--foreground)]"}`}
                      >
                        Register
                      </button>
                    </div>
                    <p className="mb-3 text-xs leading-5 text-[color:var(--muted)]">
                      Log in to keep orders attached to your account. If you started checkout, it will continue after sign-in.
                    </p>
                    {hasPendingCheckoutIntent ? (
                      <button
                        type="button"
                        onClick={() => {
                          clearPendingCheckoutIntent();
                          setHasPendingCheckoutIntent(false);
                          setMessage("Saved checkout canceled.");
                        }}
                        className="mb-3 text-xs text-[color:var(--muted)] underline"
                      >
                        Cancel saved checkout
                      </button>
                    ) : null}

                    {mode === "register" ? (
                      <form onSubmit={handleRegister} className="space-y-2">
                        <input
                          value={email}
                          onChange={(event) => setEmail(event.target.value)}
                          placeholder="Email"
                          className="w-full rounded-md border border-[color:var(--panel-border)] px-3 py-2 text-sm"
                          type="email"
                          required
                        />
                        <input
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                          placeholder="Password (12+ chars)"
                          className="w-full rounded-md border border-[color:var(--panel-border)] px-3 py-2 text-sm"
                          type="password"
                          required
                        />
                        <button
                          className="w-full rounded-md bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-white"
                          disabled={loading}
                        >
                          Create account
                        </button>
                      </form>
                    ) : (
                      <form onSubmit={handleLogin} className="space-y-2">
                        <input
                          value={email}
                          onChange={(event) => setEmail(event.target.value)}
                          placeholder="Email"
                          className="w-full rounded-md border border-[color:var(--panel-border)] px-3 py-2 text-sm"
                          type="email"
                          required
                        />
                        <input
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                          placeholder="Password"
                          className="w-full rounded-md border border-[color:var(--panel-border)] px-3 py-2 text-sm"
                          type="password"
                          required
                        />
                        <button
                          className="w-full rounded-md bg-[color:var(--accent-2)] px-4 py-2 text-sm font-semibold text-white"
                          disabled={loading}
                        >
                          Login
                        </button>
                      </form>
                    )}
                  </div>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
