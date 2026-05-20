import "server-only";
import {
  listOrdersForUser,
  listAllOrdersForAdmin,
  listRecentQuoteRequestsForAdmin,
  getPaidOrderEmailPayloadByCheckoutSession,
  getOrderByCheckoutSessionForUser,
} from "@/lib/db";
import { getAdminOpsDiagnostics } from "@/lib/server/ops-diagnostics";

function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  if (!local || !domain) return "redacted";
  return `${local.slice(0, 2)}***@${domain}`;
}

function safeInitials(name: string): string {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .filter(Boolean)
    .join("");
  return initials || "Provided";
}

function shortRef(value: string | null): string | null {
  if (!value) return null;
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}...${value.slice(-6)}`;
}

function truncateOperationalText(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.length > 140 ? `${trimmed.slice(0, 137)}...` : trimmed;
}

function notePreview(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;
}

export async function getUserOrdersView(userId: number) {
  const rows = await listOrdersForUser(userId);
  return rows.map((order) => ({
    id: order.id,
    buildName: order.build_name,
    amountEur: (order.amount_eur_cents / 100).toFixed(2),
    currency: order.currency,
    status: order.status,
    checkoutSessionId: order.stripe_checkout_session_id,
    createdAt: order.created_at,
  }));
}

export async function getAdminOrdersView() {
  const rows = await listAllOrdersForAdmin();
  return rows.map((order) => ({
    id: order.id,
    userId: order.user_id,
    customerContact: maskEmail(order.user_email),
    buildName: order.build_name,
    amountEur: (order.amount_eur_cents / 100).toFixed(2),
    currency: order.currency,
    status: order.status,
    itemType: order.order_item_type,
    itemId: order.order_item_id,
    checkoutSessionRef: shortRef(order.stripe_checkout_session_id),
    paymentIntentRef: shortRef(order.stripe_payment_intent_id),
    paymentConfirmedAt: order.payment_confirmed_at ?? order.paid_at,
    paidAt: order.paid_at,
    fulfilledAt: order.fulfilled_at,
    fulfilledByUserId: order.fulfilled_by_user_id,
    updatedAt: order.updated_at,
    createdAt: order.created_at,
    customerEmail: {
      sentAt: order.customer_email_sent_at,
      attemptedAt: order.customer_email_send_attempted_at,
      lastError: truncateOperationalText(order.customer_email_last_error),
    },
    adminEmail: {
      sentAt: order.admin_email_sent_at,
      attemptedAt: order.admin_email_send_attempted_at,
      lastError: truncateOperationalText(order.admin_email_last_error),
    },
    canRetryPaidEmails: order.status === "PAID"
      && Boolean(order.stripe_checkout_session_id)
      && (!order.customer_email_sent_at || !order.admin_email_sent_at),
    canReconcileStripe: Boolean(order.stripe_checkout_session_id),
    canMarkFulfilled: order.status === "PAID"
      && Boolean(order.paid_at)
      && Boolean(order.payment_confirmed_at)
      && !order.fulfilled_at,
  }));
}

export async function getAdminQuoteRequestsView() {
  const rows = await listRecentQuoteRequestsForAdmin(20);
  return rows.map((quote) => ({
    id: quote.id,
    contact: maskEmail(quote.customer_email),
    customer: safeInitials(quote.customer_name),
    productType: quote.product_type,
    productId: quote.product_id,
    productName: quote.product_name,
    status: quote.status,
    notePreview: notePreview(quote.operator_note),
    contactedAt: quote.contacted_at,
    createdAt: quote.created_at,
    updatedAt: quote.updated_at,
  }));
}

export async function getAdminOperationsView() {
  const [orders, quotes, diagnostics] = await Promise.all([
    getAdminOrdersView(),
    getAdminQuoteRequestsView(),
    getAdminOpsDiagnostics(),
  ]);
  return { orders, quotes, diagnostics };
}

export async function getCheckoutOrderView(userId: number, sessionId: string) {
  const order = await getOrderByCheckoutSessionForUser({ userId, checkoutSessionId: sessionId });
  if (!order) return null;
  return {
    id: order.id,
    buildName: order.build_name,
    amountEur: (order.amount_eur_cents / 100).toFixed(2),
    status: order.status,
  };
}

export { getPaidOrderEmailPayloadByCheckoutSession };
