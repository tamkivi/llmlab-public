import { NextResponse } from "next/server";
import { createQuoteRequest, type QuoteRequestProductType } from "@/lib/db";
import { sendQuoteRequestAdminEmail } from "@/lib/payment-email";
import {
  checkRateLimit,
  clientIpFromHeaders,
  clientRateLimitKey,
  readJsonBodyWithLimit,
  requestOriginIsAllowed,
} from "@/lib/request-utils";
import { logEvent, requestIdFromHeaders, safeErrorReason } from "@/lib/server/structured-log";

export const runtime = "nodejs";

const MAX_QUOTE_BODY_BYTES = 8 * 1024;
const QUOTE_DEDUPE_WINDOW_MS = 15 * 60_000;

type QuoteRequestBody = {
  customerEmail?: unknown;
  customerName?: unknown;
  productType?: unknown;
  productId?: unknown;
  message?: unknown;
  website?: unknown;
  companyWebsite?: unknown;
  homepage?: unknown;
  faxNumber?: unknown;
  _gotcha?: unknown;
};

function parseProductType(value: unknown): QuoteRequestProductType | null {
  const key = String(value ?? "").trim().toLowerCase();
  if (key === "mac_system" || key === "external_gpu_enclosure" || key === "mac_egpu_build") {
    return key;
  }
  return null;
}

function normalizeQuoteText(value: unknown, maxLength: number): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function isValidQuoteEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function hasHoneypotValue(body: QuoteRequestBody | null): boolean {
  if (!body) return false;
  return [body.website, body.companyWebsite, body.homepage, body.faxNumber, body._gotcha]
    .some((value) => typeof value === "string" && value.trim().length > 0);
}

export async function POST(request: Request) {
  const requestId = requestIdFromHeaders(request.headers);
  const ipAddress = clientIpFromHeaders(request.headers);
  if (!(await checkRateLimit(clientRateLimitKey(request, "quote-request"), 10, 60_000))) {
    return NextResponse.json({ message: "Too many requests. Please try again later." }, { status: 429 });
  }

  if (!requestOriginIsAllowed(request)) {
    return NextResponse.json({ message: "Request origin is not allowed." }, { status: 403 });
  }

  const parsedBody = await readJsonBodyWithLimit<QuoteRequestBody>(request, MAX_QUOTE_BODY_BYTES);
  if (!parsedBody.ok) {
    return NextResponse.json({ message: parsedBody.message }, { status: parsedBody.status });
  }

  const body = parsedBody.data && typeof parsedBody.data === "object" ? parsedBody.data : null;
  if (hasHoneypotValue(body)) {
    logEvent({
      level: "warn",
      event: "quote_request_honeypot_blocked",
      area: "quote_request",
      requestId,
      reason: "honeypot_field_present",
    });
    return NextResponse.json({ ok: true, quoteRequestId: null }, { status: 202 });
  }

  const productType = parseProductType(body?.productType);
  const productId = Number.parseInt(String(body?.productId ?? ""), 10);

  if (!productType) {
    return NextResponse.json({ message: "Invalid quote product type." }, { status: 400 });
  }
  if (!Number.isFinite(productId) || productId <= 0) {
    return NextResponse.json({ message: "Invalid quote product." }, { status: 400 });
  }

  const normalizedEmail = String(body?.customerEmail ?? "").trim().toLowerCase();
  const customerName = normalizeQuoteText(body?.customerName, 120);
  const message = normalizeQuoteText(body?.message, 2000);
  if (!isValidQuoteEmail(normalizedEmail)) {
    return NextResponse.json({ message: "Please enter a valid email address." }, { status: 400 });
  }
  if (customerName.length < 2) {
    return NextResponse.json({ message: "Please enter your name." }, { status: 400 });
  }
  if (message.length < 10) {
    return NextResponse.json({ message: "Please include a short description of your use case." }, { status: 400 });
  }

  const emailDedupeKey = `quote-request:dedupe:email:${normalizedEmail}:${productType}:${productId}`;
  if (!(await checkRateLimit(emailDedupeKey, 1, QUOTE_DEDUPE_WINDOW_MS))) {
    logEvent({
      level: "info",
      event: "quote_request_duplicate_suppressed",
      area: "quote_request",
      requestId,
      reason: "email_product_dedupe",
      itemType: productType,
      itemId: productId,
    });
    return NextResponse.json({ ok: true, duplicate: true }, { status: 202 });
  }

  // Rapid duplicate suppression: one email/product per 15 minutes and, when a
  // trustworthy platform IP is available, at most three quote emails per product.
  // Later requests outside the window are accepted normally.
  if (ipAddress) {
    const ipDedupeKey = `quote-request:dedupe:ip:${ipAddress}:${productType}:${productId}`;
    if (!(await checkRateLimit(ipDedupeKey, 3, QUOTE_DEDUPE_WINDOW_MS))) {
      logEvent({
        level: "info",
        event: "quote_request_duplicate_suppressed",
        area: "quote_request",
        requestId,
        reason: "ip_product_dedupe",
        itemType: productType,
        itemId: productId,
      });
      return NextResponse.json({ ok: true, duplicate: true }, { status: 202 });
    }
  }

  const result = await createQuoteRequest({
    customerEmail: normalizedEmail,
    customerName,
    productType,
    productId,
    message,
  });

  if (!result.ok) {
    return NextResponse.json({ message: result.message }, { status: 400 });
  }

  const emailResult = await sendQuoteRequestAdminEmail({
    quoteRequestId: result.quoteRequest.id,
    customerEmail: result.quoteRequest.customer_email,
    customerName: result.quoteRequest.customer_name,
    productType: result.quoteRequest.product_type,
    productName: result.quoteRequest.product_name,
    message: result.quoteRequest.message,
  }).catch((error) => {
    logEvent({
      level: "warn",
      event: "quote_request_email_failed",
      area: "email",
      requestId,
      reason: safeErrorReason(error, "email failed"),
      itemType: result.quoteRequest.product_type,
      itemId: result.quoteRequest.product_id,
    });
    return { sent: false, reason: "email failed" };
  });

  if (!emailResult.sent && emailResult.reason === "ADMIN_EMAIL missing") {
    logEvent({
      level: "warn",
      event: "quote_request_email_skipped",
      area: "email",
      requestId,
      reason: "ADMIN_EMAIL missing",
      itemType: result.quoteRequest.product_type,
      itemId: result.quoteRequest.product_id,
    });
  }

  return NextResponse.json({
    ok: true,
    quoteRequestId: result.quoteRequest.id,
  }, { status: 201 });
}
