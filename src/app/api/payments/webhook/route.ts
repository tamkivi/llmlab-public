import { NextResponse } from "next/server";
import Stripe from "stripe";
import {
  getOrderById,
  markStripeWebhookEventFailed,
  markStripeWebhookEventProcessed,
  markOrderCanceledFromCheckoutSession,
  markOrderFailedFromCheckoutSession,
  reserveStripeWebhookEvent,
  setOrderCheckoutSession,
} from "@/lib/db";
import { checkRateLimit, clientRateLimitKey } from "@/lib/request-utils";
import { getCheckoutAvailability } from "@/lib/server/checkout-availability";
import { fulfillPaidCheckoutSession } from "@/lib/server/payment-fulfillment";
import { logEvent, requestIdFromHeaders, safeErrorReason } from "@/lib/server/structured-log";
import { getStripe } from "@/lib/stripe";

export const runtime = "nodejs";

type SessionVerification =
  | { ok: true; order: NonNullable<Awaited<ReturnType<typeof getOrderById>>>; recoveredOrphanSession: boolean }
  | { ok: false; reason: string };

function isCheckoutSessionEvent(event: Stripe.Event): event is Stripe.Event & { data: { object: Stripe.Checkout.Session } } {
  return event.type === "checkout.session.completed"
    || event.type === "checkout.session.async_payment_succeeded"
    || event.type === "checkout.session.expired"
    || event.type === "checkout.session.async_payment_failed";
}

function isPaidSessionEvent(eventType: string, session: Stripe.Checkout.Session): boolean {
  return (eventType === "checkout.session.completed" || eventType === "checkout.session.async_payment_succeeded")
    && session.payment_status === "paid";
}

function metadataOrderId(session: Stripe.Checkout.Session): number | null {
  const orderId = Number.parseInt(session.metadata?.order_id ?? "", 10);
  return Number.isFinite(orderId) && orderId > 0 ? orderId : null;
}

function logRecoveredOrphanSession({
  requestId,
  stripeEventId,
  orderId,
  eventType,
}: {
  requestId: string | null;
  stripeEventId: string;
  orderId: number;
  eventType: string;
}) {
  logEvent({
    level: "warn",
    event: "webhook_orphan_session_recovered",
    area: "stripe_webhook",
    requestId,
    stripeEventId,
    orderId,
    reason: eventType,
  });
}

async function verifyCheckoutSessionForOrder(session: Stripe.Checkout.Session): Promise<SessionVerification> {
  const orderId = Number.parseInt(session.metadata?.order_id ?? "", 10);
  if (!Number.isFinite(orderId) || orderId <= 0) {
    return { ok: false, reason: "Missing or invalid order metadata." };
  }

  const order = await getOrderById(orderId);
  if (!order) {
    return { ok: false, reason: "Order not found." };
  }

  const metadataUserId = Number.parseInt(session.metadata?.user_id ?? "", 10);
  const metadataItemId = Number.parseInt(session.metadata?.order_item_id ?? "", 10);
  if (metadataUserId !== order.user_id) {
    return { ok: false, reason: "Session user metadata mismatch." };
  }
  if (session.metadata?.order_item_type !== order.order_item_type || metadataItemId !== order.order_item_id) {
    return { ok: false, reason: "Session item metadata mismatch." };
  }
  if (session.mode !== "payment") {
    return { ok: false, reason: "Session mode mismatch." };
  }
  if (session.currency !== order.currency) {
    return { ok: false, reason: "Session currency mismatch." };
  }
  if (typeof session.amount_total !== "number" || session.amount_total !== order.amount_eur_cents) {
    return { ok: false, reason: "Session amount mismatch." };
  }

  if (order.stripe_checkout_session_id === session.id) {
    return { ok: true, order, recoveredOrphanSession: false };
  }

  if (order.stripe_checkout_session_id) {
    return { ok: false, reason: "Session ID mismatch." };
  }

  if (order.status === "PAID" || order.fulfilled_at) {
    return { ok: false, reason: "Order is already fulfilled without this checkout session." };
  }

  if (order.status !== "PENDING" && order.status !== "CHECKOUT_CREATED") {
    return { ok: false, reason: "Order is not recoverable." };
  }

  // Recovery only runs after Stripe signature verification and after metadata,
  // amount, currency, and mode all match the server-side order record.
  const linked = await setOrderCheckoutSession({ orderId: order.id, checkoutSessionId: session.id });
  if (linked) {
    const recovered = await getOrderById(order.id);
    return { ok: true, order: recovered ?? order, recoveredOrphanSession: true };
  }

  const raced = await getOrderById(order.id);
  if (raced?.stripe_checkout_session_id === session.id) {
    return { ok: true, order: raced, recoveredOrphanSession: true };
  }

  return { ok: false, reason: "Session ID mismatch." };
}

