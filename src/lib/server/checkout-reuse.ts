import "server-only";
import type { OrderRecord } from "@/lib/db";

const DEFAULT_REUSE_WINDOW_MS = 30 * 60 * 1000;

type CheckoutSessionLike = {
  status: string | null;
  url?: string | null;
};

type RetrieveCheckoutSession = (checkoutSessionId: string) => Promise<CheckoutSessionLike>;

export type CheckoutOrderPayload = {
  orderId: number;
  amountEurCents: number;
  buildName: string;
};

type CheckoutReuseDecision =
  | { action: "create_order" }
  | { action: "use_order"; order: CheckoutOrderPayload }
  | { action: "reuse_session"; checkoutUrl: string };

function isResourceMissingError(error: unknown): boolean {
  const maybe = error as { code?: string; raw?: { code?: string } };
  return maybe.code === "resource_missing"
    || maybe.raw?.code === "resource_missing";
}

function isRecent(createdAt: string, nowMs: number, reuseWindowMs: number): boolean {
  const createdMs = Date.parse(createdAt);
  return Number.isFinite(createdMs) && createdMs > nowMs - reuseWindowMs;
}

function orderPayload(order: OrderRecord): CheckoutOrderPayload {
  return {
    orderId: order.id,
    amountEurCents: order.amount_eur_cents,
    buildName: order.build_name,
  };
}

export async function resolveOpenCheckoutOrderForReuse({
  order,
  retrieveCheckoutSession,
  markOrderCanceled,
  markOrderFailed,
  nowMs = Date.now(),
  reuseWindowMs = DEFAULT_REUSE_WINDOW_MS,
}: {
  order: OrderRecord | null;
  retrieveCheckoutSession: RetrieveCheckoutSession;
  markOrderCanceled: (checkoutSessionId: string) => Promise<void>;
  markOrderFailed: (orderId: number) => Promise<void>;
  nowMs?: number;
  reuseWindowMs?: number;
}): Promise<CheckoutReuseDecision> {
  if (!order) {
    return { action: "create_order" };
  }

  const recent = isRecent(order.created_at, nowMs, reuseWindowMs);
  if (!order.stripe_checkout_session_id) {
    if (recent) {
      return { action: "use_order", order: orderPayload(order) };
    }
    await markOrderFailed(order.id);
    return { action: "create_order" };
  }

  let session: CheckoutSessionLike;
  try {
    session = await retrieveCheckoutSession(order.stripe_checkout_session_id);
  } catch (error) {
    if (isResourceMissingError(error)) {
      await markOrderFailed(order.id);
      return { action: "create_order" };
    }
    throw error;
  }

  if (recent && session.status === "open" && session.url) {
    return { action: "reuse_session", checkoutUrl: session.url };
  }

  if (session.status === "expired") {
    await markOrderCanceled(order.stripe_checkout_session_id);
  } else {
    await markOrderFailed(order.id);
  }
  return { action: "create_order" };
}
