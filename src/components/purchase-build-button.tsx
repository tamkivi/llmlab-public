"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CHECKOUT_AUTH_REQUIRED_FALLBACK_MESSAGE, CHECKOUT_AUTH_REQUIRED_MESSAGE, OPEN_AUTH_PANEL_EVENT } from "@/lib/auth-panel-events";
import { parseApiMessage } from "@/lib/parse-api-message";
import type { SiteLanguage } from "@/lib/lang";
import {
  clearPendingCheckoutIntent,
  currentCheckoutPath,
  intentMatchesItem,
  readPendingCheckoutIntent,
  RESUME_PENDING_CHECKOUT_EVENT,
  savePendingCheckoutIntent,
  type PendingCheckoutIntent,
} from "@/lib/pending-checkout-intent";
import { PurchaseReassurance } from "@/components/purchase-reassurance";

type PurchasableItemType = PendingCheckoutIntent["itemType"];
type CheckoutUnavailableReason =
  | "checkout_env_unavailable"
  | "quote_only"
  | "out_of_stock"
  | "missing_price"
  | "missing_trusted_component_pricing"
  | "fallback_pricing"
  | "stale_pricing"
  | "pricing_unhealthy"
  | "order_limit_exceeded"
  | "item_not_found";

type Props = {
  itemType: PurchasableItemType;
  itemId: number;
  priceEur: number;
  buttonLabel?: string;
  isProfileBuild?: boolean;
  lang?: SiteLanguage;
  checkoutAvailable?: boolean;
  checkoutUnavailableReason?: CheckoutUnavailableReason;
  checkoutMaxOrderEur?: number | null;
};

const t = (lang: SiteLanguage | undefined, en: string, et: string) => lang === "et" ? et : en;

function quoteOnlyButtonLabel(reason: CheckoutUnavailableReason | undefined, lang: SiteLanguage): string {
  if (!reason || reason === "checkout_env_unavailable") {
    return t(lang, "Online checkout unavailable", "Veebimakse pole saadaval");
  }
  return t(lang, "Quote-only checkout", "Pakkumispõhine ost");
}

function disabledCheckoutHeadline(reason: CheckoutUnavailableReason | undefined, lang: SiteLanguage): string {
  switch (reason) {
    case "fallback_pricing":
      return t(lang, "Quote-only until fresh market pricing is available.", "Pakkumispõhine kuni värske turuhind on saadaval.");
    case "stale_pricing":
      return t(lang, "Quote-only because the latest market pricing is stale.", "Pakkumispõhine, sest viimane turuhind on aegunud.");
    case "missing_price":
      return t(lang, "Quote-only because pricing data is incomplete.", "Pakkumispõhine, sest hinnainfo on puudulik.");
    case "missing_trusted_component_pricing":
      return t(lang, "Quote-only because component pricing could not be verified.", "Pakkumispõhine, sest komponentide hindu ei saanud kontrollida.");
    case "pricing_unhealthy":
      return t(lang, "Quote-only until pricing passes checkout checks.", "Pakkumispõhine kuni hinnainfo läbib kontrollid.");
    case "order_limit_exceeded":
      return t(lang, "Quote-only because the build exceeds the online checkout limit.", "Pakkumispõhine, sest komplekt ületab veebimakse limiidi.");
    case "out_of_stock":
      return t(lang, "Quote-only while availability is confirmed.", "Pakkumispõhine kuni saadavus on kinnitatud.");
    case "quote_only":
      return t(lang, "This configuration requires a custom quote.", "See konfiguratsioon vajab kohandatud pakkumist.");
    case "item_not_found":
      return t(lang, "This item is not available for checkout.", "See toode pole makseks saadaval.");
    case "checkout_env_unavailable":
    default:
      return t(lang, "Online checkout is not available yet. Request a quote instead.", "Veebimakse pole veel saadaval. Küsi selle asemel pakkumist.");
  }
}

function disabledCheckoutDetail(reason: CheckoutUnavailableReason | undefined, lang: SiteLanguage): string {
  switch (reason) {
    case "fallback_pricing":
    case "stale_pricing":
    case "missing_price":
    case "missing_trusted_component_pricing":
    case "pricing_unhealthy":
      return t(
        lang,
        "Fresh, non-fallback Estonian market pricing is required before Stripe payment can be opened.",
        "Enne Stripe makse avamist on vaja värsket ja mitte-varuhinnal põhinevat Eesti turuhinda.",
      );
    case "out_of_stock":
      return t(
        lang,
        "We check stock before opening payment to reduce the chance of unavailable items becoming paid orders.",
        "Kontrollime laoseisu enne makse avamist, et vähendada riski, et mittesaadav toode muutub tasutud tellimuseks.",
      );
    case "quote_only":
      return t(
        lang,
        "Mac and eGPU systems are reviewed manually before pricing and fulfillment.",
        "Maci ja eGPU süsteemid vaadatakse enne hinna ja täitmise kinnitamist käsitsi üle.",
      );
    case "order_limit_exceeded":
      return t(
        lang,
        "This order is priced from trusted component data, but the total is above the online payment policy limit.",
        "Tellimus põhineb kontrollitud komponentide hindadel, kuid summa ületab veebimakse poliitika limiidi.",
      );
    default:
      return t(
        lang,
        "Accounts, order history, and quote requests remain available while online payment setup is completed.",
        "Kontod, tellimuste ajalugu ja pakkumise päringud jäävad saadavaks kuni veebimakse seadistuse valmimiseni.",
      );
  }
}

