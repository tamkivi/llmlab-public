import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import {
  getCaseById,
  getCompactAiSystemById,
  getCpuById,
  getCpuCoolerById,
  getExternalGpuEnclosureById,
  getGpuById,
  getMacEgpuBuildById,
  getMacSystemById,
  getMotherboardById,
  getPowerSupplyById,
  getPriceHistory,
  getProfileBuildById,
  getRamKitById,
  getStorageDriveById,
  getTrustedPriceCutoffIso,
  listCases,
  listCompactAiSystems,
  listCpuCoolers,
  listCpus,
  listEstonianPriceChecks,
  listExternalGpuEnclosures,
  listGpus,
  listLatestEstonianPriceCheckMetadata,
  listMacEgpuBuilds,
  listMacSystems,
  listMotherboards,
  listPowerSupplies,
  listProfileBuilds,
  listRamKits,
  listStorageDrives,
} from "@/lib/db";
import type { ProfileBuildWithNamesRecord } from "@/lib/db";
import type { PriceSource, PricingTransparency } from "@/lib/price-transparency";
import { ASSEMBLY_MARKUP_MULTIPLIER } from "@/lib/pricing-constants";
import {
  getBuildCheckoutEligibility,
  getCatalogItemCheckoutEligibility,
  type CheckoutEligibilityBlocker,
  type CheckoutEligibilityReason,
} from "@/lib/server/checkout-availability";

const PUBLIC_CATALOG_REVALIDATE_SECONDS = 15 * 60;

type AsyncPublicLoader<Args extends unknown[], Result> = (...args: Args) => Promise<Result>;

function isMissingIncrementalCache(error: unknown): boolean {
  return error instanceof Error && error.message.includes("incrementalCache missing");
}

function publicDataCache<Args extends unknown[], Result>(
  loader: AsyncPublicLoader<Args, Result>,
  keyParts: string[],
  tags: string[],
): AsyncPublicLoader<Args, Result> {
  const nextCachedLoader = unstable_cache(loader, keyParts, {
    revalidate: PUBLIC_CATALOG_REVALIDATE_SECONDS,
    tags,
  });

  return cache(async (...args: Args) => {
    try {
      return await nextCachedLoader(...args);
    } catch (error) {
      if (isMissingIncrementalCache(error)) {
        return loader(...args);
      }
      throw error;
    }
  });
}

type PublicPricingFields = PricingTransparency & {
  marketAvgEur: number | null;
};

export type PublicGpu = {
  id: number;
  name: string;
  brand: string;
  vramGb: number;
  architecture: string;
  aiScore: number;
  priceEur: number;
  preorderPriceEur: number;
} & PublicPricingFields & {
  mpn: string;
  releaseYear: number;
  releaseQuarter: string;
  displayPowerW: number;
  connectorStandard: string;
  minimumPsuW: number;
  dualGpuCapable: boolean;
};

export type PublicCpu = {
  id: number;
  name: string;
  brand: string;
  cores: number;
  threads: number;
  socket: string;
  aiScore: number;
  priceEur: number;
  preorderPriceEur: number;
} & PublicPricingFields & {
  mpn: string;
  releaseYear: number;
  releaseQuarter: string;
  platformGeneration: string;
  memoryChannels: number;
  eccSupport: boolean;
};

export type PublicRamKit = {
  id: number;
  name: string;
  brand: string;
  capacityGb: number;
  modules: string;
  ddrGen: string;
  speedMtS: number;
  casLatency: string;
  profileSupport: string;
  priceEur: number;
  preorderPriceEur: number;
} & PublicPricingFields;

export type PublicPowerSupply = {
  id: number;
  name: string;
  brand: string;
  wattage: number;
  efficiencyRating: string;
  atxStandard: string;
  modularity: string;
  pcie5Support: boolean;
  priceEur: number;
  preorderPriceEur: number;
} & PublicPricingFields;

export type PublicCase = {
  id: number;
  name: string;
  brand: string;
  formFactor: string;
  maxGpuMm: number;
  radiatorSupport: string;
  includedFans: string;
  priceEur: number;
  preorderPriceEur: number;
} & PublicPricingFields;

export type PublicMotherboard = {
  id: number;
  name: string;
  brand: string;
  socket: string;
  chipset: string;
  memorySupport: string;
  maxMemoryGb: number;
  pcieGen5Support: boolean;
  priceEur: number;
  preorderPriceEur: number;
} & PublicPricingFields;

export type PublicCompactAiSystem = {
  id: number;
  name: string;
  vendor: string;
  chip: string;
  memoryGb: number;
  storageGb: number;
  gpuClass: string;
  installedSoftware: string;
  bestFor: string;
  inStock: boolean;
  priceEur: number;
  preorderPriceEur: number;
} & PublicPricingFields;

export type PublicStorageDrive = {
  id: number;
  name: string;
  brand: string;
  driveType: string;
  interface: string;
  capacityGb: number;
  seqReadMbS: number;
  enduranceTbw: number;
  interfaceGeneration: string;
  priceEur: number;
  preorderPriceEur: number;
} & PublicPricingFields;

export type PublicCpuCooler = {
  id: number;
  name: string;
  brand: string;
  coolerType: string;
  radiatorOrHeightMm: number;
  socketSupport: string;
  maxTdpW: number;
  noiseDb: string;
  priceEur: number;
  preorderPriceEur: number;
} & PublicPricingFields;

export type PublicMacSystem = {
  id: number;
  name: string;
  chip: string;
  cpuCores: number;
  gpuCores: number;
  unifiedMemoryGb: number;
  storageGb: number;
  ports: string;
  thunderboltVersion: string;
  usb4Supported: boolean;
  macosMinVersion: string;
  notes: string;
  preorderPriceEur: number;
} & PublicPricingFields;

export type PublicExternalGpuEnclosure = {
  id: number;
  name: string;
  connectionType: string;
  pcieGeneration: string;
  pcieLanes: number;
  maxGpuLengthMm: number;
  maxGpuSlots: number;
  includedPsuWatts: number;
  requiresExternalPsu: boolean;
  supportsOpenFrame: boolean;
  notes: string;
  preorderPriceEur: number;
} & PublicPricingFields;

export type ComponentPriceEntry = {
  label: string;
  name: string;
  category: CatalogItemType;
  itemId: number;
  priceEur: number;
  marketAvgEur: number | null;
  priceSource: PriceSource;
  checkedAt: string | null;
  sampleCount: number | null;
  marketDataStatus?: PricingTransparency["marketDataStatus"];
  latestCheckedAt?: string | null;
  latestSampleCount?: number | null;
};

export type PricingConfidence = "stable" | "moderate" | "high_volatility";

