import { NextResponse } from "next/server";
import { markOrderFulfilledForAdmin, recordAdminOrderAction } from "@/lib/db";
import { checkRateLimit, requestOriginIsAllowed } from "@/lib/request-utils";
import { requireAdminAccess } from "@/lib/server/admin-auth";
import { logEvent, requestIdFromHeaders, safeErrorReason } from "@/lib/server/structured-log";

export const dynamic = "force-dynamic";

type FulfillBody = {
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

  const rateLimitKey = auth.actor === "session" ? `admin:mark-fulfilled:${auth.userId}` : "admin:mark-fulfilled:bearer";
  if (!(await checkRateLimit(rateLimitKey, 20, 60_000))) {
    return NextResponse.json({ message: "Too many requests. Please try again later." }, { status: 429 });
  }

  const body = (await request.json().catch(() => ({}))) as FulfillBody;
  const orderId = Number.parseInt(String(body.orderId ?? ""), 10);
  if (!Number.isFinite(orderId) || orderId <= 0) {
    return NextResponse.json({ message: "Invalid order ID." }, { status: 400 });
  }

  try {
    const result = await markOrderFulfilledForAdmin({
      orderId,
      adminUserId: auth.actor === "session" ? auth.userId ?? null : null,
    });
    const actionResult = result.ok
      ? result.alreadyFulfilled
        ? "already_fulfilled"
        : "fulfilled"
      : result.reason;
    const message = result.ok
      ? result.alreadyFulfilled
        ? "Order was already marked fulfilled."
        : "Order marked physically fulfilled."
      : result.reason === "not_found"
        ? "Order not found."
        : "Only paid and payment-confirmed orders can be fulfilled.";

    await recordAdminOrderAction({
      orderId,
      action: "mark_fulfilled",
      actorUserId: auth.actor === "session" ? auth.userId ?? null : null,
      result: actionResult,
      message,
    }).catch(() => null);

    logEvent({
      level: result.ok ? "info" : "warn",
      event: "admin_order_fulfillment_result",
      area: "admin",
      requestId,
      orderId,
      status: actionResult,
      durationMs: Date.now() - startedAt,
    });

    if (!result.ok) {
      return NextResponse.json({ ok: false, message, reason: result.reason }, { status: result.reason === "not_found" ? 404 : 409 });
    }

    return NextResponse.json({
      ok: true,
      fulfilled: result.fulfilled,
      alreadyFulfilled: result.alreadyFulfilled,
      fulfilledAt: result.fulfilledAt,
      message,
    });
  } catch (error) {
    logEvent({
      level: "error",
      event: "admin_order_fulfillment_failed",
      area: "admin",
      requestId,
      orderId,
      reason: safeErrorReason(error),
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ message: "Fulfillment update failed." }, { status: 500 });
  }
}
