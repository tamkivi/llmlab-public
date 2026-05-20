import "server-only";

import {
  getAdapter,
  getPricingFreshnessReport,
  initDb,
  listAdminOverrideBackedPriceChecks,
  listAdminPricingOverrides,
} from "@/lib/db";
import { getCommerceInvariantDiagnostics } from "@/lib/db/invariants";
import { getBuildCheckoutEligibility, getCheckoutAvailability } from "@/lib/server/checkout-availability";

type RecentWebhookFailure = {
  event_id: string;
  event_type: string;
  status: string;
  updated_at: string;
  last_error: string;
};

type PaidEmailRetryRow = {
  id: number;
  stripe_checkout_session_id: string | null;
  customer_email_sent_at: string | null;
  admin_email_sent_at: string | null;
  customer_email_last_error: string;
  admin_email_last_error: string;
  updated_at: string;
};

type AmbiguousOrderRow = {
  id: number;
  status: string;
  stripe_checkout_session_id: string | null;
  created_at: string;
  updated_at: string;
};

type FulfillmentOrderRow = {
  id: number;
  payment_confirmed_at: string | null;
  customer_email_sent_at: string | null;
  admin_email_sent_at: string | null;
  updated_at: string;
};

type RecentAdminOrderActionRow = {
  id: number;
  order_id: number | null;
  action: string;
  result: string;
  message: string;
  stripe_request_id: string | null;
  created_at: string;
};

type QuoteAttentionRow = {
  id: number;
  status: string;
  product_type: string;
  product_id: number;
  created_at: string;
};

type QuoteStatusCountRow = {
  status: string;
  cnt: number;
};

type BuildCheckoutReadinessRow = {
  id: number;
  build_name: string;
};

function lastSuccessAt(report: Awaited<ReturnType<typeof getPricingFreshnessReport>>): string | null {
  const row = report.lastSuccessfulRun;
  if (!row) return null;
  const finishedAt = row.finished_at;
  if (typeof finishedAt === "string" && finishedAt.length > 0) return finishedAt;
  const startedAt = row.started_at;
  return typeof startedAt === "string" && startedAt.length > 0 ? startedAt : null;
}

export async function getOpsHealthSummary() {
  await initDb();
  const db = getAdapter();
  const pricing = await getPricingFreshnessReport();
  const checkout = getCheckoutAvailability();
  const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const staleProcessingCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const staleCheckoutCutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const staleFulfillmentCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const recentWebhookFailures = (await db.queryOne<{ cnt: number }>(
    "SELECT COUNT(*) AS cnt FROM stripe_webhook_events WHERE status = 'FAILED' AND updated_at >= ?",
    [cutoff24h],
  ).catch(() => null))?.cnt ?? 0;

  const staleWebhookProcessing = (await db.queryOne<{ cnt: number }>(
    "SELECT COUNT(*) AS cnt FROM stripe_webhook_events WHERE status = 'PROCESSING' AND updated_at < ?",
    [staleProcessingCutoff],
  ).catch(() => null))?.cnt ?? 0;

  const pendingPaidEmailRetries = (await db.queryOne<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt
     FROM orders
     WHERE status = 'PAID'
       AND (customer_email_sent_at IS NULL OR admin_email_sent_at IS NULL)`,
  ).catch(() => null))?.cnt ?? 0;

  const ambiguousPaymentOrders = (await db.queryOne<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt
     FROM orders
     WHERE status IN ('PENDING', 'CHECKOUT_CREATED')
       AND created_at < ?`,
    [staleCheckoutCutoff],
  ).catch(() => null))?.cnt ?? 0;

  const paymentConfirmedUnfulfilledOrders = (await db.queryOne<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt
     FROM orders
     WHERE status = 'PAID'
       AND payment_confirmed_at IS NOT NULL
       AND fulfilled_at IS NULL`,
  ).catch(() => null))?.cnt ?? 0;

  const staleFulfillmentOrders = (await db.queryOne<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt
     FROM orders
     WHERE status = 'PAID'
       AND payment_confirmed_at IS NOT NULL
       AND fulfilled_at IS NULL
       AND payment_confirmed_at < ?`,
    [staleFulfillmentCutoff],
  ).catch(() => null))?.cnt ?? 0;

  const quoteRequestsNeedingAttention = (await db.queryOne<{ cnt: number }>(
    "SELECT COUNT(*) AS cnt FROM quote_requests WHERE status IN ('NEW', 'CONTACTED', 'WAITING_CUSTOMER', 'QUOTED')",
  ).catch(() => null))?.cnt ?? 0;

  const healthy = pricing.healthy
    && checkout.available
    && recentWebhookFailures === 0
    && staleWebhookProcessing === 0
    && pendingPaidEmailRetries === 0
    && ambiguousPaymentOrders === 0
    && staleFulfillmentOrders === 0;

  return {
    status: healthy ? "healthy" as const : "degraded" as const,
    generatedAt: new Date().toISOString(),
    pricingFresh: pricing.healthy,
    pricingCoveragePct: pricing.criticalCoveragePct,
    pricingCriticalCoveragePct: pricing.criticalCoveragePct,
    pricingBackgroundCoveragePct: pricing.backgroundCoveragePct,
    lastPricingSuccessAt: lastSuccessAt(pricing),
    checkoutAvailable: checkout.available,
    checkoutUnavailableReason: checkout.reason ?? null,
    recentWebhookFailures,
    staleWebhookProcessing,
    pendingPaidEmailRetries,
    ambiguousPaymentOrders,
    paymentConfirmedUnfulfilledOrders,
    staleFulfillmentOrders,
    quoteRequestsNeedingAttention,
  };
}