export type PublicProfileBuild = {
  id: number;
  profileKey: string;
  profileLabel: string;
  buildName: string;
  targetModel: string;
  ramGb: number;
  storageGb: number;
  bestFor: string;
  estimatedTokensPerSec: string;
  estimatedSystemPowerW: number;
  recommendedPsuW: number;
  coolingProfile: string;
  notes: string;
  sourceRefs: string;
  cpuName: string;
  gpuName: string;
  gpuVramGb: number;
  gpuArchitecture: string;
  componentPrices?: ComponentPriceEntry[];
  componentTotalEur?: number;
  missingComponents?: string[];
  pricingLiveCount?: number;
  pricingFallbackCount?: number;
  oldestCheckedAt?: string | null;
  lowestSampleCount?: number | null;
  checkoutEligible?: boolean;
  checkoutDisabledReason?: CheckoutEligibilityReason;
  checkoutBlockers?: CheckoutEligibilityBlocker[];
  checkoutMaxOrderEur?: number | null;
  checkoutOrderPriceEur?: number;
};

export type PublicMacEgpuBuild = {
  id: number;
  name: string;
  macSystemName: string;
  macSystemChip: string;
  macSystemMemoryGb: number;
  macSystemStorageGb: number;
  macSystemBasePriceEur: number;
  macSystemMarketPriceEur: number | null;
  egpuEnclosureName: string;
  egpuEnclosureBasePriceEur: number;
  egpuEnclosureMarketPriceEur: number | null;
  gpuName: string;
  gpuVramGb: number;
  gpuArchitecture: string;
  targetWorkloads: string[];
  unsupportedWorkloads: string[];
  riskLevel: "experimental" | "advanced" | "stable";
  buyerWarning: string;
  notes: string;
};

export type CatalogItemType =
  | "gpu"
  | "cpu"
  | "ram_kit"
  | "power_supply"
  | "case"
  | "motherboard"
  | "compact_ai_system"
  | "storage_drive"
  | "cpu_cooler"
  | "mac_system"
  | "external_gpu_enclosure";

export type PublicCatalogItemDetail = {
  itemType: CatalogItemType;
  itemId: number;
  name: string;
  subtitle: string;
  preorderPriceEur: number;
  marketAvgEur: number | null;
  priceSource: PriceSource;
  checkedAt: string | null;
  sampleCount: number | null;
  marketDataStatus?: PricingTransparency["marketDataStatus"];
  latestCheckedAt?: string | null;
  latestSampleCount?: number | null;
  basePriceEur: number;
  checkoutItemType: CatalogItemType;
  purchasable: boolean;
  checkoutEligible?: boolean;
  checkoutDisabledReason?: CheckoutEligibilityReason;
  specs: Array<{ label: string; value: string }>;
};

// ── Shared price lookup ──

type PriceLookup = Map<string, { final: number; avg: number; checkedAt: string; sampleCount: number }>;
type LatestPriceMetadataLookup = Map<string, { checkedAt: string; sampleCount: number }>;

async function buildPriceLookup(): Promise<PriceLookup> {
  const checks = await listEstonianPriceChecks();
  const map = new Map<string, { final: number; avg: number; checkedAt: string; sampleCount: number }>();
  for (const row of checks) {
    map.set(`${row.category}:${row.item_id}`, {
      final: row.final_price_eur,
      avg: row.market_avg_eur,
      checkedAt: row.checked_at,
      sampleCount: row.sample_count,
    });
  }
  return map;
}

async function buildLatestPriceMetadataLookup(): Promise<LatestPriceMetadataLookup> {
  const checks = await listLatestEstonianPriceCheckMetadata();
  const map = new Map<string, { checkedAt: string; sampleCount: number }>();
  for (const row of checks) {
    map.set(`${row.category}:${row.item_id}`, {
      checkedAt: row.checked_at,
      sampleCount: row.sample_count,
    });
  }
  return map;
}

function resolvePrice(
  category: string,
  itemId: number,
  basePrice: number,
  priceLookup: PriceLookup,
  latestMetadataLookup?: LatestPriceMetadataLookup,
) {
  const fromMarket = priceLookup.get(`${category}:${itemId}`);
  if (fromMarket) {
    return {
      preorderPriceEur: Math.round(fromMarket.final),
      marketAvgEur: Number(fromMarket.avg.toFixed(2)),
      priceSource: "market_live" as const,
      checkedAt: fromMarket.checkedAt,
      sampleCount: fromMarket.sampleCount,
      marketDataStatus: "fresh" as const,
      latestCheckedAt: fromMarket.checkedAt,
      latestSampleCount: fromMarket.sampleCount,
    };
  }
  const latest = latestMetadataLookup?.get(`${category}:${itemId}`);
  const latestIsStale = latest ? latest.checkedAt < getTrustedPriceCutoffIso() : false;
  return {
    preorderPriceEur: Math.round(basePrice * ASSEMBLY_MARKUP_MULTIPLIER),
    marketAvgEur: null,
    priceSource: "seed_fallback" as const,
    checkedAt: null,
    sampleCount: null,
    marketDataStatus: latestIsStale ? "stale" as const : "none" as const,
    latestCheckedAt: latestIsStale ? latest?.checkedAt ?? null : null,
    latestSampleCount: latestIsStale ? latest?.sampleCount ?? null : null,
  };
}

type ItemRow = { id: number; price_eur: number };

function computeBuildComponentTotals(
  builds: ProfileBuildWithNamesRecord[],
  priceLookup: PriceLookup,
  itemMaps: {
    cpu: Map<number, ItemRow>;
    gpu: Map<number, ItemRow>;
    ram_kit: Map<number, ItemRow>;
    storage_drive: Map<number, ItemRow>;
    motherboard: Map<number, ItemRow>;
    power_supply: Map<number, ItemRow>;
    case: Map<number, ItemRow>;
    cpu_cooler: Map<number, ItemRow>;
  },
): Map<number, number> {
  const result = new Map<number, number>();

  const slots: Array<{ cat: keyof typeof itemMaps; idKey: string }> = [
    { cat: "cpu", idKey: "cpu_id" },
    { cat: "gpu", idKey: "gpu_id" },
    { cat: "ram_kit", idKey: "ram_kit_id" },
    { cat: "storage_drive", idKey: "storage_drive_id" },
    { cat: "motherboard", idKey: "motherboard_id" },
    { cat: "power_supply", idKey: "power_supply_id" },
    { cat: "case", idKey: "case_id" },
    { cat: "cpu_cooler", idKey: "cpu_cooler_id" },
  ];

  for (const build of builds) {
    let total = 0;
    for (const slot of slots) {
      const id = (build as Record<string, unknown>)[slot.idKey];
      if (!id || typeof id !== "number") continue;
      const item = itemMaps[slot.cat]?.get(id);
      if (!item) continue;
      const p = resolvePrice(slot.cat, id, item.price_eur, priceLookup);
      total += p.preorderPriceEur;
    }
    result.set(build.id, total);
  }

  return result;
}