export async function POST(request: Request) {
  const requestId = requestIdFromHeaders(request.headers);
  const startedAt = Date.now();
  if (!(await checkRateLimit(clientRateLimitKey(request, "stripe-webhook"), 600, 60_000))) {
    return NextResponse.json({ message: "Too many requests. Please try again later." }, { status: 429 });
  }

  const checkoutAvailability = getCheckoutAvailability();
  if (!checkoutAvailability.available) {
    logEvent({
      level: "error",
      event: "webhook_rejected",
      area: "stripe_webhook",
      requestId,
      reason: checkoutAvailability.reason ?? "checkout_unavailable",
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ message: "Webhook Stripe configuration is not safe for this deployment." }, { status: 503 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret || !webhookSecret.startsWith("whsec_")) {
    logEvent({
      level: "error",
      event: "webhook_rejected",
      area: "stripe_webhook",
      requestId,
      reason: "webhook_secret_missing",
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ message: "Webhook is not configured." }, { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    logEvent({
      level: "warn",
      event: "webhook_rejected",
      area: "stripe_webhook",
      requestId,
      reason: "stripe_signature_missing",
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ message: "Missing Stripe signature." }, { status: 400 });
  }

  let reservedEventId: string | null = null;

  try {
    const payload = await request.text();
    const stripe = getStripe();
    const event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    const reservation = await reserveStripeWebhookEvent(event.id, event.type);
    if (reservation === "duplicate") {
      logEvent({
        level: "info",
        event: "webhook_duplicate_event",
        area: "stripe_webhook",
        requestId,
        stripeEventId: event.id,
        reason: event.type,
        durationMs: Date.now() - startedAt,
      });
      if (isCheckoutSessionEvent(event) && isPaidSessionEvent(event.type, event.data.object)) {
        const verification = await verifyCheckoutSessionForOrder(event.data.object);
        if (verification.ok) {
          if (verification.recoveredOrphanSession) {
            logRecoveredOrphanSession({
              requestId,
              stripeEventId: event.id,
              orderId: verification.order.id,
              eventType: event.type,
            });
          }
          const fulfillment = await fulfillPaidCheckoutSession({
            checkoutSessionId: event.data.object.id,
            paymentIntentId: typeof event.data.object.payment_intent === "string" ? event.data.object.payment_intent : null,
          });
          logEvent({
            level: "info",
            event: "webhook_duplicate_fulfillment_checked",
            area: "stripe_webhook",
            requestId,
            stripeEventId: event.id,
            orderId: verification.order.id,
            status: fulfillment.fulfilled ? "fulfilled" : fulfillment.alreadyPaid ? "already_paid" : "not_fulfilled",
          });
        }
      }
      return NextResponse.json({ received: true, duplicate: true });
    }
    if (reservation === "in_progress") {
      logEvent({
        level: "info",
        event: "webhook_idempotency_in_progress",
        area: "stripe_webhook",
        requestId,
        stripeEventId: event.id,
        reason: event.type,
      });
      return NextResponse.json({ message: "Webhook event is already being processed." }, { status: 409 });
    }
    reservedEventId = event.id;

    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.payment_status !== "paid") {
        await markStripeWebhookEventProcessed(event.id);
        logEvent({
          level: "info",
          event: "webhook_ignored",
          area: "stripe_webhook",
          requestId,
          stripeEventId: event.id,
          orderId: metadataOrderId(session),
          reason: "payment_status_not_paid",
          status: session.payment_status ?? null,
          durationMs: Date.now() - startedAt,
        });
        return NextResponse.json({ received: true, paymentStatus: session.payment_status ?? null });
      }

      const verification = await verifyCheckoutSessionForOrder(session);
      if (!verification.ok) {
        await markStripeWebhookEventFailed(event.id, verification.reason);
        logEvent({
          level: "warn",
          event: "webhook_rejected",
          area: "stripe_webhook",
          requestId,
          stripeEventId: event.id,
          orderId: metadataOrderId(session),
          reason: verification.reason,
          durationMs: Date.now() - startedAt,
        });
        return NextResponse.json({ message: verification.reason }, { status: 400 });
      }

      if (verification.recoveredOrphanSession) {
        logRecoveredOrphanSession({
          requestId,
          stripeEventId: event.id,
          orderId: verification.order.id,
          eventType: event.type,
        });
      }

      const fulfillment = await fulfillPaidCheckoutSession({
        checkoutSessionId: session.id,
        paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
      });
      logEvent({
        level: "info",
        event: "webhook_order_fulfilled",
        area: "stripe_webhook",
        requestId,
        stripeEventId: event.id,
        orderId: verification.order.id,
        status: fulfillment.fulfilled ? "fulfilled" : fulfillment.alreadyPaid ? "already_paid" : "not_fulfilled",
        durationMs: Date.now() - startedAt,
      });
    }

    if (event.type === "checkout.session.expired") {
      const session = event.data.object as Stripe.Checkout.Session;
      const verification = await verifyCheckoutSessionForOrder(session);
      if (!verification.ok) {
        await markStripeWebhookEventFailed(event.id, verification.reason);
        logEvent({
          level: "warn",
          event: "webhook_rejected",
          area: "stripe_webhook",
          requestId,
          stripeEventId: event.id,
          orderId: metadataOrderId(session),
          reason: verification.reason,
          durationMs: Date.now() - startedAt,
        });
        return NextResponse.json({ message: verification.reason }, { status: 400 });
      }
      if (verification.recoveredOrphanSession) {
        logRecoveredOrphanSession({
          requestId,
          stripeEventId: event.id,
          orderId: verification.order.id,
          eventType: event.type,
        });
      }
      await markOrderCanceledFromCheckoutSession(session.id);
      logEvent({
        level: "info",
        event: "webhook_order_canceled",
        area: "stripe_webhook",
        requestId,
        stripeEventId: event.id,
        orderId: verification.order.id,
        durationMs: Date.now() - startedAt,
      });
    }

    if (event.type === "checkout.session.async_payment_failed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const verification = await verifyCheckoutSessionForOrder(session);
      if (!verification.ok) {
        await markStripeWebhookEventFailed(event.id, verification.reason);
        logEvent({
          level: "warn",
          event: "webhook_rejected",
          area: "stripe_webhook",
          requestId,
          stripeEventId: event.id,
          orderId: metadataOrderId(session),
          reason: verification.reason,
          durationMs: Date.now() - startedAt,
        });
        return NextResponse.json({ message: verification.reason }, { status: 400 });
      }
      if (verification.recoveredOrphanSession) {
        logRecoveredOrphanSession({
          requestId,
          stripeEventId: event.id,
          orderId: verification.order.id,
          eventType: event.type,
        });
      }
      await markOrderFailedFromCheckoutSession({
        checkoutSessionId: session.id,
        paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
      });
      logEvent({
        level: "warn",
        event: "webhook_order_failed",
        area: "stripe_webhook",
        requestId,
        stripeEventId: event.id,
        orderId: verification.order.id,
        reason: "async_payment_failed",
        durationMs: Date.now() - startedAt,
      });
    }

    if (!isCheckoutSessionEvent(event)) {
      logEvent({
        level: "info",
        event: "webhook_ignored",
        area: "stripe_webhook",
        requestId,
        stripeEventId: event.id,
        reason: event.type,
        durationMs: Date.now() - startedAt,
      });
    }
    await markStripeWebhookEventProcessed(event.id);
    return NextResponse.json({ received: true });
  } catch (error) {
    const reason = safeErrorReason(error, "Webhook handling failed.");
    if (reservedEventId) {
      await markStripeWebhookEventFailed(reservedEventId, reason).catch(() => null);
    }
    logEvent({
      level: "error",
      event: "webhook_handling_failed",
      area: "stripe_webhook",
      requestId,
      stripeEventId: reservedEventId,
      reason,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ message: "Webhook handling failed." }, { status: 400 });
  }
}
