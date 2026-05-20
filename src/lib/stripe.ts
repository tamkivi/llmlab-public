import "server-only";
import Stripe from "stripe";

let stripeClient: Stripe | null = null;
let stripeClientKey: string | null = null;

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not configured.");
  }

  if (!stripeClient || stripeClientKey !== key) {
    stripeClient = new Stripe(key, {
      timeout: 10_000,
      maxNetworkRetries: 2,
    });
    stripeClientKey = key;
  }

  return stripeClient;
}

export function stripeRequestIdFromError(error: unknown): string | null {
  const candidate = error as { requestId?: unknown; raw?: { requestId?: unknown } };
  const requestId = candidate.requestId ?? candidate.raw?.requestId;
  return typeof requestId === "string" && requestId.trim() ? requestId : null;
}

export function stripeRequestIdFromObject(value: unknown): string | null {
  const candidate = value as { lastResponse?: { requestId?: unknown } };
  const requestId = candidate.lastResponse?.requestId;
  return typeof requestId === "string" && requestId.trim() ? requestId : null;
}
