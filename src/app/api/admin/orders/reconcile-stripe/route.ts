import { NextResponse } from "next/server";
import { recordAdminOrderAction } from "@/lib/db";
import { checkRateLimit, requestOriginIsAllowed } from "@/lib/request-utils";
import { requireAdminAccess } from "@/lib/server/admin-auth";
import { reconcileOrderWithStripeCheckoutSession } from "@/lib/server/order-reconciliation";
import { logEvent, requestIdFromHeaders, safeErrorReason } from "@/lib/server/structured-log";
import { getStripe, stripeRequestIdFromError } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReconcileBody = {
  orderId?: unknown;
};

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

  const rateLimitKey = auth.actor === "session" ? `admin:stripe-reconcile:${auth.userId}` : "admin:stripe-reconcile:bearer";
  if (!(await checkRateLimit(rateLimitKey, 20, 60_000))) {
    return NextResponse.json({ message: "Too many requests. Please try again later." }, { status: 429 });
  }

  const body = (await request.json().catch(() => ({}))) as ReconcileBody;
  const orderId = Number.parseInt(String(body.orderId ?? ""), 10);
  if (!Number.isFinite(orderId) || orderId <= 0) {
    return NextResponse.json({ message: "Invalid order ID." }, { status: 400 });
  }

  try {
    const stripe = getStripe();
    const result = await reconcileOrderWithStripeCheckoutSession({
      orderId,
      retrieveCheckoutSession: (checkoutSessionId) => stripe.checkout.sessions.retrieve(checkoutSessionId),
    });
    await recordAdminOrderAction({
      orderId,
      action: "stripe_reconcile",
      actorUserId: auth.actor === "session" ? auth.userId ?? null : null,
      result: result.action,
      message: result.message,
      stripeRequestId: result.stripeRequestId,
    }).catch(() => null);

    logEvent({
      level: result.ok && result.action !== "validation_failed" ? "info" : "warn",
      event: "admin_stripe_order_reconcile_result",
      area: "admin",
      requestId,
      stripeRequestId: result.stripeRequestId,
      orderId,
      status: result.action,
      count: result.mutated ? 1 : 0,
      durationMs: Date.now() - startedAt,
    });

    const status = result.ok ? 200 : result.action === "order_not_found" ? 404 : result.action === "missing_checkout_session" ? 409 : 400;
    return NextResponse.json(result, { status });
  } catch (error) {
    await recordAdminOrderAction({
      orderId,
      action: "stripe_reconcile",
      actorUserId: auth.actor === "session" ? auth.userId ?? null : null,
      result: "error",
      message: safeErrorReason(error, "Stripe reconciliation failed."),
      stripeRequestId: stripeRequestIdFromError(error),
    }).catch(() => null);
    logEvent({
      level: "error",
      event: "admin_stripe_order_reconcile_failed",
      area: "admin",
      requestId,
      stripeRequestId: stripeRequestIdFromError(error),
      orderId,
      reason: safeErrorReason(error, "Stripe reconciliation failed."),
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ message: "Stripe reconciliation failed." }, { status: 502 });
  }
}
