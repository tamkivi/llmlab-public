import { NextResponse } from "next/server";
import {
  listAdminPricingOverrides,
  listPriceTrackableCatalogItems,
  normalizePricingCategory,
  upsertAdminPricingOverride,
} from "@/lib/db";
import { checkRateLimit, requestOriginIsAllowed } from "@/lib/request-utils";
import { requireAdminAccess } from "@/lib/server/admin-auth";
import { revalidatePublicPricingCaches } from "@/lib/server/public-cache-invalidation";
import { logEvent, requestIdFromHeaders } from "@/lib/server/structured-log";

export const dynamic = "force-dynamic";

type OverrideBody = {
  category?: unknown;
  itemId?: unknown;
  marketAvgEur?: unknown;
  sourceNote?: unknown;
  expiresAt?: unknown;
};

export async function GET(request: Request) {
  const auth = await requireAdminAccess(request);
  if (!auth.ok) {
    return NextResponse.json({ message: "Admin access required." }, { status: auth.status });
  }

  const rateLimitKey = auth.actor === "session" ? `admin:pricing-overrides-list:${auth.userId}` : "admin:pricing-overrides-list:bearer";
  if (!(await checkRateLimit(rateLimitKey, 30, 60_000))) {
    return NextResponse.json({ message: "Too many requests. Please try again later." }, { status: 429 });
  }

  const includeExpired = new URL(request.url).searchParams.get("includeExpired") === "1";
  const overrides = await listAdminPricingOverrides({ includeExpired });
  return NextResponse.json({ ok: true, overrides });
}

export async function POST(request: Request) {
  const requestId = requestIdFromHeaders(request.headers);
  const auth = await requireAdminAccess(request);
  if (!auth.ok) {
    return NextResponse.json({ message: "Admin access required." }, { status: auth.status });
  }

  if (auth.actor === "session" && !requestOriginIsAllowed(request)) {
    return NextResponse.json({ message: "Request origin is not allowed." }, { status: 403 });
  }

  const rateLimitKey = auth.actor === "session" ? `admin:pricing-overrides-write:${auth.userId}` : "admin:pricing-overrides-write:bearer";
  if (!(await checkRateLimit(rateLimitKey, 20, 60_000))) {
    return NextResponse.json({ message: "Too many requests. Please try again later." }, { status: 429 });
  }

  const body = (await request.json().catch(() => ({}))) as OverrideBody;
  const category = normalizePricingCategory(String(body.category ?? ""));
  const itemId = Number.parseInt(String(body.itemId ?? ""), 10);
  const marketAvgEur = Number.parseFloat(String(body.marketAvgEur ?? ""));
  const sourceNote = String(body.sourceNote ?? "");
  const expiresAt = String(body.expiresAt ?? "");

  const trackableItems = await listPriceTrackableCatalogItems();
  const item = trackableItems.find((candidate) => candidate.category === category && candidate.itemId === itemId);
  if (!item) {
    return NextResponse.json({ message: "Trackable catalog item not found." }, { status: 404 });
  }
  if (item.pricingTier !== "critical") {
    return NextResponse.json({ message: "Pricing overrides are limited to health-critical checkout items." }, { status: 400 });
  }

  const createdBy = auth.actor === "session" ? `admin_user:${auth.userId ?? "unknown"}` : "admin_bearer";
  const result = await upsertAdminPricingOverride({
    category,
    itemId,
    marketAvgEur,
    sourceNote,
    expiresAt,
    createdBy,
  });

  if (!result.ok) {
    logEvent({
      level: "warn",
      event: "admin_pricing_override_rejected",
      area: "pricing",
      requestId,
      reason: result.message,
      itemType: category,
      itemId: Number.isFinite(itemId) ? itemId : undefined,
    });
    return NextResponse.json({ message: result.message }, { status: 400 });
  }

  logEvent({
    level: "info",
    event: "admin_pricing_override_saved",
    area: "pricing",
    requestId,
    itemType: result.override.category,
    itemId: result.override.item_id,
    reason: "admin_override",
  });
  const cacheInvalidation = revalidatePublicPricingCaches();

  return NextResponse.json({
    ok: true,
    item: {
      category: item.category,
      itemId: item.itemId,
      name: item.name,
      pricingTier: item.pricingTier,
    },
    override: result.override,
    cacheInvalidation,
  });
}
