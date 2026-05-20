import "server-only";
import {
  backfillPriceHistoryFromChecks,
  beginPricingRun,
  finishPricingRun,
  getActiveAdminPricingOverride,
  getPricingFreshnessReport,
  insertPriceHistory,
  listEstonianPriceChecks,
  listLatestPricingAttemptTimes,
  listPriceTrackableCatalogItems,
  normalizeCategoryRows,
  recordPricingRunFailure,
  adminPricingOverrideSource,
  upsertEstonianPriceCheck,
} from "@/lib/db";
import type { PriceTrackableCatalogItem } from "@/lib/db";
import {
  appendCategoryValidationSource,
  categoryReferencePriceBounds,
  validateRetailerCandidateForCategory,
  type PricingValidationCategory,
} from "@/lib/component-pricing-validation";
import { ASSEMBLY_MARKUP_PCT, ASSEMBLY_MARKUP_MULTIPLIER } from "@/lib/pricing-constants";
import { looksLikeRamCatalogName } from "@/lib/ram-pricing";

/**
 * Estonian market price aggregator.
 *
 * Scrapes search result pages from Estonian retailers and extracts euro prices
 * via regex. This is inherently fragile:
 *
 * - Regex may capture unrelated prices on the page (shipping, accessories, etc.)
 * - Outlier filtering (45%–260% of base price) is a rough heuristic
 * - Low sample counts indicate weak or unreliable data
 * - Some products may not appear in Estonian retailers at all
 *
 * Prices are estimates, not exact quotes. Checkout-critical prices should be
 * reviewed by an admin via the audit endpoint before relying on them for
 * high-value orders.
 */

type ComponentRow = PriceTrackableCatalogItem;

type PricedComponentRow = ComponentRow & {
  checkedAt: string | null;
  attemptedAt: string | null;
};

type FailedItem = {
  category: string;
  itemId: number;
  name: string;
  reason: string;
};

type SkippedItem = FailedItem & {
  query: string;
  sourceReasonCounts: Record<string, number>;
};

export type RefreshSummary = {
  status: "SUCCESS" | "PARTIAL";
  trackableItems: number;
  healthCriticalItems: number;
  backgroundTrackableItems: number;
  processedItems: number;
  processingLimit: number;
  expectedVsProcessedMismatchWarning: string | null;
  checked: number;
  updated: number;
  skipped: number;
  skippedByReason: Record<string, number>;
  skippedItems: SkippedItem[];
  failed: number;
  historyRowsInserted: number;
  historyRowsUpdated: number;
  staleCount: number;
  backgroundStaleCount: number;
  failedItems: FailedItem[];
  lowSampleItems: Array<{ name: string; category: string; sampleCount: number }>;
  adminOverrideItems: Array<{ name: string; category: string; itemId: number; expiresAt: string }>;
  startedAt: string;
  finishedAt: string;
};

type RefreshOptions = {
  maxItems?: number;
  concurrency?: number;
  fetchPrice?: (query: string, basePrice: number) => Promise<AggregatedPriceResult | null>;
};

const FETCH_TIMEOUT_MS = 9000;
const MIN_PRICE_RATIO = 0.55;
const MAX_PRICE_RATIO = 2.2;
const DEFAULT_LOCAL_MAX_ITEMS = 120;
const DEFAULT_VERCEL_MAX_ITEMS = 36;
const DEFAULT_LOCAL_CONCURRENCY = 6;
const DEFAULT_VERCEL_CONCURRENCY = 4;

type RetailerSource = {
  name: string;
  url: string;
};

