import { NextResponse } from "next/server";
import {
  createPendingOrderForCatalogItem,
  createPendingOrderForBuild,
  type OrderItemType,
  getOpenOrderForItem,
  getOpenOrderForBuild,
  getOrderById,
  markOrderCanceledFromCheckoutSession,
  markOrderCheckoutCreationFailed,
  setOrderCheckoutSession,
} from "@/lib/db";
import { checkRateLimit, clientRateLimitKey } from "@/lib/request-utils";
import { requireAuth } from "@/lib/server/auth-helpers";
import {
  CHECKOUT_UNAVAILABLE_MESSAGE,
  getCheckoutAvailability,
  getDirectCheckoutPriceMaxAgeHours,
  getOrderItemCheckoutEligibility,
  type CheckoutEligibility,
} from "@/lib/server/checkout-availability";
import { type CheckoutOrderPayload, resolveOpenCheckoutOrderForReuse } from "@/lib/server/checkout-reuse";
import { logEvent, requestIdFromHeaders, safeErrorReason } from "@/lib/server/structured-log";
import { getStripe, stripeRequestIdFromError, stripeRequestIdFromObject } from "@/lib/stripe";

export const runtime = "nodejs";

type CheckoutBody = {
  itemType?: unknown;
  itemId?: unknown;
};

type CheckoutOrderPayloadWithPricing = CheckoutOrderPayload & {
  pricedLive?: number;
  pricedFallback?: number;
};

type PendingOrderResult = CheckoutOrderPayloadWithPricing | { ok: false; message: string };

function parseOrderItemType(value: unknown): OrderItemType | null {
  const key = String(value ?? "").trim().toLowerCase();
  const lookup: Record<string, OrderItemType> = {
    profile_build: "PROFILE_BUILD",
    gpu: "GPU",
    cpu: "CPU",
    ram_kit: "RAM_KIT",
    power_supply: "POWER_SUPPLY",
    case: "CASE",
    motherboard: "MOTHERBOARD",
    compact_ai_system: "COMPACT_AI_SYSTEM",
    storage_drive: "STORAGE_DRIVE",
    cpu_cooler: "CPU_COOLER",
  };
  return lookup[key] ?? null;
}

function resolveBaseUrl(): string | null {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const vercelUrl = process.env.VERCEL_URL
    ? process.env.VERCEL_URL.startsWith("http")
      ? process.env.VERCEL_URL
      : `https://${process.env.VERCEL_URL}`
    : null;
  const fallback = appUrl ?? vercelUrl;
  if (!fallback) {
    return null;
  }
  return new URL(fallback).origin;
}

function validateSameOriginRequest(request: Request, expectedOrigin: string): NextResponse | null {
  const originHeader = request.headers.get("origin");
  if (!originHeader) {
    return NextResponse.json({ message: "Missing request origin." }, { status: 403 });
  }

  let requestOrigin: string;
  try {
    requestOrigin = new URL(originHeader).origin;
  } catch {
    return NextResponse.json({ message: "Invalid request origin." }, { status: 400 });
  }

  if (requestOrigin !== expectedOrigin) {
    return NextResponse.json({ message: "Request origin is not allowed." }, { status: 403 });
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "same-site" && fetchSite !== "none") {
    return NextResponse.json({ message: "Request origin is not allowed." }, { status: 403 });
  }

  return null;
}

function normalizePendingOrderResult(result: Awaited<ReturnType<typeof createPendingOrderForBuild>> | Awaited<ReturnType<typeof createPendingOrderForCatalogItem>>): PendingOrderResult {
  if (!result.ok) {
    return result;
  }
  return {
    orderId: result.orderId,
    amountEurCents: result.amountEurCents,
    buildName: result.buildName,
    ...("pricedLive" in result ? { pricedLive: result.pricedLive, pricedFallback: result.pricedFallback } : {}),
  };
}

function failureResponse(result: { message: string }): NextResponse {
  return NextResponse.json({ message: result.message }, { status: result.message.includes("no price available") ? 422 : 404 });
}

