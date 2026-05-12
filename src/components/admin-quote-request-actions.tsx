"use client";

import { useState } from "react";

const STATUSES = ["NEW", "CONTACTED", "WAITING_CUSTOMER", "QUOTED", "CLOSED", "SPAM"] as const;

type QuoteUpdateResult = {
  message?: string;
  quoteRequest?: {
    status: string;
    operatorNote: string;
    contactedAt: string | null;
  };
};

type RevealResult = {
  message?: string;
  quoteRequest?: {
    customerEmail: string;
    customerName: string;
  };
};

export function AdminQuoteRequestActions({
  quoteRequestId,
  status,
  notePreview,
}: {
  quoteRequestId: number;
  status: string;
  notePreview: string;
}) {
  const [nextStatus, setNextStatus] = useState(status);
  const [operatorNote, setOperatorNote] = useState(notePreview);
  const [message, setMessage] = useState<string | null>(null);
  const [contact, setContact] = useState<{ customerEmail: string; customerName: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [revealing, setRevealing] = useState(false);

  async function saveQuote() {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/quote-requests", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quoteRequestId, status: nextStatus, operatorNote }),
      });
      const result = await response.json().catch(() => ({ message: "Update response was not valid JSON." })) as QuoteUpdateResult;
      if (!response.ok) {
        setMessage(result.message ?? "Quote update failed.");
        return;
      }
      setMessage(`Saved ${result.quoteRequest?.status ?? nextStatus}.`);
      if (result.quoteRequest) {
        setNextStatus(result.quoteRequest.status);
        setOperatorNote(result.quoteRequest.operatorNote);
      }
    } catch {
      setMessage("Quote update failed before reaching the server.");
    } finally {
      setSaving(false);
    }
  }

  async function revealContact() {
    const confirmed = window.confirm("Reveal this quote contact in your browser? Do this only when you need to contact the customer.");
    if (!confirmed) return;

    setRevealing(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/quote-requests/reveal", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quoteRequestId }),
      });
      const result = await response.json().catch(() => ({ message: "Reveal response was not valid JSON." })) as RevealResult;
      if (!response.ok || !result.quoteRequest) {
        setMessage(result.message ?? "Contact reveal failed.");
        return;
      }
      setContact(result.quoteRequest);
      setMessage("Contact revealed for this session.");
    } catch {
      setMessage("Contact reveal failed before reaching the server.");
    } finally {
      setRevealing(false);
    }
  }

  return (
    <div className="mt-3 grid gap-2">
      <label className="grid gap-1 text-xs font-semibold">
        Status
        <select
          value={nextStatus}
          onChange={(event) => setNextStatus(event.target.value)}
          className="rounded-md border border-[color:var(--panel-border)] bg-transparent px-2 py-1.5 text-xs"
        >
          {STATUSES.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-xs font-semibold">
        Operator note
        <textarea
          value={operatorNote}
          onChange={(event) => setOperatorNote(event.target.value.slice(0, 500))}
          maxLength={500}
          rows={3}
          className="rounded-md border border-[color:var(--panel-border)] bg-transparent px-2 py-1.5 text-xs"
          placeholder="Internal note, not sent to the customer"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={saveQuote}
          disabled={saving}
          className="rounded-md border border-[color:var(--panel-border)] px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-45"
        >
          {saving ? "Saving..." : "Save quote state"}
        </button>
        <button
          type="button"
          onClick={revealContact}
          disabled={revealing || Boolean(contact)}
          className="rounded-md border border-[color:var(--panel-border)] px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-45"
        >
          {contact ? "Contact revealed" : revealing ? "Revealing..." : "Reveal contact"}
        </button>
      </div>
      {contact ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs">
          <p><strong>Name:</strong> {contact.customerName}</p>
          <p><strong>Email:</strong> {contact.customerEmail}</p>
        </div>
      ) : null}
      {message ? <p className="text-xs font-medium text-[color:var(--accent-2)]" aria-live="polite">{message}</p> : null}
    </div>
  );
}
