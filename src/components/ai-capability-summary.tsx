import type { SiteLanguage } from "@/lib/lang";
import { estimateAiCapability, type AiCapabilityInput } from "@/lib/ai-capability";

export function AiCapabilitySummary({
  input,
  lang = "en",
  compact = false,
  showCompactCaveat = false,
}: {
  input: AiCapabilityInput;
  lang?: SiteLanguage;
  compact?: boolean;
  showCompactCaveat?: boolean;
}) {
  const estimate = estimateAiCapability(input, lang);
  const isEt = lang === "et";

  return (
    <div className={compact ? "mt-3" : "mt-5 rounded-lg border border-[color:var(--panel-border)] p-4"}>
      <p className="text-sm font-semibold">{estimate.headline}</p>
      <ul className="arrow-list mt-2 space-y-1 text-xs leading-5 text-[color:var(--muted)]">
        {estimate.tiers.slice(0, compact ? 2 : 4).map((tier) => (
          <li key={tier}>{isEt ? "Umbes sobib:" : "Roughly suitable for:"} {tier}</li>
        ))}
      </ul>
      {!compact ? (
        <p className="mt-3 text-xs text-[color:var(--muted)]">{estimate.caution}</p>
      ) : showCompactCaveat ? (
        <p className="mt-2 text-xs text-[color:var(--muted)]">
          {isEt
            ? "Ligikaudne hinnang; mudel, runtime ja kvantimine mõjutavad tulemust."
            : "Rough estimate; model/runtime/quantization affects results."}
        </p>
      ) : null}
    </div>
  );
}
