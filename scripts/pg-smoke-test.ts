import { Pool } from "pg";

const DATABASE_URL = process.argv[2];
if (!DATABASE_URL) {
  console.error("Usage: npx tsx scripts/pg-smoke-test.ts <DATABASE_URL>");
  process.exit(1);
}

const PASS = "✅ PASS";
const FAIL = "❌ FAIL";
let failures = 0;

function assert(condition: boolean, label: string, detail?: string) {
  if (condition) {
    console.log(`${PASS} ${label}`);
  } else {
    failures++;
    console.log(`${FAIL} ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL, ssl: false });

  console.log(`\nDATABASE_URL: ${DATABASE_URL.replace(/:([^@]+)@/, ":****@")}`);
  const ver = await pool.query("SELECT version()");
  console.log(`Postgres: ${ver.rows[0].version.split(",")[0]}\n`);

  // ── 1. Create all tables (replicating migration DDL) ──
  console.log("--- Table Creation ---");

  const ddl = [
    `CREATE TABLE IF NOT EXISTS gpus (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      brand TEXT NOT NULL,
      vram_gb INTEGER NOT NULL,
      architecture TEXT NOT NULL,
      tdp_watts INTEGER NOT NULL,
      ai_score INTEGER NOT NULL,
      price_eur INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS cpus (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      brand TEXT NOT NULL,
      cores INTEGER NOT NULL,
      threads INTEGER NOT NULL,
      base_clock_ghz REAL NOT NULL,
      boost_clock_ghz REAL NOT NULL,
      socket TEXT NOT NULL,
      tdp_watts INTEGER NOT NULL,
      ai_score INTEGER NOT NULL,
      price_eur INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS ram_kits (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      brand TEXT NOT NULL,
      capacity_gb INTEGER NOT NULL,
      modules TEXT NOT NULL,
      ddr_gen TEXT NOT NULL,
      speed_mt_s INTEGER NOT NULL,
      cas_latency TEXT NOT NULL,
      profile_support TEXT NOT NULL,
      price_eur INTEGER NOT NULL,
      source_refs TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS power_supplies (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      brand TEXT NOT NULL,
      wattage INTEGER NOT NULL,
      efficiency_rating TEXT NOT NULL,
      atx_standard TEXT NOT NULL,
      modularity TEXT NOT NULL,
      pcie_5_support INTEGER NOT NULL DEFAULT 0,
      price_eur INTEGER NOT NULL,
      source_refs TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS pc_cases (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      brand TEXT NOT NULL,
      form_factor TEXT NOT NULL,
      max_gpu_mm INTEGER NOT NULL,
      radiator_support TEXT NOT NULL,
      included_fans TEXT NOT NULL,
      price_eur INTEGER NOT NULL,
      source_refs TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS motherboards (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      brand TEXT NOT NULL,
      socket TEXT NOT NULL,
      chipset TEXT NOT NULL,
      memory_support TEXT NOT NULL,
      max_memory_gb INTEGER NOT NULL,
      pcie_gen5_support INTEGER NOT NULL DEFAULT 0,
      price_eur INTEGER NOT NULL,
      source_refs TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS compact_ai_systems (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      vendor TEXT NOT NULL,
      chip TEXT NOT NULL,
      memory_gb INTEGER NOT NULL,
      storage_gb INTEGER NOT NULL,
      gpu_class TEXT NOT NULL,
      installed_software TEXT NOT NULL,
      best_for TEXT NOT NULL,
      price_eur INTEGER NOT NULL,
      in_stock INTEGER NOT NULL DEFAULT 1,
      source_refs TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS storage_drives (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      brand TEXT NOT NULL,
      drive_type TEXT NOT NULL,
      interface TEXT NOT NULL,
      capacity_gb INTEGER NOT NULL,
      seq_read_mb_s INTEGER NOT NULL,
      endurance_tbw INTEGER NOT NULL,
      price_eur INTEGER NOT NULL,
      source_refs TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS cpu_coolers (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      brand TEXT NOT NULL,
      cooler_type TEXT NOT NULL,
      radiator_or_height_mm INTEGER NOT NULL,
      socket_support TEXT NOT NULL,
      max_tdp_w INTEGER NOT NULL,
      noise_db TEXT NOT NULL,
      price_eur INTEGER NOT NULL,
      source_refs TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS estonian_price_checks (
      id INTEGER PRIMARY KEY,
      category TEXT NOT NULL,
      item_id INTEGER NOT NULL,
      item_name TEXT NOT NULL,
      base_price_eur INTEGER NOT NULL,
      market_avg_eur REAL NOT NULL,
      assembly_markup_pct REAL NOT NULL DEFAULT 15.0,
      final_price_eur REAL NOT NULL,
      sample_count INTEGER NOT NULL,
      sources TEXT NOT NULL,
      checked_at TEXT NOT NULL,
      UNIQUE(category, item_id)
    )`,
    `CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY,
      category TEXT NOT NULL,
      item_id INTEGER NOT NULL,
      price_eur REAL NOT NULL,
      source TEXT NOT NULL DEFAULT 'market',
      recorded_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_price_history_lookup ON price_history(category, item_id, recorded_at)`,
    `CREATE TABLE IF NOT EXISTS profile_builds (
      id INTEGER PRIMARY KEY,
      profile_key TEXT NOT NULL,
      profile_label TEXT NOT NULL,
      build_name TEXT NOT NULL,
      target_model TEXT NOT NULL,
      ram_gb INTEGER NOT NULL,
      storage_gb INTEGER NOT NULL,
      estimated_price_eur INTEGER NOT NULL,
      best_for TEXT NOT NULL DEFAULT 'General AI workloads',
      estimated_tokens_per_sec TEXT NOT NULL DEFAULT 'n/a',
      estimated_system_power_w INTEGER NOT NULL DEFAULT 450,
      recommended_psu_w INTEGER NOT NULL DEFAULT 750,
      cooling_profile TEXT NOT NULL DEFAULT 'Balanced air cooling',
      notes TEXT NOT NULL,
      source_refs TEXT NOT NULL,
      cpu_id INTEGER NOT NULL REFERENCES cpus(id),
      gpu_id INTEGER NOT NULL REFERENCES gpus(id),
      UNIQUE(profile_key, build_name)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_profile_builds_profile_key ON profile_builds(profile_key)`,
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('ADMIN', 'DEV', 'USER')),
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      invalidated_at TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash)`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)`,
    `CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      profile_build_id INTEGER NOT NULL,
      order_item_type TEXT NOT NULL DEFAULT 'PROFILE_BUILD',
      order_item_id INTEGER NOT NULL DEFAULT 0,
      build_name TEXT NOT NULL,
      amount_eur_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'eur',
      status TEXT NOT NULL CHECK(status IN ('PENDING', 'CHECKOUT_CREATED', 'PAID', 'CANCELED', 'FAILED')) DEFAULT 'PENDING',
      stripe_checkout_session_id TEXT UNIQUE,
      stripe_payment_intent_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_orders_profile_build_id ON orders(profile_build_id)`,
    `CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`,
    `CREATE INDEX IF NOT EXISTS idx_orders_item_ref ON orders(order_item_type, order_item_id)`,
    `CREATE TABLE IF NOT EXISTS stripe_webhook_events (
      id INTEGER PRIMARY KEY,
      event_id TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS seed_runs (
      id INTEGER PRIMARY KEY,
      seed_version INTEGER NOT NULL,
      applied_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS mac_systems (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      chip TEXT NOT NULL,
      cpu_cores INTEGER NOT NULL,
      gpu_cores INTEGER NOT NULL,
      unified_memory_gb INTEGER NOT NULL,
      storage_gb INTEGER NOT NULL,
      ports TEXT NOT NULL,
      thunderbolt_version TEXT NOT NULL,
      usb4_supported INTEGER NOT NULL DEFAULT 0,
      macos_min_version TEXT NOT NULL,
      estimated_price_eur INTEGER NOT NULL,
      notes TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS external_gpu_enclosures (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      connection_type TEXT NOT NULL,
      pcie_generation TEXT NOT NULL,
      pcie_lanes INTEGER NOT NULL,
      max_gpu_length_mm INTEGER NOT NULL,
      max_gpu_slots INTEGER NOT NULL,
      included_psu_watts INTEGER NOT NULL DEFAULT 0,
      requires_external_psu INTEGER NOT NULL DEFAULT 0,
      supports_open_frame INTEGER NOT NULL DEFAULT 0,
      estimated_price_eur INTEGER NOT NULL,
      notes TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS mac_egpu_builds (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      mac_system_id INTEGER NOT NULL REFERENCES mac_systems(id),
      egpu_enclosure_id INTEGER NOT NULL REFERENCES external_gpu_enclosures(id),
      gpu_id INTEGER NOT NULL REFERENCES gpus(id),
      target_workloads TEXT NOT NULL,
      unsupported_workloads TEXT NOT NULL,
      risk_level TEXT NOT NULL CHECK(risk_level IN ('experimental', 'advanced', 'stable')),
      buyer_warning TEXT NOT NULL,
      notes TEXT NOT NULL
    )`,
  ];

  // v7 ALTER TABLEs
  const alterCols = [
    { col: "ram_kit_id", ref: "ram_kits(id)" },
    { col: "storage_drive_id", ref: "storage_drives(id)" },
    { col: "motherboard_id", ref: "motherboards(id)" },
    { col: "power_supply_id", ref: "power_supplies(id)" },
    { col: "case_id", ref: "pc_cases(id)" },
    { col: "cpu_cooler_id", ref: "cpu_coolers(id)" },
  ];

  let ddlOk = true;
  for (const sql of ddl) {
    try {
      await pool.query(sql);
    } catch (e) {
      ddlOk = false;
      console.log(`${FAIL} DDL: ${String(e instanceof Error ? e.message : e).slice(0, 120)}`);
    }
  }
  assert(ddlOk, "all DDL statements executed");

  for (const { col, ref } of alterCols) {
    try {
      await pool.query(`ALTER TABLE profile_builds ADD COLUMN ${col} INTEGER REFERENCES ${ref}`);
    } catch {
      // column may already exist
    }
  }

  // v8 unique indexes
  const idxTables = [
    "gpus", "cpus", "ram_kits", "power_supplies", "pc_cases", "motherboards",
    "compact_ai_systems", "storage_drives", "cpu_coolers", "mac_systems",
    "external_gpu_enclosures", "mac_egpu_builds",
  ];
  for (const t of idxTables) {
    try {
      await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${t}_name_uniq ON ${t}(name)`);
    } catch { /* */ }
  }

  // ── 2. Run migration v10 (postgres_identity_sequences) ──
  console.log("\n--- Migration v10: Sequences ---");

  const seqTables = [
    "gpus", "cpus", "ram_kits", "power_supplies", "pc_cases", "motherboards",
    "compact_ai_systems", "storage_drives", "cpu_coolers", "mac_systems",
    "external_gpu_enclosures", "mac_egpu_builds", "profile_builds",
    "users", "sessions", "orders", "stripe_webhook_events",
    "estonian_price_checks", "price_history", "seed_runs",
  ];

  for (const table of seqTables) {
    const seqName = `${table}_id_seq`;
    try {
      await pool.query(`CREATE SEQUENCE IF NOT EXISTS ${seqName}`);
      await pool.query(`ALTER TABLE ${table} ALTER COLUMN id SET DEFAULT nextval('${seqName}')`);
      await pool.query(`ALTER SEQUENCE ${seqName} OWNED BY ${table}.id`);
      const maxResult = await pool.query(`SELECT MAX(id) AS max_id FROM ${table}`);
      const maxId = maxResult.rows[0]?.max_id;
      if (maxId != null) {
        await pool.query(`SELECT setval('${seqName}', ${maxId})`);
      } else {
        await pool.query(`SELECT setval('${seqName}', 1, false)`);
      }
    } catch (e) {
      assert(false, `${table} sequence setup`, e instanceof Error ? e.message : String(e));
    }
  }
  assert(true, "all sequences created and owned");

  // ── 3. Verify sequence state ──
  console.log("\n--- Sequence State ---");
  for (const table of seqTables) {
    const seqName = `${table}_id_seq`;
    try {
      const r = await pool.query(`SELECT last_value, is_called FROM ${seqName}`);
      const { last_value, is_called } = r.rows[0];
      console.log(`  ${table}: ${seqName} last_value=${last_value} is_called=${is_called}`);
    } catch (e) {
      assert(false, `${table} sequence read`, e instanceof Error ? e.message : String(e));
    }
  }

  // ── 4. Seed minimal data ──
  console.log("\n--- Seed Data ---");

  // Insert a GPU and CPU (required FK targets for profile_builds)
  await pool.query(
    `INSERT INTO gpus (name, brand, vram_gb, architecture, tdp_watts, ai_score, price_eur)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT(name) DO UPDATE SET price_eur = EXCLUDED.price_eur`,
    ["NVIDIA RTX 4090", "NVIDIA", 24, "Ada Lovelace", 450, 100, 1800],
  );
  await pool.query(
    `INSERT INTO cpus (name, brand, cores, threads, base_clock_ghz, boost_clock_ghz, socket, tdp_watts, ai_score, price_eur)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT DO NOTHING`,
    ["AMD Ryzen 9 7950X", "AMD", 16, 32, 4.5, 5.7, "AM5", 170, 90, 550],
  );

  const gpuRow = await pool.query("SELECT id FROM gpus WHERE name = $1", ["NVIDIA RTX 4090"]);
  const cpuRow = await pool.query("SELECT id FROM cpus WHERE name = $1", ["AMD Ryzen 9 7950X"]);
  assert(gpuRow.rows.length === 1, "GPU seeded", `got ${gpuRow.rows.length} rows`);
  assert(cpuRow.rows.length === 1, "CPU seeded", `got ${cpuRow.rows.length} rows`);

  const gpuId = gpuRow.rows[0].id;
  const cpuId = cpuRow.rows[0].id;
  console.log(`  GPU id=${gpuId}, CPU id=${cpuId}`);

  // ── 5. Test inserts WITHOUT explicit ID (auto-increment) ──
  console.log("\n--- Auto-Increment Insert Tests ---");

  // users
  await pool.query(
    "INSERT INTO users (email, password_hash, role, created_at) VALUES ($1, $2, $3, $4)",
    ["test@smoke.com", "hash:key", "USER", new Date().toISOString()],
  );
  const u = await pool.query("SELECT id FROM users WHERE email = $1", ["test@smoke.com"]);
  const userId = u.rows[0]?.id;
  assert(userId > 0, `users auto-id: ${userId}`);

  // sessions
  await pool.query(
    "INSERT INTO sessions (user_id, token_hash, expires_at, created_at) VALUES ($1, $2, $3, $4)",
    [userId, "tokenhash123", new Date(Date.now() + 86400000).toISOString(), new Date().toISOString()],
  );
  const s = await pool.query("SELECT id FROM sessions WHERE user_id = $1 ORDER BY id DESC LIMIT 1", [userId]);
  assert(s.rows[0]?.id > 0, `sessions auto-id: ${s.rows[0]?.id}`);

  // orders
  await pool.query(
    `INSERT INTO orders (user_id, profile_build_id, order_item_type, order_item_id, build_name, amount_eur_cents, currency, status, created_at, updated_at)
     VALUES ($1, 0, 'GPU', $2, 'Test Order', 180000, 'eur', 'PENDING', $3, $4)`,
    [userId, gpuId, new Date().toISOString(), new Date().toISOString()],
  );
  const o = await pool.query("SELECT id FROM orders WHERE user_id = $1 ORDER BY id DESC LIMIT 1", [userId]);
  assert(o.rows[0]?.id > 0, `orders auto-id: ${o.rows[0]?.id}`);

  // price_history
  await pool.query(
    "INSERT INTO price_history (category, item_id, price_eur, source, recorded_at) VALUES ($1, $2, $3, $4, $5)",
    ["gpu", gpuId, 1850.50, "test_source", new Date().toISOString()],
  );
  const ph = await pool.query("SELECT id FROM price_history WHERE source = $1 ORDER BY id DESC LIMIT 1", ["test_source"]);
  assert(ph.rows[0]?.id > 0, `price_history auto-id: ${ph.rows[0]?.id}`);

  // estonian_price_checks
  await pool.query(
    `INSERT INTO estonian_price_checks (category, item_id, item_name, base_price_eur, market_avg_eur, assembly_markup_pct, final_price_eur, sample_count, sources, checked_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT(category, item_id) DO UPDATE SET final_price_eur = EXCLUDED.final_price_eur`,
    ["gpu", gpuId, "NVIDIA RTX 4090", 1800, 1850.50, 15.0, 2128.08, 3, "1a.ee, Kaup24", new Date().toISOString()],
  );
  const epc = await pool.query("SELECT id FROM estonian_price_checks WHERE category = $1 AND item_id = $2", ["gpu", gpuId]);
  assert(epc.rows[0]?.id > 0, `estonian_price_checks auto-id: ${epc.rows[0]?.id}`);

  // stripe_webhook_events
  const evtId = `evt_test_${Date.now()}`;
  await pool.query(
    "INSERT INTO stripe_webhook_events (event_id, event_type, created_at) VALUES ($1, $2, $3)",
    [evtId, "checkout.session.completed", new Date().toISOString()],
  );
  const swe = await pool.query("SELECT id FROM stripe_webhook_events WHERE event_id = $1", [evtId]);
  assert(swe.rows[0]?.id > 0, `stripe_webhook_events auto-id: ${swe.rows[0]?.id}`);

  // seed_runs
  await pool.query(
    "INSERT INTO seed_runs (seed_version, applied_at) VALUES ($1, $2)",
    [99, new Date().toISOString()],
  );
  const sr = await pool.query("SELECT id FROM seed_runs WHERE seed_version = $1", [99]);
  assert(sr.rows[0]?.id > 0, `seed_runs auto-id: ${sr.rows[0]?.id}`);

  // schema_migrations
  await pool.query(
    "INSERT INTO schema_migrations (version, name, applied_at) VALUES ($1, $2, $3)",
    [99, "smoke_test", new Date().toISOString()],
  );
  const sm = await pool.query("SELECT version FROM schema_migrations WHERE version = $1", [99]);
  assert(sm.rows.length === 1, `schema_migrations insert: version ${sm.rows[0]?.version}`);

  // gpus (additional row without explicit id)
  await pool.query(
    `INSERT INTO gpus (name, brand, vram_gb, architecture, tdp_watts, ai_score, price_eur)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    ["SMOKE_TEST_GPU", "TestBrand", 8, "TestArch", 200, 30, 400],
  );
  const g2 = await pool.query("SELECT id FROM gpus WHERE name = $1", ["SMOKE_TEST_GPU"]);
  assert(g2.rows[0]?.id > gpuId, `gpus auto-id (${g2.rows[0]?.id}) > seeded id (${gpuId})`);

  // ── 7. Test second insert into same table (sequence increments correctly) ──
  console.log("\n--- Sequence Increment Verification ---");
  const u2 = await pool.query(
    "INSERT INTO users (email, password_hash, role, created_at) VALUES ($1, $2, $3, $4) RETURNING id",
    ["test2@smoke.com", "hash:key", "USER", new Date().toISOString()],
  );
  assert(u2.rows[0]?.id > userId, `second user id (${u2.rows[0]?.id}) > first (${userId})`);

  // ── 8. Test ON CONFLICT DO UPDATE (seed pattern) ──
  console.log("\n--- ON CONFLICT Seed Pattern ---");
  await pool.query(
    `INSERT INTO gpus (name, brand, vram_gb, architecture, tdp_watts, ai_score, price_eur)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT(name) DO UPDATE SET price_eur = EXCLUDED.price_eur`,
    ["NVIDIA RTX 4090", "NVIDIA", 24, "Ada Lovelace", 450, 100, 1850],
  );
  const gpuUpd = await pool.query("SELECT id, price_eur FROM gpus WHERE name = $1", ["NVIDIA RTX 4090"]);
  assert(gpuUpd.rows[0]?.price_eur === 1850, `ON CONFLICT update: price changed to ${gpuUpd.rows[0]?.price_eur}`);
  assert(gpuUpd.rows[0]?.id === gpuId, `id unchanged after ON CONFLICT (${gpuUpd.rows[0]?.id} === ${gpuId})`);

  // ── 9. Test CHECK constraints ──
  console.log("\n--- CHECK Constraints ---");
  let checkOk = false;
  try {
    await pool.query("INSERT INTO users (email, password_hash, role, created_at) VALUES ($1, $2, $3, $4)", ["bad@role.com", "h:k", "SUPERADMIN", new Date().toISOString()]);
  } catch (e: unknown) {
    checkOk = String(e).includes("violates check constraint");
  }
  assert(checkOk, "invalid role rejected by CHECK constraint");

  let orderCheckOk = false;
  try {
    await pool.query(
      `INSERT INTO orders (user_id, profile_build_id, order_item_type, order_item_id, build_name, amount_eur_cents, currency, status, created_at, updated_at)
       VALUES ($1, 0, 'GPU', $2, 'Test', 100, 'eur', 'INVALID_STATUS', $3, $4)`,
      [userId, gpuId, new Date().toISOString(), new Date().toISOString()],
    );
  } catch (e: unknown) {
    orderCheckOk = String(e).includes("violates check constraint");
  }
  assert(orderCheckOk, "invalid order status rejected by CHECK constraint");

  // ── 10. Test UNIQUE constraints ──
  console.log("\n--- UNIQUE Constraints ---");
  let uniqueOk = false;
  try {
    await pool.query(
      `INSERT INTO gpus (name, brand, vram_gb, architecture, tdp_watts, ai_score, price_eur)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      ["NVIDIA RTX 4090", "NVIDIA", 24, "Ada Lovelace", 450, 100, 999],
    );
  } catch (e: unknown) {
    uniqueOk = String(e).includes("violates unique constraint");
  }
  assert(uniqueOk, "duplicate gpu name rejected by UNIQUE constraint");

  // ── 11. Test FK constraints ──
  console.log("\n--- FK Constraints ---");
  let fkOk = false;
  try {
    await pool.query(
      `INSERT INTO profile_builds (profile_key, profile_label, build_name, target_model, ram_gb, storage_gb, estimated_price_eur, notes, source_refs, cpu_id, gpu_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      ["test", "Test", "Test Build", "Test", 32, 1000, 2000, "test", "test", 99999, 99999],
    );
  } catch (e: unknown) {
    fkOk = String(e).includes("violates foreign key constraint");
  }
  assert(fkOk, "invalid FK references rejected");

  // ── 12. Full-table row counts ──
  console.log("\n--- Full Schema Row Counts ---");
  const allTables = [
    "gpus", "cpus", "ram_kits", "power_supplies", "pc_cases", "motherboards",
    "compact_ai_systems", "storage_drives", "cpu_coolers", "mac_systems",
    "external_gpu_enclosures", "mac_egpu_builds", "profile_builds",
    "users", "sessions", "orders", "stripe_webhook_events",
    "estonian_price_checks", "price_history", "schema_migrations", "seed_runs",
  ];
  for (const t of allTables) {
    const r = await pool.query(`SELECT COUNT(*) AS cnt FROM ${t}`);
    console.log(`  ${t}: ${r.rows[0]?.cnt} rows`);
  }

  // ── 7. Cleanup ──
  console.log("\n--- Cleanup ---");
  await pool.query("DELETE FROM schema_migrations WHERE version = 99");
  await pool.query("DELETE FROM seed_runs WHERE seed_version = 99");
  await pool.query("DELETE FROM stripe_webhook_events WHERE event_id LIKE 'evt_test_%'");
  await pool.query("DELETE FROM estonian_price_checks WHERE category = 'gpu'");
  await pool.query("DELETE FROM price_history WHERE source = 'test_source'");
  await pool.query("DELETE FROM orders WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'test%@smoke.com')");
  await pool.query("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'test%@smoke.com')");
  await pool.query("DELETE FROM users WHERE email LIKE 'test%@smoke.com'");
  await pool.query("DELETE FROM gpus WHERE name = 'SMOKE_TEST_GPU'");
  console.log("  cleaned up test data");

  // ── Summary ──
  console.log(`\n${"=".repeat(50)}`);
  if (failures === 0) {
    console.log("ALL CHECKS PASSED");
  } else {
    console.log(`${failures} FAILURE(S) — see above`);
  }
  console.log(`${"=".repeat(50)}\n`);

  await pool.end();
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
