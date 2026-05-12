import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Stripe from "stripe";

type DbModule = typeof import("../src/lib/db");
type CompatibilityModule = typeof import("../src/lib/server/compatibility-checker");

let dataDir = "";
let db: DbModule;
let compatibility: CompatibilityModule;

async function createTestUser(emailPrefix: string): Promise<number> {
  const now = new Date().toISOString();
  const email = `${emailPrefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  await db.getAdapter().execute(
    "INSERT INTO users (email, password_hash, role, created_at) VALUES (?, ?, 'USER', ?)",
    [email, "test-password-hash", now],
  );
  const row = await db.getAdapter().queryOne<{ id: number }>("SELECT id FROM users WHERE email = ? LIMIT 1", [email]);
  assert.ok(row);
  return row.id;
}

async function createAuthenticatedSessionCookie(emailPrefix: string): Promise<string> {
  const email = `${emailPrefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const password = "CorrectHorseBatteryStaple123!";
  const registered = await db.registerAccount({ email, password });
  assert.equal(registered.ok, true);
  const session = await db.createSessionForCredentials({ email, password });
  assert.equal(session.ok, true);
  if (!session.ok) throw new Error("session should be created");
  const { SESSION_COOKIE_NAME } = await import("../src/lib/auth-session");
  return `${SESSION_COOKIE_NAME}=${session.token}`;
}

async function firstScheduledCriticalPricingItem() {
  const criticalItems = await db.listHealthCriticalPriceTrackableItems();
  return [...criticalItems].sort((a, b) => a.category.localeCompare(b.category) || a.itemId - b.itemId)[0];
}

async function seedHealthyPricingFreshness(): Promise<void> {
  const adapter = db.getAdapter();

  await adapter.execute("DELETE FROM price_history");
  await adapter.execute("DELETE FROM estonian_price_checks");
  await adapter.execute("DELETE FROM admin_pricing_overrides");
  await adapter.execute("DELETE FROM pricing_run_failures");
  await adapter.execute("DELETE FROM pricing_runs");

  const trackableItems = await db.listPriceTrackableCatalogItems();
  for (const item of trackableItems) {
    const price = Math.max(1, Number(item.basePriceEur));
    const marketAvg = Number(price.toFixed(2));
    await db.upsertEstonianPriceCheck({
      category: item.category,
      itemId: item.itemId,
      itemName: item.name,
      basePriceEur: price,
      marketAvgEur: marketAvg,
      assemblyMarkupPct: 15,
      finalPriceEur: Number((marketAvg * 1.15).toFixed(2)),
      sampleCount: 2,
      sources: `Monitor Test €${marketAvg.toFixed(2)} match=2/2`,
    });
    await db.insertPriceHistory(item.category, item.itemId, marketAvg, `Monitor Test €${marketAvg.toFixed(2)} match=2/2`);
  }

  const startedAt = new Date(Date.now() - 60_000).toISOString();
  const finishedAt = new Date().toISOString();
  const runId = await db.beginPricingRun(trackableItems.length, startedAt);
  await db.finishPricingRun({
    runId,
    status: "SUCCESS",
    finishedAt,
    totalItems: trackableItems.length,
    checkedItems: trackableItems.length,
    updatedItems: trackableItems.length,
    failedItems: 0,
    historyRowsInserted: trackableItems.length,
    historyRowsUpdated: 0,
    staleCount: 0,
    notes: "Monitor test healthy run.",
  });
}

async function clearOpsHealthNoise(): Promise<void> {
  const now = new Date().toISOString();
  const adapter = db.getAdapter();
  await adapter.execute(
    `UPDATE orders
     SET customer_email_sent_at = COALESCE(customer_email_sent_at, ?),
         admin_email_sent_at = COALESCE(admin_email_sent_at, ?)
     WHERE status = 'PAID'`,
    [now, now],
  );
  await adapter.execute(
    "UPDATE orders SET created_at = ?, updated_at = ? WHERE status IN ('PENDING', 'CHECKOUT_CREATED')",
    [now, now],
  );
  await adapter.execute("DELETE FROM stripe_webhook_events WHERE status IN ('FAILED', 'PROCESSING')");
}

function setPreviewCheckoutEnv(): () => void {
  const oldAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  const oldStripeKey = process.env.STRIPE_SECRET_KEY;
  const oldPublicStripeKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  const oldStripePublishableKey = process.env.STRIPE_PUBLISHABLE_KEY;
  const oldVercelEnv = process.env.VERCEL_ENV;

  process.env.NEXT_PUBLIC_APP_URL = "https://example.test";
  process.env.STRIPE_SECRET_KEY = "sk_test_checkout";
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_checkout";
  delete process.env.STRIPE_PUBLISHABLE_KEY;
  process.env.VERCEL_ENV = "preview";

  return () => {
    if (oldAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = oldAppUrl;
    if (oldStripeKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = oldStripeKey;
    if (oldPublicStripeKey === undefined) delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    else process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = oldPublicStripeKey;
    if (oldStripePublishableKey === undefined) delete process.env.STRIPE_PUBLISHABLE_KEY;
    else process.env.STRIPE_PUBLISHABLE_KEY = oldStripePublishableKey;
    if (oldVercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = oldVercelEnv;
  };
}

function setPreviewWebhookEnv(): () => void {
  const restoreCheckout = setPreviewCheckoutEnv();
  const oldWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_webhook";

  return () => {
    if (oldWebhookSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = oldWebhookSecret;
    restoreCheckout();
  };
}

async function orderCountForItem(itemType: string, itemId: number): Promise<number> {
  const row = await db.getAdapter().queryOne<{ cnt: number }>(
    "SELECT COUNT(*) AS cnt FROM orders WHERE order_item_type = ? AND order_item_id = ?",
    [itemType, itemId],
  );
  return row?.cnt ?? 0;
}

async function insertCheckoutCreatedOrder({
  userId,
  checkoutSessionId,
  status = "CHECKOUT_CREATED",
  itemType = "GPU",
  itemId = 1,
  createdAt,
}: {
  userId: number;
  checkoutSessionId: string;
  status?: "CHECKOUT_CREATED" | "PAID";
  itemType?: string;
  itemId?: number;
  createdAt?: string;
}): Promise<number> {
  const now = createdAt ?? new Date().toISOString();
  await db.getAdapter().execute(
    `INSERT INTO orders (
      user_id, profile_build_id, order_item_type, order_item_id, build_name,
      amount_eur_cents, currency, status, stripe_checkout_session_id, created_at, updated_at
    ) VALUES (?, 0, ?, ?, 'Email Test GPU', 123400, 'eur', ?, ?, ?, ?)`,
    [userId, itemType, itemId, status, checkoutSessionId, now, now],
  );
  const row = await db.getAdapter().queryOne<{ id: number }>(
    "SELECT id FROM orders WHERE stripe_checkout_session_id = ? LIMIT 1",
    [checkoutSessionId],
  );
  assert.ok(row);
  return row.id;
}

async function insertPendingOrderWithoutCheckoutSession({
  userId,
  itemType = "GPU",
  itemId = 1,
}: {
  userId: number;
  itemType?: string;
  itemId?: number;
}): Promise<number> {
  const now = new Date().toISOString();
  await db.getAdapter().execute(
    `INSERT INTO orders (
      user_id, profile_build_id, order_item_type, order_item_id, build_name,
      amount_eur_cents, currency, status, stripe_checkout_session_id, created_at, updated_at
    ) VALUES (?, 0, ?, ?, 'Orphan Recovery GPU', 123400, 'eur', 'PENDING', NULL, ?, ?)`,
    [userId, itemType, itemId, now, now],
  );
  const row = await db.getAdapter().queryOne<{ id: number }>(
    "SELECT id FROM orders WHERE user_id = ? AND order_item_type = ? AND order_item_id = ? AND stripe_checkout_session_id IS NULL ORDER BY id DESC LIMIT 1",
    [userId, itemType, itemId],
  );
  assert.ok(row);
  return row.id;
}

function signedStripeWebhookRequest(event: Record<string, unknown>, secret = "whsec_test_webhook"): Request {
  const payload = JSON.stringify(event);
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret });
  return new Request("https://example.test/api/payments/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": signature,
      "x-forwarded-for": "127.0.0.1",
    },
    body: payload,
  });
}

function checkoutSessionEvent({
  eventId,
  type = "checkout.session.completed",
  orderId,
  userId,
  checkoutSessionId,
  amountTotal = 123400,
  currency = "eur",
  paymentStatus = "paid",
  mode = "payment",
  itemType = "GPU",
  itemId = 1,
}: {
  eventId: string;
  type?: string;
  orderId: number;
  userId: number;
  checkoutSessionId: string;
  amountTotal?: number;
  currency?: string;
  paymentStatus?: string;
  mode?: string;
  itemType?: string;
  itemId?: number;
}) {
  return {
    id: eventId,
    object: "event",
    type,
    data: {
      object: {
        id: checkoutSessionId,
        object: "checkout.session",
        amount_total: amountTotal,
        currency,
        mode,
        payment_status: paymentStatus,
        status: type === "checkout.session.expired" ? "expired" : "complete",
        payment_intent: `pi_${eventId}`,
        metadata: {
          order_id: String(orderId),
          user_id: String(userId),
          order_item_type: itemType,
          order_item_id: String(itemId),
        },
      },
    },
  };
}

async function withMockedPaymentEmailEnv<T>(
  handler: (sent: Array<{ to?: string; subject?: string }>) => Promise<T>,
  sendMail?: (mail: { to?: string; subject?: string }) => Promise<unknown>,
): Promise<T> {
  const nodemailerModule = await import("nodemailer");
  const nodemailer = nodemailerModule.default;
  const originalCreateTransport = nodemailer.createTransport;
  const sent: Array<{ to?: string; subject?: string }> = [];
  const oldEnv = {
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASS: process.env.SMTP_PASS,
    SMTP_FROM_EMAIL: process.env.SMTP_FROM_EMAIL,
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
  };

  (nodemailer as typeof nodemailer & { createTransport: unknown }).createTransport = (() => ({
    sendMail: async (mail: { to?: string; subject?: string }) => {
      sent.push({ to: mail.to, subject: mail.subject });
      return sendMail ? sendMail(mail) : {};
    },
  })) as typeof nodemailer.createTransport;

  process.env.SMTP_HOST = "smtp.example.test";
  process.env.SMTP_PORT = "587";
  process.env.SMTP_USER = "smtp-user";
  process.env.SMTP_PASS = "smtp-pass";
  process.env.SMTP_FROM_EMAIL = "orders@example.test";
  process.env.ADMIN_EMAIL = "admin@example.test";

  try {
    return await handler(sent);
  } finally {
    nodemailer.createTransport = originalCreateTransport;
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function captureConsoleOutput(
  methods: Array<"info" | "warn" | "error">,
  handler: () => Promise<void>,
): Promise<string[]> {
  const consoleRecord = console as unknown as Record<"info" | "warn" | "error", (...data: unknown[]) => void>;
  const originals = new Map<"info" | "warn" | "error", (...data: unknown[]) => void>();
  const lines: string[] = [];

  for (const method of methods) {
    originals.set(method, consoleRecord[method]);
    consoleRecord[method] = (...data: unknown[]) => {
      lines.push(data.map((item) => item instanceof Error ? item.message : String(item)).join(" "));
    };
  }

  try {
    await handler();
  } finally {
    for (const [method, original] of originals) {
      consoleRecord[method] = original;
    }
  }

  return lines;
}

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "fart-picker-test-"));
  process.env.FART_PICKER_DATA_DIR = dataDir;
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;

  const importedDb = (await import("../src/lib/db")) as DbModule & { default?: DbModule };
  db = importedDb.default ?? importedDb;

  const importedCompatibility = (await import("../src/lib/server/compatibility-checker")) as CompatibilityModule & { default?: CompatibilityModule };
  compatibility = importedCompatibility.default ?? importedCompatibility;

  await db.initDb();
});

after(async () => {
  await db?.getAdapter().close();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  delete process.env.FART_PICKER_DATA_DIR;
});

test("insertPriceHistory upserts one row per item per recorded date", async () => {
  await db.insertPriceHistory("gpu", 424242, 100, "TestShop €100 match=3/3");
  await db.insertPriceHistory("gpu", 424242, 125, "TestShop €125 match=3/3");

  const rows = await db.getAdapter().queryAll<{ price_eur: number; source: string }>(
    "SELECT price_eur, source FROM price_history WHERE category = ? AND item_id = ?",
    ["gpu", 424242],
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].price_eur, 125);
  assert.equal(rows[0].source, "TestShop €125 match=3/3");
});

test("insertPriceHistory rejects invalid categories, ids, prices, and untrusted sources", async () => {
  await assert.rejects(
    () => db.insertPriceHistory("invalid", 1, 100, "Retailer €100 match=1/1"),
    /Invalid price history category/,
  );
  await assert.rejects(
    () => db.insertPriceHistory("gpu", 0, 100, "Retailer €100 match=1/1"),
    /Invalid price history item id/,
  );
  await assert.rejects(
    () => db.insertPriceHistory("gpu", 1, 0, "Retailer €100 match=1/1"),
    /Invalid price history price/,
  );
  await assert.rejects(
    () => db.insertPriceHistory("gpu", 1, 100, "Retailer €100"),
    /missing match diagnostics/,
  );
});

test("Estonian market price checks reject bad data and ignore stale trusted-looking rows", async () => {
  await assert.rejects(
    () => db.upsertEstonianPriceCheck({
      category: "gpu",
      itemId: 515151,
      itemName: "Outlier GPU",
      basePriceEur: 100,
      marketAvgEur: 1000,
      assemblyMarkupPct: 15,
      finalPriceEur: 1150,
      sampleCount: 2,
      sources: "Retailer €1000 match=2/2",
    }),
    /outside 0\.55x-2\.2x base price bounds/,
  );

  await assert.rejects(
    () => db.upsertEstonianPriceCheck({
      category: "gpu",
      itemId: 515152,
      itemName: "Bad Markup GPU",
      basePriceEur: 100,
      marketAvgEur: 100,
      assemblyMarkupPct: 15,
      finalPriceEur: 100,
      sampleCount: 2,
      sources: "Retailer €100 match=2/2",
    }),
    /finalPriceEur does not match/,
  );

  await db.upsertEstonianPriceCheck({
    category: "gpu",
    itemId: 515153,
    itemName: "Valid GPU",
    basePriceEur: 100,
    marketAvgEur: 110,
    assemblyMarkupPct: 15,
    finalPriceEur: 126.5,
    sampleCount: 2,
    sources: "Retailer €110 match=2/2",
  });

  const validCheck = await db.getEstonianPriceCheck("gpu", 515153);
  assert.equal(validCheck?.final_price_eur, 126.5);
  assert.equal(validCheck?.market_avg_eur, 110);

  await db.getAdapter().execute(
    "UPDATE estonian_price_checks SET checked_at = ? WHERE category = ? AND item_id = ?",
    ["2000-01-01T00:00:00.000Z", "gpu", 515153],
  );

  assert.equal(await db.getEstonianPriceCheck("gpu", 515153), null);
});

test("backfillPriceHistoryFromChecks is idempotent for existing recorded dates", async () => {
  await db.upsertEstonianPriceCheck({
    category: "cpu",
    itemId: 616161,
    itemName: "Valid CPU",
    basePriceEur: 200,
    marketAvgEur: 220,
    assemblyMarkupPct: 15,
    finalPriceEur: 253,
    sampleCount: 2,
    sources: "Retailer €220 match=2/2",
  });

  const targetDate = new Date().toISOString().slice(0, 10);
  const checkedAt = `${targetDate}T12:00:00.000Z`;
  await db.getAdapter().execute(
    "UPDATE estonian_price_checks SET checked_at = ? WHERE category = ? AND item_id = ?",
    [checkedAt, "cpu", 616161],
  );

  const firstBackfill = await db.backfillPriceHistoryFromChecks({ targetDates: [targetDate] });
  assert.equal(firstBackfill.inserted, 1);
  assert.equal(firstBackfill.updated, 0);
  const secondBackfill = await db.backfillPriceHistoryFromChecks({ targetDates: [targetDate] });
  assert.equal(secondBackfill.inserted, 0);
  assert.equal(secondBackfill.updated, 1);

  const rows = await db.getAdapter().queryAll<{ price_eur: number; recorded_date: string }>(
    "SELECT price_eur, recorded_date FROM price_history WHERE category = ? AND item_id = ?",
    ["cpu", 616161],
  );
  assert.deepEqual(rows.map((row) => ({ price_eur: row.price_eur, recorded_date: row.recorded_date })), [
    { price_eur: 220, recorded_date: targetDate },
  ]);
});

test("price history unique day constraint rejects direct duplicate rows", async () => {
  await db.getAdapter().execute(
    "INSERT INTO price_history (category, item_id, price_eur, recorded_at, recorded_date, source) VALUES (?, ?, ?, ?, ?, ?)",
    ["cpu", 626262, 100, "2026-05-05T08:00:00.000Z", "2026-05-05", "Retailer €100 match=2/2"],
  );

  assert.throws(
    () => db.getAdapter().execute(
      "INSERT INTO price_history (category, item_id, price_eur, recorded_at, recorded_date, source) VALUES (?, ?, ?, ?, ?, ?)",
      ["cpu", 626262, 110, "2026-05-05T09:00:00.000Z", "2026-05-05", "Retailer €110 match=2/2"],
    ),
    /UNIQUE|unique/i,
  );
});

test("pricing category aliases normalize before check and history writes", async () => {
  await db.upsertEstonianPriceCheck({
    category: "mac_systems",
    itemId: 636363,
    itemName: "Alias Mac",
    basePriceEur: 1000,
    marketAvgEur: 1100,
    assemblyMarkupPct: 15,
    finalPriceEur: 1265,
    sampleCount: 2,
    sources: "Retailer €1100 match=2/2",
  });
  await db.insertPriceHistory("mac_systems", 636363, 1100, "Retailer €1100 match=2/2");

  const check = await db.getAdapter().queryOne<{ category: string }>(
    "SELECT category FROM estonian_price_checks WHERE item_id = ? LIMIT 1",
    [636363],
  );
  const history = await db.getAdapter().queryOne<{ category: string }>(
    "SELECT category FROM price_history WHERE item_id = ? LIMIT 1",
    [636363],
  );

  assert.equal(check?.category, "mac_system");
  assert.equal(history?.category, "mac_system");
});

