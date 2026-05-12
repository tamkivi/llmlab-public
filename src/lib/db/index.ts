import "server-only";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { getAdapter } from "./adapter";
import { runMigrations } from "./migrations";
import { seedCatalog } from "./seed";
import { ASSEMBLY_MARKUP_MULTIPLIER } from "@/lib/pricing-constants";

export { getAdapter };
import type {
  GpuRecord,
  CpuRecord,
  RamKitRecord,
  PowerSupplyRecord,
  CaseRecord,
  MotherboardRecord,
  CompactAiSystemRecord,
  StorageDriveRecord,
  CpuCoolerRecord,
  MacSystemRecord,
  ExternalGpuEnclosureRecord,
  MacEgpuBuildRecord,
  EstonianPriceCheckRecord,
  ProfileBuildRecord,
  ProfileBuildWithNamesRecord,
  PriceHistoryRecord,
  PublicUser,
  AccountSummary,
  OrderRecord,
  OrderStatus,
  OrderItemType,
  UserOrderListItem,
  AdminOrderListItem,
  AdminQuoteRequestListItem,
  PaidOrderEmailPayload,
  QuoteRequestRecord,
  QuoteRequestStatus,
} from "./types";

// Re-export types for consumers that import from "@/lib/db"
export type {
  GpuRecord,
  CpuRecord,
  RamKitRecord,
  PowerSupplyRecord,
  CaseRecord,
  MotherboardRecord,
  CompactAiSystemRecord,
  StorageDriveRecord,
  CpuCoolerRecord,
  MacSystemRecord,
  ExternalGpuEnclosureRecord,
  MacEgpuBuildRecord,
  EstonianPriceCheckRecord,
  ProfileBuildRecord,
  ProfileBuildWithNamesRecord,
  PriceHistoryRecord,
  PublicUser,
  AccountSummary,
  OrderRecord,
  OrderStatus,
  OrderItemType,
  UserOrderListItem,
  AdminOrderListItem,
  AdminQuoteRequestListItem,
  PaidOrderEmailPayload,
  QuoteRequestRecord,
  QuoteRequestStatus,
};

// ── Initialization ──
//
// Architecture overview:
// - Migrations run once per version (tracked in schema_migrations)
// - Seeds run when SEED_VERSION is bumped (tracked in seed_runs)
// - All seed functions use ON CONFLICT DO UPDATE (idempotent upserts)
//
// How to add a new product:
// 1. Add entry to the appropriate seed array in seed.ts
// 2. Bump SEED_VERSION below
// 3. Deploy — next cold start re-seeds automatically
//
// How to update a product's base price:
// 1. Change priceEur in the seed array in seed.ts
// 2. Bump SEED_VERSION
// 3. Deploy — upsert overwrites the existing row
//
// Why PostgreSQL is required in production:
// Vercel serverless has no persistent filesystem. SQLite in /tmp is wiped
// between invocations. Set DATABASE_URL or POSTGRES_URL for persistence.
// Without it, pricing data, orders, and user accounts are lost on each deploy.
//
// Daily pricing cron (GET /api/cron/estonian-pricing):
// - Runs at 3 AM UTC via vercel.json cron
// - Scrapes Estonian retailer search pages for each catalog item
// - Accepts only prices whose surrounding HTML matches the product name tokens
// - Stores source diagnostics as "Retailer €price match=x/y" for auditability
// - Ignores legacy price rows without match diagnostics for checkout/catalog pricing
// - Applies 15% assembly markup
// - Writes to estonian_price_checks + price_history tables
// - Both writes are awaited; failures tracked in failedItems[]
//
// What prices are used during checkout:
// - Catalog display can show fallback prices for planning, but direct checkout is
//   gated separately and requires fresh, trusted, non-fallback market pricing.
// - Catalog items: direct checkout charges estonian_price_checks.final_price_eur
//   rounded to whole euros after checkout eligibility is rechecked.
// - Profile builds: direct checkout sums eligible component market prices only.
// - Mac eGPU builds: not purchasable through standard checkout
// - The user sees AND is charged the same preorderPriceEur value.

let initialized = false;
let initPromise: Promise<void> | null = null;

export const SEED_VERSION = 11;

const TRUSTED_PRICE_MAX_AGE_HOURS = Number.parseInt(process.env.TRUSTED_PRICE_MAX_AGE_HOURS ?? "168", 10);
const TRUSTED_PRICE_MIN_SAMPLES = Number.parseInt(process.env.TRUSTED_PRICE_MIN_SAMPLES ?? "1", 10);
const MARKET_PRICE_MIN_RATIO = 0.55;
const MARKET_PRICE_MAX_RATIO = 2.2;
export const ADMIN_PRICING_OVERRIDE_MAX_DAYS = 14;

const PRICING_CATEGORIES = new Set([
  "gpu",
  "cpu",
  "ram_kit",
  "power_supply",
  "case",
  "motherboard",
  "compact_ai_system",
  "storage_drive",
  "cpu_cooler",
  "mac_system",
  "external_gpu_enclosure",
]);

const CATEGORY_RENAMES: Record<string, string> = {
  mac_systems: "mac_system",
};

export function normalizePricingCategory(category: string): string {
  return CATEGORY_RENAMES[category] ?? category;
}

function trustedPriceCutoff(): string {
  const hours = Number.isFinite(TRUSTED_PRICE_MAX_AGE_HOURS) ? Math.max(1, TRUSTED_PRICE_MAX_AGE_HOURS) : 168;
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

export function getTrustedPriceCutoffIso(): string {
  return trustedPriceCutoff();
}

function trustedPriceMinSamples(): number {
  return Number.isFinite(TRUSTED_PRICE_MIN_SAMPLES) ? Math.max(1, TRUSTED_PRICE_MIN_SAMPLES) : 1;
}

function trustedPriceWhereClause(): string {
  return `
    sources LIKE '%match=%'
    AND sample_count >= ?
    AND checked_at >= ?
    AND base_price_eur > 0
    AND market_avg_eur > 0
    AND final_price_eur > 0
    AND market_avg_eur BETWEEN base_price_eur * ${MARKET_PRICE_MIN_RATIO} AND base_price_eur * ${MARKET_PRICE_MAX_RATIO}
    AND ABS(final_price_eur - (market_avg_eur * (1 + assembly_markup_pct / 100.0))) <= 2
  `;
}

function trustedPriceParams(): [number, string] {
  return [trustedPriceMinSamples(), trustedPriceCutoff()];
}

type SeedRunRecord = {
  id: number;
  seed_version: number;
  applied_at: string;
};

export async function initDb(): Promise<void> {
  if (initialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    await runMigrations();
    const db = getAdapter();

    const latestSeed = await db.queryOne<SeedRunRecord>(
      "SELECT id, seed_version, applied_at FROM seed_runs ORDER BY seed_version DESC LIMIT 1",
    );

    if (!latestSeed || latestSeed.seed_version < SEED_VERSION) {
      await seedCatalog(db);
      await seedProfileBuilds(db);
      await db.execute(
        "INSERT INTO seed_runs (seed_version, applied_at) VALUES (?, ?)",
        [SEED_VERSION, new Date().toISOString()],
      );
      console.log(`Seed v${SEED_VERSION} applied`);
    }

    initialized = true;
  })();

  return initPromise;
}

// ── Auth helpers ──

const SESSION_DAYS = 7;

function getAdminEmail(): string {
  const email = process.env.ADMIN_EMAIL;
  if (!email && process.env.NODE_ENV === "production") {
    throw new Error("ADMIN_EMAIL environment variable is required in production. Set it to the admin account email address.");
  }
  return email ?? "admin@localhost";
}

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [saltHex, keyHex] = storedHash.split(":");
  if (!saltHex || !keyHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expectedKey = Buffer.from(keyHex, "hex");
  const candidateKey = scryptSync(password, salt, expectedKey.length);
  return timingSafeEqual(expectedKey, candidateKey);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

const PROFILE_BUILD_SELECT = `
  pb.id, pb.profile_key, pb.profile_label, pb.build_name, pb.target_model,
  pb.ram_gb, pb.storage_gb, pb.estimated_price_eur, pb.best_for,
  pb.estimated_tokens_per_sec, pb.estimated_system_power_w, pb.recommended_psu_w,
  pb.cooling_profile, pb.notes, pb.source_refs, pb.cpu_id, pb.gpu_id,
  pb.ram_kit_id, pb.storage_drive_id, pb.motherboard_id, pb.power_supply_id,
  pb.case_id, pb.cpu_cooler_id, pb.compatibility_notes,
  c.name AS cpu_name, g.name AS gpu_name, g.vram_gb AS gpu_vram_gb,
  g.architecture AS gpu_architecture
`;

const ORDER_SELECT = `
  id, user_id, profile_build_id, order_item_type, order_item_id, build_name,
  amount_eur_cents, currency, status, stripe_checkout_session_id,
  stripe_payment_intent_id, paid_at, fulfilled_at, customer_email_sent_at,
  admin_email_sent_at, customer_email_send_attempted_at, admin_email_send_attempted_at,
  customer_email_last_error, admin_email_last_error, created_at, updated_at
`;

const OPEN_ORDER_STATUSES = "'PENDING', 'CHECKOUT_CREATED'";

function isUniqueConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: string }).code;
  return code === "23505"
    || code === "SQLITE_CONSTRAINT_UNIQUE"
    || error.message.includes("UNIQUE constraint failed")
    || error.message.includes("duplicate key value violates unique constraint");
}

// ── Catalog read functions ──

export async function listGpus(): Promise<GpuRecord[]> {
  await initDb();
  return getAdapter().queryAll<GpuRecord>(
    "SELECT id, name, brand, vram_gb, architecture, tdp_watts, ai_score, price_eur, vram_type, memory_bus_bits, memory_bandwidth_gbps, cuda_cores, stream_processors, tensor_cores, rt_cores, base_clock_mhz, boost_clock_mhz, recommended_psu_w, pcie_generation, slot_width, length_mm, power_connectors, nvlink_support, fp16_tensor_tflops, fp32_tflops, inference_notes, generation, source_refs, mpn, release_year, release_quarter, display_power_w, connector_standard, minimum_psu_w, dual_gpu_capable FROM gpus ORDER BY ai_score DESC",
  );
}

export async function listCpus(): Promise<CpuRecord[]> {
  await initDb();
  return getAdapter().queryAll<CpuRecord>(
    "SELECT id, name, brand, cores, threads, base_clock_ghz, boost_clock_ghz, socket, tdp_watts, ai_score, price_eur, cache_l3_mb, integrated_graphics, memory_type_support, max_memory_gb, pcie_generation, unlocked, cooler_included, source_refs, mpn, release_year, release_quarter, platform_generation, memory_channels, ecc_support FROM cpus ORDER BY ai_score DESC",
  );
}

export async function listRamKits(): Promise<RamKitRecord[]> {
  await initDb();
  return getAdapter().queryAll<RamKitRecord>(
    "SELECT id, name, brand, capacity_gb, modules, ddr_gen, speed_mt_s, cas_latency, profile_support, price_eur, source_refs, voltage, ecc, registered, recommended_platform FROM ram_kits ORDER BY capacity_gb DESC, speed_mt_s DESC",
  );
}

export async function listPowerSupplies(): Promise<PowerSupplyRecord[]> {
  await initDb();
  return getAdapter().queryAll<PowerSupplyRecord>(
    "SELECT id, name, brand, wattage, efficiency_rating, atx_standard, modularity, pcie_5_support, price_eur, source_refs, psu_form_factor, native_12vhpwr, gpu_connector_count, warranty_years FROM power_supplies ORDER BY wattage DESC",
  );
}

export async function listCases(): Promise<CaseRecord[]> {
  await initDb();
  return getAdapter().queryAll<CaseRecord>(
    "SELECT id, name, brand, form_factor, max_gpu_mm, radiator_support, included_fans, price_eur, source_refs, max_cpu_cooler_height_mm, max_psu_length_mm, dimensions_mm, drive_bays, airflow_notes FROM pc_cases ORDER BY price_eur DESC",
  );
}

export async function listMotherboards(): Promise<MotherboardRecord[]> {
  await initDb();
  return getAdapter().queryAll<MotherboardRecord>(
    "SELECT id, name, brand, socket, chipset, memory_support, max_memory_gb, pcie_gen5_support, price_eur, source_refs, form_factor, memory_slots, pcie_x16_slots, pcie_generation, m2_slots, sata_ports, ethernet, wifi, usb4_support, thunderbolt_support, bios_flashback, mb_notes FROM motherboards ORDER BY price_eur DESC",
  );
}

export async function listCompactAiSystems(): Promise<CompactAiSystemRecord[]> {
  await initDb();
  return getAdapter().queryAll<CompactAiSystemRecord>(
    "SELECT id, name, vendor, chip, memory_gb, storage_gb, gpu_class, installed_software, best_for, price_eur, in_stock, source_refs, npu_tops, ports, upgradeability, ai_workload_notes FROM compact_ai_systems ORDER BY price_eur DESC",
  );
}

export async function listStorageDrives(): Promise<StorageDriveRecord[]> {
  await initDb();
  return getAdapter().queryAll<StorageDriveRecord>(
    "SELECT id, name, brand, drive_type, interface, capacity_gb, seq_read_mb_s, endurance_tbw, price_eur, source_refs, form_factor, pcie_generation, seq_write_mb_s, dram_cache, nand_type, warranty_years, interface_generation FROM storage_drives ORDER BY drive_type ASC, seq_read_mb_s DESC",
  );
}

export async function listCpuCoolers(): Promise<CpuCoolerRecord[]> {
  await initDb();
  return getAdapter().queryAll<CpuCoolerRecord>(
    "SELECT id, name, brand, cooler_type, radiator_or_height_mm, socket_support, max_tdp_w, noise_db, price_eur, source_refs, fan_size_mm, ram_clearance_notes FROM cpu_coolers ORDER BY max_tdp_w DESC",
  );
}

export async function listMacSystems(): Promise<MacSystemRecord[]> {
  await initDb();
  return getAdapter().queryAll<MacSystemRecord>(
    "SELECT id, name, chip, cpu_cores, gpu_cores, unified_memory_gb, storage_gb, ports, thunderbolt_version, usb4_supported, macos_min_version, estimated_price_eur, notes, neural_engine_cores, memory_bandwidth_gbps, external_gpu_support, ai_framework_notes, local_llm_notes FROM mac_systems ORDER BY unified_memory_gb DESC",
  );
}

export async function listExternalGpuEnclosures(): Promise<ExternalGpuEnclosureRecord[]> {
  await initDb();
  return getAdapter().queryAll<ExternalGpuEnclosureRecord>(
    "SELECT id, name, connection_type, pcie_generation, pcie_lanes, max_gpu_length_mm, max_gpu_slots, included_psu_watts, requires_external_psu, supports_open_frame, estimated_price_eur, notes, thunderbolt_version, macos_support_notes, windows_support_notes, nvidia_support_notes, amd_support_notes FROM external_gpu_enclosures ORDER BY estimated_price_eur ASC",
  );
}

export async function listMacEgpuBuilds(): Promise<MacEgpuBuildRecord[]> {
  await initDb();
  return getAdapter().queryAll<MacEgpuBuildRecord>(
    "SELECT id, name, mac_system_id, egpu_enclosure_id, gpu_id, target_workloads, unsupported_workloads, risk_level, buyer_warning, notes FROM mac_egpu_builds ORDER BY risk_level ASC, id ASC",
  );
}

export async function listProfileBuilds(): Promise<ProfileBuildWithNamesRecord[]> {
  await initDb();
  return getAdapter().queryAll<ProfileBuildWithNamesRecord>(
    `SELECT ${PROFILE_BUILD_SELECT}
     FROM profile_builds pb
     JOIN cpus c ON c.id = pb.cpu_id
     JOIN gpus g ON g.id = pb.gpu_id
     ORDER BY pb.profile_key ASC, pb.estimated_price_eur ASC`,
  );
}

// ── Single-item getters ──

