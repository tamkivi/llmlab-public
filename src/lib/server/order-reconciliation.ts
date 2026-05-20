import "server-only";
import Stripe from "stripe";
import {
  getOrderById,
  markOrderCanceledFromCheckoutSession,
  markOrderFailedFromCheckoutSession,
  type OrderRecord,
} from "@/lib/db";
import { fulfillPaidCheckoutSession } from "@/lib/server/payment-fulfillment";
import { stripeRequestIdFromObject } from "@/lib/stripe";

type RetrieveCheckoutSession = (checkoutSessionId: string) => Promise<Stripe.Checkout.Session>;

export type OrderReconciliationResult = {
  ok: boolean;
  orderId: number;
  action:
    | "paid_reconciled"
    | "already_paid"
    | "canceled_reconciled"
    | "failed_reconciled"
    | "ambiguous_noop"
    | "missing_checkout_session"
    | "order_not_found"
    | "validation_failed";
  mutated: boolean;
  message: string;
  stripeRequestId?: string | null;
  validationErrors?: string[];
  customerEmailSent?: boolean;
  adminEmailSent?: boolean;
};

function metadataInt(value: string | null | undefined): number | null {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function validateSessionForOrder(session: Stripe.Checkout.Session, order: OrderRecord): string[] {
  const errors: string[] = [];
  if (session.id !== order.stripe_checkout_session_id) errors.push("Session ID mismatch.");
  if (session.mode !== "payment") errors.push("Session mode mismatch.");
  if (session.currency !== order.currency || session.currency !== "eur") errors.push("Session currency mismatch.");
  if (typeof session.amount_total !== "number" || session.amount_total !== order.amount_eur_cents) errors.push("Session amount mismatch.");
  if (metadataInt(session.metadata?.order_id) !== order.id) errors.push("Session order metadata mismatch.");
  if (metadataInt(session.metadata?.user_id) !== order.user_id) errors.push("Session user metadata mismatch.");
  if (session.metadata?.order_item_type !== order.order_item_type) errors.push("Session item type metadata mismatch.");
  if (metadataInt(session.metadata?.order_item_id) !== order.order_item_id) errors.push("Session item id metadata mismatch.");
  return errors;
}

function paymentIntentId(session: Stripe.Checkout.Session): string | null {
  return typeof session.payment_intent === "string" ? session.payment_intent : null;
}

export async function reconcileOrderWithStripeCheckoutSession({
  orderId,
  retrieveCheckoutSession,
}: {
  orderId: number;
  retrieveCheckoutSession: RetrieveCheckoutSession;
}): Promise<OrderReconciliationResult> {
  const order = await getOrderById(orderId);
  if (!order) {
    return {
      ok: false,
      orderId,
      action: "order_not_found",
      mutated: false,
      message: "Order not found.",
    };
  }

  if (!order.stripe_checkout_session_id) {
    return {
      ok: false,
      orderId,
      action: "missing_checkout_session",
      mutated: false,
      message: "Order has no stored Stripe Checkout Session.",
    };
  }

  const session = await retrieveCheckoutSession(order.stripe_checkout_session_id);
  const stripeRequestId = stripeRequestIdFromObject(session);
  const validationErrors = validateSessionForOrder(session, order);
  if (validationErrors.length > 0) {
    return {
      ok: false,
      orderId,
      action: "validation_failed",
      mutated: false,
      message: "Stripe session did not match the stored order.",
      stripeRequestId,
      validationErrors,
    };
  }

  if (session.payment_status === "paid") {
    const fulfillment = await fulfillPaidCheckoutSession({
      checkoutSessionId: session.id,
      paymentIntentId: paymentIntentId(session),
    });
    return {
      ok: true,
      orderId,
      action: fulfillment.paymentConfirmed ? "paid_reconciled" : "already_paid",
      mutated: fulfillment.paymentConfirmed,
      message: fulfillment.paymentConfirmed ? "Payment confirmed from Stripe session." : "Order was already paid; missing notifications were checked.",
      stripeRequestId,
      customerEmailSent: fulfillment.customerEmailSent,
      adminEmailSent: fulfillment.adminEmailSent,
    };
  }

  if (session.status === "expired") {
    if (order.status === "PAID" || order.paid_at) {
      return {
        ok: true,
        orderId,
        action: "already_paid",
        mutated: false,
        message: "Order is already paid; expired session was ignored.",
        stripeRequestId,
      };
    }
    if (order.status === "CANCELED") {
      return {
        ok: true,
        orderId,
        action: "canceled_reconciled",
        mutated: false,
        message: "Order was already canceled.",
        stripeRequestId,
      };
    }
    await markOrderCanceledFromCheckoutSession(session.id);
    return {
      ok: true,
      orderId,
      action: "canceled_reconciled",
      mutated: true,
      message: "Expired Stripe session marked order canceled.",
      stripeRequestId,
    };
  }

  if (session.status === "complete" && session.payment_status === "unpaid") {
    if (order.status === "PAID" || order.paid_at) {
      return {
        ok: true,
        orderId,
        action: "already_paid",
        mutated: false,
        message: "Order is already paid; unpaid complete session was ignored.",
        stripeRequestId,
      };
    }
    if (order.status === "FAILED") {
      return {
        ok: true,
        orderId,
        action: "failed_reconciled",
        mutated: false,
        message: "Order was already failed.",
        stripeRequestId,
      };
    }
    await markOrderFailedFromCheckoutSession({
      checkoutSessionId: session.id,
      paymentIntentId: paymentIntentId(session),
    });
    return {
      ok: true,
      orderId,
      action: "failed_reconciled",
      mutated: true,
      message: "Complete unpaid Stripe session marked order failed.",
      stripeRequestId,
    };
  }

  return {
    ok: true,
    orderId,
    action: "ambiguous_noop",
    mutated: false,
    message: `Stripe session is ${session.status ?? "unknown"} with payment status ${session.payment_status}; no order mutation was applied.`,
    stripeRequestId,
  };
}