test("seeded profile and Mac eGPU builds have no compatibility issues", async () => {
  const adapter = db.getAdapter();
  const mapTable = async <T extends { id: number }>(table: string) => {
    const rows = await adapter.queryAll<T>(`SELECT * FROM ${table}`);
    return new Map(rows.map((row) => [row.id, row]));
  };

  const maps = {
    cpu: await mapTable("cpus"),
    gpu: await mapTable("gpus"),
    ram: await mapTable("ram_kits"),
    storage: await mapTable("storage_drives"),
    motherboard: await mapTable("motherboards"),
    psu: await mapTable("power_supplies"),
    case: await mapTable("pc_cases"),
    cooler: await mapTable("cpu_coolers"),
    mac: await mapTable("mac_systems"),
    enclosure: await mapTable("external_gpu_enclosures"),
  };

  const profileBuilds = await adapter.queryAll<{
    build_name: string;
    cpu_id: number;
    gpu_id: number;
    ram_kit_id: number | null;
    storage_drive_id: number | null;
    motherboard_id: number | null;
    power_supply_id: number | null;
    case_id: number | null;
    cpu_cooler_id: number | null;
  }>("SELECT build_name, cpu_id, gpu_id, ram_kit_id, storage_drive_id, motherboard_id, power_supply_id, case_id, cpu_cooler_id FROM profile_builds");

  const profileIssues = profileBuilds.flatMap((build) => {
    const warnings = compatibility.checkBuildCompatibility({
      cpu: maps.cpu.get(build.cpu_id) as never,
      gpu: maps.gpu.get(build.gpu_id) as never,
      ram: build.ram_kit_id ? (maps.ram.get(build.ram_kit_id) as never) : null,
      storage: build.storage_drive_id ? (maps.storage.get(build.storage_drive_id) as never) : null,
      motherboard: build.motherboard_id ? (maps.motherboard.get(build.motherboard_id) as never) : null,
      psu: build.power_supply_id ? (maps.psu.get(build.power_supply_id) as never) : null,
      case: build.case_id ? (maps.case.get(build.case_id) as never) : null,
      cooler: build.cpu_cooler_id ? (maps.cooler.get(build.cpu_cooler_id) as never) : null,
    });
    return warnings.map((warning) => `${build.build_name}: ${warning.message}`);
  });

  const macEgpuBuilds = await adapter.queryAll<{
    name: string;
    mac_system_id: number;
    egpu_enclosure_id: number;
    gpu_id: number;
  }>("SELECT name, mac_system_id, egpu_enclosure_id, gpu_id FROM mac_egpu_builds");

  const macEgpuIssues = macEgpuBuilds.flatMap((build) => {
    const warnings = compatibility.checkMacEgpuBuildCompatibility({
      mac: maps.mac.get(build.mac_system_id) as never,
      enclosure: maps.enclosure.get(build.egpu_enclosure_id) as never,
      gpu: maps.gpu.get(build.gpu_id) as never,
    });
    return warnings.map((warning) => `${build.name}: ${warning.message}`);
  });

  assert.equal(profileBuilds.length, 22);
  assert.equal(macEgpuBuilds.length, 5);
  assert.deepEqual(profileIssues, []);
  assert.deepEqual(macEgpuIssues, []);
});

test("compatibility checker catches physical and capacity edge cases", () => {
  const warnings = compatibility.checkBuildCompatibility({
    cpu: { socket: "AM5", memory_type_support: "DDR5", tdp_watts: 120 } as never,
    gpu: { length_mm: 360, tdp_watts: 450, recommended_psu_w: 850, power_connectors: "16-pin 12VHPWR" } as never,
    ram: { ddr_gen: "DDR5", modules: "4x32GB", capacity_gb: 128 } as never,
    motherboard: { socket: "LGA1700", memory_support: "DDR5", memory_slots: 2, max_memory_gb: 96, form_factor: "ATX", m2_slots: 1 } as never,
    psu: { wattage: 650, native_12vhpwr: 0, gpu_connector_count: 2 } as never,
    case: { max_gpu_mm: 320, form_factor: "ATX", max_cpu_cooler_height_mm: 160, radiator_support: "240mm" } as never,
    cooler: { cooler_type: "Air", radiator_or_height_mm: 170, socket_support: "AM5" } as never,
    storage: { interface: "PCIe 4.0 x4" } as never,
  });

  assert.deepEqual(
    warnings.filter((warning) => warning.severity === "error").map((warning) => warning.category).sort(),
    ["cooler_height", "gpu_case_fit", "gpu_psu_requirement", "ram_capacity", "ram_slots", "socket_mismatch"].sort(),
  );
});

test("cron pricing route rejects missing or incorrect bearer tokens", async () => {
  const oldSecret = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  const route = await import("../src/app/api/cron/estonian-pricing/route");

  const missingSecret = await route.GET(new Request("https://example.test/api/cron/estonian-pricing"));
  assert.equal(missingSecret.status, 401);
  assert.deepEqual(await missingSecret.json(), { message: "Unauthorized" });

  process.env.CRON_SECRET = "correct-secret";
  assert.equal(route.isPricingCronAuthorized(new Request("https://example.test/api/cron/estonian-pricing", {
    headers: { authorization: "Bearer correct-secret" },
  })), true);

  const wrongSecret = await route.GET(new Request("https://example.test/api/cron/estonian-pricing", {
    headers: { authorization: "Bearer wrong-secret" },
  }));
  assert.equal(wrongSecret.status, 401);
  assert.deepEqual(await wrongSecret.json(), { message: "Unauthorized" });

  if (oldSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = oldSecret;
});

test("database advisory lock prevents overlapping cron-style work", async () => {
  const lockKey = 900_000 + Math.floor(Math.random() * 1000);
  const first = await db.getAdapter().tryWithAdvisoryLock(lockKey, async () => {
    const nested = await db.getAdapter().tryWithAdvisoryLock(lockKey, async () => "nested");
    assert.equal(nested.acquired, false);
    return "outer";
  });
  assert.equal(first.acquired, true);
  if (first.acquired) assert.equal(first.result, "outer");

  const second = await db.getAdapter().tryWithAdvisoryLock(lockKey, async () => "released");
  assert.equal(second.acquired, true);
  if (second.acquired) assert.equal(second.result, "released");
});

test("cron pricing response reports zero-update runs as degraded", async () => {
  const route = await import("../src/app/api/cron/estonian-pricing/route");
  const summary = {
    status: "PARTIAL" as const,
    trackableItems: 12,
    healthCriticalItems: 4,
    backgroundTrackableItems: 8,
    processedItems: 12,
    processingLimit: 12,
    expectedVsProcessedMismatchWarning: null,
    checked: 12,
    updated: 0,
    skipped: 12,
    skippedByReason: { no_trusted_retailer_quote: 12 },
    skippedItems: [{
      category: "gpu",
      itemId: 1,
      name: "Fixture GPU",
      query: "Fixture GPU",
      reason: "no_trusted_retailer_quote",
      sourceReasonCounts: { no_price_matches: 9 },
    }],
    failed: 0,
    historyRowsInserted: 0,
    historyRowsUpdated: 0,
    staleCount: 12,
    backgroundStaleCount: 8,
    failedItems: [],
    lowSampleItems: [],
    adminOverrideItems: [],
    startedAt: "2026-05-09T00:00:00.000Z",
    finishedAt: "2026-05-09T00:01:00.000Z",
  };

  const body = route.pricingCronResponseBody(summary);
  assert.equal(body.ok, false);
  assert.equal(body.status, "partial");
  assert.equal(route.pricingCronHttpStatus(summary), 503);
  assert.ok(body.degradedReasons.includes("no_trusted_rows_written"));
  assert.ok(body.degradedReasons.includes("no_history_rows_written"));
  assert.deepEqual(body.skippedByReason, { no_trusted_retailer_quote: 12 });
  assert.equal(body.sampleSkippedItems[0]?.query, "Fixture GPU");
});

test("partial pricing refresh records DB failure details and preserves existing history", async () => {
  const gpu = await db.getGpuById(1);
  assert.ok(gpu);
  await db.insertPriceHistory("gpu", gpu.id, gpu.price_eur, `Retailer €${gpu.price_eur} match=2/2`);

  const { refreshEstonianMarketPricing } = await import("../src/lib/server/estonian-pricing-service");
  const summary = await refreshEstonianMarketPricing({
    maxItems: 1,
    concurrency: 1,
    fetchPrice: async () => null,
  });
  const trackableItems = await db.listPriceTrackableCatalogItems();

  assert.equal(summary.checked, 1);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.status, "PARTIAL");
  assert.ok(summary.staleCount >= 1);
  assert.equal(summary.trackableItems, trackableItems.length);
  assert.equal(summary.processedItems, 1);
  assert.match(summary.expectedVsProcessedMismatchWarning ?? "", /processed 1 of \d+ trackable/);

  const latestRun = await db.getAdapter().queryOne<{ status: string; total_items: number; items_expected: number; items_checked: number; stale_count: number }>(
    "SELECT status, total_items, items_expected, items_checked, stale_count FROM pricing_runs ORDER BY id DESC LIMIT 1",
  );
  assert.equal(latestRun?.status, "PARTIAL");
  assert.equal(latestRun?.total_items, trackableItems.length);
  assert.equal(latestRun?.items_expected, trackableItems.length);
  assert.equal(latestRun?.items_checked, 1);
  assert.ok((latestRun?.stale_count ?? 0) >= 1);

  const failure = await db.getAdapter().queryOne<{ error_message: string }>(
    "SELECT error_message FROM pricing_run_failures ORDER BY id DESC LIMIT 1",
  );
  assert.match(failure?.error_message ?? "", /no_trusted_retailer_quote/);

  const preserved = await db.getAdapter().queryOne<{ cnt: number }>(
    "SELECT COUNT(*) AS cnt FROM price_history WHERE category = 'gpu' AND item_id = ? AND source LIKE '%match=%'",
    [gpu.id],
  );
  assert.ok((preserved?.cnt ?? 0) > 0);
});

test("pricing refresh writes market average to history and markup-inclusive final price to checks", async () => {
  await db.getAdapter().execute("DELETE FROM price_history");
  await db.getAdapter().execute("DELETE FROM estonian_price_checks");
  await db.getAdapter().execute("DELETE FROM admin_pricing_overrides");
  await db.getAdapter().execute("DELETE FROM pricing_run_failures");
  await db.getAdapter().execute("DELETE FROM pricing_runs");

  const target = await firstScheduledCriticalPricingItem();
  assert.ok(target);

  const { refreshEstonianMarketPricing } = await import("../src/lib/server/estonian-pricing-service");
  let selectedQuery = "";
  const summary = await refreshEstonianMarketPricing({
    maxItems: 1,
    concurrency: 1,
    fetchPrice: async (query, basePrice) => {
      selectedQuery = query;
      const price = Number((basePrice * 1.1).toFixed(2));
      return {
        price,
        sampleCount: 2,
        sources: `Retailer €${price.toFixed(2)} match=2/2`,
      };
    },
  });

  assert.equal(summary.updated, 1);
  const selected = (await db.listHealthCriticalPriceTrackableItems()).find((item) => item.name === selectedQuery);
  assert.ok(selected);
  const selectedMarketAvg = Number((selected.basePriceEur * 1.1).toFixed(2));
  const selectedExpectedFinal = Number((selectedMarketAvg * 1.15).toFixed(2));

  const check = await db.getAdapter().queryOne<{ market_avg_eur: number; final_price_eur: number }>(
    "SELECT market_avg_eur, final_price_eur FROM estonian_price_checks WHERE category = ? AND item_id = ?",
    [selected.category, selected.itemId],
  );
  assert.equal(check?.market_avg_eur, selectedMarketAvg);
  assert.equal(check?.final_price_eur, selectedExpectedFinal);

  const history = await db.getAdapter().queryOne<{ price_eur: number }>(
    "SELECT price_eur FROM price_history WHERE category = ? AND item_id = ? ORDER BY recorded_at DESC LIMIT 1",
    [selected.category, selected.itemId],
  );
  assert.equal(history?.price_eur, selectedMarketAvg);
  assert.notEqual(history?.price_eur, selectedExpectedFinal);
});

test("admin pricing override rescues a critical item only after retailer lookup fails", async () => {
  await db.getAdapter().execute("DELETE FROM price_history");
  await db.getAdapter().execute("DELETE FROM estonian_price_checks");
  await db.getAdapter().execute("DELETE FROM admin_pricing_overrides");
  await db.getAdapter().execute("DELETE FROM pricing_run_failures");
  await db.getAdapter().execute("DELETE FROM pricing_runs");

  const target = await firstScheduledCriticalPricingItem();
  assert.ok(target);
  const overridePrice = Number((target.basePriceEur * 1.1).toFixed(2));
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const saved = await db.upsertAdminPricingOverride({
    category: target.category,
    itemId: target.itemId,
    marketAvgEur: overridePrice,
    sourceNote: "Manual supplier quote checked by admin",
    expiresAt,
    createdBy: "test_admin",
  });
  assert.equal(saved.ok, true);

  const { refreshEstonianMarketPricing } = await import("../src/lib/server/estonian-pricing-service");
  const summary = await refreshEstonianMarketPricing({
    maxItems: 1,
    concurrency: 1,
    fetchPrice: async () => null,
  });

  assert.equal(summary.updated, 1);
  assert.equal(summary.skipped, 0);
  assert.equal(summary.adminOverrideItems.length, 1);
  assert.equal(summary.adminOverrideItems[0]?.itemId, target.itemId);

  const check = await db.getAdapter().queryOne<{ market_avg_eur: number; sources: string }>(
    "SELECT market_avg_eur, sources FROM estonian_price_checks WHERE category = ? AND item_id = ? LIMIT 1",
    [target.category, target.itemId],
  );
  assert.equal(check?.market_avg_eur, overridePrice);
  assert.match(check?.sources ?? "", /admin_override/);
  assert.match(check?.sources ?? "", /not_retailer_derived/);
  assert.match(check?.sources ?? "", /match=admin-reviewed/);

  const report = await db.getPricingFreshnessReport();
  assert.equal(report.criticalMissingToday.some((item) => item.category === target.category && item.itemId === target.itemId), false);
});

