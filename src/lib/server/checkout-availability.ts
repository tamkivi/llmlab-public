import "server-only";

import {
  getAdapter,
  getCaseById,
  getCompactAiSystemById,
  getCpuById,
  getCpuCoolerById,
  getGpuById,
  getMotherboardById,
  getPowerSupplyById,
  getProfileBuildById,
  getRamKitById,
  getStorageDriveById,
  initDb,
  listEstonianPriceChecks,
  listLatestEstonianPriceCheckMetadata,
  listPriceTrackableCatalogItems,
  type EstonianPriceCheckRecord,
  type OrderItemType,
  type ProfileBuildWithNamesRecord,
} from "@/lib/db";
import {
  hasCategoryValidationMarker,
  priceMateriallyDeviates,
  priceWithinCategoryReferenceBounds,
  requiredCheckoutSampleCount,
  type PricingValidationCategory,
} from "@/lib/component-pricing-validation";
import { ASSEMBLY_MARKUP_MULTIPLIER } from "@/lib/pricing-constants";

export const CHECKOUT_UNAVAILABLE_MESSAGE = "Online checkout is not available yet. Please request a quote.";
export const DIRECT_CHECKOUT_PRICE_MAX_AGE_HOURS_DEFAULT = 24;
export const DIRECT_CHECKOUT_PRICE_MAX_AGE_HOURS_LIMIT = 48;
export const DIRECT_CHECKOUT_MAX_ORDER_EUR_ENV = "DIRECT_CHECKOUT_MAX_ORDER_EUR";

type CheckoutAvailability = {
  available: boolean;
  reason?:
    | "missing_stripe_key"
    | "production_requires_live_key"
    | "preview_requires_test_key"
    | "invalid_stripe_key"
    | "production_requires_live_publishable_key"
    | "preview_requires_test_publishable_key"
    | "stripe_key_mode_mismatch"
    | "production_requires_llmlab_url";
};

export type CheckoutEligibilityReason =
  | "checkout_env_unavailable"
  | "quote_only"
  | "out_of_stock"
  | "missing_price"
  | "missing_trusted_component_pricing"
  | "fallback_pricing"
  | "stale_pricing"
  | "pricing_unhealthy"
  | "order_limit_exceeded"
  | "item_not_found";

export type DirectCheckoutItemType =
  | "profile_build"
  | "gpu"
  | "cpu"
  | "ram_kit"
  | "power_supply"
  | "case"
  | "motherboard"
  | "compact_ai_system"
  | "storage_drive"
  | "cpu_cooler";

export type CheckoutCatalogItemType =
  | Exclude<DirectCheckoutItemType, "profile_build">
  | "mac_system"
  | "external_gpu_enclosure"
  | "mac_egpu_build";

export type CheckoutEligibility = {
  eligible: boolean;
  reason?: CheckoutEligibilityReason;
  message: string;
  orderPriceEur?: number;
  amountEurCents?: number;
  maxPriceAgeHours: number;
  maxOrderEur?: number | null;
  blockers?: CheckoutEligibilityBlocker[];
};

export type CheckoutEligibilityBlocker = {
  label: string;
  category: DirectCheckoutItemType;
  itemId: number;
  reason: CheckoutEligibilityReason;
  message: string;
};

type CheckoutPriceCheck = Pick<
  EstonianPriceCheckRecord,
  "category" | "item_id" | "base_price_eur" | "market_avg_eur" | "assembly_markup_pct" | "final_price_eur" | "sample_count" | "sources" | "checked_at"
> & {
  catalog_base_price_eur?: number;
};

type CheckoutPriceLookup = {
  trusted: Map<string, CheckoutPriceCheck>;
  latest: Map<string, { checkedAt: string; sampleCount: number }>;
};

type DirectCatalogItem = {
  category: Exclude<DirectCheckoutItemType, "profile_build">;
  name: string;
};

type PriceDecision =
  | { ok: true; orderPriceEur: number }
  | { ok: false; reason: CheckoutEligibilityReason };