const ESTONIAN_RETAILER_SOURCES = (query: string): RetailerSource[] => {
  const encoded = encodeURIComponent(query);
  return [
    { name: "Hinnavaatlus", url: `https://www.hinnavaatlus.ee/pricelist/?query=${encoded}` },
    { name: "1a.ee", url: `https://www.1a.ee/search?query=${encoded}` },
    { name: "Kaup24", url: `https://kaup24.ee/et/search?q=${encoded}` },
    { name: "Arvutitark", url: `https://www.arvutitark.ee/otsing?search=${encoded}&sort=top` },
    { name: "Galador", url: `https://www.galador.ee/en/search?q=${encoded}` },
    { name: "Frog.ee", url: `https://frog.ee/et/search?q=${encoded}` },
    { name: "Euronics", url: `https://www.euronics.ee/search?q=${encoded}` },
    { name: "Hansapost", url: `https://www.hansapost.ee/search?q=${encoded}` },
    { name: "Photopoint", url: `https://www.photopoint.ee/search?query=${encoded}` },
  ];
};

const GENERIC_MATCH_TOKENS = new Set([
  "a",
  "ai",
  "and",
  "atx",
  "black",
  "card",
  "case",
  "computer",
  "desktop",
  "edition",
  "for",
  "gaming",
  "gb",
  "gen",
  "gpu",
  "graphics",
  "kit",
  "memory",
  "pc",
  "pcie",
  "processor",
  "rgb",
  "the",
  "usb",
  "wifi",
  "with",
]);

function normalizeEuroString(value: string): number | null {
  const cleaned = value.replace(/\s/g, "").replace(/\u00a0/g, "");
  const withDot = cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(/,/g, ".") : cleaned;
  const parsed = Number.parseFloat(withDot);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 20 || parsed > 50000) return null;
  return parsed;
}

/**
 * Extracts euro-denominated prices from raw HTML using regex patterns.
 * This is inherently imprecise — it may capture prices from ads, shipping
 * costs, accessories, or unrelated products listed on the same page.
 * The outlier filter in diagnoseEstonianRetailerMatch removes the worst matches,
 * but results should still be treated as estimates.
 */
type PriceMatch = {
  price: number;
  index: number;
};

function extractEuroPrices(html: string): PriceMatch[] {
  const values: PriceMatch[] = [];
  const seen = new Set<string>();
  const patterns = [
    /(\d{1,3}(?:[\s.]\d{3})*(?:,\d{2})?)\s?€/g,
    /€\s?(\d{1,3}(?:[\s.]\d{3})*(?:,\d{2})?)/g,
    /(\d{1,5}(?:[.,]\d{2})?)\s?EUR/gi,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) !== null) {
      const maybe = normalizeEuroString(match[1] ?? "");
      if (maybe === null) continue;
      const key = `${match.index}:${maybe}`;
      if (seen.has(key)) continue;
      seen.add(key);
      values.push({ price: maybe, index: match.index });
    }
  }
  return values;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

export function normalizeRetailerMatchText(value: string): string {
  return decodeHtmlEntities(value)
    .toLowerCase()
    .replace(/(\d+)\s*(gb|tb|w|mm|mhz|ghz)\b/g, "$1$2")
    .replace(/[^a-z0-9+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function pricingProductTokens(name: string): string[] {
  const normalized = normalizeRetailerMatchText(name);
  const tokens = normalized
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !GENERIC_MATCH_TOKENS.has(token));

  return [...new Set(tokens)];
}

function stripHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function priceContext(html: string, priceIndex: number): string {
  const start = Math.max(0, priceIndex - 900);
  const end = Math.min(html.length, priceIndex + 900);
  return normalizeRetailerMatchText(stripHtml(html.slice(start, end)));
}

export function scoreRetailerProductContext(tokens: string[], context: string): number {
  const contextTokens = new Set(context.split(" "));
  let score = 0;
  for (const token of tokens) {
    if (contextTokens.has(token)) score++;
  }
  return score;
}

function missingRequiredModelTokens(tokens: string[], context: string): string[] {
  const contextTokens = new Set(context.split(" "));
  const required: string[] = [];
  if (tokens.includes("rtx") || tokens.includes("geforce")) {
    required.push(...tokens.filter((token) => /^\d{4}$/.test(token)));
    if (tokens.includes("ti")) required.push("ti");
    if (tokens.includes("super")) required.push("super");
  }
  return [...new Set(required)].filter((token) => !contextTokens.has(token));
}

export function requiredRetailerTokenMatches(tokens: string[]): number {
  return tokens.length <= 2 ? tokens.length : Math.ceil(tokens.length * 0.6);
}

export function hasAcceptableRetailerProductMatch(tokens: string[], context: string): boolean {
  if (tokens.length === 0) return false;
  if (missingRequiredModelTokens(tokens, context).length > 0) return false;
  const score = scoreRetailerProductContext(tokens, context);
  const required = requiredRetailerTokenMatches(tokens);
  return score >= required;
}

type FetchHtmlResult = {
  ok: boolean;
  status: number | null;
  html: string;
  error?: string;
};

async function fetchWithTimeout(url: string): Promise<FetchHtmlResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      },
      cache: "no-store",
    });
    const html = await response.text().catch(() => "");
    return { ok: response.ok, status: response.status, html };
  } catch (error) {
    return {
      ok: false,
      status: null,
      html: "",
      error: error instanceof Error ? error.name : "fetch_error",
    };
  } finally {
    clearTimeout(timeout);
  }
}