function summarizeBuildPricing(
  build: ProfileBuildWithNamesRecord,
  priceLookup: PriceLookup,
): Pick<PublicProfileBuild, "pricingLiveCount" | "pricingFallbackCount" | "oldestCheckedAt" | "lowestSampleCount"> {
  const ids: Array<{ cat: CatalogItemType; id: number | null }> = [
    { cat: "cpu", id: build.cpu_id },
    { cat: "gpu", id: build.gpu_id },
    { cat: "ram_kit", id: build.ram_kit_id },
    { cat: "storage_drive", id: build.storage_drive_id },
    { cat: "motherboard", id: build.motherboard_id },
    { cat: "power_supply", id: build.power_supply_id },
    { cat: "case", id: build.case_id },
    { cat: "cpu_cooler", id: build.cpu_cooler_id },
  ];

  let pricingLiveCount = 0;
  let pricingFallbackCount = 0;
  let oldestCheckedAt: string | null = null;
  let lowestSampleCount: number | null = null;

  for (const item of ids) {
    if (!item.id) continue;
    const check = priceLookup.get(`${item.cat}:${item.id}`);
    if (!check) {
      pricingFallbackCount++;
      continue;
    }
    pricingLiveCount++;
    if (!oldestCheckedAt || check.checkedAt < oldestCheckedAt) oldestCheckedAt = check.checkedAt;
    lowestSampleCount = lowestSampleCount === null ? check.sampleCount : Math.min(lowestSampleCount, check.sampleCount);
  }

  return { pricingLiveCount, pricingFallbackCount, oldestCheckedAt, lowestSampleCount };
}

// ── Build mappers ──

function mapProfileBuild(build: ProfileBuildWithNamesRecord): PublicProfileBuild {
  return {
    id: build.id,
    profileKey: build.profile_key,
    profileLabel: build.profile_label,
    buildName: build.build_name,
    targetModel: build.target_model,
    ramGb: build.ram_gb,
    storageGb: build.storage_gb,
    bestFor: build.best_for,
    estimatedTokensPerSec: build.estimated_tokens_per_sec,
    estimatedSystemPowerW: build.estimated_system_power_w,
    recommendedPsuW: build.recommended_psu_w,
    coolingProfile: build.cooling_profile,
    notes: build.notes,
    sourceRefs: build.source_refs,
    cpuName: build.cpu_name,
    gpuName: build.gpu_name,
    gpuVramGb: build.gpu_vram_gb,
    gpuArchitecture: build.gpu_architecture,
  };
}

// ── Home catalog view (full) ──

async function getHomeCatalogViewUncached() {
  const [gpuRows, cpuRows, ramKitRows, psuRows, caseRows, mbRows, compactRows, storageRows, coolerRows, macSystemRows, enclosureRows, profileRows, priceChecks, latestPriceMetadata] = await Promise.all([
    listGpus(), listCpus(), listRamKits(), listPowerSupplies(), listCases(), listMotherboards(),
    listCompactAiSystems(), listStorageDrives(), listCpuCoolers(), listMacSystems(),
    listExternalGpuEnclosures(), listProfileBuilds(), listEstonianPriceChecks(), listLatestEstonianPriceCheckMetadata(),
  ]);

  const pl: PriceLookup = new Map();
  for (const row of priceChecks) {
    pl.set(`${row.category}:${row.item_id}`, {
      final: row.final_price_eur,
      avg: row.market_avg_eur,
      checkedAt: row.checked_at,
      sampleCount: row.sample_count,
    });
  }
  const latest: LatestPriceMetadataLookup = new Map();
  for (const row of latestPriceMetadata) {
    latest.set(`${row.category}:${row.item_id}`, {
      checkedAt: row.checked_at,
      sampleCount: row.sample_count,
    });
  }

  const resolve = (cat: string, id: number, base: number) => resolvePrice(cat, id, base, pl, latest);

  const gpus: PublicGpu[] = gpuRows.map((g) => ({ ...resolve("gpu", g.id, g.price_eur), id: g.id, name: g.name, brand: g.brand, vramGb: g.vram_gb, architecture: g.architecture, aiScore: g.ai_score, priceEur: g.price_eur, mpn: g.mpn, releaseYear: g.release_year, releaseQuarter: g.release_quarter, displayPowerW: g.display_power_w, connectorStandard: g.connector_standard, minimumPsuW: g.minimum_psu_w, dualGpuCapable: g.dual_gpu_capable === 1 }));
  const cpus: PublicCpu[] = cpuRows.map((c) => ({ ...resolve("cpu", c.id, c.price_eur), id: c.id, name: c.name, brand: c.brand, cores: c.cores, threads: c.threads, socket: c.socket, aiScore: c.ai_score, priceEur: c.price_eur, mpn: c.mpn, releaseYear: c.release_year, releaseQuarter: c.release_quarter, platformGeneration: c.platform_generation, memoryChannels: c.memory_channels, eccSupport: c.ecc_support === 1 }));
  const ramKits: PublicRamKit[] = ramKitRows.map((r) => ({ ...resolve("ram_kit", r.id, r.price_eur), id: r.id, name: r.name, brand: r.brand, capacityGb: r.capacity_gb, modules: r.modules, ddrGen: r.ddr_gen, speedMtS: r.speed_mt_s, casLatency: r.cas_latency, profileSupport: r.profile_support, priceEur: r.price_eur }));
  const powerSupplies: PublicPowerSupply[] = psuRows.map((p) => ({ ...resolve("power_supply", p.id, p.price_eur), id: p.id, name: p.name, brand: p.brand, wattage: p.wattage, efficiencyRating: p.efficiency_rating, atxStandard: p.atx_standard, modularity: p.modularity, pcie5Support: p.pcie_5_support === 1, priceEur: p.price_eur }));
  const cases: PublicCase[] = caseRows.map((c) => ({ ...resolve("case", c.id, c.price_eur), id: c.id, name: c.name, brand: c.brand, formFactor: c.form_factor, maxGpuMm: c.max_gpu_mm, radiatorSupport: c.radiator_support, includedFans: c.included_fans, priceEur: c.price_eur }));
  const motherboards: PublicMotherboard[] = mbRows.map((m) => ({ ...resolve("motherboard", m.id, m.price_eur), id: m.id, name: m.name, brand: m.brand, socket: m.socket, chipset: m.chipset, memorySupport: m.memory_support, maxMemoryGb: m.max_memory_gb, pcieGen5Support: m.pcie_gen5_support === 1, priceEur: m.price_eur }));
  const compactAiSystems: PublicCompactAiSystem[] = compactRows.map((s) => ({ ...resolve("compact_ai_system", s.id, s.price_eur), id: s.id, name: s.name, vendor: s.vendor, chip: s.chip, memoryGb: s.memory_gb, storageGb: s.storage_gb, gpuClass: s.gpu_class, installedSoftware: s.installed_software, bestFor: s.best_for, inStock: s.in_stock === 1, priceEur: s.price_eur }));
  const storageDrives: PublicStorageDrive[] = storageRows.map((d) => ({ ...resolve("storage_drive", d.id, d.price_eur), id: d.id, name: d.name, brand: d.brand, driveType: d.drive_type, interface: d.interface, capacityGb: d.capacity_gb, seqReadMbS: d.seq_read_mb_s, enduranceTbw: d.endurance_tbw, interfaceGeneration: d.interface_generation, priceEur: d.price_eur }));
  const cpuCoolers: PublicCpuCooler[] = coolerRows.map((c) => ({ ...resolve("cpu_cooler", c.id, c.price_eur), id: c.id, name: c.name, brand: c.brand, coolerType: c.cooler_type, radiatorOrHeightMm: c.radiator_or_height_mm, socketSupport: c.socket_support, maxTdpW: c.max_tdp_w, noiseDb: c.noise_db, priceEur: c.price_eur }));
  const macSystems: PublicMacSystem[] = macSystemRows.map((m) => {
    const p = resolve("mac_system", m.id, m.estimated_price_eur);
    return { ...p, id: m.id, name: m.name, chip: m.chip, cpuCores: m.cpu_cores, gpuCores: m.gpu_cores, unifiedMemoryGb: m.unified_memory_gb, storageGb: m.storage_gb, ports: m.ports, thunderboltVersion: m.thunderbolt_version, usb4Supported: m.usb4_supported === 1, macosMinVersion: m.macos_min_version, notes: m.notes };
  });
  const externalGpuEnclosures: PublicExternalGpuEnclosure[] = enclosureRows.map((e) => {
    const p = resolve("external_gpu_enclosure", e.id, e.estimated_price_eur);
    return { ...p, id: e.id, name: e.name, connectionType: e.connection_type, pcieGeneration: e.pcie_generation, pcieLanes: e.pcie_lanes, maxGpuLengthMm: e.max_gpu_length_mm, maxGpuSlots: e.max_gpu_slots, includedPsuWatts: e.included_psu_watts, requiresExternalPsu: e.requires_external_psu === 1, supportsOpenFrame: e.supports_open_frame === 1, notes: e.notes };
  });
  const componentTotals = computeBuildComponentTotals(profileRows, pl, {
    cpu: new Map(cpuRows.map((r) => [r.id, r])),
    gpu: new Map(gpuRows.map((r) => [r.id, r])),
    ram_kit: new Map(ramKitRows.map((r) => [r.id, r])),
    storage_drive: new Map(storageRows.map((r) => [r.id, r])),
    motherboard: new Map(mbRows.map((r) => [r.id, r])),
    power_supply: new Map(psuRows.map((r) => [r.id, r])),
    case: new Map(caseRows.map((r) => [r.id, r])),
    cpu_cooler: new Map(coolerRows.map((r) => [r.id, r])),
  });
  const profileBuilds: PublicProfileBuild[] = profileRows.map((b) => ({
    ...mapProfileBuild(b),
    componentTotalEur: componentTotals.get(b.id) || undefined,
    ...summarizeBuildPricing(b, pl),
  }));

  return { gpus, cpus, ramKits, powerSupplies, cases, motherboards, compactAiSystems, storageDrives, cpuCoolers, macSystems, externalGpuEnclosures, profileBuilds };
}

