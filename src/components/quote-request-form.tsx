"use client";

import { FormEvent, useState } from "react";
import { parseApiMessage } from "@/lib/parse-api-message";
import type { SiteLanguage } from "@/lib/lang";
import { PurchaseReassurance } from "@/components/purchase-reassurance";

type QuoteProductType = "mac_system" | "external_gpu_enclosure" | "mac_egpu_build";

type Props = {
  productType: QuoteProductType;
  productId: number;
  productName: string;
  lang?: SiteLanguage;
};

const t = (lang: SiteLanguage | undefined, en: string, et: string) => lang === "et" ? et : en;

export function QuoteRequestForm({ productType, productId, productName, lang = "en" }: Props) {
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submitQuoteRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("loading");
    setError(null);
    const formData = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/quote-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName,
          customerEmail,
          productType,
          productId,
          message,
          website: formData.get("website") ?? "",
        }),
      });

      if (!response.ok) {
        const apiMessage = await parseApiMessage(response);
        setError(apiMessage ?? t(lang, "Quote request failed.", "Pakkumise päring ebaõnnestus."));
        setStatus("idle");
        return;
      }

      setStatus("sent");
    } catch {
      setError(t(lang, "Quote request failed. Check your connection and try again.", "Pakkumise päring ebaõnnestus. Kontrolli ühendust ja proovi uuesti."));
      setStatus("idle");
    }
  }

  if (status === "sent") {
    return (
      <div className="mt-6 rounded-lg border border-emerald-500/35 bg-emerald-500/5 p-4">
        <p className="text-sm font-semibold">
          {t(lang, "Quote request received.", "Pakkumise päring on vastu võetud.")}
        </p>
      <p className="mt-2 text-xs text-[color:var(--muted)]">
          {t(lang, "We will review the configuration, check current pricing, and usually respond within 1-2 business days.", "Vaatame konfiguratsiooni üle, kontrollime kehtivad hinnad ja võtame tavaliselt ühendust 1-2 tööpäeva jooksul.")}
        </p>
      </div>
    );
  }

  return (
    <form
      data-quote-request-form
      data-api-path="/api/quote-requests"
      onSubmit={submitQuoteRequest}
      className="mt-6 space-y-3"
    >
      <input type="hidden" name="productType" value={productType} />
      <input type="hidden" name="productId" value={productId} />
      <input className="hidden" type="text" name="website" tabIndex={-1} autoComplete="off" />
      <p className="text-xs text-[color:var(--muted)]">
        {t(lang, "Quote item:", "Pakkumise toode:")} <span className="font-semibold text-[color:var(--foreground)]">{productName}</span>
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="text-xs font-semibold text-[color:var(--muted)]">{t(lang, "Name", "Nimi")}</span>
          <input
            value={customerName}
            onChange={(event) => setCustomerName(event.target.value)}
            className="mt-1 w-full rounded-md border border-[color:var(--panel-border)] bg-[color:var(--panel)] px-3 py-2 text-sm"
            maxLength={120}
            required
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-[color:var(--muted)]">Email</span>
          <input
            value={customerEmail}
            onChange={(event) => setCustomerEmail(event.target.value)}
            className="mt-1 w-full rounded-md border border-[color:var(--panel-border)] bg-[color:var(--panel)] px-3 py-2 text-sm"
            type="email"
            maxLength={254}
            required
          />
        </label>
      </div>
      <label className="block">
        <span className="text-xs font-semibold text-[color:var(--muted)]">
          {t(lang, "Use case, models, timeline, and budget", "Kasutusjuht, mudelid, ajakava ja eelarve")}
        </span>
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          className="mt-1 min-h-28 w-full rounded-md border border-[color:var(--panel-border)] bg-[color:var(--panel)] px-3 py-2 text-sm"
          maxLength={2000}
          required
        />
      </label>
      <button
        type="submit"
        disabled={status === "loading"}
        className="btn-primary purchase-cta rounded-md px-6 py-3 text-sm font-semibold text-white disabled:opacity-60"
      >
        {status === "loading"
          ? t(lang, "Sending...", "Saatmine...")
          : t(lang, "Request Custom Quote", "Küsi pakkumist")}
      </button>
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
      <p className="text-xs text-[color:var(--muted)]">
        {t(lang, "This product remains quote-only. No payment is taken from this form.", "See toode jääb pakkumispõhiseks. Selle vormiga makset ei võeta.")}
      </p>
      <PurchaseReassurance lang={lang} mode="quote" compact />
    </form>
  );
}
