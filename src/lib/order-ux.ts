import type { OrderStatus } from "@/lib/db";

export type OrderUxLanguage = "en" | "et";

export const ORDER_SUPPORT_EMAIL = process.env.NEXT_PUBLIC_QUOTE_EMAIL || "support@llmlab.ee";

export function orderSupportHref(orderId?: number | null): string {
  const subject = orderId ? `LLMLab.ee order #${orderId}` : "LLMLab.ee order support";
  return `mailto:${ORDER_SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`;
}

export function orderStatusCopy(status: OrderStatus | "UNKNOWN", lang: OrderUxLanguage) {
  const isEt = lang === "et";

  if (status === "PAID") {
    return {
      label: isEt ? "Makse vastu võetud" : "Payment received",
      title: isEt ? "Makse on kinnitatud" : "Payment confirmed",
      body: isEt
        ? "Tellimus on tasutud. Kinnituskiri peaks saabuma tavaliselt mõne minuti jooksul; nüüd kontrollime saadavust enne komponentide tellimist."
        : "Your order is paid. The confirmation email should usually arrive within a few minutes; we now verify availability before sourcing parts.",
    };
  }

  if (status === "CHECKOUT_CREATED") {
    return {
      label: isEt ? "Makse ootel" : "Payment pending",
      title: isEt ? "Makse ootel: kinnitust kontrollitakse" : "Payment pending: confirmation is still processing",
      body: isEt
        ? "Stripe ei ole makset veel lõplikult kinnitanud. See võib juhtuda kohe pärast ümbersuunamist või webhooki viivituse ajal; uuenda lehte mõne hetke pärast."
        : "Stripe has not returned final confirmation yet. This can happen right after redirect or during a webhook delay; refresh this page in a moment.",
    };
  }

  if (status === "PENDING") {
    return {
      label: isEt ? "Makse alustamata" : "Payment not started",
      title: isEt ? "Tellimus ootab makset" : "Order is waiting for payment",
      body: isEt
        ? "Tellimus on kontol olemas, kuid Stripe'i maksesessioon ei ole veel kinnitatud. Jätka ainult viimase makselingi kaudu."
        : "The order exists on your account, but Stripe checkout has not been confirmed. Continue only from the latest payment link.",
    };
  }

  if (status === "CANCELED") {
    return {
      label: isEt ? "Makse aegus või katkestati" : "Checkout expired or canceled",
      title: isEt ? "Makset ei võetud" : "No payment was captured",
      body: isEt
        ? "See maksesessioon on aegunud või katkestatud. Kui pank näitab makset, võta ühendust tellimuse viitega."
        : "This checkout session expired or was canceled. If your bank shows a charge, contact support with the order reference.",
    };
  }

  if (status === "FAILED") {
    return {
      label: isEt ? "Makse ebaõnnestus" : "Payment failed",
      title: isEt ? "Makse ei õnnestunud" : "Payment was not completed",
      body: isEt
        ? "Stripe ei kinnitanud makset. Kui see tundub vale, võta ühendust tellimuse viitega."
        : "Stripe did not confirm the payment. If this looks wrong, contact support with the order reference.",
    };
  }

  return {
    label: isEt ? "Olek teadmata" : "Status unknown",
    title: isEt ? "Tellimuse olekut ei leitud" : "Order status is unavailable",
    body: isEt
      ? "Me ei saa seda maksesessiooni praegu kontoga siduda. Vaata oma tellimusi või võta toega ühendust."
      : "We cannot match this checkout session to your account right now. Check your orders or contact support.",
  };
}

export function orderTimeline(status: OrderStatus | "UNKNOWN", lang: OrderUxLanguage) {
  const isEt = lang === "et";
  const steps = isEt
    ? [
        "Makse vastu võetud",
        "Saadavuse kontroll",
        "Komponentide tellimine",
        "Kokkupanek",
        "Põhikontroll ja seadistus",
        "Üleandmine kokku lepitud",
      ]
    : [
        "Payment received",
        "Availability check",
        "Parts sourcing",
        "Assembled",
        "Baseline checks and setup",
        "Handover agreed",
      ];

  return steps.map((label, index) => {
    if (status === "PAID") {
      return { label, state: index === 0 ? "complete" : index === 1 ? "current" : "upcoming" };
    }
    if (status === "FAILED" || status === "CANCELED") {
      return { label, state: index === 0 ? "blocked" : "upcoming" };
    }
    return { label, state: index === 0 ? "current" : "upcoming" };
  });
}