type AggregatedPriceResult = {
  price: number;
  sampleCount: number;
  sources: string;
};

export type RetailerPriceCandidateDiagnostic = {
  price: number;
  score: number;
  requiredScore: number;
  accepted: boolean;
  missingRequiredTokens: string[];
  rejectionReason: "accepted" | "below_token_threshold" | "ram_spec_mismatch" | "category_spec_mismatch";
  rejectionReasons: string[];
  contextSnippet?: string;
};

export type RetailerSourceDiagnostic = {
  source: string;
  url: string;
  status: number | null;
  ok: boolean;
  error?: string;
  htmlBytes: number;
  antiBotDetected: boolean;
  rawHtmlSnippet?: string;
  textSnippet?: string;
  priceMatchCount: number;
  rawCandidatePrices: number[];
  inRatioCount: number;
  outOfRatioCount: number;
  parsedCandidates: RetailerPriceCandidateDiagnostic[];
  bestAcceptedCandidate: RetailerPriceCandidateDiagnostic | null;
  rejectionReason:
    | "accepted"
    | "fetch_failed"
    | "http_error"
    | "anti_bot"
    | "no_price_matches"
    | "all_prices_outside_ratio"
    | "ram_spec_mismatch"
    | "category_spec_mismatch"
    | "below_token_threshold";
};

export type RetailerMatchDiagnostic = {
  query: string;
  searchQuery: string;
  basePriceEur: number;
  tokens: string[];
  requiredScore: number;
  priceBounds: {
    min: number;
    max: number;
  };
  sources: RetailerSourceDiagnostic[];
  aggregate: {
    acceptedSources: Array<{ source: string; price: number; score: number }>;
    medianPrice: number | null;
    stableSourceCount: number;
    sampleCount: number;
    averagePrice: number | null;
    sourcesSummary: string;
  };
  finalRejectionReason: "accepted" | "no_trusted_retailer_quote";
};

type RetailerDiagnosticOptions = {
  category?: PricingValidationCategory;
  sources?: RetailerSource[];
  fetchHtml?: (source: RetailerSource) => Promise<FetchHtmlResult>;
  includeSnippets?: boolean;
  maxCandidatesPerSource?: number;
  searchQuery?: string;
};

function htmlLooksLikeAntiBot(html: string): boolean {
  const normalized = normalizeRetailerMatchText(stripHtml(html.slice(0, 5000)));
  return normalized.includes("just a moment")
    || normalized.includes("te ei ole robot")
    || normalized.includes("challenges cloudflare com");
}

