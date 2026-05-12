import "server-only";
import nodemailer from "nodemailer";
import { escapeHtml, formatEur } from "@/lib/format-eur";
import { logEvent } from "@/lib/server/structured-log";

type PaymentEmailInput = {
  to: string;
  orderId: number;
  buildName: string;
  amountEurCents: number;
  createdAt: string;
};

type QuoteRequestEmailInput = {
  quoteRequestId: number;
  customerEmail: string;
  customerName: string;
  productType: string;
  productName: string;
  message: string;
};

function normalizeEmail(value: unknown): string | null {
  const email = typeof value === "string" ? value.trim() : "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function displayText(value: unknown, fallback: string): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || fallback;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
}

function displayOrderId(value: unknown): string {
  const orderId = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(orderId) && orderId > 0 ? String(orderId) : "unknown";
}

function displayAmount(value: unknown): string {
  const cents = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(cents) && cents >= 0 ? formatEur(cents) : "unknown";
}

function readSmtpConfig() {
  const host = process.env.SMTP_HOST;
  const port = Number.parseInt(process.env.SMTP_PORT ?? "", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM_EMAIL;

  if (!host || !Number.isFinite(port) || !user || !pass || !from) {
    return null;
  }

  return {
    host,
    port,
    user,
    pass,
    from,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
  };
}

export async function sendPaymentConfirmationEmail(input: PaymentEmailInput): Promise<{ sent: boolean; reason?: string }> {
  const config = readSmtpConfig();
  if (!config) {
    return { sent: false, reason: "SMTP config missing" };
  }

  const recipient = normalizeEmail(input.to);
  if (!recipient) {
    logEvent({
      level: "warn",
      event: "paid_order_email_skipped",
      area: "email",
      orderId: input.orderId,
      reason: "recipient_missing",
    });
    return { sent: false, reason: "recipient missing" };
  }

  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  });

  const orderId = displayOrderId(input.orderId);
  const buildName = displayText(input.buildName, "Order item");
  const amount = displayAmount(input.amountEurCents);
  const createdAt = displayText(input.createdAt, "Unavailable");
  const safeBuildName = escapeHtml(buildName);
  const safeOrderId = escapeHtml(orderId);
  const safeCreatedAt = escapeHtml(createdAt);

  await transport.sendMail({
    from: config.from,
    to: recipient,
    subject: `Order #${orderId} payment received`,
    html: `
      <p>Thanks for your order.</p>
      <p><strong>Order ID:</strong> ${safeOrderId}</p>
      <p><strong>Build:</strong> ${safeBuildName}</p>
      <p><strong>Amount:</strong> EUR ${amount}</p>
      <p><strong>Placed at:</strong> ${safeCreatedAt}</p>
      <p>Your payment is confirmed. The planned next steps are: availability check, parts sourcing, assembly, baseline checks and setup, then agreed pickup or local delivery.</p>
      <p>If availability may require a substitution, we will contact you before changing the order. For questions, reply to this email and include Order #${safeOrderId}.</p>
    `,
  });

  return { sent: true };
}

export async function sendAdminPaymentNotificationEmail(input: Omit<PaymentEmailInput, "to">): Promise<{ sent: boolean; reason?: string }> {
  const adminEmail = normalizeEmail(process.env.ADMIN_EMAIL);
  if (!adminEmail) {
    return { sent: false, reason: "ADMIN_EMAIL missing" };
  }

  const config = readSmtpConfig();
  if (!config) {
    return { sent: false, reason: "SMTP config missing" };
  }

  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  });

  const orderId = displayOrderId(input.orderId);
  const buildName = displayText(input.buildName, "Order item");
  const amount = displayAmount(input.amountEurCents);
  const createdAt = displayText(input.createdAt, "Unavailable");
  const safeBuildName = escapeHtml(buildName);
  const safeOrderId = escapeHtml(orderId);
  const safeCreatedAt = escapeHtml(createdAt);

  await transport.sendMail({
    from: config.from,
    to: adminEmail,
    subject: `Paid order #${orderId}: ${buildName}`,
    html: `
      <p>A customer payment was confirmed.</p>
      <p><strong>Order ID:</strong> ${safeOrderId}</p>
      <p><strong>Item:</strong> ${safeBuildName}</p>
      <p><strong>Amount:</strong> EUR ${amount}</p>
      <p><strong>Placed at:</strong> ${safeCreatedAt}</p>
    `,
  });

  return { sent: true };
}

export async function sendPaidOrderEmails(input: PaymentEmailInput): Promise<{
  customer: { sent: boolean; reason?: string };
  admin: { sent: boolean; reason?: string };
}> {
  const customer = await sendPaymentConfirmationEmail(input);
  const admin = await sendAdminPaymentNotificationEmail({
    orderId: input.orderId,
    buildName: input.buildName,
    amountEurCents: input.amountEurCents,
    createdAt: input.createdAt,
  });
  return { customer, admin };
}

export async function sendQuoteRequestAdminEmail(input: QuoteRequestEmailInput): Promise<{ sent: boolean; reason?: string }> {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) {
    return { sent: false, reason: "ADMIN_EMAIL missing" };
  }

  const config = readSmtpConfig();
  if (!config) {
    return { sent: false, reason: "SMTP config missing" };
  }

  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  });

  await transport.sendMail({
    from: config.from,
    to: adminEmail,
    replyTo: input.customerEmail,
    subject: `Quote request #${input.quoteRequestId}: ${input.productName}`,
    html: `
      <p>New quote request received.</p>
      <p><strong>Quote ID:</strong> ${escapeHtml(String(input.quoteRequestId))}</p>
      <p><strong>Customer:</strong> ${escapeHtml(input.customerName)} (${escapeHtml(input.customerEmail)})</p>
      <p><strong>Product:</strong> ${escapeHtml(input.productName)}</p>
      <p><strong>Type:</strong> ${escapeHtml(input.productType)}</p>
      <p><strong>Message:</strong></p>
      <p>${escapeHtml(input.message).replace(/\n/g, "<br>")}</p>
    `,
  });

  return { sent: true };
}