test("expired admin pricing override is ignored", async () => {
  await db.getAdapter().execute("DELETE FROM price_history");
  await db.getAdapter().execute("DELETE FROM estonian_price_checks");
  await db.getAdapter().execute("DELETE FROM admin_pricing_overrides");
  await db.getAdapter().execute("DELETE FROM pricing_run_failures");
  await db.getAdapter().execute("DELETE FROM pricing_runs");

  const target = await firstScheduledCriticalPricingItem();
  assert.ok(target);
  const now = new Date().toISOString();
  await db.getAdapter().execute(
    `INSERT INTO admin_pricing_overrides (
      category, item_id, market_avg_eur, source_note, expires_at, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      target.category,
      target.itemId,
      Number((target.basePriceEur * 1.1).toFixed(2)),
      "Expired manual quote",
      "2000-01-01T00:00:00.000Z",
      "test_admin",
      now,
      now,
    ],
  );

  const { refreshEstonianMarketPricing } = await import("../src/lib/server/estonian-pricing-service");
  const summary = await refreshEstonianMarketPricing({
    maxItems: 1,
    concurrency: 1,
    fetchPrice: async () => null,
  });

  assert.equal(summary.updated, 0);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.adminOverrideItems.length, 0);
  const check = await db.getAdapter().queryOne<{ cnt: number }>(
    "SELECT COUNT(*) AS cnt FROM estonian_price_checks WHERE category = ? AND item_id = ?",
    [target.category, target.itemId],
  );
  assert.equal(check?.cnt, 0);
});

test("retailer quote wins over admin pricing override", async () => {
  await db.getAdapter().execute("DELETE FROM price_history");
  await db.getAdapter().execute("DELETE FROM estonian_price_checks");
  await db.getAdapter().execute("DELETE FROM admin_pricing_overrides");
  await db.getAdapter().execute("DELETE FROM pricing_run_failures");
  await db.getAdapter().execute("DELETE FROM pricing_runs");

  const target = await firstScheduledCriticalPricingItem();
  assert.ok(target);
  const overridePrice = Number((target.basePriceEur * 1.4).toFixed(2));
  const retailerPrice = Number((target.basePriceEur * 1.1).toFixed(2));
  const saved = await db.upsertAdminPricingOverride({
    category: target.category,
    itemId: target.itemId,
    marketAvgEur: overridePrice,
    sourceNote: "Manual supplier quote checked by admin",
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    createdBy: "test_admin",
  });
  assert.equal(saved.ok, true);

  const { refreshEstonianMarketPricing } = await import("../src/lib/server/estonian-pricing-service");
  const summary = await refreshEstonianMarketPricing({
    maxItems: 1,
    concurrency: 1,
    fetchPrice: async () => ({
      price: retailerPrice,
      sampleCount: 2,
      sources: `Retailer €${retailerPrice.toFixed(2)} match=2/2`,
    }),
  });

  assert.equal(summary.updated, 1);
  assert.equal(summary.adminOverrideItems.length, 0);
  const check = await db.getAdapter().queryOne<{ market_avg_eur: number; sources: string }>(
    "SELECT market_avg_eur, sources FROM estonian_price_checks WHERE category = ? AND item_id = ? LIMIT 1",
    [target.category, target.itemId],
  );
  assert.equal(check?.market_avg_eur, retailerPrice);
  assert.doesNotMatch(check?.sources ?? "", /admin_override/);
});

test("admin pricing override source appears in diagnostics", async () => {
  await db.getAdapter().execute("DELETE FROM price_history");
  await db.getAdapter().execute("DELETE FROM estonian_price_checks");
  await db.getAdapter().execute("DELETE FROM admin_pricing_overrides");
  await db.getAdapter().execute("DELETE FROM pricing_run_failures");
  await db.getAdapter().execute("DELETE FROM pricing_runs");

  const target = await firstScheduledCriticalPricingItem();
  assert.ok(target);
  const overridePrice = Number((target.basePriceEur * 1.1).toFixed(2));
  const saved = await db.upsertAdminPricingOverride({
    category: target.category,
    itemId: target.itemId,
    marketAvgEur: overridePrice,
    sourceNote: "Manual supplier quote checked by admin",
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    createdBy: "test_admin",
  });
  assert.equal(saved.ok, true);

  const { refreshEstonianMarketPricing } = await import("../src/lib/server/estonian-pricing-service");
  await refreshEstonianMarketPricing({
    maxItems: 1,
    concurrency: 1,
    fetchPrice: async () => null,
  });

  const { getAdminOpsDiagnostics } = await import("../src/lib/server/ops-diagnostics");
  const diagnostics = await getAdminOpsDiagnostics();
  const pricing = diagnostics.pricing as {
    adminOverrides?: Array<{ category: string; item_id: number; source_note: string }>;
    adminOverrideBackedChecks?: Array<{ category: string; item_id: number; override_source: string }>;
  };
  assert.ok(pricing.adminOverrides?.some((override) => (
    override.category === target.category
      && override.item_id === target.itemId
      && override.source_note.includes("Manual supplier quote")
  )));
  assert.ok(pricing.adminOverrideBackedChecks?.some((check) => (
    check.category === target.category
      && check.item_id === target.itemId
      && check.override_source.includes("admin_override")
      && check.override_source.includes("not_retailer_derived")
  )));
});

test("admin pricing override API has no public write access and enforces expiry", async () => {
  const route = await import("../src/app/api/admin/pricing-overrides/route");
  const target = (await db.listHealthCriticalPriceTrackableItems())[0];
  assert.ok(target);

  const unauthenticated = await route.POST(new Request("https://example.test/api/admin/pricing-overrides", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      category: target.category,
      itemId: target.itemId,
      marketAvgEur: target.basePriceEur,
      sourceNote: "Manual supplier quote checked by admin",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    }),
  }));
  assert.equal(unauthenticated.status, 401);

  const oldToken = process.env.ADMIN_API_TOKEN;
  try {
    process.env.ADMIN_API_TOKEN = "pricing-override-token";
    const tooLong = await route.POST(new Request("https://example.test/api/admin/pricing-overrides", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer pricing-override-token",
      },
      body: JSON.stringify({
        category: target.category,
        itemId: target.itemId,
        marketAvgEur: target.basePriceEur,
        sourceNote: "Manual supplier quote checked by admin",
        expiresAt: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    }));
    assert.equal(tooLong.status, 400);
    const payload = await tooLong.json() as { message?: string };
    assert.match(payload.message ?? "", /within 14 days/);
  } finally {
    if (oldToken === undefined) delete process.env.ADMIN_API_TOKEN;
    else process.env.ADMIN_API_TOKEN = oldToken;
  }
});

test("pricing freshness and cron share the price-trackable catalog set", async () => {
  await db.getAdapter().execute("DELETE FROM price_history");
  await db.getAdapter().execute("DELETE FROM estonian_price_checks");
  await db.getAdapter().execute("DELETE FROM admin_pricing_overrides");
  await db.getAdapter().execute("DELETE FROM pricing_run_failures");
  await db.getAdapter().execute("DELETE FROM pricing_runs");

  const trackableItems = await db.listPriceTrackableCatalogItems();
  const criticalItems = await db.listHealthCriticalPriceTrackableItems();
  const backgroundItems = await db.listBackgroundPriceTrackableItems();
  const categories = new Set(trackableItems.map((item) => item.category));
  assert.ok(categories.has("gpu"));
  assert.ok(categories.has("compact_ai_system"));
  assert.equal(categories.has("mac_system"), false);
  assert.equal(categories.has("external_gpu_enclosure"), false);
  assert.ok(criticalItems.length > 0);
  assert.ok(backgroundItems.length > 0);
  assert.equal(criticalItems.some((item) => item.category === "mac_system"), false);
  assert.equal(backgroundItems.some((item) => item.category === "external_gpu_enclosure"), false);

  const { refreshEstonianMarketPricing } = await import("../src/lib/server/estonian-pricing-service");
  const summary = await refreshEstonianMarketPricing({
    maxItems: 1,
    concurrency: 1,
    fetchPrice: async () => null,
  });
  assert.equal(summary.trackableItems, trackableItems.length);
  assert.equal(summary.checked, 1);
  assert.equal(summary.status, "PARTIAL");

  const report = await db.getPricingFreshnessReport();
  assert.equal(report.expectedItems, criticalItems.length);
  assert.equal(report.trackableItemCount, trackableItems.length);
  assert.equal(report.healthCriticalItemCount, criticalItems.length);
  assert.equal(report.backgroundTrackableItemCount, backgroundItems.length);
  assert.equal(report.processedItemCount, 1);
  assert.match(report.expectedVsProcessedMismatchWarning ?? "", /checked 1 of \d+ trackable/);
  assert.equal(report.skippedItemCountByReason.no_trusted_retailer_quote, 1);
  assert.equal(report.sampleSkippedItems[0]?.query, report.sampleSkippedItems[0]?.name);
  assert.equal(report.healthy, false);
});

test("complete pricing refresh records a successful run and lastSuccessfulRun", async () => {
  await db.getAdapter().execute("DELETE FROM price_history");
  await db.getAdapter().execute("DELETE FROM estonian_price_checks");
  await db.getAdapter().execute("DELETE FROM admin_pricing_overrides");
  await db.getAdapter().execute("DELETE FROM pricing_run_failures");
  await db.getAdapter().execute("DELETE FROM pricing_runs");

  const trackableItems = await db.listPriceTrackableCatalogItems();
  const { refreshEstonianMarketPricing } = await import("../src/lib/server/estonian-pricing-service");
  const summary = await refreshEstonianMarketPricing({
    maxItems: trackableItems.length,
    concurrency: 8,
    fetchPrice: async (_query, basePrice) => ({
      price: basePrice,
      sampleCount: 2,
      sources: `Fixture €${basePrice.toFixed(2)} match=2/2`,
    }),
  });

  assert.equal(summary.status, "SUCCESS");
  assert.equal(summary.trackableItems, trackableItems.length);
  assert.equal(summary.processedItems, trackableItems.length);
  assert.equal(summary.expectedVsProcessedMismatchWarning, null);

  const report = await db.getPricingFreshnessReport();
  assert.equal(report.healthy, true);
  assert.ok(report.lastSuccessfulRun);
  assert.equal(report.expectedItems, report.healthCriticalItemCount);
  assert.equal(report.processedItemCount, trackableItems.length);
});

test("pricing health ignores stale background items but fails stale critical items", async () => {
  await seedHealthyPricingFreshness();
  const background = (await db.listBackgroundPriceTrackableItems())[0];
  const critical = (await db.listHealthCriticalPriceTrackableItems())[0];
  assert.ok(background);
  assert.ok(critical);

  await db.getAdapter().execute(
    "UPDATE estonian_price_checks SET checked_at = ? WHERE category = ? AND item_id = ?",
    ["2000-01-01T00:00:00.000Z", background.category, background.itemId],
  );
  await db.getAdapter().execute(
    "DELETE FROM price_history WHERE category = ? AND item_id = ?",
    [background.category, background.itemId],
  );

  const backgroundOnlyReport = await db.getPricingFreshnessReport();
  assert.equal(backgroundOnlyReport.healthy, true);
  assert.equal(backgroundOnlyReport.criticalCoveragePct, 100);
  assert.ok(backgroundOnlyReport.backgroundCoveragePct < 100);
  assert.ok(backgroundOnlyReport.backgroundStaleChecks24hCount >= 1);

  await db.getAdapter().execute(
    "UPDATE estonian_price_checks SET checked_at = ? WHERE category = ? AND item_id = ?",
    ["2000-01-01T00:00:00.000Z", critical.category, critical.itemId],
  );
  await db.getAdapter().execute(
    "DELETE FROM price_history WHERE category = ? AND item_id = ?",
    [critical.category, critical.itemId],
  );

  const criticalReport = await db.getPricingFreshnessReport();
  assert.equal(criticalReport.healthy, false);
  assert.ok(criticalReport.errors.some((error) => error.includes("critical item")));
  assert.ok(criticalReport.criticalCoveragePct < 100);
  assert.equal(criticalReport.oldestStaleCriticalItem?.category, critical.category);
});

test("admin health uses critical pricing coverage instead of background freshness", async () => {
  await seedHealthyPricingFreshness();
  await clearOpsHealthNoise();
  const restoreEnv = setPreviewCheckoutEnv();
  const oldToken = process.env.ADMIN_API_TOKEN;
  const background = (await db.listBackgroundPriceTrackableItems())[0];
  assert.ok(background);

  try {
    process.env.ADMIN_API_TOKEN = "admin-health-coverage-token";
    await db.getAdapter().execute(
      "UPDATE estonian_price_checks SET checked_at = ? WHERE category = ? AND item_id = ?",
      ["2000-01-01T00:00:00.000Z", background.category, background.itemId],
    );
    await db.getAdapter().execute(
      "DELETE FROM price_history WHERE category = ? AND item_id = ?",
      [background.category, background.itemId],
    );

    const route = await import("../src/app/api/admin/health/route");
    const response = await route.GET(new Request("https://example.test/api/admin/health", {
      headers: { authorization: "Bearer admin-health-coverage-token" },
    }));

    assert.equal(response.status, 200);
    const payload = await response.json() as Record<string, unknown>;
    assert.equal(payload.pricingFresh, true);
    assert.equal(payload.pricingCoveragePct, 100);
    assert.ok(Number(payload.pricingBackgroundCoveragePct) < 100);
  } finally {
    if (oldToken === undefined) delete process.env.ADMIN_API_TOKEN;
    else process.env.ADMIN_API_TOKEN = oldToken;
    restoreEnv();
  }
});

test("pricing cron prioritizes stale critical items and rotates background capacity", async () => {
  await seedHealthyPricingFreshness();
  const criticalItems = await db.listHealthCriticalPriceTrackableItems();
  const backgroundItems = await db.listBackgroundPriceTrackableItems();
  assert.ok(criticalItems.length > 0);
  assert.ok(backgroundItems.length > 1);

  const staleCritical = criticalItems[0];
  await db.getAdapter().execute(
    "UPDATE estonian_price_checks SET checked_at = ? WHERE category = ? AND item_id = ?",
    ["2000-01-01T00:00:00.000Z", staleCritical.category, staleCritical.itemId],
  );

  const { refreshEstonianMarketPricing } = await import("../src/lib/server/estonian-pricing-service");
  const firstQueries: string[] = [];
  await refreshEstonianMarketPricing({
    maxItems: 1,
    concurrency: 1,
    fetchPrice: async (query, basePrice) => {
      firstQueries.push(query);
      return {
        price: basePrice,
        sampleCount: 2,
        sources: `Fixture €${basePrice.toFixed(2)} match=2/2`,
      };
    },
  });
  assert.equal(firstQueries[0], staleCritical.name);

  const backgroundNames = new Set(backgroundItems.map((item) => item.name));
  const firstRotationQueries: string[] = [];
  await refreshEstonianMarketPricing({
    maxItems: criticalItems.length + 1,
    concurrency: 1,
    fetchPrice: async (query, basePrice) => {
      firstRotationQueries.push(query);
      return {
        price: basePrice,
        sampleCount: 2,
        sources: `Fixture €${basePrice.toFixed(2)} match=2/2`,
      };
    },
  });
  const firstBackground = firstRotationQueries.find((query) => backgroundNames.has(query));
  assert.ok(firstBackground);

  const secondRotationQueries: string[] = [];
  await refreshEstonianMarketPricing({
    maxItems: criticalItems.length + 1,
    concurrency: 1,
    fetchPrice: async (query, basePrice) => {
      secondRotationQueries.push(query);
      return {
        price: basePrice,
        sampleCount: 2,
        sources: `Fixture €${basePrice.toFixed(2)} match=2/2`,
      };
    },
  });
  const secondBackground = secondRotationQueries.find((query) => backgroundNames.has(query));
  assert.ok(secondBackground);
  assert.notEqual(secondBackground, firstBackground);
});

test("retailer GPU normalization preserves Ti and SUPER model tokens", async () => {
  const { pricingProductTokens, retailerSearchQuery } = await import("../src/lib/server/estonian-pricing-service");

  assert.deepEqual(pricingProductTokens("NVIDIA RTX 5070 Ti SUPER"), [
    "nvidia",
    "rtx",
    "5070",
    "ti",
    "super",
  ]);
  assert.equal(retailerSearchQuery("NVIDIA RTX 4060 Ti 16GB"), "NVIDIA RTX 4060 Ti 16GB");
});

test("retailer search query strips parenthetical kit syntax without weakening match tokens", async () => {
  const { pricingProductTokens, retailerSearchQuery } = await import("../src/lib/server/estonian-pricing-service");

  const name = "Kingston Fury Beast 32GB (2x16GB) DDR5-6000 CL36";

  assert.equal(retailerSearchQuery(name), "Kingston Fury Beast 32GB 2x16GB DDR5 6000 CL36");
  assert.deepEqual(pricingProductTokens(name), [
    "kingston",
    "fury",
    "beast",
    "32gb",
    "2x16gb",
    "ddr5",
    "6000",
    "cl36",
  ]);
});

test("retailer GPU matching requires Ti modifier when catalog item includes Ti", async () => {
  const {
    hasAcceptableRetailerProductMatch,
    normalizeRetailerMatchText,
    pricingProductTokens,
    scoreRetailerProductContext,
  } = await import("../src/lib/server/estonian-pricing-service");

  const tokens = pricingProductTokens("NVIDIA RTX 4060 Ti 16GB");
  const context = normalizeRetailerMatchText("Gaming desktop with NVIDIA GeForce RTX 4060 and 16GB DDR5, 999,00 €");

  assert.equal(scoreRetailerProductContext(tokens, context), 4);
  assert.equal(hasAcceptableRetailerProductMatch(tokens, context), false);
});

test("retailer RAM near-miss exposes MHz and missing kit-token rejection", async () => {
  const {
    hasAcceptableRetailerProductMatch,
    normalizeRetailerMatchText,
    pricingProductTokens,
    requiredRetailerTokenMatches,
    scoreRetailerProductContext,
  } = await import("../src/lib/server/estonian-pricing-service");

  const tokens = pricingProductTokens("Corsair Vengeance 64GB (2x32GB) DDR5-6000 CL30");
  const context = normalizeRetailerMatchText("64GB DDR5 6000MHz CL30 v hem 4 529,00 €");

  assert.equal(requiredRetailerTokenMatches(tokens), 5);
  assert.equal(scoreRetailerProductContext(tokens, context), 3);
  assert.equal(hasAcceptableRetailerProductMatch(tokens, context), false);
});

test("retailer motherboard near-miss exposes compacted product-code token gap", async () => {
  const {
    hasAcceptableRetailerProductMatch,
    normalizeRetailerMatchText,
    pricingProductTokens,
    requiredRetailerTokenMatches,
    scoreRetailerProductContext,
  } = await import("../src/lib/server/estonian-pricing-service");

  const tokens = pricingProductTokens("Gigabyte B650 AORUS Elite AX");
  const context = normalizeRetailerMatchText("AMD B650 SAM5 ATX DDR5 b650aeliteaxv2 v hem 5 181,70 €");

  assert.equal(requiredRetailerTokenMatches(tokens), 3);
  assert.equal(scoreRetailerProductContext(tokens, context), 1);
  assert.equal(hasAcceptableRetailerProductMatch(tokens, context), false);
});

test("retailer diagnostics report anti-bot and source-level rejection reasons", async () => {
  const { diagnoseEstonianRetailerMatch } = await import("../src/lib/server/estonian-pricing-service");
  const diagnostic = await diagnoseEstonianRetailerMatch("NVIDIA RTX 4090", 1549, {
    includeSnippets: true,
    sources: [{ name: "Blocked retailer", url: "https://example.test/blocked" }],
    fetchHtml: async () => ({
      ok: false,
      status: 403,
      html: "<html><title>Just a moment...</title><script src=\"https://challenges.cloudflare.com\"></script></html>",
    }),
  });

  assert.equal(diagnostic.finalRejectionReason, "no_trusted_retailer_quote");
  assert.equal(diagnostic.sources[0].antiBotDetected, true);
  assert.equal(diagnostic.sources[0].rejectionReason, "anti_bot");
  assert.equal(diagnostic.sources[0].priceMatchCount, 0);
});

test("retailer diagnostics expose outlier filtering before token scoring", async () => {
  const { diagnoseEstonianRetailerMatch } = await import("../src/lib/server/estonian-pricing-service");
  const diagnostic = await diagnoseEstonianRetailerMatch("Corsair Vengeance 64GB DDR5 6000 CL30", 300, {
    includeSnippets: true,
    sources: [{ name: "Fixture retailer", url: "https://example.test/search" }],
    fetchHtml: async () => ({
      ok: true,
      status: 200,
      html: `
        <article><span>99,00 €</span> Corsair Vengeance 64GB DDR5 6000 CL30</article>
        <article><span>289,00 €</span> Corsair Vengeance 64GB DDR5 6000 CL30</article>
        <article><span>999,00 €</span> Corsair Vengeance 64GB DDR5 6000 CL30</article>
      `,
    }),
  });

  assert.equal(diagnostic.sources[0].priceMatchCount, 3);
  assert.deepEqual(diagnostic.sources[0].rawCandidatePrices, [99, 289, 999]);
  assert.equal(diagnostic.sources[0].inRatioCount, 1);
  assert.equal(diagnostic.sources[0].outOfRatioCount, 2);
  assert.equal(diagnostic.sources[0].bestAcceptedCandidate?.price, 289);
  assert.equal(diagnostic.aggregate.sampleCount, 1);
});

test("retailer diagnostics can search simplified RAM query while matching full catalog name", async () => {
  const { diagnoseEstonianRetailerMatch } = await import("../src/lib/server/estonian-pricing-service");
  const diagnostic = await diagnoseEstonianRetailerMatch("Corsair Vengeance 128GB (4x32GB) DDR5-5600 CL40", 479, {
    searchQuery: "Corsair Vengeance 128GB 4x32GB DDR5 5600 CL40",
    sources: [{ name: "Fixture Hinnavaatlus", url: "https://example.test/pricelist" }],
    fetchHtml: async () => ({
      ok: true,
      status: 200,
      html: `
        <a>CORSAIR DDR5 128GB PC 5600 CL40 KIT 4x32GB VENGEANCE RGB</a>
        <div class="price">2249,60 €</div>
      `,
    }),
  });

  assert.equal(diagnostic.searchQuery, "Corsair Vengeance 128GB 4x32GB DDR5 5600 CL40");
  assert.equal(diagnostic.sources[0].priceMatchCount, 1);
  assert.equal(diagnostic.sources[0].inRatioCount, 0);
  assert.equal(diagnostic.finalRejectionReason, "no_trusted_retailer_quote");
});

test("database-backed rate limiter blocks after the configured window allowance", async () => {
  const { checkRateLimit } = await import("../src/lib/request-utils");
  const key = `test-rate:${Date.now()}`;

  assert.equal(await checkRateLimit(key, 2, 60_000), true);
  assert.equal(await checkRateLimit(key, 2, 60_000), true);
  assert.equal(await checkRateLimit(key, 2, 60_000), false);

  const row = await db.getAdapter().queryOne<{ request_count: number }>(
    "SELECT request_count FROM rate_limits WHERE rate_key = ? LIMIT 1",
    [key],
  );
  assert.equal(row?.request_count, 3);
});

test("client IP helper normalizes trusted platform headers and rejects untrusted chains", async () => {
  const { clientIpFromHeaders, clientRateLimitKey } = await import("../src/lib/request-utils");

  assert.equal(
    clientIpFromHeaders(new Headers({ "x-vercel-forwarded-for": "::ffff:203.0.113.10" }), { NODE_ENV: "production", VERCEL: "1" }),
    "203.0.113.10",
  );
  assert.equal(
    clientIpFromHeaders(new Headers({ "x-forwarded-for": "203.0.113.10, 10.0.0.1" }), { NODE_ENV: "production" }),
    undefined,
  );
  assert.equal(
    clientIpFromHeaders(new Headers({ "x-real-ip": "203.0.113.11" }), { NODE_ENV: "production" }),
    undefined,
  );
  assert.equal(
    clientIpFromHeaders(new Headers({ "x-forwarded-for": "not-an-ip" }), { NODE_ENV: "development" }),
    undefined,
  );

  const request = new Request("https://example.test", {
    headers: { "x-forwarded-for": "203.0.113.99, 10.0.0.1" },
  });
  assert.equal(clientRateLimitKey(request, "checkout", { NODE_ENV: "production" }), "checkout:ip:unknown");
});

test("Stripe webhook events can retry after failed processing but not after success", async () => {
  const eventId = `evt_test_${Date.now()}`;

  assert.equal(await db.reserveStripeWebhookEvent(eventId, "checkout.session.completed"), "reserved");
  assert.equal(await db.reserveStripeWebhookEvent(eventId, "checkout.session.completed"), "in_progress");

  await db.markStripeWebhookEventFailed(eventId, "temporary failure");
  assert.equal(await db.reserveStripeWebhookEvent(eventId, "checkout.session.completed"), "reserved");

  await db.markStripeWebhookEventProcessed(eventId);
  assert.equal(await db.reserveStripeWebhookEvent(eventId, "checkout.session.completed"), "duplicate");
});

test("duplicate paid checkout webhooks do not duplicate fulfillment or emails", async () => {
  const nodemailerModule = await import("nodemailer");
  const nodemailer = nodemailerModule.default;
  const originalCreateTransport = nodemailer.createTransport;
  const sent: Array<{ to?: string; subject?: string }> = [];
  const restoreEnv = setPreviewWebhookEnv();
  (nodemailer as typeof nodemailer & { createTransport: unknown }).createTransport = (() => ({
    sendMail: async (mail: { to?: string; subject?: string }) => {
      sent.push({ to: mail.to, subject: mail.subject });
      return {};
    },
  })) as typeof nodemailer.createTransport;

  const oldEmailEnv = {
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASS: process.env.SMTP_PASS,
    SMTP_FROM_EMAIL: process.env.SMTP_FROM_EMAIL,
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
  };
  process.env.SMTP_HOST = "smtp.example.test";
  process.env.SMTP_PORT = "587";
  process.env.SMTP_USER = "smtp-user";
  process.env.SMTP_PASS = "smtp-pass";
  process.env.SMTP_FROM_EMAIL = "orders@example.test";
  process.env.ADMIN_EMAIL = "admin@example.test";

  try {
    const userId = await createTestUser("webhook-duplicate");
    const orderId = await insertCheckoutCreatedOrder({ userId, checkoutSessionId: "cs_webhook_duplicate" });
    const route = await import("../src/app/api/payments/webhook/route");
    const event = checkoutSessionEvent({
      eventId: `evt_duplicate_${Date.now()}`,
      orderId,
      userId,
      checkoutSessionId: "cs_webhook_duplicate",
    });

    const first = await route.POST(signedStripeWebhookRequest(event));
    const second = await route.POST(signedStripeWebhookRequest(event));
    const order = await db.getOrderByCheckoutSession("cs_webhook_duplicate");

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal((await second.json() as { duplicate?: boolean }).duplicate, true);
    assert.equal(order?.status, "PAID");
    assert.ok(order?.customer_email_sent_at);
    assert.ok(order?.admin_email_sent_at);
    assert.equal(sent.length, 2);
    assert.equal(sent.filter((mail) => mail.to === "admin@example.test").length, 1);
  } finally {
    nodemailer.createTransport = originalCreateTransport;
    restoreEnv();
    for (const [key, value] of Object.entries(oldEmailEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("checkout.session.completed with unpaid status does not mark an order paid", async () => {
  const restoreEnv = setPreviewWebhookEnv();

  try {
    const userId = await createTestUser("webhook-unpaid");
    const orderId = await insertCheckoutCreatedOrder({ userId, checkoutSessionId: "cs_webhook_unpaid" });
    const route = await import("../src/app/api/payments/webhook/route");
    const event = checkoutSessionEvent({
      eventId: `evt_unpaid_${Date.now()}`,
      orderId,
      userId,
      checkoutSessionId: "cs_webhook_unpaid",
      paymentStatus: "unpaid",
    });

    const response = await route.POST(signedStripeWebhookRequest(event));
    const order = await db.getOrderByCheckoutSession("cs_webhook_unpaid");

    assert.equal(response.status, 200);
    assert.equal(order?.status, "CHECKOUT_CREATED");
    assert.equal(order?.paid_at, null);
  } finally {
    restoreEnv();
  }
});

test("paid checkout webhooks reject mismatched amount, currency, and metadata", async () => {
  const restoreEnv = setPreviewWebhookEnv();

  try {
    const route = await import("../src/app/api/payments/webhook/route");
    const cases = [
      { suffix: "amount", amountTotal: 999 },
      { suffix: "currency", currency: "usd" },
      { suffix: "user", userOffset: 1 },
      { suffix: "item", itemId: 999 },
      { suffix: "mode", mode: "setup" },
    ];

    for (const item of cases) {
      const userId = await createTestUser(`webhook-mismatch-${item.suffix}`);
      const checkoutSessionId = `cs_webhook_mismatch_${item.suffix}_${Date.now()}`;
      const orderId = await insertCheckoutCreatedOrder({ userId, checkoutSessionId });
      const event = checkoutSessionEvent({
        eventId: `evt_mismatch_${item.suffix}_${Date.now()}`,
        orderId,
        userId: userId + (item.userOffset ?? 0),
        checkoutSessionId,
        amountTotal: item.amountTotal,
        currency: item.currency,
        mode: item.mode,
        itemId: item.itemId,
      });

      const response = await route.POST(signedStripeWebhookRequest(event));
      const order = await db.getOrderByCheckoutSession(checkoutSessionId);

      assert.equal(response.status, 400);
      assert.notEqual(order?.status, "PAID");
      assert.equal(order?.paid_at, null);
    }
  } finally {
    restoreEnv();
  }
});

test("paid checkout webhooks recover signed orphan sessions after DB link failures", async () => {
  const restoreEnv = setPreviewWebhookEnv();

  try {
    await withMockedPaymentEmailEnv(async (sent) => {
      const userId = await createTestUser("webhook-orphan");
      const orderId = await insertPendingOrderWithoutCheckoutSession({ userId });
      const route = await import("../src/app/api/payments/webhook/route");
      const checkoutSessionId = `cs_webhook_orphan_${Date.now()}`;
      const event = checkoutSessionEvent({
        eventId: `evt_orphan_${Date.now()}`,
        orderId,
        userId,
        checkoutSessionId,
      });

      const lines = await captureConsoleOutput(["warn"], async () => {
        const response = await route.POST(signedStripeWebhookRequest(event));
        assert.equal(response.status, 200);
      });

      const order = await db.getOrderByCheckoutSession(checkoutSessionId);
      assert.equal(order?.id, orderId);
      assert.equal(order?.status, "PAID");
      assert.equal(order?.stripe_checkout_session_id, checkoutSessionId);
      assert.ok(order?.fulfilled_at);
      assert.equal(sent.length, 2);
      assert.match(lines.join("\n"), /webhook_orphan_session_recovered/);
    });
  } finally {
    restoreEnv();
  }
});

test("checkout rejects authenticated browser requests without a same-origin Origin header", async () => {
  const oldAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  const oldStripeKey = process.env.STRIPE_SECRET_KEY;
  const oldVercelEnv = process.env.VERCEL_ENV;
  process.env.NEXT_PUBLIC_APP_URL = "https://example.test";
  process.env.STRIPE_SECRET_KEY = "sk_test_checkout_origin";
  process.env.VERCEL_ENV = "preview";

  try {
    const route = await import("../src/app/api/payments/checkout/route");
    const response = await route.POST(new Request("https://example.test/api/payments/checkout", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ itemType: "gpu", itemId: 1 }),
    }));

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { message: "Missing request origin." });
  } finally {
    if (oldAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = oldAppUrl;
    if (oldStripeKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = oldStripeKey;
    if (oldVercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = oldVercelEnv;
  }
});

test("checkout availability disables production checkout without live Stripe and keeps preview test checkout available", async () => {
  const oldAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  const oldStripeKey = process.env.STRIPE_SECRET_KEY;
  const oldVercelEnv = process.env.VERCEL_ENV;

  try {
    const route = await import("../src/app/api/payments/checkout/route");

    process.env.NEXT_PUBLIC_APP_URL = "https://llmlab.ee";
    process.env.VERCEL_ENV = "production";
    delete process.env.STRIPE_SECRET_KEY;
    const missingProductionKey = await route.POST(new Request("https://llmlab.ee/api/payments/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemType: "gpu", itemId: 1 }),
    }));
    assert.equal(missingProductionKey.status, 503);
    assert.deepEqual(await missingProductionKey.json(), { message: "Online checkout is not available yet. Please request a quote." });

    process.env.STRIPE_SECRET_KEY = "sk_test_not_live";
    const testKeyInProduction = await route.POST(new Request("https://llmlab.ee/api/payments/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemType: "gpu", itemId: 1 }),
    }));
    assert.equal(testKeyInProduction.status, 503);
    assert.deepEqual(await testKeyInProduction.json(), { message: "Online checkout is not available yet. Please request a quote." });

    process.env.NEXT_PUBLIC_APP_URL = "https://staging.llmlab.ee";
    process.env.VERCEL_ENV = "preview";
    process.env.STRIPE_SECRET_KEY = "sk_test_staging";
    const previewCheckout = await route.POST(new Request("https://staging.llmlab.ee/api/payments/checkout", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://staging.llmlab.ee",
        "sec-fetch-site": "same-origin",
      },
      body: JSON.stringify({ itemType: "mac_system", itemId: 1 }),
    }));
    assert.equal(previewCheckout.status, 400);
    assert.match((await previewCheckout.json() as { message: string }).message, /custom quote/i);
  } finally {
    if (oldAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = oldAppUrl;
    if (oldStripeKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = oldStripeKey;
    if (oldVercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = oldVercelEnv;
  }
});

test("Stripe environment policy rejects cross-mode live and test keys", async () => {
  const { getCheckoutAvailability } = await import("../src/lib/server/checkout-availability");

  assert.deepEqual(
    getCheckoutAvailability({
      VERCEL_ENV: "production",
      NEXT_PUBLIC_APP_URL: "https://llmlab.ee",
      STRIPE_SECRET_KEY: "sk_test_wrong",
    } as unknown as NodeJS.ProcessEnv),
    { available: false, reason: "production_requires_live_key" },
  );
  assert.deepEqual(
    getCheckoutAvailability({
      VERCEL_ENV: "preview",
      NEXT_PUBLIC_APP_URL: "https://staging.llmlab.ee",
      STRIPE_SECRET_KEY: "sk_live_wrong",
    } as unknown as NodeJS.ProcessEnv),
    { available: false, reason: "preview_requires_test_key" },
  );
  assert.deepEqual(
    getCheckoutAvailability({
      VERCEL_ENV: "production",
      NEXT_PUBLIC_APP_URL: "https://llmlab.ee",
      STRIPE_SECRET_KEY: "sk_live_ok",
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_wrong",
    } as unknown as NodeJS.ProcessEnv),
    { available: false, reason: "production_requires_live_publishable_key" },
  );
  assert.deepEqual(
    getCheckoutAvailability({
      VERCEL_ENV: "preview",
      NEXT_PUBLIC_APP_URL: "https://staging.llmlab.ee",
      STRIPE_SECRET_KEY: "sk_test_ok",
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_wrong",
    } as unknown as NodeJS.ProcessEnv),
    { available: false, reason: "preview_requires_test_publishable_key" },
  );
});

test("account registration does not require Stripe configuration", async () => {
  const oldStripeKey = process.env.STRIPE_SECRET_KEY;
  const oldVercelEnv = process.env.VERCEL_ENV;

  try {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.VERCEL_ENV;

    const route = await import("../src/app/api/auth/register/route");
    const email = `stripe-free-register-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
    const response = await route.POST(new Request("https://example.test/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "CorrectHorseBatteryStaple123!" }),
    }));

    assert.equal(response.status, 201);
    const payload = await response.json() as { user: { email: string; role: string } };
    assert.equal(payload.user.email, email);
    assert.equal(payload.user.role, "USER");
    assert.match(response.headers.get("set-cookie") ?? "", /fp_session=/);
  } finally {
    if (oldStripeKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = oldStripeKey;
    if (oldVercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = oldVercelEnv;
  }
});

test("checkout auth failure copy points customers to the Account menu without exposing admin setup", async () => {
  const { CHECKOUT_AUTH_REQUIRED_FALLBACK_MESSAGE, CHECKOUT_AUTH_REQUIRED_MESSAGE } = await import("../src/lib/auth-panel-events");
  assert.equal(CHECKOUT_AUTH_REQUIRED_MESSAGE, "Log in or create an account from the Account menu. Checkout will continue after sign-in.");
  assert.equal(CHECKOUT_AUTH_REQUIRED_FALLBACK_MESSAGE, "Log in or create an account from the Account menu, then click purchase again.");

  const authPanelSource = readFileSync(join(process.cwd(), "src/components/auth-panel.tsx"), "utf8");
  assert.doesNotMatch(authPanelSource, /ADMIN_SETUP_CODE/);
  assert.doesNotMatch(authPanelSource, /adminSetupCode/);
});

test("pending checkout intent stores only resumable identifiers and expires", async () => {
  const {
    PENDING_CHECKOUT_INTENT_KEY,
    PENDING_CHECKOUT_INTENT_TTL_MS,
    clearPendingCheckoutIntent,
    markPendingCheckoutIntentForRedirect,
    readPendingCheckoutIntent,
    savePendingCheckoutIntent,
  } = await import("../src/lib/pending-checkout-intent");
  const values = new Map<string, string>();
  const now = Date.now();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };

  const saved = savePendingCheckoutIntent({
    itemType: "profile_build",
    itemId: 42,
    intendedPath: "/builds/42?from=test",
    isProfileBuild: true,
    createdAt: now,
  }, storage);
  assert.ok(saved);

  const raw = values.get(PENDING_CHECKOUT_INTENT_KEY) ?? "";
  assert.match(raw, /profile_build/);
  assert.match(raw, /\/builds\/42/);
  assert.doesNotMatch(raw, /price/i);
  assert.doesNotMatch(raw, /amount/i);

  const fresh = readPendingCheckoutIntent(storage, now + PENDING_CHECKOUT_INTENT_TTL_MS - 1);
  assert.equal(fresh.stale, false);
  assert.equal(fresh.intent?.itemId, 42);
  assert.equal(fresh.intent?.checkoutType, "direct");

  const marked = markPendingCheckoutIntentForRedirect(storage);
  assert.equal(marked?.resumeAfterAuth, true);

  const stale = readPendingCheckoutIntent(storage, now + PENDING_CHECKOUT_INTENT_TTL_MS + 1);
  assert.equal(stale.intent, null);
  assert.equal(stale.stale, true);

  values.set(PENDING_CHECKOUT_INTENT_KEY, JSON.stringify({
    itemType: "mac_system",
    itemId: 42,
    checkoutType: "direct",
    intendedPath: "/catalog/mac_system/42",
    createdAt: now,
  }));
  const invalidQuoteOnlyType = readPendingCheckoutIntent(storage, now);
  assert.equal(invalidQuoteOnlyType.intent, null);
  assert.equal(invalidQuoteOnlyType.stale, true);

  clearPendingCheckoutIntent(storage);
  assert.equal(values.has(PENDING_CHECKOUT_INTENT_KEY), false);
});

