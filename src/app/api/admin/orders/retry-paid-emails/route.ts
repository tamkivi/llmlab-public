import { NextResponse } from "next/server";
import {
  getOrderById,
  getPaidOrderEmailRetryCandidate,
  listPaidOrdersMissingEmailNotifications,
} from "@/lib/db";
import { checkRateLimit, requestOriginIsAllowed } from "@/lib/request-utils";
import { requireAdminAccess } from "@/lib/server/admin-auth";
import { fulfillPaidCheckoutSession } from "@/lib/server/payment-fulfillment";
import { logEvent, requestIdFromHeaders, safeErrorReason } from "@/lib/server/structured-log";

export const dynamic = "force-dynamic";

type RetryBody = {
  orderId?: unknown;
  limit?: unknown;
};

type RetryResult = {
  orderId: number;
  checkoutSessionId: string;
  missingBefore: {
    customer: boolean;
    admin: boolean;
  };
  customerEmailSent: boolean;
  adminEmailSent: boolean;
  customerEmailReason?: string;
  adminEmailReason?: string;
};

async function skippedOrder(orderId: number) {
  const order = await getOrderById(orderId);
  if (!order) return { orderId, reason: "not_found" };
  if (order.status !== "PAID") return { orderId, reason: "not_paid" };
  if (!order.stripe_checkout_session_id) return { orderId, reason: "missing_checkout_session" };
  if (order.customer_email_sent_at && order.admin_email_sent_at) return { orderId, reason: "already_complete" };
  return { orderId, reason: "not_retryable" };
}

export async function POST(request: Request) {
  const requestId = requestIdFromHeaders(request.headers);
  const startedAt = Date.now();
  const auth = await requireAdminAccess(request);
  if (!auth.ok) {
    return NextResponse.json({ message: "Admin access required." }, { status: auth.status });
  }

  if (auth.actor === "session" && !requestOriginIsAllowed(request)) {
    return NextResponse.json({ message: "Request origin is not allowed." }, { status: 403 });
  }

  const rateLimitKey = auth.actor === "session" ? `admin:retry-paid-emails:${auth.userId}` : "admin:retry-paid-emails:bearer";
  if (!(await checkRateLimit(rateLimitKey, 20, 60_000))) {
    return NextResponse.json({ message: "Too many requests. Please try again later." }, { status: 429 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as RetryBody;
    const hasOrderId = body.orderId !== undefined;
    const parsedOrderId = hasOrderId ? Number.parseInt(String(body.orderId), 10) : null;
    const orderId = parsedOrderId !== null && Number.isFinite(parsedOrderId) && parsedOrderId > 0 ? parsedOrderId : null;
    const limit = body.limit === undefined ? 20 : Number.parseInt(String(body.limit), 10);
    const candidates = orderId
      ? await getPaidOrderEmailRetryCandidate(orderId).then((candidate) => candidate ? [candidate] : [])
      : hasOrderId
        ? []
        : await listPaidOrdersMissingEmailNotifications(Number.isFinite(limit) ? limit : 20);

    logEvent({
      level: "info",
      event: "admin_paid_email_repair_attempted",
      area: "admin",
      requestId,
      orderId,
      count: candidates.length,
    });

    const skipped = [];
    if (hasOrderId && candidates.length === 0) {
      const skippedResult = orderId ? await skippedOrder(orderId) : { orderId: 0, reason: "invalid_order_id" };
      skipped.push(skippedResult);
      logEvent({
        level: "info",
        event: "admin_paid_email_repair_skipped",
        area: "admin",
        requestId,
        orderId: orderId ?? undefined,
        reason: skippedResult.reason,
      });
    }

    const results: RetryResult[] = [];
    for (const candidate of candidates) {
      const result = await fulfillPaidCheckoutSession({
        checkoutSessionId: candidate.stripe_checkout_session_id,
      });
      results.push({
        orderId: candidate.id,
        checkoutSessionId: candidate.stripe_checkout_session_id,
        missingBefore: {
          customer: candidate.missing_customer_email,
          admin: candidate.missing_admin_email,
        },
        customerEmailSent: result.customerEmailSent,
        adminEmailSent: result.adminEmailSent,
        customerEmailReason: result.customerEmailReason,
        adminEmailReason: result.adminEmailReason,
      });
      logEvent({
        level: result.customerEmailSent || result.adminEmailSent ? "info" : "warn",
        event: "admin_paid_email_repair_result",
        area: "admin",
        requestId,
        orderId: candidate.id,
        status: `customer=${result.customerEmailSent ? "sent" : result.customerEmailReason ?? "not_sent"} admin=${result.adminEmailSent ? "sent" : result.adminEmailReason ?? "not_sent"}`,
      });
    }

    logEvent({
      level: "info",
      event: "admin_paid_email_repair_finished",
      area: "admin",
      requestId,
      orderId,
      count: results.length,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({
      ok: true,
      attempted: results.length,
      results,
      skipped,
    });
  } catch (error) {
    logEvent({
      level: "error",
      event: "admin_paid_email_repair_failed",
      area: "admin",
      requestId,
      reason: safeErrorReason(error),
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ message: "Paid email repair failed." }, { status: 500 });
  }
}
