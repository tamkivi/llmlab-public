import { NextResponse } from "next/server";
import { initDb, getAdapter, listEstonianPriceChecks, SEED_VERSION } from "@/lib/db";
import { commerceInvariantViolations, getCommerceInvariantDiagnostics } from "@/lib/db/invariants";
import { checkRateLimit } from "@/lib/request-utils";
import { requireAdminAccess } from "@/lib/server/admin-auth";
import { ASSEMBLY_MARKUP_MULTIPLIER } from "@/lib/pricing-constants";
import { checkBuildCompatibility, checkMacEgpuBuildCompatibility } from "@/lib/server/compatibility-checker";

export const dynamic = "force-dynamic";

const CATEGORIES_WITH_PRICING: Array<{ table: string; category: string }> = [
  { table: "gpus", category: "gpu" },
  { table: "cpus", category: "cpu" },
  { table: "ram_kits", category: "ram_kit" },
  { table: "power_supplies", category: "power_supply" },
  { table: "pc_cases", category: "case" },
  { table: "motherboards", category: "motherboard" },
  { table: "compact_ai_systems", category: "compact_ai_system" },
  { table: "storage_drives", category: "storage_drive" },
  { table: "cpu_coolers", category: "cpu_cooler" },
  { table: "mac_systems", category: "mac_system" },
  { table: "external_gpu_enclosures", category: "external_gpu_enclosure" },
];