test("checkout auth continuation is wired through purchase and auth components", async () => {
  const purchaseButtonSource = readFileSync(join(process.cwd(), "src/components/purchase-build-button.tsx"), "utf8");
  const authPanelSource = readFileSync(join(process.cwd(), "src/components/auth-panel.tsx"), "utf8");
  const pendingIntentSource = readFileSync(join(process.cwd(), "src/lib/pending-checkout-intent.ts"), "utf8");

  assert.match(purchaseButtonSource, /savePendingCheckoutIntent/);
  assert.match(purchaseButtonSource, /CHECKOUT_AUTH_REQUIRED_FALLBACK_MESSAGE/);
  assert.match(purchaseButtonSource, /RESUME_PENDING_CHECKOUT_EVENT/);
  assert.match(purchaseButtonSource, /startCheckout\(\{ resumed: true \}\)/);
  assert.doesNotMatch(purchaseButtonSource, /priceEur[^\n]+savePendingCheckoutIntent/);

  assert.match(authPanelSource, /resumePendingCheckoutAfterAuth/);
  assert.match(authPanelSource, /intent\.isProfileBuild/);
  assert.match(authPanelSource, /confirm the order price/);
  assert.match(authPanelSource, /markPendingCheckoutIntentForRedirect/);
  assert.match(authPanelSource, /Cancel saved checkout/);
  assert.match(authPanelSource, /\/api\/payments\/checkout/);

  assert.match(pendingIntentSource, /window\.sessionStorage/);
  assert.doesNotMatch(pendingIntentSource, /window\.localStorage/);
});

test("auth POST routes reject mismatched browser origins", async () => {
  const oldAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  process.env.NEXT_PUBLIC_APP_URL = "https://staging.llmlab.ee";

  try {
    const loginRoute = await import("../src/app/api/auth/login/route");
    const registerRoute = await import("../src/app/api/auth/register/route");
    const logoutRoute = await import("../src/app/api/auth/logout/route");

    const makeRequest = () => new Request("https://staging.llmlab.ee/api/auth/test", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://attacker.example",
      },
      body: JSON.stringify({ email: "buyer@example.test", password: "CorrectHorseBatteryStaple123!" }),
    });

    for (const response of [
      await loginRoute.POST(makeRequest()),
      await registerRoute.POST(makeRequest()),
      await logoutRoute.POST(makeRequest()),
    ]) {
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { message: "Request origin is not allowed." });
    }
  } finally {
    if (oldAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = oldAppUrl;
  }
});

test("parseApiMessage handles invalid json, empty bodies, and text truncation", async () => {
  const { parseApiMessage } = await import("../src/lib/parse-api-message");

  assert.equal(await parseApiMessage(new Response("{", { headers: { "content-type": "application/json" } })), null);
  assert.equal(await parseApiMessage(new Response("   ", { headers: { "content-type": "text/plain" } })), null);

  const longText = "x".repeat(250);
  assert.equal((await parseApiMessage(new Response(longText, { headers: { "content-type": "text/plain" } })))?.length, 200);
});

test("catalog URL filter params ignore invalid values and write shareable URLs", async () => {
  const { catalogHref, readCatalogUrlState, writeCatalogUrlState } = await import("../src/lib/catalog-url");
  const params = new URLSearchParams("q=RTX%204090&sort=price-asc&checkout=quote&budget=bad&gpu=nvidia&vram=24&ram=128&model=70b&platform=mac-egpu&keep=1");

  const state = readCatalogUrlState(params);
  assert.equal(state.search, "RTX 4090");
  assert.equal(state.sort, "price-asc");
  assert.equal(state.filters.checkout, "quote");
  assert.equal(state.filters.budget, "all");
  assert.equal(state.filters.vendor, "nvidia");
  assert.equal(state.filters.vram, "24");
  assert.equal(state.filters.ram, "128");
  assert.equal(state.filters.workload, "70b");
  assert.equal(state.filters.platform, "mac-egpu");

  const rewritten = writeCatalogUrlState(new URLSearchParams("keep=1&budget=bad"), state);
  assert.equal(rewritten.get("keep"), "1");
  assert.equal(rewritten.get("budget"), null);
  assert.equal(rewritten.get("model"), "70b");

  const reset = writeCatalogUrlState(new URLSearchParams("keep=1&q=x&gpu=amd"), {
    search: "",
    sort: "default",
    filters: {
      checkout: "all",
      budget: "all",
      vendor: "all",
      vram: "all",
      ram: "all",
      workload: "all",
      platform: "all",
    },
  });
  assert.equal(reset.toString(), "keep=1");
  assert.equal(catalogHref({ filters: { platform: "mac", checkout: "quote" } }), "/?checkout=quote&platform=mac#component-catalog");
});

test("client components render empty and sparse data states without throwing", async () => {
  const { defaultCatalogUrlState } = await import("../src/lib/catalog-url");
  const { CatalogBrowserView } = await import("../src/components/catalog-browser");
  const { BuildPriceHistoryChart } = await import("../src/components/build-price-history-chart");
  const { PriceGraph } = await import("../src/components/price-graph");
  const { PurchaseBuildButton } = await import("../src/components/purchase-build-button");

  const emptyCatalog = renderToStaticMarkup(React.createElement(CatalogBrowserView, { groups: [], lang: "en", state: defaultCatalogUrlState }));
  assert.match(emptyCatalog, /Search components/);

  const emptyGraph = renderToStaticMarkup(React.createElement(PriceGraph, {
    ranges: { "7d": [], "30d": [], "90d": [] },
    preorderPriceEur: null,
    marketAvgEur: null,
  }));
  assert.match(emptyGraph, /No historical pricing yet/);

  const singlePointGraph = renderToStaticMarkup(React.createElement(PriceGraph, {
    ranges: {
      "7d": [{ date: "2026-05-04", price: 100 }],
      "30d": [{ date: "2026-05-04", price: 100 }],
      "90d": [],
    },
    preorderPriceEur: 115,
    marketAvgEur: 100,
  }));
  assert.match(singlePointGraph, /1 data point/);
  assert.match(singlePointGraph, /Latest Estonian market average before assembly/);

  const buildHistoryGraph = renderToStaticMarkup(React.createElement(BuildPriceHistoryChart, {
    series: [
      {
        key: "gpu:1",
        label: "GPU",
        name: "RTX test",
        orderPriceEur: 1150,
        marketAvgEur: 1000,
        ranges: {
          "7d": [{ date: "2026-05-04", price: 1000 }],
          "30d": [{ date: "2026-05-04", price: 1000 }, { date: "2026-05-05", price: 980 }],
          "90d": [],
        },
      },
      {
        key: "cpu:1",
        label: "CPU",
        name: "Ryzen test",
        orderPriceEur: 345,
        marketAvgEur: 300,
        ranges: {
          "7d": [{ date: "2026-05-04", price: 300 }],
          "30d": [{ date: "2026-05-04", price: 300 }, { date: "2026-05-05", price: 310 }],
          "90d": [],
        },
      },
    ],
  }));
  assert.match(buildHistoryGraph, /All components and build total/);
  assert.match(buildHistoryGraph, /Latest build total/);
  assert.match(buildHistoryGraph, /GPU/);
  assert.match(buildHistoryGraph, /CPU/);

  const unavailableCheckout = renderToStaticMarkup(React.createElement(PurchaseBuildButton, {
    itemType: "gpu",
    itemId: 1,
    priceEur: 1234,
    checkoutAvailable: false,
  }));
  assert.match(unavailableCheckout, /Online checkout is not available yet\. Request a quote instead\./);
  assert.doesNotMatch(unavailableCheckout, /Secure checkout via Stripe/);

  const fallbackCheckout = renderToStaticMarkup(React.createElement(PurchaseBuildButton, {
    itemType: "gpu",
    itemId: 1,
    priceEur: 1234,
    checkoutAvailable: false,
    checkoutUnavailableReason: "fallback_pricing",
  }));
  assert.match(fallbackCheckout, /Quote-only until fresh market pricing is available/);
  assert.match(fallbackCheckout, /Fresh, non-fallback Estonian market pricing is required/);
  assert.doesNotMatch(fallbackCheckout, /Final quote may vary/);
});

