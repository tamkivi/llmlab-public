import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/request-utils";
import { requireAdminAccess } from "@/lib/server/admin-auth";
import { getAdminOpsDiagnostics } from "@/lib/server/ops-diagnostics";
import { logEvent, requestIdFromHeaders } from "@/lib/server/structured-log";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = requestIdFromHeaders(request.headers);
  const auth = await requireAdminAccess(request);
  if (!auth.ok) {
    return NextResponse.json({ message: "Admin access required." }, { status: auth.status });
  }

  const rateLimitKey = auth.actor === "session" ? `admin:diagnostics:${auth.userId}` : "admin:diagnostics:bearer";
  if (!(await checkRateLimit(rateLimitKey, 30, 60_000))) {
    return NextResponse.json({ message: "Too many requests. Please try again later." }, { status: 429 });
  }

  const diagnostics = await getAdminOpsDiagnostics();
  if (diagnostics.status !== "healthy") {
    logEvent({
      level: "warn",
      event: "admin_diagnostics_degraded",
      area: "admin",
      requestId,
      status: diagnostics.status,
      reason: diagnostics.health.checkoutUnavailableReason ?? "operational_health_degraded",
    });
  }
  return NextResponse.json(diagnostics, { status: diagnostics.status === "healthy" ? 200 : 503 });
}