export async function GET(request: Request) {
  const auth = await requireAdminAccess(request);
  if (!auth.ok) {
    return NextResponse.json({ message: "Admin access required." }, { status: auth.status });
  }
  const rateLimitKey = auth.actor === "session" ? `admin:audit:${auth.userId}` : "admin:audit:bearer";
  if (!(await checkRateLimit(rateLimitKey, 30, 60_000))) {
    return NextResponse.json({ message: "Too many requests. Please try again later." }, { status: 429 });
  }

  await initDb();
  const db = getAdapter();
  const commerceInvariants = await getCommerceInvariantDiagnostics(db).catch(() => null);

  const warnings: string[] = [];
  const counters: Record<string, number> = {};

  async function count(table: string): Promise<number> {
    try {
      const r = await db.queryOne<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM ${table}`);
      return r?.cnt ?? 0;
    } catch {
      return -1;
    }
  }

  const allTables = [
    "gpus", "cpus", "ram_kits", "power_supplies", "pc_cases", "motherboards",
    "compact_ai_systems", "storage_drives", "cpu_coolers", "mac_systems",
    "external_gpu_enclosures", "profile_builds", "mac_egpu_builds",
    "users", "orders", "estonian_price_checks", "price_history",
    "pricing_runs", "pricing_run_failures", "order_price_snapshots", "quote_requests",
    "runtime_locks", "admin_order_actions", "schema_migrations", "seed_runs",
  ];
  const countResults = await Promise.all(allTables.map(async (t) => [t, await count(t)] as const));
  for (const [t, c] of countResults) counters[t] = c;
  if (commerceInvariants) {
    const invariantWarnings = commerceInvariantViolations(commerceInvariants);
    warnings.push(...invariantWarnings.map((warning) => `Commerce invariant violation: ${warning}`));
  } else {
    warnings.push("Commerce invariant diagnostics could not run.");
  }

  async function checkFk(table: string, idCol: string, refTable: string, refCol: string): Promise<string[]> {
    try {
      const rows = await db.queryAll<{ id: number }>(
        `SELECT ${idCol} AS id FROM ${table} WHERE ${idCol} NOT IN (SELECT ${refCol} FROM ${refTable})`,
      );
      return rows.length > 0
        ? [`${table}.${idCol} → ${refTable}.${refCol}: ${rows.length} broken references (ids: ${rows.slice(0, 5).map((r) => r.id).join(",")})`]
        : [];
    } catch {
      return [`${table}.${idCol} → ${refTable}.${refCol}: check failed (table may not exist)`];
    }
  }

  warnings.push(...(await Promise.all([
    checkFk("profile_builds", "cpu_id", "cpus", "id"),
    checkFk("profile_builds", "gpu_id", "gpus", "id"),
    checkFk("mac_egpu_builds", "mac_system_id", "mac_systems", "id"),
    checkFk("mac_egpu_builds", "egpu_enclosure_id", "external_gpu_enclosures", "id"),
    checkFk("mac_egpu_builds", "gpu_id", "gpus", "id"),
  ])).flat());

  async function checkDuplicates(table: string): Promise<string[]> {
    try {
      const rows = await db.queryAll<{ name: string; cnt: number }>(
        `SELECT name, COUNT(*) AS cnt FROM ${table} GROUP BY name HAVING cnt > 1`,
      );
      return rows.map((r) => `${table}: "${r.name}" appears ${r.cnt} times`);
    } catch {
      return [];
    }
  }

  warnings.push(...(await Promise.all(["gpus", "cpus", "ram_kits", "power_supplies", "pc_cases", "motherboards", "compact_ai_systems", "storage_drives", "cpu_coolers", "mac_systems", "external_gpu_enclosures"].map(checkDuplicates))).flat());

  // Fetch trusted matched pricing rows once. Legacy rows without match diagnostics
  // are retained for traceability but ignored by catalog/checkout pricing.
  const allChecks = await listEstonianPriceChecks().catch(() => [] as Awaited<ReturnType<typeof listEstonianPriceChecks>>);

  const allHistory = await db.queryAll<{ category: string; item_id: number; price_eur: number; recorded_at: string; recorded_date: string | null; source: string }>(
    "SELECT category, item_id, price_eur, recorded_at, recorded_date, source FROM price_history WHERE source LIKE '%match=%' AND price_eur > 0",
  ).catch(() => [] as Array<{ category: string; item_id: number; price_eur: number; recorded_at: string; recorded_date: string | null; source: string }>);

  const rawMatchedPriceChecks = (await db.queryOne<{ cnt: number }>(
    "SELECT COUNT(*) AS cnt FROM estonian_price_checks WHERE sources LIKE '%match=%'",
  ).catch(() => null))?.cnt ?? 0;
  const rejectedMatchedPriceChecks = Math.max(0, rawMatchedPriceChecks - allChecks.length);
  if (rejectedMatchedPriceChecks > 0) {
    warnings.push(`${rejectedMatchedPriceChecks} matched price check(s) are rejected by trust policy and ignored by live pricing.`);
  }

  const legacyPriceChecks = (await db.queryOne<{ cnt: number }>(
    "SELECT COUNT(*) AS cnt FROM estonian_price_checks WHERE sources NOT LIKE '%match=%'",
  ).catch(() => null))?.cnt ?? 0;
  const legacyPriceHistory = (await db.queryOne<{ cnt: number }>(
    "SELECT COUNT(*) AS cnt FROM price_history WHERE source NOT LIKE '%match=%'",
  ).catch(() => null))?.cnt ?? 0;
  if (legacyPriceChecks > 0 || legacyPriceHistory > 0) {
    warnings.push(`${legacyPriceChecks} legacy price check(s) and ${legacyPriceHistory} legacy price_history row(s) are ignored by live pricing.`);
  }

  // Build valid IDs set from catalog tables
  const allValidIds = new Set<string>();
  const perCategoryTotals: Record<string, number> = {};
  const categoryItems = await Promise.all(CATEGORIES_WITH_PRICING.map(async ({ table, category }) => {
    const items = await db.queryAll<{ id: number; name: string }>(`SELECT id, name FROM ${table}`).catch(() => [] as { id: number; name: string }[]);
    return { category, items };
  }));
  for (const { category, items } of categoryItems) {
    perCategoryTotals[category] = items.length;
    for (const item of items) allValidIds.add(`${category}:${item.id}`);
  }

  const checkedIds = new Set(allChecks.map((c) => `${c.category}:${c.item_id}`));
  const histIds = new Set(allHistory.map((r) => `${r.category}:${r.item_id}`));

  // Per-category pricing coverage
  const pricingByCategory: Record<string, { total: number; checked: number; pct: number }> = {};
  let pricingCoverage = 0;
  let pricingTotal = 0;
  for (const { category, items } of categoryItems) {
    const total = items.length;
    const checked = items.filter((item) => checkedIds.has(`${category}:${item.id}`)).length;
    pricingTotal += total;
    pricingCoverage += checked;
    pricingByCategory[category] = { total, checked, pct: total > 0 ? Math.round((checked / total) * 100) : 0 };
  }

  // Per-category price history coverage
  const historyByCategory: Record<string, { total: number; hasHistory: number; pct: number }> = {};
  let historyCoverage = 0;
  for (const { category, items } of categoryItems) {
    const total = items.length;
    const hasHistory = items.filter((item) => histIds.has(`${category}:${item.id}`)).length;
    historyCoverage += hasHistory;
    historyByCategory[category] = { total, hasHistory, pct: total > 0 ? Math.round((hasHistory / total) * 100) : 0 };
  }

  // Stale pricing checks (older than 48h)
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const staleChecks = allChecks.filter((c) => c.checked_at < twoDaysAgo).length;
  if (staleChecks > 0) {
    warnings.push(`${staleChecks} stale price check(s) older than 48h.`);
  }

  const lowSampleChecks = allChecks.filter((c) => (c.sample_count ?? 0) < 2);
  if (lowSampleChecks.length > 0) {
    warnings.push(`${lowSampleChecks.length} item(s) with <2 price samples: ${lowSampleChecks.slice(0, 5).map((c) => `${c.item_name} (${c.sample_count ?? 0})`).join(", ")}`);
  }

  // Stale price history (no row in last 48h per category:item_id that has a check)
  const recentHistorySet = new Set(
    allHistory.filter((r) => r.recorded_at >= twoDaysAgo).map((r) => `${r.category}:${r.item_id}`),
  );
  const staleHistoryCount = allChecks.filter((c) => !recentHistorySet.has(`${c.category}:${c.item_id}`)).length;
  if (staleHistoryCount > 0) {
    warnings.push(`${staleHistoryCount} item(s) with price checks but no recent (48h) price_history row.`);
  }

  // Suspicious prices (final_price > 3x base or < 0.3x base)
  const suspiciousPrices: Array<{ category: string; item_name: string; base: number; final: number }> = [];
  for (const r of allChecks) {
    if (r.base_price_eur > 0 && (r.final_price_eur > r.base_price_eur * 3 || r.final_price_eur < r.base_price_eur * 0.3)) {
      suspiciousPrices.push({ category: r.category, item_name: r.item_name, base: r.base_price_eur, final: r.final_price_eur });
    }
  }
  if (suspiciousPrices.length > 0) {
    warnings.push(`${suspiciousPrices.length} suspicious price(s): ${suspiciousPrices.slice(0, 5).map((p) => `${p.item_name} base=€${p.base} final=€${Math.round(p.final)}`).join("; ")}`);
  }

  // Orphaned price checks
  const orphanedChecks = allChecks.filter((c) => !allValidIds.has(`${c.category}:${c.item_id}`));
  if (orphanedChecks.length > 0) {
    warnings.push(`${orphanedChecks.length} orphaned price check(s): ${orphanedChecks.slice(0, 5).map((o) => `${o.category}:${o.item_id} (${o.item_name})`).join(", ")}`);
  }

  // Orphaned price history rows
  const orphanedHistory = allHistory.filter((r) => !allValidIds.has(`${r.category}:${r.item_id}`));
  if (orphanedHistory.length > 0) {
    warnings.push(`${orphanedHistory.length} orphaned price_history row(s).`);
  }

  // Category mapping issues (mac_systems vs mac_system)
  const legacyCategoryChecks = allChecks.filter((c) => c.category === "mac_systems");
  const legacyCategoryHistory = allHistory.filter((r) => r.category === "mac_systems");
  if (legacyCategoryChecks.length > 0 || legacyCategoryHistory.length > 0) {
    warnings.push(`Legacy category "mac_systems" found in ${legacyCategoryChecks.length} price_checks and ${legacyCategoryHistory.length} price_history rows. Run POST /api/db/backfill-price-history to normalize.`);
  }

  // Price history vs current check misalignment
  const latestHistoryByItem = new Map<string, { price_eur: number; recorded_at: string }>();
  for (const row of allHistory) {
    const key = `${row.category}:${row.item_id}`;
    const existing = latestHistoryByItem.get(key);
    if (!existing || row.recorded_at > existing.recorded_at) {
      latestHistoryByItem.set(key, { price_eur: row.price_eur, recorded_at: row.recorded_at });
    }
  }
  const misaligned: Array<{ category: string; item_id: number; histPrice: number; finalPrice: number; diffPct: number }> = [];
  for (const check of allChecks) {
    const key = `${check.category}:${check.item_id}`;
    const hist = latestHistoryByItem.get(key);
    if (!hist) continue;
    const expectedFinal = hist.price_eur * ASSEMBLY_MARKUP_MULTIPLIER;
    const diffPct = Math.abs((check.final_price_eur - expectedFinal) / expectedFinal) * 100;
    if (diffPct > 15) {
      misaligned.push({ category: check.category, item_id: check.item_id, histPrice: hist.price_eur, finalPrice: check.final_price_eur, diffPct: Math.round(diffPct) });
    }
  }
  if (misaligned.length > 0) {
    warnings.push(`${misaligned.length} item(s) with >15% drift between latest price_history and current price_check: ${misaligned.slice(0, 5).map((m) => `${m.category}:${m.item_id} (${m.diffPct}%)`).join(", ")}`);
  }

  // Price history initialization status
  const historyTotalRows = allHistory.length;
  const latestHistoryAt = allHistory.length > 0
    ? allHistory.reduce((max, r) => (r.recorded_at > max ? r.recorded_at : max), allHistory[0].recorded_at)
    : null;
  const historyInitialized = historyTotalRows > 0;
  const historyIsStale = latestHistoryAt !== null && latestHistoryAt < twoDaysAgo;

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const rowsLast24h = allHistory.filter((r) => r.recorded_at >= oneDayAgo).length;
  const productsWithHistory = historyCoverage;
  const productsWithoutHistory = pricingTotal - historyCoverage;

  if (!historyInitialized) {
    warnings.push("Historical pricing has not been initialized yet. Run cron or backfill.");
  } else if (historyIsStale) {
    warnings.push(`Price history is stale — latest row is from ${latestHistoryAt.slice(0, 10)}. Run cron to refresh.`);
  }
  if (historyInitialized && rowsLast24h === 0) {
    warnings.push("No price_history rows in the last 24 hours. Cron may not be running.");
  }

  // Seed version check
  const seedVersion = (await db.queryOne<{ seed_version: number }>(
    "SELECT seed_version FROM seed_runs ORDER BY seed_version DESC LIMIT 1",
  ))?.seed_version ?? null;

  if (seedVersion !== null && seedVersion < SEED_VERSION) {
    warnings.push(`Seed version ${seedVersion} is behind expected ${SEED_VERSION}. Re-seeding needed.`);
  }

  // Build pricing drift
  const buildDrift: Array<{ name: string; estimated: number; componentTotal: number; diffPct: number; direction: string; missingComponents: string[] }> = [];
  const buildMissingRefs: Array<{ name: string; missing: string[] }> = [];
  try {
    const builds = await db.queryAll<{ id: number; build_name: string; estimated_price_eur: number; cpu_id: number; gpu_id: number; ram_kit_id: number | null; storage_drive_id: number | null; motherboard_id: number | null; power_supply_id: number | null; case_id: number | null; cpu_cooler_id: number | null }>(
      "SELECT id, build_name, estimated_price_eur, cpu_id, gpu_id, ram_kit_id, storage_drive_id, motherboard_id, power_supply_id, case_id, cpu_cooler_id FROM profile_builds",
    );
    const checkedMap = new Map(allChecks.map((c) => [`${c.category}:${c.item_id}`, Math.round(c.final_price_eur)]));
    const allComponentSlots: Array<{ key: string; cat: string; idKey: string }> = [
      { key: "CPU", cat: "cpu", idKey: "cpu_id" },
      { key: "GPU", cat: "gpu", idKey: "gpu_id" },
      { key: "RAM", cat: "ram_kit", idKey: "ram_kit_id" },
      { key: "Storage", cat: "storage_drive", idKey: "storage_drive_id" },
      { key: "Motherboard", cat: "motherboard", idKey: "motherboard_id" },
      { key: "PSU", cat: "power_supply", idKey: "power_supply_id" },
      { key: "Case", cat: "case", idKey: "case_id" },
      { key: "Cooler", cat: "cpu_cooler", idKey: "cpu_cooler_id" },
    ];
    for (const b of builds) {
      const missing: string[] = [];
      const priced: Array<{ cat: string; id: number }> = [];
      for (const slot of allComponentSlots) {
        const id = (b as Record<string, unknown>)[slot.idKey] as number | null;
        if (!id) {
          missing.push(slot.key);
          continue;
        }
        if (!checkedMap.has(`${slot.cat}:${id}`)) {
          missing.push(slot.key);
          continue;
        }
        priced.push({ cat: slot.cat, id });
      }
      if (missing.length > 0) {
        buildMissingRefs.push({ name: b.build_name, missing });
      }
      let total = 0;
      for (const c of priced) {
        total += checkedMap.get(`${c.cat}:${c.id}`) ?? 0;
      }
      if (total > 0 && b.estimated_price_eur > 0) {
        const diff = total - b.estimated_price_eur;
        const diffPct = Math.round(Math.abs(diff / b.estimated_price_eur) * 100);
        const direction = diff > 0 ? "underpriced" : diff < 0 ? "overpriced" : "matched";
        buildDrift.push({ name: b.build_name, estimated: b.estimated_price_eur, componentTotal: total, diffPct, direction, missingComponents: missing });
      }
    }
    const highDrift = buildDrift.filter((d) => d.diffPct > 20);
    if (highDrift.length > 0) {
      warnings.push(`${highDrift.length} build(s) with >20% pricing drift: ${highDrift.slice(0, 3).map((d) => `${d.name} (${d.diffPct}% ${d.direction})`).join(", ")}`);
    }
    const underpriced = buildDrift.filter((d) => d.direction === "underpriced" && d.diffPct > 15);
    if (underpriced.length > 0) {
      warnings.push(`${underpriced.length} build(s) potentially underpriced (seed estimate < live component total): ${underpriced.slice(0, 3).map((d) => `${d.name} (${d.diffPct}%)`).join(", ")}`);
    }
    const overpriced = buildDrift.filter((d) => d.direction === "overpriced" && d.diffPct > 15);
    if (overpriced.length > 0) {
      warnings.push(`${overpriced.length} build(s) potentially overpriced (seed estimate > live component total): ${overpriced.slice(0, 3).map((d) => `${d.name} (${d.diffPct}%)`).join(", ")}`);
    }
    if (buildMissingRefs.length > 0) {
      warnings.push(`${buildMissingRefs.length} build(s) with missing component price data: ${buildMissingRefs.slice(0, 3).map((b) => `${b.name} (missing: ${b.missing.join(", ")})`).join("; ")}`);
    }
  } catch { /* */ }

  // ── Missing immutable specs checks ──
  const missingSpecsChecks: Array<{ table: string; missingColumns: string[] }> = [];
  try {
    const gpuRows = await db.queryAll<{ id: number; name: string; vram_type: string; memory_bus_bits: number; length_mm: number }>("SELECT id, name, vram_type, memory_bus_bits, length_mm FROM gpus");
    const gpusMissing = gpuRows.filter((g) => !g.vram_type || g.memory_bus_bits === 0 || g.length_mm === 0);
    if (gpusMissing.length > 0) {
      missingSpecsChecks.push({ table: "gpus", missingColumns: [`${gpusMissing.length} rows missing vram_type/memory_bus/length`] });
    }
    const cpuRows = await db.queryAll<{ id: number; name: string; cache_l3_mb: number; pcie_generation: string }>("SELECT id, name, cache_l3_mb, pcie_generation FROM cpus");
    const cpusMissing = cpuRows.filter((c) => c.cache_l3_mb === 0 || !c.pcie_generation);
    if (cpusMissing.length > 0) {
      missingSpecsChecks.push({ table: "cpus", missingColumns: [`${cpusMissing.length} rows missing cache_l3_mb/pcie_generation`] });
    }
    const mbRows = await db.queryAll<{ id: number; name: string; form_factor: string; m2_slots: number }>("SELECT id, name, form_factor, m2_slots FROM motherboards");
    const mbsMissing = mbRows.filter((m) => !m.form_factor || m.m2_slots === 0);
    if (mbsMissing.length > 0) {
      missingSpecsChecks.push({ table: "motherboards", missingColumns: [`${mbsMissing.length} rows missing form_factor/m2_slots`] });
    }
  } catch { /* */ }
  if (missingSpecsChecks.length > 0) {
    warnings.push(`${missingSpecsChecks.length} table(s) with missing immutable specs: ${missingSpecsChecks.map((c) => `${c.table} (${c.missingColumns.join(", ")})`).join("; ")}`);
  }

  // ── Build compatibility + FK existence check (single query, shared maps) ──
  const compatibilityIssues: Array<{ build: string; warnings: string[] }> = [];
  const compatibilityWarnings: Array<{ build: string; warnings: string[] }> = [];
  const macEgpuCompatibilityIssues: Array<{ build: string; warnings: string[] }> = [];
  const macEgpuCompatibilityWarnings: Array<{ build: string; warnings: string[] }> = [];
  const buildMissingComponents: Array<{ build: string; missing: string[] }> = [];
  try {
    const builds = await db.queryAll<{
      id: number; build_name: string;
      cpu_id: number; gpu_id: number; ram_kit_id: number | null;
      storage_drive_id: number | null; motherboard_id: number | null;
      power_supply_id: number | null; case_id: number | null; cpu_cooler_id: number | null;
    }>("SELECT id, build_name, cpu_id, gpu_id, ram_kit_id, storage_drive_id, motherboard_id, power_supply_id, case_id, cpu_cooler_id FROM profile_builds");

    const fetchMap = async <T>(table: string) => {
      const rows = await db.queryAll<T & { id: number }>(`SELECT id FROM ${table}`);
      return new Set(rows.map((r) => r.id));
    };

    const [cpuIds, gpuIds, ramIds, mbIds, psuIds, caseIds, coolerIds, storageIds] = await Promise.all([
      fetchMap("cpus"), fetchMap("gpus"), fetchMap("ram_kits"),
      fetchMap("motherboards"), fetchMap("power_supplies"),
      fetchMap("pc_cases"), fetchMap("cpu_coolers"), fetchMap("storage_drives"),
    ]);

    const fkSlots: Array<{ key: string; idSet: Set<number>; bKey: string }> = [
      { key: "CPU", idSet: cpuIds, bKey: "cpu_id" },
      { key: "GPU", idSet: gpuIds, bKey: "gpu_id" },
      { key: "RAM", idSet: ramIds, bKey: "ram_kit_id" },
      { key: "Storage", idSet: storageIds, bKey: "storage_drive_id" },
      { key: "Motherboard", idSet: mbIds, bKey: "motherboard_id" },
      { key: "PSU", idSet: psuIds, bKey: "power_supply_id" },
      { key: "Case", idSet: caseIds, bKey: "case_id" },
      { key: "Cooler", idSet: coolerIds, bKey: "cpu_cooler_id" },
    ];

    for (const b of builds) {
      const missing: string[] = [];
      for (const slot of fkSlots) {
        const id = (b as Record<string, unknown>)[slot.bKey] as number | null;
        if (id && !slot.idSet.has(id)) {
          missing.push(`${slot.key} (id=${id})`);
        }
      }
      if (missing.length > 0) {
        buildMissingComponents.push({ build: b.build_name, missing });
      }
    }
  } catch { /* */ }

  try {
    const builds = await db.queryAll<{
      id: number; build_name: string;
      cpu_id: number; gpu_id: number; ram_kit_id: number | null;
      storage_drive_id: number | null; motherboard_id: number | null;
      power_supply_id: number | null; case_id: number | null; cpu_cooler_id: number | null;
    }>("SELECT id, build_name, cpu_id, gpu_id, ram_kit_id, storage_drive_id, motherboard_id, power_supply_id, case_id, cpu_cooler_id FROM profile_builds");

    const fetchFullMap = async <T>(sql: string) => {
      const rows = await db.queryAll<T & { id: number }>(sql);
      return new Map(rows.map((r) => [r.id, r]));
    };

    const [cpuMap, gpuMap, ramMap, mbMap, psuMap, caseMap, coolerMap, storageMap] = await Promise.all([
      fetchFullMap("SELECT id, name, socket, memory_type_support, tdp_watts FROM cpus"),
      fetchFullMap("SELECT id, name, length_mm, slot_width, tdp_watts, recommended_psu_w, power_connectors FROM gpus"),
      fetchFullMap("SELECT id, name, ddr_gen, modules, capacity_gb FROM ram_kits"),
      fetchFullMap("SELECT id, name, socket, memory_support, form_factor, memory_slots, max_memory_gb, m2_slots FROM motherboards"),
      fetchFullMap("SELECT id, name, wattage, pcie_5_support, native_12vhpwr, gpu_connector_count FROM power_supplies"),
      fetchFullMap("SELECT id, name, form_factor, max_gpu_mm, max_cpu_cooler_height_mm, radiator_support FROM pc_cases"),
      fetchFullMap("SELECT id, name, cooler_type, radiator_or_height_mm, socket_support FROM cpu_coolers"),
      fetchFullMap("SELECT id, name, interface FROM storage_drives"),
    ]);

    for (const b of builds) {
      const compWarnings = checkBuildCompatibility({
        cpu: cpuMap.get(b.cpu_id) as Record<string, unknown> as import("@/lib/db").CpuRecord ?? null,
        gpu: gpuMap.get(b.gpu_id) as Record<string, unknown> as import("@/lib/db").GpuRecord ?? null,
        ram: b.ram_kit_id ? (ramMap.get(b.ram_kit_id) as Record<string, unknown> as import("@/lib/db").RamKitRecord ?? null) : null,
        motherboard: b.motherboard_id ? (mbMap.get(b.motherboard_id) as Record<string, unknown> as import("@/lib/db").MotherboardRecord ?? null) : null,
        psu: b.power_supply_id ? (psuMap.get(b.power_supply_id) as Record<string, unknown> as import("@/lib/db").PowerSupplyRecord ?? null) : null,
        case: b.case_id ? (caseMap.get(b.case_id) as Record<string, unknown> as import("@/lib/db").CaseRecord ?? null) : null,
        cooler: b.cpu_cooler_id ? (coolerMap.get(b.cpu_cooler_id) as Record<string, unknown> as import("@/lib/db").CpuCoolerRecord ?? null) : null,
        storage: b.storage_drive_id ? (storageMap.get(b.storage_drive_id) as Record<string, unknown> as import("@/lib/db").StorageDriveRecord ?? null) : null,
      });
      const errors = compWarnings.filter((w) => w.severity === "error");
      if (errors.length > 0) {
        compatibilityIssues.push({ build: b.build_name, warnings: errors.map((e) => e.message) });
      }
      const warningOnly = compWarnings.filter((w) => w.severity === "warning");
      if (warningOnly.length > 0) {
        compatibilityWarnings.push({ build: b.build_name, warnings: warningOnly.map((w) => w.message) });
      }
    }
  } catch { /* */ }

  try {
    const builds = await db.queryAll<{
      id: number; name: string; mac_system_id: number; egpu_enclosure_id: number; gpu_id: number;
    }>("SELECT id, name, mac_system_id, egpu_enclosure_id, gpu_id FROM mac_egpu_builds");

    const fetchFullMap = async <T>(sql: string) => {
      const rows = await db.queryAll<T & { id: number }>(sql);
      return new Map(rows.map((r) => [r.id, r]));
    };

    const [macMap, enclosureMap, gpuMap] = await Promise.all([
      fetchFullMap("SELECT id, name, external_gpu_support FROM mac_systems"),
      fetchFullMap("SELECT id, name, max_gpu_length_mm, max_gpu_slots, included_psu_watts, requires_external_psu, supports_open_frame FROM external_gpu_enclosures"),
      fetchFullMap("SELECT id, name, length_mm, slot_width, tdp_watts, recommended_psu_w, power_connectors FROM gpus"),
    ]);

    for (const b of builds) {
      const compWarnings = checkMacEgpuBuildCompatibility({
        mac: macMap.get(b.mac_system_id) as Record<string, unknown> as import("@/lib/db").MacSystemRecord ?? null,
        enclosure: enclosureMap.get(b.egpu_enclosure_id) as Record<string, unknown> as import("@/lib/db").ExternalGpuEnclosureRecord ?? null,
        gpu: gpuMap.get(b.gpu_id) as Record<string, unknown> as import("@/lib/db").GpuRecord ?? null,
      });
      const errors = compWarnings.filter((w) => w.severity === "error");
      if (errors.length > 0) {
        macEgpuCompatibilityIssues.push({ build: b.name, warnings: errors.map((e) => e.message) });
      }
      const warningOnly = compWarnings.filter((w) => w.severity === "warning");
      if (warningOnly.length > 0) {
        macEgpuCompatibilityWarnings.push({ build: b.name, warnings: warningOnly.map((w) => w.message) });
      }
    }
  } catch { /* */ }

  if (compatibilityIssues.length > 0) {
    warnings.push(`${compatibilityIssues.length} build(s) with compatibility errors: ${compatibilityIssues.slice(0, 5).map((c) => `${c.build}: ${c.warnings.join("; ")}`).join(" | ")}`);
  }
  if (macEgpuCompatibilityIssues.length > 0) {
    warnings.push(`${macEgpuCompatibilityIssues.length} Mac eGPU build(s) with physical compatibility errors: ${macEgpuCompatibilityIssues.slice(0, 5).map((c) => `${c.build}: ${c.warnings.join("; ")}`).join(" | ")}`);
  }
  if (buildMissingComponents.length > 0) {
    warnings.push(`${buildMissingComponents.length} build(s) referencing missing products: ${buildMissingComponents.slice(0, 3).map((b) => `${b.build}: ${b.missing.join(", ")}`).join("; ")}`);
  }

  // ── Products with no price history ──
  try {
    const unpriced: string[] = [];
    for (const { category, items } of categoryItems) {
      for (const item of items) {
        if (!checkedIds.has(`${category}:${item.id}`)) {
          unpriced.push(`${category}:${item.name}`);
        }
      }
    }
    if (unpriced.length > 0) {
      warnings.push(`${unpriced.length} product(s) with no market price data: ${unpriced.slice(0, 10).join(", ")}`);
    }
  } catch { /* */ }

  const isPg = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL);
  const isVercel = Boolean(process.env.VERCEL);
  const isEphemeralSqlite = !isPg && isVercel;

  if (isEphemeralSqlite) {
    warnings.push("Running on ephemeral SQLite in production. Set DATABASE_URL or POSTGRES_URL for persistent storage.");
  }

  const latestPricingRuns = await db.queryAll<{
    id: number;
    started_at: string;
    finished_at: string | null;
    status: string;
    total_items: number;
    updated_items: number;
    failed_items: number;
    items_expected: number;
    items_checked: number;
    history_rows_inserted: number;
    history_rows_updated: number;
    stale_count: number;
    error_message: string;
    deployment_id: string;
    vercel_env: string;
    git_commit_sha: string;
    runtime_env: string;
    notes: string;
  }>(
    `SELECT id, started_at, finished_at, status, total_items, updated_items, failed_items,
            items_expected, items_checked, history_rows_inserted, history_rows_updated,
            stale_count, error_message, deployment_id, vercel_env, git_commit_sha, runtime_env, notes
     FROM pricing_runs
     ORDER BY id DESC LIMIT 5`,
  ).catch(() => []);
  const latestPricingRun = latestPricingRuns[0] ?? null;
  if (!latestPricingRun) {
    warnings.push("No pricing_runs records found. Pricing refresh observability has not run yet.");
  } else if (latestPricingRun.status !== "SUCCESS") {
    warnings.push(`Latest pricing run #${latestPricingRun.id} ended as ${latestPricingRun.status}: ${latestPricingRun.notes}`);
  }

  return NextResponse.json({
    status: warnings.length === 0 ? "healthy" : "warnings",
    timestamp: new Date().toISOString(),
    rowCounts: counters,
    warnings,
    pricing: {
      coverage: `${pricingCoverage}/${pricingTotal}`,
      coveragePct: pricingTotal > 0 ? Math.round((pricingCoverage / pricingTotal) * 100) : 0,
      staleChecks,
      staleHistoryCount,
      suspiciousCount: suspiciousPrices.length,
      orphanedChecks: orphanedChecks.length,
      orphanedHistory: orphanedHistory.length,
      ignoredLegacyChecks: legacyPriceChecks,
      rejectedMatchedChecks: rejectedMatchedPriceChecks,
      byCategory: pricingByCategory,
    },
    priceHistory: {
      initialized: historyInitialized,
      stale: historyIsStale,
      totalRows: historyTotalRows,
      latestRecordedAt: latestHistoryAt,
      rowsLast24h,
      productsWithHistory,
      productsWithoutHistory,
      coverage: `${historyCoverage}/${pricingTotal}`,
      coveragePct: pricingTotal > 0 ? Math.round((historyCoverage / pricingTotal) * 100) : 0,
      byCategory: historyByCategory,
      legacyCategoryRows: legacyCategoryChecks.length + legacyCategoryHistory.length,
      ignoredLegacyRows: legacyPriceHistory,
      misalignedItems: misaligned.slice(0, 20),
      misalignedCount: misaligned.length,
    },
    seed: {
      lastVersion: seedVersion,
      expectedVersion: SEED_VERSION,
      upToDate: seedVersion === SEED_VERSION,
    },
    buildPricing: {
      drift: buildDrift.slice(0, 20),
      highDriftCount: buildDrift.filter((d) => d.diffPct > 20).length,
      underpricedCount: buildDrift.filter((d) => d.direction === "underpriced" && d.diffPct > 15).length,
      overpricedCount: buildDrift.filter((d) => d.direction === "overpriced" && d.diffPct > 15).length,
      missingReferences: buildMissingRefs.slice(0, 20),
    },
    compatibility: {
      issues: compatibilityIssues.slice(0, 20),
      warnings: compatibilityWarnings.slice(0, 20),
      buildsWithErrors: compatibilityIssues.length,
      buildsWithWarnings: compatibilityWarnings.length,
      macEgpuIssues: macEgpuCompatibilityIssues.slice(0, 20),
      macEgpuWarnings: macEgpuCompatibilityWarnings.slice(0, 20),
      macEgpuBuildsWithErrors: macEgpuCompatibilityIssues.length,
      macEgpuBuildsWithWarnings: macEgpuCompatibilityWarnings.length,
      missingSpecsTables: missingSpecsChecks,
      buildMissingComponents: buildMissingComponents.slice(0, 20),
    },
    database: {
      type: isPg ? "postgresql" : "sqlite",
      isEphemeral: isEphemeralSqlite,
      isProduction: isVercel,
      commerceInvariants,
    },
    pricingRuns: {
      latest: latestPricingRun,
      recent: latestPricingRuns,
    },
  });
}
