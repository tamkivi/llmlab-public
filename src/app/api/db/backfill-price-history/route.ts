import { NextResponse } from "next/server";
import { backfillPriceHistoryFromChecks, normalizeCategoryRows } from "@/lib/db";
import { checkRateLimit } from "@/lib/request-utils";
import { requireAdminAccess } from "@/lib/server/admin-auth";
import { revalidatePublicPricingCaches } from "@/lib/server/public-cache-invalidation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireAdminAccess(request);
  if (!auth.ok) {
    return NextResponse.json({ message: "Admin access required." }, { status: auth.status });
  }
  const rateLimitKey = auth.actor === "session" ? `admin:backfill:${auth.userId}` : "admin:backfill:bearer";
  if (!(await checkRateLimit(rateLimitKey, 5, 60_000))) {
    return NextResponse.json({ message: "Too many requests. Please try again later." }, { status: 429 });
  }

  const normalized = await normalizeCategoryRows();
  const backfilled = await backfillPriceHistoryFromChecks();
  const cacheInvalidation = normalized > 0 || backfilled.inserted + backfilled.updated > 0
    ? revalidatePublicPricingCaches()
    : null;

  return NextResponse.json({
    status: "ok",
    backfilledRows: backfilled.inserted,
    updatedRows: backfilled.updated,
    targetDates: backfilled.targetDates,
    normalizedRows: normalized,
    cacheInvalidation,
  });
}
