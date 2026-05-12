import type { SiteLanguage } from "@/lib/lang";

export type PriceSource = "market_live" | "seed_fallback";
export type MarketDataStatus = "fresh" | "stale" | "none";
export type PriceBadgeMode = "full" | "compact";

export type PricingTransparency = {
  priceSource: PriceSource;
  checkedAt: string | null;
  sampleCount: number | null;
  marketDataStatus?: MarketDataStatus;
  latestCheckedAt?: string | null;
  latestSampleCount?: number | null;
};

function daysSince(dateIso: string, nowMs: number): number {
  const checkedMs = Date.parse(dateIso);
  if (!Number.isFinite(checkedMs)) return 0;
  return Math.max(0, Math.floor((nowMs - checkedMs) / 86_400_000));
}

function updatedLabel(days: number, lang: SiteLanguage): string {
  if (lang === "et") {
    if (days === 0) return "Uuendatud täna";
    if (days === 1) return "Uuendatud eile";
    return `Uuendatud ${days} päeva tagasi`;
  }
  if (days === 0) return "Updated today";
  if (days === 1) return "Updated yesterday";
  return `Updated ${days} days ago`;
}

function lastCheckedLabel(days: number, lang: SiteLanguage): string {
  if (lang === "et") {
    if (days === 0) return "Viimati kontrollitud täna";
    if (days === 1) return "Viimati kontrollitud eile";
    return `Viimati kontrollitud ${days} päeva tagasi`;
  }
  if (days === 0) return "Last checked today";
  if (days === 1) return "Last checked yesterday";
  return `Last checked ${days} days ago`;
}

export function getPriceTransparencyBadges(
  meta: PricingTransparency,
  lang: SiteLanguage = "en",
  nowMs = Date.now(),
  mode: PriceBadgeMode = "full",
): string[] {
  const isEt = lang === "et";
  const badges: string[] = [];

  if (meta.priceSource === "market_live") {
    badges.push(updatedLabel(meta.checkedAt ? daysSince(meta.checkedAt, nowMs) : 0, lang));
    if ((meta.sampleCount ?? 0) < 2) badges.push(isEt ? "Väike valim" : "Low sample");
    if (mode === "full" || badges.length < 2) badges.push(isEt ? "Eesti turu hinnang" : "Estonian market estimate");
    if (mode === "compact") return badges.slice(0, 2);
    badges.push(isEt ? "Sisaldab 15% kokkupanekut" : "Includes 15% assembly markup");
    return badges;
  }

  if (meta.marketDataStatus === "stale" && meta.latestCheckedAt) {
    badges.push(isEt ? "Aegunud turuandmed" : "Stale market data");
    badges.push(lastCheckedLabel(daysSince(meta.latestCheckedAt, nowMs), lang));
    if (mode === "compact") return badges.slice(0, 2);
    badges.push(isEt ? "Pakkumine vajalik" : "Quote required");
  } else {
    badges.push(isEt ? "Viitehinnang" : "Reference estimate");
    if (mode === "compact") return badges;
  }

  badges.push(isEt ? "Sisaldab 15% kokkupanekut" : "Includes 15% assembly markup");
  return badges;
}