test("fresh trusted pricing allows direct checkout eligibility", async () => {
  await seedHealthyPricingFreshness();
  const restoreEnv = setPreviewCheckoutEnv();

  try {
    const { getCatalogItemCheckoutEligibility } = await import("../src/lib/server/checkout-availability");
    const eligibility = await getCatalogItemCheckoutEligibility("gpu", 1);

    assert.equal(eligibility.eligible, true);
    assert.equal(eligibility.reason, undefined);
    assert.equal(eligibility.maxPriceAgeHours, 24);
    assert.ok((eligibility.amountEurCents ?? 0) > 0);
  } finally {
    restoreEnv();
  }
});

test("stale pricing blocks direct checkout eligibility", async () => {
  await seedHealthyPricingFreshness();
  const restoreEnv = setPreviewCheckoutEnv();

  try {
    await db.getAdapter().execute(
      "UPDATE estonian_price_checks SET checked_at = ? WHERE category = ? AND item_id = ?",
      ["2000-01-01T00:00:00.000Z", "gpu", 1],
    );

    const { getCatalogItemCheckoutEligibility } = await import("../src/lib/server/checkout-availability");
    const eligibility = await getCatalogItemCheckoutEligibility("gpu", 1);

    assert.equal(eligibility.eligible, false);
    assert.equal(eligibility.reason, "stale_pricing");
    assert.match(eligibility.message, /stale/i);
  } finally {
    restoreEnv();
  }
});

test("fallback-only pricing blocks direct checkout eligibility", async () => {
  await seedHealthyPricingFreshness();
  const restoreEnv = setPreviewCheckoutEnv();

  try {
    await db.getAdapter().execute("DELETE FROM estonian_price_checks WHERE category = ? AND item_id = ?", ["storage_drive", 1]);

    const { getCatalogItemCheckoutEligibility } = await import("../src/lib/server/checkout-availability");
    const eligibility = await getCatalogItemCheckoutEligibility("storage_drive", 1);

    assert.equal(eligibility.eligible, false);
    assert.equal(eligibility.reason, "fallback_pricing");
    assert.match(eligibility.message, /fresh Estonian market pricing/i);
  } finally {
    restoreEnv();
  }
});

test("quote-only Mac eGPU builds are not direct checkout eligible", async () => {
  const restoreEnv = setPreviewCheckoutEnv();

  try {
    const { getCatalogItemCheckoutEligibility } = await import("../src/lib/server/checkout-availability");
    const eligibility = await getCatalogItemCheckoutEligibility("mac_egpu_build", 1);

    assert.equal(eligibility.eligible, false);
    assert.equal(eligibility.reason, "quote_only");
  } finally {
    restoreEnv();
  }
});

test("out-of-stock build components block direct checkout eligibility", async () => {
  await seedHealthyPricingFreshness();
  const restoreEnv = setPreviewCheckoutEnv();
  const build = await db.getProfileBuildById(1);
  assert.ok(build);

  try {
    await db.getAdapter().execute("UPDATE gpus SET in_stock = 0 WHERE id = ?", [build.gpu_id]);

    const { getBuildCheckoutEligibility } = await import("../src/lib/server/checkout-availability");
    const eligibility = await getBuildCheckoutEligibility(build.id);

    assert.equal(eligibility.eligible, false);
    assert.equal(eligibility.reason, "out_of_stock");
  } finally {
    await db.getAdapter().execute("UPDATE gpus SET in_stock = 1 WHERE id = ?", [build.gpu_id]);
    restoreEnv();
  }
});

test("checkout route blocks fallback pricing before creating an order or Stripe session", async () => {
  await seedHealthyPricingFreshness();
  await db.getAdapter().execute("DELETE FROM estonian_price_checks WHERE category = ? AND item_id = ?", ["gpu", 1]);
  const restoreEnv = setPreviewCheckoutEnv();
  const beforeCount = await orderCountForItem("GPU", 1);

  try {
    const route = await import("../src/app/api/payments/checkout/route");
    const response = await route.POST(new Request("https://example.test/api/payments/checkout", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "origin": "https://example.test",
        "sec-fetch-site": "same-origin",
      },
      body: JSON.stringify({ itemType: "gpu", itemId: 1 }),
    }));

    assert.equal(response.status, 409);
    const payload = await response.json() as { message: string; reason: string; maxPriceAgeHours: number };
    assert.equal(payload.reason, "fallback_pricing");
    assert.equal(payload.maxPriceAgeHours, 24);
    assert.match(payload.message, /quote-only/i);
    assert.equal(await orderCountForItem("GPU", 1), beforeCount);
  } finally {
    restoreEnv();
  }
});

test("duplicate checkout attempts for the same user and item reuse one open order", async () => {
  const userId = await createTestUser("checkout-dedupe");

  const first = await db.createPendingOrderForCatalogItem({ userId, itemType: "GPU", itemId: 1 });
  const second = await db.createPendingOrderForCatalogItem({ userId, itemType: "GPU", itemId: 1 });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) throw new Error("orders should be created");
  assert.equal(second.orderId, first.orderId);

  const row = await db.getAdapter().queryOne<{ cnt: number }>(
    "SELECT COUNT(*) AS cnt FROM orders WHERE user_id = ? AND order_item_type = 'GPU' AND order_item_id = 1 AND status IN ('PENDING', 'CHECKOUT_CREATED')",
    [userId],
  );
  assert.equal(row?.cnt, 1);
});

test("different users can checkout the same item independently", async () => {
  const firstUserId = await createTestUser("checkout-user-a");
  const secondUserId = await createTestUser("checkout-user-b");

  const first = await db.createPendingOrderForCatalogItem({ userId: firstUserId, itemType: "CPU", itemId: 1 });
  const second = await db.createPendingOrderForCatalogItem({ userId: secondUserId, itemType: "CPU", itemId: 1 });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) throw new Error("orders should be created");
  assert.notEqual(first.orderId, second.orderId);
});

test("same user can checkout again after previous open order is no longer open", async () => {
  const userId = await createTestUser("checkout-after-terminal");

  const first = await db.createPendingOrderForCatalogItem({ userId, itemType: "RAM_KIT", itemId: 1 });
  assert.equal(first.ok, true);
  if (!first.ok) throw new Error("first order should be created");
  await db.getAdapter().execute("UPDATE orders SET status = 'PAID' WHERE id = ?", [first.orderId]);

  const second = await db.createPendingOrderForCatalogItem({ userId, itemType: "RAM_KIT", itemId: 1 });
  assert.equal(second.ok, true);
  if (!second.ok) throw new Error("second order should be created");
  assert.notEqual(second.orderId, first.orderId);
  await db.getAdapter().execute("UPDATE orders SET status = 'CANCELED' WHERE id = ?", [second.orderId]);

  const third = await db.createPendingOrderForCatalogItem({ userId, itemType: "RAM_KIT", itemId: 1 });
  assert.equal(third.ok, true);
  if (!third.ok) throw new Error("third order should be created");
  assert.notEqual(third.orderId, second.orderId);
});

test("quote request API validates input and persists useful product metadata", async () => {
  const route = await import("../src/app/api/quote-requests/route");
  const response = await route.POST(new Request("https://example.test/api/quote-requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      customerEmail: "buyer@example.test",
      customerName: "Buyer Name",
      productType: "mac_system",
      productId: 1,
      message: "Need a quote for local AI inference and testing.",
    }),
  }));

  assert.equal(response.status, 201);
  const payload = await response.json() as { quoteRequestId: number };
  assert.equal(typeof payload.quoteRequestId, "number");

  const row = await db.getAdapter().queryOne<{
    customer_email: string;
    product_type: string;
    product_id: number;
    product_name: string;
    message: string;
    status: string;
    operator_note: string;
  }>("SELECT customer_email, product_type, product_id, product_name, message, status, operator_note FROM quote_requests WHERE id = ? LIMIT 1", [payload.quoteRequestId]);

  assert.equal(row?.customer_email, "buyer@example.test");
  assert.equal(row?.product_type, "mac_system");
  assert.equal(row?.product_id, 1);
  assert.ok(row?.product_name);
  assert.match(row?.message ?? "", /local AI inference/);
  assert.equal(row?.status, "NEW");
  assert.equal(row?.operator_note, "");
});

test("quote request API rejects invalid email, name, and message", async () => {
  const route = await import("../src/app/api/quote-requests/route");
  const makeRequest = (body: Record<string, unknown>) => route.POST(new Request("https://example.test/api/quote-requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      customerEmail: "buyer@example.test",
      customerName: "Buyer Name",
      productType: "mac_system",
      productId: 1,
      message: "Need a quote for local AI inference and testing.",
      ...body,
    }),
  }));

  assert.equal((await makeRequest({ customerEmail: "not-an-email" })).status, 400);
  assert.equal((await makeRequest({ customerName: "A" })).status, 400);
  assert.equal((await makeRequest({ message: "short" })).status, 400);
});

test("quote request API suppresses honeypot and rapid duplicate submissions", async () => {
  const route = await import("../src/app/api/quote-requests/route");
  const customerEmail = `quote-dedupe-${Date.now()}@example.test`;
  const body = {
    customerEmail,
    customerName: "Buyer Name",
    productType: "mac_system",
    productId: 1,
    message: "Need a quote for local AI inference and testing.",
  };
  const makeRequest = (payload: Record<string, unknown>, ip: string) => route.POST(new Request("https://example.test/api/quote-requests", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-vercel-forwarded-for": ip,
    },
    body: JSON.stringify(payload),
  }));

  await withMockedPaymentEmailEnv(async (sent) => {
    const honeypot = await makeRequest({ ...body, customerEmail: `quote-honeypot-${Date.now()}@example.test`, website: "https://spam.example.test" }, "203.0.113.20");
    assert.equal(honeypot.status, 202);

    const first = await makeRequest(body, "203.0.113.21");
    const second = await makeRequest(body, "203.0.113.21");
    assert.equal(first.status, 201);
    assert.equal(second.status, 202);
    assert.equal((await second.json() as { duplicate?: boolean }).duplicate, true);

    const row = await db.getAdapter().queryOne<{ cnt: number }>(
      "SELECT COUNT(*) AS cnt FROM quote_requests WHERE customer_email = ?",
      [customerEmail],
    );
    assert.equal(row?.cnt, 1);
    assert.equal(sent.length, 1);
  });
});

test("quote request API rejects oversized bodies before JSON parsing", async () => {
  const route = await import("../src/app/api/quote-requests/route");
  const response = await route.POST(new Request("https://example.test/api/quote-requests", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(8 * 1024 + 1),
    },
    body: "{}",
  }));

  assert.equal(response.status, 413);
});

test("quote-only UI renders the persisted quote request form and direct order creation rejects quote-only types", async () => {
  const { QuoteRequestForm } = await import("../src/components/quote-request-form");
  const markup = renderToStaticMarkup(React.createElement(QuoteRequestForm, {
    productType: "mac_system",
    productId: 1,
    productName: "Mac Studio",
    lang: "en",
  }));

  assert.match(markup, /data-quote-request-form/);
  assert.match(markup, /\/api\/quote-requests/);

  const userId = await createTestUser("quote-only-checkout");
  const order = await db.createPendingOrderForCatalogItem({ userId, itemType: "MAC_SYSTEM", itemId: 1 });
  assert.equal(order.ok, false);
  if (!order.ok) assert.equal(order.message, "Item not found.");
});

test("checkout route rejects quote-only mac_system items before creating a payment session", async () => {
  const oldAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  const oldStripeKey = process.env.STRIPE_SECRET_KEY;
  const oldVercelEnv = process.env.VERCEL_ENV;
  process.env.NEXT_PUBLIC_APP_URL = "https://example.test";
  process.env.STRIPE_SECRET_KEY = "sk_test_quote_only";
  process.env.VERCEL_ENV = "preview";
  const cookie = await createAuthenticatedSessionCookie("quote-only-route");

  try {
    const route = await import("../src/app/api/payments/checkout/route");
    const response = await route.POST(new Request("https://example.test/api/payments/checkout", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "origin": "https://example.test",
        "sec-fetch-site": "same-origin",
        "cookie": cookie,
      },
      body: JSON.stringify({ itemType: "mac_system", itemId: 1 }),
    }));

    assert.equal(response.status, 400);
    assert.match((await response.json() as { message: string }).message, /custom quote/i);
  } finally {
    if (oldAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = oldAppUrl;
    if (oldStripeKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = oldStripeKey;
    if (oldVercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = oldVercelEnv;
  }
});

test("Mac systems are visible in catalog data and remain quote-only", async () => {
  const { getHomeCatalogView, getCatalogItemDetailView } = await import("../src/lib/server/catalog-service");
  const { defaultCatalogUrlState } = await import("../src/lib/catalog-url");
  const { CatalogBrowserView } = await import("../src/components/catalog-browser");
  const home = await getHomeCatalogView();

  assert.ok(home.macSystems.length > 0);
  const mac = home.macSystems[0];
  const detail = await getCatalogItemDetailView("mac_system", mac.id);
  assert.equal(detail?.purchasable, false);
  assert.equal(detail?.checkoutItemType, "mac_system");

  const markup = renderToStaticMarkup(React.createElement(CatalogBrowserView, {
    lang: "en",
    state: defaultCatalogUrlState,
    groups: [{
      key: "mac_system",
      label: { en: "Quote-only Mac Systems", et: "Pakkumispõhised Maci süsteemid" },
      items: [{
        id: mac.id,
        name: mac.name,
        category: "Mac",
        specs: [`${mac.chip} | ${mac.unifiedMemoryGb}GB unified`],
        preorderPriceEur: mac.preorderPriceEur,
        href: `/catalog/mac_system/${mac.id}`,
        pricing: { priceSource: mac.priceSource, checkedAt: mac.checkedAt, sampleCount: mac.sampleCount },
        quoteOnly: true,
      }],
    }],
  }));

  assert.match(markup, /Quote-only Mac Systems/);
  assert.match(markup, /\/catalog\/mac_system\//);
  assert.doesNotMatch(markup, /mac_systems/);
  assert.match(markup, /Quote-only/);
});

test("price transparency badges distinguish live, fallback, and low-sample prices", async () => {
  const { getPriceTransparencyBadges } = await import("../src/lib/price-transparency");
  const now = Date.parse("2026-05-04T12:00:00.000Z");

  assert.deepEqual(
    getPriceTransparencyBadges({ priceSource: "market_live", checkedAt: "2026-05-04T08:00:00.000Z", sampleCount: 2 }, "en", now),
    ["Updated today", "Estonian market estimate", "Includes 15% assembly markup"],
  );
  assert.deepEqual(
    getPriceTransparencyBadges({ priceSource: "market_live", checkedAt: "2026-05-02T08:00:00.000Z", sampleCount: 1 }, "en", now),
    ["Updated 2 days ago", "Low sample", "Estonian market estimate", "Includes 15% assembly markup"],
  );
  assert.deepEqual(
    getPriceTransparencyBadges({ priceSource: "seed_fallback", checkedAt: null, sampleCount: null }, "en", now),
    ["Reference estimate", "Includes 15% assembly markup"],
  );
  assert.deepEqual(
    getPriceTransparencyBadges({
      priceSource: "seed_fallback",
      checkedAt: null,
      sampleCount: null,
      marketDataStatus: "stale",
      latestCheckedAt: "2026-04-28T08:00:00.000Z",
      latestSampleCount: 2,
    }, "en", now),
    ["Stale market data", "Last checked 6 days ago", "Quote required", "Includes 15% assembly markup"],
  );
});

test("compact price transparency badges prioritize freshness and reduce card density", async () => {
  const { getPriceTransparencyBadges } = await import("../src/lib/price-transparency");
  const now = Date.parse("2026-05-04T12:00:00.000Z");
  const meta = { priceSource: "market_live" as const, checkedAt: "2026-05-04T08:00:00.000Z", sampleCount: 1 };
  const full = getPriceTransparencyBadges(meta, "en", now, "full");
  const compact = getPriceTransparencyBadges(meta, "en", now, "compact");

  assert.ok(compact.length < full.length);
  assert.deepEqual(compact, ["Updated today", "Low sample"]);
  assert.doesNotMatch(compact.join(" "), /assembly markup/);
});

test("catalog pricing metadata distinguishes fresh, stale, and absent market data without changing fallback price", async () => {
  const { getCatalogItemDetailView } = await import("../src/lib/server/catalog-service");

  const cpu = await db.getCpuById(1);
  assert.ok(cpu);
  await db.upsertEstonianPriceCheck({
    category: "cpu",
    itemId: cpu.id,
    itemName: cpu.name,
    basePriceEur: cpu.price_eur,
    marketAvgEur: cpu.price_eur,
    assemblyMarkupPct: 15,
    finalPriceEur: Number((cpu.price_eur * 1.15).toFixed(2)),
    sampleCount: 2,
    sources: `Retailer €${cpu.price_eur} match=2/2`,
  });
  const fresh = await getCatalogItemDetailView("cpu", cpu.id);
  assert.equal(fresh?.priceSource, "market_live");
  assert.equal(fresh?.marketDataStatus, "fresh");
  assert.equal(fresh?.latestCheckedAt, fresh?.checkedAt);

  const gpu = await db.getGpuById(1);
  assert.ok(gpu);
  await db.upsertEstonianPriceCheck({
    category: "gpu",
    itemId: gpu.id,
    itemName: gpu.name,
    basePriceEur: gpu.price_eur,
    marketAvgEur: gpu.price_eur,
    assemblyMarkupPct: 15,
    finalPriceEur: Number((gpu.price_eur * 1.15).toFixed(2)),
    sampleCount: 2,
    sources: `Retailer €${gpu.price_eur} match=2/2`,
  });
  await db.getAdapter().execute(
    "UPDATE estonian_price_checks SET checked_at = ? WHERE category = ? AND item_id = ?",
    ["2000-01-01T00:00:00.000Z", "gpu", gpu.id],
  );
  const stale = await getCatalogItemDetailView("gpu", gpu.id);
  assert.equal(stale?.priceSource, "seed_fallback");
  assert.equal(stale?.marketDataStatus, "stale");
  assert.equal(stale?.latestCheckedAt, "2000-01-01T00:00:00.000Z");
  assert.equal(stale?.preorderPriceEur, Math.round(gpu.price_eur * 1.15));

  const storage = await db.getStorageDriveById(1);
  assert.ok(storage);
  await db.getAdapter().execute("DELETE FROM estonian_price_checks WHERE category = ? AND item_id = ?", ["storage_drive", storage.id]);
  const fallback = await getCatalogItemDetailView("storage_drive", storage.id);
  assert.equal(fallback?.priceSource, "seed_fallback");
  assert.equal(fallback?.marketDataStatus, "none");
  assert.equal(fallback?.latestCheckedAt, null);
});

test("AI capability estimator maps VRAM and RAM to cautious workload tiers", async () => {
  const { estimateAiCapability } = await import("../src/lib/ai-capability");

  const low = estimateAiCapability({ gpuVramGb: 8, systemRamGb: 16, gpuName: "NVIDIA RTX 4060" });
  assert.equal(low.level, "starter");
  assert.match(low.tiers.join(" "), /7B\/8B/);
  assert.doesNotMatch(low.tiers.join(" "), /70B/);

  const high = estimateAiCapability({ gpuVramGb: 48, systemRamGb: 128, gpuName: "NVIDIA RTX 6000 Ada", gpuArchitecture: "Ada" });
  assert.equal(high.level, "workstation");
  assert.match(high.tiers.join(" "), /70B-class/);
  assert.match(high.tiers.join(" "), /CUDA/);
});

test("compact AI capability summary can render a concise runtime caveat", async () => {
  const { AiCapabilitySummary } = await import("../src/components/ai-capability-summary");
  const markup = renderToStaticMarkup(React.createElement(AiCapabilitySummary, {
    input: { gpuVramGb: 16, systemRamGb: 64, gpuName: "NVIDIA RTX 4080" },
    lang: "en",
    compact: true,
    showCompactCaveat: true,
  }));

  assert.match(markup, /Rough estimate; model\/runtime\/quantization affects results\./);
});

test("checkout success status component renders paid and pending states and targets session-status", async () => {
  const { CheckoutSessionStatus } = await import("../src/components/checkout-session-status");

  const paidMarkup = renderToStaticMarkup(React.createElement(CheckoutSessionStatus, {
    sessionId: "cs_paid",
    initialOrder: { id: 1, buildName: "Paid Build", amountEur: "1234.00", status: "PAID" },
    lang: "en",
  }));
  assert.match(paidMarkup, /Payment confirmed/);
  assert.match(paidMarkup, /\/api\/payments\/session-status\?session_id=cs_paid/);
  assert.match(paidMarkup, /data-payment-status="PAID"/);

  const pendingMarkup = renderToStaticMarkup(React.createElement(CheckoutSessionStatus, {
    sessionId: "cs_pending",
    initialOrder: { id: 2, buildName: "Pending Build", amountEur: "1234.00", status: "CHECKOUT_CREATED" },
    lang: "en",
  }));
  assert.match(pendingMarkup, /Payment pending/);
  assert.match(pendingMarkup, /data-payment-status="CHECKOUT_CREATED"/);
});

test("admin audit endpoint rejects unauthenticated and invalid bearer requests but accepts ADMIN_API_TOKEN", async () => {
  const oldToken = process.env.ADMIN_API_TOKEN;
  try {
    delete process.env.ADMIN_API_TOKEN;

    const route = await import("../src/app/api/db/audit/route");
    const unauthenticated = await route.GET(new Request("https://example.test/api/db/audit"));
    assert.equal(unauthenticated.status, 401);

    process.env.ADMIN_API_TOKEN = "correct-admin-token";
    const invalidBearer = await route.GET(new Request("https://example.test/api/db/audit", {
      headers: { authorization: "Bearer wrong-token" },
    }));
    assert.equal(invalidBearer.status, 401);

    const validBearer = await route.GET(new Request("https://example.test/api/db/audit", {
      headers: { authorization: "Bearer correct-admin-token" },
    }));
    assert.equal(validBearer.status, 200);
    assert.match((await validBearer.json() as { status: string }).status, /^(ok|warnings)$/);
  } finally {
    if (oldToken === undefined) delete process.env.ADMIN_API_TOKEN;
    else process.env.ADMIN_API_TOKEN = oldToken;
  }
});

test("structured logging helper redacts secrets, bearer tokens, and email addresses", async () => {
  const { logEvent, sanitizeLogText } = await import("../src/lib/server/structured-log");
  const redacted = sanitizeLogText("sk_live_secret pk_test_public whsec_hook Bearer admin-token buyer@example.test");
  assert.equal(redacted, "[redacted] [redacted] [redacted] [redacted] [redacted]");

  const lines = await captureConsoleOutput(["info"], async () => {
    logEvent({
      level: "info",
      event: "test_log_redaction",
      area: "test",
      reason: "buyer@example.test failed with whsec_hook and Bearer admin-token",
      orderId: 123,
    });
  });

  const serialized = lines.join("\n");
  assert.match(serialized, /test_log_redaction/);
  assert.match(serialized, /"orderId":123/);
  assert.doesNotMatch(serialized, /buyer@example\.test/);
  assert.doesNotMatch(serialized, /whsec_hook/);
  assert.doesNotMatch(serialized, /admin-token/);
});

test("checkout blocked logging records safe reason without PII or secrets", async () => {
  await seedHealthyPricingFreshness();
  await clearOpsHealthNoise();
  await db.getAdapter().execute("UPDATE estonian_price_checks SET checked_at = ?", ["2000-01-01T00:00:00.000Z"]);
  const restoreEnv = setPreviewCheckoutEnv();

  try {
    const lines = await captureConsoleOutput(["warn", "error"], async () => {
      const route = await import("../src/app/api/payments/checkout/route");
      const response = await route.POST(new Request("https://example.test/api/payments/checkout", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://example.test",
          "sec-fetch-site": "same-origin",
          "x-forwarded-for": "10.10.20.1",
          "x-vercel-id": "checkout-log-test",
        },
        body: JSON.stringify({ itemType: "gpu", itemId: 1 }),
      }));
      assert.equal(response.status, 409);
    });

    const serialized = lines.join("\n");
    assert.match(serialized, /checkout_blocked/);
    assert.match(serialized, /stale_pricing/);
    assert.match(serialized, /"itemType":"GPU"/);
    assert.doesNotMatch(serialized, /@example\.test/);
    assert.doesNotMatch(serialized, /sk_test_checkout/);
  } finally {
    restoreEnv();
  }
});