function snippet(value: string, limit: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

function sourceRejectionReason(input: {
  ok: boolean;
  status: number | null;
  error?: string;
  antiBotDetected: boolean;
  priceMatchCount: number;
  inRatioCount: number;
  acceptedCount: number;
  ramSpecMismatchCount: number;
  categorySpecMismatchCount: number;
}): RetailerSourceDiagnostic["rejectionReason"] {
  if (input.acceptedCount > 0) return "accepted";
  if (input.error) return "fetch_failed";
  if (input.antiBotDetected) return "anti_bot";
  if (!input.ok || (input.status !== null && input.status >= 400)) return "http_error";
  if (input.priceMatchCount === 0) return "no_price_matches";
  if (input.inRatioCount === 0) return "all_prices_outside_ratio";
  if (input.ramSpecMismatchCount > 0) return "ram_spec_mismatch";
  if (input.categorySpecMismatchCount > 0) return "category_spec_mismatch";
  return "below_token_threshold";
}

function aggregateSourceMatches(sourceMatches: Array<{ source: string; price: number; score: number }>, tokenCount: number) {
  if (sourceMatches.length === 0) {
    return {
      acceptedSources: [],
      medianPrice: null,
      stableSourceCount: 0,
      sampleCount: 0,
      averagePrice: null,
      sourcesSummary: "",
    };
  }

  const sorted = [...sourceMatches].sort((a, b) => a.price - b.price);
  const median = sorted[Math.floor(sorted.length / 2)].price;
  const stableMatches = sorted.filter(({ price }) => price >= median * 0.7 && price <= median * 1.45);
  const sample = stableMatches.length >= 2 ? stableMatches : sorted;
  const avg = sample.reduce((sum, current) => sum + current.price, 0) / sample.length;

  return {
    acceptedSources: sorted,
    medianPrice: median,
    stableSourceCount: stableMatches.length,
    sampleCount: sample.length,
    averagePrice: avg,
    sourcesSummary: sample.map((match) => `${match.source} €${match.price.toFixed(2)} match=${match.score}/${tokenCount}`).join(", "),
  };
}

export async function diagnoseEstonianRetailerMatch(
  query: string,
  basePrice: number,
  options: RetailerDiagnosticOptions = {},
): Promise<RetailerMatchDiagnostic> {
  const tokens = pricingProductTokens(query);
  const requiredScore = requiredRetailerTokenMatches(tokens);
  const validationCategory = options.category ?? (looksLikeRamCatalogName(query) ? "ram_kit" : null);
  const categoryBounds = validationCategory ? categoryReferencePriceBounds(validationCategory, basePrice) : null;
  const minPrice = categoryBounds?.min ?? basePrice * MIN_PRICE_RATIO;
  const maxPrice = categoryBounds?.max ?? basePrice * MAX_PRICE_RATIO;
  const searchQuery = options.searchQuery ?? query;
  const sources = options.sources ?? ESTONIAN_RETAILER_SOURCES(searchQuery);
  const fetchHtml = options.fetchHtml ?? ((source: RetailerSource) => fetchWithTimeout(source.url));
  const includeSnippets = options.includeSnippets ?? false;
  const maxCandidatesPerSource = options.maxCandidatesPerSource ?? 5;

  const sourceDiagnostics = await Promise.all(sources.map(async (source): Promise<RetailerSourceDiagnostic> => {
    const fetched = await fetchHtml(source);
    const antiBotDetected = fetched.html ? htmlLooksLikeAntiBot(fetched.html) : false;
    const priceMatches = fetched.ok ? extractEuroPrices(fetched.html) : [];
    const inRatio = priceMatches.filter(({ price }) => price >= minPrice && price <= maxPrice);
    const candidates = inRatio
      .map(({ price, index }) => {
        const context = priceContext(fetched.html, index);
        const score = scoreRetailerProductContext(tokens, context);
        const missingRequiredTokens = missingRequiredModelTokens(tokens, context);
        const categoryValidation = validateRetailerCandidateForCategory(validationCategory, query, context);
        const rejectionReasons = [
          ...(score >= requiredScore ? [] : ["below_token_threshold"]),
          ...missingRequiredTokens.map((token) => `required_token_missing:${token}`),
          ...categoryValidation.reasons,
        ];
        const accepted = rejectionReasons.length === 0;
        const rejectionReason = accepted
          ? "accepted" as const
          : validationCategory === "ram_kit" && categoryValidation.reasons.length > 0
            ? "ram_spec_mismatch" as const
            : categoryValidation.reasons.length > 0
              ? "category_spec_mismatch" as const
            : "below_token_threshold" as const;
        return {
          price,
          score,
          requiredScore,
          accepted,
          missingRequiredTokens,
          rejectionReason,
          rejectionReasons,
          contextSnippet: includeSnippets ? snippet(context, 260) : undefined,
        };
      })
      .sort((a, b) => b.score - a.score || a.price - b.price);
    const parsedCandidates = candidates.slice(0, maxCandidatesPerSource);
    const bestAcceptedCandidate = candidates.find((candidate) => candidate.accepted) ?? null;

    return {
      source: source.name,
      url: source.url,
      status: fetched.status,
      ok: fetched.ok,
      error: fetched.error,
      htmlBytes: fetched.html.length,
      antiBotDetected,
      rawHtmlSnippet: includeSnippets ? snippet(fetched.html.slice(0, 500), 500) : undefined,
      textSnippet: includeSnippets ? snippet(normalizeRetailerMatchText(stripHtml(fetched.html.slice(0, 3000))), 300) : undefined,
      priceMatchCount: priceMatches.length,
      rawCandidatePrices: priceMatches.map(({ price }) => price).slice(0, maxCandidatesPerSource * 4),
      inRatioCount: inRatio.length,
      outOfRatioCount: Math.max(0, priceMatches.length - inRatio.length),
      parsedCandidates,
      bestAcceptedCandidate,
      rejectionReason: sourceRejectionReason({
        ok: fetched.ok,
        status: fetched.status,
        error: fetched.error,
        antiBotDetected,
        priceMatchCount: priceMatches.length,
        inRatioCount: inRatio.length,
        acceptedCount: candidates.filter((candidate) => candidate.accepted).length,
        ramSpecMismatchCount: candidates.filter((candidate) => candidate.rejectionReason === "ram_spec_mismatch").length,
        categorySpecMismatchCount: candidates.filter((candidate) => candidate.rejectionReason === "category_spec_mismatch").length,
      }),
    };
  }));

  const sourceMatches = sourceDiagnostics.flatMap((source) => (
    source.bestAcceptedCandidate
      ? [{ source: source.source, price: source.bestAcceptedCandidate.price, score: source.bestAcceptedCandidate.score }]
      : []
  ));
  const aggregate = aggregateSourceMatches(sourceMatches, tokens.length);

  return {
    query,
    searchQuery,
    basePriceEur: basePrice,
    tokens,
    requiredScore,
    priceBounds: {
      min: Number(minPrice.toFixed(2)),
      max: Number(maxPrice.toFixed(2)),
    },
    sources: sourceDiagnostics,
    aggregate,
    finalRejectionReason: aggregate.sampleCount > 0 ? "accepted" : "no_trusted_retailer_quote",
  };
}

type PriceLookupOutcome = {
  quote: AggregatedPriceResult | null;
  reason: string | null;
  searchQuery: string;
  sourceReasonCounts: Record<string, number>;
};

function countByReason(reasons: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const reason of reasons) counts[reason] = (counts[reason] ?? 0) + 1;
  return counts;
}

