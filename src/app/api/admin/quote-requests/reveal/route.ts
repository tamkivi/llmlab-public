import { NextResponse } from "next/server";
import { getQuoteRequestContactForAdmin } from "@/lib/db";
import { checkRateLimit, requestOriginIsAllowed } from "@/lib/request-utils";
import { requireAdminAccess } from "@/lib/server/admin-auth";
import { logEvent, requestIdFromHeaders } from "@/lib/server/structured-log";

export const dynamic = "force-dynamic";

type RevealBody = {
  quoteRequestId?: unknown;
};

export async function POST(request: Request) {
  const requestId = requestIdFromHeaders(request.headers);
  const auth = await requireAdminAccess(request);
  if (!auth.ok) {
    return NextResponse.json({ message: "Admin access required." }, { status: auth.status });
  }
  if (auth.actor !== "session") {
    return NextResponse.json({ message: "Admin session required." }, { status: 403 });
  }
  if (!requestOriginIsAllowed(request)) {
    return NextResponse.json({ message: "Request origin is not allowed." }, { status: 403 });
  }
  if (!(await checkRateLimit(`admin:quote-reveal:${auth.userId}`, 20, 60_000))) {
    return NextResponse.json({ message: "Too many requests. Please try again later." }, { status: 429 });
  }

  const body = (await request.json().catch(() => ({}))) as RevealBody;
  const quoteRequestId = Number.parseInt(String(body.quoteRequestId ?? ""), 10);
  const contact = await getQuoteRequestContactForAdmin(quoteRequestId);
  if (!contact) {
    return NextResponse.json({ message: "Quote request not found." }, { status: 404 });
  }

  logEvent({
    level: "warn",
    event: "quote_request_contact_revealed",
    area: "admin",
    requestId,
    itemId: contact.id,
    reason: "admin_session_reveal",
  });

  return NextResponse.json({
    ok: true,
    quoteRequest: {
      id: contact.id,
      customerEmail: contact.customer_email,
      customerName: contact.customer_name,
    },
  });
}