export const getHomeCatalogView = publicDataCache(
  getHomeCatalogViewUncached,
  ["public-home-catalog-view-v1"],
  ["public-catalog"],
);

// ── Profile-only view (lighter) ──

async function getProfileViewUncached() {
  const [profileRows, compactRows, macEgpuRows, macSystemRows, enclosureRows, gpuRows, cpuRows, ramKitRows, storageRows, mbRows, psuRows, caseRows, coolerRows, priceChecks, latestPriceMetadata] = await Promise.all([
    listProfileBuilds(), listCompactAiSystems(), listMacEgpuBuilds(),
    listMacSystems(), listExternalGpuEnclosures(), listGpus(),
    listCpus(), listRamKits(), listStorageDrives(), listMotherboards(),
    listPowerSupplies(), listCases(), listCpuCoolers(), listEstonianPriceChecks(), listLatestEstonianPriceCheckMetadata(),
  ]);

  const pl: PriceLookup = new Map();
  for (const row of priceChecks) {
    pl.set(`${row.category}:${row.item_id}`, {
      final: row.final_price_eur,
      avg: row.market_avg_eur,
      checkedAt: row.checked_at,
      sampleCount: row.sample_count,
    });
  }
  const latest: LatestPriceMetadataLookup = new Map();
  for (const row of latestPriceMetadata) {
    latest.set(`${row.category}:${row.item_id}`, {
      checkedAt: row.checked_at,
      sampleCount: row.sample_count,
    });
  }

  const resolve = (cat: string, id: number, base: number) => resolvePrice(cat, id, base, pl, latest);

  const componentTotals = computeBuildComponentTotals(profileRows, pl, {
    cpu: new Map(cpuRows.map((r) => [r.id, r])),
    gpu: new Map(gpuRows.map((r) => [r.id, r])),
    ram_kit: new Map(ramKitRows.map((r) => [r.id, r])),
    storage_drive: new Map(storageRows.map((r) => [r.id, r])),
    motherboard: new Map(mbRows.map((r) => [r.id, r])),
    power_supply: new Map(psuRows.map((r) => [r.id, r])),
    case: new Map(caseRows.map((r) => [r.id, r])),
    cpu_cooler: new Map(coolerRows.map((r) => [r.id, r])),
  });

  const profileBuilds: PublicProfileBuild[] = profileRows.map((b) => ({
    ...mapProfileBuild(b),
    componentTotalEur: componentTotals.get(b.id) || undefined,
    ...summarizeBuildPricing(b, pl),
  }));

  const compactAiSystems: PublicCompactAiSystem[] = compactRows.map((s) => ({ ...resolve("compact_ai_system", s.id, s.price_eur), id: s.id, name: s.name, vendor: s.vendor, chip: s.chip, memoryGb: s.memory_gb, storageGb: s.storage_gb, gpuClass: s.gpu_class, installedSoftware: s.installed_software, bestFor: s.best_for, inStock: s.in_stock === 1, priceEur: s.price_eur }));
  const macSystems: PublicMacSystem[] = macSystemRows.map((m) => {
    const p = resolve("mac_system", m.id, m.estimated_price_eur);
    return { ...p, id: m.id, name: m.name, chip: m.chip, cpuCores: m.cpu_cores, gpuCores: m.gpu_cores, unifiedMemoryGb: m.unified_memory_gb, storageGb: m.storage_gb, ports: m.ports, thunderboltVersion: m.thunderbolt_version, usb4Supported: m.usb4_supported === 1, macosMinVersion: m.macos_min_version, notes: m.notes };
  });

  const macSystemMap = new Map(macSystemRows.map((m) => [m.id, m]));
  const enclosureMap = new Map(enclosureRows.map((e) => [e.id, e]));
  const gpuMap = new Map(gpuRows.map((g) => [g.id, g]));

  const macEgpuBuilds: PublicMacEgpuBuild[] = macEgpuRows.map((b) => {
    const mac = macSystemMap.get(b.mac_system_id);
    const enc = enclosureMap.get(b.egpu_enclosure_id);
    const gpu = gpuMap.get(b.gpu_id);
    const macBase = mac?.estimated_price_eur ?? 0;
    const macMarket = (() => { const p = pl.get(`mac_system:${b.mac_system_id}`); return p ? Math.round(p.final) : null; })();
    const encBase = enc?.estimated_price_eur ?? 0;
    const encMarket = (() => { const p = pl.get(`external_gpu_enclosure:${b.egpu_enclosure_id}`); return p ? Math.round(p.final) : null; })();
    return {
      id: b.id, name: b.name,
      macSystemName: mac?.name ?? "Unknown", macSystemChip: mac?.chip ?? "Unknown",
      macSystemMemoryGb: mac?.unified_memory_gb ?? 0, macSystemStorageGb: mac?.storage_gb ?? 0,
      macSystemBasePriceEur: macBase, macSystemMarketPriceEur: macMarket,
      egpuEnclosureName: enc?.name ?? "Unknown", egpuEnclosureBasePriceEur: encBase, egpuEnclosureMarketPriceEur: encMarket,
      gpuName: gpu?.name ?? "Unknown", gpuVramGb: gpu?.vram_gb ?? 0, gpuArchitecture: gpu?.architecture ?? "Unknown",
      targetWorkloads: b.target_workloads.split(", ").filter(Boolean),
      unsupportedWorkloads: b.unsupported_workloads.split(", ").filter(Boolean),
      riskLevel: b.risk_level as "experimental" | "advanced" | "stable",
      buyerWarning: b.buyer_warning, notes: b.notes,
    };
  });

  return { profileBuilds, compactAiSystems, macSystems, macEgpuBuilds };
}

