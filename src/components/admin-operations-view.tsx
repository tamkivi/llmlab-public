import { AdminEmailRepairButton } from "@/components/admin-email-repair-button";
import { AdminQuoteRequestActions } from "@/components/admin-quote-request-actions";
import type { getAdminOperationsView } from "@/lib/server/order-service";
import { orderStatusCopy } from "@/lib/order-ux";
import type { ReactNode } from "react";

type AdminOperationsData = Awaited<ReturnType<typeof getAdminOperationsView>>;

function statusTone(status: string): string {
  if (status === "healthy" || status === "PAID" || status === "sent" || status === "CLOSED") return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (status === "degraded" || status === "FAILED" || status === "missing" || status === "SPAM") return "bg-red-500/10 text-red-700 dark:text-red-300";
  if (status === "CHECKOUT_CREATED" || status === "PENDING" || status === "NEW" || status === "CONTACTED" || status === "WAITING_CUSTOMER" || status === "QUOTED") return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return "bg-[color:var(--panel)] text-[color:var(--muted)]";
}

function StatusPill({ children, status }: { children: ReactNode; status: string }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${statusTone(status)}`}>
      {children}
    </span>
  );
}

function EmailState({
  label,
  sentAt,
  attemptedAt,
  lastError,
}: {
  label: string;
  sentAt: string | null;
  attemptedAt: string | null;
  lastError: string;
}) {
  const state = sentAt ? "sent" : attemptedAt ? "retrying" : "missing";
  return (
    <div className="rounded-md border border-[color:var(--panel-border)] p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold">{label}</span>
        <StatusPill status={state}>{state}</StatusPill>
      </div>
      <p className="mt-1 text-xs text-[color:var(--muted)]">{sentAt ?? attemptedAt ?? "No timestamp"}</p>
      {!sentAt && lastError ? <p className="mt-1 text-xs text-red-600 dark:text-red-300">{lastError}</p> : null}
    </div>
  );
}

function MetricCard({ label, value, status }: { label: string; value: string | number; status?: string }) {
  return (
    <div className="rounded-lg border border-[color:var(--panel-border)] p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">{label}</p>
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-2xl font-semibold">{value}</p>
        {status ? <StatusPill status={status}>{status}</StatusPill> : null}
      </div>
    </div>
  );
}

export function AdminOperationsView({ data }: { data: AdminOperationsData }) {
  const { diagnostics, orders, quotes } = data;
  const failedWebhook = diagnostics.payments.recentFailedWebhookEvents[0];

  return (
    <div className="space-y-6">
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Health" value={diagnostics.status} status={diagnostics.status} />
        <MetricCard label="Critical pricing" value={`${diagnostics.health.pricingCriticalCoveragePct ?? diagnostics.health.pricingCoveragePct}%`} status={diagnostics.health.pricingFresh ? "healthy" : "degraded"} />
        <MetricCard label="Background pricing" value={`${diagnostics.health.pricingBackgroundCoveragePct ?? diagnostics.pricing.backgroundCoveragePct ?? 0}%`} />
        <MetricCard label="Pending email retries" value={diagnostics.health.pendingPaidEmailRetries} status={diagnostics.health.pendingPaidEmailRetries > 0 ? "degraded" : "healthy"} />
      </section>

      <section className="wireframe-panel p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Payment and webhook context</h2>
            <p className="mt-1 text-sm text-[color:var(--muted)]">Compact diagnostics only. Use Vercel logs and Stripe Dashboard for raw delivery details.</p>
          </div>
          <a href="/api/admin/diagnostics" className="rounded-md border border-[color:var(--panel-border)] px-3 py-1.5 text-xs font-semibold">
            Open diagnostics JSON
          </a>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <MetricCard label="Recent webhook failures" value={diagnostics.payments.recentFailedWebhookEvents.length} status={diagnostics.payments.recentFailedWebhookEvents.length > 0 ? "degraded" : "healthy"} />
          <MetricCard label="Quote requests needing attention" value={diagnostics.health.quoteRequestsNeedingAttention} status={diagnostics.health.quoteRequestsNeedingAttention > 0 ? "IN_REVIEW" : "healthy"} />
          <MetricCard label="Checkout availability" value={diagnostics.health.checkoutAvailable ? "available" : "disabled"} status={diagnostics.health.checkoutAvailable ? "healthy" : "degraded"} />
        </div>
        {failedWebhook ? (
          <p className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-300">
            Latest webhook failure: {failedWebhook.event_type} / {failedWebhook.event_id} / {failedWebhook.last_error || "no stored error"}
          </p>
        ) : (
          <p className="mt-4 text-sm text-[color:var(--muted)]">No failed webhook events are currently listed in diagnostics.</p>
        )}
      </section>

      <section className="wireframe-panel p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Recent orders</h2>
            <p className="mt-1 text-sm text-[color:var(--muted)]">Customer contact is masked. Repair can only retry missing paid-order emails.</p>
          </div>
        </div>

        {orders.length === 0 ? (
          <p className="mt-4 text-sm text-[color:var(--muted)]">No orders in the system yet.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {orders.map((order) => (
              <article key={order.id} className="rounded-lg border border-[color:var(--panel-border)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">Order #{order.id}</p>
                      <StatusPill status={order.status}>{order.status}</StatusPill>
                      <span className="text-xs text-[color:var(--muted)]">{orderStatusCopy(order.status, "en").label}</span>
                    </div>
                    <p className="mt-2 text-sm">{order.buildName}</p>
                    <p className="text-xs text-[color:var(--muted)]">
                      {order.itemType} #{order.itemId} / user #{order.userId} / {order.customerContact}
                    </p>
                  </div>
                  <div className="text-right text-sm">
                    <p className="font-semibold">€{order.amountEur}</p>
                    <p className="text-xs text-[color:var(--muted)]">created {order.createdAt}</p>
                    <p className="text-xs text-[color:var(--muted)]">updated {order.updatedAt}</p>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr_1fr]">
                  <div className="rounded-md border border-[color:var(--panel-border)] p-2 text-xs text-[color:var(--muted)]">
                    <p className="font-semibold text-[color:var(--foreground)]">Payment</p>
                    <p>Paid: {order.paidAt ?? "not paid"}</p>
                    <p>Fulfilled: {order.fulfilledAt ?? "not fulfilled"}</p>
                    <p>Session: {order.checkoutSessionRef ?? "none"}</p>
                    <p>Payment intent: {order.paymentIntentRef ?? "none"}</p>
                  </div>
                  <div className="grid gap-2">
                    <EmailState label="Customer email" {...order.customerEmail} />
                    <EmailState label="Admin email" {...order.adminEmail} />
                  </div>
                  {order.canRetryPaidEmails ? (
                    <AdminEmailRepairButton orderId={order.id} enabled />
                  ) : (
                    <div className="rounded-md border border-[color:var(--panel-border)] p-3 text-xs text-[color:var(--muted)]">
                      No email repair available. The order is unpaid, lacks a checkout session, or both email sides are already complete.
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="wireframe-panel p-6">
        <h2 className="text-xl font-semibold">Recent quote requests</h2>
        <p className="mt-1 text-sm text-[color:var(--muted)]">Contact details are masked by default. Reveal only when you need to contact the customer.</p>
        {quotes.length === 0 ? (
          <p className="mt-4 text-sm text-[color:var(--muted)]">No quote requests yet.</p>
        ) : (
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {quotes.map((quote) => (
              <article key={quote.id} className="rounded-lg border border-[color:var(--panel-border)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">Quote #{quote.id}</p>
                  <StatusPill status={quote.status}>{quote.status}</StatusPill>
                </div>
                <p className="mt-2 text-sm">{quote.productName}</p>
                <p className="text-xs text-[color:var(--muted)]">{quote.productType} #{quote.productId}</p>
                <p className="mt-2 text-xs text-[color:var(--muted)]">Contact: {quote.contact} / customer {quote.customer}</p>
                <p className="text-xs text-[color:var(--muted)]">Updated: {quote.updatedAt}</p>
                <p className="text-xs text-[color:var(--muted)]">Contacted: {quote.contactedAt ?? "not recorded"}</p>
                <p className="text-xs text-[color:var(--muted)]">Created: {quote.createdAt}</p>
                <p className="mt-2 rounded-md border border-[color:var(--panel-border)] p-2 text-xs text-[color:var(--muted)]">
                  Note: {quote.notePreview || "No operator note yet."}
                </p>
                <AdminQuoteRequestActions
                  quoteRequestId={quote.id}
                  status={quote.status}
                  notePreview={quote.notePreview}
                />
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
