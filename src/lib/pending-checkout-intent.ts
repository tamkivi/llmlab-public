export type PendingCheckoutItemType =
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

export type PendingCheckoutIntent = {
  itemType: PendingCheckoutItemType;
  itemId: number;
  checkoutType: "direct";
  intendedPath: string;
  createdAt: number;
  isProfileBuild?: boolean;
  resumeAfterAuth?: boolean;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const PENDING_CHECKOUT_INTENT_KEY = "llmlab:pending-checkout-intent";
export const RESUME_PENDING_CHECKOUT_EVENT = "llmlab:resume-pending-checkout";
export const PENDING_CHECKOUT_INTENT_TTL_MS = 15 * 60 * 1000;

const PENDING_CHECKOUT_ITEM_TYPES = new Set<string>([
  "profile_build",
  "gpu",
  "cpu",
  "ram_kit",
  "power_supply",
  "case",
  "motherboard",
  "compact_ai_system",
  "storage_drive",
  "cpu_cooler",
]);

function getStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function safePath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/")) return "/";
  if (value.startsWith("//")) return "/";
  return value.slice(0, 500);
}

export function currentCheckoutPath(): string {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}`;
}

export function isPendingCheckoutIntent(value: unknown): value is PendingCheckoutIntent {
  if (!value || typeof value !== "object") return false;
  const intent = value as Partial<PendingCheckoutIntent>;
  const itemId = intent.itemId;
  return (
    intent.checkoutType === "direct" &&
    typeof intent.itemType === "string" &&
    PENDING_CHECKOUT_ITEM_TYPES.has(intent.itemType) &&
    Number.isInteger(itemId) &&
    typeof itemId === "number" &&
    itemId > 0 &&
    typeof intent.createdAt === "number" &&
    Number.isFinite(intent.createdAt) &&
    typeof intent.intendedPath === "string"
  );
}

export function intentMatchesItem(
  intent: PendingCheckoutIntent,
  itemType: PendingCheckoutItemType,
  itemId: number,
): boolean {
  return intent.itemType === itemType && intent.itemId === itemId;
}

export function savePendingCheckoutIntent(
  input: Omit<PendingCheckoutIntent, "checkoutType" | "createdAt"> & { createdAt?: number },
  storage?: StorageLike,
): PendingCheckoutIntent | null {
  const target = getStorage(storage);
  if (!target || !Number.isInteger(input.itemId) || input.itemId <= 0) return null;

  const intent: PendingCheckoutIntent = {
    itemType: input.itemType,
    itemId: input.itemId,
    checkoutType: "direct",
    intendedPath: safePath(input.intendedPath),
    createdAt: input.createdAt ?? Date.now(),
    isProfileBuild: input.isProfileBuild === true,
  };

  try {
    target.setItem(PENDING_CHECKOUT_INTENT_KEY, JSON.stringify(intent));
    return intent;
  } catch {
    return null;
  }
}

export function readPendingCheckoutIntent(
  storage?: StorageLike,
  now = Date.now(),
): { intent: PendingCheckoutIntent; stale: false } | { intent: null; stale: boolean } {
  const target = getStorage(storage);
  if (!target) return { intent: null, stale: false };

  try {
    const raw = target.getItem(PENDING_CHECKOUT_INTENT_KEY);
    if (!raw) return { intent: null, stale: false };
    const parsed = JSON.parse(raw) as unknown;
    if (!isPendingCheckoutIntent(parsed)) return { intent: null, stale: true };

    const intent: PendingCheckoutIntent = {
      ...parsed,
      intendedPath: safePath(parsed.intendedPath),
      resumeAfterAuth: parsed.resumeAfterAuth === true,
      isProfileBuild: parsed.isProfileBuild === true,
    };
    if (now - intent.createdAt > PENDING_CHECKOUT_INTENT_TTL_MS) return { intent: null, stale: true };
    return { intent, stale: false };
  } catch {
    return { intent: null, stale: true };
  }
}

export function markPendingCheckoutIntentForRedirect(storage?: StorageLike): PendingCheckoutIntent | null {
  const target = getStorage(storage);
  if (!target) return null;
  const result = readPendingCheckoutIntent(target);
  if (!result.intent) return null;

  const updated: PendingCheckoutIntent = {
    ...result.intent,
    resumeAfterAuth: true,
  };
  try {
    target.setItem(PENDING_CHECKOUT_INTENT_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return null;
  }
}

export function clearPendingCheckoutIntent(storage?: StorageLike): void {
  const target = getStorage(storage);
  if (!target) return;
  try {
    target.removeItem(PENDING_CHECKOUT_INTENT_KEY);
  } catch {
    // Ignore storage failures; checkout still revalidates server-side.
  }
}