export const getProfileView = publicDataCache(
  getProfileViewUncached,
  ["public-profile-view-v1"],
  ["public-catalog"],
);

// ── Build detail ──

async function getBuildDetailViewUncached(buildId: number): Promise<PublicProfileBuild | null> {
  const build = await getProfileBuildById(buildId);
  if (!build) return null;

  const [pl, latest, checkoutEligibility] = await Promise.all([
    buildPriceLookup(),
    buildLatestPriceMetadataLookup(),
    getBuildCheckoutEligibility(buildId),
  ]);

  const componentPrices: ComponentPriceEntry[] = [];
  const missingComponents: string[] = [];

  const resolveAndPush = async (
    label: string,
    category: CatalogItemType,
    id: number | null,
    fetcher: () => Promise<{ id: number; name: string; price_eur: number } | null>,
  ) => {
    if (!id) {
      missingComponents.push(label);
      return;
    }
    const item = await fetcher();
    if (!item) {
      missingComponents.push(label);
      return;
    }
    const resolved = resolvePrice(category, item.id, item.price_eur, pl, latest);
    componentPrices.push({
      label,
      name: item.name,
      category,
      itemId: item.id,
      priceEur: resolved.preorderPriceEur,
      marketAvgEur: resolved.marketAvgEur,
      priceSource: resolved.priceSource,
      checkedAt: resolved.checkedAt,
      sampleCount: resolved.sampleCount,
      marketDataStatus: resolved.marketDataStatus,
      latestCheckedAt: resolved.latestCheckedAt,
      latestSampleCount: resolved.latestSampleCount,
    });
  };

  await Promise.all([
    resolveAndPush("CPU", "cpu", build.cpu_id, () => getCpuById(build.cpu_id)),
    resolveAndPush("GPU", "gpu", build.gpu_id, () => getGpuById(build.gpu_id)),
    resolveAndPush("RAM", "ram_kit", build.ram_kit_id, () => getRamKitById(build.ram_kit_id!)),
    resolveAndPush("Storage", "storage_drive", build.storage_drive_id, () => getStorageDriveById(build.storage_drive_id!)),
    resolveAndPush("Motherboard", "motherboard", build.motherboard_id, () => getMotherboardById(build.motherboard_id!)),
    resolveAndPush("PSU", "power_supply", build.power_supply_id, () => getPowerSupplyById(build.power_supply_id!)),
    resolveAndPush("Case", "case", build.case_id, () => getCaseById(build.case_id!)),
    resolveAndPush("Cooler", "cpu_cooler", build.cpu_cooler_id, () => getCpuCoolerById(build.cpu_cooler_id!)),
  ]);

  const componentTotalEur = componentPrices.reduce((sum, p) => sum + p.priceEur, 0);

  return {
    ...mapProfileBuild(build),
    componentPrices: componentPrices.length > 0 ? componentPrices : undefined,
    componentTotalEur: componentTotalEur > 0 ? componentTotalEur : undefined,
    missingComponents: missingComponents.length > 0 ? missingComponents : undefined,
    ...summarizeBuildPricing(build, pl),
    checkoutEligible: checkoutEligibility.eligible,
    checkoutDisabledReason: checkoutEligibility.reason,
    checkoutBlockers: checkoutEligibility.blockers,
    checkoutMaxOrderEur: checkoutEligibility.maxOrderEur,
    checkoutOrderPriceEur: checkoutEligibility.orderPriceEur,
  };
}

export const getBuildDetailView = publicDataCache(
  getBuildDetailViewUncached,
  ["public-build-detail-view-v1"],
  ["public-catalog", "public-build-detail"],
);

// ── Catalog item detail ──

