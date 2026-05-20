"use client";

import { useState } from "react";
import type { SiteLanguage } from "@/lib/lang";
import { ASSEMBLY_MARKUP_PCT, ASSEMBLY_MARKUP_MULTIPLIER } from "@/lib/pricing-constants";

type PriceHistoryPoint = {
  date: string;
  price: number;
};

type RangeKey = "7d" | "30d" | "90d";

type PriceGraphProps = {
  ranges: Record<RangeKey, PriceHistoryPoint[]>;
  preorderPriceEur: number | null;
  marketAvgEur: number | null;
  checkedAt?: string | null;
  isQuoteProduct?: boolean;
  marketOnly?: boolean;
  lang?: SiteLanguage;
};

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_ET = ["jaan", "veebr", "märts", "apr", "mai", "juuni", "juuli", "aug", "sept", "okt", "nov", "dets"];

function fmtDate(date: string, lang: SiteLanguage): string {
  const parts = date.split("-");
  const months = lang === "et" ? MONTHS_ET : MONTHS_EN;
  return `${months[parseInt(parts[1], 10) - 1]} ${parseInt(parts[2], 10)}`;
}

function fmtEur(n: number): string {
  return `€${Math.round(n).toLocaleString()}`;
}

function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function currentMarketPoint(marketAvgEur: number | null, checkedAt?: string | null): PriceHistoryPoint[] {
  if (marketAvgEur === null || !checkedAt) return [];
  const date = checkedAt.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  return [{ date, price: marketAvgEur }];
}

