import {
  ramPriceMateriallyDeviates,
  ramPriceWithinReferenceBounds,
  validateRamRetailerCandidate,
} from "@/lib/ram-pricing";

export type PricingValidationCategory =
  | "gpu"
  | "cpu"
  | "ram_kit"
  | "power_supply"
  | "case"
  | "motherboard"
  | "compact_ai_system"
  | "storage_drive"
  | "cpu_cooler";

export type CategoryCandidateValidation = {
  ok: boolean;
  reasons: string[];
};

const CATEGORY_PRICE_RATIO_BOUNDS: Record<PricingValidationCategory, { min: number; max: number }> = {
  gpu: { min: 0.55, max: 1.85 },
  cpu: { min: 0.55, max: 1.75 },
  ram_kit: { min: 0.55, max: 1.75 },
  power_supply: { min: 0.55, max: 1.8 },
  case: { min: 0.55, max: 1.8 },
  motherboard: { min: 0.55, max: 1.8 },
  compact_ai_system: { min: 0.55, max: 1.65 },
  storage_drive: { min: 0.55, max: 1.8 },
  cpu_cooler: { min: 0.55, max: 1.85 },
};

const PRICING_VALIDATION_CATEGORIES = new Set<string>(Object.keys(CATEGORY_PRICE_RATIO_BOUNDS));

const DIRECT_CHECKOUT_MATERIAL_DEVIATION_RATIO = 1.25;
export const DIRECT_CHECKOUT_MIN_RETAILER_SAMPLE_COUNT = 2;