const BLOCKED_MESSAGES: Record<CheckoutEligibilityReason, string> = {
  checkout_env_unavailable: CHECKOUT_UNAVAILABLE_MESSAGE,
  quote_only: "This product requires a custom quote and is not available through direct checkout.",
  out_of_stock: "Direct checkout is quote-only while availability is being confirmed.",
  missing_price: "Direct checkout is quote-only because pricing data is incomplete.",
  missing_trusted_component_pricing: "Direct checkout is quote-only because one or more build components lack trusted market pricing.",
  fallback_pricing: "Direct checkout is quote-only until fresh Estonian market pricing is available.",
  stale_pricing: "Direct checkout is quote-only because the latest market pricing is stale.",
  pricing_unhealthy: "Direct checkout is quote-only until pricing data passes checkout safety checks.",
  order_limit_exceeded: "Direct checkout is quote-only because the trusted build total exceeds the online checkout limit.",
  item_not_found: "Item not found.",
};

const BUILD_COMPONENT_SLOTS: Array<{
  label: string;
  category: Exclude<DirectCheckoutItemType, "profile_build">;
  idKey: keyof ProfileBuildWithNamesRecord;
}> = [
  { label: "CPU", category: "cpu", idKey: "cpu_id" },
  { label: "GPU", category: "gpu", idKey: "gpu_id" },
  { label: "RAM", category: "ram_kit", idKey: "ram_kit_id" },
  { label: "Storage", category: "storage_drive", idKey: "storage_drive_id" },
  { label: "Motherboard", category: "motherboard", idKey: "motherboard_id" },
  { label: "PSU", category: "power_supply", idKey: "power_supply_id" },
  { label: "Case", category: "case", idKey: "case_id" },
  { label: "Cooler", category: "cpu_cooler", idKey: "cpu_cooler_id" },
];

const INVENTORY_TABLES: Record<Exclude<DirectCheckoutItemType, "profile_build">, string> = {
  gpu: "gpus",
  cpu: "cpus",
  ram_kit: "ram_kits",
  power_supply: "power_supplies",
  case: "pc_cases",
  motherboard: "motherboards",
  compact_ai_system: "compact_ai_systems",
  storage_drive: "storage_drives",
  cpu_cooler: "cpu_coolers",
};

export function getCheckoutAvailability(env: NodeJS.ProcessEnv = process.env): CheckoutAvailability {
  const key = env.STRIPE_SECRET_KEY?.trim();
  if (!key) {
    return { available: false, reason: "missing_stripe_key" };
  }

  const vercelEnv = env.VERCEL_ENV;
  const publishableKey = (env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? env.STRIPE_PUBLISHABLE_KEY)?.trim();
  const isProductionDeployment = vercelEnv === "production" || (!vercelEnv && env.NODE_ENV === "production");
  if (isProductionDeployment) {
    if (vercelEnv === "production") {
      const appUrl = env.NEXT_PUBLIC_APP_URL?.trim();
      try {
        if (!appUrl || new URL(appUrl).origin !== "https://llmlab.ee") {
          return { available: false, reason: "production_requires_llmlab_url" };
        }
      } catch {
        return { available: false, reason: "production_requires_llmlab_url" };
      }
    }
    if (!key.startsWith("sk_live_")) {
      return { available: false, reason: "production_requires_live_key" };
    }
    if (publishableKey && !publishableKey.startsWith("pk_live_")) {
      return { available: false, reason: "production_requires_live_publishable_key" };
    }
    return { available: true };
  }

  if (vercelEnv === "preview") {
    if (publishableKey?.startsWith("pk_live_")) {
      return { available: false, reason: "preview_requires_test_publishable_key" };
    }
    return key.startsWith("sk_test_")
      ? { available: true }
      : { available: false, reason: "preview_requires_test_key" };
  }

  if (key.startsWith("sk_test_") || key.startsWith("sk_live_")) {
    if (publishableKey) {
      const secretMode = key.startsWith("sk_live_") ? "live" : "test";
      const publishableMode = publishableKey.startsWith("pk_live_")
        ? "live"
        : publishableKey.startsWith("pk_test_")
          ? "test"
          : null;
      if (!publishableMode || publishableMode !== secretMode) {
        return { available: false, reason: "stripe_key_mode_mismatch" };
      }
    }
    return { available: true };
  }

  return { available: false, reason: "invalid_stripe_key" };
}

