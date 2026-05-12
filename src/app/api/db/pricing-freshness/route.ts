import { NextResponse } from "next/server";
import { getPricingFreshnessReport } from "@/lib/db";
import { checkRateLimit } from "@/lib/request-utils";
import { requireAdminAccess } from "@/lib/server/admin-auth";
import { logEvent, requestIdFromHeaders } from "@/lib/server/structured-log";

export const dynamic = "force-dynamic";

function lastSuccessAt(report: Awaited<ReturnType<typeof getPricingFreshnessReport>>): string | null {
  const row = report.lastSuccessfulRun;
  if (!row) return null;
  const finishedAt = row.finished_at;
  if (typeof finishedAt === "string" && finishedAt.length > 0) return finishedAt;
  const startedAt = row.started_at;
  return typeof startedAt === "string" && startedAt.length > 0 ? startedAt : null;
}

export async function GET(request: Request) {
  const requestId = requestIdFromHeaders(request.headers);
  const auth = await requireAdminAccess(request);
  if (!auth.ok) {
    return NextResponse.json({ message: "Admin access required." }, { status: auth.status });
  }

  const rateLimitKey = auth.actor === "session" ? `admin:pricing-freshness:${auth.userId}` : "admin:pricing-freshness:bearer";
  if (!(await checkRateLimit(rateLimitKey, 30, 60_000))) {
    return NextResponse.json({ message: "Too many requests. Please try again later." }, { status: 429 });
  }

  const report = await getPricingFreshnessReport();
  const wantsSummary = new URL(request.url).searchParams.get("summary") === "1";
  if (!report.healthy) {
    logEvent({
      level: "warn",
      event: "pricing_freshness_unhealthy",
      area: "pricing",
      requestId,
      reason: report.errors.slice(0, 3).join("; ") || "pricing freshness unhealthy",
      status: wantsSummary ? "summary" : "detail",
      count: report.missingTodayCount,
    });
  }
  if (wantsSummary) {
    return NextResponse.json({
      status: report.healthy ? "healthy" : "unhealthy",
      last_success_at: lastSuccessAt(report),
      freshness_ok: report.healthy,
      coverage_pct: report.criticalCoveragePct,
      critical_coverage_pct: report.criticalCoveragePct,
      background_coverage_pct: report.backgroundCoveragePct,
      missing_count: report.criticalMissingTodayCount,
    }, { status: report.healthy ? 200 : 503 });
  }

  return NextResponse.json(report, { status: report.healthy ? 200 : 503 });
}