export function PriceGraph({ ranges, preorderPriceEur, marketAvgEur, checkedAt, isQuoteProduct, marketOnly = false, lang = "en" }: PriceGraphProps) {
  const accent = cssVar("--accent", "#3cb8a5");
  const grid = cssVar("--panel-border", "#2f3d4f");
  const isEt = lang === "et";

  const [selectedRange, setSelectedRange] = useState<RangeKey>("30d");
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const anyRangeHasData = ranges["7d"].length > 0 || ranges["30d"].length > 0 || ranges["90d"].length > 0;
  const selectedRangeData = ranges[selectedRange];
  const data = selectedRangeData.length > 0 ? selectedRangeData : currentMarketPoint(marketAvgEur, checkedAt);
  const hasData = data.length > 0;
  const usesCurrentOnly = hasData && !anyRangeHasData;

  const preorderEquiv = (price: number) => Math.round(price * ASSEMBLY_MARKUP_MULTIPLIER);

  const W = 600;
  const H = 220;
  const PX = 0;
  const PY = 4;
  const plotW = W - PX;
  const plotH = H - PY * 2;

  const renderChart = () => {
    const prices = data.map((d) => d.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const avg = Number((prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2));

    const yMin = Math.floor(min * 0.95);
    const yMax = Math.ceil(max * 1.05);
    const yRange = yMax - yMin || 1;

    const xStep = data.length > 1 ? plotW / (data.length - 1) : plotW / 2;

    const points = data.map((d, i) => ({
      x: PX + (data.length > 1 ? i * xStep : plotW / 2),
      y: PY + plotH - ((d.price - yMin) / yRange) * plotH,
      ...d,
    }));

    const areaPath = [
      `M ${points[0].x} ${points[0].y}`,
      ...points.slice(1).map((p) => `L ${p.x} ${p.y}`),
      `L ${points[points.length - 1].x} ${H}`,
      `L ${points[0].x} ${H}`,
      "Z",
    ].join(" ");

    const linePath = [
      `M ${points[0].x} ${points[0].y}`,
      ...points.slice(1).map((p) => `L ${p.x} ${p.y}`),
    ].join(" ");

    const yTicks = 4;
    const yTickValues = Array.from({ length: yTicks + 1 }, (_, i) => yMin + (yRange * i) / yTicks);

    const hovered = hoveredIdx !== null ? points[hoveredIdx] : null;
    const latestPoint = points[points.length - 1];

    const ttW = 155;
    const ttH = 50;

    return (
      <div>
        <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-[color:var(--muted)]">
          <span>{isEt ? "Madal" : "Low"}: <strong className="text-[color:var(--foreground)]">€{min}</strong></span>
          <span>{isEt ? "Kõrge" : "High"}: <strong className="text-[color:var(--foreground)]">€{max}</strong></span>
          <span>{isEt ? "Keskmine" : "Avg"}: <strong className="text-[color:var(--foreground)]">€{avg}</strong></span>
          <span className="ml-auto">{data.length} {isEt ? "andmepunkti" : `data point${data.length !== 1 ? "s" : ""}`}</span>
        </div>

        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          style={{ height: 220, minHeight: 220 }}
          onMouseLeave={() => setHoveredIdx(null)}
        >
          <defs>
            <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={accent} stopOpacity={0.3} />
              <stop offset="95%" stopColor={accent} stopOpacity={0} />
            </linearGradient>
          </defs>

          {yTickValues.map((v) => {
            const y = PY + plotH - ((v - yMin) / yRange) * plotH;
            return (
              <g key={v}>
                <line x1={PX} y1={y} x2={W} y2={y} stroke={grid} strokeOpacity={0.4} strokeDasharray="3 3" />
              </g>
            );
          })}

          <path d={areaPath} fill="url(#priceGradient)" />
          <path d={linePath} fill="none" stroke={accent} strokeWidth={2} />

          {points.map((p, i) => {
            const isLatest = i === points.length - 1;
            return (
              <circle
                key={i}
                cx={p.x}
                cy={p.y}
                r={hoveredIdx === i ? 5 : isLatest ? 4 : 3}
                fill={accent}
                style={{ cursor: "pointer" }}
                onMouseEnter={() => setHoveredIdx(i)}
              />
            );
          })}

          {latestPoint && (
            <g>
              <circle
                cx={latestPoint.x}
                cy={latestPoint.y}
                r={9}
                fill={accent}
                fillOpacity={0.15}
                stroke={accent}
                strokeWidth={1}
                strokeOpacity={0.3}
              />
              <text
                x={latestPoint.x + (latestPoint.x > W * 0.8 ? -10 : 14)}
                y={latestPoint.y - 12}
                fill={accent}
                fontSize={10}
                fontWeight={600}
                textAnchor={latestPoint.x > W * 0.8 ? "end" : "start"}
              >
                {isEt ? "Viimane" : "Latest"}
              </text>
            </g>
          )}

          {hovered && (() => {
            const ttRight = hovered.x + 8 + ttW > W;
            const ttX = ttRight ? hovered.x - ttW - 8 : hovered.x + 8;
            const ttAbove = hovered.y - ttH - 4 >= PY;
            const ttY = ttAbove ? hovered.y - ttH - 4 : hovered.y + 12;
            const txX = ttX + 6;

            return (
              <g>
                <line
                  x1={hovered.x}
                  y1={PY}
                  x2={hovered.x}
                  y2={H - PY}
                  stroke={accent}
                  strokeOpacity={0.4}
                  strokeDasharray="3 3"
                />
                <rect
                  x={ttX}
                  y={ttY}
                  width={ttW}
                  height={ttH}
                  rx={4}
                  fill="var(--panel)"
                  stroke="var(--panel-border)"
                  strokeWidth={1}
                />
                <text x={txX} y={ttY + 14} fill="var(--foreground)" fontSize={11} fontFamily="monospace">
                  {fmtDate(hovered.date, lang)}
                </text>
                <text x={txX} y={ttY + 28} fill="var(--muted)" fontSize={10} fontFamily="monospace">
                  {isEt ? "Turu keskmine" : "Market avg"}: €{Math.round(hovered.price).toLocaleString()}
                </text>
                <text x={txX} y={ttY + 42} fill="var(--muted)" fontSize={10} fontFamily="monospace">
                  {marketOnly
                    ? `${isEt ? "Hind" : "Price"}: ${fmtEur(hovered.price)}`
                    : `${isQuoteProduct ? (isEt ? "Pakkumise alus" : "Quote reference") : (isEt ? "Tellimuse hind" : "Order price")}: ~${fmtEur(preorderEquiv(hovered.price))}`
                  }
                </text>
              </g>
            );
          })()}
        </svg>
      </div>
    );
  };

  const renderEmpty = () => {
    const hasLivePricing = marketAvgEur !== null;
    return (
      <div
        className="flex flex-col items-center justify-center rounded-lg border border-[color:var(--panel-border)] p-8 text-center"
        style={{ minHeight: 160 }}
      >
        <p className="text-sm text-[color:var(--muted)]">
          {hasLivePricing
            ? (isEt ? "Hinnajälgimine pole veel aktiivne." : "Historical price tracking has not started yet.")
            : (isEt ? "Ajaloolist hinnapäringut pole veel." : "No historical pricing yet.")}
        </p>
        <p className="mt-2 text-xs text-[color:var(--muted)]">
          {hasLivePricing
            ? (isEt
              ? "Live turuhind on saadaval, kuid ajalooline jälgimine algab pärast esimest plaanilist hinnakontrolli."
              : "Live market pricing is available, but historical tracking begins after the first scheduled pricing refresh.")
            : (isEt
              ? "See toode on värskelt lisatud või ootab turuandmete kogumist."
              : "This product is newly added or awaiting market data collection.")}
        </p>
        <p className="mt-2 text-xs text-[color:var(--muted)]">
          {isEt
            ? "Kui ajalugu tekib, näitab graafik turu keskmist enne kokkupaneku juurdehindlust."
            : "When history is available, charts show the Estonian market average before assembly markup."}
        </p>
      </div>
    );
  };

  return (
    <div>
      {!marketOnly && marketAvgEur !== null && preorderPriceEur !== null && (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-[color:var(--panel-border)] bg-[color:var(--panel)] px-3 py-2 text-xs">
          <span>
            {isQuoteProduct
              ? (isEt ? "Pakkumise alus" : "Quote reference")
              : (isEt ? "Tellimuse hind" : "Order price")
            }:{" "}
            <strong className="text-[color:var(--foreground)]">{fmtEur(preorderPriceEur)}</strong>
          </span>
          <span className="text-[color:var(--muted)]">·</span>
          <span>
            {isEt ? "Viimane Eesti turu keskmine enne kokkupanekut" : "Latest Estonian market average before assembly"}:{" "}
            <strong className="text-[color:var(--foreground)]">{fmtEur(marketAvgEur)}</strong>
          </span>
          <span className="text-[color:var(--muted)]">·</span>
          <span className="text-[color:var(--muted)]">
            {isEt ? "Koostamine + seadistus" : "Assembly + configuration"}: +{ASSEMBLY_MARKUP_PCT}%
          </span>
        </div>
      )}

      {usesCurrentOnly && (
        <div className="mb-3 rounded-lg border border-[color:var(--panel-border)] bg-[color:var(--panel)]/60 p-3 text-xs leading-5 text-[color:var(--muted)]">
          {isEt
            ? "Hinnaajalugu algab esimesest edukast hinnavärskendusest. Praegune komponendi hind on olemas, kuid trendi jaoks on vaja rohkem päevi."
            : "Price history begins after the first successful pricing refresh. Current component pricing is available, but more historical data is needed to show a trend."}
        </div>
      )}

      {anyRangeHasData && (
        <div className="mb-3 flex gap-1">
          {(["7d", "30d", "90d"] as RangeKey[]).map((key) => (
            <button
              key={key}
              onClick={() => { setSelectedRange(key); setHoveredIdx(null); }}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                selectedRange === key
                  ? "bg-[color:var(--accent)] text-white"
                  : "bg-[color:var(--panel)] text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
              }`}
            >
              {key}
            </button>
          ))}
        </div>
      )}

      {hasData ? renderChart() : renderEmpty()}
    </div>
  );
}