test("webhook failure logging omits secrets, signatures, and raw request body", async () => {
  const restoreEnv = setPreviewWebhookEnv();
  try {
    const lines = await captureConsoleOutput(["error"], async () => {
      const route = await import("../src/app/api/payments/webhook/route");
      const response = await route.POST(new Request("https://example.test/api/payments/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": "t=123,v1=bad_signature_whsec_super_secret",
          "x-forwarded-for": "10.10.20.2",
          "x-vercel-id": "webhook-log-test",
        },
        body: JSON.stringify({
          customer_email: "webhook-body@example.test",
          secret: "sk_test_body_secret",
          message: "raw-body-marker",
        }),
      }));
      assert.equal(response.status, 400);
    });

    const serialized = lines.join("\n");
    assert.match(serialized, /webhook_handling_failed/);
    assert.doesNotMatch(serialized, /webhook-body@example\.test/);
    assert.doesNotMatch(serialized, /sk_test_body_secret/);
    assert.doesNotMatch(serialized, /whsec_super_secret/);
    assert.doesNotMatch(serialized, /bad_signature_whsec_super_secret/);
    assert.doesNotMatch(serialized, /raw-body-marker/);
  } finally {
    restoreEnv();
  }
});

test("public health endpoint is cheap and does not expose operational diagnostics", async () => {
  await seedHealthyPricingFreshness();
  await clearOpsHealthNoise();
  const restoreEnv = setPreviewCheckoutEnv();

  try {
    const route = await import("../src/app/api/health/route");
    const response = await route.GET();

    assert.equal(response.status, 200);
    const payload = await response.json() as Record<string, unknown>;
    assert.equal(payload.ok, true);
    assert.equal(typeof payload.timestamp, "string");
    assert.equal(payload.pricingFresh, undefined);
    assert.equal(payload.checkoutAvailable, undefined);
    assert.equal(payload.recentWebhookFailures, undefined);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  } finally {
    restoreEnv();
  }
});

test("public health endpoint stays liveness-only when pricing is stale", async () => {
  await seedHealthyPricingFreshness();
  await clearOpsHealthNoise();
  const restoreEnv = setPreviewCheckoutEnv();

  try {
    await db.getAdapter().execute("UPDATE estonian_price_checks SET checked_at = ?", ["2000-01-01T00:00:00.000Z"]);

    const route = await import("../src/app/api/health/route");
    const response = await route.GET();

    assert.equal(response.status, 200);
    const payload = await response.json() as Record<string, unknown>;
    assert.equal(payload.ok, true);
    assert.equal(payload.pricingFresh, undefined);
  } finally {
    restoreEnv();
  }
});

test("public health endpoint does not leak secrets or customer PII", async () => {
  await seedHealthyPricingFreshness();
  await clearOpsHealthNoise();
  const restoreEnv = setPreviewCheckoutEnv();
  const oldToken = process.env.ADMIN_API_TOKEN;
  const oldWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  try {
    process.env.ADMIN_API_TOKEN = "super-secret-admin-token";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_super_secret";
    const userId = await createTestUser("health-pii");
    await insertCheckoutCreatedOrder({ userId, checkoutSessionId: "cs_health_pii", status: "PAID", itemId: 91 });
    const now = new Date().toISOString();
    await db.getAdapter().execute(
      `UPDATE orders
       SET paid_at = ?, fulfilled_at = ?, customer_email_sent_at = ?, admin_email_sent_at = ?
       WHERE stripe_checkout_session_id = ?`,
      [now, now, now, now, "cs_health_pii"],
    );

    const route = await import("../src/app/api/health/route");
    const response = await route.GET();
    const serialized = JSON.stringify(await response.json());

    assert.doesNotMatch(serialized, /super-secret-admin-token/);
    assert.doesNotMatch(serialized, /whsec_/);
    assert.doesNotMatch(serialized, /health-pii/);
    assert.doesNotMatch(serialized, /@example\.test/);
    assert.doesNotMatch(serialized, /cs_health_pii/);
  } finally {
    if (oldToken === undefined) delete process.env.ADMIN_API_TOKEN;
    else process.env.ADMIN_API_TOKEN = oldToken;
    if (oldWebhookSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = oldWebhookSecret;
    restoreEnv();
  }
});

test("security headers include report-only CSP, HSTS, and no-store sensitive route rules", async () => {
  const { default: nextConfig } = await import("../next.config");
  assert.ok(nextConfig.headers);
  const headerRules = await nextConfig.headers();
  const globalRule = headerRules.find((rule) => rule.source === "/:path*");
  assert.ok(globalRule);
  assert.ok(globalRule.headers.some((header) => header.key === "Strict-Transport-Security"));
  assert.ok(globalRule.headers.some((header) => header.key === "Content-Security-Policy-Report-Only"));

  for (const source of ["/api/admin/:path*", "/api/auth/:path*", "/api/payments/:path*", "/orders/:path*", "/checkout/:path*"]) {
    const rule = headerRules.find((candidate) => candidate.source === source);
    assert.ok(rule, `${source} should have an explicit no-store header rule`);
    assert.ok(rule.headers.some((header) => header.key === "Cache-Control" && header.value.includes("no-store")));
  }
});

test("admin health degradation logging does not leak customer PII", async () => {
  await seedHealthyPricingFreshness();
  await clearOpsHealthNoise();
  const restoreEnv = setPreviewCheckoutEnv();
  const oldToken = process.env.ADMIN_API_TOKEN;

  try {
    process.env.ADMIN_API_TOKEN = "admin-health-log-token";
    const userId = await createTestUser("health-log-pii");
    await insertCheckoutCreatedOrder({ userId, checkoutSessionId: "cs_health_log_pii", status: "PAID", itemId: 92 });
    const now = new Date().toISOString();
    await db.getAdapter().execute(
      "UPDATE orders SET paid_at = ?, fulfilled_at = ?, customer_email_sent_at = NULL, admin_email_sent_at = ? WHERE stripe_checkout_session_id = ?",
      [now, now, now, "cs_health_log_pii"],
    );

    const lines = await captureConsoleOutput(["warn"], async () => {
      const route = await import("../src/app/api/admin/health/route");
      const response = await route.GET(new Request("https://example.test/api/admin/health", {
        headers: {
          authorization: "Bearer admin-health-log-token",
          "x-vercel-id": "health-log-test",
        },
      }));
      assert.equal(response.status, 503);
    });

    const serialized = lines.join("\n");
    assert.match(serialized, /admin_health_degraded/);
    assert.match(serialized, /paid_email_retries_pending/);
    assert.doesNotMatch(serialized, /health-log-pii/);
    assert.doesNotMatch(serialized, /@example\.test/);
    assert.doesNotMatch(serialized, /cs_health_log_pii/);
  } finally {
    if (oldToken === undefined) delete process.env.ADMIN_API_TOKEN;
    else process.env.ADMIN_API_TOKEN = oldToken;
    restoreEnv();
  }
});

test("admin diagnostics require authorization and return operational detail", async () => {
  await seedHealthyPricingFreshness();
  await clearOpsHealthNoise();
  const oldToken = process.env.ADMIN_API_TOKEN;
  const restoreEnv = setPreviewCheckoutEnv();

  try {
    delete process.env.ADMIN_API_TOKEN;
    const route = await import("../src/app/api/admin/diagnostics/route");
    const missing = await route.GET(new Request("https://example.test/api/admin/diagnostics"));
    assert.equal(missing.status, 401);

    process.env.ADMIN_API_TOKEN = "diagnostics-token";
    const invalid = await route.GET(new Request("https://example.test/api/admin/diagnostics", {
      headers: { authorization: "Bearer wrong-token" },
    }));
    assert.equal(invalid.status, 401);

    const valid = await route.GET(new Request("https://example.test/api/admin/diagnostics", {
      headers: { authorization: "Bearer diagnostics-token" },
    }));
    assert.equal(valid.status, 200);
    const payload = await valid.json() as Record<string, unknown>;
    assert.ok(payload.health);
    assert.ok(payload.pricing);
    assert.ok(payload.payments);
  } finally {
    if (oldToken === undefined) delete process.env.ADMIN_API_TOKEN;
    else process.env.ADMIN_API_TOKEN = oldToken;
    restoreEnv();
  }
});

test("admin health requires authorization and returns operational summary", async () => {
  await seedHealthyPricingFreshness();
  await clearOpsHealthNoise();
  const oldToken = process.env.ADMIN_API_TOKEN;
  const restoreEnv = setPreviewCheckoutEnv();

  try {
    delete process.env.ADMIN_API_TOKEN;
    const route = await import("../src/app/api/admin/health/route");
    const missing = await route.GET(new Request("https://example.test/api/admin/health"));
    assert.equal(missing.status, 401);

    process.env.ADMIN_API_TOKEN = "admin-health-token";
    const valid = await route.GET(new Request("https://example.test/api/admin/health", {
      headers: { authorization: "Bearer admin-health-token" },
    }));
    assert.equal(valid.status, 200);
    const payload = await valid.json() as Record<string, unknown>;
    assert.equal(payload.status, "healthy");
    assert.equal(payload.pricingFresh, true);
    assert.equal(payload.checkoutAvailable, true);
  } finally {
    if (oldToken === undefined) delete process.env.ADMIN_API_TOKEN;
    else process.env.ADMIN_API_TOKEN = oldToken;
    restoreEnv();
  }
});

test("admin operations service and UI show email repair state without full customer PII", async () => {
  await seedHealthyPricingFreshness();
  await clearOpsHealthNoise();
  const userId = await createTestUser("admin-ops-customer");
  const retryOrderId = await insertCheckoutCreatedOrder({
    userId,
    checkoutSessionId: "cs_admin_ops_retry",
    status: "PAID",
    itemId: 71,
  });
  const completeOrderId = await insertCheckoutCreatedOrder({
    userId,
    checkoutSessionId: "cs_admin_ops_complete",
    status: "PAID",
    itemId: 72,
  });
  const now = new Date().toISOString();
  await db.getAdapter().execute(
    `UPDATE orders
     SET paid_at = ?, fulfilled_at = ?, customer_email_sent_at = NULL, admin_email_sent_at = ?,
         customer_email_last_error = ?
     WHERE id = ?`,
    [now, now, now, "temporary smtp failure for admin ops test", retryOrderId],
  );
  await db.getAdapter().execute(
    "UPDATE orders SET paid_at = ?, fulfilled_at = ?, customer_email_sent_at = ?, admin_email_sent_at = ? WHERE id = ?",
    [now, now, now, now, completeOrderId],
  );
  const quote = await db.createQuoteRequest({
    customerEmail: "sensitive.quote.customer@example.test",
    customerName: "Sensitive Quote Customer",
    productType: "mac_system",
    productId: 1,
    message: "Need a quote for a private AI compute setup.",
  });
  if (!quote.ok) throw new Error("quote request should be created");

  const { getAdminOperationsView } = await import("../src/lib/server/order-service");
  const data = await getAdminOperationsView();
  const retryOrder = data.orders.find((order) => order.id === retryOrderId);
  const completeOrder = data.orders.find((order) => order.id === completeOrderId);
  assert.ok(retryOrder);
  assert.ok(completeOrder);
  assert.equal(retryOrder.canRetryPaidEmails, true);
  assert.equal(completeOrder.canRetryPaidEmails, false);
  assert.equal(retryOrder.customerEmail.sentAt, null);
  assert.match(retryOrder.customerEmail.lastError, /temporary smtp failure/);
  assert.doesNotMatch(retryOrder.customerContact, /admin-ops-customer/);
  assert.match(retryOrder.checkoutSessionRef ?? "", /^cs_adm\.\.\./);

  const quoteRow = data.quotes.find((item) => item.id === quote.quoteRequest.id);
  assert.ok(quoteRow);
  assert.equal(quoteRow.customer, "SQ");
  assert.doesNotMatch(quoteRow.contact, /sensitive\.quote\.customer/);

  const { AdminOperationsView } = await import("../src/components/admin-operations-view");
  const markup = renderToStaticMarkup(React.createElement(AdminOperationsView, { data }));
  assert.match(markup, /Retry missing emails/);
  assert.match(markup, /No email repair available/);
  assert.match(markup, /Pending email retries/);
  assert.match(markup, /Recent quote requests/);
  assert.doesNotMatch(markup, /admin-ops-customer/);
  assert.doesNotMatch(markup, /sensitive\.quote\.customer@example\.test/);
  assert.doesNotMatch(markup, /Sensitive Quote Customer/);
  assert.doesNotMatch(markup, /Need a quote for a private AI compute setup/);
});

test("admin can update quote status and operator note without exposing contact by default", async () => {
  const oldToken = process.env.ADMIN_API_TOKEN;
  try {
    process.env.ADMIN_API_TOKEN = "quote-update-token";
    const quote = await db.createQuoteRequest({
      customerEmail: "quote-update-customer@example.test",
      customerName: "Quote Update Customer",
      productType: "mac_system",
      productId: 1,
      message: "Need a quote for a private update workflow.",
    });
    if (!quote.ok) throw new Error("quote request should be created");

    const route = await import("../src/app/api/admin/quote-requests/route");
    const longNote = `<script>alert("x")</script> ${"internal note ".repeat(80)}`;
    const response = await route.PATCH(new Request("https://example.test/api/admin/quote-requests", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer quote-update-token",
      },
      body: JSON.stringify({
        quoteRequestId: quote.quoteRequest.id,
        status: "CONTACTED",
        operatorNote: longNote,
      }),
    }));

    assert.equal(response.status, 200);
    const payload = await response.json() as {
      quoteRequest: { status: string; operatorNote: string; contactedAt: string | null };
    };
    assert.equal(payload.quoteRequest.status, "CONTACTED");
    assert.ok(payload.quoteRequest.contactedAt);
    assert.equal(payload.quoteRequest.operatorNote.length, 500);

    const { getAdminOperationsView } = await import("../src/lib/server/order-service");
    const data = await getAdminOperationsView();
    const quoteRow = data.quotes.find((item) => item.id === quote.quoteRequest.id);
    assert.ok(quoteRow);
    assert.equal(quoteRow.status, "CONTACTED");
    assert.match(quoteRow.notePreview, /<script>/);
    assert.doesNotMatch(quoteRow.contact, /quote-update-customer/);

    const { AdminOperationsView } = await import("../src/components/admin-operations-view");
    const markup = renderToStaticMarkup(React.createElement(AdminOperationsView, { data }));
    assert.match(markup, /Save quote state/);
    assert.match(markup, /Reveal contact/);
    assert.match(markup, /&lt;script&gt;/);
    assert.doesNotMatch(markup, /quote-update-customer@example\.test/);
    assert.doesNotMatch(markup, /Quote Update Customer/);
    assert.doesNotMatch(markup, /Need a quote for a private update workflow/);
  } finally {
    if (oldToken === undefined) delete process.env.ADMIN_API_TOKEN;
    else process.env.ADMIN_API_TOKEN = oldToken;
  }
});

