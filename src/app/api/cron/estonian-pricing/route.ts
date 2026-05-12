import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { getAdapter, initDb } from "@/lib/db";
import { refreshEstonianMarketPricing } from "@/lib/server/estonian-pricing-service";
import type { RefreshSummary } from "@/lib/server/estonian-pricing-service";
import { logEvent, requestIdFromHeaders, safeErrorReason } from "@/lib/server/structured-log";

export const runtime = "nodejs";
export const maxDuration = 300;

const PRICING_CRON_LOCK_KEY = 742001;

function secureCompare(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

export function isPricingCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return false;
  }

  const authorization = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!authorization.startsWith(prefix)) {
    return false;
  }

  return secureCompare(authorization.slice(prefix.length), secret);
}

export function pricingCronHttpStatus(summary: RefreshSummary): number {
  if (summary.status === "SUCCESS") return 200;
  if (summary.updated === 0 || summary.historyRowsInserted + summary.historyRowsUpdated === 0) return 503;
  return 207;
}

export function pricingCronResponseBody(summary: RefreshSummary) {
  const historyRowsWritten = summary.historyRowsInserted + summary.historyRowsUpdated;
  const degradedReasons = [
    summary.updated === 0 ? "no_trusted_rows_written" : "",
    historyRowsWritten === 0 ? "no_history_rows_written" : "",
    summary.skipped > 0 ? "retailer_lookup_skips" : "",
    summary.failed > 0 ? "write_failures" : "",
    summary.staleCount > 0 ? "pricing_still_stale" : "",
    summary.expectedVsProcessedMismatchWarning ? "expected_processed_mismatch" : "",
  ].filter(Boolean);

  return {
    ok: summary.status === "SUCCESS",
    status: summary.status === "SUCCESS" ? "success" : "partial",
    degraded: summary.status !== "SUCCESS",
    degradedReasons,
    trackableItems: summary.trackableItems,
    healthCriticalItems: summary.healthCriticalItems,
    backgroundTrackableItems: summary.backgroundTrackableItems,
    processedItems: summary.processedItems,
    processingLimit: summary.processingLimit,
    expectedVsProcessedMismatchWarning: summary.expectedVsProcessedMismatchWarning,
    processed: summary.checked,
    updated: summary.updated,
    skipped: summary.skipped,
    skippedByReason: summary.skippedByReason,
    sampleSkippedItems: summary.skippedItems.slice(0, 10).map((item) => ({
      category: item.category,
      item_id: item.itemId,
      name: item.name,
      query: item.query,
      reason: item.reason,
      sourceReasonCounts: item.sourceReasonCounts,
    })),
    failed: summary.failed,
    historyInserted: summary.historyRowsInserted,
    historyUpdated: summary.historyRowsUpdated,
    staleCount: summary.staleCount,
    backgroundStaleCount: summary.backgroundStaleCount,
    lowSampleItems: summary.lowSampleItems.length,
    adminOverrideItems: summary.adminOverrideItems,
    startedAt: summary.startedAt,
    finishedAt: summary.finishedAt,
  };
}

export async function GET(request: Request) {
  const requestId = requestIdFromHeaders(request.headers);
  const startedAt = Date.now();
  if (!isPricingCronAuthorized(request)) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    await initDb();
    const lock = await getAdapter().tryWithAdvisoryLock(PRICING_CRON_LOCK_KEY, async () => {
      logEvent({
        level: "info",
        event: "pricing_cron_started",
        area: "pricing",
        requestId,
      });
      const summary = await refreshEstonianMarketPricing();
      const responseBody = pricingCronResponseBody(summary);
      logEvent({
        level: summary.status === "SUCCESS" ? "info" : "warn",
        event: "pricing_cron_finished",
        area: "pricing",
        requestId,
        status: responseBody.status,
        count: summary.checked,
        durationMs: Date.now() - startedAt,
        reason: `updated=${summary.updated} skipped=${summary.skipped} failed=${summary.failed} history=${summary.historyRowsInserted + summary.historyRowsUpdated} stale=${summary.staleCount}`,
      });
      return NextResponse.json(responseBody, { status: pricingCronHttpStatus(summary) });
    });

    if (!lock.acquired) {
      logEvent({
        level: "warn",
        event: "pricing_cron_overlap_skipped",
        area: "pricing",
        requestId,
        reason: "pricing_refresh_already_running",
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json({
        ok: true,
        status: "skipped",
        skipped: true,
        reason: "pricing_refresh_already_running",
      }, { status: 202 });
    }

    return lock.result;
  } catch (error) {
    const message = safeErrorReason(error, "Price refresh failed.");
    logEvent({
      level: "error",
      event: "pricing_cron_failed",
      area: "pricing",
      requestId,
      reason: message,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
