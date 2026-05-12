import { NextResponse } from "next/server";
import { updateQuoteRequestForAdmin } from "@/lib/db";
import { checkRateLimit, requestOriginIsAllowed } from "@/lib/request-utils";
import { requireAdminAccess } from "@/lib/server/admin-auth";
import { logEvent, requestIdFromHeaders } from "@/lib/server/structured-log";

export const dynamic = "force-dynamic";

type UpdateBody = {
  quoteRequestId?: unknown;
  status?: unknown;
  operatorNote?: unknown;
};

export async function PATCH(request: Request) {
  const requestId = requestIdFromHeaders(request.headers);
  const auth = await requireAdminAccess(request);
  if (!auth.ok) {
    return NextResponse.json({ message: "Admin access required." }, { status: auth.status });
  }

  if (auth.actor === "session" && !requestOriginIsAllowed(request)) {
    return NextResponse.json({ message: "Request origin is not allowed." }, { status: 403 });
  }

  const rateLimitKey = auth.actor === "session" ? `admin:quote-update:${auth.userId}` : "admin:quote-update:bearer";
  if (!(await checkRateLimit(rateLimitKey, 40, 60_000))) {
    return NextResponse.json({ message: "Too many requests. Please try again later." }, { status: 429 });
  }

  const body = (await request.json().catch(() => ({}))) as UpdateBody;
  const quoteRequestId = Number.parseInt(String(body.quoteRequestId ?? ""), 10);
  const result = await updateQuoteRequestForAdmin({
    id: quoteRequestId,
    status: body.status === undefined ? undefined : String(body.status),
    operatorNote: body.operatorNote === undefined ? undefined : String(body.operatorNote),
  });

  if (!result.ok) {
    logEvent({
      level: "warn",
      event: "quote_request_update_rejected",
      area: "admin",
      requestId,
      reason: result.message,
      itemId: Number.isFinite(quoteRequestId) ? quoteRequestId : undefined,
    });
    return NextResponse.json({ message: result.message }, { status: 400 });
  }

  logEvent({
    level: "info",
    event: "quote_request_updated",
    area: "admin",
    requestId,
    reason: result.quoteRequest.status,
    itemType: result.quoteRequest.product_type,
    itemId: result.quoteRequest.id,
  });

  return NextResponse.json({
    ok: true,
    quoteRequest: {
      id: result.quoteRequest.id,
      status: result.quoteRequest.status,
      operatorNote: result.quoteRequest.operator_note,
      contactedAt: result.quoteRequest.contacted_at,
      updatedAt: result.quoteRequest.updated_at,
    },
  });
}