test("quote status updates reject unauthenticated, invalid status, and invalid transitions", async () => {
  const oldToken = process.env.ADMIN_API_TOKEN;
  try {
    process.env.ADMIN_API_TOKEN = "quote-invalid-token";
    const quote = await db.createQuoteRequest({
      customerEmail: "quote-invalid-customer@example.test",
      customerName: "Quote Invalid Customer",
      productType: "mac_system",
      productId: 1,
      message: "Need a quote for invalid transition testing.",
    });
    if (!quote.ok) throw new Error("quote request should be created");

    const route = await import("../src/app/api/admin/quote-requests/route");
    const makeRequest = (body: Record<string, unknown>, headers: Record<string, string> = {}) => route.PATCH(new Request("https://example.test/api/admin/quote-requests", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    }));

    const unauthenticated = await makeRequest({ quoteRequestId: quote.quoteRequest.id, status: "CONTACTED" });
    assert.equal(unauthenticated.status, 401);

    const invalidStatus = await makeRequest(
      { quoteRequestId: quote.quoteRequest.id, status: "IN_REVIEW" },
      { authorization: "Bearer quote-invalid-token" },
    );
    assert.equal(invalidStatus.status, 400);
    assert.match((await invalidStatus.json() as { message: string }).message, /Invalid quote request status/);

    const first = await makeRequest(
      { quoteRequestId: quote.quoteRequest.id, status: "CONTACTED" },
      { authorization: "Bearer quote-invalid-token" },
    );
    assert.equal(first.status, 200);

    const invalidTransition = await makeRequest(
      { quoteRequestId: quote.quoteRequest.id, status: "NEW" },
      { authorization: "Bearer quote-invalid-token" },
    );
    assert.equal(invalidTransition.status, 400);
    assert.match((await invalidTransition.json() as { message: string }).message, /Invalid status transition/);
  } finally {
    if (oldToken === undefined) delete process.env.ADMIN_API_TOKEN;
    else process.env.ADMIN_API_TOKEN = oldToken;
  }
});

test("quote contact reveal requires admin session and logs without revealed contact", async () => {
  const oldToken = process.env.ADMIN_API_TOKEN;
  try {
    process.env.ADMIN_API_TOKEN = "quote-reveal-token";
    const quote = await db.createQuoteRequest({
      customerEmail: "quote-reveal-customer@example.test",
      customerName: "Quote Reveal Customer",
      productType: "mac_system",
      productId: 1,
      message: "Need a quote for reveal testing.",
    });
    if (!quote.ok) throw new Error("quote request should be created");

    const route = await import("../src/app/api/admin/quote-requests/reveal/route");
    const unauthenticated = await route.POST(new Request("https://example.test/api/admin/quote-requests/reveal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quoteRequestId: quote.quoteRequest.id }),
    }));
    assert.equal(unauthenticated.status, 401);

    const bearer = await route.POST(new Request("https://example.test/api/admin/quote-requests/reveal", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer quote-reveal-token",
      },
      body: JSON.stringify({ quoteRequestId: quote.quoteRequest.id }),
    }));
    assert.equal(bearer.status, 403);
    assert.match((await bearer.json() as { message: string }).message, /Admin session required/);

    const contact = await db.getQuoteRequestContactForAdmin(quote.quoteRequest.id);
    assert.equal(contact?.customer_email, "quote-reveal-customer@example.test");

    const routeSource = readFileSync(join(process.cwd(), "src/app/api/admin/quote-requests/reveal/route.ts"), "utf8");
    assert.match(routeSource, /auth\.actor !== "session"/);
    assert.match(routeSource, /requestOriginIsAllowed/);
    assert.match(routeSource, /quote_request_contact_revealed/);
    const revealLogStart = routeSource.indexOf("quote_request_contact_revealed");
    const revealLogEnd = routeSource.indexOf("return NextResponse.json", revealLogStart);
    const revealLogBlock = routeSource.slice(revealLogStart, revealLogEnd);
    assert.doesNotMatch(revealLogBlock, /customer_email|customer_name|customerEmail|customerName/);
  } finally {
    if (oldToken === undefined) delete process.env.ADMIN_API_TOKEN;
    else process.env.ADMIN_API_TOKEN = oldToken;
  }
});

test("quote status counts appear in diagnostics without quote PII", async () => {
  const oldToken = process.env.ADMIN_API_TOKEN;
  try {
    process.env.ADMIN_API_TOKEN = "quote-diagnostics-token";
    const quote = await db.createQuoteRequest({
      customerEmail: "quote-diagnostics-customer@example.test",
      customerName: "Quote Diagnostics Customer",
      productType: "mac_system",
      productId: 1,
      message: "Need a quote for diagnostics testing.",
    });
    if (!quote.ok) throw new Error("quote request should be created");

    const route = await import("../src/app/api/admin/diagnostics/route");
    const response = await route.GET(new Request("https://example.test/api/admin/diagnostics", {
      headers: { authorization: "Bearer quote-diagnostics-token" },
    }));
    assert.ok(response.status === 200 || response.status === 503);
    const serialized = JSON.stringify(await response.json());
    assert.match(serialized, /statusCounts/);
    assert.match(serialized, /"NEW"/);
    assert.doesNotMatch(serialized, /quote-diagnostics-customer/);
    assert.doesNotMatch(serialized, /Quote Diagnostics Customer/);
    assert.doesNotMatch(serialized, /diagnostics testing/);
  } finally {
    if (oldToken === undefined) delete process.env.ADMIN_API_TOKEN;
    else process.env.ADMIN_API_TOKEN = oldToken;
  }
});

test("pricing freshness endpoint returns unhealthy when today history is missing", async () => {
  const oldToken = process.env.ADMIN_API_TOKEN;
  try {
    process.env.ADMIN_API_TOKEN = "freshness-token";
    await db.getAdapter().execute("DELETE FROM price_history");
    await db.getAdapter().execute("DELETE FROM pricing_run_failures");
    await db.getAdapter().execute("DELETE FROM pricing_runs");

    const route = await import("../src/app/api/db/pricing-freshness/route");
    const response = await route.GET(new Request("https://example.test/api/db/pricing-freshness", {
      headers: { authorization: "Bearer freshness-token" },
    }));

    assert.equal(response.status, 503);
    const payload = await response.json() as { healthy: boolean; errors: string[]; graphCoveragePct: number };
    assert.equal(payload.healthy, false);
    assert.ok(payload.errors.some((error) => error.includes("missing today's UTC price_history row")));
    assert.equal(payload.graphCoveragePct, 0);
  } finally {
    if (oldToken === undefined) delete process.env.ADMIN_API_TOKEN;
    else process.env.ADMIN_API_TOKEN = oldToken;
  }
});

test("pricing freshness endpoint rejects unauthorized monitor calls", async () => {
  const oldToken = process.env.ADMIN_API_TOKEN;
  try {
    process.env.ADMIN_API_TOKEN = "freshness-auth-token";
    const route = await import("../src/app/api/db/pricing-freshness/route");

    const missing = await route.GET(new Request("https://example.test/api/db/pricing-freshness?summary=1"));
    assert.equal(missing.status, 401);

    const invalid = await route.GET(new Request("https://example.test/api/db/pricing-freshness?summary=1", {
      headers: { authorization: "Bearer wrong-token" },
    }));
    assert.equal(invalid.status, 401);
  } finally {
    if (oldToken === undefined) delete process.env.ADMIN_API_TOKEN;
    else process.env.ADMIN_API_TOKEN = oldToken;
  }
});

test("pricing freshness endpoint returns 200 for healthy data", async () => {
  const oldToken = process.env.ADMIN_API_TOKEN;
  try {
    process.env.ADMIN_API_TOKEN = "freshness-healthy-token";
    await seedHealthyPricingFreshness();

    const route = await import("../src/app/api/db/pricing-freshness/route");
    const response = await route.GET(new Request("https://example.test/api/db/pricing-freshness", {
      headers: { authorization: "Bearer freshness-healthy-token" },
    }));

    assert.equal(response.status, 200);
    const payload = await response.json() as {
      healthy: boolean;
      graphCoveragePct: number;
      missingTodayCount: number;
      stale24hCount: number;
      staleChecks24hCount: number;
    };
    assert.equal(payload.healthy, true);
    assert.equal(payload.graphCoveragePct, 100);
    assert.equal(payload.missingTodayCount, 0);
    assert.equal(payload.stale24hCount, 0);
    assert.equal(payload.staleChecks24hCount, 0);
  } finally {
    if (oldToken === undefined) delete process.env.ADMIN_API_TOKEN;
    else process.env.ADMIN_API_TOKEN = oldToken;
  }
});

test("pricing freshness summary mode is compact and monitor-safe", async () => {
  const oldToken = process.env.ADMIN_API_TOKEN;
  try {
    process.env.ADMIN_API_TOKEN = "freshness-summary-token";
    await seedHealthyPricingFreshness();

    const route = await import("../src/app/api/db/pricing-freshness/route");
    const response = await route.GET(new Request("https://example.test/api/db/pricing-freshness?summary=1", {
      headers: { authorization: "Bearer freshness-summary-token" },
    }));

    assert.equal(response.status, 200);
    const payload = await response.json() as Record<string, unknown>;
    assert.deepEqual(Object.keys(payload).sort(), [
      "background_coverage_pct",
      "coverage_pct",
      "critical_coverage_pct",
      "freshness_ok",
      "last_success_at",
      "missing_count",
      "status",
    ].sort());
    assert.deepEqual(payload, {
      status: "healthy",
      last_success_at: payload.last_success_at,
      freshness_ok: true,
      coverage_pct: 100,
      critical_coverage_pct: 100,
      background_coverage_pct: 100,
      missing_count: 0,
    });
    assert.equal(typeof payload.last_success_at, "string");
    assert.equal("missingToday" in payload, false);
    assert.equal("latestFailures" in payload, false);
    assert.equal("latestRun" in payload, false);
    assert.equal("errors" in payload, false);
  } finally {
    if (oldToken === undefined) delete process.env.ADMIN_API_TOKEN;
    else process.env.ADMIN_API_TOKEN = oldToken;
  }
});

test("graph history query normalizes legacy mac_systems category requests", async () => {
  const mac = await db.getMacSystemById(1);
  assert.ok(mac);
  await db.insertPriceHistory("mac_system", mac.id, mac.estimated_price_eur, `Retailer €${mac.estimated_price_eur} match=2/2`);

  const rows = await db.getPriceHistory("mac_systems", mac.id, 30);
  assert.ok(rows.length > 0);
  assert.equal(rows[0].category, "mac_system");
});

test("price history dedupe maintenance removes duplicate rows and recreates the unique day index", async () => {
  await db.getAdapter().execute("DROP INDEX IF EXISTS idx_price_history_day_dedupe");
  await db.getAdapter().execute(
    "INSERT INTO price_history (category, item_id, price_eur, recorded_at, recorded_date, source) VALUES (?, ?, ?, ?, ?, ?)",
    ["gpu", 909090, 100, "2026-05-04T08:00:00.000Z", "2026-05-04", "Legacy source"],
  );
  await db.getAdapter().execute(
    "INSERT INTO price_history (category, item_id, price_eur, recorded_at, recorded_date, source) VALUES (?, ?, ?, ?, ?, ?)",
    ["gpu", 909090, 120, "2026-05-04T09:00:00.000Z", "2026-05-04", "Trusted source €120 match=2/2"],
  );

  const { hardenPriceHistoryDedupe } = await import("../src/lib/db/migrations");
  await hardenPriceHistoryDedupe(db.getAdapter());

  const rows = await db.getAdapter().queryAll<{ price_eur: number; source: string }>(
    "SELECT price_eur, source FROM price_history WHERE category = ? AND item_id = ?",
    ["gpu", 909090],
  );
  assert.deepEqual(
    rows.map((row) => ({ price_eur: row.price_eur, source: row.source })),
    [{ price_eur: 120, source: "Trusted source €120 match=2/2" }],
  );

  const row = await db.getAdapter().queryOne<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_price_history_day_dedupe' LIMIT 1",
  );
  assert.equal(row?.name, "idx_price_history_day_dedupe");
});

test("stale expired checkout order is terminalized before a new order is created", async () => {
  const { resolveOpenCheckoutOrderForReuse } = await import("../src/lib/server/checkout-reuse");
  const userId = await createTestUser("stale-expired");
  const oldCreatedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const oldOrderId = await insertCheckoutCreatedOrder({
    userId,
    checkoutSessionId: "cs_stale_expired",
    itemId: 1,
    createdAt: oldCreatedAt,
  });
  const oldOrder = await db.getOrderByCheckoutSession("cs_stale_expired");

  const decision = await resolveOpenCheckoutOrderForReuse({
    order: oldOrder,
    retrieveCheckoutSession: async () => ({ status: "expired", url: null }),
    markOrderCanceled: db.markOrderCanceledFromCheckoutSession,
    markOrderFailed: db.markOrderCheckoutCreationFailed,
  });

  const terminalOldOrder = await db.getOrderById(oldOrderId);
  const replacement = await db.createPendingOrderForCatalogItem({ userId, itemType: "GPU", itemId: 1 });

  assert.deepEqual(decision, { action: "create_order" });
  assert.equal(terminalOldOrder?.status, "CANCELED");
  assert.equal(replacement.ok, true);
  if (!replacement.ok) throw new Error("replacement should be created");
  assert.notEqual(replacement.orderId, oldOrderId);
});

test("recent valid open checkout session is reused safely", async () => {
  const { resolveOpenCheckoutOrderForReuse } = await import("../src/lib/server/checkout-reuse");
  const userId = await createTestUser("recent-valid");
  await insertCheckoutCreatedOrder({
    userId,
    checkoutSessionId: "cs_recent_valid",
    itemId: 1,
  });
  const openOrder = await db.getOrderByCheckoutSession("cs_recent_valid");

  const decision = await resolveOpenCheckoutOrderForReuse({
    order: openOrder,
    retrieveCheckoutSession: async () => ({ status: "open", url: "https://checkout.stripe.test/reuse" }),
    markOrderCanceled: db.markOrderCanceledFromCheckoutSession,
    markOrderFailed: db.markOrderCheckoutCreationFailed,
  });

  assert.deepEqual(decision, {
    action: "reuse_session",
    checkoutUrl: "https://checkout.stripe.test/reuse",
  });
});

test("missing Stripe checkout session terminalizes the old order and allows replacement", async () => {
  const { resolveOpenCheckoutOrderForReuse } = await import("../src/lib/server/checkout-reuse");
  const userId = await createTestUser("missing-stripe-session");
  const oldOrderId = await insertCheckoutCreatedOrder({
    userId,
    checkoutSessionId: "cs_missing_remote",
    itemId: 1,
  });
  const oldOrder = await db.getOrderByCheckoutSession("cs_missing_remote");

  const decision = await resolveOpenCheckoutOrderForReuse({
    order: oldOrder,
    retrieveCheckoutSession: async () => {
      throw { code: "resource_missing" };
    },
    markOrderCanceled: db.markOrderCanceledFromCheckoutSession,
    markOrderFailed: db.markOrderCheckoutCreationFailed,
  });

  const terminalOldOrder = await db.getOrderById(oldOrderId);
  const replacement = await db.createPendingOrderForCatalogItem({ userId, itemType: "GPU", itemId: 1 });

  assert.deepEqual(decision, { action: "create_order" });
  assert.equal(terminalOldOrder?.status, "FAILED");
  assert.equal(replacement.ok, true);
  if (!replacement.ok) throw new Error("replacement should be created");
  assert.notEqual(replacement.orderId, oldOrderId);
});

test("order creation writes direct-item price snapshot with the order", async () => {
  const userId = await createTestUser("snapshot-transaction");
  const order = await db.createPendingOrderForCatalogItem({ userId, itemType: "STORAGE_DRIVE", itemId: 1 });
  assert.equal(order.ok, true);
  if (!order.ok) throw new Error("order should be created");

  const snapshot = await db.getAdapter().queryOne<{ id: number; cnt: number }>(
    "SELECT MIN(id) AS id, COUNT(*) AS cnt FROM order_price_snapshots WHERE order_id = ?",
    [order.orderId],
  );
  assert.ok(snapshot);
  assert.equal(snapshot.cnt, 1);
  assert.ok(snapshot.id > 0);
});