function summarizeSkipReason(sourceReasonCounts: Record<string, number>): string {
  const parts = Object.entries(sourceReasonCounts)
    .filter(([reason]) => reason !== "accepted")
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([reason, count]) => `${reason}=${count}`);
  return parts.length > 0
    ? `no_trusted_retailer_quote: ${parts.join(", ")}`
    : "no_trusted_retailer_quote";
}

export function retailerSearchQuery(name: string): string {
  return name
    .replace(/[()]/g, " ")
    .replace(/[-_/]+/g, " ")
    .replace(/\b(\d+)\s*(gb|tb|w|mm|mhz|ghz)\b/gi, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

async function lookupPriceWithDiagnostics(category: PricingValidationCategory, query: string, basePrice: number): Promise<PriceLookupOutcome> {
  const searchQuery = retailerSearchQuery(query);
  const diagnostic = await diagnoseEstonianRetailerMatch(query, basePrice, { category, searchQuery });
  const sourceReasonCounts = countByReason(diagnostic.sources.map((source) => source.rejectionReason));
  if (diagnostic.aggregate.averagePrice === null) {
    return {
      quote: null,
      reason: summarizeSkipReason(sourceReasonCounts),
      searchQuery,
      sourceReasonCounts,
    };
  }

  return {
    quote: {
      price: diagnostic.aggregate.averagePrice,
      sampleCount: diagnostic.aggregate.sampleCount,
      sources: appendCategoryValidationSource(category, diagnostic.aggregate.sourcesSummary),
    },
    reason: null,
    searchQuery,
    sourceReasonCounts,
  };
}

async function collectComponents(): Promise<ComponentRow[]> {
  return listPriceTrackableCatalogItems();
}

function selectPricingTargets(
  components: ComponentRow[],
  checks: Awaited<ReturnType<typeof listEstonianPriceChecks>>,
  attempts: Awaited<ReturnType<typeof listLatestPricingAttemptTimes>>,
  limit: number,
): ComponentRow[] {
  const checkMap = new Map(checks.map((check) => [`${check.category}:${check.item_id}`, check.checked_at]));
  const attemptMap = new Map(attempts.map((attempt) => [`${attempt.category}:${attempt.item_id}`, attempt.attempted_at]));
  const cutoff24 = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const critical: PricedComponentRow[] = [];
  const backgroundByCategory = new Map<string, PricedComponentRow[]>();

  for (const component of components) {
    const checkedAt = checkMap.get(`${component.category}:${component.itemId}`) ?? null;
    const attemptedAt = attemptMap.get(`${component.category}:${component.itemId}`) ?? checkedAt;
    const row = { ...component, checkedAt, attemptedAt };
    if (component.pricingTier === "critical") {
      critical.push(row);
      continue;
    }
    const rows = backgroundByCategory.get(component.category) ?? [];
    rows.push(row);
    backgroundByCategory.set(component.category, rows);
  }

  critical.sort((a, b) => {
    const aStale = !a.checkedAt || a.checkedAt < cutoff24;
    const bStale = !b.checkedAt || b.checkedAt < cutoff24;
    if (aStale && !bStale) return -1;
    if (!aStale && bStale) return 1;
    return (a.attemptedAt ?? "").localeCompare(b.attemptedAt ?? "")
      || a.category.localeCompare(b.category)
      || a.itemId - b.itemId;
  });

  for (const rows of backgroundByCategory.values()) {
    rows.sort((a, b) => {
      const aStale = !a.checkedAt || a.checkedAt < cutoff24;
      const bStale = !b.checkedAt || b.checkedAt < cutoff24;
      if (aStale && !bStale) return -1;
      if (!aStale && bStale) return 1;
      return (a.attemptedAt ?? "").localeCompare(b.attemptedAt ?? "")
        || a.itemId - b.itemId;
    });
  }

  const targets: ComponentRow[] = critical.slice(0, limit);
  if (targets.length >= limit) return targets;

  const categories = [...backgroundByCategory.keys()];
  while (targets.length < limit) {
    let added = false;
    for (const category of categories) {
      const rows = backgroundByCategory.get(category);
      const next = rows?.shift();
      if (!next) continue;
      targets.push(next);
      added = true;
      if (targets.length >= limit) break;
    }
    if (!added) break;
  }

  return targets;
}

async function runWithConcurrency<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) break;
      await fn(next);
    }
  });
  await Promise.all(workers);
}

