import "server-only";
import { getAdapter } from "./adapter";
import type { DbAdapter } from "./adapter";
import {
  ORDER_ITEM_TYPES,
  QUOTE_PRODUCT_TYPES,
  assertCommerceInvariantsSatisfied,
  sqlLiteralList,
} from "./invariants";

type Migration = {
  version: number;
  name: string;
  up: (db: DbAdapter) => Promise<void>;
};

function generatedPrimaryKey(db: DbAdapter): string {
  return db.dialect === "postgres"
    ? "BIGSERIAL PRIMARY KEY"
    : "INTEGER PRIMARY KEY AUTOINCREMENT";
}

async function ensurePostgresIdentitySequences(db: DbAdapter, tables: string[]): Promise<void> {
  if (db.dialect !== "postgres") return;

  for (const table of tables) {
    const seqName = `${table}_id_seq`;
    await db.execute(`CREATE SEQUENCE IF NOT EXISTS ${seqName}`);
    await db.execute(`ALTER TABLE ${table} ALTER COLUMN id SET DEFAULT nextval('${seqName}')`);
    await db.execute(`ALTER SEQUENCE ${seqName} OWNED BY ${table}.id`);

    const maxRow = await db.queryOne<{ max_id: number | null }>(`SELECT MAX(id) AS max_id FROM ${table}`);
    if (maxRow?.max_id != null) {
      await db.execute(`SELECT setval('${seqName}', ${maxRow.max_id})`);
    } else {
      await db.execute(`SELECT setval('${seqName}', 1, false)`);
    }
  }
}