function checkoutBlockedResponse(eligibility: CheckoutEligibility): NextResponse {
  const status = eligibility.reason === "checkout_env_unavailable"
    ? 503
    : eligibility.reason === "item_not_found"
      ? 404
      : eligibility.reason === "quote_only"
        ? 400
        : 409;

  return NextResponse.json({
    message: eligibility.message,
    reason: eligibility.reason,
    maxPriceAgeHours: eligibility.maxPriceAgeHours,
    maxOrderEur: eligibility.maxOrderEur,
    orderPriceEur: eligibility.orderPriceEur,
    amountEurCents: eligibility.amountEurCents,
    blockers: eligibility.blockers,
  }, { status });
}

function logCheckoutBlocked({
  requestId,
  eligibility,
  itemType,
  itemId,
  orderId,
}: {
  requestId: string | null;
  eligibility: CheckoutEligibility;
  itemType?: string | null;
  itemId?: number | null;
  orderId?: number | null;
}) {
  logEvent({
    level: eligibility.reason === "checkout_env_unavailable" ? "error" : "warn",
    event: "checkout_blocked",
    area: "checkout",
    requestId,
    reason: eligibility.reason ?? "unknown",
    orderId,
    itemType,
    itemId,
  });
}

function quoteOnlyResponse(): NextResponse {
  return checkoutBlockedResponse({
    eligible: false,
    reason: "quote_only",
    message: "This product requires a custom quote. Please use the Request Quote button on the product page.",
    maxPriceAgeHours: getDirectCheckoutPriceMaxAgeHours(),
  });
}

function pricingChangedResponse(maxPriceAgeHours: number): CheckoutEligibility {
  return {
    eligible: false,
    reason: "pricing_unhealthy",
    message: "Checkout pricing changed while preparing the payment session. Please reload the product page and try again.",
    maxPriceAgeHours,
  };
}

function orderAmountMatchesEligibility(amountEurCents: number, eligibility: CheckoutEligibility): boolean {
  return eligibility.amountEurCents === undefined || amountEurCents === eligibility.amountEurCents;
}

function stripeMissingErrorCode(error: unknown): string | null {
  const candidate = error as { code?: string; raw?: { code?: string } };
  return candidate.code ?? candidate.raw?.code ?? null;
}