async function getCatalogItemDetailViewUncached(itemType: CatalogItemType, itemId: number): Promise<PublicCatalogItemDetail | null> {
  const [pl, latest] = await Promise.all([buildPriceLookup(), buildLatestPriceMetadataLookup()]);
  const resolve = (cat: string, id: number, base: number) => resolvePrice(cat, id, base, pl, latest);
  const releaseLabel = (year: number, quarter: string) => (year > 0 ? `${year}${quarter ? ` ${quarter}` : ""}` : "n/a");

  const handlers: Record<string, () => Promise<PublicCatalogItemDetail | null>> = {
    gpu: async () => {
      const i = await getGpuById(itemId);
      if (!i) return null;
      const p = resolve("gpu", i.id, i.price_eur);
      return {
        ...p,
        itemType,
        itemId,
        name: i.name,
        subtitle: `${i.brand} graphics card`,
        preorderPriceEur: p.preorderPriceEur,
        marketAvgEur: p.marketAvgEur,
        basePriceEur: i.price_eur,
        checkoutItemType: itemType,
        purchasable: true,
        specs: [
          { label: "Brand", value: i.brand },
          { label: "MPN / SKU", value: i.mpn || "n/a" },
          { label: "Release", value: releaseLabel(i.release_year, i.release_quarter) },
          { label: "VRAM", value: `${i.vram_gb}GB ${i.vram_type}` },
          { label: "Architecture", value: i.architecture },
          { label: "Display Power", value: i.display_power_w ? `${i.display_power_w}W` : "n/a" },
          { label: "Connector Standard", value: i.connector_standard || "n/a" },
          { label: "Minimum PSU", value: i.minimum_psu_w ? `${i.minimum_psu_w}W` : "n/a" },
          { label: "Dual GPU Capable", value: i.dual_gpu_capable ? "Yes" : "No" },
          { label: "Memory Bus", value: i.memory_bus_bits ? `${i.memory_bus_bits}-bit` : "n/a" },
          { label: "Bandwidth", value: i.memory_bandwidth_gbps ? `${i.memory_bandwidth_gbps} GB/s` : "n/a" },
          { label: "CUDA Cores", value: i.cuda_cores ? String(i.cuda_cores) : "n/a" },
          { label: "Stream Processors", value: i.stream_processors ? String(i.stream_processors) : "n/a" },
          { label: "Tensor Cores", value: i.tensor_cores ? String(i.tensor_cores) : "n/a" },
          { label: "RT Cores", value: i.rt_cores ? String(i.rt_cores) : "n/a" },
          { label: "Base / Boost Clock", value: i.base_clock_mhz ? `${i.base_clock_mhz} / ${i.boost_clock_mhz} MHz` : "n/a" },
          { label: "TDP", value: `${i.tdp_watts}W` },
          { label: "PCIe Generation", value: i.pcie_generation || "n/a" },
          { label: "Slot Width", value: i.slot_width ? `${i.slot_width}-slot` : "n/a" },
          { label: "Length", value: i.length_mm ? `${i.length_mm}mm` : "n/a" },
          { label: "Power Connectors", value: i.power_connectors || "n/a" },
          { label: "Recommended PSU", value: i.recommended_psu_w ? `${i.recommended_psu_w}W` : "n/a" },
          { label: "FP16 Tensor", value: i.fp16_tensor_tflops ? `${i.fp16_tensor_tflops} TFLOPS` : "n/a" },
          { label: "FP32", value: i.fp32_tflops ? `${i.fp32_tflops} TFLOPS` : "n/a" },
          { label: "AI Score", value: String(i.ai_score) },
          { label: "Source", value: i.source_refs || "n/a" },
          { label: "Inference Notes", value: i.inference_notes || "n/a" },
        ].filter((s) => s.value !== "n/a" && s.value !== "0" && s.value !== ""),
      };
    },
    cpu: async () => {
      const i = await getCpuById(itemId);
      if (!i) return null;
      const p = resolve("cpu", i.id, i.price_eur);
      return {
        ...p,
        itemType,
        itemId,
        name: i.name,
        subtitle: `${i.brand} processor`,
        preorderPriceEur: p.preorderPriceEur,
        marketAvgEur: p.marketAvgEur,
        basePriceEur: i.price_eur,
        checkoutItemType: itemType,
        purchasable: true,
        specs: [
          { label: "Brand", value: i.brand },
          { label: "MPN / SKU", value: i.mpn || "n/a" },
          { label: "Release", value: releaseLabel(i.release_year, i.release_quarter) },
          { label: "Platform", value: i.platform_generation || "n/a" },
          { label: "Cores / Threads", value: `${i.cores} / ${i.threads}` },
          { label: "Base / Boost Clock", value: `${i.base_clock_ghz} / ${i.boost_clock_ghz} GHz` },
          { label: "Socket", value: i.socket },
          { label: "TDP", value: `${i.tdp_watts}W` },
          { label: "L3 Cache", value: i.cache_l3_mb ? `${i.cache_l3_mb}MB` : "n/a" },
          { label: "Integrated Graphics", value: i.integrated_graphics || "None" },
          { label: "Memory Support", value: i.memory_type_support || "n/a" },
          { label: "Memory Channels", value: i.memory_channels ? String(i.memory_channels) : "n/a" },
          { label: "ECC Support", value: i.ecc_support ? "Yes" : "No" },
          { label: "Max Memory", value: i.max_memory_gb ? `${i.max_memory_gb}GB` : "n/a" },
          { label: "PCIe Generation", value: i.pcie_generation || "n/a" },
          { label: "Unlocked", value: i.unlocked ? "Yes" : "No" },
          { label: "Cooler Included", value: i.cooler_included ? "Yes" : "No" },
          { label: "AI Score", value: String(i.ai_score) },
          { label: "Source", value: i.source_refs || "n/a" },
        ].filter((s) => s.value !== "n/a" && s.value !== "0" && s.value !== ""),
      };
    },
    ram_kit: async () => { const i = await getRamKitById(itemId); if (!i) return null; const p = resolve("ram_kit", i.id, i.price_eur); return { ...p, itemType, itemId, name: i.name, subtitle: `${i.brand} memory kit`, preorderPriceEur: p.preorderPriceEur, marketAvgEur: p.marketAvgEur, basePriceEur: i.price_eur, checkoutItemType: itemType, purchasable: true, specs: [{ label: "Capacity", value: `${i.capacity_gb}GB (${i.modules})` }, { label: "Generation", value: i.ddr_gen }, { label: "Speed", value: `${i.speed_mt_s} MT/s` }, { label: "Latency", value: i.cas_latency }, { label: "Profiles", value: i.profile_support }, { label: "Voltage", value: i.voltage ? `${i.voltage}V` : "n/a" }, { label: "ECC", value: i.ecc ? "Yes" : "No" }, { label: "Registered", value: i.registered ? "Yes" : "No" }, { label: "Recommended Platform", value: i.recommended_platform || "n/a" }].filter((s) => s.value !== "n/a" && s.value !== "") }; },
    power_supply: async () => { const i = await getPowerSupplyById(itemId); if (!i) return null; const p = resolve("power_supply", i.id, i.price_eur); return { ...p, itemType, itemId, name: i.name, subtitle: `${i.brand} power supply`, preorderPriceEur: p.preorderPriceEur, marketAvgEur: p.marketAvgEur, basePriceEur: i.price_eur, checkoutItemType: itemType, purchasable: true, specs: [{ label: "Wattage", value: `${i.wattage}W` }, { label: "Efficiency", value: i.efficiency_rating }, { label: "ATX Standard", value: i.atx_standard }, { label: "Modularity", value: i.modularity }, { label: "PCIe5 / 12V-2x6", value: i.pcie_5_support ? "Supported" : "No" }, { label: "Native 12VHPWR", value: i.native_12vhpwr ? "Yes" : "No" }, { label: "GPU Connectors", value: i.gpu_connector_count ? String(i.gpu_connector_count) : "n/a" }, { label: "Form Factor", value: i.psu_form_factor || "ATX" }, { label: "Warranty", value: i.warranty_years ? `${i.warranty_years} years` : "n/a" }].filter((s) => s.value !== "n/a" && s.value !== "") }; },
    case: async () => { const i = await getCaseById(itemId); if (!i) return null; const p = resolve("case", i.id, i.price_eur); return { ...p, itemType, itemId, name: i.name, subtitle: `${i.brand} PC case`, preorderPriceEur: p.preorderPriceEur, marketAvgEur: p.marketAvgEur, basePriceEur: i.price_eur, checkoutItemType: itemType, purchasable: true, specs: [{ label: "Form Factor", value: i.form_factor }, { label: "Max GPU Length", value: `${i.max_gpu_mm}mm` }, { label: "Radiator Support", value: i.radiator_support }, { label: "Included Fans", value: i.included_fans }, { label: "Max CPU Cooler Height", value: i.max_cpu_cooler_height_mm ? `${i.max_cpu_cooler_height_mm}mm` : "n/a" }, { label: "Max PSU Length", value: i.max_psu_length_mm ? `${i.max_psu_length_mm}mm` : "n/a" }, { label: "Dimensions", value: i.dimensions_mm || "n/a" }, { label: "Drive Bays", value: i.drive_bays || "n/a" }, { label: "Airflow", value: i.airflow_notes || "n/a" }].filter((s) => s.value !== "n/a" && s.value !== "") }; },
    motherboard: async () => { const i = await getMotherboardById(itemId); if (!i) return null; const p = resolve("motherboard", i.id, i.price_eur); return { ...p, itemType, itemId, name: i.name, subtitle: `${i.brand} motherboard`, preorderPriceEur: p.preorderPriceEur, marketAvgEur: p.marketAvgEur, basePriceEur: i.price_eur, checkoutItemType: itemType, purchasable: true, specs: [{ label: "Socket", value: i.socket }, { label: "Chipset", value: i.chipset }, { label: "Form Factor", value: i.form_factor || "n/a" }, { label: "Memory Support", value: i.memory_support }, { label: "Memory Slots", value: i.memory_slots ? String(i.memory_slots) : "n/a" }, { label: "Max Memory", value: `${i.max_memory_gb}GB` }, { label: "PCIe Gen5", value: i.pcie_gen5_support ? "Yes" : "No" }, { label: "PCIe x16 Slots", value: i.pcie_x16_slots ? String(i.pcie_x16_slots) : "n/a" }, { label: "M.2 Slots", value: i.m2_slots ? String(i.m2_slots) : "n/a" }, { label: "SATA Ports", value: i.sata_ports ? String(i.sata_ports) : "n/a" }, { label: "Ethernet", value: i.ethernet || "n/a" }, { label: "WiFi", value: i.wifi || "n/a" }, { label: "USB4", value: i.usb4_support ? "Yes" : "No" }, { label: "Thunderbolt", value: i.thunderbolt_support ? "Yes" : "No" }, { label: "BIOS Flashback", value: i.bios_flashback ? "Yes" : "No" }, { label: "Notes", value: i.mb_notes || "n/a" }].filter((s) => s.value !== "n/a" && s.value !== "") }; },
    compact_ai_system: async () => { const i = await getCompactAiSystemById(itemId); if (!i) return null; const p = resolve("compact_ai_system", i.id, i.price_eur); return { ...p, itemType, itemId, name: i.name, subtitle: `${i.vendor} compact AI system`, preorderPriceEur: p.preorderPriceEur, marketAvgEur: p.marketAvgEur, basePriceEur: i.price_eur, checkoutItemType: itemType, purchasable: true, specs: [{ label: "Chip", value: i.chip }, { label: "Memory", value: `${i.memory_gb}GB unified` }, { label: "Storage", value: `${i.storage_gb}GB SSD` }, { label: "GPU Class", value: i.gpu_class }, { label: "Installed Software", value: i.installed_software }, { label: "Stock", value: i.in_stock ? "In Stock" : "Out of Stock" }] }; },
    storage_drive: async () => { const i = await getStorageDriveById(itemId); if (!i) return null; const p = resolve("storage_drive", i.id, i.price_eur); return { ...p, itemType, itemId, name: i.name, subtitle: `${i.brand} storage drive`, preorderPriceEur: p.preorderPriceEur, marketAvgEur: p.marketAvgEur, basePriceEur: i.price_eur, checkoutItemType: itemType, purchasable: true, specs: [{ label: "Type", value: i.drive_type }, { label: "Interface", value: i.interface }, { label: "Interface Generation", value: i.interface_generation || "n/a" }, { label: "Form Factor", value: i.form_factor || "n/a" }, { label: "PCIe Gen", value: i.pcie_generation || "n/a" }, { label: "Capacity", value: `${i.capacity_gb}GB` }, { label: "Seq Read", value: `${i.seq_read_mb_s} MB/s` }, { label: "Seq Write", value: i.seq_write_mb_s ? `${i.seq_write_mb_s} MB/s` : "n/a" }, { label: "Endurance", value: i.endurance_tbw === 0 ? "n/a" : `${i.endurance_tbw} TBW` }, { label: "DRAM Cache", value: i.dram_cache ? "Yes" : "n/a" }, { label: "NAND Type", value: i.nand_type || "n/a" }, { label: "Warranty", value: i.warranty_years ? `${i.warranty_years} years` : "n/a" }].filter((s) => s.value !== "n/a" && s.value !== "") }; },
    cpu_cooler: async () => { const i = await getCpuCoolerById(itemId); if (!i) return null; const p = resolve("cpu_cooler", i.id, i.price_eur); return { ...p, itemType: "cpu_cooler", itemId, name: i.name, subtitle: `${i.brand} CPU cooler`, preorderPriceEur: p.preorderPriceEur, marketAvgEur: p.marketAvgEur, basePriceEur: i.price_eur, checkoutItemType: "cpu_cooler", purchasable: true, specs: [{ label: "Type", value: i.cooler_type }, { label: "Height / Radiator", value: `${i.radiator_or_height_mm}mm` }, { label: "Socket Support", value: i.socket_support }, { label: "Max TDP", value: `${i.max_tdp_w}W` }, { label: "Noise", value: i.noise_db }, { label: "Fan Size", value: i.fan_size_mm ? `${i.fan_size_mm}mm` : "n/a" }, { label: "RAM Clearance", value: i.ram_clearance_notes || "n/a" }].filter((s) => s.value !== "n/a" && s.value !== "") }; },
    mac_system: async () => { const i = await getMacSystemById(itemId); if (!i) return null; const p = resolve("mac_system", i.id, i.estimated_price_eur); return { ...p, itemType: "mac_system", itemId, name: i.name, subtitle: "Apple Mac system", preorderPriceEur: p.preorderPriceEur, marketAvgEur: p.marketAvgEur, basePriceEur: i.estimated_price_eur, checkoutItemType: "mac_system", purchasable: false, specs: [{ label: "Chip", value: i.chip }, { label: "CPU / GPU Cores", value: `${i.cpu_cores} / ${i.gpu_cores}` }, { label: "Neural Engine", value: i.neural_engine_cores ? `${i.neural_engine_cores} cores` : "n/a" }, { label: "Unified Memory", value: `${i.unified_memory_gb}GB` }, { label: "Memory Bandwidth", value: i.memory_bandwidth_gbps ? `${i.memory_bandwidth_gbps} GB/s` : "n/a" }, { label: "Storage", value: `${i.storage_gb}GB SSD` }, { label: "Ports", value: i.ports }, { label: "Thunderbolt", value: i.thunderbolt_version }, { label: "USB4", value: i.usb4_supported ? "Yes" : "No" }, { label: "eGPU Support", value: i.external_gpu_support ? "Yes (via Thunderbolt)" : "No (Apple Silicon)" }, { label: "macOS Min", value: i.macos_min_version }, { label: "AI Frameworks", value: i.ai_framework_notes || "n/a" }, { label: "Local LLM Notes", value: i.local_llm_notes || "n/a" }].filter((s) => s.value !== "n/a" && s.value !== "") }; },
    external_gpu_enclosure: async () => { const i = await getExternalGpuEnclosureById(itemId); if (!i) return null; const p = resolve("external_gpu_enclosure", i.id, i.estimated_price_eur); return { ...p, itemType: "external_gpu_enclosure", itemId, name: i.name, subtitle: "External GPU enclosure", preorderPriceEur: p.preorderPriceEur, marketAvgEur: p.marketAvgEur, basePriceEur: i.estimated_price_eur, checkoutItemType: "external_gpu_enclosure", purchasable: false, specs: [{ label: "Connection", value: i.connection_type }, { label: "Thunderbolt", value: i.thunderbolt_version || "n/a" }, { label: "PCIe Generation", value: `${i.pcie_generation} x${i.pcie_lanes}` }, { label: "Max GPU Length", value: `${i.max_gpu_length_mm}mm` }, { label: "Max GPU Slots", value: String(i.max_gpu_slots) }, { label: "Included PSU", value: i.included_psu_watts > 0 ? `${i.included_psu_watts}W` : "None (external required)" }, { label: "Open Frame", value: i.supports_open_frame ? "Yes" : "No" }, { label: "macOS Notes", value: i.macos_support_notes || "n/a" }, { label: "Windows Notes", value: i.windows_support_notes || "n/a" }, { label: "NVIDIA Notes", value: i.nvidia_support_notes || "n/a" }, { label: "AMD Notes", value: i.amd_support_notes || "n/a" }].filter((s) => s.value !== "n/a" && s.value !== "") }; },
  };

  const handler = handlers[itemType];
  if (!handler) return null;
  const detail = await handler();
  if (!detail) return null;

  const checkoutEligibility = await getCatalogItemCheckoutEligibility(detail.checkoutItemType, detail.itemId);
  return {
    ...detail,
    checkoutEligible: checkoutEligibility.eligible,
    checkoutDisabledReason: checkoutEligibility.reason,
  };
}