export function getDirectCheckoutPriceMaxAgeHours(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.DIRECT_CHECKOUT_PRICE_MAX_AGE_HOURS ?? env.CHECKOUT_PRICE_MAX_AGE_HOURS;
  const parsed = Number.parseInt(raw ?? String(DIRECT_CHECKOUT_PRICE_MAX_AGE_HOURS_DEFAULT), 10);
  if (!Number.isFinite(parsed)) return DIRECT_CHECKOUT_PRICE_MAX_AGE_HOURS_DEFAULT;
  return Math.min(DIRECT_CHECKOUT_PRICE_MAX_AGE_HOURS_LIMIT, Math.max(1, parsed));
}

export function getDirectCheckoutPriceCutoffIso(env: NodeJS.ProcessEnv = process.env, nowMs = Date.now()): string {
  return new Date(nowMs - getDirectCheckoutPriceMaxAgeHours(env) * 60 * 60 * 1000).toISOString();
}

export function getDirectCheckoutMaxOrderEur(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = env[DIRECT_CHECKOUT_MAX_ORDER_EUR_ENV] ?? env.CHECKOUT_MAX_ORDER_EUR;
  if (!raw) return null;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function orderItemTypeToCheckoutItemType(itemType: OrderItemType): DirectCheckoutItemType {
  const lookup: Record<OrderItemType, DirectCheckoutItemType> = {
    PROFILE_BUILD: "profile_build",
    GPU: "gpu",
    CPU: "cpu",
    RAM_KIT: "ram_kit",
    POWER_SUPPLY: "power_supply",
    CASE: "case",
    MOTHERBOARD: "motherboard",
    COMPACT_AI_SYSTEM: "compact_ai_system",
    STORAGE_DRIVE: "storage_drive",
    CPU_COOLER: "cpu_cooler",
  };
  return lookup[itemType];
}

function blocked(
  reason: CheckoutEligibilityReason,
  env: NodeJS.ProcessEnv = process.env,
  options: Partial<Pick<CheckoutEligibility, "message" | "orderPriceEur" | "amountEurCents" | "maxOrderEur" | "blockers">> = {},
): CheckoutEligibility {
  return {
    eligible: false,
    reason,
    message: options.message ?? BLOCKED_MESSAGES[reason],
    maxPriceAgeHours: getDirectCheckoutPriceMaxAgeHours(env),
    maxOrderEur: options.maxOrderEur ?? getDirectCheckoutMaxOrderEur(env),
    orderPriceEur: options.orderPriceEur,
    amountEurCents: options.amountEurCents,
    blockers: options.blockers,
  };
}

function eligible(orderPriceEur: number, env: NodeJS.ProcessEnv = process.env): CheckoutEligibility {
  return {
    eligible: true,
    message: "Direct checkout is available.",
    orderPriceEur,
    amountEurCents: orderPriceEur * 100,
    maxPriceAgeHours: getDirectCheckoutPriceMaxAgeHours(env),
    maxOrderEur: getDirectCheckoutMaxOrderEur(env),
  };
}

function key(category: string, itemId: number): string {
  return `${category}:${itemId}`;
}

function isFresh(checkedAt: string, env: NodeJS.ProcessEnv): boolean {
  const checkedMs = Date.parse(checkedAt);
  const cutoffMs = Date.parse(getDirectCheckoutPriceCutoffIso(env));
  return Number.isFinite(checkedMs) && Number.isFinite(cutoffMs) && checkedMs >= cutoffMs;
}

function hasCheckoutMarkup(check: CheckoutPriceCheck): boolean {
  const expected = check.market_avg_eur * ASSEMBLY_MARKUP_MULTIPLIER;
  return Math.abs(check.assembly_markup_pct - 15) <= 0.01
    && Math.abs(check.final_price_eur - expected) <= 2;
}

async function buildCheckoutPriceLookup(): Promise<CheckoutPriceLookup> {
  const [trustedRows, latestRows, catalogBaseRows] = await Promise.all([
    listEstonianPriceChecks(),
    listLatestEstonianPriceCheckMetadata(),
    listPriceTrackableCatalogItems(),
  ]);
  const catalogBaseByKey = new Map(catalogBaseRows.map((row) => [key(row.category, row.itemId), row.basePriceEur]));

  return {
    trusted: new Map(trustedRows.map((row) => [key(row.category, row.item_id), {
      ...row,
      catalog_base_price_eur: catalogBaseByKey.get(key(row.category, row.item_id)) ?? row.base_price_eur,
    }])),
    latest: new Map(latestRows.map((row) => [key(row.category, row.item_id), {
      checkedAt: row.checked_at,
      sampleCount: row.sample_count,
    }])),
  };
}

function resolveCheckoutPrice(
  category: Exclude<DirectCheckoutItemType, "profile_build">,
  itemId: number,
  lookup: CheckoutPriceLookup,
  env: NodeJS.ProcessEnv,
): PriceDecision {
  const price = lookup.trusted.get(key(category, itemId));
  if (!price) {
    const latest = lookup.latest.get(key(category, itemId));
    return latest && !isFresh(latest.checkedAt, env)
      ? { ok: false, reason: "stale_pricing" }
      : { ok: false, reason: "fallback_pricing" };
  }

  if (!isFresh(price.checked_at, env)) {
    return { ok: false, reason: "stale_pricing" };
  }

  if (!hasCheckoutMarkup(price)) {
    return { ok: false, reason: "pricing_unhealthy" };
  }

  const validationCategory = category as PricingValidationCategory;
  const referenceBase = price.catalog_base_price_eur ?? price.base_price_eur;
  if (!hasCategoryValidationMarker(validationCategory, price.sources)) {
    return { ok: false, reason: "pricing_unhealthy" };
  }
  if (!priceWithinCategoryReferenceBounds(validationCategory, price.market_avg_eur, referenceBase)) {
    return { ok: false, reason: "pricing_unhealthy" };
  }
  if (price.sample_count < requiredCheckoutSampleCount(price.sources)) {
    return { ok: false, reason: "pricing_unhealthy" };
  }
  if (price.sample_count < 3 && priceMateriallyDeviates(validationCategory, price.market_avg_eur, referenceBase)) {
    return { ok: false, reason: "pricing_unhealthy" };
  }

  const orderPriceEur = Math.round(price.final_price_eur);
  if (!Number.isFinite(orderPriceEur) || orderPriceEur <= 0) {
    return { ok: false, reason: "missing_price" };
  }

  return { ok: true, orderPriceEur };
}

async function getDirectCatalogItem(
  itemType: Exclude<DirectCheckoutItemType, "profile_build">,
  itemId: number,
): Promise<DirectCatalogItem | null> {
  switch (itemType) {
    case "gpu": {
      const item = await getGpuById(itemId);
      return item ? { category: itemType, name: item.name } : null;
    }
    case "cpu": {
      const item = await getCpuById(itemId);
      return item ? { category: itemType, name: item.name } : null;
    }
    case "ram_kit": {
      const item = await getRamKitById(itemId);
      return item ? { category: itemType, name: item.name } : null;
    }
    case "power_supply": {
      const item = await getPowerSupplyById(itemId);
      return item ? { category: itemType, name: item.name } : null;
    }
    case "case": {
      const item = await getCaseById(itemId);
      return item ? { category: itemType, name: item.name } : null;
    }
    case "motherboard": {
      const item = await getMotherboardById(itemId);
      return item ? { category: itemType, name: item.name } : null;
    }
    case "compact_ai_system": {
      const item = await getCompactAiSystemById(itemId);
      return item ? { category: itemType, name: item.name } : null;
    }
    case "storage_drive": {
      const item = await getStorageDriveById(itemId);
      return item ? { category: itemType, name: item.name } : null;
    }
    case "cpu_cooler": {
      const item = await getCpuCoolerById(itemId);
      return item ? { category: itemType, name: item.name } : null;
    }
  }
  return null;
}

async function isInventoryAvailable(category: Exclude<DirectCheckoutItemType, "profile_build">, itemId: number): Promise<boolean> {
  await initDb();
  const table = INVENTORY_TABLES[category];
  const row = await getAdapter()
    .queryOne<{ in_stock: number | null }>(`SELECT in_stock FROM ${table} WHERE id = ? LIMIT 1`, [itemId])
    .catch(() => null);

  return row?.in_stock !== 0;
}

function availabilityBlockIfNeeded(env: NodeJS.ProcessEnv, orderPriceEur: number): CheckoutEligibility {
  const maxOrderEur = getDirectCheckoutMaxOrderEur(env);
  if (maxOrderEur !== null && orderPriceEur > maxOrderEur) {
    return blocked("order_limit_exceeded", env, {
      orderPriceEur,
      amountEurCents: orderPriceEur * 100,
      maxOrderEur,
      message: `Direct checkout is quote-only because the trusted order total €${orderPriceEur.toLocaleString()} exceeds the online checkout limit of €${maxOrderEur.toLocaleString()}.`,
    });
  }

  return getCheckoutAvailability(env).available
    ? eligible(orderPriceEur, env)
    : blocked("checkout_env_unavailable", env);
}

function buildComponentBlocker(input: {
  label: string;
  category: Exclude<DirectCheckoutItemType, "profile_build">;
  itemId: number;
  reason: CheckoutEligibilityReason;
}): CheckoutEligibilityBlocker {
  return {
    label: input.label,
    category: input.category,
    itemId: input.itemId,
    reason: input.reason,
    message: BLOCKED_MESSAGES[input.reason],
  };
}

function topLevelBuildReason(componentReason: CheckoutEligibilityReason): CheckoutEligibilityReason {
  if (componentReason === "stale_pricing" || componentReason === "out_of_stock") return componentReason;
  return "missing_trusted_component_pricing";
}

export async function getCatalogItemCheckoutEligibility(
  itemType: CheckoutCatalogItemType,
  itemId: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CheckoutEligibility> {
  if (itemType === "mac_system" || itemType === "external_gpu_enclosure" || itemType === "mac_egpu_build") {
    return blocked("quote_only", env);
  }

  const item = await getDirectCatalogItem(itemType, itemId);
  if (!item) {
    return blocked("item_not_found", env);
  }

  if (!(await isInventoryAvailable(item.category, itemId))) {
    return blocked("out_of_stock", env);
  }

  const priceLookup = await buildCheckoutPriceLookup();
  const price = resolveCheckoutPrice(item.category, itemId, priceLookup, env);
  if (!price.ok) {
    return blocked(price.reason, env);
  }

  return availabilityBlockIfNeeded(env, price.orderPriceEur);
}

export async function getBuildCheckoutEligibility(
  buildId: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CheckoutEligibility> {
  const build = await getProfileBuildById(buildId);
  if (!build) {
    return blocked("item_not_found", env);
  }

  const priceLookup = await buildCheckoutPriceLookup();
  let orderPriceEur = 0;

  for (const slot of BUILD_COMPONENT_SLOTS) {
    const itemId = build[slot.idKey];
    if (typeof itemId !== "number" || itemId <= 0) {
      return blocked("missing_trusted_component_pricing", env, {
        blockers: [{
          label: slot.label,
          category: slot.category,
          itemId: 0,
          reason: "missing_price",
          message: BLOCKED_MESSAGES.missing_price,
        }],
      });
    }

    if (!(await isInventoryAvailable(slot.category, itemId))) {
      return blocked("out_of_stock", env, {
        blockers: [buildComponentBlocker({ label: slot.label, category: slot.category, itemId, reason: "out_of_stock" })],
      });
    }

    const price = resolveCheckoutPrice(slot.category, itemId, priceLookup, env);
    if (!price.ok) {
      return blocked(topLevelBuildReason(price.reason), env, {
        blockers: [buildComponentBlocker({ label: slot.label, category: slot.category, itemId, reason: price.reason })],
      });
    }
    orderPriceEur += price.orderPriceEur;
  }

  if (orderPriceEur <= 0) {
    return blocked("missing_trusted_component_pricing", env);
  }

  return availabilityBlockIfNeeded(env, orderPriceEur);
}

export async function getOrderItemCheckoutEligibility(
  itemType: OrderItemType,
  itemId: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CheckoutEligibility> {
  const checkoutItemType = orderItemTypeToCheckoutItemType(itemType);
  return checkoutItemType === "profile_build"
    ? getBuildCheckoutEligibility(itemId, env)
    : getCatalogItemCheckoutEligibility(checkoutItemType, itemId, env);
}