export async function getAdminOpsDiagnostics() {
  await initDb();
  const db = getAdapter();
  const pricing = await getPricingFreshnessReport();
  const health = await getOpsHealthSummary();
  const [activePricingOverrides, overrideBackedPriceChecks] = await Promise.all([
    listAdminPricingOverrides(),
    listAdminOverrideBackedPriceChecks(),
  ]);
  const staleCheckoutCutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const staleFulfillmentCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const recentFailedWebhookEvents = await db.queryAll<RecentWebhookFailure>(
    `SELECT event_id, event_type, status, updated_at, last_error
     FROM stripe_webhook_events
     WHERE status = 'FAILED'
     ORDER BY updated_at DESC
     LIMIT 20`,
  ).catch(() => []);

  const paidEmailRetries = await db.queryAll<PaidEmailRetryRow>(
    `SELECT id, stripe_checkout_session_id, customer_email_sent_at, admin_email_sent_at,
            customer_email_last_error, admin_email_last_error, updated_at
     FROM orders
     WHERE status = 'PAID'
       AND (customer_email_sent_at IS NULL OR admin_email_sent_at IS NULL)
     ORDER BY updated_at DESC, id DESC
     LIMIT 50`,
  ).catch(() => []);

  const ambiguousPaymentOrders = await db.queryAll<AmbiguousOrderRow>(
    `SELECT id, status, stripe_checkout_session_id, created_at, updated_at
     FROM orders
     WHERE status IN ('PENDING', 'CHECKOUT_CREATED')
       AND created_at < ?
     ORDER BY created_at ASC
     LIMIT 50`,
    [staleCheckoutCutoff],
  ).catch(() => []);

  const paymentConfirmedUnfulfilledOrders = await db.queryAll<FulfillmentOrderRow>(
    `SELECT id, payment_confirmed_at, customer_email_sent_at, admin_email_sent_at, updated_at
     FROM orders
     WHERE status = 'PAID'
       AND payment_confirmed_at IS NOT NULL
       AND fulfilled_at IS NULL
     ORDER BY payment_confirmed_at ASC
     LIMIT 50`,
  ).catch(() => []);

  const staleFulfillmentOrders = await db.queryAll<FulfillmentOrderRow>(
    `SELECT id, payment_confirmed_at, customer_email_sent_at, admin_email_sent_at, updated_at
     FROM orders
     WHERE status = 'PAID'
       AND payment_confirmed_at IS NOT NULL
       AND fulfilled_at IS NULL
       AND payment_confirmed_at < ?
     ORDER BY payment_confirmed_at ASC
     LIMIT 50`,
    [staleFulfillmentCutoff],
  ).catch(() => []);

  const recentAdminOrderActions = await db.queryAll<RecentAdminOrderActionRow>(
    `SELECT id, order_id, action, result, message, stripe_request_id, created_at
     FROM admin_order_actions
     ORDER BY created_at DESC, id DESC
     LIMIT 20`,
  ).catch(() => []);

  const commerceInvariants = await getCommerceInvariantDiagnostics(db).catch(() => null);

  const quoteRequestsNeedingAttention = await db.queryAll<QuoteAttentionRow>(
    `SELECT id, status, product_type, product_id, created_at
     FROM quote_requests
     WHERE status IN ('NEW', 'CONTACTED', 'WAITING_CUSTOMER', 'QUOTED')
     ORDER BY created_at ASC
     LIMIT 50`,
  ).catch(() => []);

  const quoteStatusCounts = await db.queryAll<QuoteStatusCountRow>(
    `SELECT status, COUNT(*) AS cnt
     FROM quote_requests
     GROUP BY status
     ORDER BY status ASC`,
  ).catch(() => []);

  const buildCheckoutRows = await db.queryAll<BuildCheckoutReadinessRow>(
    `SELECT id, build_name
     FROM profile_builds
     ORDER BY id ASC
     LIMIT 30`,
  ).catch(() => []);
  const buildCheckoutReadiness = await Promise.all(buildCheckoutRows.map(async (build) => {
    const eligibility = await getBuildCheckoutEligibility(build.id).catch((error) => ({
      eligible: false,
      reason: "pricing_unhealthy" as const,
      message: error instanceof Error ? error.message : "Unable to resolve checkout eligibility.",
      maxPriceAgeHours: 0,
      blockers: [],
    }));
    return {
      id: build.id,
      buildName: build.build_name,
      eligibility,
    };
  }));

  return {
    status: health.status,
    generatedAt: health.generatedAt,
    health,
    pricing: {
      healthy: pricing.healthy,
      errors: pricing.errors,
      warnings: pricing.warnings,
      coveragePct: pricing.criticalCoveragePct,
      criticalCoveragePct: pricing.criticalCoveragePct,
      backgroundCoveragePct: pricing.backgroundCoveragePct,
      healthCriticalItemCount: pricing.healthCriticalItemCount,
      backgroundTrackableItemCount: pricing.backgroundTrackableItemCount,
      skippedReasonBuckets: pricing.skippedItemCountByReason,
      oldestStaleCriticalItem: pricing.oldestStaleCriticalItem,
      oldestStaleBackgroundItem: pricing.oldestStaleBackgroundItem,
      lastSuccessfulRun: pricing.lastSuccessfulRun,
      latestRun: pricing.latestRun,
      latestFailures: pricing.latestFailures,
      missingTodayCount: pricing.missingTodayCount,
      criticalMissingTodayCount: pricing.criticalMissingTodayCount,
      backgroundMissingTodayCount: pricing.backgroundMissingTodayCount,
      stale24hCount: pricing.stale24hCount,
      stale48hCount: pricing.stale48hCount,
      staleChecks24hCount: pricing.staleChecks24hCount,
      criticalStaleChecks24hCount: pricing.criticalStaleChecks24hCount,
      backgroundStaleChecks24hCount: pricing.backgroundStaleChecks24hCount,
      staleChecks48hCount: pricing.staleChecks48hCount,
      missingToday: pricing.missingToday.slice(0, 50),
      staleChecks24h: pricing.staleChecks24h.slice(0, 50),
      criticalStaleChecks24h: pricing.criticalStaleChecks24h.slice(0, 50),
      backgroundStaleChecks24h: pricing.backgroundStaleChecks24h.slice(0, 50),
      buildCheckoutReadiness,
      adminOverrides: activePricingOverrides,
      adminOverrideBackedChecks: overrideBackedPriceChecks,
    },
    payments: {
      recentFailedWebhookEvents,
      paidEmailRetries,
      ambiguousPaymentOrders,
      paymentConfirmedUnfulfilledOrders,
      staleFulfillmentOrders,
      recentAdminOrderActions,
    },
    commerceInvariants,
    quotes: {
      statusCounts: Object.fromEntries(quoteStatusCounts.map((row) => [row.status, row.cnt])),
      needingAttention: quoteRequestsNeedingAttention,
    },
  };
}