export function PurchaseBuildButton({ itemType, itemId, priceEur, buttonLabel, isProfileBuild, lang = "en", checkoutAvailable = true, checkoutUnavailableReason, checkoutMaxOrderEur }: Props) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [checkoutOrderPriceEur, setCheckoutOrderPriceEur] = useState<number | null>(null);
  const resumeAttemptedRef = useRef(false);

  const isEt = lang === "et";

  const startCheckout = useCallback(async (options?: { resumed?: boolean }) => {
    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch("/api/payments/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemType, itemId }),
      });

      if (!response.ok) {
        if (response.status === 401) {
          if (options?.resumed) {
            clearPendingCheckoutIntent();
            setMessage(t(lang, "Your saved checkout request expired. Please click purchase again.", "Salvestatud maksepäring aegus. Palun klõpsa ostunuppu uuesti."));
          } else {
            const saved = savePendingCheckoutIntent({
              itemType,
              itemId,
              intendedPath: currentCheckoutPath(),
              isProfileBuild: isProfileBuild === true,
            });
            window.dispatchEvent(new CustomEvent(OPEN_AUTH_PANEL_EVENT, { detail: { mode: "login" } }));
            setMessage(saved ? CHECKOUT_AUTH_REQUIRED_MESSAGE : CHECKOUT_AUTH_REQUIRED_FALLBACK_MESSAGE);
          }
          return;
        }

        const apiMessage = await parseApiMessage(response);
        if (options?.resumed) clearPendingCheckoutIntent();
        setMessage(apiMessage ?? t(lang, "Unable to start checkout. The item may need a fresh price check or manual review.", "Makse algatamine ebaõnnestus. Toode võib vajada uut hinnakontrolli või käsitsi ülevaatust."));
        return;
      }

      const data = (await response.json()) as { checkoutUrl?: string; orderPriceEur?: number; amountEurCents?: number };
      if (!data.checkoutUrl) {
        if (options?.resumed) clearPendingCheckoutIntent();
        setMessage(t(lang, "Checkout session did not return a redirect URL.", "Maksesessioon ei tagastanud suuna-URL-i."));
        return;
      }

      clearPendingCheckoutIntent();
      if (isProfileBuild) {
        setCheckoutUrl(data.checkoutUrl);
        const orderPrice = typeof data.orderPriceEur === "number"
          ? data.orderPriceEur
          : typeof data.amountEurCents === "number"
            ? data.amountEurCents / 100
            : priceEur;
        setCheckoutOrderPriceEur(orderPrice);
      } else {
        window.location.href = data.checkoutUrl;
      }
    } catch {
      if (options?.resumed) clearPendingCheckoutIntent();
      setMessage(t(lang, "Checkout request failed. Check your connection and try again.", "Maksepäring ebaõnnestus. Kontrolli ühendust ja proovi uuesti."));
    } finally {
      setLoading(false);
    }
  }, [isProfileBuild, itemId, itemType, lang, priceEur]);

  useEffect(() => {
    if (!checkoutAvailable) return;

    const maybeResume = (intent: PendingCheckoutIntent) => {
      if (resumeAttemptedRef.current || !intentMatchesItem(intent, itemType, itemId)) return false;
      resumeAttemptedRef.current = true;
      setMessage(t(lang, "Signed in. Continuing checkout...", "Sisse logitud. Jätkame maksega..."));
      void startCheckout({ resumed: true });
      return true;
    };

    const handleResume = (event: Event) => {
      const detail = (event as CustomEvent<{ intent?: PendingCheckoutIntent }>).detail;
      if (!detail?.intent) return;
      if (maybeResume(detail.intent)) event.preventDefault();
    };

    window.addEventListener(RESUME_PENDING_CHECKOUT_EVENT, handleResume);

    const pending = readPendingCheckoutIntent();
    if (pending.intent?.resumeAfterAuth && intentMatchesItem(pending.intent, itemType, itemId)) {
      void maybeResume(pending.intent);
    }

    return () => window.removeEventListener(RESUME_PENDING_CHECKOUT_EVENT, handleResume);
  }, [checkoutAvailable, itemId, itemType, lang, startCheckout]);

  function proceedToCheckout() {
    if (checkoutUrl) {
      clearPendingCheckoutIntent();
      window.location.href = checkoutUrl;
    }
  }

  if (!checkoutAvailable) {
    return (
      <div className="mt-6 rounded-lg border border-[color:var(--panel-border)] bg-[color:var(--panel)] p-4">
        <button
          type="button"
          disabled
          className="purchase-cta rounded-md bg-[color:var(--panel-border)] px-4 py-2 text-sm font-semibold text-[color:var(--muted)]"
        >
          {quoteOnlyButtonLabel(checkoutUnavailableReason, lang)}
        </button>
        <p className="mt-3 text-sm font-semibold text-[color:var(--foreground)]">
          {disabledCheckoutHeadline(checkoutUnavailableReason, lang)}
        </p>
        <p className="mt-2 text-xs text-[color:var(--muted)]">
          {disabledCheckoutDetail(checkoutUnavailableReason, lang)}
        </p>
        {checkoutUnavailableReason === "order_limit_exceeded" && checkoutMaxOrderEur ? (
          <p className="mt-2 text-xs text-[color:var(--muted)]">
            {isEt ? "Veebimakse limiit" : "Online checkout limit"}: €{checkoutMaxOrderEur.toLocaleString()}
          </p>
        ) : null}
        <PurchaseReassurance lang={lang} mode="quote" compact />
      </div>
    );
  }

  if (checkoutUrl && isProfileBuild) {
    return (
      <div className="mt-6 rounded-lg border border-[color:var(--panel-border)] bg-[color:var(--panel)] p-4">
        <p className="text-sm font-semibold">{isEt ? "Kinnita tellimuse hind" : "Confirm order price"}</p>
        <div className="mt-3 space-y-1 text-xs text-[color:var(--muted)]">
          <p>
            {isEt ? "Tellimuse hind" : "Order price"}:{" "}
            <strong className="text-[color:var(--foreground)]">€{(checkoutOrderPriceEur ?? priceEur).toLocaleString()}</strong>
          </p>
          <p>
            {isEt
              ? "Stripe võtab selle summa. Enne kokkupanekut kontrollime saadavuse üle ja võtame ühendust, kui asendus võib olla vajalik."
              : "Stripe will charge this amount. We verify availability before assembly and contact you if a substitution may be needed."}
          </p>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={proceedToCheckout}
            className="btn-primary purchase-cta rounded-md px-4 py-2 text-sm font-semibold text-white"
          >
            {isEt ? "Jätka Stripe'i makseni →" : "Continue to Stripe Payment →"}
          </button>
          <button
            type="button"
            onClick={() => {
              clearPendingCheckoutIntent();
              setCheckoutUrl(null);
              setCheckoutOrderPriceEur(null);
            }}
            className="text-xs text-[color:var(--muted)] underline"
          >
            {isEt ? "Tagasi" : "Cancel"}
          </button>
        </div>
        <p className="mt-2 text-xs text-[color:var(--muted)]">
          {isEt ? "Makse toimub Stripe'i kassas" : "Payment is completed in Stripe checkout"}
        </p>
        <PurchaseReassurance lang={lang} mode="payment" compact />
      </div>
    );
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={() => void startCheckout()}
        disabled={loading}
        className={`btn-primary purchase-cta rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${loading ? "animate-pulse" : ""}`}
      >
        {loading
          ? t(lang, "Redirecting...", "Suunamine...")
            : buttonLabel ?? (isProfileBuild
            ? (isEt ? `Osta konfiguratsioon — €${priceEur.toLocaleString()}` : `Purchase Configuration — €${priceEur.toLocaleString()}`)
            : (isEt ? `Osta €${priceEur.toLocaleString()}` : `Purchase for €${priceEur.toLocaleString()}`)
          )}
      </button>
      <p className="mt-2 text-xs text-[color:var(--muted)]">
        {isProfileBuild
          ? t(lang, "Payment is completed in Stripe checkout. Order price includes assembly and configuration.", "Makse toimub Stripe'i kassas. Tellimuse hind sisaldab kokkupanekut ja seadistust.")
          : t(lang, "Payment is completed in Stripe checkout. Order price includes assembly markup.", "Makse toimub Stripe'i kassas. Tellimuse hind sisaldab kokkupaneku juurdehindlust.")
        }
      </p>
      <PurchaseReassurance lang={lang} mode="payment" compact />
      {message ? <p className="mt-2 text-xs text-red-400">{message}</p> : null}
    </div>
  );
}
