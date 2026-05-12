import type { SiteLanguage } from "@/lib/lang";
import { getPriceTransparencyBadges, type PricingTransparency } from "@/lib/price-transparency";

export function PriceTransparencyBadges({
  pricing,
  lang = "en",
  compact = false,
}: {
  pricing: PricingTransparency;
  lang?: SiteLanguage;
  compact?: boolean;
}) {
  return (
    <div className={`flex flex-wrap gap-2 ${compact ? "mt-3" : "mt-4"}`}>
      {getPriceTransparencyBadges(pricing, lang, undefined, compact ? "compact" : "full").map((badge) => (
        <span key={badge} className="label-pill">
          {badge}
        </span>
      ))}
    </div>
  );
}