export async function getGpuById(id: number): Promise<GpuRecord | null> {
  await initDb();
  return getAdapter().queryOne<GpuRecord>("SELECT id, name, brand, vram_gb, architecture, tdp_watts, ai_score, price_eur, vram_type, memory_bus_bits, memory_bandwidth_gbps, cuda_cores, stream_processors, tensor_cores, rt_cores, base_clock_mhz, boost_clock_mhz, recommended_psu_w, pcie_generation, slot_width, length_mm, power_connectors, nvlink_support, fp16_tensor_tflops, fp32_tflops, inference_notes, generation, source_refs, mpn, release_year, release_quarter, display_power_w, connector_standard, minimum_psu_w, dual_gpu_capable FROM gpus WHERE id = ? LIMIT 1", [id]);
}

export async function getCpuById(id: number): Promise<CpuRecord | null> {
  await initDb();
  return getAdapter().queryOne<CpuRecord>("SELECT id, name, brand, cores, threads, base_clock_ghz, boost_clock_ghz, socket, tdp_watts, ai_score, price_eur, cache_l3_mb, integrated_graphics, memory_type_support, max_memory_gb, pcie_generation, unlocked, cooler_included, source_refs, mpn, release_year, release_quarter, platform_generation, memory_channels, ecc_support FROM cpus WHERE id = ? LIMIT 1", [id]);
}

export async function getRamKitById(id: number): Promise<RamKitRecord | null> {
  await initDb();
  return getAdapter().queryOne<RamKitRecord>("SELECT id, name, brand, capacity_gb, modules, ddr_gen, speed_mt_s, cas_latency, profile_support, price_eur, source_refs, voltage, ecc, registered, recommended_platform FROM ram_kits WHERE id = ? LIMIT 1", [id]);
}

export async function getPowerSupplyById(id: number): Promise<PowerSupplyRecord | null> {
  await initDb();
  return getAdapter().queryOne<PowerSupplyRecord>("SELECT id, name, brand, wattage, efficiency_rating, atx_standard, modularity, pcie_5_support, price_eur, source_refs, psu_form_factor, native_12vhpwr, gpu_connector_count, warranty_years FROM power_supplies WHERE id = ? LIMIT 1", [id]);
}

export async function getCaseById(id: number): Promise<CaseRecord | null> {
  await initDb();
  return getAdapter().queryOne<CaseRecord>("SELECT id, name, brand, form_factor, max_gpu_mm, radiator_support, included_fans, price_eur, source_refs, max_cpu_cooler_height_mm, max_psu_length_mm, dimensions_mm, drive_bays, airflow_notes FROM pc_cases WHERE id = ? LIMIT 1", [id]);
}

export async function getMotherboardById(id: number): Promise<MotherboardRecord | null> {
  await initDb();
  return getAdapter().queryOne<MotherboardRecord>("SELECT id, name, brand, socket, chipset, memory_support, max_memory_gb, pcie_gen5_support, price_eur, source_refs, form_factor, memory_slots, pcie_x16_slots, pcie_generation, m2_slots, sata_ports, ethernet, wifi, usb4_support, thunderbolt_support, bios_flashback, mb_notes FROM motherboards WHERE id = ? LIMIT 1", [id]);
}

export async function getCompactAiSystemById(id: number): Promise<CompactAiSystemRecord | null> {
  await initDb();
  return getAdapter().queryOne<CompactAiSystemRecord>("SELECT id, name, vendor, chip, memory_gb, storage_gb, gpu_class, installed_software, best_for, price_eur, in_stock, source_refs, npu_tops, ports, upgradeability, ai_workload_notes FROM compact_ai_systems WHERE id = ? LIMIT 1", [id]);
}

export async function getStorageDriveById(id: number): Promise<StorageDriveRecord | null> {
  await initDb();
  return getAdapter().queryOne<StorageDriveRecord>("SELECT id, name, brand, drive_type, interface, capacity_gb, seq_read_mb_s, endurance_tbw, price_eur, source_refs, form_factor, pcie_generation, seq_write_mb_s, dram_cache, nand_type, warranty_years, interface_generation FROM storage_drives WHERE id = ? LIMIT 1", [id]);
}

export async function getCpuCoolerById(id: number): Promise<CpuCoolerRecord | null> {
  await initDb();
  return getAdapter().queryOne<CpuCoolerRecord>("SELECT id, name, brand, cooler_type, radiator_or_height_mm, socket_support, max_tdp_w, noise_db, price_eur, source_refs, fan_size_mm, ram_clearance_notes FROM cpu_coolers WHERE id = ? LIMIT 1", [id]);
}

export async function getMacSystemById(id: number): Promise<MacSystemRecord | null> {
  await initDb();
  return getAdapter().queryOne<MacSystemRecord>("SELECT id, name, chip, cpu_cores, gpu_cores, unified_memory_gb, storage_gb, ports, thunderbolt_version, usb4_supported, macos_min_version, estimated_price_eur, notes, neural_engine_cores, memory_bandwidth_gbps, external_gpu_support, ai_framework_notes, local_llm_notes FROM mac_systems WHERE id = ? LIMIT 1", [id]);
}

export async function getExternalGpuEnclosureById(id: number): Promise<ExternalGpuEnclosureRecord | null> {
  await initDb();
  return getAdapter().queryOne<ExternalGpuEnclosureRecord>("SELECT id, name, connection_type, pcie_generation, pcie_lanes, max_gpu_length_mm, max_gpu_slots, included_psu_watts, requires_external_psu, supports_open_frame, estimated_price_eur, notes, thunderbolt_version, macos_support_notes, windows_support_notes, nvidia_support_notes, amd_support_notes FROM external_gpu_enclosures WHERE id = ? LIMIT 1", [id]);
}

export async function getMacEgpuBuildById(id: number): Promise<MacEgpuBuildRecord | null> {
  await initDb();
  return getAdapter().queryOne<MacEgpuBuildRecord>("SELECT id, name, mac_system_id, egpu_enclosure_id, gpu_id, target_workloads, unsupported_workloads, risk_level, buyer_warning, notes FROM mac_egpu_builds WHERE id = ? LIMIT 1", [id]);
}

export async function getProfileBuildById(id: number): Promise<ProfileBuildWithNamesRecord | null> {
  await initDb();
  return getAdapter().queryOne<ProfileBuildWithNamesRecord>(
    `SELECT ${PROFILE_BUILD_SELECT}
     FROM profile_builds pb
     JOIN cpus c ON c.id = pb.cpu_id
     JOIN gpus g ON g.id = pb.gpu_id
     WHERE pb.id = ? LIMIT 1`, [id],
  );
}

// ── Price functions ──

export async function getEstonianPriceCheck(category: string, itemId: number): Promise<{ final_price_eur: number; market_avg_eur: number } | null> {
  await initDb();
  const normalizedCategory = normalizePricingCategory(category);
  return getAdapter().queryOne<{ final_price_eur: number; market_avg_eur: number }>(
    `SELECT final_price_eur, market_avg_eur
     FROM estonian_price_checks
     WHERE category = ? AND item_id = ? AND ${trustedPriceWhereClause()}
     LIMIT 1`,
    [normalizedCategory, itemId, ...trustedPriceParams()],
  );
}

export async function listEstonianPriceChecks(): Promise<EstonianPriceCheckRecord[]> {
  await initDb();
  return getAdapter().queryAll<EstonianPriceCheckRecord>(
    `SELECT id, category, item_id, item_name, base_price_eur, market_avg_eur, assembly_markup_pct, final_price_eur, sample_count, sources, checked_at
     FROM estonian_price_checks
     WHERE ${trustedPriceWhereClause()}
     ORDER BY category, item_id`,
    trustedPriceParams(),
  );
}

type LatestEstonianPriceCheckMetadata = Pick<EstonianPriceCheckRecord, "category" | "item_id" | "sample_count" | "checked_at">;

export async function listLatestEstonianPriceCheckMetadata(): Promise<LatestEstonianPriceCheckMetadata[]> {
  await initDb();
  return getAdapter().queryAll<LatestEstonianPriceCheckMetadata>(
    `SELECT category, item_id, sample_count, checked_at
     FROM estonian_price_checks
     ORDER BY category, item_id`,
  );
}

