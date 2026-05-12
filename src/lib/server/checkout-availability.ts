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
  type EstonianPriceCheckRecord,
  type OrderItemType,
  type ProfileBuildWithNamesRecord,
} from "@/lib/db";
import { ASSEMBLY_MARKUP_MULTIPLIER } from "@/lib/pricing-constants";

export const CHECKOUT_UNAVAILABLE_MESSAGE = "Online checkout is not available yet. Please request a quote.";
export const DIRECT_CHECKOUT_PRICE_MAX_AGE_HOURS_DEFAULT = 24;
export const DIRECT_CHECKOUT_PRICE_MAX_AGE_HOURS_LIMIT = 48;

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
  | "fallback_pricing"
  | "stale_pricing"
  | "pricing_unhealthy"
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
};

type CheckoutPriceCheck = Pick<
  EstonianPriceCheckRecord,
  "category" | "item_id" | "market_avg_eur" | "assembly_markup_pct" | "final_price_eur" | "sample_count" | "checked_at"
>;

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
  fallback_pricing: "Direct checkout is quote-only until fresh Estonian market pricing is available.",
  stale_pricing: "Direct checkout is quote-only because the latest market pricing is stale.",
  pricing_unhealthy: "Direct checkout is quote-only until pricing data passes checkout safety checks.",
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

function blocked(reason: CheckoutEligibilityReason, env: NodeJS.ProcessEnv = process.env): CheckoutEligibility {
  return {
    eligible: false,
    reason,
    message: BLOCKED_MESSAGES[reason],
    maxPriceAgeHours: getDirectCheckoutPriceMaxAgeHours(env),
  };
}

function eligible(orderPriceEur: number, env: NodeJS.ProcessEnv = process.env): CheckoutEligibility {
  return {
    eligible: true,
    message: "Direct checkout is available.",
    orderPriceEur,
    amountEurCents: orderPriceEur * 100,
    maxPriceAgeHours: getDirectCheckoutPriceMaxAgeHours(env),
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
  const [trustedRows, latestRows] = await Promise.all([
    listEstonianPriceChecks(),
    listLatestEstonianPriceCheckMetadata(),
  ]);

  return {
    trusted: new Map(trustedRows.map((row) => [key(row.category, row.item_id), row])),
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
  return getCheckoutAvailability(env).available
    ? eligible(orderPriceEur, env)
    : blocked("checkout_env_unavailable", env);
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
      return blocked("missing_price", env);
    }

    if (!(await isInventoryAvailable(slot.category, itemId))) {
      return blocked("out_of_stock", env);
    }

    const price = resolveCheckoutPrice(slot.category, itemId, priceLookup, env);
    if (!price.ok) {
      return blocked(price.reason, env);
    }
    orderPriceEur += price.orderPriceEur;
  }

  if (orderPriceEur <= 0) {
    return blocked("missing_price", env);
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
