import { NextResponse } from "next/server";
import {
  getOrderByCheckoutSessionForUser,
  markOrderCanceledFromCheckoutSession,
  markOrderFailedFromCheckoutSession,
} from "@/lib/db";
import { formatEur } from "@/lib/format-eur";
import { checkRateLimit, clientRateLimitKey } from "@/lib/request-utils";
import { requireAuth } from "@/lib/server/auth-helpers";
import { fulfillPaidCheckoutSession } from "@/lib/server/payment-fulfillment";
import { logEvent, requestIdFromHeaders, safeErrorReason } from "@/lib/server/structured-log";
import { getStripe } from "@/lib/stripe";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestId = requestIdFromHeaders(request.headers);
  const startedAt = Date.now();
  if (!(await checkRateLimit(clientRateLimitKey(request, "session-status"), 120, 60_000))) {
    return NextResponse.json({ message: "Too many requests. Please try again later." }, { status: 429 });
  }

  const auth = await requireAuth();
  if (!auth) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }
  if (!(await checkRateLimit(`session-status:user:${auth.user.id}`, 60, 60_000))) {
    return NextResponse.json({ message: "Too many requests. Please try again later." }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.json({ message: "Missing session_id." }, { status: 400 });
  }

  const order = await getOrderByCheckoutSessionForUser({
    userId: auth.user.id,
    checkoutSessionId: sessionId,
  });

  if (!order) {
    return NextResponse.json({ message: "Order not found." }, { status: 404 });
  }

  let session;
  try {
    const stripe = getStripe();
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (error) {
    logEvent({
      level: "warn",
      event: "session_status_reconcile_failed",
      area: "session_status",
      requestId,
      reason: safeErrorReason(error, "stripe_session_retrieve_failed"),
      orderId: order.id,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ message: "Unable to verify payment session." }, { status: 502 });
  }
  const metadataUserId = Number.parseInt(session.metadata?.user_id ?? "", 10);
  if (!Number.isFinite(metadataUserId) || metadataUserId !== auth.user.id) {
    return NextResponse.json({ message: "Session ownership mismatch." }, { status: 403 });
  }
  const metadataOrderId = Number.parseInt(session.metadata?.order_id ?? "", 10);
  const metadataItemId = Number.parseInt(session.metadata?.order_item_id ?? "", 10);
  if (metadataOrderId !== order.id || session.metadata?.order_item_type !== order.order_item_type || metadataItemId !== order.order_item_id) {
    return NextResponse.json({ message: "Session metadata mismatch." }, { status: 403 });
  }

  if (session.mode !== "payment") {
    return NextResponse.json({ message: "Session mode mismatch." }, { status: 409 });
  }
  if (session.currency !== order.currency) {
    return NextResponse.json({ message: "Session currency mismatch." }, { status: 409 });
  }
  if (typeof session.amount_total !== "number" || session.amount_total !== order.amount_eur_cents) {
    return NextResponse.json({ message: "Session amount mismatch." }, { status: 409 });
  }

  if (session.payment_status === "paid") {
    const fulfillment = await fulfillPaidCheckoutSession({
      checkoutSessionId: session.id,
      paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
    });
    logEvent({
      level: "info",
      event: "session_status_paid_reconciled",
      area: "session_status",
      requestId,
      orderId: order.id,
      status: fulfillment.fulfilled ? "fulfilled" : fulfillment.alreadyPaid ? "already_paid" : "not_fulfilled",
      durationMs: Date.now() - startedAt,
    });
  } else if (session.status === "expired" && order.status !== "PAID") {
    await markOrderCanceledFromCheckoutSession(session.id);
    logEvent({
      level: "info",
      event: "session_status_expired_reconciled",
      area: "session_status",
      requestId,
      orderId: order.id,
      status: "canceled",
      durationMs: Date.now() - startedAt,
    });
  } else if (session.payment_status === "unpaid" && session.status === "complete" && order.status !== "PAID") {
    await markOrderFailedFromCheckoutSession({
      checkoutSessionId: session.id,
      paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
    });
    logEvent({
      level: "warn",
      event: "session_status_unpaid_complete_reconciled",
      area: "session_status",
      requestId,
      orderId: order.id,
      status: "failed",
      durationMs: Date.now() - startedAt,
    });
  }

  const refreshed = await getOrderByCheckoutSessionForUser({
    userId: auth.user.id,
    checkoutSessionId: sessionId,
  });

  const final = refreshed ?? order;
  return NextResponse.json({
    order: {
      id: final.id,
      buildName: final.build_name,
      amountEur: formatEur(final.amount_eur_cents),
      status: final.status,
      createdAt: final.created_at,
    },
  });
}