test("paid fulfillment sends customer and admin email once across concurrent calls", async () => {
  const nodemailerModule = await import("nodemailer");
  const nodemailer = nodemailerModule.default;
  const originalCreateTransport = nodemailer.createTransport;
  const sent: Array<{ to?: string; subject?: string }> = [];

  (nodemailer as typeof nodemailer & { createTransport: unknown }).createTransport = (() => ({
    sendMail: async (mail: { to?: string; subject?: string }) => {
      sent.push({ to: mail.to, subject: mail.subject });
      return {};
    },
  })) as typeof nodemailer.createTransport;

  const oldEnv = {
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASS: process.env.SMTP_PASS,
    SMTP_FROM_EMAIL: process.env.SMTP_FROM_EMAIL,
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
  };

  process.env.SMTP_HOST = "smtp.example.test";
  process.env.SMTP_PORT = "587";
  process.env.SMTP_USER = "smtp-user";
  process.env.SMTP_PASS = "smtp-pass";
  process.env.SMTP_FROM_EMAIL = "orders@example.test";
  process.env.ADMIN_EMAIL = "admin@example.test";

  try {
    const userId = await createTestUser("paid-email");
    await insertCheckoutCreatedOrder({ userId, checkoutSessionId: "cs_email_once" });
    const { fulfillPaidCheckoutSession } = await import("../src/lib/server/payment-fulfillment");
    const emailPayload = await db.getPaidOrderEmailPayloadByCheckoutSession("cs_email_once");
    assert.ok(emailPayload);
    assert.equal(emailPayload.buildName, "Email Test GPU");
    assert.match(emailPayload.customerEmail, /paid-email/);

    const [first, second] = await Promise.all([
      fulfillPaidCheckoutSession({ checkoutSessionId: "cs_email_once", paymentIntentId: "pi_email_once" }),
      fulfillPaidCheckoutSession({ checkoutSessionId: "cs_email_once", paymentIntentId: "pi_email_once" }),
    ]);
    const order = await db.getOrderByCheckoutSession("cs_email_once");

    assert.equal(order?.status, "PAID");
    assert.ok(order?.paid_at);
    assert.ok(order?.fulfilled_at);
    assert.ok(order?.customer_email_sent_at);
    assert.ok(order?.admin_email_sent_at);
    assert.equal([first, second].filter((result) => result.customerEmailSent).length, 1);
    assert.equal([first, second].filter((result) => result.adminEmailSent).length, 1);
    assert.equal([first, second].filter((result) => result.alreadyPaid).length, 1);
    assert.equal(sent.length, 2);
    assert.equal(sent.filter((mail) => mail.to === "admin@example.test").length, 1);
  } finally {
    nodemailer.createTransport = originalCreateTransport;
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("paid order email rendering tolerates missing optional display fields", async () => {
  const nodemailerModule = await import("nodemailer");
  const nodemailer = nodemailerModule.default;
  const originalCreateTransport = nodemailer.createTransport;
  const sent: Array<{ to?: string; subject?: string; html?: string }> = [];

  (nodemailer as typeof nodemailer & { createTransport: unknown }).createTransport = (() => ({
    sendMail: async (mail: { to?: string; subject?: string; html?: string }) => {
      sent.push({ to: mail.to, subject: mail.subject, html: mail.html });
      return {};
    },
  })) as typeof nodemailer.createTransport;

  const oldEnv = {
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASS: process.env.SMTP_PASS,
    SMTP_FROM_EMAIL: process.env.SMTP_FROM_EMAIL,
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
  };

  process.env.SMTP_HOST = "smtp.example.test";
  process.env.SMTP_PORT = "465";
  process.env.SMTP_USER = "smtp-user";
  process.env.SMTP_PASS = "smtp-pass";
  process.env.SMTP_FROM_EMAIL = "orders@example.test";
  process.env.ADMIN_EMAIL = "admin@example.test";

  try {
    const { sendAdminPaymentNotificationEmail, sendPaymentConfirmationEmail } = await import("../src/lib/payment-email");

    const customer = await sendPaymentConfirmationEmail({
      to: "buyer@example.test",
      orderId: 42,
      buildName: undefined,
      amountEurCents: undefined,
      createdAt: undefined,
    } as unknown as Parameters<typeof sendPaymentConfirmationEmail>[0]);
    const admin = await sendAdminPaymentNotificationEmail({
      orderId: 42,
      buildName: undefined,
      amountEurCents: undefined,
      createdAt: undefined,
    } as unknown as Parameters<typeof sendAdminPaymentNotificationEmail>[0]);

    assert.equal(customer.sent, true);
    assert.equal(admin.sent, true);
    assert.equal(sent.length, 2);
    assert.match(sent[0].html ?? "", /Order item/);
    assert.match(sent[0].html ?? "", /Unavailable/);
    assert.match(sent[0].html ?? "", /EUR unknown/);
    assert.match(sent[1].subject ?? "", /Paid order #42: Order item/);
  } finally {
    nodemailer.createTransport = originalCreateTransport;
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("paid customer email skips invalid recipient without rendering", async () => {
  const oldEnv = {
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASS: process.env.SMTP_PASS,
    SMTP_FROM_EMAIL: process.env.SMTP_FROM_EMAIL,
  };

  process.env.SMTP_HOST = "smtp.example.test";
  process.env.SMTP_PORT = "465";
  process.env.SMTP_USER = "smtp-user";
  process.env.SMTP_PASS = "smtp-pass";
  process.env.SMTP_FROM_EMAIL = "orders@example.test";

  try {
    const { sendPaymentConfirmationEmail } = await import("../src/lib/payment-email");
    const result = await sendPaymentConfirmationEmail({
      to: undefined,
      orderId: 43,
      buildName: "Test Build",
      amountEurCents: 123400,
      createdAt: "2026-05-06T10:00:00.000Z",
    } as unknown as Parameters<typeof sendPaymentConfirmationEmail>[0]);

    assert.deepEqual(result, { sent: false, reason: "recipient missing" });
  } finally {
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("session-status and webhook shared fulfillment overlap sends emails once", async () => {
  const nodemailerModule = await import("nodemailer");
  const nodemailer = nodemailerModule.default;
  const originalCreateTransport = nodemailer.createTransport;
  const sent: Array<{ to?: string; subject?: string }> = [];

  (nodemailer as typeof nodemailer & { createTransport: unknown }).createTransport = (() => ({
    sendMail: async (mail: { to?: string; subject?: string }) => {
      sent.push({ to: mail.to, subject: mail.subject });
      return {};
    },
  })) as typeof nodemailer.createTransport;

  const oldEnv = {
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASS: process.env.SMTP_PASS,
    SMTP_FROM_EMAIL: process.env.SMTP_FROM_EMAIL,
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
  };

  process.env.SMTP_HOST = "smtp.example.test";
  process.env.SMTP_PORT = "587";
  process.env.SMTP_USER = "smtp-user";
  process.env.SMTP_PASS = "smtp-pass";
  process.env.SMTP_FROM_EMAIL = "orders@example.test";
  process.env.ADMIN_EMAIL = "admin@example.test";

  try {
    const userId = await createTestUser("overlap-email");
    await insertCheckoutCreatedOrder({ userId, checkoutSessionId: "cs_overlap_once", itemId: 2 });
    const { fulfillPaidCheckoutSession } = await import("../src/lib/server/payment-fulfillment");

    const [webhookLike, sessionStatusLike] = await Promise.all([
      fulfillPaidCheckoutSession({ checkoutSessionId: "cs_overlap_once", paymentIntentId: "pi_overlap_once" }),
      fulfillPaidCheckoutSession({ checkoutSessionId: "cs_overlap_once", paymentIntentId: "pi_overlap_once" }),
    ]);

    assert.equal([webhookLike, sessionStatusLike].filter((result) => result.fulfilled).length, 1);
    assert.equal(sent.length, 2);
    assert.equal(sent.filter((mail) => mail.to === "admin@example.test").length, 1);
  } finally {
    nodemailer.createTransport = originalCreateTransport;
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("missing admin email does not fail paid fulfillment or customer email", async () => {
  const nodemailerModule = await import("nodemailer");
  const nodemailer = nodemailerModule.default;
  const originalCreateTransport = nodemailer.createTransport;
  const sent: Array<{ to?: string; subject?: string }> = [];

  (nodemailer as typeof nodemailer & { createTransport: unknown }).createTransport = (() => ({
    sendMail: async (mail: { to?: string; subject?: string }) => {
      sent.push({ to: mail.to, subject: mail.subject });
      return {};
    },
  })) as typeof nodemailer.createTransport;

  const oldEnv = {
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASS: process.env.SMTP_PASS,
    SMTP_FROM_EMAIL: process.env.SMTP_FROM_EMAIL,
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
  };

  process.env.SMTP_HOST = "smtp.example.test";
  process.env.SMTP_PORT = "587";
  process.env.SMTP_USER = "smtp-user";
  process.env.SMTP_PASS = "smtp-pass";
  process.env.SMTP_FROM_EMAIL = "orders@example.test";
  delete process.env.ADMIN_EMAIL;

  try {
    const userId = await createTestUser("missing-admin-email");
    await insertCheckoutCreatedOrder({ userId, checkoutSessionId: "cs_missing_admin" });
    const { fulfillPaidCheckoutSession } = await import("../src/lib/server/payment-fulfillment");

    const result = await fulfillPaidCheckoutSession({ checkoutSessionId: "cs_missing_admin", paymentIntentId: "pi_missing_admin" });

    assert.equal(result.customerEmailSent, true);
    assert.equal(result.adminEmailSent, false);
    assert.equal(sent.length, 1);
    assert.match(sent[0].subject ?? "", /payment received/);
  } finally {
    nodemailer.createTransport = originalCreateTransport;
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("paid fulfillment retries missing customer email only", async () => {
  await withMockedPaymentEmailEnv(async (sent) => {
    const userId = await createTestUser("retry-customer-email");
    await insertCheckoutCreatedOrder({ userId, checkoutSessionId: "cs_retry_customer", status: "PAID", itemId: 4 });
    const now = new Date().toISOString();
    await db.getAdapter().execute(
      "UPDATE orders SET paid_at = ?, fulfilled_at = ?, customer_email_sent_at = NULL, admin_email_sent_at = ? WHERE stripe_checkout_session_id = ?",
      [now, now, now, "cs_retry_customer"],
    );

    const { fulfillPaidCheckoutSession } = await import("../src/lib/server/payment-fulfillment");
    const result = await fulfillPaidCheckoutSession({ checkoutSessionId: "cs_retry_customer", paymentIntentId: "pi_retry_customer" });
    const order = await db.getOrderByCheckoutSession("cs_retry_customer");

    assert.equal(result.alreadyPaid, true);
    assert.equal(result.customerEmailSent, true);
    assert.equal(result.adminEmailSent, false);
    assert.ok(order?.customer_email_sent_at);
    assert.ok(order?.admin_email_sent_at);
    assert.equal(sent.length, 1);
    assert.notEqual(sent[0].to, "admin@example.test");
  });
});

test("paid fulfillment retries missing admin email only", async () => {
  await withMockedPaymentEmailEnv(async (sent) => {
    const userId = await createTestUser("retry-admin-email");
    await insertCheckoutCreatedOrder({ userId, checkoutSessionId: "cs_retry_admin", status: "PAID", itemId: 5 });
    const now = new Date().toISOString();
    await db.getAdapter().execute(
      "UPDATE orders SET paid_at = ?, fulfilled_at = ?, customer_email_sent_at = ?, admin_email_sent_at = NULL WHERE stripe_checkout_session_id = ?",
      [now, now, now, "cs_retry_admin"],
    );

    const { fulfillPaidCheckoutSession } = await import("../src/lib/server/payment-fulfillment");
    const result = await fulfillPaidCheckoutSession({ checkoutSessionId: "cs_retry_admin", paymentIntentId: "pi_retry_admin" });
    const order = await db.getOrderByCheckoutSession("cs_retry_admin");

    assert.equal(result.alreadyPaid, true);
    assert.equal(result.customerEmailSent, false);
    assert.equal(result.adminEmailSent, true);
    assert.ok(order?.customer_email_sent_at);
    assert.ok(order?.admin_email_sent_at);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "admin@example.test");
  });
});

test("paid fulfillment does not resend fully emailed paid orders", async () => {
  await withMockedPaymentEmailEnv(async (sent) => {
    const userId = await createTestUser("retry-none-email");
    await insertCheckoutCreatedOrder({ userId, checkoutSessionId: "cs_retry_none", status: "PAID", itemId: 6 });
    const now = new Date().toISOString();
    await db.getAdapter().execute(
      "UPDATE orders SET paid_at = ?, fulfilled_at = ?, customer_email_sent_at = ?, admin_email_sent_at = ? WHERE stripe_checkout_session_id = ?",
      [now, now, now, now, "cs_retry_none"],
    );

    const { fulfillPaidCheckoutSession } = await import("../src/lib/server/payment-fulfillment");
    const result = await fulfillPaidCheckoutSession({ checkoutSessionId: "cs_retry_none", paymentIntentId: "pi_retry_none" });

    assert.equal(result.alreadyPaid, true);
    assert.equal(result.customerEmailSent, false);
    assert.equal(result.adminEmailSent, false);
    assert.equal(result.customerEmailReason, "already sent");
    assert.equal(result.adminEmailReason, "already sent");
    assert.equal(sent.length, 0);
  });
});

test("failed paid customer email can be retried safely after PAID state", async () => {
  let failCustomer = true;
  await withMockedPaymentEmailEnv(async (sent) => {
    const userId = await createTestUser("retry-failed-email");
    await insertCheckoutCreatedOrder({ userId, checkoutSessionId: "cs_retry_failed", status: "PAID", itemId: 7 });
    const now = new Date().toISOString();
    await db.getAdapter().execute(
      "UPDATE orders SET paid_at = ?, fulfilled_at = ?, customer_email_sent_at = NULL, admin_email_sent_at = ? WHERE stripe_checkout_session_id = ?",
      [now, now, now, "cs_retry_failed"],
    );

    const { fulfillPaidCheckoutSession } = await import("../src/lib/server/payment-fulfillment");
    const failed = await fulfillPaidCheckoutSession({ checkoutSessionId: "cs_retry_failed", paymentIntentId: "pi_retry_failed" });
    let order = await db.getOrderByCheckoutSession("cs_retry_failed");
    assert.equal(failed.customerEmailSent, false);
    assert.equal(order?.customer_email_sent_at, null);
    assert.match(order?.customer_email_last_error ?? "", /temporary customer failure/);

    failCustomer = false;
    const retried = await fulfillPaidCheckoutSession({ checkoutSessionId: "cs_retry_failed", paymentIntentId: "pi_retry_failed" });
    order = await db.getOrderByCheckoutSession("cs_retry_failed");

    assert.equal(retried.customerEmailSent, true);
    assert.ok(order?.customer_email_sent_at);
    assert.equal(order?.customer_email_last_error, "");
    assert.equal(sent.length, 2);
  }, async (mail) => {
    if (failCustomer && mail.to !== "admin@example.test") {
      throw new Error("temporary customer failure");
    }
    return {};
  });
});

test("admin paid-email repair requires admin authorization", async () => {
  const oldToken = process.env.ADMIN_API_TOKEN;
  try {
    process.env.ADMIN_API_TOKEN = "repair-auth-token";
    const route = await import("../src/app/api/admin/orders/retry-paid-emails/route");

    const missing = await route.POST(new Request("https://example.test/api/admin/orders/retry-paid-emails", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ limit: 1 }),
    }));
    assert.equal(missing.status, 401);

    const invalid = await route.POST(new Request("https://example.test/api/admin/orders/retry-paid-emails", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer wrong-token",
      },
      body: JSON.stringify({ limit: 1 }),
    }));
    assert.equal(invalid.status, 401);

    const adminPageSource = readFileSync(join(process.cwd(), "src/app/admin/orders/page.tsx"), "utf8");
    assert.match(adminPageSource, /auth\.user\.role !== "ADMIN"/);
  } finally {
    if (oldToken === undefined) delete process.env.ADMIN_API_TOKEN;
    else process.env.ADMIN_API_TOKEN = oldToken;
  }
});

test("admin repair UI is wired to same-origin session-safe endpoint", async () => {
  const routeSource = readFileSync(join(process.cwd(), "src/app/api/admin/orders/retry-paid-emails/route.ts"), "utf8");
  const buttonSource = readFileSync(join(process.cwd(), "src/components/admin-email-repair-button.tsx"), "utf8");

  assert.match(routeSource, /requireAdminAccess/);
  assert.match(routeSource, /requestOriginIsAllowed/);
  assert.match(routeSource, /auth\.actor === "session"/);
  assert.match(buttonSource, /\/api\/admin\/orders\/retry-paid-emails/);
  assert.match(buttonSource, /credentials: "same-origin"/);
  assert.match(buttonSource, /Already-sent emails will not be resent/);
});

test("admin paid-email repair retries only missing notifications and is repeat-safe", async () => {
  const oldToken = process.env.ADMIN_API_TOKEN;
  process.env.ADMIN_API_TOKEN = "repair-token";

  try {
    await withMockedPaymentEmailEnv(async (sent) => {
      const userId = await createTestUser("repair-customer-email");
      const orderId = await insertCheckoutCreatedOrder({
        userId,
        checkoutSessionId: "cs_repair_customer",
        status: "PAID",
        itemId: 8,
      });
      const now = new Date().toISOString();
      await db.getAdapter().execute(
        "UPDATE orders SET paid_at = ?, fulfilled_at = ?, customer_email_sent_at = NULL, admin_email_sent_at = ? WHERE id = ?",
        [now, now, now, orderId],
      );

      const route = await import("../src/app/api/admin/orders/retry-paid-emails/route");
      const request = () => new Request("https://example.test/api/admin/orders/retry-paid-emails", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer repair-token",
        },
        body: JSON.stringify({ orderId }),
      });

      const first = await route.POST(request());
      assert.equal(first.status, 200);
      const firstPayload = await first.json() as {
        attempted: number;
        results: Array<{ customerEmailSent: boolean; adminEmailSent: boolean; customerEmailReason?: string; adminEmailReason?: string }>;
        skipped: unknown[];
      };
      assert.equal(firstPayload.attempted, 1);
      assert.equal(firstPayload.results[0].customerEmailSent, true);
      assert.equal(firstPayload.results[0].adminEmailSent, false);
      assert.equal(firstPayload.results[0].adminEmailReason, "already sent");
      assert.equal(firstPayload.skipped.length, 0);
      assert.equal(sent.length, 1);
      assert.notEqual(sent[0].to, "admin@example.test");

      const second = await route.POST(request());
      assert.equal(second.status, 200);
      const secondPayload = await second.json() as {
        attempted: number;
        results: unknown[];
        skipped: Array<{ orderId: number; reason: string }>;
      };
      assert.equal(secondPayload.attempted, 0);
      assert.equal(secondPayload.results.length, 0);
      assert.deepEqual(secondPayload.skipped, [{ orderId, reason: "already_complete" }]);
      assert.equal(sent.length, 1);
    });
  } finally {
    if (oldToken === undefined) delete process.env.ADMIN_API_TOKEN;
    else process.env.ADMIN_API_TOKEN = oldToken;
  }
});

test("admin paid-email repair logging omits customer email addresses", async () => {
  const oldToken = process.env.ADMIN_API_TOKEN;
  process.env.ADMIN_API_TOKEN = "repair-log-token";

  try {
    await withMockedPaymentEmailEnv(async () => {
      const userId = await createTestUser("repair-log-email");
      const orderId = await insertCheckoutCreatedOrder({
        userId,
        checkoutSessionId: "cs_repair_log_email",
        status: "PAID",
        itemId: 10,
      });
      const now = new Date().toISOString();
      await db.getAdapter().execute(
        "UPDATE orders SET paid_at = ?, fulfilled_at = ?, customer_email_sent_at = NULL, admin_email_sent_at = ? WHERE id = ?",
        [now, now, now, orderId],
      );

      const lines = await captureConsoleOutput(["info", "warn"], async () => {
        const route = await import("../src/app/api/admin/orders/retry-paid-emails/route");
        const response = await route.POST(new Request("https://example.test/api/admin/orders/retry-paid-emails", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer repair-log-token",
            "x-vercel-id": "repair-log-test",
          },
          body: JSON.stringify({ orderId }),
        }));
        assert.equal(response.status, 200);
      });

      const serialized = lines.join("\n");
      assert.match(serialized, /admin_paid_email_repair_attempted/);
      assert.match(serialized, /paid_order_email_retry_succeeded/);
      assert.doesNotMatch(serialized, /repair-log-email/);
      assert.doesNotMatch(serialized, /@example\.test/);
      assert.doesNotMatch(serialized, /cs_repair_log_email/);
      assert.doesNotMatch(serialized, /repair-log-token/);
    });
  } finally {
    if (oldToken === undefined) delete process.env.ADMIN_API_TOKEN;
    else process.env.ADMIN_API_TOKEN = oldToken;
  }
});

test("admin paid-email repair handles nonexistent and already-complete orders safely", async () => {
  const oldToken = process.env.ADMIN_API_TOKEN;
  process.env.ADMIN_API_TOKEN = "repair-skip-token";

  try {
    await withMockedPaymentEmailEnv(async (sent) => {
      const userId = await createTestUser("repair-complete-email");
      const orderId = await insertCheckoutCreatedOrder({
        userId,
        checkoutSessionId: "cs_repair_complete",
        status: "PAID",
        itemId: 9,
      });
      const now = new Date().toISOString();
      await db.getAdapter().execute(
        "UPDATE orders SET paid_at = ?, fulfilled_at = ?, customer_email_sent_at = ?, admin_email_sent_at = ? WHERE id = ?",
        [now, now, now, now, orderId],
      );

      const route = await import("../src/app/api/admin/orders/retry-paid-emails/route");
      const post = (body: Record<string, unknown>) => route.POST(new Request("https://example.test/api/admin/orders/retry-paid-emails", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer repair-skip-token",
        },
        body: JSON.stringify(body),
      }));

      const nonexistent = await post({ orderId: 9_999_999 });
      assert.equal(nonexistent.status, 200);
      assert.deepEqual((await nonexistent.json() as { skipped: unknown[] }).skipped, [
        { orderId: 9_999_999, reason: "not_found" },
      ]);

      const invalid = await post({ orderId: "not-a-number" });
      assert.equal(invalid.status, 200);
      assert.deepEqual((await invalid.json() as { attempted: number; skipped: unknown[] }), {
        ok: true,
        attempted: 0,
        results: [],
        skipped: [{ orderId: 0, reason: "invalid_order_id" }],
      });

      const complete = await post({ orderId });
      assert.equal(complete.status, 200);
      assert.deepEqual((await complete.json() as { skipped: unknown[] }).skipped, [
        { orderId, reason: "already_complete" },
      ]);
      assert.equal(sent.length, 0);
    });
  } finally {
    if (oldToken === undefined) delete process.env.ADMIN_API_TOKEN;
    else process.env.ADMIN_API_TOKEN = oldToken;
  }
});

test("failed and canceled reconciliation do not regress an already paid order", async () => {
  const userId = await createTestUser("paid-regression");
  await insertCheckoutCreatedOrder({ userId, checkoutSessionId: "cs_paid_regression", status: "PAID", itemId: 3 });

  await db.markOrderFailedFromCheckoutSession({
    checkoutSessionId: "cs_paid_regression",
    paymentIntentId: "pi_failed_late",
  });
  await db.markOrderCanceledFromCheckoutSession("cs_paid_regression");

  const order = await db.getOrderByCheckoutSession("cs_paid_regression");
  assert.equal(order?.status, "PAID");
  assert.equal(order?.stripe_payment_intent_id, null);
});
