"use client";

import { useState } from "react";

type RepairResult = {
  attempted?: number;
  results?: Array<{
    orderId: number;
    customerEmailSent: boolean;
    adminEmailSent: boolean;
    customerEmailReason?: string;
    adminEmailReason?: string;
  }>;
  skipped?: Array<{ orderId: number; reason: string }>;
  message?: string;
};

function summarizeResult(result: RepairResult): string {
  if (result.message) return result.message;
  const first = result.results?.[0];
  if (first) {
    const customer = first.customerEmailSent ? "customer sent" : `customer ${first.customerEmailReason ?? "not sent"}`;
    const admin = first.adminEmailSent ? "admin sent" : `admin ${first.adminEmailReason ?? "not sent"}`;
    return `${customer}; ${admin}`;
  }
  const skipped = result.skipped?.[0];
  if (skipped) return `Skipped: ${skipped.reason}`;
  return `Attempted ${result.attempted ?? 0} repair(s).`;
}

export function AdminEmailRepairButton({ orderId, enabled }: { orderId: number; enabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function retryMissingEmails() {
    if (!enabled || busy) return;
    const confirmed = window.confirm("Retry only missing paid-order email notifications for this order? Already-sent emails will not be resent.");
    if (!confirmed) return;

    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/orders/retry-paid-emails", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const result = await response.json().catch(() => ({ message: "Repair response was not valid JSON." })) as RepairResult;
      setMessage(summarizeResult(result));
    } catch {
      setMessage("Repair request failed before reaching the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={retryMissingEmails}
        disabled={!enabled || busy}
        className="rounded-md border border-[color:var(--panel-border)] px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-45"
      >
        {busy ? "Retrying..." : "Retry missing emails"}
      </button>
      <p className="text-xs text-[color:var(--muted)]">
        {enabled ? "Sends only missing customer/admin notifications." : "Available only for paid orders with missing email timestamps."}
      </p>
      {message ? <p className="text-xs font-medium text-[color:var(--accent-2)]">{message}</p> : null}
    </div>
  );
}
