import { AdminEmailRepairButton } from "@/components/admin-email-repair-button";
import { AdminFulfillOrderButton } from "@/components/admin-fulfill-order-button";
import { AdminQuoteRequestActions } from "@/components/admin-quote-request-actions";
import { AdminStripeReconcileButton } from "@/components/admin-stripe-reconcile-button";
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

function shortOperationalText(value: string, maxLength = 96): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 3)}...` : trimmed;
}

function QueueCard({
  title,
  count,
  status,
  description,
  empty,
  children,
}: {
  title: string;
  count: number;
  status: string;
  description: string;
  empty: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-[color:var(--panel-border)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-1 text-xs leading-5 text-[color:var(--muted)]">{description}</p>
        </div>
        <StatusPill status={status}>{count}</StatusPill>
      </div>
      {count > 0 ? (
        <div className="mt-3 space-y-2 text-xs text-[color:var(--muted)]">{children}</div>
      ) : (
        <p className="mt-3 text-xs text-[color:var(--muted)]">{empty}</p>
      )}
    </div>
  );
}

export function AdminOperationsView({ data }: { data: AdminOperationsData }) {
  const { diagnostics, orders, quotes } = data;
  const failedWebhook = diagnostics.payments.recentFailedWebhookEvents[0];
  const invariantIssues = diagnostics.commerceInvariants
    ? Object.entries(diagnostics.commerceInvariants).filter(([, count]) => Number(count) > 0)
    : [];
  const fulfillmentQueue = diagnostics.payments.staleFulfillmentOrders.length > 0
    ? diagnostics.payments.staleFulfillmentOrders
    : diagnostics.payments.paymentConfirmedUnfulfilledOrders;
  const latestPricingRun = diagnostics.pricing.latestRun as { id?: number | string; status?: string } | null;
  const buildCheckoutIssues = diagnostics.pricing.buildCheckoutReadiness.filter((build) => !build.eligibility.eligible);

  return (
    <div className="space-y-6">
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Health" value={diagnostics.status} status={diagnostics.status} />
        <MetricCard label="Critical pricing" value={`${diagnostics.health.pricingCriticalCoveragePct ?? diagnostics.health.pricingCoveragePct}%`} status={diagnostics.health.pricingFresh ? "healthy" : "degraded"} />
        <MetricCard label="Background pricing" value={`${diagnostics.health.pricingBackgroundCoveragePct ?? diagnostics.pricing.backgroundCoveragePct ?? 0}%`} />
        <MetricCard label="Pending email retries" value={diagnostics.health.pendingPaidEmailRetries} status={diagnostics.health.pendingPaidEmailRetries > 0 ? "degraded" : "healthy"} />
        <MetricCard label="Stuck payment states" value={diagnostics.health.ambiguousPaymentOrders} status={diagnostics.health.ambiguousPaymentOrders > 0 ? "degraded" : "healthy"} />
        <MetricCard label="Ready to fulfill" value={diagnostics.health.paymentConfirmedUnfulfilledOrders} status={diagnostics.health.staleFulfillmentOrders > 0 ? "degraded" : "healthy"} />
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
        <div className="mt-4 grid gap-3 xl:grid-cols-3">
          <QueueCard
            title="Stuck checkout queue"
            count={diagnostics.payments.ambiguousPaymentOrders.length}
            status={diagnostics.payments.ambiguousPaymentOrders.length > 0 ? "degraded" : "healthy"}
            description="Checkout-created or pending orders older than two hours. Reconcile against Stripe before manual changes."
            empty="No stale checkout-created or pending orders need reconciliation."
          >
            {diagnostics.payments.ambiguousPaymentOrders.slice(0, 5).map((order) => (
              <p key={order.id}>
                Order #{order.id} / {order.status} / created {order.created_at} / session {order.stripe_checkout_session_id ?? "missing"}
              </p>
            ))}
          </QueueCard>
          <QueueCard
            title="Paid notification queue"
            count={diagnostics.payments.paidEmailRetries.length}
            status={diagnostics.payments.paidEmailRetries.length > 0 ? "degraded" : "healthy"}
            description="Paid orders missing customer or admin notification timestamps. Retry sends only the missing side."
            empty="No paid orders are missing notification timestamps."
          >
            {diagnostics.payments.paidEmailRetries.slice(0, 5).map((order) => {
              const missing = [
                order.customer_email_sent_at ? null : "customer",
                order.admin_email_sent_at ? null : "admin",
              ].filter(Boolean).join("+");
              const error = shortOperationalText(order.customer_email_last_error || order.admin_email_last_error);
              return (
                <p key={order.id}>
                  Order #{order.id} / missing {missing} / updated {order.updated_at}{error ? ` / ${error}` : ""}
                </p>
              );
            })}
          </QueueCard>
          <QueueCard
            title="Fulfillment queue"
            count={diagnostics.payments.paymentConfirmedUnfulfilledOrders.length}
            status={diagnostics.payments.staleFulfillmentOrders.length > 0 ? "degraded" : "healthy"}
            description="Paid and payment-confirmed orders awaiting physical completion. Stale items are older than seven days."
            empty="No paid orders are waiting for fulfillment."
          >
            {fulfillmentQueue.slice(0, 5).map((order) => (
              <p key={order.id}>
                Order #{order.id} / confirmed {order.payment_confirmed_at ?? "unknown"} / updated {order.updated_at}
                {diagnostics.payments.staleFulfillmentOrders.some((stale) => stale.id === order.id) ? " / stale" : ""}
              </p>
            ))}
          </QueueCard>
          <QueueCard
            title="Webhook failure queue"
            count={diagnostics.payments.recentFailedWebhookEvents.length}
            status={diagnostics.payments.recentFailedWebhookEvents.length > 0 ? "degraded" : "healthy"}
            description="Failed Stripe webhook events retained for replay and diagnosis. Match event IDs in Stripe Dashboard."
            empty="No failed Stripe webhook events are currently listed."
          >
            {diagnostics.payments.recentFailedWebhookEvents.slice(0, 5).map((event) => (
              <p key={event.event_id}>
                {event.event_type} / {event.event_id} / {event.updated_at} / {shortOperationalText(event.last_error || "no stored error")}
              </p>
            ))}
          </QueueCard>
          <QueueCard
            title="Pricing freshness"
            count={diagnostics.pricing.errors.length}
            status={diagnostics.pricing.healthy ? "healthy" : "degraded"}
            description="Checkout depends on fresh, trusted Estonian market rows. Pricing errors keep direct checkout fail-closed."
            empty="Pricing freshness has no active errors."
          >
            {diagnostics.pricing.errors.slice(0, 5).map((error) => (
              <p key={error}>{shortOperationalText(error)}</p>
            ))}
            {latestPricingRun ? (
              <p>Latest run #{latestPricingRun.id ?? "unknown"} / {latestPricingRun.status ?? "unknown"}</p>
            ) : null}
          </QueueCard>
          <QueueCard
            title="Build checkout readiness"
            count={buildCheckoutIssues.length}
            status={buildCheckoutIssues.length > 0 ? "degraded" : "healthy"}
            description="Profile build direct-checkout blockers, including component-level trusted-price and order-limit reasons."
            empty="All sampled profile builds are direct-checkout eligible."
          >
            {buildCheckoutIssues.slice(0, 5).map((build) => (
              <p key={build.id}>
                #{build.id} / {build.buildName} / {build.eligibility.reason ?? "blocked"}
                {build.eligibility.blockers?.[0] ? ` / ${build.eligibility.blockers[0].label}: ${build.eligibility.blockers[0].reason}` : ""}
              </p>
            ))}
          </QueueCard>
          <QueueCard
            title="Commerce invariants"
            count={invariantIssues.length}
            status={invariantIssues.length > 0 ? "degraded" : "healthy"}
            description="DB preflight checks for impossible payment, fulfillment, currency, and snapshot states."
            empty="No commerce invariant violations are currently reported."
          >
            {invariantIssues.slice(0, 5).map(([name, count]) => (
              <p key={name}>{name}: {count}</p>
            ))}
          </QueueCard>
        </div>
        {diagnostics.payments.recentAdminOrderActions.length > 0 ? (
          <div className="mt-4 rounded-md border border-[color:var(--panel-border)] p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">Recent admin order actions</p>
            <div className="mt-2 space-y-1 text-xs text-[color:var(--muted)]">
              {diagnostics.payments.recentAdminOrderActions.slice(0, 5).map((action) => (
                <p key={action.id}>
                  #{action.order_id ?? "n/a"} / {action.action} / {action.result} / {action.created_at}
                  {action.stripe_request_id ? ` / Stripe request ${action.stripe_request_id}` : ""}
                  {action.message ? ` / ${shortOperationalText(action.message)}` : ""}
                </p>
              ))}
            </div>
          </div>
        ) : null}
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
                    <p>Payment confirmed: {order.paymentConfirmedAt ?? order.paidAt ?? "not paid"}</p>
                    <p>Customer notified: {order.customerEmail.sentAt ?? "not sent"}</p>
                    <p>Admin notified: {order.adminEmail.sentAt ?? "not sent"}</p>
                    <p>Fulfilled/completed: {order.fulfilledAt ?? "not complete"}</p>
                    {order.fulfilledByUserId ? <p>Fulfilled by admin #{order.fulfilledByUserId}</p> : null}
                    <p>Session: {order.checkoutSessionRef ?? "none"}</p>
                    <p>Payment intent: {order.paymentIntentRef ?? "none"}</p>
                  </div>
                  <div className="grid gap-2">
                    <EmailState label="Customer email" {...order.customerEmail} />
                    <EmailState label="Admin email" {...order.adminEmail} />
                  </div>
                  <div className="space-y-3">
                    <AdminStripeReconcileButton orderId={order.id} enabled={order.canReconcileStripe} />
                    <AdminFulfillOrderButton orderId={order.id} enabled={order.canMarkFulfilled} />
                    {order.canRetryPaidEmails ? (
                      <AdminEmailRepairButton orderId={order.id} enabled />
                    ) : (
                      <div className="rounded-md border border-[color:var(--panel-border)] p-3 text-xs text-[color:var(--muted)]">
                        No email repair available. The order is unpaid, lacks a checkout session, or both email sides are already complete.
                      </div>
                    )}
                  </div>
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