export type AdminPricingOverrideRecord = {
  id: number;
  category: string;
  item_id: number;
  market_avg_eur: number;
  source_note: string;
  expires_at: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

function sanitizeOverrideSourceNote(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
}

function validateAdminPricingOverrideInput(input: {
  category: string;
  itemId: number;
  marketAvgEur: number;
  sourceNote: string;
  expiresAt: string;
}): string[] {
  const errors: string[] = [];
  const normalizedCategory = normalizePricingCategory(input.category);
  const expiresAt = new Date(input.expiresAt);
  const now = Date.now();
  const maxExpiresAt = now + ADMIN_PRICING_OVERRIDE_MAX_DAYS * 24 * 60 * 60 * 1000;
  if (!PRICING_CATEGORIES.has(normalizedCategory)) errors.push(`unknown category "${input.category}"`);
  if (!Number.isInteger(input.itemId) || input.itemId <= 0) errors.push("itemId must be a positive integer");
  if (!Number.isFinite(input.marketAvgEur) || input.marketAvgEur <= 0) errors.push("marketAvgEur must be positive");
  if (sanitizeOverrideSourceNote(input.sourceNote).length < 5) errors.push("sourceNote must describe the manual source");
  if (Number.isNaN(expiresAt.getTime())) {
    errors.push("expiresAt must be a valid ISO timestamp");
  } else {
    if (expiresAt.getTime() <= now) errors.push("expiresAt must be in the future");
    if (expiresAt.getTime() > maxExpiresAt) errors.push(`expiresAt must be within ${ADMIN_PRICING_OVERRIDE_MAX_DAYS} days`);
  }
  return errors;
}

export function adminPricingOverrideSource(input: Pick<AdminPricingOverrideRecord, "source_note" | "expires_at" | "created_by">): string {
  const note = sanitizeOverrideSourceNote(input.source_note);
  const createdBy = sanitizeOverrideSourceNote(input.created_by || "unknown");
  return `admin_override; not_retailer_derived; source_note=${note}; expires_at=${input.expires_at}; created_by=${createdBy}; match=admin-reviewed`;
}

export async function upsertAdminPricingOverride(input: {
  category: string;
  itemId: number;
  marketAvgEur: number;
  sourceNote: string;
  expiresAt: string;
  createdBy: string;
}): Promise<{ ok: true; override: AdminPricingOverrideRecord } | { ok: false; message: string }> {
  await initDb();
  const category = normalizePricingCategory(input.category);
  const sourceNote = sanitizeOverrideSourceNote(input.sourceNote);
  const createdBy = sanitizeOverrideSourceNote(input.createdBy || "unknown");
  const errors = validateAdminPricingOverrideInput({ ...input, category, sourceNote });
  if (errors.length > 0) return { ok: false, message: errors.join("; ") };

  const now = new Date().toISOString();
  await getAdapter().execute(
    `INSERT INTO admin_pricing_overrides (
       category, item_id, market_avg_eur, source_note, expires_at, created_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(category, item_id) DO UPDATE SET
       market_avg_eur=excluded.market_avg_eur,
       source_note=excluded.source_note,
       expires_at=excluded.expires_at,
       created_by=excluded.created_by,
       updated_at=excluded.updated_at`,
    [category, input.itemId, input.marketAvgEur, sourceNote, new Date(input.expiresAt).toISOString(), createdBy, now, now],
  );

  const override = await getAdapter().queryOne<AdminPricingOverrideRecord>(
    "SELECT id, category, item_id, market_avg_eur, source_note, expires_at, created_by, created_at, updated_at FROM admin_pricing_overrides WHERE category = ? AND item_id = ? LIMIT 1",
    [category, input.itemId],
  );
  if (!override) return { ok: false, message: "Pricing override was not saved." };
  return { ok: true, override };
}

export async function getActiveAdminPricingOverride(category: string, itemId: number): Promise<AdminPricingOverrideRecord | null> {
  await initDb();
  return getAdapter().queryOne<AdminPricingOverrideRecord>(
    `SELECT id, category, item_id, market_avg_eur, source_note, expires_at, created_by, created_at, updated_at
     FROM admin_pricing_overrides
     WHERE category = ? AND item_id = ? AND expires_at > ?
     LIMIT 1`,
    [normalizePricingCategory(category), itemId, new Date().toISOString()],
  );
}

export async function listAdminPricingOverrides(options: { includeExpired?: boolean } = {}): Promise<AdminPricingOverrideRecord[]> {
  await initDb();
  const where = options.includeExpired ? "" : "WHERE expires_at > ?";
  const params = options.includeExpired ? [] : [new Date().toISOString()];
  return getAdapter().queryAll<AdminPricingOverrideRecord>(
    `SELECT id, category, item_id, market_avg_eur, source_note, expires_at, created_by, created_at, updated_at
     FROM admin_pricing_overrides
     ${where}
     ORDER BY expires_at ASC, category ASC, item_id ASC
     LIMIT 100`,
    params,
  );
}

export async function listAdminOverrideBackedPriceChecks(): Promise<Array<EstonianPriceCheckRecord & { override_source: string }>> {
  await initDb();
  return getAdapter().queryAll<Array<EstonianPriceCheckRecord & { override_source: string }>[number]>(
    `SELECT id, category, item_id, item_name, base_price_eur, market_avg_eur, assembly_markup_pct,
            final_price_eur, sample_count, sources, checked_at, sources AS override_source
     FROM estonian_price_checks
     WHERE sources LIKE '%admin_override%'
     ORDER BY checked_at DESC, category ASC, item_id ASC
     LIMIT 100`,
  );
}

function validateMarketPriceInput(input: {
  category: string;
  itemId: number;
  itemName: string;
  basePriceEur: number;
  marketAvgEur: number;
  assemblyMarkupPct: number;
  finalPriceEur: number;
  sampleCount: number;
  sources: string;
}): string[] {
  const errors: string[] = [];
  const normalizedCategory = normalizePricingCategory(input.category);
  if (!PRICING_CATEGORIES.has(normalizedCategory)) errors.push(`unknown category "${input.category}"`);
  if (!Number.isInteger(input.itemId) || input.itemId <= 0) errors.push("itemId must be a positive integer");
  if (input.itemName.trim().length === 0) errors.push("itemName is required");
  if (!Number.isFinite(input.basePriceEur) || input.basePriceEur <= 0) errors.push("basePriceEur must be positive");
  if (!Number.isFinite(input.marketAvgEur) || input.marketAvgEur <= 0) errors.push("marketAvgEur must be positive");
  if (!Number.isFinite(input.finalPriceEur) || input.finalPriceEur <= 0) errors.push("finalPriceEur must be positive");
  if (!Number.isFinite(input.assemblyMarkupPct) || input.assemblyMarkupPct < 0 || input.assemblyMarkupPct > 100) errors.push("assemblyMarkupPct must be between 0 and 100");
  if (!Number.isInteger(input.sampleCount) || input.sampleCount < 1) errors.push("sampleCount must be at least 1");
  if (!input.sources.includes("match=")) errors.push("sources must include match diagnostics");

  if (Number.isFinite(input.basePriceEur) && input.basePriceEur > 0 && Number.isFinite(input.marketAvgEur)) {
    const min = input.basePriceEur * MARKET_PRICE_MIN_RATIO;
    const max = input.basePriceEur * MARKET_PRICE_MAX_RATIO;
    if (input.marketAvgEur < min || input.marketAvgEur > max) {
      errors.push(`marketAvgEur is outside ${MARKET_PRICE_MIN_RATIO}x-${MARKET_PRICE_MAX_RATIO}x base price bounds`);
    }
  }

  if (Number.isFinite(input.marketAvgEur) && Number.isFinite(input.assemblyMarkupPct) && Number.isFinite(input.finalPriceEur)) {
    const expectedFinal = input.marketAvgEur * (1 + input.assemblyMarkupPct / 100);
    if (Math.abs(input.finalPriceEur - expectedFinal) > 2) {
      errors.push("finalPriceEur does not match market average plus markup");
    }
  }

  return errors;
}

export type PriceHistoryWriteResult = {
  inserted: boolean;
  updated: boolean;
};

export async function upsertPriceHistoryForDate(input: {
  category: string;
  itemId: number;
  priceEur: number;
  source: string;
  recordedDate: string;
  recordedAt?: string;
}): Promise<PriceHistoryWriteResult> {
  await initDb();
  const category = normalizePricingCategory(input.category);
  const itemId = input.itemId;
  const priceEur = input.priceEur;
  const source = input.source;
  const recordedDate = input.recordedDate;
  const recordedAt = input.recordedAt ?? `${recordedDate}T12:00:00.000Z`;

  if (!PRICING_CATEGORIES.has(category)) throw new Error(`Invalid price history category "${category}".`);
  if (!Number.isInteger(itemId) || itemId <= 0) throw new Error("Invalid price history item id.");
  if (!Number.isFinite(priceEur) || priceEur <= 0) throw new Error("Invalid price history price.");
  if (!source.includes("match=")) throw new Error("Invalid price history source: missing match diagnostics.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(recordedDate)) throw new Error("Invalid price history recorded date.");

  const db = getAdapter();

  const dialect = db.dialect;

  if (dialect === "postgres") {
    const existing = await db.queryOne<{ id: number }>(
      "SELECT id FROM price_history WHERE category = ? AND item_id = ? AND recorded_date = ? LIMIT 1",
      [category, itemId, recordedDate],
    );
    await db.execute(
      `INSERT INTO price_history (category, item_id, price_eur, source, recorded_at, recorded_date)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (category, item_id, recorded_date) DO UPDATE SET price_eur = EXCLUDED.price_eur, source = EXCLUDED.source, recorded_at = EXCLUDED.recorded_at`,
      [category, itemId, priceEur, source, recordedAt, recordedDate],
    );
    return { inserted: !existing, updated: Boolean(existing) };
  } else {
    const updated = await db.execute(
      "UPDATE price_history SET price_eur = ?, source = ?, recorded_at = ? WHERE category = ? AND item_id = ? AND recorded_date = ?",
      [priceEur, source, recordedAt, category, itemId, recordedDate],
    );
    if (updated === 0) {
      await db.execute(
        "INSERT INTO price_history (category, item_id, price_eur, source, recorded_at, recorded_date) VALUES (?, ?, ?, ?, ?, ?)",
        [category, itemId, priceEur, source, recordedAt, recordedDate],
      );
      return { inserted: true, updated: false };
    }
    return { inserted: false, updated: true };
  }
}

export async function insertPriceHistory(category: string, itemId: number, priceEur: number, source: string): Promise<PriceHistoryWriteResult> {
  const isoNow = new Date().toISOString();
  return upsertPriceHistoryForDate({
    category,
    itemId,
    priceEur,
    source,
    recordedAt: isoNow,
    recordedDate: isoNow.slice(0, 10),
  });
}

function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return utcDateKey(date);
}

export async function backfillPriceHistoryFromChecks(options: { targetDates?: string[] } = {}): Promise<{ inserted: number; updated: number; targetDates: string[] }> {
  await initDb();
  const db = getAdapter();
  const checks = await db.queryAll<EstonianPriceCheckRecord>(
    `SELECT category, item_id, market_avg_eur, sources, checked_at
     FROM estonian_price_checks
     WHERE ${trustedPriceWhereClause()}`,
    trustedPriceParams(),
  );
  let inserted = 0;
  let updated = 0;
  const today = utcDateKey(new Date());
  const targetDates = options.targetDates ?? [addUtcDays(today, -1), today];
  for (const c of checks) {
    for (const recordedDate of targetDates) {
      const source = c.sources.includes("backfill_from_checked_at=")
        ? c.sources
        : `${c.sources}, backfill_from_checked_at=${c.checked_at}`;
      const result = await upsertPriceHistoryForDate({
        category: c.category,
        itemId: c.item_id,
        priceEur: c.market_avg_eur,
        source,
        recordedAt: `${recordedDate}T12:00:00.000Z`,
        recordedDate,
      });
      if (result.inserted) inserted += 1;
      if (result.updated) updated += 1;
    }
  }
  return { inserted, updated, targetDates };
}

export async function normalizeCategoryRows(): Promise<number> {
  await initDb();
  const db = getAdapter();
  let total = 0;
  for (const [from, to] of Object.entries(CATEGORY_RENAMES)) {
    await db.execute(
      `DELETE FROM estonian_price_checks
       WHERE category = ?
         AND EXISTS (
           SELECT 1 FROM estonian_price_checks target
           WHERE target.category = ? AND target.item_id = estonian_price_checks.item_id
         )`,
      [from, to],
    );
    const pc = await db.execute(
      "UPDATE estonian_price_checks SET category = ? WHERE category = ?",
      [to, from],
    );

    await db.execute(
      `DELETE FROM price_history
       WHERE category = ?
         AND EXISTS (
           SELECT 1 FROM price_history target
           WHERE target.category = ?
             AND target.item_id = price_history.item_id
             AND target.recorded_date = price_history.recorded_date
         )`,
      [from, to],
    );
    const ph = await db.execute(
      "UPDATE price_history SET category = ? WHERE category = ?",
      [to, from],
    );
    total += pc + ph;
  }
  return total;
}

export async function upsertEstonianPriceCheck(input: {
  category: string;
  itemId: number;
  itemName: string;
  basePriceEur: number;
  marketAvgEur: number;
  assemblyMarkupPct: number;
  finalPriceEur: number;
  sampleCount: number;
  sources: string;
}): Promise<void> {
  await initDb();
  const normalizedInput = { ...input, category: normalizePricingCategory(input.category) };
  const errors = validateMarketPriceInput(normalizedInput);
  if (errors.length > 0) {
    throw new Error(`Rejected invalid market price for ${normalizedInput.category}:${input.itemId}: ${errors.join("; ")}`);
  }

  await getAdapter().execute(
    `INSERT INTO estonian_price_checks (category, item_id, item_name, base_price_eur, market_avg_eur, assembly_markup_pct, final_price_eur, sample_count, sources, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(category, item_id) DO UPDATE SET item_name=excluded.item_name, base_price_eur=excluded.base_price_eur, market_avg_eur=excluded.market_avg_eur, assembly_markup_pct=excluded.assembly_markup_pct, final_price_eur=excluded.final_price_eur, sample_count=excluded.sample_count, sources=excluded.sources, checked_at=excluded.checked_at`,
    [normalizedInput.category, input.itemId, input.itemName, input.basePriceEur, input.marketAvgEur, input.assemblyMarkupPct, input.finalPriceEur, input.sampleCount, input.sources, new Date().toISOString()],
  );
}

export async function beginPricingRun(totalItems: number, startedAt: string): Promise<number | null> {
  await initDb();
  const db = getAdapter();
  try {
    await db.execute(
      `INSERT INTO pricing_runs (
        started_at, status, total_items, items_expected, notes,
        deployment_id, vercel_env, git_commit_sha, runtime_env
      ) VALUES (?, 'RUNNING', ?, ?, ?, ?, ?, ?, ?)`,
      [
        startedAt,
        totalItems,
        totalItems,
        "Pricing refresh started.",
        process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_URL ?? "",
        process.env.VERCEL_ENV ?? "",
        process.env.VERCEL_GIT_COMMIT_SHA ?? "",
        process.env.NODE_ENV ?? "",
      ],
    );
    const row = await db.queryOne<{ id: number }>(
      "SELECT id FROM pricing_runs WHERE started_at = ? ORDER BY id DESC LIMIT 1",
      [startedAt],
    );
    return row?.id ?? null;
  } catch {
    return null;
  }
}

export async function finishPricingRun(input: {
  runId: number | null;
  status: "SUCCESS" | "FAILED" | "PARTIAL";
  finishedAt: string;
  totalItems: number;
  checkedItems?: number;
  updatedItems: number;
  failedItems: number;
  historyRowsInserted?: number;
  historyRowsUpdated?: number;
  staleCount?: number;
  errorMessage?: string;
  notes: string;
}): Promise<void> {
  if (input.runId === null) return;
  await initDb();
  try {
    await getAdapter().execute(
      `UPDATE pricing_runs
       SET finished_at = ?,
           status = ?,
           total_items = ?,
           updated_items = ?,
           failed_items = ?,
           notes = ?,
           items_expected = ?,
           items_checked = ?,
           history_rows_inserted = ?,
           history_rows_updated = ?,
           stale_count = ?,
           error_message = ?
       WHERE id = ?`,
      [
        input.finishedAt,
        input.status,
        input.totalItems,
        input.updatedItems,
        input.failedItems,
        input.notes,
        input.totalItems,
        input.checkedItems ?? input.updatedItems + input.failedItems,
        input.historyRowsInserted ?? 0,
        input.historyRowsUpdated ?? 0,
        input.staleCount ?? 0,
        input.errorMessage ?? "",
        input.runId,
      ],
    );
  } catch {
    // Pricing refresh should not fail because observability failed.
  }
}

export async function recordPricingRunFailure(input: {
  runId: number | null;
  category: string;
  itemId: number;
  itemName: string;
  source?: string;
  errorMessage: string;
}): Promise<void> {
  if (input.runId === null) return;
  await initDb();
  try {
    await getAdapter().execute(
      `INSERT INTO pricing_run_failures (run_id, category, item_id, item_name, source, error_message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [input.runId, input.category, input.itemId, input.itemName, input.source ?? "", input.errorMessage, new Date().toISOString()],
    );
  } catch {
    // Pricing refresh should not fail because observability failed.
  }
}

export async function getPriceHistory(category: string, itemId: number, limitDays = 30): Promise<PriceHistoryRecord[]> {
  await initDb();
  const normalizedCategory = normalizePricingCategory(category);
  const cutoffDate = new Date(Date.now() - limitDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return getAdapter().queryAll<PriceHistoryRecord>(
    "SELECT id, category, item_id, price_eur, source, recorded_at, recorded_date FROM price_history WHERE category = ? AND item_id = ? AND COALESCE(recorded_date, SUBSTR(recorded_at, 1, 10)) >= ? AND source LIKE '%match=%' AND price_eur > 0 ORDER BY COALESCE(recorded_date, SUBSTR(recorded_at, 1, 10)) ASC, recorded_at ASC",
    [normalizedCategory, itemId, cutoffDate],
  );
}

export const PRICE_TRACKABLE_CATALOG_TABLES: Array<{ table: string; category: string; priceColumn: string }> = [
  { table: "gpus", category: "gpu", priceColumn: "price_eur" },
  { table: "cpus", category: "cpu", priceColumn: "price_eur" },
  { table: "ram_kits", category: "ram_kit", priceColumn: "price_eur" },
  { table: "power_supplies", category: "power_supply", priceColumn: "price_eur" },
  { table: "pc_cases", category: "case", priceColumn: "price_eur" },
  { table: "motherboards", category: "motherboard", priceColumn: "price_eur" },
  { table: "compact_ai_systems", category: "compact_ai_system", priceColumn: "price_eur" },
  { table: "storage_drives", category: "storage_drive", priceColumn: "price_eur" },
  { table: "cpu_coolers", category: "cpu_cooler", priceColumn: "price_eur" },
];

type PricingCatalogPair = {
  category: string;
  itemId: number;
  name: string;
};

export type PriceTrackableCatalogItem = PricingCatalogPair & {
  basePriceEur: number;
  pricingTier: "critical" | "background";
};

const HEALTH_CRITICAL_PROFILE_KEYS = [
  "hybrid-ai-gaming",
  "llm-finetune-starter",
  "local-llm-inference",
  "workstation-ai",
];

function priceTrackableKey(category: string, itemId: number): string {
  return `${category}:${itemId}`;
}

async function listHealthCriticalPriceTrackableKeys(): Promise<Set<string>> {
  const db = getAdapter();
  const rows = await db.queryAll<{ category: string; item_id: number }>(
    `WITH ranked_builds AS (
       SELECT cpu_id, gpu_id, ram_kit_id, storage_drive_id, motherboard_id,
              power_supply_id, case_id, cpu_cooler_id,
              ROW_NUMBER() OVER (PARTITION BY profile_key ORDER BY estimated_price_eur ASC, id ASC) AS rn
       FROM profile_builds
       WHERE profile_key IN (?, ?, ?, ?)
     )
     SELECT 'cpu' AS category, cpu_id AS item_id FROM ranked_builds WHERE rn = 1 AND cpu_id IS NOT NULL
     UNION
     SELECT 'gpu' AS category, gpu_id AS item_id FROM ranked_builds WHERE rn = 1 AND gpu_id IS NOT NULL
     UNION
     SELECT 'ram_kit' AS category, ram_kit_id AS item_id FROM ranked_builds WHERE rn = 1 AND ram_kit_id IS NOT NULL
     UNION
     SELECT 'storage_drive' AS category, storage_drive_id AS item_id FROM ranked_builds WHERE rn = 1 AND storage_drive_id IS NOT NULL
     UNION
     SELECT 'motherboard' AS category, motherboard_id AS item_id FROM ranked_builds WHERE rn = 1 AND motherboard_id IS NOT NULL
     UNION
     SELECT 'power_supply' AS category, power_supply_id AS item_id FROM ranked_builds WHERE rn = 1 AND power_supply_id IS NOT NULL
     UNION
     SELECT 'case' AS category, case_id AS item_id FROM ranked_builds WHERE rn = 1 AND case_id IS NOT NULL
     UNION
     SELECT 'cpu_cooler' AS category, cpu_cooler_id AS item_id FROM ranked_builds WHERE rn = 1 AND cpu_cooler_id IS NOT NULL`,
    HEALTH_CRITICAL_PROFILE_KEYS,
  );
  return new Set(rows.map((row) => priceTrackableKey(normalizePricingCategory(row.category), row.item_id)));
}

export async function listPriceTrackableCatalogItems(): Promise<PriceTrackableCatalogItem[]> {
  await initDb();
  const db = getAdapter();
  const criticalKeys = await listHealthCriticalPriceTrackableKeys();
  const groups = await Promise.all(PRICE_TRACKABLE_CATALOG_TABLES.map(async ({ table, category, priceColumn }) => {
    const rows = await db.queryAll<{ id: number; name: string; base_price_eur: number }>(
      `SELECT id, name, ${priceColumn} AS base_price_eur FROM ${table} WHERE ${priceColumn} > 0`,
    );
    return rows.map((row) => ({
      category,
      itemId: row.id,
      name: row.name,
      basePriceEur: Number(row.base_price_eur),
      pricingTier: criticalKeys.has(priceTrackableKey(category, row.id)) ? "critical" as const : "background" as const,
    }));
  }));
  return groups.flat();
}

export async function listHealthCriticalPriceTrackableItems(): Promise<PriceTrackableCatalogItem[]> {
  const items = await listPriceTrackableCatalogItems();
  return items.filter((item) => item.pricingTier === "critical");
}

export async function listBackgroundPriceTrackableItems(): Promise<PriceTrackableCatalogItem[]> {
  const items = await listPriceTrackableCatalogItems();
  return items.filter((item) => item.pricingTier === "background");
}

export async function listLatestPricingAttemptTimes(): Promise<Array<{ category: string; item_id: number; attempted_at: string }>> {
  await initDb();
  return getAdapter().queryAll<{ category: string; item_id: number; attempted_at: string }>(
    `SELECT category, item_id, MAX(attempted_at) AS attempted_at
     FROM (
       SELECT category, item_id, checked_at AS attempted_at
       FROM estonian_price_checks
       WHERE checked_at IS NOT NULL AND checked_at != ''
       UNION ALL
       SELECT category, item_id, created_at AS attempted_at
       FROM pricing_run_failures
       WHERE created_at IS NOT NULL AND created_at != ''
     ) attempts
     GROUP BY category, item_id`,
  );
}

export type PricingFreshnessReport = {
  healthy: boolean;
  generatedAt: string;
  todayUtc: string;
  lastSuccessfulRun: Record<string, unknown> | null;
  latestRun: Record<string, unknown> | null;
  latestFailures: Array<Record<string, unknown>>;
  trackableItemCount: number;
  processedItemCount: number;
  skippedItemCountByReason: Record<string, number>;
  sampleSkippedItems: Array<{
    category: string;
    itemId: number;
    name: string;
    query: string;
    reason: string;
  }>;
  expectedVsProcessedMismatchWarning: string | null;
  expectedItems: number;
  healthCriticalItemCount: number;
  backgroundTrackableItemCount: number;
  criticalCoveragePct: number;
  backgroundCoveragePct: number;
  totalTodayHistoryRows: number;
  todayHistoryRows: number;
  missingTodayCount: number;
  missingToday: PricingCatalogPair[];
  criticalMissingTodayCount: number;
  criticalMissingToday: PricingCatalogPair[];
  backgroundMissingTodayCount: number;
  backgroundMissingToday: PricingCatalogPair[];
  stale24hCount: number;
  stale24h: PricingCatalogPair[];
  stale48hCount: number;
  stale48h: PricingCatalogPair[];
  staleChecks24hCount: number;
  staleChecks24h: PricingCatalogPair[];
  criticalStaleChecks24hCount: number;
  criticalStaleChecks24h: PricingCatalogPair[];
  backgroundStaleChecks24hCount: number;
  backgroundStaleChecks24h: PricingCatalogPair[];
  oldestStaleCriticalItem: (PricingCatalogPair & { latestCheckedAt: string | null }) | null;
  oldestStaleBackgroundItem: (PricingCatalogPair & { latestCheckedAt: string | null }) | null;
  staleChecks48hCount: number;
  staleChecks48h: PricingCatalogPair[];
  graphCoveragePct: number;
  backgroundCoveragePctByTodayHistory: number;
  errors: string[];
  warnings: string[];
};

export async function getPricingFreshnessReport(): Promise<PricingFreshnessReport> {
  await initDb();
  const db = getAdapter();
  const now = new Date();
  const todayUtc = utcDateKey(now);
  const cutoff24 = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const cutoff48 = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();

  const pairs = await listPriceTrackableCatalogItems();
  const pairMap = new Map(pairs.map((pair) => [`${pair.category}:${pair.itemId}`, pair]));
  const criticalPairs = pairs.filter((pair) => pair.pricingTier === "critical");
  const backgroundPairs = pairs.filter((pair) => pair.pricingTier === "background");
  const todayRows = await db.queryAll<{ category: string; item_id: number }>(
    "SELECT DISTINCT category, item_id FROM price_history WHERE COALESCE(recorded_date, SUBSTR(recorded_at, 1, 10)) = ? AND source LIKE '%match=%' AND price_eur > 0",
    [todayUtc],
  );
  const todaySet = new Set(todayRows.map((row) => `${normalizePricingCategory(row.category)}:${row.item_id}`));

  const latestRows = await db.queryAll<{ category: string; item_id: number; latest_recorded_at: string }>(
    `SELECT category, item_id, MAX(recorded_at) AS latest_recorded_at
     FROM price_history
     WHERE source LIKE '%match=%' AND price_eur > 0
     GROUP BY category, item_id`,
  );
  const latestHistory = new Map(latestRows.map((row) => [`${normalizePricingCategory(row.category)}:${row.item_id}`, row.latest_recorded_at]));
  const latestCheckRows = await db.queryAll<{ category: string; item_id: number; checked_at: string }>(
    "SELECT category, item_id, checked_at FROM estonian_price_checks WHERE sources LIKE '%match=%' AND market_avg_eur > 0",
  );
  const latestChecks = new Map(latestCheckRows.map((row) => [`${normalizePricingCategory(row.category)}:${row.item_id}`, row.checked_at]));

  const missingToday = pairs.filter((pair) => !todaySet.has(`${pair.category}:${pair.itemId}`));
  const stale24h = pairs.filter((pair) => {
    const latest = latestHistory.get(`${pair.category}:${pair.itemId}`);
    return !latest || latest < cutoff24;
  });
  const stale48h = pairs.filter((pair) => {
    const latest = latestHistory.get(`${pair.category}:${pair.itemId}`);
    return !latest || latest < cutoff48;
  });
  const staleChecks24h = pairs.filter((pair) => {
    const latest = latestChecks.get(`${pair.category}:${pair.itemId}`);
    return !latest || latest < cutoff24;
  });
  const staleChecks48h = pairs.filter((pair) => {
    const latest = latestChecks.get(`${pair.category}:${pair.itemId}`);
    return !latest || latest < cutoff48;
  });
  const isCritical = (pair: PricingCatalogPair) => pairMap.get(`${pair.category}:${pair.itemId}`)?.pricingTier === "critical";
  const criticalMissingToday = missingToday.filter(isCritical);
  const backgroundMissingToday = missingToday.filter((pair) => !isCritical(pair));
  const criticalStale24h = stale24h.filter(isCritical);
  const backgroundStale24h = stale24h.filter((pair) => !isCritical(pair));
  const criticalStaleChecks24h = staleChecks24h.filter(isCritical);
  const backgroundStaleChecks24h = staleChecks24h.filter((pair) => !isCritical(pair));
  const oldestStaleItem = (items: PricingCatalogPair[]) => {
    if (items.length === 0) return null;
    const sorted = [...items].sort((a, b) => {
      const aLatest = latestChecks.get(`${a.category}:${a.itemId}`) ?? "";
      const bLatest = latestChecks.get(`${b.category}:${b.itemId}`) ?? "";
      return aLatest.localeCompare(bLatest) || a.category.localeCompare(b.category) || a.itemId - b.itemId;
    });
    const item = sorted[0];
    return {
      category: item.category,
      itemId: item.itemId,
      name: item.name,
      latestCheckedAt: latestChecks.get(`${item.category}:${item.itemId}`) ?? null,
    };
  };

  const latestRun = await db.queryOne<Record<string, unknown>>(
    "SELECT * FROM pricing_runs ORDER BY started_at DESC, id DESC LIMIT 1",
  ).catch(() => null);
  const lastSuccessfulRun = await db.queryOne<Record<string, unknown>>(
    "SELECT * FROM pricing_runs WHERE status = 'SUCCESS' ORDER BY finished_at DESC, id DESC LIMIT 1",
  ).catch(() => null);
  const latestFailures = await db.queryAll<Record<string, unknown>>(
    "SELECT id, run_id, category, item_id, item_name, source, error_message, created_at FROM pricing_run_failures ORDER BY created_at DESC, id DESC LIMIT 20",
  ).catch(() => []);
  const latestRunId = typeof latestRun?.id === "number" ? latestRun.id : Number(latestRun?.id ?? NaN);
  const latestRunProcessedItems = latestRun
    ? Number(latestRun.items_checked ?? Number(latestRun.updated_items ?? 0) + Number(latestRun.failed_items ?? 0))
    : 0;
  const latestRunExpectedItems = latestRun ? Number(latestRun.items_expected ?? latestRun.total_items ?? 0) : 0;
  const skippedReasonRows = Number.isFinite(latestRunId)
    ? await db.queryAll<{ error_message: string; cnt: number }>(
      "SELECT error_message, COUNT(*) AS cnt FROM pricing_run_failures WHERE run_id = ? AND source = 'source_lookup' GROUP BY error_message ORDER BY cnt DESC, error_message ASC",
      [latestRunId],
    ).catch(() => [])
    : [];
  const skippedItemRows = Number.isFinite(latestRunId)
    ? await db.queryAll<{ category: string; item_id: number; item_name: string; error_message: string }>(
      `SELECT category, item_id, item_name, error_message
       FROM pricing_run_failures
       WHERE run_id = ? AND source = 'source_lookup'
       ORDER BY id DESC
       LIMIT 10`,
      [latestRunId],
    ).catch(() => [])
    : [];
  const skippedItemCountByReason = Object.fromEntries(skippedReasonRows.map((row) => [
    row.error_message || "unknown",
    Number(row.cnt),
  ]));
  const sampleSkippedItems = skippedItemRows.map((row) => ({
    category: normalizePricingCategory(row.category),
    itemId: row.item_id,
    name: row.item_name,
    query: row.item_name,
    reason: row.error_message || "unknown",
  }));
  const expectedVsProcessedMismatchWarning = latestRun && (
    latestRunExpectedItems !== pairs.length || latestRunProcessedItems !== pairs.length
  )
    ? `Latest pricing run checked ${latestRunProcessedItems} of ${pairs.length} trackable item(s); run expected ${latestRunExpectedItems}.`
    : null;

  const errors: string[] = [];
  const warnings: string[] = [];
  if (!latestRun) warnings.push("No pricing run has been recorded.");
  if (!lastSuccessfulRun) warnings.push("No successful complete pricing run has been recorded.");
  if (latestRun && latestRun.status !== "SUCCESS") warnings.push(`Latest pricing run status is ${String(latestRun.status)}.`);
  if (expectedVsProcessedMismatchWarning) warnings.push(expectedVsProcessedMismatchWarning);
  if (criticalMissingToday.length > 0) errors.push(`${criticalMissingToday.length} critical item(s) are missing today's UTC price_history row.`);
  if (criticalStale24h.length > 0) errors.push(`${criticalStale24h.length} critical item(s) have no price_history row newer than 24h.`);
  if (criticalStaleChecks24h.length > 0) errors.push(`${criticalStaleChecks24h.length} critical item(s) have no market price check newer than 24h.`);
  if (backgroundMissingToday.length > 0) warnings.push(`${backgroundMissingToday.length} background item(s) are missing today's UTC price_history row.`);
  if (backgroundStaleChecks24h.length > 0) warnings.push(`${backgroundStaleChecks24h.length} background item(s) have no market price check newer than 24h.`);

  const criticalUncoveredKeys = new Set([
    ...criticalMissingToday.map((pair) => priceTrackableKey(pair.category, pair.itemId)),
    ...criticalStaleChecks24h.map((pair) => priceTrackableKey(pair.category, pair.itemId)),
  ]);
  const backgroundUncoveredKeys = new Set([
    ...backgroundMissingToday.map((pair) => priceTrackableKey(pair.category, pair.itemId)),
    ...backgroundStaleChecks24h.map((pair) => priceTrackableKey(pair.category, pair.itemId)),
  ]);
  const criticalCovered = criticalPairs.length - criticalUncoveredKeys.size;
  const backgroundCovered = backgroundPairs.length - backgroundUncoveredKeys.size;
  return {
    healthy: errors.length === 0,
    generatedAt: now.toISOString(),
    todayUtc,
    lastSuccessfulRun,
    latestRun,
    latestFailures,
    trackableItemCount: pairs.length,
    processedItemCount: latestRunProcessedItems,
    skippedItemCountByReason,
    sampleSkippedItems,
    expectedVsProcessedMismatchWarning,
    expectedItems: criticalPairs.length,
    healthCriticalItemCount: criticalPairs.length,
    backgroundTrackableItemCount: backgroundPairs.length,
    criticalCoveragePct: criticalPairs.length > 0 ? Math.floor((criticalCovered / criticalPairs.length) * 100) : 100,
    backgroundCoveragePct: backgroundPairs.length > 0 ? Math.floor((backgroundCovered / backgroundPairs.length) * 100) : 100,
    totalTodayHistoryRows: todayRows.filter((row) => pairMap.has(`${normalizePricingCategory(row.category)}:${row.item_id}`)).length,
    todayHistoryRows: todayRows.filter((row) => pairMap.get(`${normalizePricingCategory(row.category)}:${row.item_id}`)?.pricingTier === "critical").length,
    missingTodayCount: missingToday.length,
    missingToday: missingToday.slice(0, 100),
    criticalMissingTodayCount: criticalMissingToday.length,
    criticalMissingToday: criticalMissingToday.slice(0, 100),
    backgroundMissingTodayCount: backgroundMissingToday.length,
    backgroundMissingToday: backgroundMissingToday.slice(0, 100),
    stale24hCount: stale24h.length,
    stale24h: stale24h.slice(0, 100),
    stale48hCount: stale48h.length,
    stale48h: stale48h.slice(0, 100),
    staleChecks24hCount: staleChecks24h.length,
    staleChecks24h: staleChecks24h.slice(0, 100),
    criticalStaleChecks24hCount: criticalStaleChecks24h.length,
    criticalStaleChecks24h: criticalStaleChecks24h.slice(0, 100),
    backgroundStaleChecks24hCount: backgroundStaleChecks24h.length,
    backgroundStaleChecks24h: backgroundStaleChecks24h.slice(0, 100),
    oldestStaleCriticalItem: oldestStaleItem([...criticalStaleChecks24h, ...criticalStale24h]),
    oldestStaleBackgroundItem: oldestStaleItem([...backgroundStaleChecks24h, ...backgroundStale24h]),
    staleChecks48hCount: staleChecks48h.length,
    staleChecks48h: staleChecks48h.slice(0, 100),
    graphCoveragePct: criticalPairs.length > 0 ? Math.floor((criticalCovered / criticalPairs.length) * 100) : 100,
    backgroundCoveragePctByTodayHistory: backgroundPairs.length > 0 ? Math.floor((backgroundCovered / backgroundPairs.length) * 100) : 100,
    errors,
    warnings,
  };
}

// ── Auth functions ──

export async function registerAccount({ email, password, adminSetupCode }: { email: string; password: string; adminSetupCode?: string }): Promise<{ ok: boolean; user?: PublicUser; message?: string }> {
  await initDb();
  const db = getAdapter();
  const normalized = email.trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return { ok: false, message: "Please enter a valid email address." };
  }

  const existing = await db.queryOne<{ id: number }>("SELECT id FROM users WHERE email = ? LIMIT 1", [normalized]);
  if (existing) return { ok: false, message: "An account with this email already exists." };

  const isAdmin = normalized === getAdminEmail();
  const existingAdmins = await db.queryOne<{ cnt: number }>(
    "SELECT COUNT(*) AS cnt FROM users WHERE role = 'ADMIN'",
  );
  const hasExistingAdmins = (existingAdmins?.cnt ?? 0) > 0;

  let role = "USER";
  if (isAdmin && !hasExistingAdmins) {
    if (!adminSetupCode || adminSetupCode !== process.env.ADMIN_SETUP_CODE) {
      return { ok: false, message: "Admin setup requires a valid setup code." };
    }
    role = "ADMIN";
  }

  if (password.length < 12) {
    return { ok: false, message: "Password must be at least 12 characters." };
  }

  const passwordHash = hashPassword(password);
  await db.execute(
    "INSERT INTO users (email, password_hash, role, created_at) VALUES (?, ?, ?, ?)",
    [normalized, passwordHash, role, new Date().toISOString()],
  );
  const user = await db.queryOne<{ id: number; email: string; role: string; created_at: string }>(
    "SELECT id, email, role, created_at FROM users WHERE email = ? LIMIT 1", [normalized],
  );
  if (!user) return { ok: false, message: "Failed to create account." };
  return {
    ok: true,
    user: { id: user.id, email: user.email, role: user.role as PublicUser["role"], createdAt: user.created_at },
  };
}

export async function createSessionForCredentials({ email, password, ipAddress, userAgent }: { email: string; password: string; ipAddress?: string; userAgent?: string }): Promise<{ ok: true; token: string; user: PublicUser; expiresAt: string } | { ok: false; message: string }> {
  await initDb();
  const db = getAdapter();
  const normalized = email.trim().toLowerCase();

  const userRow = await db.queryOne<{ id: number; email: string; password_hash: string; role: string; created_at: string }>(
    "SELECT id, email, password_hash, role, created_at FROM users WHERE email = ? LIMIT 1", [normalized],
  );
  if (!userRow) return { ok: false, message: "Invalid email or password." };
  if (!verifyPassword(password, userRow.password_hash)) return { ok: false, message: "Invalid email or password." };

  const token = createSessionToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  await db.execute(
    "INSERT INTO sessions (user_id, token_hash, expires_at, ip_address, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [userRow.id, tokenHash, expiresAt, ipAddress ?? null, userAgent ?? null, new Date().toISOString()],
  );

  return {
    ok: true,
    token,
    expiresAt,
    user: { id: userRow.id, email: userRow.email, role: userRow.role as PublicUser["role"], createdAt: userRow.created_at },
  };
}

export async function getUserFromSessionToken(token: string): Promise<PublicUser | null> {
  await initDb();
  const db = getAdapter();
  const tokenHash = hashToken(token);
  const row = await db.queryOne<{ id: number; email: string; role: string; created_at: string }>(
    `SELECT u.id, u.email, u.role, u.created_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.invalidated_at IS NULL AND s.expires_at > ?
     LIMIT 1`,
    [tokenHash, new Date().toISOString()],
  );
  if (!row) return null;
  return { id: row.id, email: row.email, role: row.role as PublicUser["role"], createdAt: row.created_at };
}

export async function invalidateSessionToken(token: string): Promise<void> {
  await initDb();
  await getAdapter().execute(
    "UPDATE sessions SET invalidated_at = ? WHERE token_hash = ?",
    [new Date().toISOString(), hashToken(token)],
  );
}

export async function getAccountSummary(): Promise<AccountSummary> {
  await initDb();
  const db = getAdapter();
  const rows = await db.queryAll<{ role: string; cnt: number }>(
    "SELECT role, COUNT(*) AS cnt FROM users GROUP BY role",
  );
  const total = rows.reduce((sum, r) => sum + r.cnt, 0);
  const admins = rows.find((r) => r.role === "ADMIN")?.cnt ?? 0;
  const devs = rows.find((r) => r.role === "DEV")?.cnt ?? 0;
  const users = rows.find((r) => r.role === "USER")?.cnt ?? 0;
  return { total, admins, devs, users };
}

// ── Order functions ──

export async function createPendingOrderForBuild({ userId, buildId }: { userId: number; buildId: number }): Promise<{ ok: true; orderId: number; amountEurCents: number; buildName: string; pricedLive: number; pricedFallback: number } | { ok: false; message: string }> {
  await initDb();
  const db = getAdapter();
  const build = await getProfileBuildById(buildId);
  if (!build) return { ok: false, message: "Build not found." };

  const checks = await listEstonianPriceChecks();
  const checkMap = new Map(checks.map((c) => [`${c.category}:${c.item_id}`, Math.round(c.final_price_eur)]));

  const componentSlots: Array<{ label: string; cat: string; idKey: string }> = [
    { label: "CPU", cat: "cpu", idKey: "cpu_id" },
    { label: "GPU", cat: "gpu", idKey: "gpu_id" },
    { label: "RAM", cat: "ram_kit", idKey: "ram_kit_id" },
    { label: "Storage", cat: "storage_drive", idKey: "storage_drive_id" },
    { label: "Motherboard", cat: "motherboard", idKey: "motherboard_id" },
    { label: "PSU", cat: "power_supply", idKey: "power_supply_id" },
    { label: "Case", cat: "case", idKey: "case_id" },
    { label: "Cooler", cat: "cpu_cooler", idKey: "cpu_cooler_id" },
  ];

  const itemFetchers: Record<string, (id: number) => Promise<{ name: string; price_eur: number } | null>> = {
    cpu: (id) => getCpuById(id),
    gpu: (id) => getGpuById(id),
    ram_kit: (id) => getRamKitById(id),
    storage_drive: (id) => getStorageDriveById(id),
    motherboard: (id) => getMotherboardById(id),
    power_supply: (id) => getPowerSupplyById(id),
    case: (id) => getCaseById(id),
    cpu_cooler: (id) => getCpuCoolerById(id),
  };

  let totalEur = 0;
  let pricedLive = 0;
  let pricedFallback = 0;
  const unpricedComponents: string[] = [];
  const componentSnapshots: Array<{
    slotKey: string;
    itemId: number;
    itemName: string;
    unitPriceEur: number;
    priceSource: "market_live" | "seed_fallback";
  }> = [];

  for (const slot of componentSlots) {
    const id = (build as Record<string, unknown>)[slot.idKey];
    if (typeof id !== "number" || id <= 0) {
      unpricedComponents.push(slot.label);
      continue;
    }

    const item = await itemFetchers[slot.cat]?.(id);
    if (!item) {
      unpricedComponents.push(slot.label);
      continue;
    }

    const livePrice = checkMap.get(`${slot.cat}:${id}`);
    if (livePrice !== undefined) {
      totalEur += livePrice;
      pricedLive++;
      componentSnapshots.push({
        slotKey: slot.cat,
        itemId: id,
        itemName: item.name,
        unitPriceEur: livePrice,
        priceSource: "market_live",
      });
      continue;
    }

    const fallbackPrice = Math.round(item.price_eur * ASSEMBLY_MARKUP_MULTIPLIER);
    totalEur += fallbackPrice;
    pricedFallback++;
    componentSnapshots.push({
      slotKey: slot.cat,
      itemId: id,
      itemName: item.name,
      unitPriceEur: fallbackPrice,
      priceSource: "seed_fallback",
    });
  }

  if (unpricedComponents.length > 0) {
    return { ok: false, message: `Cannot create order: no price available for ${unpricedComponents.join(", ")}. Please contact support.` };
  }

  if (totalEur <= 0) {
    return { ok: false, message: "Cannot create order: build has no priced components." };
  }

  const now = new Date().toISOString();
  const amountCents = totalEur * 100;

  try {
    const order = await db.transaction(async (tx) => {
      await tx.execute(
        `INSERT INTO orders (user_id, profile_build_id, order_item_type, order_item_id, build_name, amount_eur_cents, currency, status, created_at, updated_at)
         VALUES (?, ?, 'PROFILE_BUILD', ?, ?, ?, 'eur', 'PENDING', ?, ?)`,
        [userId, buildId, buildId, build.build_name, amountCents, now, now],
      );

      const insertedOrder = await tx.queryOne<OrderRecord>(
        `SELECT ${ORDER_SELECT} FROM orders WHERE user_id = ? AND profile_build_id = ? AND order_item_type = 'PROFILE_BUILD' AND status = 'PENDING' ORDER BY id DESC LIMIT 1`,
        [userId, buildId],
      );
      if (!insertedOrder) throw new Error("Failed to create order.");

      for (const snap of componentSnapshots) {
        await tx.execute(
          `INSERT INTO order_price_snapshots (order_id, slot_key, order_item_type, item_id, item_name, unit_price_eur, price_source, created_at)
           VALUES (?, ?, 'PROFILE_BUILD', ?, ?, ?, ?, ?)`,
          [insertedOrder.id, snap.slotKey, snap.itemId, snap.itemName, snap.unitPriceEur, snap.priceSource, now],
        );
      }

      return insertedOrder;
    });

    return { ok: true, orderId: order.id, amountEurCents: amountCents, buildName: build.build_name, pricedLive, pricedFallback };
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const concurrentOrder = await getOpenOrderForBuild({ userId, buildId });
    if (concurrentOrder) {
      return {
        ok: true,
        orderId: concurrentOrder.id,
        amountEurCents: concurrentOrder.amount_eur_cents,
        buildName: concurrentOrder.build_name,
        pricedLive: 0,
        pricedFallback: 0,
      };
    }
    throw error;
  }
}

export async function createPendingOrderForCatalogItem({ userId, itemType, itemId }: { userId: number; itemType: string; itemId: number }): Promise<{ ok: true; orderId: number; amountEurCents: number; buildName: string } | { ok: false; message: string }> {
  await initDb();
  const db = getAdapter();

  // Resolve item name and price
  let itemName = "Unknown item";
  let basePriceEur = 0;
  let category = "";

  const resolvers: Record<string, () => Promise<{ name: string; price: number } | null>> = {
    GPU: async () => { const i = await getGpuById(itemId); return i ? { name: i.name, price: i.price_eur } : null; },
    CPU: async () => { const i = await getCpuById(itemId); return i ? { name: i.name, price: i.price_eur } : null; },
    RAM_KIT: async () => { const i = await getRamKitById(itemId); return i ? { name: i.name, price: i.price_eur } : null; },
    POWER_SUPPLY: async () => { const i = await getPowerSupplyById(itemId); return i ? { name: i.name, price: i.price_eur } : null; },
    CASE: async () => { const i = await getCaseById(itemId); return i ? { name: i.name, price: i.price_eur } : null; },
    MOTHERBOARD: async () => { const i = await getMotherboardById(itemId); return i ? { name: i.name, price: i.price_eur } : null; },
    COMPACT_AI_SYSTEM: async () => { const i = await getCompactAiSystemById(itemId); return i ? { name: i.name, price: i.price_eur } : null; },
    STORAGE_DRIVE: async () => { const i = await getStorageDriveById(itemId); return i ? { name: i.name, price: i.price_eur } : null; },
    CPU_COOLER: async () => { const i = await getCpuCoolerById(itemId); return i ? { name: i.name, price: i.price_eur } : null; },
  };

  const resolver = resolvers[itemType];
  if (resolver) {
    const resolved = await resolver();
    if (resolved) { itemName = resolved.name; basePriceEur = resolved.price; }
  }

  if (itemName === "Unknown item") return { ok: false, message: "Item not found." };

  // Use market price if available
  const catMap: Record<string, string> = { GPU: "gpu", CPU: "cpu", RAM_KIT: "ram_kit", POWER_SUPPLY: "power_supply", CASE: "case", MOTHERBOARD: "motherboard", COMPACT_AI_SYSTEM: "compact_ai_system", STORAGE_DRIVE: "storage_drive", CPU_COOLER: "cpu_cooler" };
  category = catMap[itemType] ?? "";
  const priceCheck = category ? await getEstonianPriceCheck(category, itemId) : null;
  const finalPriceEur = priceCheck ? Math.round(priceCheck.final_price_eur) : Math.round(basePriceEur * ASSEMBLY_MARKUP_MULTIPLIER);
  const amountCents = finalPriceEur * 100;

  const now = new Date().toISOString();
  try {
    const order = await db.transaction(async (tx) => {
      await tx.execute(
        `INSERT INTO orders (user_id, profile_build_id, order_item_type, order_item_id, build_name, amount_eur_cents, currency, status, created_at, updated_at)
         VALUES (?, 0, ?, ?, ?, ?, 'eur', 'PENDING', ?, ?)`,
        [userId, itemType, itemId, itemName, amountCents, now, now],
      );

      const insertedOrder = await tx.queryOne<OrderRecord>(
        `SELECT ${ORDER_SELECT} FROM orders WHERE user_id = ? AND order_item_type = ? AND order_item_id = ? AND status = 'PENDING' ORDER BY id DESC LIMIT 1`,
        [userId, itemType, itemId],
      );
      if (!insertedOrder) throw new Error("Failed to create order.");

      await tx.execute(
        `INSERT INTO order_price_snapshots (order_id, slot_key, order_item_type, item_id, item_name, unit_price_eur, price_source, created_at)
         VALUES (?, 'direct_item', ?, ?, ?, ?, ?, ?)`,
        [insertedOrder.id, itemType, itemId, itemName, finalPriceEur, priceCheck ? "market_live" : "seed_fallback", now],
      );

      return insertedOrder;
    });

    return { ok: true, orderId: order.id, amountEurCents: amountCents, buildName: itemName };
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const concurrentOrder = await getOpenOrderForItem({ userId, itemType, itemId });
    if (concurrentOrder) {
      return {
        ok: true,
        orderId: concurrentOrder.id,
        amountEurCents: concurrentOrder.amount_eur_cents,
        buildName: concurrentOrder.build_name,
      };
    }
    throw error;
  }
}

export async function getRecentOpenOrderForBuild({ userId, buildId }: { userId: number; buildId: number }): Promise<{ stripe_checkout_session_id: string | null } | null> {
  await initDb();
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  return getAdapter().queryOne<{ stripe_checkout_session_id: string | null }>(
    "SELECT stripe_checkout_session_id FROM orders WHERE user_id = ? AND profile_build_id = ? AND order_item_type = 'PROFILE_BUILD' AND status IN ('PENDING', 'CHECKOUT_CREATED') AND created_at > ? ORDER BY created_at DESC, id DESC LIMIT 1",
    [userId, buildId, cutoff],
  );
}

export async function getOpenOrderForBuild({ userId, buildId }: { userId: number; buildId: number }): Promise<OrderRecord | null> {
  await initDb();
  return getAdapter().queryOne<OrderRecord>(
    `SELECT ${ORDER_SELECT}
     FROM orders
     WHERE user_id = ? AND profile_build_id = ? AND order_item_type = 'PROFILE_BUILD'
       AND status IN (${OPEN_ORDER_STATUSES})
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [userId, buildId],
  );
}

export async function getRecentOpenOrderForItem({ userId, itemType, itemId }: { userId: number; itemType: string; itemId: number }): Promise<{ stripe_checkout_session_id: string | null } | null> {
  await initDb();
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  return getAdapter().queryOne<{ stripe_checkout_session_id: string | null }>(
    "SELECT stripe_checkout_session_id FROM orders WHERE user_id = ? AND order_item_type = ? AND order_item_id = ? AND status IN ('PENDING', 'CHECKOUT_CREATED') AND created_at > ? ORDER BY created_at DESC, id DESC LIMIT 1",
    [userId, itemType, itemId, cutoff],
  );
}

export async function getOpenOrderForItem({ userId, itemType, itemId }: { userId: number; itemType: string; itemId: number }): Promise<OrderRecord | null> {
  await initDb();
  return getAdapter().queryOne<OrderRecord>(
    `SELECT ${ORDER_SELECT}
     FROM orders
     WHERE user_id = ? AND order_item_type = ? AND order_item_id = ?
       AND status IN (${OPEN_ORDER_STATUSES})
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [userId, itemType, itemId],
  );
}

export async function setOrderCheckoutSession({ orderId, checkoutSessionId }: { orderId: number; checkoutSessionId: string }): Promise<boolean> {
  await initDb();
  const updated = await getAdapter().execute(
    `UPDATE orders
     SET status = 'CHECKOUT_CREATED', stripe_checkout_session_id = ?, updated_at = ?
     WHERE id = ?
       AND (stripe_checkout_session_id IS NULL OR stripe_checkout_session_id = ?)`,
    [checkoutSessionId, new Date().toISOString(), orderId, checkoutSessionId],
  );
  return updated === 1;
}

export async function markOrderPaidForFulfillment({ checkoutSessionId, paymentIntentId }: { checkoutSessionId: string; paymentIntentId?: string | null }): Promise<{ won: boolean }> {
  await initDb();
  const now = new Date().toISOString();
  const updated = await getAdapter().execute(
    `UPDATE orders
     SET status = 'PAID',
         stripe_payment_intent_id = COALESCE(?, stripe_payment_intent_id),
         paid_at = COALESCE(paid_at, ?),
         fulfilled_at = COALESCE(fulfilled_at, ?),
         updated_at = ?
     WHERE stripe_checkout_session_id = ?
       AND status != 'PAID'
       AND fulfilled_at IS NULL`,
    [paymentIntentId ?? null, now, now, now, checkoutSessionId],
  );
  return { won: updated === 1 };
}

export async function markOrderPaidFromCheckoutSession({ checkoutSessionId, paymentIntentId }: { checkoutSessionId: string; paymentIntentId?: string | null }): Promise<void> {
  await markOrderPaidForFulfillment({ checkoutSessionId, paymentIntentId });
}

export async function markOrderCustomerEmailSent(checkoutSessionId: string): Promise<void> {
  await initDb();
  const now = new Date().toISOString();
  await getAdapter().execute(
    "UPDATE orders SET customer_email_sent_at = COALESCE(customer_email_sent_at, ?), customer_email_send_attempted_at = NULL, customer_email_last_error = '', updated_at = ? WHERE stripe_checkout_session_id = ?",
    [now, now, checkoutSessionId],
  );
}

export async function markOrderAdminEmailSent(checkoutSessionId: string): Promise<void> {
  await initDb();
  const now = new Date().toISOString();
  await getAdapter().execute(
    "UPDATE orders SET admin_email_sent_at = COALESCE(admin_email_sent_at, ?), admin_email_send_attempted_at = NULL, admin_email_last_error = '', updated_at = ? WHERE stripe_checkout_session_id = ?",
    [now, now, checkoutSessionId],
  );
}

const EMAIL_SEND_LOCK_MS = 10 * 60 * 1000;

export async function claimOrderCustomerEmailSend(checkoutSessionId: string): Promise<boolean> {
  await initDb();
  const now = new Date();
  const lockCutoff = new Date(now.getTime() - EMAIL_SEND_LOCK_MS).toISOString();
  const updated = await getAdapter().execute(
    `UPDATE orders
     SET customer_email_send_attempted_at = ?, updated_at = ?
     WHERE stripe_checkout_session_id = ?
       AND status = 'PAID'
       AND customer_email_sent_at IS NULL
       AND (customer_email_send_attempted_at IS NULL OR customer_email_send_attempted_at < ?)`,
    [now.toISOString(), now.toISOString(), checkoutSessionId, lockCutoff],
  );
  return updated === 1;
}

export async function claimOrderAdminEmailSend(checkoutSessionId: string): Promise<boolean> {
  await initDb();
  const now = new Date();
  const lockCutoff = new Date(now.getTime() - EMAIL_SEND_LOCK_MS).toISOString();
  const updated = await getAdapter().execute(
    `UPDATE orders
     SET admin_email_send_attempted_at = ?, updated_at = ?
     WHERE stripe_checkout_session_id = ?
       AND status = 'PAID'
       AND admin_email_sent_at IS NULL
       AND (admin_email_send_attempted_at IS NULL OR admin_email_send_attempted_at < ?)`,
    [now.toISOString(), now.toISOString(), checkoutSessionId, lockCutoff],
  );
  return updated === 1;
}

export async function releaseOrderCustomerEmailSend(checkoutSessionId: string, errorMessage: string): Promise<void> {
  await initDb();
  const now = new Date().toISOString();
  await getAdapter().execute(
    "UPDATE orders SET customer_email_send_attempted_at = NULL, customer_email_last_error = ?, updated_at = ? WHERE stripe_checkout_session_id = ? AND customer_email_sent_at IS NULL",
    [errorMessage.slice(0, 500), now, checkoutSessionId],
  );
}

export async function releaseOrderAdminEmailSend(checkoutSessionId: string, errorMessage: string): Promise<void> {
  await initDb();
  const now = new Date().toISOString();
  await getAdapter().execute(
    "UPDATE orders SET admin_email_send_attempted_at = NULL, admin_email_last_error = ?, updated_at = ? WHERE stripe_checkout_session_id = ? AND admin_email_sent_at IS NULL",
    [errorMessage.slice(0, 500), now, checkoutSessionId],
  );
}

export async function markOrderFailedFromCheckoutSession({ checkoutSessionId, paymentIntentId }: { checkoutSessionId: string; paymentIntentId?: string | null }): Promise<void> {
  await initDb();
  await getAdapter().execute(
    "UPDATE orders SET status = 'FAILED', stripe_payment_intent_id = COALESCE(?, stripe_payment_intent_id), updated_at = ? WHERE stripe_checkout_session_id = ? AND status != 'PAID'",
    [paymentIntentId ?? null, new Date().toISOString(), checkoutSessionId],
  );
}

export async function markOrderCanceledFromCheckoutSession(checkoutSessionId: string): Promise<void> {
  await initDb();
  await getAdapter().execute(
    "UPDATE orders SET status = 'CANCELED', updated_at = ? WHERE stripe_checkout_session_id = ? AND status != 'PAID'",
    [new Date().toISOString(), checkoutSessionId],
  );
}

export async function getOrderByCheckoutSessionForUser({ userId, checkoutSessionId }: { userId: number; checkoutSessionId: string }): Promise<OrderRecord | null> {
  await initDb();
  return getAdapter().queryOne<OrderRecord>(
    `SELECT ${ORDER_SELECT} FROM orders WHERE user_id = ? AND stripe_checkout_session_id = ? LIMIT 1`,
    [userId, checkoutSessionId],
  );
}

export async function getOrderByCheckoutSession(checkoutSessionId: string): Promise<OrderRecord | null> {
  await initDb();
  return getAdapter().queryOne<OrderRecord>(
    `SELECT ${ORDER_SELECT} FROM orders WHERE stripe_checkout_session_id = ? LIMIT 1`,
    [checkoutSessionId],
  );
}

export async function getOrderById(id: number): Promise<OrderRecord | null> {
  await initDb();
  return getAdapter().queryOne<OrderRecord>(`SELECT ${ORDER_SELECT} FROM orders WHERE id = ? LIMIT 1`, [id]);
}

export async function reserveStripeWebhookEvent(eventId: string, eventType: string): Promise<"reserved" | "duplicate" | "in_progress"> {
  await initDb();
  const db = getAdapter();
  const now = new Date();
  const nowIso = now.toISOString();
  try {
    await db.execute(
      "INSERT INTO stripe_webhook_events (event_id, event_type, status, created_at, updated_at) VALUES (?, ?, 'PROCESSING', ?, ?)",
      [eventId, eventType, nowIso, nowIso],
    );
    return "reserved";
  } catch {
    const existing = await db.queryOne<{ status: string; updated_at: string }>(
      "SELECT status, updated_at FROM stripe_webhook_events WHERE event_id = ? LIMIT 1",
      [eventId],
    );
    if (existing?.status === "PROCESSED") return "duplicate";

    const updatedAt = existing?.updated_at ? Date.parse(existing.updated_at) : 0;
    const isRecentlyProcessing = existing?.status === "PROCESSING" && Number.isFinite(updatedAt) && now.getTime() - updatedAt < 10 * 60 * 1000;
    if (isRecentlyProcessing) return "in_progress";

    await db.execute(
      "UPDATE stripe_webhook_events SET event_type = ?, status = 'PROCESSING', updated_at = ?, last_error = '' WHERE event_id = ?",
      [eventType, nowIso, eventId],
    );
    return "reserved";
  }
}

export async function markStripeWebhookEventProcessed(eventId: string): Promise<void> {
  await initDb();
  const now = new Date().toISOString();
  await getAdapter().execute(
    "UPDATE stripe_webhook_events SET status = 'PROCESSED', processed_at = ?, updated_at = ?, last_error = '' WHERE event_id = ?",
    [now, now, eventId],
  );
}

export async function markStripeWebhookEventFailed(eventId: string, errorMessage: string): Promise<void> {
  await initDb();
  await getAdapter().execute(
    "UPDATE stripe_webhook_events SET status = 'FAILED', updated_at = ?, last_error = ? WHERE event_id = ?",
    [new Date().toISOString(), errorMessage.slice(0, 500), eventId],
  );
}

export async function markOrderCheckoutCreationFailed(orderId: number): Promise<void> {
  await initDb();
  await getAdapter().execute(
    "UPDATE orders SET status = 'FAILED', updated_at = ? WHERE id = ?",
    [new Date().toISOString(), orderId],
  );
}

export async function listOrdersForUser(userId: number): Promise<UserOrderListItem[]> {
  await initDb();
  return getAdapter().queryAll<UserOrderListItem>(
    "SELECT id, build_name, amount_eur_cents, currency, status, stripe_checkout_session_id, created_at, updated_at FROM orders WHERE user_id = ? ORDER BY id DESC",
    [userId],
  );
}

export async function listAllOrdersForAdmin(): Promise<AdminOrderListItem[]> {
  await initDb();
  return getAdapter().queryAll<AdminOrderListItem>(
    `SELECT o.id, o.user_id, u.email AS user_email, o.profile_build_id, o.order_item_type, o.order_item_id,
            o.build_name, o.amount_eur_cents, o.currency, o.status, o.stripe_checkout_session_id,
            o.stripe_payment_intent_id, o.paid_at, o.fulfilled_at, o.customer_email_sent_at,
            o.admin_email_sent_at, o.customer_email_send_attempted_at, o.admin_email_send_attempted_at,
            o.customer_email_last_error, o.admin_email_last_error, o.created_at, o.updated_at
     FROM orders o JOIN users u ON u.id = o.user_id ORDER BY o.id DESC`,
  );
}

export async function listRecentQuoteRequestsForAdmin(limit = 20): Promise<AdminQuoteRequestListItem[]> {
  await initDb();
  const safeLimit = Math.min(50, Math.max(1, Math.floor(limit)));
  return getAdapter().queryAll<AdminQuoteRequestListItem>(
    `SELECT id, customer_email, customer_name, product_type, product_id, product_name,
            status, operator_note, contacted_at, created_at, updated_at
     FROM quote_requests
     ORDER BY created_at DESC, id DESC
     LIMIT ?`,
    [safeLimit],
  );
}

export async function getPaidOrderEmailPayloadByCheckoutSession(checkoutSessionId: string): Promise<PaidOrderEmailPayload | null> {
  await initDb();
  const row = await getAdapter().queryOne<{
    order_id: number;
    customer_email: string;
    build_name: string;
    amount_eur_cents: number;
    created_at: string;
  }>(
    `SELECT o.id AS order_id, u.email AS customer_email, o.build_name AS build_name, o.amount_eur_cents AS amount_eur_cents, o.created_at AS created_at
     FROM orders o JOIN users u ON u.id = o.user_id
     WHERE o.stripe_checkout_session_id = ? LIMIT 1`,
    [checkoutSessionId],
  );
  if (!row) return null;
  return {
    orderId: row.order_id,
    customerEmail: row.customer_email,
    buildName: row.build_name,
    amountEurCents: row.amount_eur_cents,
    createdAt: row.created_at,
  };
}

export type PaidOrderEmailRetryCandidate = {
  id: number;
  stripe_checkout_session_id: string;
  missing_customer_email: boolean;
  missing_admin_email: boolean;
};

export async function listPaidOrdersMissingEmailNotifications(limit = 20): Promise<PaidOrderEmailRetryCandidate[]> {
  await initDb();
  const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
  const rows = await getAdapter().queryAll<{
    id: number;
    stripe_checkout_session_id: string | null;
    customer_email_sent_at: string | null;
    admin_email_sent_at: string | null;
  }>(
    `SELECT id, stripe_checkout_session_id, customer_email_sent_at, admin_email_sent_at
     FROM orders
     WHERE status = 'PAID'
       AND stripe_checkout_session_id IS NOT NULL
       AND (customer_email_sent_at IS NULL OR admin_email_sent_at IS NULL)
     ORDER BY updated_at ASC, id ASC
     LIMIT ?`,
    [safeLimit],
  );

  return rows
    .filter((row): row is typeof row & { stripe_checkout_session_id: string } => Boolean(row.stripe_checkout_session_id))
    .map((row) => ({
      id: row.id,
      stripe_checkout_session_id: row.stripe_checkout_session_id,
      missing_customer_email: row.customer_email_sent_at === null,
      missing_admin_email: row.admin_email_sent_at === null,
    }));
}

export async function getPaidOrderEmailRetryCandidate(orderId: number): Promise<PaidOrderEmailRetryCandidate | null> {
  await initDb();
  const row = await getAdapter().queryOne<{
    id: number;
    stripe_checkout_session_id: string | null;
    customer_email_sent_at: string | null;
    admin_email_sent_at: string | null;
  }>(
    `SELECT id, stripe_checkout_session_id, customer_email_sent_at, admin_email_sent_at
     FROM orders
     WHERE id = ?
       AND status = 'PAID'
       AND stripe_checkout_session_id IS NOT NULL
       AND (customer_email_sent_at IS NULL OR admin_email_sent_at IS NULL)
     LIMIT 1`,
    [orderId],
  );

  if (!row?.stripe_checkout_session_id) return null;
  return {
    id: row.id,
    stripe_checkout_session_id: row.stripe_checkout_session_id,
    missing_customer_email: row.customer_email_sent_at === null,
    missing_admin_email: row.admin_email_sent_at === null,
  };
}

export type QuoteRequestProductType = "mac_system" | "external_gpu_enclosure" | "mac_egpu_build";

export const QUOTE_REQUEST_STATUSES = ["NEW", "CONTACTED", "WAITING_CUSTOMER", "QUOTED", "CLOSED", "SPAM"] as const;

const QUOTE_STATUS_TRANSITIONS: Record<QuoteRequestStatus, QuoteRequestStatus[]> = {
  NEW: ["CONTACTED", "CLOSED", "SPAM"],
  CONTACTED: ["WAITING_CUSTOMER", "QUOTED", "CLOSED", "SPAM"],
  WAITING_CUSTOMER: ["CONTACTED", "QUOTED", "CLOSED", "SPAM"],
  QUOTED: ["WAITING_CUSTOMER", "CLOSED", "SPAM"],
  CLOSED: ["CONTACTED"],
  SPAM: ["NEW"],
};

function normalizeQuoteRequestText(value: string, maxLength: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function isQuoteRequestStatus(value: string): value is QuoteRequestStatus {
  return (QUOTE_REQUEST_STATUSES as readonly string[]).includes(value);
}

function validateQuoteEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function resolveQuoteProduct(productType: QuoteRequestProductType, productId: number): Promise<{ name: string } | null> {
  if (productType === "mac_system") {
    const item = await getMacSystemById(productId);
    return item ? { name: item.name } : null;
  }
  if (productType === "external_gpu_enclosure") {
    const item = await getExternalGpuEnclosureById(productId);
    return item ? { name: item.name } : null;
  }
  const item = await getMacEgpuBuildById(productId);
  return item ? { name: item.name } : null;
}

export async function createQuoteRequest(input: {
  customerEmail: string;
  customerName: string;
  productType: QuoteRequestProductType;
  productId: number;
  message: string;
}): Promise<{ ok: true; quoteRequest: QuoteRequestRecord } | { ok: false; message: string }> {
  await initDb();

  const customerEmail = input.customerEmail.trim().toLowerCase().slice(0, 254);
  const customerName = normalizeQuoteRequestText(input.customerName, 120);
  const message = normalizeQuoteRequestText(input.message, 2000);
  const productId = input.productId;

  if (!validateQuoteEmail(customerEmail)) {
    return { ok: false, message: "Please enter a valid email address." };
  }
  if (customerName.length < 2) {
    return { ok: false, message: "Please enter your name." };
  }
  if (!Number.isInteger(productId) || productId <= 0) {
    return { ok: false, message: "Invalid product selection." };
  }
  if (message.length < 10) {
    return { ok: false, message: "Please include a short description of your use case." };
  }

  const product = await resolveQuoteProduct(input.productType, productId);
  if (!product) {
    return { ok: false, message: "Quote product not found." };
  }

  const now = new Date().toISOString();
  const db = getAdapter();
  await db.execute(
    `INSERT INTO quote_requests (customer_email, customer_name, product_type, product_id, product_name, message, status, operator_note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'NEW', '', ?, ?)`,
    [customerEmail, customerName, input.productType, productId, product.name, message, now, now],
  );

  const quoteRequest = await db.queryOne<QuoteRequestRecord>(
    `SELECT id, customer_email, customer_name, product_type, product_id, product_name,
            message, status, operator_note, contacted_at, created_at, updated_at
     FROM quote_requests
     WHERE customer_email = ? AND product_type = ? AND product_id = ? AND created_at = ?
     ORDER BY id DESC
     LIMIT 1`,
    [customerEmail, input.productType, productId, now],
  );

  if (!quoteRequest) {
    return { ok: false, message: "Failed to create quote request." };
  }

  return { ok: true, quoteRequest };
}

export async function getQuoteRequestContactForAdmin(id: number): Promise<{
  id: number;
  customer_email: string;
  customer_name: string;
  product_name: string;
} | null> {
  await initDb();
  if (!Number.isInteger(id) || id <= 0) return null;
  return getAdapter().queryOne<{
    id: number;
    customer_email: string;
    customer_name: string;
    product_name: string;
  }>(
    "SELECT id, customer_email, customer_name, product_name FROM quote_requests WHERE id = ? LIMIT 1",
    [id],
  );
}

export async function updateQuoteRequestForAdmin({
  id,
  status,
  operatorNote,
}: {
  id: number;
  status?: string;
  operatorNote?: string;
}): Promise<{ ok: true; quoteRequest: QuoteRequestRecord } | { ok: false; message: string }> {
  await initDb();
  if (!Number.isInteger(id) || id <= 0) return { ok: false, message: "Invalid quote request ID." };

  const db = getAdapter();
  const current = await db.queryOne<QuoteRequestRecord>(
    `SELECT id, customer_email, customer_name, product_type, product_id, product_name,
            message, status, operator_note, contacted_at, created_at, updated_at
     FROM quote_requests
     WHERE id = ? LIMIT 1`,
    [id],
  );
  if (!current) return { ok: false, message: "Quote request not found." };

  const nextStatus = status === undefined ? current.status : String(status).trim().toUpperCase();
  if (!isQuoteRequestStatus(nextStatus)) {
    return { ok: false, message: "Invalid quote request status." };
  }
  if (nextStatus !== current.status && !QUOTE_STATUS_TRANSITIONS[current.status].includes(nextStatus)) {
    return { ok: false, message: `Invalid status transition from ${current.status} to ${nextStatus}.` };
  }

  const nextNote = operatorNote === undefined
    ? current.operator_note
    : normalizeQuoteRequestText(String(operatorNote), 500);
  const now = new Date().toISOString();
  const contactedAt = nextStatus === "CONTACTED" && !current.contacted_at ? now : current.contacted_at;

  await db.execute(
    `UPDATE quote_requests
     SET status = ?, operator_note = ?, contacted_at = ?, updated_at = ?
     WHERE id = ?`,
    [nextStatus, nextNote, contactedAt, now, id],
  );

  const updated = await db.queryOne<QuoteRequestRecord>(
    `SELECT id, customer_email, customer_name, product_type, product_id, product_name,
            message, status, operator_note, contacted_at, created_at, updated_at
     FROM quote_requests
     WHERE id = ? LIMIT 1`,
    [id],
  );
  if (!updated) return { ok: false, message: "Quote request update failed." };
  return { ok: true, quoteRequest: updated };
}

// ── Seed profile builds (needs catalog data seeded first) ──

async function seedProfileBuilds(db: ReturnType<typeof getAdapter>): Promise<void> {
  const cpuIds: Record<string, number> = {};
  const gpuIds: Record<string, number> = {};
  const ramIds: Record<string, number> = {};
  const storageIds: Record<string, number> = {};
  const mbIds: Record<string, number> = {};
  const psuIds: Record<string, number> = {};
  const caseIds: Record<string, number> = {};
  const coolerIds: Record<string, number> = {};

  const populate = async <T extends { id: number; name: string }>(table: string, map: Record<string, number>) => {
    const rows = await db.queryAll<T>(`SELECT id, name FROM ${table}`);
    for (const r of rows) map[r.name] = r.id;
  };

  await Promise.all([
    populate<{ id: number; name: string }>("cpus", cpuIds),
    populate<{ id: number; name: string }>("gpus", gpuIds),
    populate<{ id: number; name: string }>("ram_kits", ramIds),
    populate<{ id: number; name: string }>("storage_drives", storageIds),
    populate<{ id: number; name: string }>("motherboards", mbIds),
    populate<{ id: number; name: string }>("power_supplies", psuIds),
    populate<{ id: number; name: string }>("pc_cases", caseIds),
    populate<{ id: number; name: string }>("cpu_coolers", coolerIds),
  ]);

  const builds = [
    { profileKey: "local-llm-inference", profileLabel: "Local LLM Inference", buildName: "Flagship 24GB CUDA Inference", targetModel: "70B q4 (select workloads)", ramGb: 128, storageGb: 4000, estimatedPriceEur: 3349, bestFor: "70B quantized local inference with maximum VRAM", estimatedTokensPerSec: "8-15 t/s (70B q4)", estimatedSystemPowerW: 650, recommendedPsuW: 1500, coolingProfile: "High-airflow tower with 360mm AIO", cpuName: "AMD Ryzen 9 7950X", gpuName: "NVIDIA RTX 4090", ramName: "Corsair Vengeance 128GB (4x32GB) DDR5-5600 CL40", storageName: "Samsung 990 Pro 4TB", mbName: "MSI MAG X670E Tomahawk WiFi", psuName: "Corsair HX1500i 1500W", caseName: "Fractal Design Torrent", coolerName: "Arctic Liquid Freezer III 360", notes: "Best fit for users who want the strongest consumer CUDA box without stepping into pro GPUs. 24GB VRAM handles 13B-34B models comfortably and can run many 70B quantized setups with careful context settings.", sourceRefs: "nvidia.com, ir.amd.com", compatNotes: "" },
    { profileKey: "local-llm-inference", profileLabel: "Local LLM Inference", buildName: "Balanced NVIDIA 16GB", targetModel: "34B q4", ramGb: 64, storageGb: 2000, estimatedPriceEur: 2099, bestFor: "34B quantized local inference, strong tokens-per-watt", estimatedTokensPerSec: "15-25 t/s (34B q4)", estimatedSystemPowerW: 450, recommendedPsuW: 1000, coolingProfile: "Quiet air cooling with premium dual-tower", cpuName: "AMD Ryzen 9 7900", gpuName: "NVIDIA RTX 4080 SUPER", ramName: "Corsair Vengeance 64GB (2x32GB) DDR5-6000 CL30", storageName: "Samsung 990 Pro 2TB", mbName: "Gigabyte B650 AORUS Elite AX", psuName: "Corsair RM1000e 1000W", caseName: "Corsair 5000D Airflow", coolerName: "Noctua NH-D15 G2", notes: "Balanced CUDA choice for local chat, coding assistants, embeddings, and 13B-34B quantized models. It avoids flagship pricing while keeping enough VRAM and system RAM for practical daily AI work.", sourceRefs: "nvidia.com, ir.amd.com", compatNotes: "" },
    { profileKey: "local-llm-inference", profileLabel: "Local LLM Inference", buildName: "24GB VRAM Value (ROCm path)", targetModel: "34B q4 / 70B split", ramGb: 96, storageGb: 2000, estimatedPriceEur: 2249, bestFor: "ROCm-based inference with 24GB VRAM at lower cost", estimatedTokensPerSec: "10-18 t/s (34B q4, ROCm)", estimatedSystemPowerW: 500, recommendedPsuW: 1000, coolingProfile: "Balanced air cooling", cpuName: "Intel Core i7-14700K", gpuName: "AMD Radeon RX 7900 XTX", ramName: "Corsair Vengeance 96GB (2x48GB) DDR5-5600 CL40", storageName: "Samsung 990 Pro 2TB", mbName: "MSI MPG Z790 Carbon WiFi", psuName: "Corsair RM1000e 1000W", caseName: "Fractal Design Meshify 2", coolerName: "be quiet! Dark Rock Pro 5", notes: "Strong VRAM-per-euro option for buyers comfortable with the AMD ROCm path. Great for 13B-34B inference, but CUDA-only tools may need alternatives or extra setup work.", sourceRefs: "amd.com, intel.com", compatNotes: "" },
    { profileKey: "llm-finetune-starter", profileLabel: "LLM Fine-Tune Starter", buildName: "CUDA Adapter-Tuning Starter", targetModel: "7B-13B LoRA", ramGb: 96, storageGb: 2000, estimatedPriceEur: 2399, bestFor: "LoRA/QLoRA fine-tuning on 7B-13B models", estimatedTokensPerSec: "Training: varies by batch size", estimatedSystemPowerW: 450, recommendedPsuW: 1000, coolingProfile: "Premium air cooling for sustained loads", cpuName: "AMD Ryzen 9 7950X", gpuName: "NVIDIA RTX 4070 Ti SUPER", ramName: "G.Skill Trident Z5 RGB 96GB (2x48GB) DDR5-6400 CL32", storageName: "Samsung 990 Pro 2TB", mbName: "ASUS ROG Crosshair X670E Hero", psuName: "SeaSonic Focus GX-1000 1000W", caseName: "Fractal Design North", coolerName: "Noctua NH-D15 G2", notes: "Starter tuning build for LoRA and QLoRA experiments where CUDA compatibility matters. The 96GB RAM leaves room for datasets, loaders, and dev tooling while the 16GB GPU keeps runs realistic for 7B-13B models.", sourceRefs: "nvidia.com, ir.amd.com", compatNotes: "" },
    { profileKey: "llm-finetune-starter", profileLabel: "LLM Fine-Tune Starter", buildName: "Budget Fine-Tune Entry", targetModel: "7B LoRA / embeddings", ramGb: 64, storageGb: 2000, estimatedPriceEur: 1599, bestFor: "Entry-level LoRA fine-tuning and embedding workloads", estimatedTokensPerSec: "Training: varies by batch size", estimatedSystemPowerW: 300, recommendedPsuW: 750, coolingProfile: "Budget air cooling", cpuName: "AMD Ryzen 9 7900", gpuName: "NVIDIA RTX 4060 Ti 16GB", ramName: "G.Skill Flare X5 64GB (2x32GB) DDR5-5600 CL30", storageName: "Samsung 990 Pro 2TB", mbName: "Gigabyte B650 AORUS Elite AX", psuName: "SeaSonic Focus GX-750 750W", caseName: "Fractal Design Pop Air", coolerName: "DeepCool AK620", notes: "Entry point for learning fine-tuning, embeddings, RAG pipelines, and small batch experiments. The 16GB VRAM is useful, but the narrow memory bus makes it a budget learning machine rather than a high-throughput trainer.", sourceRefs: "nvidia.com, ir.amd.com", compatNotes: "" },
    { profileKey: "hybrid-ai-gaming", profileLabel: "Hybrid AI + Gaming", buildName: "4K Hybrid Flagship", targetModel: "34B q4 + 4K gaming", ramGb: 64, storageGb: 2000, estimatedPriceEur: 2499, bestFor: "Daytime AI development, nighttime 4K gaming", estimatedTokensPerSec: "15-25 t/s (34B q4)", estimatedSystemPowerW: 500, recommendedPsuW: 1000, coolingProfile: "AIO liquid cooling for quiet dual-use", cpuName: "Intel Core i9-14900K", gpuName: "NVIDIA RTX 4080 SUPER", ramName: "Corsair Dominator Titanium 64GB (2x32GB) DDR5-6600 CL32", storageName: "Samsung 990 Pro 2TB", mbName: "ASUS ROG Strix Z790-F Gaming WiFi", psuName: "Corsair RM1000e 1000W", caseName: "Lian Li O11 Dynamic EVO", coolerName: "Arctic Liquid Freezer III 280", notes: "Built for someone who wants one machine for serious 4K gaming, creator apps, and local AI. 16GB VRAM is enough for strong 13B-34B inference, while the high-end CPU keeps compile, render, and multitasking workloads responsive.", sourceRefs: "nvidia.com, intel.com", compatNotes: "" },
    { profileKey: "hybrid-ai-gaming", profileLabel: "Hybrid AI + Gaming", buildName: "1440p AI Creator", targetModel: "13B-34B q4 + high refresh", ramGb: 64, storageGb: 2000, estimatedPriceEur: 1969, bestFor: "1440p high-refresh gaming and 13B-34B local inference", estimatedTokensPerSec: "12-20 t/s (34B q4)", estimatedSystemPowerW: 420, recommendedPsuW: 850, coolingProfile: "Compact AIO liquid cooling", cpuName: "Intel Core i7-14700K", gpuName: "NVIDIA RTX 4070 Ti SUPER", ramName: "Kingston Fury Renegade 64GB (2x32GB) DDR5-6000 CL32", storageName: "Samsung 990 Pro 2TB", mbName: "Gigabyte Z790 AORUS Elite AX", psuName: "Corsair RM850e 850W", caseName: "NZXT H7 Flow", coolerName: "Arctic Liquid Freezer III 240", notes: "Practical sweet spot for 1440p gaming, streaming, content creation, and local AI experiments. The 16GB CUDA GPU is the main reason to choose it over cheaper gaming-first systems.", sourceRefs: "nvidia.com, intel.com", compatNotes: "" },
    { profileKey: "workstation-ai", profileLabel: "AI Workstation", buildName: "Threadripper 48GB Beast", targetModel: "70B q4 sustained", ramGb: 256, storageGb: 4000, estimatedPriceEur: 8499, bestFor: "Sustained 70B inference and workstation AI workloads", estimatedTokensPerSec: "8-15 t/s (70B q4)", estimatedSystemPowerW: 750, recommendedPsuW: 1600, coolingProfile: "Workstation-grade 420mm AIO cooling", cpuName: "AMD Threadripper 7960X", gpuName: "NVIDIA RTX 6000 Ada", ramName: "Kingston Server Premier 256GB (4x64GB) DDR5-4800 ECC RDIMM", storageName: "Samsung 990 Pro 4TB", mbName: "ASUS Pro WS WRX90E-SAGE SE", psuName: "be quiet! Dark Power Pro 13 1600W", caseName: "Phanteks Enthoo Pro 2", coolerName: "Arctic Liquid Freezer III 420", notes: "Professional single-GPU workstation for sustained 70B-class inference, large context windows, and heavy multitasking. The 48GB RTX 6000 Ada is the key upgrade: more VRAM, workstation thermals, and better fit for long unattended jobs.", sourceRefs: "nvidia.com, amd.com", compatNotes: "" },
    { profileKey: "multi-gpu-ai", profileLabel: "Multi-GPU AI", buildName: "Dual RTX 6000 Ada Tower", targetModel: "70B+ parallel inference", ramGb: 512, storageGb: 8000, estimatedPriceEur: 18999, bestFor: "Multi-GPU parallel inference and large-scale training", estimatedTokensPerSec: "Varies by pipeline parallelism", estimatedSystemPowerW: 1000, recommendedPsuW: 1600, coolingProfile: "Dual-GPU workstation cooling with 420mm AIO", cpuName: "AMD Threadripper PRO 7975WX", gpuName: "NVIDIA RTX 6000 Ada", ramName: "Kingston Server Premier 512GB (8x64GB) DDR5-4800 ECC RDIMM", storageName: "WD Black SN850X 8TB", mbName: "ASUS Pro WS WRX90E-SAGE SE", psuName: "be quiet! Dark Power Pro 13 1600W", caseName: "Phanteks Enthoo Pro 2", coolerName: "Arctic Liquid Freezer III 420", notes: "High-end multi-GPU tower for parallel inference, model serving, and experiments that can actually use two GPUs. Best for technical users who know their stack supports tensor or pipeline parallelism.", sourceRefs: "nvidia.com, amd.com", compatNotes: "" },
    { profileKey: "local-llm-inference", profileLabel: "Local LLM Inference", buildName: "Efficient 20B Workstation", targetModel: "20B q4", ramGb: 64, storageGb: 2000, estimatedPriceEur: 1749, bestFor: "Efficient 20B local inference with low power draw", estimatedTokensPerSec: "18-30 t/s (20B q4)", estimatedSystemPowerW: 350, recommendedPsuW: 750, coolingProfile: "Budget tower air cooling", cpuName: "Intel Core i5-14600K", gpuName: "NVIDIA RTX 4070 SUPER", ramName: "Corsair Vengeance 64GB (2x32GB) DDR5-6000 CL30", storageName: "Samsung 990 Pro 2TB", mbName: "ASRock Z790 Pro RS", psuName: "SeaSonic Focus GX-750 750W", caseName: "Corsair 4000D Airflow", coolerName: "Thermalright Phantom Spirit 120 EVO", notes: "Efficient CUDA build for 7B-20B inference, coding assistants, and private chat without excessive heat or power draw. The 12GB VRAM is the limiter, so choose this when efficiency matters more than large-model headroom.", sourceRefs: "nvidia.com, intel.com", compatNotes: "" },
    { profileKey: "local-llm-inference", profileLabel: "Local LLM Inference", buildName: "AMD Value 16GB Inference", targetModel: "13B-20B q4", ramGb: 64, storageGb: 2000, estimatedPriceEur: 1599, bestFor: "Budget 16GB VRAM ROCm-based local inference", estimatedTokensPerSec: "12-20 t/s (13B q4, ROCm)", estimatedSystemPowerW: 350, recommendedPsuW: 750, coolingProfile: "Budget air cooling", cpuName: "AMD Ryzen 9 7900", gpuName: "AMD Radeon RX 7800 XT", ramName: "Kingston Fury Beast 64GB (2x32GB) DDR5-5200 CL40", storageName: "WD Black SN850X 2TB", mbName: "ASRock B650E Taichi", psuName: "SeaSonic Focus GX-750 750W", caseName: "Corsair 4000D Airflow", coolerName: "DeepCool AK620", notes: "Value-focused AMD inference build with enough VRAM for useful 13B and some 20B quantized work. Best when the target stack supports ROCm; choose NVIDIA instead if CUDA-only libraries are required.", sourceRefs: "amd.com", compatNotes: "" },
    { profileKey: "local-llm-inference", profileLabel: "Local LLM Inference", buildName: "Cheapest 12GB VRAM Build", targetModel: "7B q4", ramGb: 32, storageGb: 2000, estimatedPriceEur: 999, bestFor: "Absolute cheapest entry with 12GB VRAM for 7B model inference", estimatedTokensPerSec: "10-15 t/s (7B q4)", estimatedSystemPowerW: 250, recommendedPsuW: 550, coolingProfile: "Budget air cooling", cpuName: "AMD Ryzen 5 7600", gpuName: "NVIDIA RTX 3060 12GB", ramName: "Kingston Fury Beast 32GB (2x16GB) DDR5-6000 CL36", storageName: "WD Black SN850X 2TB", mbName: "Gigabyte B650 AORUS Elite AX", psuName: "SeaSonic Focus GX-650 650W", caseName: "Corsair 4000D Airflow", coolerName: "Thermalright Phantom Spirit 120 SE", notes: "Lowest-cost sensible CUDA entry for local AI. Good for 7B quantized chat, embeddings, and learning Ollama or llama.cpp; 13B models may require tighter quantization and shorter context.", sourceRefs: "nvidia.com, amd.com", compatNotes: "" },
    { profileKey: "local-llm-inference", profileLabel: "Local LLM Inference", buildName: "Blackwell 5070 Ti 16GB Build", targetModel: "34B q4", ramGb: 64, storageGb: 2000, estimatedPriceEur: 2199, bestFor: "Latest-gen Blackwell 16GB with GDDR7 bandwidth for efficient inference", estimatedTokensPerSec: "15-25 t/s (34B q4)", estimatedSystemPowerW: 450, recommendedPsuW: 850, coolingProfile: "Premium air cooling", cpuName: "AMD Ryzen 9 9900X", gpuName: "NVIDIA RTX 5070 Ti", ramName: "Corsair Vengeance 64GB (2x32GB) DDR5-6000 CL30", storageName: "Samsung 990 Pro 2TB", mbName: "MSI MAG X670E Tomahawk WiFi", psuName: "Corsair RM850e 850W", caseName: "Corsair 5000D Airflow", coolerName: "Noctua NH-D15 G2", notes: "Latest-generation 16GB NVIDIA option for buyers who want Blackwell features, GDDR7 bandwidth, and CUDA compatibility. Good for 13B-34B quantized inference, but still not a replacement for 24GB+ VRAM builds.", sourceRefs: "nvidia.com, amd.com", compatNotes: "" },
    { profileKey: "local-llm-inference", profileLabel: "Local LLM Inference", buildName: "RTX 3090 Used Value Build", targetModel: "34B q4 / 70B offload", ramGb: 64, storageGb: 2000, estimatedPriceEur: 1699, bestFor: "Used RTX 3090 with 24GB VRAM at discounted pricing", estimatedTokensPerSec: "10-18 t/s (34B q4)", estimatedSystemPowerW: 450, recommendedPsuW: 850, coolingProfile: "Budget tower cooling", cpuName: "AMD Ryzen 7 9700X", gpuName: "NVIDIA RTX 3090", ramName: "Corsair Vengeance 64GB (2x32GB) DDR5-6000 CL30", storageName: "Samsung 990 Pro 2TB", mbName: "ASUS TUF Gaming X670E-PLUS WiFi", psuName: "SeaSonic Focus GX-850 850W", caseName: "Fractal Design Pop Air", coolerName: "Thermalright Phantom Spirit 120 EVO", notes: "Used-market value build centered on 24GB of CUDA VRAM. Excellent for 34B quantized models and larger offload experiments, but used GPU condition, thermals, and warranty should be checked carefully.", sourceRefs: "nvidia.com, amd.com", compatNotes: "" },
    { profileKey: "local-llm-inference", profileLabel: "Local LLM Inference", buildName: "Power-Efficient RTX 4000 Ada Build", targetModel: "13B q4", ramGb: 64, storageGb: 2000, estimatedPriceEur: 2459, bestFor: "Low-power 20GB pro card for always-on inference server", estimatedTokensPerSec: "12-20 t/s (13B q4)", estimatedSystemPowerW: 250, recommendedPsuW: 550, coolingProfile: "Quiet air cooling, low TDP", cpuName: "AMD Ryzen 9 7900", gpuName: "NVIDIA RTX 4000 Ada", ramName: "G.Skill Flare X5 64GB (2x32GB) DDR5-5600 CL30", storageName: "Samsung 990 Pro 2TB", mbName: "Gigabyte B650 AORUS Elite AX", psuName: "Corsair RM750e 750W", caseName: "Fractal Design North", coolerName: "be quiet! Dark Rock Pro 5", notes: "Quiet, efficient always-on inference box with a 20GB professional NVIDIA GPU. Best for homelab serving, private assistants, and low-noise office use where power draw matters more than peak gaming performance.", sourceRefs: "nvidia.com, amd.com", compatNotes: "" },
    { profileKey: "llm-finetune-starter", profileLabel: "LLM Fine-Tune Starter", buildName: "16GB VRAM Fine-Tune Workhorse", targetModel: "7B-13B LoRA/QLoRA", ramGb: 96, storageGb: 4000, estimatedPriceEur: 2749, bestFor: "Serious LoRA fine-tuning with 16GB VRAM and 96GB system RAM", estimatedTokensPerSec: "Training: varies by batch size", estimatedSystemPowerW: 400, recommendedPsuW: 850, coolingProfile: "Premium dual-tower air cooling", cpuName: "AMD Ryzen 9 9950X", gpuName: "NVIDIA RTX 4070 Ti SUPER", ramName: "G.Skill Trident Z5 RGB 96GB (2x48GB) DDR5-6400 CL32", storageName: "Samsung 990 Pro 4TB", mbName: "ASUS ROG Crosshair X670E Hero", psuName: "SeaSonic Focus GX-850 850W", caseName: "Fractal Design Meshify 2", coolerName: "Noctua NH-D15 G2", notes: "More serious 7B-13B LoRA/QLoRA workstation with CUDA, 96GB RAM, and 4TB fast storage for datasets and checkpoints. It is still a single 16GB GPU, so training plans should stay adapter-based.", sourceRefs: "nvidia.com, amd.com", compatNotes: "" },
    { profileKey: "hybrid-ai-gaming", profileLabel: "Hybrid AI + Gaming", buildName: "5090 Blackwell Hybrid", targetModel: "70B q4 + 4K gaming", ramGb: 64, storageGb: 4000, estimatedPriceEur: 4199, bestFor: "Flagship Blackwell for 4K gaming and large-model inference", estimatedTokensPerSec: "12-22 t/s (70B q4)", estimatedSystemPowerW: 750, recommendedPsuW: 1200, coolingProfile: "360mm AIO for sustained dual-use loads", cpuName: "Intel Core Ultra 9 285K", gpuName: "NVIDIA RTX 5090", ramName: "Corsair Dominator Titanium 64GB (2x32GB) DDR5-6600 CL32", storageName: "Samsung 990 Pro 4TB", mbName: "ASUS ROG Maximus Z890 Hero", psuName: "Corsair HX1200i 1200W", caseName: "Lian Li O11 Dynamic EVO", coolerName: "Arctic Liquid Freezer III 360", notes: "Flagship hybrid for buyers who want top-tier 4K gaming and local large-model inference in one tower. The 32GB Blackwell GPU gives more AI headroom than 24GB cards, but it needs strong cooling and power planning.", sourceRefs: "nvidia.com, intel.com", compatNotes: "" },
    { profileKey: "hybrid-ai-gaming", profileLabel: "Hybrid AI + Gaming", buildName: "Budget 16GB AI + Gaming", targetModel: "13B q4 + 1080p gaming", ramGb: 32, storageGb: 2000, estimatedPriceEur: 1049, bestFor: "Budget 16GB card for light AI and 1080p gaming", estimatedTokensPerSec: "8-14 t/s (13B q4)", estimatedSystemPowerW: 300, recommendedPsuW: 650, coolingProfile: "Budget tower cooling", cpuName: "AMD Ryzen 5 7600", gpuName: "AMD Radeon RX 7600 XT", ramName: "Kingston Fury Beast 32GB (2x16GB) DDR5-6000 CL36", storageName: "WD Black SN850X 2TB", mbName: "Gigabyte B650 AORUS Elite AX", psuName: "SeaSonic Focus GX-650 650W", caseName: "Corsair 4000D Airflow", coolerName: "DeepCool AK620", notes: "Low-cost dual-use build for 1080p gaming and light local AI. The 16GB AMD card gives useful VRAM for quantized models, but software compatibility is more selective than on CUDA.", sourceRefs: "amd.com", compatNotes: "" },
    { profileKey: "workstation-ai", profileLabel: "AI Workstation", buildName: "32/48GB Pro Workstation", targetModel: "70B q4", ramGb: 256, storageGb: 4000, estimatedPriceEur: 10999, bestFor: "48GB pro GPU workstation for sustained multi-model serving", estimatedTokensPerSec: "8-15 t/s (70B q4)", estimatedSystemPowerW: 750, recommendedPsuW: 1600, coolingProfile: "Workstation 420mm AIO", cpuName: "AMD Threadripper 7970X", gpuName: "AMD Radeon PRO W7900", ramName: "Kingston Server Premier 256GB (4x64GB) DDR5-4800 ECC RDIMM", storageName: "Samsung 990 Pro 4TB", mbName: "ASUS Pro WS WRX90E-SAGE SE", psuName: "be quiet! Dark Power Pro 13 1600W", caseName: "Phanteks Enthoo Pro 2", coolerName: "Arctic Liquid Freezer III 420", notes: "AMD professional workstation path with 48GB VRAM and 256GB ECC RAM for large ROCm-friendly workloads. Good for teams standardizing on AMD, but CUDA-first software should be validated before purchase.", sourceRefs: "amd.com", compatNotes: "" },
    { profileKey: "workstation-ai", profileLabel: "AI Workstation", buildName: "Software Developer AI Workstation", targetModel: "34B q4", ramGb: 128, storageGb: 4000, estimatedPriceEur: 3849, bestFor: "Developer workstation with 24GB VRAM for inference + IDE + containers", estimatedTokensPerSec: "10-18 t/s (34B q4)", estimatedSystemPowerW: 500, recommendedPsuW: 1000, coolingProfile: "Quiet 360mm AIO", cpuName: "AMD Ryzen 9 9950X", gpuName: "NVIDIA RTX 4090", ramName: "Corsair Vengeance 128GB (4x32GB) DDR5-5600 CL40", storageName: "Samsung 990 Pro 4TB", mbName: "MSI MAG X670E Tomahawk WiFi", psuName: "SeaSonic Focus GX-1000 1000W", caseName: "Fractal Design Define 7 XL", coolerName: "Arctic Liquid Freezer III 360", notes: "Developer-first workstation for local models, IDEs, containers, databases, and browser-heavy workflows running at the same time. The 24GB CUDA GPU covers serious inference while 128GB RAM keeps the rest of the workspace smooth.", sourceRefs: "nvidia.com, amd.com", compatNotes: "" },
    { profileKey: "homelab-ai", profileLabel: "Homelab AI", buildName: "Homelab Inference Server", targetModel: "34B q4", ramGb: 96, storageGb: 4000, estimatedPriceEur: 1949, bestFor: "Always-on homelab inference server with headless operation", estimatedTokensPerSec: "10-18 t/s (34B q4)", estimatedSystemPowerW: 350, recommendedPsuW: 850, coolingProfile: "Quiet tower cooling for 24/7 operation", cpuName: "AMD Ryzen 9 7900", gpuName: "NVIDIA RTX 4070 Ti SUPER", ramName: "Corsair Vengeance 96GB (2x48GB) DDR5-5600 CL40", storageName: "Samsung 990 Pro 4TB", mbName: "ASUS TUF Gaming X670E-PLUS WiFi", psuName: "SeaSonic Focus GX-850 850W", caseName: "Fractal Design Define 7 XL", coolerName: "Noctua NH-D15 G2", notes: "Quiet headless server for Ollama, Open WebUI, embeddings, and small internal AI services. Prioritizes 24/7 stability, storage, and RAM over gaming aesthetics.", sourceRefs: "nvidia.com, amd.com", compatNotes: "" },
    { profileKey: "local-llm-inference", profileLabel: "Local LLM Inference", buildName: "Estonian Value 16GB Build", targetModel: "13B q4", ramGb: 64, storageGb: 2000, estimatedPriceEur: 1399, bestFor: "Best-value build using widely available Estonian market components", estimatedTokensPerSec: "12-20 t/s (13B q4)", estimatedSystemPowerW: 300, recommendedPsuW: 750, coolingProfile: "Budget air cooling", cpuName: "AMD Ryzen 5 9600X", gpuName: "NVIDIA RTX 4060 Ti 16GB", ramName: "Corsair Vengeance 64GB (2x32GB) DDR5-6000 CL30", storageName: "Kingston KC3000 2TB", mbName: "Gigabyte B650 AORUS Elite AX", psuName: "SeaSonic Focus GX-750 750W", caseName: "Fractal Design Pop Air", coolerName: "DeepCool AK620", notes: "Value build selected around parts that are easier to source from Estonian retailers. Good first serious local AI machine for 7B-13B models, RAG, and coding assistants without overbuying flagship hardware.", sourceRefs: "nvidia.com, amd.com", compatNotes: "" },
  ];

  for (const b of builds) {
    const cpuId = cpuIds[b.cpuName];
    const gpuId = gpuIds[b.gpuName];
    if (!cpuId || !gpuId) continue;

    const ramId = b.ramName ? (ramIds[b.ramName] ?? null) : null;
    const storageId = b.storageName ? (storageIds[b.storageName] ?? null) : null;
    const motherboardId = b.mbName ? (mbIds[b.mbName] ?? null) : null;
    const psuId = b.psuName ? (psuIds[b.psuName] ?? null) : null;
    const caseId = b.caseName ? (caseIds[b.caseName] ?? null) : null;
    const coolerId = b.coolerName ? (coolerIds[b.coolerName] ?? null) : null;

    await db.execute(
      `INSERT INTO profile_builds (profile_key, profile_label, build_name, target_model, ram_gb, storage_gb, estimated_price_eur, best_for, estimated_tokens_per_sec, estimated_system_power_w, recommended_psu_w, cooling_profile, notes, source_refs, compatibility_notes, cpu_id, gpu_id, ram_kit_id, storage_drive_id, motherboard_id, power_supply_id, case_id, cpu_cooler_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(profile_key, build_name) DO UPDATE SET profile_label=excluded.profile_label, target_model=excluded.target_model, ram_gb=excluded.ram_gb, storage_gb=excluded.storage_gb, estimated_price_eur=excluded.estimated_price_eur, best_for=excluded.best_for, estimated_tokens_per_sec=excluded.estimated_tokens_per_sec, estimated_system_power_w=excluded.estimated_system_power_w, recommended_psu_w=excluded.recommended_psu_w, cooling_profile=excluded.cooling_profile, notes=excluded.notes, compatibility_notes=excluded.compatibility_notes, cpu_id=excluded.cpu_id, gpu_id=excluded.gpu_id, ram_kit_id=excluded.ram_kit_id, storage_drive_id=excluded.storage_drive_id, motherboard_id=excluded.motherboard_id, power_supply_id=excluded.power_supply_id, case_id=excluded.case_id, cpu_cooler_id=excluded.cpu_cooler_id`,
      [b.profileKey, b.profileLabel, b.buildName, b.targetModel, b.ramGb, b.storageGb, b.estimatedPriceEur, b.bestFor, b.estimatedTokensPerSec, b.estimatedSystemPowerW, b.recommendedPsuW, b.coolingProfile, b.notes, b.sourceRefs, b.compatNotes, cpuId, gpuId, ramId, storageId, motherboardId, psuId, caseId, coolerId],
    );
  }
}