export const getCatalogItemDetailView = publicDataCache(
  getCatalogItemDetailViewUncached,
  ["public-catalog-item-detail-view-v1"],
  ["public-catalog", "public-catalog-detail"],
);

// ── Price history ──

export type PriceHistoryPoint = {
  date: string;
  price: number;
};

async function getPriceHistoryViewUncached(category: CatalogItemType, itemId: number, days = 30): Promise<PriceHistoryPoint[]> {
  const rows = await getPriceHistory(category, itemId, days);
  const byDate = new Map<string, PriceHistoryPoint>();
  for (const row of rows) {
    const dateKey = row.recorded_date ?? row.recorded_at.slice(0, 10);
    byDate.set(dateKey, { date: dateKey, price: Number(row.price_eur.toFixed(2)) });
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export const getPriceHistoryView = publicDataCache(
  getPriceHistoryViewUncached,
  ["public-price-history-view-v1"],
  ["public-catalog", "public-price-history"],
);

export type PriceHistoryRanges = {
  "7d": PriceHistoryPoint[];
  "30d": PriceHistoryPoint[];
  "90d": PriceHistoryPoint[];
};

function filterPriceHistoryDays(points: PriceHistoryPoint[], days: number): PriceHistoryPoint[] {
  const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return points.filter((point) => point.date >= cutoffDate);
}

export const getPriceHistoryRangesView = cache(async (
  category: CatalogItemType,
  itemId: number,
): Promise<PriceHistoryRanges> => {
  const priceHistory90d = await getPriceHistoryView(category, itemId, 90);
  return {
    "7d": filterPriceHistoryDays(priceHistory90d, 7),
    "30d": filterPriceHistoryDays(priceHistory90d, 30),
    "90d": priceHistory90d,
  };
});

// ── Mac eGPU build detail ──

async function getMacEgpuBuildDetailViewUncached(buildId: number): Promise<PublicMacEgpuBuild | null> {
  const build = await getMacEgpuBuildById(buildId);
  if (!build) return null;

  const [mac, enc, gpu, pl] = await Promise.all([
    getMacSystemById(build.mac_system_id), getExternalGpuEnclosureById(build.egpu_enclosure_id), getGpuById(build.gpu_id), buildPriceLookup(),
  ]);

  const macBase = mac?.estimated_price_eur ?? 0;
  const macMarket = (() => { const p = pl.get(`mac_system:${build.mac_system_id}`); return p ? Math.round(p.final) : null; })();
  const encBase = enc?.estimated_price_eur ?? 0;
  const encMarket = (() => { const p = pl.get(`external_gpu_enclosure:${build.egpu_enclosure_id}`); return p ? Math.round(p.final) : null; })();

  return {
    id: build.id, name: build.name,
    macSystemName: mac?.name ?? "Unknown", macSystemChip: mac?.chip ?? "Unknown",
    macSystemMemoryGb: mac?.unified_memory_gb ?? 0, macSystemStorageGb: mac?.storage_gb ?? 0,
    macSystemBasePriceEur: macBase, macSystemMarketPriceEur: macMarket,
    egpuEnclosureName: enc?.name ?? "Unknown", egpuEnclosureBasePriceEur: encBase, egpuEnclosureMarketPriceEur: encMarket,
    gpuName: gpu?.name ?? "Unknown", gpuVramGb: gpu?.vram_gb ?? 0, gpuArchitecture: gpu?.architecture ?? "Unknown",
    targetWorkloads: build.target_workloads.split(", ").filter(Boolean),
    unsupportedWorkloads: build.unsupported_workloads.split(", ").filter(Boolean),
    riskLevel: build.risk_level as "experimental" | "advanced" | "stable",
    buyerWarning: build.buyer_warning, notes: build.notes,
  };
}

export const getMacEgpuBuildDetailView = publicDataCache(
  getMacEgpuBuildDetailViewUncached,
  ["public-mac-egpu-build-detail-view-v1"],
  ["public-catalog", "public-mac-egpu-detail"],
);

export const listCatalogDetailStaticParams = cache(async (): Promise<Array<{ type: string; id: string }>> => {
  const [
    gpuRows,
    cpuRows,
    ramKitRows,
    psuRows,
    caseRows,
    mbRows,
    compactRows,
    storageRows,
    coolerRows,
    macSystemRows,
    enclosureRows,
  ] = await Promise.all([
    listGpus(),
    listCpus(),
    listRamKits(),
    listPowerSupplies(),
    listCases(),
    listMotherboards(),
    listCompactAiSystems(),
    listStorageDrives(),
    listCpuCoolers(),
    listMacSystems(),
    listExternalGpuEnclosures(),
  ]);

  return [
    ...gpuRows.map((row) => ({ type: "gpu", id: String(row.id) })),
    ...cpuRows.map((row) => ({ type: "cpu", id: String(row.id) })),
    ...ramKitRows.map((row) => ({ type: "ram_kit", id: String(row.id) })),
    ...psuRows.map((row) => ({ type: "power_supply", id: String(row.id) })),
    ...caseRows.map((row) => ({ type: "case", id: String(row.id) })),
    ...mbRows.map((row) => ({ type: "motherboard", id: String(row.id) })),
    ...compactRows.map((row) => ({ type: "compact_ai_system", id: String(row.id) })),
    ...storageRows.map((row) => ({ type: "storage_drive", id: String(row.id) })),
    ...coolerRows.map((row) => ({ type: "cpu_cooler", id: String(row.id) })),
    ...macSystemRows.map((row) => ({ type: "mac_system", id: String(row.id) })),
    ...enclosureRows.map((row) => ({ type: "external_gpu_enclosure", id: String(row.id) })),
  ];
});

export const listBuildDetailStaticParams = cache(async (): Promise<Array<{ id: string }>> => {
  const rows = await listProfileBuilds();
  return rows.map((row) => ({ id: String(row.id) }));
});

export const listMacEgpuBuildDetailStaticParams = cache(async (): Promise<Array<{ id: string }>> => {
  const rows = await listMacEgpuBuilds();
  return rows.map((row) => ({ id: String(row.id) }));
});
