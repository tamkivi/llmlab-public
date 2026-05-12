import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/request-utils";
import { getOpsHealthSummary } from "@/lib/server/ops-diagnostics";
import { requireAdminAccess } from "@/lib/server/admin-auth";
import { logEvent, requestIdFromHeaders, safeErrorReason } from "@/lib/server/structured-log";

export const dynamic = "force-dynamic";

function healthDegradationReason(health: Awaited<ReturnType<typeof getOpsHealthSummary>>): string {
  const reasons = [];
  if (!health.pricingFresh) reasons.push("pricing_stale");
  if (!health.checkoutAvailable) reasons.push(health.checkoutUnavailableReason ?? "checkout_unavailable");
  if (health.recentWebhookFailures > 0) reasons.push("webhook_failures");
  if (health.staleWebhookProcessing > 0) reasons.push("webhook_processing_stale");
  if (health.pendingPaidEmailRetries > 0) reasons.push("paid_email_retries_pending");
  if (health.ambiguousPaymentOrders > 0) reasons.push("ambiguous_payment_orders");
  return reasons.join(",") || "unknown";
}

export async function GET(request: Request) {
  const requestId = requestIdFromHeaders(request.headers);
  const auth = await requireAdminAccess(request);
  if (!auth.ok) {
    return NextResponse.json({ message: "Admin access required." }, { status: auth.status });
  }

  const rateLimitKey = auth.actor === "session" ? `admin:health:${auth.userId}` : "admin:health:bearer";
  if (!(await checkRateLimit(rateLimitKey, 30, 60_000))) {
    return NextResponse.json({ message: "Too many requests. Please try again later." }, { status: 429 });
  }

  try {
    const health = await getOpsHealthSummary();
    if (health.status !== "healthy") {
      logEvent({
        level: "warn",
        event: "admin_health_degraded",
        area: "health",
        requestId,
        reason: healthDegradationReason(health),
        status: health.status,
      });
    }
    return NextResponse.json(health, { status: health.status === "healthy" ? 200 : 503 });
  } catch (error) {
    logEvent({
      level: "error",
      event: "admin_health_failed",
      area: "health",
      requestId,
      reason: safeErrorReason(error),
    });
    return NextResponse.json({ status: "degraded", generatedAt: new Date().toISOString() }, { status: 503 });
  }
}
