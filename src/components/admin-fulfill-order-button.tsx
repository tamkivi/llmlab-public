"use client";

import { useState } from "react";

type FulfillResult = {
  message?: string;
  reason?: string;
};

export function AdminFulfillOrderButton({ orderId, enabled }: { orderId: number; enabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function markFulfilled() {
    if (!enabled || busy) return;
    const confirmed = window.confirm("Mark this paid order as physically fulfilled/completed? This does not resend payment emails.");
    if (!confirmed) return;

    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/orders/mark-fulfilled", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const result = await response.json().catch(() => ({ message: "Fulfillment response was not valid JSON." })) as FulfillResult;
      setMessage(result.message ?? result.reason ?? "Fulfillment update finished.");
    } catch {
      setMessage("Fulfillment request failed before reaching the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={markFulfilled}
        disabled={!enabled || busy}
        className="rounded-md border border-[color:var(--panel-border)] px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-45"
      >
        {busy ? "Completing..." : "Mark fulfilled"}
      </button>
      <p className="text-xs text-[color:var(--muted)]">
        {enabled ? "Records physical completion only." : "Requires paid and payment-confirmed order."}
      </p>
      {message ? <p className="text-xs font-medium text-[color:var(--accent-2)]">{message}</p> : null}
    </div>
  );
}
