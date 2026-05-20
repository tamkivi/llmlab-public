import { NextResponse } from "next/server";
import {
  categoryValidationMarker,
  isAdminOverrideSource,
  isPricingValidationCategory,
  type PricingValidationCategory,
} from "@/lib/component-pricing-validation";
import { getAdapter, initDb, normalizePricingCategory } from "@/lib/db";
import { checkRateLimit } from "@/lib/request-utils";
import { requireAdminAccess } from "@/lib/server/admin-auth";
import { getCatalogItemCheckoutEligibility, type CheckoutCatalogItemType } from "@/lib/server/checkout-availability";
import { diagnoseEstonianRetailerMatch, retailerSearchQuery } from "@/lib/server/estonian-pricing-service";

export const dynamic = "force-dynamic";

const CATEGORY_TABLES: Record<string, { table: string; priceColumn: string }> = {
  gpu: { table: "gpus", priceColumn: "price_eur" },
  cpu: { table: "cpus", priceColumn: "price_eur" },
  ram_kit: { table: "ram_kits", priceColumn: "price_eur" },
  power_supply: { table: "power_supplies", priceColumn: "price_eur" },
  case: { table: "pc_cases", priceColumn: "price_eur" },
  motherboard: { table: "motherboards", priceColumn: "price_eur" },
  compact_ai_system: { table: "compact_ai_systems", priceColumn: "price_eur" },
  storage_drive: { table: "storage_drives", priceColumn: "price_eur" },
  cpu_cooler: { table: "cpu_coolers", priceColumn: "price_eur" },
  mac_system: { table: "mac_systems", priceColumn: "estimated_price_eur" },
  external_gpu_enclosure: { table: "external_gpu_enclosures", priceColumn: "estimated_price_eur" },
};

const CHECKOUT_DIAGNOSTIC_CATEGORIES = new Set<string>([
  "gpu",
  "cpu",
  "ram_kit",
  "storage_drive",
  "motherboard",
  "power_supply",
  "case",
  "cpu_cooler",
  "mac_system",
  "external_gpu_enclosure",
]);

export function pricingDiagnosticCategory(category?: string): PricingValidationCategory | undefined {
  if (!category) return undefined;
  const normalizedCategory = normalizePricingCategory(category);
  return isPricingValidationCategory(normalizedCategory) ? normalizedCategory : undefined;
}

async function currentPricingStatus(category: string, itemId: number) {
  await initDb();
  const row = await getAdapter().queryOne<{
    market_avg_eur: number;
    final_price_eur: number;
    sample_count: number;
    checked_at: string;
    sources: string;
  }>(
    `SELECT market_avg_eur, final_price_eur, sample_count, checked_at, sources
     FROM estonian_price_checks
     WHERE category = ? AND item_id = ?
     LIMIT 1`,
    [category, itemId],
  );
  if (!row) return null;
  const directCategory = isPricingValidationCategory(category) ? category : null;
  return {
    ...row,
    trust: {
      sourceType: isAdminOverrideSource(row.sources) ? "admin_override" : "retailer",
      categoryValidated: directCategory ? row.sources.includes(categoryValidationMarker(directCategory)) : false,
      hasMatchDiagnostics: row.sources.includes("match="),
    },
  };
}

async function catalogItem(category: string, itemId: number): Promise<{ category: string; itemId: number; name: string; basePriceEur: number } | null> {
  const normalizedCategory = normalizePricingCategory(category);
  const mapping = CATEGORY_TABLES[normalizedCategory];
  if (!mapping) return null;

  await initDb();
  const row = await getAdapter().queryOne<{ id: number; name: string; base_price_eur: number }>(
    `SELECT id, name, ${mapping.priceColumn} AS base_price_eur FROM ${mapping.table} WHERE id = ? LIMIT 1`,
    [itemId],
  );
  if (!row) return null;

  return {
    category: normalizedCategory,
    itemId: row.id,
    name: row.name,
    basePriceEur: row.base_price_eur,
  };
}

export async function GET(request: Request) {
  const auth = await requireAdminAccess(request);
  if (!auth.ok) {
    return NextResponse.json({ message: "Admin access required." }, { status: auth.status });
  }

  const rateLimitKey = auth.actor === "session" ? `admin:pricing-match-diagnostics:${auth.userId}` : "admin:pricing-match-diagnostics:bearer";
  if (!(await checkRateLimit(rateLimitKey, 10, 60_000))) {
    return NextResponse.json({ message: "Too many requests. Please try again later." }, { status: 429 });
  }

  const url = new URL(request.url);
  const category = url.searchParams.get("category");
  const itemIdRaw = url.searchParams.get("itemId");
  const query = url.searchParams.get("query");
  const basePriceRaw = url.searchParams.get("basePriceEur") ?? url.searchParams.get("basePrice");
  const includeSnippets = url.searchParams.get("snippets") !== "false";

  let target: { category?: string; itemId?: number; name: string; basePriceEur: number };
  if (category && itemIdRaw) {
    const itemId = Number.parseInt(itemIdRaw, 10);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      return NextResponse.json({ message: "itemId must be a positive integer." }, { status: 400 });
    }
    const item = await catalogItem(category, itemId);
    if (!item) {
      return NextResponse.json({ message: "Catalog item not found or category is not supported." }, { status: 404 });
    }
    target = item;
  } else if (query && basePriceRaw) {
    const basePriceEur = Number.parseFloat(basePriceRaw);
    if (!Number.isFinite(basePriceEur) || basePriceEur <= 0) {
      return NextResponse.json({ message: "basePriceEur must be a positive number." }, { status: 400 });
    }
    target = { category: category ? normalizePricingCategory(category) : undefined, name: query, basePriceEur };
  } else {
    return NextResponse.json({ message: "Provide category+itemId or query+basePriceEur." }, { status: 400 });
  }

  const diagnosticCategory = pricingDiagnosticCategory(target.category);
  const diagnostic = await diagnoseEstonianRetailerMatch(target.name, target.basePriceEur, {
    category: diagnosticCategory,
    searchQuery: category && itemIdRaw ? retailerSearchQuery(target.name) : undefined,
    includeSnippets,
    maxCandidatesPerSource: 5,
  });

  const pricingStatus = target.category && target.itemId
    ? await currentPricingStatus(target.category, target.itemId)
    : null;
  const checkoutEligibility = target.category && target.itemId && CHECKOUT_DIAGNOSTIC_CATEGORIES.has(target.category)
    ? await getCatalogItemCheckoutEligibility(target.category as CheckoutCatalogItemType, target.itemId).catch((error) => ({
      eligible: false,
      reason: "diagnostic_error",
      message: error instanceof Error ? error.message : "Unable to resolve checkout eligibility.",
    }))
    : null;

  return NextResponse.json({
    item: target,
    diagnosticCategory: diagnosticCategory ?? null,
    pricingStatus,
    checkoutEligibility,
    diagnostic,
  });
}
