"use client";

import { useState } from "react";

type ReconcileResult = {
  action?: string;
  message?: string;
  mutated?: boolean;
  validationErrors?: string[];
};

function summarizeResult(result: ReconcileResult): string {
  if (result.validationErrors?.length) return result.validationErrors.join(" ");
  if (result.message) return result.message;
  if (result.action) return result.action;
  return "Stripe reconciliation finished.";
}

export function AdminStripeReconcileButton({ orderId, enabled }: { orderId: number; enabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function reconcileOrder() {
    if (!enabled || busy) return;
    const confirmed = window.confirm("Retrieve the stored Stripe Checkout Session and reconcile this order? This is idempotent and will not regress paid orders.");
    if (!confirmed) return;

    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/orders/reconcile-stripe", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const result = await response.json().catch(() => ({ message: "Reconcile response was not valid JSON." })) as ReconcileResult;
      setMessage(summarizeResult(result));
    } catch {
      setMessage("Stripe reconciliation failed before reaching the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={reconcileOrder}
        disabled={!enabled || busy}
        className="rounded-md border border-[color:var(--panel-border)] px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-45"
      >
        {busy ? "Reconciling..." : "Reconcile Stripe state"}
      </button>
      <p className="text-xs text-[color:var(--muted)]">
        {enabled ? "Checks Stripe and safely updates stuck checkout state." : "Requires a stored checkout session."}
      </p>
      {message ? <p className="text-xs font-medium text-[color:var(--accent-2)]">{message}</p> : null}
    </div>
  );
}
