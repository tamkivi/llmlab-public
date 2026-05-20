"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { OrderStatus } from "@/lib/db";
import { OrderTimeline } from "@/components/order-timeline";
import { orderStatusCopy, orderSupportHref } from "@/lib/order-ux";

type CheckoutSessionStatusProps = {
  sessionId: string | null;
  initialOrder: {
    id: number;
    buildName: string;
    amountEur: string;
    status: OrderStatus;
  } | null;
  lang?: "en" | "et";
};

type SessionStatusResponse = {
  order?: {
    id: number;
    buildName: string;
    amountEur: string;
    status: OrderStatus;
  };
  message?: string;
};

export function CheckoutSessionStatus({ sessionId, initialOrder, lang = "en" }: CheckoutSessionStatusProps) {
  const [order, setOrder] = useState(initialOrder);
  const [loading, setLoading] = useState(Boolean(sessionId));
  const [error, setError] = useState<string | null>(null);

  const endpoint = useMemo(
    () => (sessionId ? `/api/payments/session-status?session_id=${encodeURIComponent(sessionId)}` : null),
    [sessionId],
  );

  useEffect(() => {
    if (!endpoint) {
      setLoading(false);
      return;
    }

    const statusEndpoint = endpoint;
    let canceled = false;
    async function reconcile() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(statusEndpoint, {
          headers: { accept: "application/json" },
          credentials: "same-origin",
        });
        const payload = (await response.json().catch(() => ({}))) as SessionStatusResponse;
        if (canceled) return;
        if (!response.ok || !payload.order) {
          setError(payload.message ?? (lang === "et" ? "Makse kontroll ebaõnnestus." : "Payment verification failed."));
          return;
        }
        setOrder(payload.order);
      } catch {
        if (!canceled) {
          setError(lang === "et" ? "Makse kontroll ebaõnnestus." : "Payment verification failed.");
        }
      } finally {
        if (!canceled) setLoading(false);
      }
    }

    void reconcile();
    return () => {
      canceled = true;
    };
  }, [endpoint, lang]);

  if (!order) {
    return (
      <div
        className="mt-5 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4"
        data-session-status-endpoint={endpoint ?? ""}
      >
        <p className="font-semibold">{lang === "et" ? "Tellimuse viidet ei leitud" : "Order reference not available"}</p>
        <p className="mt-1 text-sm text-[color:var(--muted)]">
          {error ?? (sessionId
            ? (lang === "et"
                ? "Me ei saa seda maksesessiooni praegu sinu kontoga siduda. Vaata oma tellimusi või võta ühendust."
                : "We cannot match this checkout session to your account right now. Check your orders or contact support.")
            : (lang === "et"
                ? "Sellel lehel puudub Stripe'i sessiooni viide. Turvalisim jätk on vaadata oma tellimusi."
                : "This page is missing the Stripe session reference. The safest next step is to check your orders."))}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/orders" className="btn-primary inline-flex px-3 py-1.5 text-xs">
            {lang === "et" ? "Vaata minu tellimusi" : "View my orders"}
          </Link>
          <a href={orderSupportHref()} className="label-pill inline-block">
            {lang === "et" ? "Võta ühendust" : "Contact support"}
          </a>
        </div>
      </div>
    );
  }

  const copy = orderStatusCopy(order.status, lang);
  const tone = order.status === "PAID"
    ? "border-green-500/40 bg-green-500/5"
    : order.status === "CANCELED" || order.status === "FAILED"
      ? "border-red-500/40 bg-red-500/5"
      : "border-yellow-500/40 bg-yellow-500/5";

  return (
    <div
      className={`mt-5 rounded-lg border p-4 ${tone}`}
      data-session-status-endpoint={endpoint ?? ""}
      data-payment-status={order.status}
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-semibold">{copy.title}</p>
          <p className="mt-1 text-sm text-[color:var(--muted)]">{copy.body}</p>
        </div>
        {loading ? (
          <span className="mt-2 text-xs uppercase tracking-wide text-[color:var(--muted)] sm:mt-0">
            {lang === "et" ? "Kontrollin" : "Checking"}
          </span>
        ) : null}
      </div>
      {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}
      <div className="mt-4 border-t border-[color:var(--panel-border)] pt-3">
        <p className="font-semibold">{lang === "et" ? "Tellimus" : "Order"} #{order.id}</p>
        <p className="mt-2 text-sm text-[color:var(--muted)]">{lang === "et" ? "Toode" : "Item"}: {order.buildName}</p>
        <p className="text-sm text-[color:var(--muted)]">{lang === "et" ? "Summa" : "Amount"}: €{order.amountEur}</p>
        <p className="text-sm text-[color:var(--muted)]">{lang === "et" ? "Olek" : "Status"}: {copy.label}</p>
      </div>
      <OrderTimeline status={order.status} lang={lang} />
      <div className="mt-4 flex flex-wrap gap-3">
        <Link href="/orders" className="btn-primary inline-flex px-3 py-1.5 text-xs">
          {lang === "et" ? "Vaata minu tellimusi" : "View my orders"}
        </Link>
        <a href={orderSupportHref(order.id)} className="label-pill inline-block">
          {lang === "et" ? "Võta ühendust" : "Contact support"}
        </a>
      </div>
    </div>
  );
}