export async function refreshEstonianMarketPricing(options: RefreshOptions = {}): Promise<RefreshSummary> {
  const startedAt = new Date().toISOString();
  await normalizeCategoryRows();
  const [components, checks, attempts] = await Promise.all([
    collectComponents(),
    listEstonianPriceChecks(),
    listLatestPricingAttemptTimes(),
  ]);

  const runningOnVercel = process.env.VERCEL === "1";
  const defaultLimit = runningOnVercel ? DEFAULT_VERCEL_MAX_ITEMS : DEFAULT_LOCAL_MAX_ITEMS;
  const defaultConcurrency = runningOnVercel ? DEFAULT_VERCEL_CONCURRENCY : DEFAULT_LOCAL_CONCURRENCY;
  const limitRaw = Number.parseInt(process.env.ESTONIAN_PRICE_MAX_ITEMS ?? String(defaultLimit), 10);
  const limit = options.maxItems ?? (Number.isFinite(limitRaw) ? Math.max(1, limitRaw) : defaultLimit);
  const concurrencyRaw = Number.parseInt(process.env.ESTONIAN_PRICE_CONCURRENCY ?? String(defaultConcurrency), 10);
  const concurrency = options.concurrency ?? (Number.isFinite(concurrencyRaw) ? Math.max(1, concurrencyRaw) : defaultConcurrency);
  const fetchPrice = options.fetchPrice;

  const targets = selectPricingTargets(components, checks, attempts, limit);
  const trackableItems = components.length;
  const healthCriticalItems = components.filter((component) => component.pricingTier === "critical").length;
  const backgroundTrackableItems = trackableItems - healthCriticalItems;
  const processedItems = targets.length;
  const expectedVsProcessedMismatchWarning = processedItems !== trackableItems
    ? `Pricing run processed ${processedItems} of ${trackableItems} trackable item(s).`
    : null;
  const runId = await beginPricingRun(trackableItems, startedAt);
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let historyRowsInserted = 0;
  let historyRowsUpdated = 0;
  const skippedByReason: Record<string, number> = {};
  const skippedItems: SkippedItem[] = [];
  const failedItems: FailedItem[] = [];
  const lowSampleItems: Array<{ name: string; category: string; sampleCount: number }> = [];
  const adminOverrideItems: Array<{ name: string; category: string; itemId: number; expiresAt: string }> = [];

  try {
    await runWithConcurrency(targets, concurrency, async (component) => {
      const validationCategory = component.category as PricingValidationCategory;
      const lookup = fetchPrice
        ? {
          quote: await fetchPrice(component.name, component.basePriceEur).then((quote) => quote
            ? { ...quote, sources: appendCategoryValidationSource(validationCategory, quote.sources) }
            : null),
          reason: null,
          searchQuery: component.name,
          sourceReasonCounts: {},
        }
        : await lookupPriceWithDiagnostics(validationCategory, component.name, component.basePriceEur);
      let quote = lookup.quote;
      if (!quote) {
        const override = await getActiveAdminPricingOverride(component.category, component.itemId);
        if (override) {
          quote = {
            price: override.market_avg_eur,
            sampleCount: 1,
            sources: adminPricingOverrideSource(override),
          };
          adminOverrideItems.push({
            category: component.category,
            itemId: component.itemId,
            name: component.name,
            expiresAt: override.expires_at,
          });
        }
      }
      if (!quote) {
        const reason = lookup.reason ?? "no_trusted_retailer_quote";
        skipped++;
        skippedByReason[reason] = (skippedByReason[reason] ?? 0) + 1;
        skippedItems.push({
          category: component.category,
          itemId: component.itemId,
          name: component.name,
          query: lookup.searchQuery,
          reason,
          sourceReasonCounts: lookup.sourceReasonCounts,
        });
        await recordPricingRunFailure({
          runId,
          category: component.category,
          itemId: component.itemId,
          itemName: component.name,
          source: "source_lookup",
          errorMessage: reason,
        });
        return;
      }

      if (quote.sampleCount < 2) {
        lowSampleItems.push({ name: component.name, category: component.category, sampleCount: quote.sampleCount });
      }

      const marketAvg = Number(quote.price.toFixed(2));
      const finalPrice = Number((marketAvg * ASSEMBLY_MARKUP_MULTIPLIER).toFixed(2));

      try {
        await upsertEstonianPriceCheck({
          category: component.category,
          itemId: component.itemId,
          itemName: component.name,
          basePriceEur: component.basePriceEur,
          marketAvgEur: marketAvg,
          assemblyMarkupPct: ASSEMBLY_MARKUP_PCT,
          finalPriceEur: finalPrice,
          sampleCount: quote.sampleCount,
          sources: quote.sources,
        });

        const historyResult = await insertPriceHistory(component.category, component.itemId, marketAvg, quote.sources);
        if (historyResult.inserted) historyRowsInserted++;
        if (historyResult.updated) historyRowsUpdated++;

        updated++;
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Unknown DB write failure";
        failed++;
        failedItems.push({
          category: component.category,
          itemId: component.itemId,
          name: component.name,
          reason,
        });
        await recordPricingRunFailure({
          runId,
          category: component.category,
          itemId: component.itemId,
          itemName: component.name,
          source: "db_write",
          errorMessage: reason,
        });
      }
    });
  } catch (error) {
    const finishedAt = new Date().toISOString();
    await finishPricingRun({
      runId,
      status: "FAILED",
      finishedAt,
      totalItems: trackableItems,
      checkedItems: updated + skipped + failed,
      updatedItems: updated,
      failedItems: failed + 1,
      historyRowsInserted,
      historyRowsUpdated,
      staleCount: targets.length - updated,
      errorMessage: error instanceof Error ? error.message : "Pricing refresh failed.",
      notes: error instanceof Error ? error.message : "Pricing refresh failed.",
    });
    throw error;
  }

  const finishedAt = new Date().toISOString();
  const backfill = await backfillPriceHistoryFromChecks();
  historyRowsInserted += backfill.inserted;
  historyRowsUpdated += backfill.updated;
  const freshness = await getPricingFreshnessReport().catch(() => null);
  const staleCount = freshness ? Math.max(freshness.criticalMissingTodayCount, freshness.criticalStaleChecks24hCount) : skipped + failed;
  const backgroundStaleCount = freshness ? Math.max(freshness.backgroundMissingTodayCount, freshness.backgroundStaleChecks24hCount) : 0;
  const historyRowsWritten = historyRowsInserted + historyRowsUpdated;
  const status = failed > 0
    || skipped > 0
    || staleCount > 0
    || processedItems < trackableItems
    || (targets.length > 0 && updated === 0)
    || (updated > 0 && historyRowsWritten === 0)
    ? "PARTIAL"
    : "SUCCESS";
  await finishPricingRun({
    runId,
    status,
    finishedAt,
    totalItems: trackableItems,
    checkedItems: updated + skipped + failed,
    updatedItems: updated,
    failedItems: failed,
    historyRowsInserted,
    historyRowsUpdated,
    staleCount,
    errorMessage: failedItems[0]?.reason ?? (skipped > 0 ? "One or more items had no trusted retailer quote." : expectedVsProcessedMismatchWarning ?? ""),
    notes: `trackableItems=${trackableItems}; processedItems=${processedItems}; skipped=${skipped}; lowSampleItems=${lowSampleItems.length}; adminOverrideItems=${adminOverrideItems.length}; historyRowsInserted=${historyRowsInserted}; historyRowsUpdated=${historyRowsUpdated}; backfillDates=${backfill.targetDates.join(",")}`,
  });

  return {
    status,
    trackableItems,
    healthCriticalItems,
    backgroundTrackableItems,
    processedItems,
    processingLimit: limit,
    expectedVsProcessedMismatchWarning,
    checked: targets.length,
    updated,
    skipped,
    skippedByReason,
    skippedItems,
    failed,
    historyRowsInserted,
    historyRowsUpdated,
    staleCount,
    backgroundStaleCount,
    failedItems,
    lowSampleItems,
    adminOverrideItems,
    startedAt,
    finishedAt,
  };
}