export async function POST(request: Request) {
  const requestId = requestIdFromHeaders(request.headers);
  const startedAt = Date.now();
  try {
    if (!(await checkRateLimit(clientRateLimitKey(request, "checkout"), 60, 60_000))) {
      return NextResponse.json({ message: "Too many requests. Please try again later." }, { status: 429 });
    }

    const checkoutAvailability = getCheckoutAvailability();
    if (!checkoutAvailability.available) {
      logEvent({
        level: "error",
        event: "checkout_blocked",
        area: "checkout",
        requestId,
        reason: checkoutAvailability.reason ?? "checkout_unavailable",
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json({ message: CHECKOUT_UNAVAILABLE_MESSAGE }, { status: 503 });
    }

    const baseUrl = resolveBaseUrl();
    if (!baseUrl) {
      logEvent({
        level: "error",
        event: "checkout_blocked",
        area: "checkout",
        requestId,
        reason: "base_url_missing",
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json(
        { message: "Checkout is not configured." },
        { status: 500 },
      );
    }

    const originError = validateSameOriginRequest(request, baseUrl);
    if (originError) return originError;

    const body = (await request.json().catch(() => null)) as CheckoutBody | null;
    const rawItemType = String(body?.itemType ?? "").trim().toLowerCase();
    const quoteOnlyTypes = new Set(["mac_system", "external_gpu_enclosure", "mac_egpu_build"]);
    if (quoteOnlyTypes.has(rawItemType)) {
      logEvent({
        level: "warn",
        event: "checkout_blocked",
        area: "checkout",
        requestId,
        reason: "quote_only",
        itemType: rawItemType,
        durationMs: Date.now() - startedAt,
      });
      return quoteOnlyResponse();
    }

    const itemType = parseOrderItemType(rawItemType);
    const itemId = Number.parseInt(String(body?.itemId ?? ""), 10);
    if (!itemType || !Number.isFinite(itemId) || itemId <= 0) {
      return NextResponse.json({ message: "Invalid item selection." }, { status: 400 });
    }

    let checkoutEligibility = await getOrderItemCheckoutEligibility(itemType, itemId);
    if (!checkoutEligibility.eligible) {
      logCheckoutBlocked({ requestId, eligibility: checkoutEligibility, itemType, itemId });
      return checkoutBlockedResponse(checkoutEligibility);
    }

    const auth = await requireAuth();
    if (!auth) {
      return NextResponse.json({ message: "Please log in before purchasing." }, { status: 401 });
    }
    const { user } = auth;
    if (!(await checkRateLimit(`checkout:user:${user.id}`, 20, 60_000))) {
      return NextResponse.json({ message: "Too many requests. Please try again later." }, { status: 429 });
    }

    const stripe = getStripe();
    let openOrder =
      itemType === "PROFILE_BUILD"
        ? await getOpenOrderForBuild({
            userId: user.id,
            buildId: itemId,
          })
        : await getOpenOrderForItem({
            userId: user.id,
            itemType,
            itemId,
          });

    if (openOrder && !orderAmountMatchesEligibility(openOrder.amount_eur_cents, checkoutEligibility)) {
      if (openOrder.stripe_checkout_session_id) {
        await stripe.checkout.sessions.expire(openOrder.stripe_checkout_session_id).catch((error: unknown) => {
          const code = stripeMissingErrorCode(error);
          if (code !== "resource_missing") {
            logEvent({
              level: "warn",
              event: "checkout_stale_session_expire_failed",
              area: "checkout",
              requestId,
              reason: safeErrorReason(error),
              orderId: openOrder?.id,
              itemType,
              itemId,
            });
          }
        });
      }
      await markOrderCheckoutCreationFailed(openOrder.id);
      openOrder = null;
    }

    const initialDecision = await resolveOpenCheckoutOrderForReuse({
      order: openOrder,
      retrieveCheckoutSession: (checkoutSessionId) => stripe.checkout.sessions.retrieve(checkoutSessionId),
      markOrderCanceled: markOrderCanceledFromCheckoutSession,
      markOrderFailed: markOrderCheckoutCreationFailed,
    });

    if (initialDecision.action === "reuse_session") {
      logEvent({
        level: "info",
        event: "checkout_session_reused",
        area: "checkout",
        requestId,
        orderId: openOrder?.id,
        itemType,
        itemId,
        checkoutReused: true,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json({
        checkoutUrl: initialDecision.checkoutUrl,
        reused: true,
        orderId: openOrder?.id,
        amountEurCents: openOrder?.amount_eur_cents,
        orderPriceEur: openOrder ? openOrder.amount_eur_cents / 100 : undefined,
        buildName: openOrder?.build_name,
      });
    }

    const isBuildOrder = itemType === "PROFILE_BUILD";
    const createOrder = async (): Promise<PendingOrderResult> => normalizePendingOrderResult(
      isBuildOrder
        ? await createPendingOrderForBuild({
            userId: user.id,
            buildId: itemId,
          })
        : await createPendingOrderForCatalogItem({
            userId: user.id,
            itemType,
            itemId,
          }),
    );

    let order: PendingOrderResult = initialDecision.action === "use_order" ? initialDecision.order : await createOrder();

    if ("ok" in order) {
      logEvent({
        level: "warn",
        event: "checkout_order_creation_blocked",
        area: "checkout",
        requestId,
        reason: order.message,
        itemType,
        itemId,
      });
      return failureResponse(order);
    }

    checkoutEligibility = await getOrderItemCheckoutEligibility(itemType, itemId);
    if (!checkoutEligibility.eligible) {
      await markOrderCheckoutCreationFailed(order.orderId);
      logCheckoutBlocked({ requestId, eligibility: checkoutEligibility, itemType, itemId, orderId: order.orderId });
      return checkoutBlockedResponse(checkoutEligibility);
    }
    if (!orderAmountMatchesEligibility(order.amountEurCents, checkoutEligibility)) {
      await markOrderCheckoutCreationFailed(order.orderId);
      const changed = pricingChangedResponse(checkoutEligibility.maxPriceAgeHours);
      logCheckoutBlocked({ requestId, eligibility: changed, itemType, itemId, orderId: order.orderId });
      return checkoutBlockedResponse(changed);
    }

    const currentOrder = await getOrderById(order.orderId);
    const postCreateDecision = await resolveOpenCheckoutOrderForReuse({
      order: currentOrder,
      retrieveCheckoutSession: (checkoutSessionId) => stripe.checkout.sessions.retrieve(checkoutSessionId),
      markOrderCanceled: markOrderCanceledFromCheckoutSession,
      markOrderFailed: markOrderCheckoutCreationFailed,
    });

    if (postCreateDecision.action === "reuse_session") {
      logEvent({
        level: "info",
        event: "checkout_session_reused",
        area: "checkout",
        requestId,
        orderId: currentOrder?.id,
        itemType,
        itemId,
        checkoutReused: true,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json({
        checkoutUrl: postCreateDecision.checkoutUrl,
        reused: true,
        orderId: currentOrder?.id,
        amountEurCents: currentOrder?.amount_eur_cents,
        orderPriceEur: currentOrder ? currentOrder.amount_eur_cents / 100 : undefined,
        buildName: currentOrder?.build_name,
      });
    }
    if (postCreateDecision.action === "use_order") {
      order = postCreateDecision.order;
    } else if (postCreateDecision.action === "create_order") {
      order = await createOrder();
      if ("ok" in order) {
        logEvent({
          level: "warn",
          event: "checkout_order_creation_blocked",
          area: "checkout",
          requestId,
          reason: order.message,
          itemType,
          itemId,
        });
        return failureResponse(order);
      }
    }

    checkoutEligibility = await getOrderItemCheckoutEligibility(itemType, itemId);
    if (!checkoutEligibility.eligible) {
      await markOrderCheckoutCreationFailed(order.orderId);
      logCheckoutBlocked({ requestId, eligibility: checkoutEligibility, itemType, itemId, orderId: order.orderId });
      return checkoutBlockedResponse(checkoutEligibility);
    }
    if (!orderAmountMatchesEligibility(order.amountEurCents, checkoutEligibility)) {
      await markOrderCheckoutCreationFailed(order.orderId);
      const changed = pricingChangedResponse(checkoutEligibility.maxPriceAgeHours);
      logCheckoutBlocked({ requestId, eligibility: changed, itemType, itemId, orderId: order.orderId });
      return checkoutBlockedResponse(changed);
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url: `${baseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/checkout/cancel?session_id={CHECKOUT_SESSION_ID}`,
      customer_email: user.email,
      billing_address_collection: "auto",
      submit_type: "pay",
      payment_method_types: ["card"],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "eur",
            unit_amount: order.amountEurCents,
            product_data: {
              name: order.buildName,
              description:
                itemType === "PROFILE_BUILD"
                  ? "AI build order (assembled and configured after purchase)"
                  : "AI component/system order (sourced, assembled, and configured after purchase)",
            },
          },
        },
      ],
      metadata: {
        order_id: String(order.orderId),
        user_id: String(user.id),
        order_item_type: itemType,
        order_item_id: String(itemId),
      },
      client_reference_id: String(order.orderId),
    }, {
      idempotencyKey: `checkout_order_${order.orderId}`,
    });

    if (!session.id || !session.url) {
      await markOrderCheckoutCreationFailed(order.orderId);
      logEvent({
        level: "error",
        event: "checkout_session_create_failed",
        area: "checkout",
        requestId,
        stripeRequestId: stripeRequestIdFromObject(session),
        reason: "stripe_session_missing_url",
        orderId: order.orderId,
        itemType,
        itemId,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json({ message: "Failed to create payment session." }, { status: 502 });
    }

    const linked = await setOrderCheckoutSession({
      orderId: order.orderId,
      checkoutSessionId: session.id,
    });
    if (!linked) {
      await markOrderCheckoutCreationFailed(order.orderId);
      logEvent({
        level: "error",
        event: "checkout_session_link_failed",
        area: "checkout",
        requestId,
        reason: "order_already_has_different_session",
        orderId: order.orderId,
        itemType,
        itemId,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json({ message: "Checkout session could not be linked to the order." }, { status: 409 });
    }

    logEvent({
      level: "info",
      event: "checkout_session_created",
      area: "checkout",
      requestId,
      orderId: order.orderId,
      itemType,
      itemId,
      checkoutReused: false,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({
      checkoutUrl: session.url,
      orderId: order.orderId,
      amountEurCents: order.amountEurCents,
      orderPriceEur: order.amountEurCents / 100,
      buildName: order.buildName,
    });
  } catch (error) {
    logEvent({
      level: "error",
      event: "checkout_initialization_failed",
      area: "checkout",
      requestId,
      stripeRequestId: stripeRequestIdFromError(error),
      reason: safeErrorReason(error),
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ message: "Checkout initialization failed." }, { status: 500 });
  }
}