export function normalizeComponentMatchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, " ")
    .replace(/™|®/g, "")
    .replace(/(\d+)\s*(gb|tb|w|mm|mhz|ghz)\b/g, "$1$2")
    .replace(/so\s*[- ]\s*dimm/g, "sodimm")
    .replace(/wi\s*[- ]?\s*fi/g, "wifi")
    .replace(/a\s*[- ]?\s*rgb/g, "argb")
    .replace(/[^a-z0-9+.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isAdminOverrideSource(sources: string): boolean {
  return sources.includes("admin_override");
}

export function adminOverrideExpiresAt(sources: string): string | null {
  if (!isAdminOverrideSource(sources)) return null;
  return sources.match(/(?:^|;\s*)expires_at=([^;]+)/)?.[1]?.trim() ?? null;
}

export function adminOverrideIsExpired(sources: string, nowMs = Date.now()): boolean {
  if (!isAdminOverrideSource(sources)) return false;
  const expiresAt = adminOverrideExpiresAt(sources);
  if (!expiresAt) return true;
  const expiresMs = Date.parse(expiresAt);
  return !Number.isFinite(expiresMs) || expiresMs <= nowMs;
}

export function isPricingValidationCategory(category: string): category is PricingValidationCategory {
  return PRICING_VALIDATION_CATEGORIES.has(category);
}

export function categoryValidationMarker(category: PricingValidationCategory): string {
  return `category_validated=${category}`;
}

export function hasCategoryValidationMarker(category: PricingValidationCategory, sources: string): boolean {
  return isAdminOverrideSource(sources) || sources.includes(categoryValidationMarker(category));
}

export function appendCategoryValidationSource(category: PricingValidationCategory, sources: string): string {
  if (hasCategoryValidationMarker(category, sources)) return sources;
  return `${categoryValidationMarker(category)}; ${sources}`;
}

export function requiredCheckoutSampleCount(sources: string): number {
  return isAdminOverrideSource(sources) ? 1 : DIRECT_CHECKOUT_MIN_RETAILER_SAMPLE_COUNT;
}

export function categoryReferencePriceBounds(category: PricingValidationCategory, referencePriceEur: number): { min: number; max: number } {
  const ratio = CATEGORY_PRICE_RATIO_BOUNDS[category];
  return {
    min: referencePriceEur * ratio.min,
    max: referencePriceEur * ratio.max,
  };
}

export function priceWithinCategoryReferenceBounds(category: PricingValidationCategory, priceEur: number, referencePriceEur: number): boolean {
  if (!Number.isFinite(priceEur) || !Number.isFinite(referencePriceEur) || referencePriceEur <= 0) return false;
  if (category === "ram_kit") return ramPriceWithinReferenceBounds(priceEur, referencePriceEur);
  const bounds = categoryReferencePriceBounds(category, referencePriceEur);
  return priceEur >= bounds.min && priceEur <= bounds.max;
}

export function priceMateriallyDeviates(category: PricingValidationCategory, priceEur: number, referencePriceEur: number): boolean {
  if (!Number.isFinite(priceEur) || !Number.isFinite(referencePriceEur) || referencePriceEur <= 0) return true;
  if (category === "ram_kit") return ramPriceMateriallyDeviates(priceEur, referencePriceEur);
  const ratio = priceEur / referencePriceEur;
  return ratio > DIRECT_CHECKOUT_MATERIAL_DEVIATION_RATIO || ratio < 1 / DIRECT_CHECKOUT_MATERIAL_DEVIATION_RATIO;
}

function hasAnyToken(normalized: string, tokens: string[]): boolean {
  return tokens.some((token) => normalized.includes(token));
}

function hasUnsafeListingContext(normalized: string): boolean {
  return hasAnyToken(normalized, [
    "lauaarvuti",
    "desktop pc",
    "gaming pc",
    "workstation",
    "valmisarvuti",
    "arvutikomplekt",
    "barebone",
    "bundle",
    "komplektarvuti",
  ]);
}

function hasUsedOrOpenBoxContext(normalized: string): boolean {
  return hasAnyToken(normalized, [
    "avatud pakend",
    "open box",
    "kasutatud",
    "used",
    "refurbished",
    "renewed",
    "demo",
  ]);
}

function hasMobileContext(normalized: string): boolean {
  return hasAnyToken(normalized, ["laptop", "notebook", "sulearvuti", "sülearvuti", "mobile", "max q", "max-q", "mxm"]);
}

function tokenSet(value: string): Set<string> {
  return new Set(normalizeComponentMatchText(value).split(" ").filter(Boolean));
}

function requireCatalogTokens(prefix: string, catalogName: string, candidate: string, tokens: string[]): string[] {
  const catalogTokens = tokenSet(catalogName);
  const candidateTokens = tokenSet(candidate);
  return tokens
    .filter((token) => catalogTokens.has(token) && !candidateTokens.has(token))
    .map((token) => `${prefix}_token_missing:${token}`);
}

function parseFirstNumber(value: string, pattern: RegExp): number | null {
  const match = value.match(pattern);
  if (!match) return null;
  const raw = match.slice(1).find((group) => group !== undefined);
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCapacityGb(value: string): number | null {
  const normalized = normalizeComponentMatchText(value);
  const tb = normalized.match(/\b(\d+)(?:\.\d+)?tb\b/);
  if (tb) return Number.parseInt(tb[1], 10) * 1000;
  const gb = normalized.match(/\b(\d+)gb\b/);
  return gb ? Number.parseInt(gb[1], 10) : null;
}

function parseAllCapacitiesGb(value: string): number[] {
  const normalized = normalizeComponentMatchText(value);
  const capacities: number[] = [];
  for (const match of normalized.matchAll(/\b(\d+)(?:\.\d+)?tb\b/g)) capacities.push(Number.parseInt(match[1], 10) * 1000);
  for (const match of normalized.matchAll(/\b(\d+)gb\b/g)) capacities.push(Number.parseInt(match[1], 10));
  return capacities.filter(Number.isFinite);
}

function parseGpuSpec(value: string) {
  const normalized = normalizeComponentMatchText(value);
  const nvidia = normalized.match(/\b(?:nvidia\s+)?(?:geforce\s+)?(?:rtx|gtx)\s*(a?\d{4}|6000|5000|4500|4000|2000|a4000|a5000|a6000)\b/);
  const amd = normalized.match(/\b(?:amd\s+)?(?:radeon\s+)?(?:rx|pro)\s*(\d{4}|w\d{4})\b/);
  const intel = normalized.match(/\b(?:intel\s+)?arc\s*([ab]\d{3})\b/);
  const dc = normalized.match(/\b(h100|l40s)\b/);
  const family = nvidia ? "nvidia" : amd ? "amd" : intel ? "intel" : dc ? "nvidia" : null;
  const model = (nvidia?.[1] ?? amd?.[1] ?? intel?.[1] ?? dc?.[1] ?? null)?.replace(/^a(?=\d{4}$)/, "a");
  return {
    normalized,
    family,
    model,
    ti: /\bti\b/.test(normalized),
    super: /\bsuper\b/.test(normalized),
    xt: /\bxt\b/.test(normalized),
    xtx: /\bxtx\b/.test(normalized),
    ada: /\bada\b/.test(normalized),
    vramGb: parseAllCapacitiesGb(normalized).filter((capacity) => capacity <= 128),
  };
}

function validateGpu(catalogName: string, candidateContext: string): string[] {
  const catalog = parseGpuSpec(catalogName);
  const candidate = parseGpuSpec(candidateContext);
  const reasons: string[] = [];
  if (!candidate.model) reasons.push("gpu_model_missing");
  else if (catalog.model && candidate.model !== catalog.model) reasons.push("gpu_model_mismatch");
  if (catalog.family && candidate.family && catalog.family !== candidate.family) reasons.push("gpu_family_mismatch");
  if (catalog.ti !== candidate.ti) reasons.push("gpu_ti_modifier_mismatch");
  if (catalog.super !== candidate.super) reasons.push("gpu_super_modifier_mismatch");
  if (catalog.xtx !== candidate.xtx) reasons.push("gpu_xtx_modifier_mismatch");
  else if (!catalog.xtx && catalog.xt !== candidate.xt) reasons.push("gpu_xt_modifier_mismatch");
  if (catalog.ada && !candidate.ada) reasons.push("gpu_ada_modifier_missing");
  if (catalog.vramGb.length > 0 && candidate.vramGb.length > 0 && !candidate.vramGb.some((capacity) => catalog.vramGb.includes(capacity))) {
    reasons.push("gpu_vram_mismatch");
  }
  if (hasMobileContext(candidate.normalized)) reasons.push("gpu_mobile_mismatch");
  return reasons;
}

function parseCpuSpec(value: string) {
  const normalized = normalizeComponentMatchText(value);
  const ryzen = normalized.match(/\bryzen\s+(3|5|7|9)\s*(\d{4,5}[a-z0-9]*)\b/);
  const threadripper = normalized.match(/\bthreadripper(?:\s+pro)?\s+(\d{4,5}wx?|\d{4,5}x)\b/);
  const intelCore = normalized.match(/\bcore\s+(?:ultra\s+)?(?:i[3579]|[3579])\s*[- ]?\s*(\d{4,5}[a-z]{0,2})\b/);
  const xeon = normalized.match(/\bxeon\s+w[79]\s*[- ]\s*(\d{4}x)\b/);
  return {
    normalized,
    family: ryzen ? `ryzen${ryzen[1]}` : threadripper ? "threadripper" : intelCore ? "intel-core" : xeon ? "xeon" : null,
    model: ryzen?.[2] ?? threadripper?.[1] ?? intelCore?.[1] ?? xeon?.[1] ?? null,
    pro: /\bpro\b/.test(normalized),
    boxed: /\bbox|boxed|wof\b/.test(normalized),
    tray: /\btray\b/.test(normalized),
  };
}

function validateCpu(catalogName: string, candidateContext: string): string[] {
  const catalog = parseCpuSpec(catalogName);
  const candidate = parseCpuSpec(candidateContext);
  const reasons: string[] = [];
  if (!candidate.model) reasons.push("cpu_model_missing");
  else if (catalog.model && candidate.model !== catalog.model) reasons.push("cpu_model_mismatch");
  if (catalog.family && candidate.family && catalog.family !== candidate.family) reasons.push("cpu_family_mismatch");
  if (catalog.pro && !candidate.pro) reasons.push("cpu_pro_modifier_missing");
  if (hasMobileContext(candidate.normalized)) reasons.push("cpu_mobile_mismatch");
  return reasons;
}

function parseMotherboardSpec(value: string) {
  const normalized = normalizeComponentMatchText(value);
  return {
    normalized,
    chipset: normalized.match(/\b(x870e|x870|x670e|x670|b850|b650e|b650|z890|z790|z690|w790)\b/)?.[1] ?? null,
    socket: normalized.match(/\b(am5|am4|lga1700|lga1851|str5|swrx9)\b/)?.[1] ?? null,
    ddr: normalized.match(/\bddr\s*([45])\b/)?.[1] ?? null,
    wifi: /\bwifi\b/.test(normalized),
    microAtx: /\bmatx\b|\bmicro atx\b|\bb650m\b|\bz790m\b/.test(normalized),
  };
}

function validateMotherboard(catalogName: string, candidateContext: string): string[] {
  const catalog = parseMotherboardSpec(catalogName);
  const candidate = parseMotherboardSpec(candidateContext);
  const reasons = requireCatalogTokens("motherboard", catalogName, candidateContext, [
    "rog", "strix", "tuf", "gaming", "mag", "mpg", "pro", "tomahawk", "aorus", "elite", "master", "taichi", "riptide", "carbon", "wifi", "plus",
  ]);
  if (!candidate.chipset) reasons.push("motherboard_chipset_missing");
  else if (catalog.chipset && candidate.chipset !== catalog.chipset) reasons.push("motherboard_chipset_mismatch");
  if (catalog.socket && candidate.socket && candidate.socket !== catalog.socket) reasons.push("motherboard_socket_mismatch");
  if (catalog.ddr && candidate.ddr && catalog.ddr !== candidate.ddr) reasons.push("motherboard_memory_generation_mismatch");
  if (catalog.wifi && !candidate.wifi) reasons.push("motherboard_wifi_missing");
  if (catalog.microAtx !== candidate.microAtx && (catalog.normalized.includes(" b650m ") || catalog.normalized.includes(" z790m ") || candidate.microAtx)) {
    reasons.push("motherboard_form_factor_mismatch");
  }
  return reasons;
}

function parseStorageSpec(value: string) {
  const normalized = normalizeComponentMatchText(value);
  return {
    normalized,
    capacityGb: parseCapacityGb(normalized),
    nvme: /\bnvme\b|\bm\.2\b|\bm2\b/.test(normalized),
    external: /\bexternal\b|\bportable\b|\busb\b|\benclosure\b|\bväline\b/.test(normalized),
    heatsink: /\bheatsink\b|jahutusradiaator/.test(normalized),
  };
}

function validateStorage(catalogName: string, candidateContext: string): string[] {
  const catalog = parseStorageSpec(catalogName);
  const candidate = parseStorageSpec(candidateContext);
  const reasons = requireCatalogTokens("storage", catalogName, candidateContext, ["990", "980", "pro", "evo", "plus", "kc3000", "sn850x", "p3", "p5", "t700", "firecuda"]);
  if (!candidate.capacityGb) reasons.push("storage_capacity_missing");
  else if (catalog.capacityGb && candidate.capacityGb !== catalog.capacityGb) reasons.push("storage_capacity_mismatch");
  if (catalog.nvme && !candidate.nvme) reasons.push("storage_nvme_missing");
  if (candidate.external) reasons.push("storage_external_mismatch");
  if (!catalog.heatsink && candidate.heatsink) reasons.push("storage_heatsink_mismatch");
  return reasons;
}

function validatePowerSupply(catalogName: string, candidateContext: string): string[] {
  const catalog = normalizeComponentMatchText(catalogName);
  const candidate = normalizeComponentMatchText(candidateContext);
  const reasons = requireCatalogTokens("psu", catalogName, candidateContext, ["rm1000e", "rm850e", "rm750e", "rm850x", "rm750x", "gx-750", "gx-650", "gx-550", "straight", "power", "toughpower", "supernova"]);
  const catalogW = parseFirstNumber(catalog, /\b(\d{3,4})w\b/);
  const candidateW = parseFirstNumber(candidate, /\b(\d{3,4})w\b/);
  if (!candidateW) reasons.push("psu_wattage_missing");
  else if (catalogW && candidateW !== catalogW) reasons.push("psu_wattage_mismatch");
  if (catalog.includes("rm850e") && candidate.includes("rm850x")) reasons.push("psu_series_mismatch");
  if (catalog.includes("rm850x") && candidate.includes("rm850e")) reasons.push("psu_series_mismatch");
  if (!catalog.includes("white") && candidate.includes("white")) reasons.push("psu_color_mismatch");
  if (candidate.includes("sfx") && !catalog.includes("sfx")) reasons.push("psu_form_factor_mismatch");
  return reasons;
}

function validateCooler(catalogName: string, candidateContext: string): string[] {
  const catalog = normalizeComponentMatchText(catalogName);
  const candidate = normalizeComponentMatchText(candidateContext);
  const reasons = requireCatalogTokens("cooler", catalogName, candidateContext, ["nh-d15", "nh-u12a", "nh-u14s", "nh-u9s", "dark", "rock", "ak620", "ls720", "phantom", "spirit", "peerless", "assassin", "freezer", "kraken", "nucleus"]);
  const catalogMm = parseFirstNumber(catalog, /\b(120|140|240|280|360|420)mm\b|\b(240|280|360|420)\b/);
  const candidateMm = parseFirstNumber(candidate, /\b(120|140|240|280|360|420)mm\b|\b(240|280|360|420)\b/);
  if (catalogMm && candidateMm && catalogMm !== candidateMm) reasons.push("cooler_size_mismatch");
  if (catalog.includes("nh-d15") && candidate.includes("nh-d15s")) reasons.push("cooler_variant_mismatch");
  if (catalog.includes("g2") && !candidate.includes("g2")) reasons.push("cooler_variant_mismatch");
  if (!catalog.includes("pro") && candidate.includes(" pro ")) reasons.push("cooler_variant_mismatch");
  if (!catalog.includes("rgb") && (candidate.includes("argb") || candidate.includes(" rgb "))) reasons.push("cooler_rgb_mismatch");
  return reasons;
}

function validateCase(catalogName: string, candidateContext: string): string[] {
  const catalog = normalizeComponentMatchText(catalogName);
  const candidate = normalizeComponentMatchText(candidateContext);
  const reasons = requireCatalogTokens("case", catalogName, candidateContext, ["fractal", "design", "north", "torrent", "meshify", "define", "pop", "air", "lancool", "dynamic", "vision", "flow", "silent", "base", "shadow", "enthoo", "eclipse"]);
  if (catalog.includes(" xl") !== candidate.includes(" xl") && (catalog.includes(" xl") || candidate.includes(" xl"))) reasons.push("case_size_variant_mismatch");
  if (!catalog.includes("rgb") && (candidate.includes("argb") || candidate.includes(" rgb "))) reasons.push("case_rgb_mismatch");
  return reasons;
}

function validateCompactSystem(catalogName: string, candidateContext: string): string[] {
  const catalog = normalizeComponentMatchText(catalogName);
  const candidate = normalizeComponentMatchText(candidateContext);
  const reasons = requireCatalogTokens("compact_system", catalogName, candidateContext, ["mac", "studio", "mini", "framework", "nuc", "ai"]);
  const catalogCapacity = parseCapacityGb(catalog);
  const candidateCapacity = parseCapacityGb(candidate);
  if (catalogCapacity && candidateCapacity && candidateCapacity < catalogCapacity) reasons.push("compact_system_capacity_mismatch");
  return reasons;
}

export function validateRetailerCandidateForCategory(
  category: PricingValidationCategory | null,
  catalogName: string,
  candidateContext: string,
): CategoryCandidateValidation {
  if (!category) return { ok: true, reasons: [] };

  const normalized = normalizeComponentMatchText(candidateContext);
  const reasons: string[] = [];
  if (hasUsedOrOpenBoxContext(normalized)) reasons.push("unsafe_used_or_open_box_listing");
  if (category !== "compact_ai_system" && hasUnsafeListingContext(normalized)) reasons.push("unsafe_bundle_listing_context");

  switch (category) {
    case "gpu":
      reasons.push(...validateGpu(catalogName, candidateContext));
      break;
    case "cpu":
      reasons.push(...validateCpu(catalogName, candidateContext));
      break;
    case "ram_kit":
      reasons.push(...validateRamRetailerCandidate(catalogName, candidateContext).reasons);
      break;
    case "motherboard":
      reasons.push(...validateMotherboard(catalogName, candidateContext));
      break;
    case "storage_drive":
      reasons.push(...validateStorage(catalogName, candidateContext));
      break;
    case "power_supply":
      reasons.push(...validatePowerSupply(catalogName, candidateContext));
      break;
    case "case":
      reasons.push(...validateCase(catalogName, candidateContext));
      break;
    case "cpu_cooler":
      reasons.push(...validateCooler(catalogName, candidateContext));
      break;
    case "compact_ai_system":
      reasons.push(...validateCompactSystem(catalogName, candidateContext));
      break;
  }

  return {
    ok: reasons.length === 0,
    reasons: [...new Set(reasons)],
  };
}
