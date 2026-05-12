import "server-only";
import {
  claimOrderAdminEmailSend,
  claimOrderCustomerEmailSend,
  getOrderByCheckoutSession,
  getPaidOrderEmailPayloadByCheckoutSession,
  markOrderAdminEmailSent,
  markOrderCustomerEmailSent,
  markOrderPaidForFulfillment,
  releaseOrderAdminEmailSend,
  releaseOrderCustomerEmailSend,
  type OrderRecord,
} from "@/lib/db";
import { sendAdminPaymentNotificationEmail, sendPaymentConfirmationEmail } from "@/lib/payment-email";
import { logEvent, safeErrorReason } from "@/lib/server/structured-log";

type FulfillmentResult = {
  fulfilled: boolean;
  alreadyPaid: boolean;
  customerEmailSent: boolean;
  adminEmailSent: boolean;
  customerEmailReason?: string;
  adminEmailReason?: string;
};

type EmailSendResult = {
  sent: boolean;
  reason?: string;
};

export async function fulfillPaidCheckoutSession({
  checkoutSessionId,
  paymentIntentId,
}: {
  checkoutSessionId: string;
  paymentIntentId?: string | null;
}): Promise<FulfillmentResult> {
  let order = await getOrderByCheckoutSession(checkoutSessionId);
  if (!order) {
    return { fulfilled: false, alreadyPaid: false, customerEmailSent: false, adminEmailSent: false };
  }

  if (order.status === "PAID") {
    return sendMissingPaidOrderEmails({ checkoutSessionId, order, fulfilled: false, alreadyPaid: true });
  }

  const fulfillment = await markOrderPaidForFulfillment({ checkoutSessionId, paymentIntentId });
  if (!fulfillment.won) {
    order = await getOrderByCheckoutSession(checkoutSessionId);
    if (order?.status === "PAID") {
      return sendMissingPaidOrderEmails({ checkoutSessionId, order, fulfilled: false, alreadyPaid: true });
    }
    return { fulfilled: false, alreadyPaid: true, customerEmailSent: false, adminEmailSent: false };
  }

  order = await getOrderByCheckoutSession(checkoutSessionId) ?? order;
  return sendMissingPaidOrderEmails({ checkoutSessionId, order, fulfilled: true, alreadyPaid: false });
}

async function sendMissingPaidOrderEmails({
  checkoutSessionId,
  order,
  fulfilled,
  alreadyPaid,
}: {
  checkoutSessionId: string;
  order: OrderRecord;
  fulfilled: boolean;
  alreadyPaid: boolean;
}): Promise<FulfillmentResult> {
  if (order.status !== "PAID") {
    return { fulfilled, alreadyPaid, customerEmailSent: false, adminEmailSent: false };
  }

  const emailPayload = await getPaidOrderEmailPayloadByCheckoutSession(checkoutSessionId);
  if (!emailPayload) {
    return { fulfilled, alreadyPaid, customerEmailSent: false, adminEmailSent: false };
  }

  let customer: EmailSendResult = { sent: false, reason: order.customer_email_sent_at ? "already sent" : "not attempted" };
  let admin: EmailSendResult = { sent: false, reason: order.admin_email_sent_at ? "already sent" : "not attempted" };

  if (!order.customer_email_sent_at && await claimOrderCustomerEmailSend(checkoutSessionId)) {
    logEvent({
      level: "info",
      event: "paid_order_email_retry_attempted",
      area: "email",
      orderId: order.id,
      reason: "customer",
    });
    customer = await sendPaymentConfirmationEmail({
      to: emailPayload.customerEmail,
      orderId: emailPayload.orderId,
      buildName: emailPayload.buildName,
      amountEurCents: emailPayload.amountEurCents,
      createdAt: emailPayload.createdAt,
    }).catch((error) => {
      const reason = safeErrorReason(error, "email failed");
      logEvent({
        level: "warn",
        event: "paid_order_email_retry_failed",
        area: "email",
        orderId: order.id,
        reason: `customer:${reason}`,
      });
      return { sent: false, reason };
    });

    if (customer.sent) {
      await markOrderCustomerEmailSent(checkoutSessionId);
      logEvent({
        level: "info",
        event: "paid_order_email_retry_succeeded",
        area: "email",
        orderId: order.id,
        reason: "customer",
      });
    } else {
      await releaseOrderCustomerEmailSend(checkoutSessionId, customer.reason ?? "email failed");
    }
  }

  if (!order.admin_email_sent_at && await claimOrderAdminEmailSend(checkoutSessionId)) {
    logEvent({
      level: "info",
      event: "paid_order_email_retry_attempted",
      area: "email",
      orderId: order.id,
      reason: "admin",
    });
    admin = await sendAdminPaymentNotificationEmail({
      orderId: emailPayload.orderId,
      buildName: emailPayload.buildName,
      amountEurCents: emailPayload.amountEurCents,
      createdAt: emailPayload.createdAt,
    }).catch((error) => {
      const reason = safeErrorReason(error, "email failed");
      logEvent({
        level: "warn",
        event: "paid_order_email_retry_failed",
        area: "email",
        orderId: order.id,
        reason: `admin:${reason}`,
      });
      return { sent: false, reason };
    });

    if (admin.sent) {
      await markOrderAdminEmailSent(checkoutSessionId);
      logEvent({
        level: "info",
        event: "paid_order_email_retry_succeeded",
        area: "email",
        orderId: order.id,
        reason: "admin",
      });
    } else {
      await releaseOrderAdminEmailSend(checkoutSessionId, admin.reason ?? "email failed");
    }
  }

  if (!admin.sent && admin.reason === "ADMIN_EMAIL missing") {
    logEvent({
      level: "warn",
      event: "paid_order_email_skipped",
      area: "email",
      orderId: order.id,
      reason: "ADMIN_EMAIL missing",
    });
  }

  return {
    fulfilled,
    alreadyPaid,
    customerEmailSent: customer.sent,
    adminEmailSent: admin.sent,
    customerEmailReason: customer.reason,
    adminEmailReason: admin.reason,
  };
}