const migrations: Migration[] = [
  {
    version: 1,
    name: "initial_catalog_tables",
    up: async (db) => {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS gpus (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          brand TEXT NOT NULL,
          vram_gb INTEGER NOT NULL,
          architecture TEXT NOT NULL,
          tdp_watts INTEGER NOT NULL,
          ai_score INTEGER NOT NULL,
          price_eur INTEGER NOT NULL
        )
      `);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS cpus (
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
        )
      `);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS ram_kits (
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
        )
      `);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS power_supplies (
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
        )
      `);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS pc_cases (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          brand TEXT NOT NULL,
          form_factor TEXT NOT NULL,
          max_gpu_mm INTEGER NOT NULL,
          radiator_support TEXT NOT NULL,
          included_fans TEXT NOT NULL,
          price_eur INTEGER NOT NULL,
          source_refs TEXT NOT NULL
        )
      `);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS motherboards (
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
        )
      `);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS compact_ai_systems (
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
        )
      `);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS storage_drives (
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
        )
      `);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS cpu_coolers (
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
        )
      `);
    },
  },
  {
    version: 2,
    name: "price_tracking",
    up: async (db) => {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS estonian_price_checks (
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
        )
      `);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS price_history (
          id INTEGER PRIMARY KEY,
          category TEXT NOT NULL,
          item_id INTEGER NOT NULL,
          price_eur REAL NOT NULL,
          source TEXT NOT NULL DEFAULT 'market',
          recorded_at TEXT NOT NULL
        )
      `);
      await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_price_history_lookup
          ON price_history(category, item_id, recorded_at)
      `);
    },
  },
  {
    version: 3,
    name: "profile_builds",
    up: async (db) => {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS profile_builds (
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
        )
      `);
      await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_profile_builds_profile_key ON profile_builds(profile_key)
      `);
    },
  },
  {
    version: 4,
    name: "auth_and_orders",
    up: async (db) => {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('ADMIN', 'DEV', 'USER')),
          created_at TEXT NOT NULL
        )
      `);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS sessions (
          id INTEGER PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id),
          token_hash TEXT NOT NULL UNIQUE,
          expires_at TEXT NOT NULL,
          ip_address TEXT,
          user_agent TEXT,
          invalidated_at TEXT,
          created_at TEXT NOT NULL
        )
      `);
      await db.execute(`CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash)`);
      await db.execute(`CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)`);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS orders (
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
        )
      `);
      await db.execute(`CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id)`);
      await db.execute(`CREATE INDEX IF NOT EXISTS idx_orders_profile_build_id ON orders(profile_build_id)`);
      await db.execute(`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`);
      await db.execute(`CREATE INDEX IF NOT EXISTS idx_orders_item_ref ON orders(order_item_type, order_item_id)`);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS stripe_webhook_events (
          id INTEGER PRIMARY KEY,
          event_id TEXT NOT NULL UNIQUE,
          event_type TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);
    },
  },
  {
    version: 5,
    name: "mac_egpu_support",
    up: async (db) => {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS mac_systems (
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
        )
      `);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS external_gpu_enclosures (
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
        )
      `);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS mac_egpu_builds (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          mac_system_id INTEGER NOT NULL REFERENCES mac_systems(id),
          egpu_enclosure_id INTEGER NOT NULL REFERENCES external_gpu_enclosures(id),
          gpu_id INTEGER NOT NULL REFERENCES gpus(id),
          target_workloads TEXT NOT NULL,
          unsupported_workloads TEXT NOT NULL,
          estimated_total_price_eur INTEGER NOT NULL,
          risk_level TEXT NOT NULL CHECK(risk_level IN ('experimental', 'advanced', 'stable')),
          buyer_warning TEXT NOT NULL,
          notes TEXT NOT NULL
        )
      `);
    },
  },
  {
    version: 6,
    name: "seed_tracking",
    up: async (db) => {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS seed_runs (
          id INTEGER PRIMARY KEY,
          seed_version INTEGER NOT NULL,
          applied_at TEXT NOT NULL
        )
      `);
    },
  },
  {
    version: 7,
    name: "profile_build_full_components",
    up: async (db) => {
      const cols = [
        { col: "ram_kit_id", ref: "ram_kits(id)" },
        { col: "storage_drive_id", ref: "storage_drives(id)" },
        { col: "motherboard_id", ref: "motherboards(id)" },
        { col: "power_supply_id", ref: "power_supplies(id)" },
        { col: "case_id", ref: "pc_cases(id)" },
        { col: "cpu_cooler_id", ref: "cpu_coolers(id)" },
      ];
      for (const { col, ref } of cols) {
        try {
          await db.execute(`ALTER TABLE profile_builds ADD COLUMN ${col} INTEGER REFERENCES ${ref}`);
        } catch {
          // column may already exist
        }
      }
    },
  },
  {
    version: 8,
    name: "harden_unique_name_indexes",
    up: async (db) => {
      const indexes: Array<{ table: string; column: string }> = [
        { table: "gpus", column: "name" },
        { table: "cpus", column: "name" },
        { table: "ram_kits", column: "name" },
        { table: "power_supplies", column: "name" },
        { table: "pc_cases", column: "name" },
        { table: "motherboards", column: "name" },
        { table: "compact_ai_systems", column: "name" },
        { table: "storage_drives", column: "name" },
        { table: "cpu_coolers", column: "name" },
        { table: "mac_systems", column: "name" },
        { table: "external_gpu_enclosures", column: "name" },
        { table: "mac_egpu_builds", column: "name" },
      ];
      for (const { table, column } of indexes) {
        try {
          await db.execute(
            `CREATE UNIQUE INDEX IF NOT EXISTS idx_${table}_${column}_uniq ON ${table}(${column})`,
          );
        } catch {
          // index may already exist from seed or DDL UNIQUE
        }
      }
    },
  },
  {
    version: 9,
    name: "cleanup_legacy_mac_egpu_build",
    up: async (db) => {
      try {
        await db.execute(
          `DELETE FROM mac_egpu_builds WHERE name = 'Mac Studio M2 Ultra Local Inference (no eGPU)'`,
        );
      } catch {
        // row may not exist in fresh databases
      }
    },
  },
  {
    version: 10,
    name: "postgres_identity_sequences",
    up: async (db) => {
      const tables = [
        "gpus", "cpus", "ram_kits", "power_supplies", "pc_cases", "motherboards",
        "compact_ai_systems", "storage_drives", "cpu_coolers", "mac_systems",
        "external_gpu_enclosures", "mac_egpu_builds", "profile_builds",
        "users", "sessions", "orders", "stripe_webhook_events",
        "estonian_price_checks", "price_history", "seed_runs",
      ];

      for (const table of tables) {
        try {
          await ensurePostgresIdentitySequences(db, [table]);
        } catch (e) {
          console.warn(`Migration v10: skipping ${table} (${e instanceof Error ? e.message : String(e)})`);
        }
      }
    },
  },
  {
    version: 11,
    name: "rich_immutable_specs",
    up: async (db) => {
      const gpuCols = [
        "vram_type TEXT NOT NULL DEFAULT ''",
        "memory_bus_bits INTEGER NOT NULL DEFAULT 0",
        "memory_bandwidth_gbps REAL NOT NULL DEFAULT 0",
        "cuda_cores INTEGER NOT NULL DEFAULT 0",
        "stream_processors INTEGER NOT NULL DEFAULT 0",
        "tensor_cores INTEGER NOT NULL DEFAULT 0",
        "rt_cores INTEGER NOT NULL DEFAULT 0",
        "base_clock_mhz INTEGER NOT NULL DEFAULT 0",
        "boost_clock_mhz INTEGER NOT NULL DEFAULT 0",
        "recommended_psu_w INTEGER NOT NULL DEFAULT 0",
        "pcie_generation TEXT NOT NULL DEFAULT ''",
        "slot_width INTEGER NOT NULL DEFAULT 0",
        "length_mm INTEGER NOT NULL DEFAULT 0",
        "power_connectors TEXT NOT NULL DEFAULT ''",
        "nvlink_support INTEGER NOT NULL DEFAULT 0",
        "fp16_tensor_tflops REAL NOT NULL DEFAULT 0",
        "fp32_tflops REAL NOT NULL DEFAULT 0",
        "inference_notes TEXT NOT NULL DEFAULT ''",
        "generation TEXT NOT NULL DEFAULT ''",
      ];
      for (const col of gpuCols) {
        try { await db.execute(`ALTER TABLE gpus ADD COLUMN ${col}`); } catch { /* already exists */ }
      }

      const cpuCols = [
        "cache_l3_mb INTEGER NOT NULL DEFAULT 0",
        "integrated_graphics TEXT NOT NULL DEFAULT ''",
        "memory_type_support TEXT NOT NULL DEFAULT ''",
        "max_memory_gb INTEGER NOT NULL DEFAULT 0",
        "pcie_generation TEXT NOT NULL DEFAULT ''",
        "unlocked INTEGER NOT NULL DEFAULT 0",
        "cooler_included INTEGER NOT NULL DEFAULT 0",
      ];
      for (const col of cpuCols) {
        try { await db.execute(`ALTER TABLE cpus ADD COLUMN ${col}`); } catch { /* already exists */ }
      }

      const ramCols = [
        "voltage REAL NOT NULL DEFAULT 0",
        "ecc INTEGER NOT NULL DEFAULT 0",
        "registered INTEGER NOT NULL DEFAULT 0",
        "recommended_platform TEXT NOT NULL DEFAULT ''",
      ];
      for (const col of ramCols) {
        try { await db.execute(`ALTER TABLE ram_kits ADD COLUMN ${col}`); } catch { /* already exists */ }
      }

      const mbCols = [
        "form_factor TEXT NOT NULL DEFAULT ''",
        "memory_slots INTEGER NOT NULL DEFAULT 0",
        "pcie_x16_slots INTEGER NOT NULL DEFAULT 0",
        "pcie_generation TEXT NOT NULL DEFAULT ''",
        "m2_slots INTEGER NOT NULL DEFAULT 0",
        "sata_ports INTEGER NOT NULL DEFAULT 0",
        "ethernet TEXT NOT NULL DEFAULT ''",
        "wifi TEXT NOT NULL DEFAULT ''",
        "usb4_support INTEGER NOT NULL DEFAULT 0",
        "thunderbolt_support INTEGER NOT NULL DEFAULT 0",
        "bios_flashback INTEGER NOT NULL DEFAULT 0",
        "mb_notes TEXT NOT NULL DEFAULT ''",
      ];
      for (const col of mbCols) {
        try { await db.execute(`ALTER TABLE motherboards ADD COLUMN ${col}`); } catch { /* already exists */ }
      }

      const psuCols = [
        "psu_form_factor TEXT NOT NULL DEFAULT ''",
        "native_12vhpwr INTEGER NOT NULL DEFAULT 0",
        "gpu_connector_count INTEGER NOT NULL DEFAULT 0",
        "warranty_years INTEGER NOT NULL DEFAULT 0",
      ];
      for (const col of psuCols) {
        try { await db.execute(`ALTER TABLE power_supplies ADD COLUMN ${col}`); } catch { /* already exists */ }
      }

      const caseCols = [
        "max_cpu_cooler_height_mm INTEGER NOT NULL DEFAULT 0",
        "max_psu_length_mm INTEGER NOT NULL DEFAULT 0",
        "dimensions_mm TEXT NOT NULL DEFAULT ''",
        "drive_bays TEXT NOT NULL DEFAULT ''",
        "airflow_notes TEXT NOT NULL DEFAULT ''",
      ];
      for (const col of caseCols) {
        try { await db.execute(`ALTER TABLE pc_cases ADD COLUMN ${col}`); } catch { /* already exists */ }
      }

      const coolerCols = [
        "fan_size_mm INTEGER NOT NULL DEFAULT 0",
        "ram_clearance_notes TEXT NOT NULL DEFAULT ''",
      ];
      for (const col of coolerCols) {
        try { await db.execute(`ALTER TABLE cpu_coolers ADD COLUMN ${col}`); } catch { /* already exists */ }
      }

      const storageCols = [
        "form_factor TEXT NOT NULL DEFAULT ''",
        "pcie_generation TEXT NOT NULL DEFAULT ''",
        "seq_write_mb_s INTEGER NOT NULL DEFAULT 0",
        "dram_cache INTEGER NOT NULL DEFAULT 0",
        "nand_type TEXT NOT NULL DEFAULT ''",
        "warranty_years INTEGER NOT NULL DEFAULT 0",
      ];
      for (const col of storageCols) {
        try { await db.execute(`ALTER TABLE storage_drives ADD COLUMN ${col}`); } catch { /* already exists */ }
      }

      const compactCols = [
        "npu_tops REAL NOT NULL DEFAULT 0",
        "ports TEXT NOT NULL DEFAULT ''",
        "upgradeability TEXT NOT NULL DEFAULT ''",
        "ai_workload_notes TEXT NOT NULL DEFAULT ''",
      ];
      for (const col of compactCols) {
        try { await db.execute(`ALTER TABLE compact_ai_systems ADD COLUMN ${col}`); } catch { /* already exists */ }
      }

      const macCols = [
        "neural_engine_cores INTEGER NOT NULL DEFAULT 0",
        "memory_bandwidth_gbps REAL NOT NULL DEFAULT 0",
        "external_gpu_support INTEGER NOT NULL DEFAULT 0",
        "ai_framework_notes TEXT NOT NULL DEFAULT ''",
        "local_llm_notes TEXT NOT NULL DEFAULT ''",
      ];
      for (const col of macCols) {
        try { await db.execute(`ALTER TABLE mac_systems ADD COLUMN ${col}`); } catch { /* already exists */ }
      }

      const egpuCols = [
        "thunderbolt_version TEXT NOT NULL DEFAULT ''",
        "macos_support_notes TEXT NOT NULL DEFAULT ''",
        "windows_support_notes TEXT NOT NULL DEFAULT ''",
        "nvidia_support_notes TEXT NOT NULL DEFAULT ''",
        "amd_support_notes TEXT NOT NULL DEFAULT ''",
      ];
      for (const col of egpuCols) {
        try { await db.execute(`ALTER TABLE external_gpu_enclosures ADD COLUMN ${col}`); } catch { /* already exists */ }
      }

      const buildCols = [
        "compatibility_notes TEXT NOT NULL DEFAULT ''",
      ];
      for (const col of buildCols) {
        try { await db.execute(`ALTER TABLE profile_builds ADD COLUMN ${col}`); } catch { /* already exists */ }
      }
    },
  },
  {
    version: 12,
    name: "price_history_dedupe_constraint",
    up: async (db) => {
      await hardenPriceHistoryDedupe(db);
    },
  },
  {
    version: 13,
    name: "order_price_snapshots",
    up: async (db) => {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS order_price_snapshots (
          id ${generatedPrimaryKey(db)},
          order_id INTEGER NOT NULL REFERENCES orders(id),
          slot_key TEXT NOT NULL,
          order_item_type TEXT NOT NULL,
          item_id INTEGER NOT NULL,
          item_name TEXT NOT NULL,
          unit_price_eur REAL NOT NULL,
          price_source TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);
      await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_order_price_snapshots_order_id ON order_price_snapshots(order_id)",
      );
    },
  },
  {
    version: 14,
    name: "quote_requests",
    up: async (db) => {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS quote_requests (
          id ${generatedPrimaryKey(db)},
          customer_email TEXT NOT NULL,
          customer_name TEXT NOT NULL DEFAULT '',
          product_type TEXT NOT NULL,
          product_id INTEGER NOT NULL,
          product_name TEXT NOT NULL,
          message TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL CHECK(status IN ('NEW', 'IN_REVIEW', 'CONTACTED', 'CLOSED_WON', 'CLOSED_LOST')) DEFAULT 'NEW',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);
      await db.execute("CREATE INDEX IF NOT EXISTS idx_quote_requests_status ON quote_requests(status)");
      await db.execute("CREATE INDEX IF NOT EXISTS idx_quote_requests_created_at ON quote_requests(created_at)");
    },
  },
  {
    version: 15,
    name: "pricing_run_observability",
    up: async (db) => {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS pricing_runs (
          id ${generatedPrimaryKey(db)},
          started_at TEXT NOT NULL,
          finished_at TEXT,
          status TEXT NOT NULL CHECK(status IN ('RUNNING', 'SUCCESS', 'FAILED', 'PARTIAL')),
          total_items INTEGER NOT NULL DEFAULT 0,
          updated_items INTEGER NOT NULL DEFAULT 0,
          failed_items INTEGER NOT NULL DEFAULT 0,
          notes TEXT NOT NULL DEFAULT ''
        )
      `);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS pricing_run_failures (
          id ${generatedPrimaryKey(db)},
          run_id INTEGER NOT NULL REFERENCES pricing_runs(id),
          category TEXT NOT NULL,
          item_id INTEGER NOT NULL,
          item_name TEXT NOT NULL,
          source TEXT NOT NULL DEFAULT '',
          error_message TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);
      await db.execute("CREATE INDEX IF NOT EXISTS idx_pricing_run_failures_run_id ON pricing_run_failures(run_id)");
    },
  },
  {
    version: 16,
    name: "inventory_flags",
    up: async (db) => {
      const tables = [
        "gpus",
        "cpus",
        "ram_kits",
        "power_supplies",
        "pc_cases",
        "motherboards",
        "storage_drives",
        "cpu_coolers",
      ];
      for (const table of tables) {
        try {
          await db.execute(`ALTER TABLE ${table} ADD COLUMN in_stock INTEGER NOT NULL DEFAULT 1`);
        } catch {
          // already exists
        }
      }
    },
  },
  {
    version: 17,
    name: "correct_apple_silicon_mac_specs",
    up: async (db) => {
      await db.execute(`
        UPDATE mac_systems
        SET name = 'Mac Studio M3 Ultra 128GB / 2TB',
            chip = 'Apple M3 Ultra',
            macos_min_version = '15.4',
            external_gpu_support = 0,
            notes = 'M3 Ultra Studio. Maximum macOS compute.'
        WHERE name = 'Mac Studio M4 Ultra 128GB / 2TB'
      `);
      await db.execute(`
        UPDATE mac_systems
        SET name = 'Mac Studio M3 Ultra 256GB / 4TB',
            chip = 'Apple M3 Ultra',
            cpu_cores = 32,
            gpu_cores = 80,
            unified_memory_gb = 256,
            macos_min_version = '15.4',
            external_gpu_support = 0,
            notes = 'High-memory M3 Ultra. Ultimate macOS AI machine.',
            ai_framework_notes = '256GB unified. Can load very large models into memory.'
        WHERE name = 'Mac Studio M4 Ultra 192GB / 4TB'
      `);
      await db.execute("UPDATE mac_systems SET external_gpu_support = 0");
    },
  },
  {
    version: 18,
    name: "checkout_lookup_indexes",
    up: async (db) => {
      await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_orders_recent_build_checkout
          ON orders(user_id, profile_build_id, order_item_type, status, created_at)
      `);
      await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_orders_recent_item_checkout
          ON orders(user_id, order_item_type, order_item_id, status, created_at)
      `);
    },
  },
  {
    version: 19,
    name: "checkout_lookup_indexes_ordering",
    up: async (db) => {
      await db.execute("DROP INDEX IF EXISTS idx_orders_recent_build_checkout");
      await db.execute("DROP INDEX IF EXISTS idx_orders_recent_item_checkout");
      await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_orders_recent_build_checkout
          ON orders(user_id, profile_build_id, order_item_type, status, created_at DESC, id DESC)
      `);
      await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_orders_recent_item_checkout
          ON orders(user_id, order_item_type, order_item_id, status, created_at DESC, id DESC)
      `);
    },
  },
  {
    version: 20,
    name: "checkout_lookup_partial_indexes",
    up: async (db) => {
      await db.execute("DROP INDEX IF EXISTS idx_orders_recent_build_checkout");
      await db.execute("DROP INDEX IF EXISTS idx_orders_recent_item_checkout");
      await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_orders_recent_build_checkout
          ON orders(user_id, profile_build_id, order_item_type, created_at DESC, id DESC)
          WHERE status IN ('PENDING', 'CHECKOUT_CREATED')
      `);
      await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_orders_recent_item_checkout
          ON orders(user_id, order_item_type, order_item_id, created_at DESC, id DESC)
          WHERE status IN ('PENDING', 'CHECKOUT_CREATED')
      `);
    },
  },
  {
    version: 21,
    name: "catalog_metadata_and_remove_estimated_egpu_total",
    up: async (db) => {
      const addColumns = async (table: string, columns: string[]) => {
        for (const col of columns) {
          try { await db.execute(`ALTER TABLE ${table} ADD COLUMN ${col}`); } catch { /* already exists */ }
        }
      };

      const common = [
        "mpn TEXT NOT NULL DEFAULT ''",
        "release_year INTEGER NOT NULL DEFAULT 0",
        "release_quarter TEXT NOT NULL DEFAULT ''",
      ];

      await addColumns("gpus", [
        "source_refs TEXT NOT NULL DEFAULT ''",
        ...common,
        "display_power_w INTEGER NOT NULL DEFAULT 0",
        "connector_standard TEXT NOT NULL DEFAULT ''",
        "minimum_psu_w INTEGER NOT NULL DEFAULT 0",
        "dual_gpu_capable INTEGER NOT NULL DEFAULT 0",
      ]);
      await addColumns("cpus", [
        "source_refs TEXT NOT NULL DEFAULT ''",
        ...common,
        "platform_generation TEXT NOT NULL DEFAULT ''",
        "memory_channels INTEGER NOT NULL DEFAULT 0",
        "ecc_support INTEGER NOT NULL DEFAULT 0",
      ]);

      await addColumns("ram_kits", common);
      await addColumns("power_supplies", common);
      await addColumns("pc_cases", common);
      await addColumns("motherboards", common);
      await addColumns("compact_ai_systems", common);
      await addColumns("cpu_coolers", common);
      await addColumns("mac_systems", common);
      await addColumns("external_gpu_enclosures", common);
      await addColumns("storage_drives", [
        ...common,
        "interface_generation TEXT NOT NULL DEFAULT ''",
      ]);

      try {
        await db.execute("ALTER TABLE mac_egpu_builds DROP COLUMN estimated_total_price_eur");
      } catch {
        // Older SQLite versions or already-migrated databases may not support/drop it.
      }

      await db.execute(`
        UPDATE storage_drives
        SET interface_generation =
          CASE
            WHEN interface LIKE '%PCIe 5%' THEN 'PCIe 5.0'
            WHEN interface LIKE '%PCIe 4%' THEN 'PCIe 4.0'
            WHEN interface LIKE '%PCIe 3%' THEN 'PCIe 3.0'
            WHEN interface LIKE '%SATA%' THEN 'SATA 6Gb/s'
            ELSE COALESCE(NULLIF(pcie_generation, ''), 'n/a')
          END
        WHERE interface_generation = ''
      `);
      await db.execute(`
        UPDATE mac_egpu_builds
        SET name = 'Mac Studio M2 Max Native MLX Workstation (Optional eGPU Path)',
            risk_level = 'advanced',
            buyer_warning = 'Primary workloads run natively on Apple Silicon via MLX/Ollama. External GPU compute is an optional experimental path and is not included as a fixed total price.',
            notes = 'Mac Studio M2 Max with 64GB unified memory for native macOS AI, plus an optional RTX 4090/eGPU path for CUDA/tinygrad experimentation.'
        WHERE name = 'Mac Studio M2 Max 64GB Native AI Workstation'
      `);
    },
  },
  {
    version: 22,
    name: "security_rate_limits_and_webhook_state",
    up: async (db) => {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS rate_limits (
          rate_key TEXT PRIMARY KEY,
          request_count INTEGER NOT NULL,
          reset_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);
      await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_rate_limits_reset_at
          ON rate_limits(reset_at)
      `);

      const addWebhookColumn = async (column: string) => {
        try { await db.execute(`ALTER TABLE stripe_webhook_events ADD COLUMN ${column}`); } catch { /* already exists */ }
      };

      await addWebhookColumn("status TEXT NOT NULL DEFAULT 'PROCESSED'");
      await addWebhookColumn("processed_at TEXT");
      await addWebhookColumn("updated_at TEXT NOT NULL DEFAULT ''");
      await addWebhookColumn("last_error TEXT NOT NULL DEFAULT ''");
      await db.execute("UPDATE stripe_webhook_events SET updated_at = created_at WHERE updated_at = ''");
      await db.execute("UPDATE stripe_webhook_events SET processed_at = created_at WHERE processed_at IS NULL AND status = 'PROCESSED'");
      await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_status
          ON stripe_webhook_events(status, updated_at)
      `);
    },
  },
  {
    version: 23,
    name: "unique_open_checkout_orders",
    up: async (db) => {
      const now = new Date().toISOString();

      // Existing duplicate open orders are operationally stale. Keep the newest
      // open order per user/item and cancel older open duplicates before adding
      // the uniqueness guard used by checkout creation.
      await db.execute(
        `UPDATE orders
         SET status = 'CANCELED', updated_at = ?
         WHERE status IN ('PENDING', 'CHECKOUT_CREATED')
           AND order_item_type = 'PROFILE_BUILD'
           AND id NOT IN (
             SELECT MAX(id)
             FROM orders
             WHERE status IN ('PENDING', 'CHECKOUT_CREATED')
               AND order_item_type = 'PROFILE_BUILD'
             GROUP BY user_id, profile_build_id, order_item_type
           )`,
        [now],
      );

      await db.execute(
        `UPDATE orders
         SET status = 'CANCELED', updated_at = ?
         WHERE status IN ('PENDING', 'CHECKOUT_CREATED')
           AND order_item_type <> 'PROFILE_BUILD'
           AND id NOT IN (
             SELECT MAX(id)
             FROM orders
             WHERE status IN ('PENDING', 'CHECKOUT_CREATED')
               AND order_item_type <> 'PROFILE_BUILD'
             GROUP BY user_id, order_item_type, order_item_id
           )`,
        [now],
      );

      await db.execute(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_one_open_profile_checkout
          ON orders(user_id, profile_build_id, order_item_type)
          WHERE status IN ('PENDING', 'CHECKOUT_CREATED')
            AND order_item_type = 'PROFILE_BUILD'
      `);
      await db.execute(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_one_open_item_checkout
          ON orders(user_id, order_item_type, order_item_id)
          WHERE status IN ('PENDING', 'CHECKOUT_CREATED')
            AND order_item_type <> 'PROFILE_BUILD'
      `);
      await assertIndexExists(db, "orders", "idx_orders_one_open_profile_checkout");
      await assertIndexExists(db, "orders", "idx_orders_one_open_item_checkout");
    },
  },
  {
    version: 24,
    name: "harden_price_history_day_dedupe",
    up: async (db) => {
      await hardenPriceHistoryDedupe(db);
    },
  },
  {
    version: 25,
    name: "order_fulfillment_markers",
    up: async (db) => {
      const columns = [
        "paid_at TEXT",
        "fulfilled_at TEXT",
        "customer_email_sent_at TEXT",
        "admin_email_sent_at TEXT",
      ];
      for (const column of columns) {
        try {
          await db.execute(`ALTER TABLE orders ADD COLUMN ${column}`);
        } catch { /* already exists */ }
      }
      await db.execute("UPDATE orders SET paid_at = COALESCE(paid_at, updated_at), fulfilled_at = COALESCE(fulfilled_at, updated_at) WHERE status = 'PAID'");
      await db.execute("CREATE INDEX IF NOT EXISTS idx_orders_fulfillment ON orders(status, fulfilled_at)");
    },
  },
  {
    version: 26,
    name: "postgres_late_identity_sequences",
    up: async (db) => {
      await ensurePostgresIdentitySequences(db, [
        "order_price_snapshots",
        "quote_requests",
        "pricing_runs",
        "pricing_run_failures",
      ]);
    },
  },
  {
    version: 27,
    name: "pricing_run_freshness_observability",
    up: async (db) => {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS pricing_runs (
          id ${generatedPrimaryKey(db)},
          started_at TEXT NOT NULL,
          finished_at TEXT,
          status TEXT NOT NULL CHECK(status IN ('RUNNING', 'SUCCESS', 'FAILED', 'PARTIAL')),
          total_items INTEGER NOT NULL DEFAULT 0,
          updated_items INTEGER NOT NULL DEFAULT 0,
          failed_items INTEGER NOT NULL DEFAULT 0,
          notes TEXT NOT NULL DEFAULT ''
        )
      `);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS pricing_run_failures (
          id ${generatedPrimaryKey(db)},
          run_id INTEGER NOT NULL REFERENCES pricing_runs(id),
          category TEXT NOT NULL,
          item_id INTEGER NOT NULL,
          item_name TEXT NOT NULL,
          source TEXT NOT NULL DEFAULT '',
          error_message TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);

      const addColumn = async (column: string) => {
        try {
          await db.execute(`ALTER TABLE pricing_runs ADD COLUMN ${column}`);
        } catch { /* already exists */ }
      };

      await addColumn("items_expected INTEGER NOT NULL DEFAULT 0");
      await addColumn("items_checked INTEGER NOT NULL DEFAULT 0");
      await addColumn("history_rows_inserted INTEGER NOT NULL DEFAULT 0");
      await addColumn("history_rows_updated INTEGER NOT NULL DEFAULT 0");
      await addColumn("stale_count INTEGER NOT NULL DEFAULT 0");
      await addColumn("error_message TEXT NOT NULL DEFAULT ''");
      await addColumn("deployment_id TEXT NOT NULL DEFAULT ''");
      await addColumn("vercel_env TEXT NOT NULL DEFAULT ''");
      await addColumn("git_commit_sha TEXT NOT NULL DEFAULT ''");
      await addColumn("runtime_env TEXT NOT NULL DEFAULT ''");

      await db.execute("UPDATE pricing_runs SET items_expected = total_items WHERE items_expected = 0 AND total_items > 0");
      await db.execute("UPDATE pricing_runs SET items_checked = updated_items + failed_items WHERE items_checked = 0 AND (updated_items + failed_items) > 0");
      await db.execute("UPDATE pricing_runs SET error_message = notes WHERE error_message = '' AND status = 'FAILED'");
      await db.execute("CREATE INDEX IF NOT EXISTS idx_pricing_runs_started_at ON pricing_runs(started_at DESC)");
      await db.execute("CREATE INDEX IF NOT EXISTS idx_pricing_runs_status ON pricing_runs(status, started_at DESC)");
      await db.execute("CREATE INDEX IF NOT EXISTS idx_pricing_run_failures_run_id ON pricing_run_failures(run_id)");
    },
  },
  {
    version: 28,
    name: "paid_order_email_retry_state",
    up: async (db) => {
      const columns = [
        "customer_email_send_attempted_at TEXT",
        "admin_email_send_attempted_at TEXT",
        "customer_email_last_error TEXT NOT NULL DEFAULT ''",
        "admin_email_last_error TEXT NOT NULL DEFAULT ''",
      ];
      for (const column of columns) {
        try {
          await db.execute(`ALTER TABLE orders ADD COLUMN ${column}`);
        } catch { /* already exists */ }
      }
      await db.execute("CREATE INDEX IF NOT EXISTS idx_orders_paid_email_retry ON orders(status, customer_email_sent_at, admin_email_sent_at)");
    },
  },
  {
    version: 29,
    name: "quote_request_operations",
    up: async (db) => {
      const normalizeLegacyStatus = `
        CASE status
          WHEN 'IN_REVIEW' THEN 'CONTACTED'
          WHEN 'CLOSED_WON' THEN 'CLOSED'
          WHEN 'CLOSED_LOST' THEN 'CLOSED'
          WHEN 'CONTACTED' THEN 'CONTACTED'
          ELSE 'NEW'
        END
      `;

      if (db.dialect === "postgres") {
        await db.execute("ALTER TABLE quote_requests DROP CONSTRAINT IF EXISTS quote_requests_status_check");
        try {
          await db.execute("ALTER TABLE quote_requests ADD COLUMN operator_note TEXT NOT NULL DEFAULT ''");
        } catch { /* already exists */ }
        try {
          await db.execute("ALTER TABLE quote_requests ADD COLUMN contacted_at TEXT");
        } catch { /* already exists */ }
        await db.execute(`UPDATE quote_requests SET status = ${normalizeLegacyStatus}`);
        await db.execute(`
          ALTER TABLE quote_requests
          ADD CONSTRAINT quote_requests_status_check
          CHECK(status IN ('NEW', 'CONTACTED', 'WAITING_CUSTOMER', 'QUOTED', 'CLOSED', 'SPAM'))
        `);
      } else {
        await db.execute(`
          CREATE TABLE IF NOT EXISTS quote_requests_v29 (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_email TEXT NOT NULL,
            customer_name TEXT NOT NULL DEFAULT '',
            product_type TEXT NOT NULL,
            product_id INTEGER NOT NULL,
            product_name TEXT NOT NULL,
            message TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL CHECK(status IN ('NEW', 'CONTACTED', 'WAITING_CUSTOMER', 'QUOTED', 'CLOSED', 'SPAM')) DEFAULT 'NEW',
            operator_note TEXT NOT NULL DEFAULT '',
            contacted_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          )
        `);
        await db.execute(`
          INSERT INTO quote_requests_v29 (
            id, customer_email, customer_name, product_type, product_id, product_name,
            message, status, operator_note, contacted_at, created_at, updated_at
          )
          SELECT
            id, customer_email, customer_name, product_type, product_id, product_name,
            message, ${normalizeLegacyStatus}, '', NULL, created_at, updated_at
          FROM quote_requests
        `);
        await db.execute("DROP TABLE quote_requests");
        await db.execute("ALTER TABLE quote_requests_v29 RENAME TO quote_requests");
      }

      await db.execute("CREATE INDEX IF NOT EXISTS idx_quote_requests_status ON quote_requests(status)");
      await db.execute("CREATE INDEX IF NOT EXISTS idx_quote_requests_created_at ON quote_requests(created_at)");
    },
  },
  {
    version: 30,
    name: "admin_pricing_overrides",
    up: async (db) => {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS admin_pricing_overrides (
          id ${generatedPrimaryKey(db)},
          category TEXT NOT NULL,
          item_id INTEGER NOT NULL,
          market_avg_eur REAL NOT NULL,
          source_note TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          created_by TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(category, item_id)
        )
      `);
      await db.execute("CREATE INDEX IF NOT EXISTS idx_admin_pricing_overrides_lookup ON admin_pricing_overrides(category, item_id, expires_at)");
      await db.execute("CREATE INDEX IF NOT EXISTS idx_admin_pricing_overrides_expires_at ON admin_pricing_overrides(expires_at)");
    },
  },
  {
    version: 31,
    name: "runtime_locks",
    up: async (db) => {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS runtime_locks (
          lock_key TEXT PRIMARY KEY,
          locked_at TEXT NOT NULL,
          expires_at TEXT NOT NULL
        )
      `);
      await db.execute("CREATE INDEX IF NOT EXISTS idx_runtime_locks_expires_at ON runtime_locks(expires_at)");
    },
  },
  {
    version: 32,
    name: "payment_confirmation_marker",
    up: async (db) => {
      try {
        await db.execute("ALTER TABLE orders ADD COLUMN payment_confirmed_at TEXT");
      } catch { /* already exists */ }
      await db.execute(
        "UPDATE orders SET payment_confirmed_at = COALESCE(payment_confirmed_at, paid_at) WHERE status = 'PAID' AND paid_at IS NOT NULL",
      );
      await db.execute(
        "UPDATE orders SET fulfilled_at = NULL WHERE payment_confirmed_at IS NOT NULL",
      );
      await db.execute("CREATE INDEX IF NOT EXISTS idx_orders_payment_confirmed_at ON orders(payment_confirmed_at)");
    },
  },
  {
    version: 33,
    name: "commerce_invariant_guards",
    up: async (db) => {
      await assertCommerceInvariantsSatisfied(db);
      const orderTypeList = sqlLiteralList(ORDER_ITEM_TYPES);
      const quoteTypeList = sqlLiteralList(QUOTE_PRODUCT_TYPES);
      const orderPaymentStateCheckFor = (prefix = "") => `
        (
          (${prefix}status = 'PAID' AND ${prefix}paid_at IS NOT NULL AND ${prefix}payment_confirmed_at IS NOT NULL)
          OR
          (${prefix}status <> 'PAID' AND ${prefix}paid_at IS NULL AND ${prefix}payment_confirmed_at IS NULL AND ${prefix}fulfilled_at IS NULL)
        )
      `;

      if (db.dialect === "postgres") {
        await db.execute("ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_amount_positive_check");
        await db.execute("ALTER TABLE orders ADD CONSTRAINT orders_amount_positive_check CHECK(amount_eur_cents > 0)");
        await db.execute("ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_currency_eur_check");
        await db.execute("ALTER TABLE orders ADD CONSTRAINT orders_currency_eur_check CHECK(currency = 'eur')");
        await db.execute("ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_item_type_check");
        await db.execute(`ALTER TABLE orders ADD CONSTRAINT orders_item_type_check CHECK(order_item_type IN (${orderTypeList}))`);
        await db.execute("ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_state_check");
        await db.execute(`ALTER TABLE orders ADD CONSTRAINT orders_payment_state_check CHECK(${orderPaymentStateCheckFor()})`);
        await db.execute("ALTER TABLE quote_requests DROP CONSTRAINT IF EXISTS quote_requests_product_type_check");
        await db.execute(`ALTER TABLE quote_requests ADD CONSTRAINT quote_requests_product_type_check CHECK(product_type IN (${quoteTypeList}))`);
      } else {
        await db.execute(`DROP TRIGGER IF EXISTS trg_orders_commerce_invariants_insert`);
        await db.execute(`DROP TRIGGER IF EXISTS trg_orders_commerce_invariants_update`);
        await db.execute(`DROP TRIGGER IF EXISTS trg_quote_requests_product_type_insert`);
        await db.execute(`DROP TRIGGER IF EXISTS trg_quote_requests_product_type_update`);
        await db.execute(`
          CREATE TRIGGER trg_orders_commerce_invariants_insert
          BEFORE INSERT ON orders
          BEGIN
            SELECT CASE WHEN NEW.amount_eur_cents <= 0 THEN RAISE(ABORT, 'orders.amount_eur_cents must be positive') END;
            SELECT CASE WHEN NEW.currency <> 'eur' THEN RAISE(ABORT, 'orders.currency must be eur') END;
            SELECT CASE WHEN NEW.order_item_type NOT IN (${orderTypeList}) THEN RAISE(ABORT, 'orders.order_item_type is invalid') END;
            SELECT CASE WHEN NOT ${orderPaymentStateCheckFor("NEW.")} THEN RAISE(ABORT, 'orders payment state invariant failed') END;
          END
        `);
        await db.execute(`
          CREATE TRIGGER trg_orders_commerce_invariants_update
          BEFORE UPDATE ON orders
          BEGIN
            SELECT CASE WHEN NEW.amount_eur_cents <= 0 THEN RAISE(ABORT, 'orders.amount_eur_cents must be positive') END;
            SELECT CASE WHEN NEW.currency <> 'eur' THEN RAISE(ABORT, 'orders.currency must be eur') END;
            SELECT CASE WHEN NEW.order_item_type NOT IN (${orderTypeList}) THEN RAISE(ABORT, 'orders.order_item_type is invalid') END;
            SELECT CASE WHEN NOT ${orderPaymentStateCheckFor("NEW.")} THEN RAISE(ABORT, 'orders payment state invariant failed') END;
          END
        `);
        await db.execute(`
          CREATE TRIGGER trg_quote_requests_product_type_insert
          BEFORE INSERT ON quote_requests
          BEGIN
            SELECT CASE WHEN NEW.product_type NOT IN (${quoteTypeList}) THEN RAISE(ABORT, 'quote_requests.product_type is invalid') END;
          END
        `);
        await db.execute(`
          CREATE TRIGGER trg_quote_requests_product_type_update
          BEFORE UPDATE ON quote_requests
          BEGIN
            SELECT CASE WHEN NEW.product_type NOT IN (${quoteTypeList}) THEN RAISE(ABORT, 'quote_requests.product_type is invalid') END;
          END
        `);
      }

      await db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_order_price_snapshots_order_slot_unique ON order_price_snapshots(order_id, slot_key)");
      await assertIndexExists(db, "order_price_snapshots", "idx_order_price_snapshots_order_slot_unique");
    },
  },
  {
    version: 34,
    name: "admin_fulfillment_actions",
    up: async (db) => {
      for (const column of ["paid_at TEXT", "payment_confirmed_at TEXT", "fulfilled_at TEXT"]) {
        try {
          await db.execute(`ALTER TABLE orders ADD COLUMN ${column}`);
        } catch { /* already exists */ }
      }
      await db.execute(
        "UPDATE orders SET payment_confirmed_at = COALESCE(payment_confirmed_at, paid_at) WHERE status = 'PAID' AND paid_at IS NOT NULL",
      );
      try {
        await db.execute("ALTER TABLE orders ADD COLUMN fulfilled_by_user_id INTEGER REFERENCES users(id)");
      } catch { /* already exists */ }
      await db.execute(`
        CREATE TABLE IF NOT EXISTS admin_order_actions (
          id ${generatedPrimaryKey(db)},
          order_id INTEGER REFERENCES orders(id),
          action TEXT NOT NULL CHECK(action IN ('stripe_reconcile', 'mark_fulfilled')),
          actor_user_id INTEGER REFERENCES users(id),
          result TEXT NOT NULL,
          message TEXT NOT NULL DEFAULT '',
          stripe_request_id TEXT,
          created_at TEXT NOT NULL
        )
      `);
      await db.execute("CREATE INDEX IF NOT EXISTS idx_orders_fulfillment_queue ON orders(status, payment_confirmed_at, fulfilled_at)");
      await db.execute("CREATE INDEX IF NOT EXISTS idx_admin_order_actions_created_at ON admin_order_actions(created_at DESC)");
      await db.execute("CREATE INDEX IF NOT EXISTS idx_admin_order_actions_order_id ON admin_order_actions(order_id)");
    },
  },
];

export async function hardenPriceHistoryDedupe(db: DbAdapter): Promise<void> {
  try {
    await db.execute("ALTER TABLE price_history ADD COLUMN recorded_date TEXT");
  } catch { /* already exists */ }
  await db.execute("UPDATE price_history SET recorded_date = SUBSTR(recorded_at, 1, 10) WHERE recorded_date IS NULL");
  // Existing duplicate history rows from earlier deployments must be removed before
  // the unique index is created because insertPriceHistory relies on conflict updates.
  await dedupePriceHistoryRows(db);
  await db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_price_history_day_dedupe ON price_history(category, item_id, recorded_date)");
  await assertIndexExists(db, "price_history", "idx_price_history_day_dedupe");
}

async function dedupePriceHistoryRows(db: DbAdapter): Promise<void> {
  await db.execute(`
    DELETE FROM price_history
    WHERE id IN (
      SELECT id
      FROM (
        SELECT
          id,
          ROW_NUMBER() OVER (
            PARTITION BY category, item_id, recorded_date
            ORDER BY
              CASE WHEN source LIKE '%match=%' THEN 0 ELSE 1 END,
              CASE WHEN price_eur > 0 THEN 0 ELSE 1 END,
              recorded_at DESC,
              id DESC
          ) AS row_rank
        FROM price_history
        WHERE recorded_date IS NOT NULL
      ) ranked
      WHERE row_rank > 1
    )
  `);
}

async function assertIndexExists(db: DbAdapter, table: string, indexName: string): Promise<void> {
  const row = db.dialect === "postgres"
    ? await db.queryOne<{ found: number }>(
        "SELECT 1 AS found FROM pg_indexes WHERE tablename = ? AND indexname = ? LIMIT 1",
        [table, indexName],
      )
    : await db.queryOne<{ found: number }>(
        "SELECT 1 AS found FROM sqlite_master WHERE type = 'index' AND name = ? LIMIT 1",
        [indexName],
      );

  if (!row) {
    throw new Error(`Required index ${indexName} was not created.`);
  }
}

async function ensureMigrationsTable(db: DbAdapter): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
}

export async function runMigrations(): Promise<void> {
  const db = getAdapter();
  await ensureMigrationsTable(db);

  const applied = await db.queryAll<{ version: number }>(
    "SELECT version FROM schema_migrations ORDER BY version ASC",
  );
  const appliedVersions = new Set(applied.map((r) => r.version));

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) continue;
    try {
      await migration.up(db);
      if (db.dialect === "postgres") {
        await db.execute(
          "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?) ON CONFLICT (version) DO NOTHING",
          [migration.version, migration.name, new Date().toISOString()],
        );
      } else {
        await db.execute(
          "INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
          [migration.version, migration.name, new Date().toISOString()],
        );
      }
      appliedVersions.add(migration.version);
    } catch (error) {
      console.error(`Migration v${migration.version} (${migration.name}) failed:`, error);
      throw error;
    }
  }
}
