import "server-only";
import type { DbAdapter } from "@/lib/db/adapter";

export const ORDER_ITEM_TYPES = [
  "PROFILE_BUILD",
  "GPU",
  "CPU",
  "RAM_KIT",
  "POWER_SUPPLY",
  "CASE",
  "MOTHERBOARD",
  "COMPACT_AI_SYSTEM",
  "STORAGE_DRIVE",
  "CPU_COOLER",
] as const;

export const QUOTE_PRODUCT_TYPES = [
  "mac_system",
  "external_gpu_enclosure",
  "mac_egpu_build",
] as const;

export type CommerceInvariantDiagnostics = {
  invalidOrderAmounts: number;
  invalidOrderCurrencies: number;
  invalidOrderItemTypes: number;
  invalidQuoteProductTypes: number;
  duplicateOrderSnapshotSlots: number;
  paidStatusMissingPaymentTimestamps: number;
  unpaidRowsWithPaymentTimestamps: number;
  paymentConfirmedWithoutPaidStatus: number;
  fulfilledWithoutPaymentConfirmation: number;
};

export function sqlLiteralList(values: readonly string[]): string {
  return values.map((value) => `'${value.replaceAll("'", "''")}'`).join(", ");
}

async function countRows(db: DbAdapter, sql: string): Promise<number> {
  const row = await db.queryOne<{ cnt: number }>(sql);
  return row?.cnt ?? 0;
}

export async function getCommerceInvariantDiagnostics(db: DbAdapter): Promise<CommerceInvariantDiagnostics> {
  const orderTypeList = sqlLiteralList(ORDER_ITEM_TYPES);
  const quoteTypeList = sqlLiteralList(QUOTE_PRODUCT_TYPES);

  const [
    invalidOrderAmounts,
    invalidOrderCurrencies,
    invalidOrderItemTypes,
    invalidQuoteProductTypes,
    duplicateOrderSnapshotSlots,
    paidStatusMissingPaymentTimestamps,
    unpaidRowsWithPaymentTimestamps,
    paymentConfirmedWithoutPaidStatus,
    fulfilledWithoutPaymentConfirmation,
  ] = await Promise.all([
    countRows(db, "SELECT COUNT(*) AS cnt FROM orders WHERE amount_eur_cents <= 0"),
    countRows(db, "SELECT COUNT(*) AS cnt FROM orders WHERE currency <> 'eur'"),
    countRows(db, `SELECT COUNT(*) AS cnt FROM orders WHERE order_item_type NOT IN (${orderTypeList})`),
    countRows(db, `SELECT COUNT(*) AS cnt FROM quote_requests WHERE product_type NOT IN (${quoteTypeList})`),
    countRows(db, `
      SELECT COUNT(*) AS cnt
      FROM (
        SELECT order_id, slot_key
        FROM order_price_snapshots
        GROUP BY order_id, slot_key
        HAVING COUNT(*) > 1
      ) duplicate_slots
    `),
    countRows(db, "SELECT COUNT(*) AS cnt FROM orders WHERE status = 'PAID' AND (paid_at IS NULL OR payment_confirmed_at IS NULL)"),
    countRows(db, "SELECT COUNT(*) AS cnt FROM orders WHERE status <> 'PAID' AND (paid_at IS NOT NULL OR payment_confirmed_at IS NOT NULL OR fulfilled_at IS NOT NULL)"),
    countRows(db, "SELECT COUNT(*) AS cnt FROM orders WHERE payment_confirmed_at IS NOT NULL AND status <> 'PAID'"),
    countRows(db, "SELECT COUNT(*) AS cnt FROM orders WHERE fulfilled_at IS NOT NULL AND (status <> 'PAID' OR paid_at IS NULL OR payment_confirmed_at IS NULL)"),
  ]);

  return {
    invalidOrderAmounts,
    invalidOrderCurrencies,
    invalidOrderItemTypes,
    invalidQuoteProductTypes,
    duplicateOrderSnapshotSlots,
    paidStatusMissingPaymentTimestamps,
    unpaidRowsWithPaymentTimestamps,
    paymentConfirmedWithoutPaidStatus,
    fulfilledWithoutPaymentConfirmation,
  };
}

export function commerceInvariantViolations(diagnostics: CommerceInvariantDiagnostics): string[] {
  return Object.entries(diagnostics)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => `${key}=${count}`);
}

export async function assertCommerceInvariantsSatisfied(db: DbAdapter): Promise<void> {
  const diagnostics = await getCommerceInvariantDiagnostics(db);
  const violations = commerceInvariantViolations(diagnostics);
  if (violations.length > 0) {
    throw new Error(`Commerce invariant preflight failed: ${violations.join(", ")}`);
  }
}
