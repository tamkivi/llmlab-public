"use client";

import { useState } from "react";
import type { SiteLanguage } from "@/lib/lang";
import { ASSEMBLY_MARKUP_MULTIPLIER } from "@/lib/pricing-constants";

type PriceHistoryPoint = {
  date: string;
  price: number;
};

type RangeKey = "7d" | "30d" | "90d";

type BuildPriceHistorySeries = {
  key: string;
  label: string;
  name: string;
  orderPriceEur: number;
  marketAvgEur: number | null;
  checkedAt?: string | null;
  ranges: Record<RangeKey, PriceHistoryPoint[]>;
};

type BuildPriceHistoryChartProps = {
  series: BuildPriceHistorySeries[];
  lang?: SiteLanguage;
};

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_ET = ["jaan", "veebr", "märts", "apr", "mai", "juuni", "juuli", "aug", "sept", "okt", "nov", "dets"];
const COLORS = ["#14b8a6", "#f97316", "#8b5cf6", "#0ea5e9", "#84cc16", "#f43f5e", "#eab308", "#6366f1", "#06b6d4"];

function fmtDate(date: string, lang: SiteLanguage): string {
  const parts = date.split("-");
  const month = Number.parseInt(parts[1] ?? "1", 10);
  const day = Number.parseInt(parts[2] ?? "1", 10);
  const months = lang === "et" ? MONTHS_ET : MONTHS_EN;
  return `${months[month - 1] ?? parts[1]} ${day}`;
}

function fmtEur(n: number): string {
  return `€${Math.round(n).toLocaleString()}`;
}

function normalizeRange(points: PriceHistoryPoint[]): PriceHistoryPoint[] {
  const byDate = new Map<string, PriceHistoryPoint>();
  for (const point of points) {
    if (!point.date || !Number.isFinite(point.price) || point.price <= 0) continue;
    byDate.set(point.date, { date: point.date, price: Number(point.price.toFixed(2)) });
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function currentMarketReference(item: BuildPriceHistorySeries): number {
  if (item.marketAvgEur !== null && Number.isFinite(item.marketAvgEur) && item.marketAvgEur > 0) {
    return item.marketAvgEur;
  }
  return Number((item.orderPriceEur / ASSEMBLY_MARKUP_MULTIPLIER).toFixed(2));
}

function currentMarketPoint(item: BuildPriceHistorySeries): PriceHistoryPoint[] {
  if (item.marketAvgEur === null || !item.checkedAt || !Number.isFinite(item.marketAvgEur) || item.marketAvgEur <= 0) return [];
  const date = item.checkedAt.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  return normalizeRange([{ date, price: currentMarketReference(item) }]);
}

function latestAtOrBefore(points: PriceHistoryPoint[], date: string): PriceHistoryPoint | null {
  let latest: PriceHistoryPoint | null = null;
  for (const point of points) {
    if (point.date > date) break;
    latest = point;
  }
  return latest;
}

export function BuildPriceHistoryChart({ series, lang = "en" }: BuildPriceHistoryChartProps) {
  const isEt = lang === "et";

  const [selectedRange, setSelectedRange] = useState<RangeKey>("30d");
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);

  const historicalSeries = series.map((item, index) => ({
    ...item,
    color: COLORS[index % COLORS.length],
    historyPoints: normalizeRange(item.ranges[selectedRange] ?? []),
    currentPoints: currentMarketPoint(item),
  }));

  const hasHistoricalRangeData = series.some((item) => item.ranges["7d"].length > 0 || item.ranges["30d"].length > 0 || item.ranges["90d"].length > 0);
  const displaySeries = historicalSeries.map((item) => ({
    ...item,
    displayPoints: item.historyPoints.length > 0 ? item.historyPoints : item.currentPoints,
  }));
  const dates = Array.from(new Set(displaySeries.flatMap((item) => item.displayPoints.map((point) => point.date)))).sort();
  const hasData = dates.length > 0;
  const usesCurrentOnly = hasData && !hasHistoricalRangeData;
  const componentSeries = displaySeries.map((item) => ({
    ...item,
    points: item.displayPoints.length > 0
      ? item.displayPoints
      : dates.map((date) => ({ date, price: currentMarketReference(item) })),
  }));

  const totalPoints = dates.map((date) => {
    let price = 0;
    for (const item of componentSeries) {
      const latest = latestAtOrBefore(item.points, date);
      price += latest?.price ?? currentMarketReference(item);
    }
    return { date, price: Number(price.toFixed(2)), componentCount: series.length };
  });

  const W = 720;
  const H = 290;
  const PX = 34;
  const PY = 16;
  const plotW = W - PX * 2;
  const plotH = H - PY * 2;

  const xForDate = (date: string) => {
    if (dates.length <= 1) return PX + plotW / 2;
    const index = dates.indexOf(date);
    return PX + (index / (dates.length - 1)) * plotW;
  };

  const allPrices = [
    ...componentSeries.flatMap((item) => item.points.map((point) => point.price)),
    ...totalPoints.map((point) => point.price),
  ];
  const min = hasData ? Math.min(...allPrices) : 0;
  const max = hasData ? Math.max(...allPrices) : 0;
  const yMin = hasData ? Math.max(0, Math.floor(min * 0.9)) : 0;
  const yMax = hasData ? Math.ceil(max * 1.08) : 1;
  const yRange = yMax - yMin || 1;
  const yForPrice = (price: number) => PY + plotH - ((price - yMin) / yRange) * plotH;
  const yTicks = Array.from({ length: 5 }, (_, index) => yMin + (yRange * index) / 4);

  const pathFor = (points: PriceHistoryPoint[]) => points.map((point, index) => {
    const command = index === 0 ? "M" : "L";
    return `${command} ${xForDate(point.date)} ${yForPrice(point.price)}`;
  }).join(" ");

  const totalPath = pathFor(totalPoints);
  const hoveredTotal = hoveredDate ? totalPoints.find((point) => point.date === hoveredDate) ?? null : null;
  const hoveredComponents = hoveredDate
    ? componentSeries
      .map((item) => ({ item, point: latestAtOrBefore(item.points, hoveredDate) }))
      .filter((entry): entry is { item: typeof componentSeries[number]; point: PriceHistoryPoint } => Boolean(entry.point))
    : [];
  const latestTotal = totalPoints[totalPoints.length - 1] ?? null;

  const renderEmpty = () => (
    <div className="flex min-h-44 flex-col items-center justify-center rounded-lg border border-[color:var(--panel-border)] p-8 text-center">
      <p className="text-sm text-[color:var(--muted)]">
        {isEt ? "Komponentide hinnalugu pole veel saadaval." : "Component price history is not available yet."}
      </p>
      <p className="mt-2 text-xs text-[color:var(--muted)]">
        {isEt
          ? "Graafik ilmub pärast esimest edukat hinnavärskendust, mis salvestab kasutatava komponendi hinna."
          : "The chart appears after the first successful pricing refresh stores usable component pricing."}
      </p>
    </div>
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">
            {isEt ? "Kõik komponendid ja turu kogusumma" : "All components and market total"}
          </p>
          <p className="mt-1 text-xs text-[color:var(--muted)]">
            {isEt
              ? "Komponentide jooned näitavad Eesti turu keskmist enne kokkupanekut. Ajaloota komponendid kuvatakse praeguse turu viitehinnana."
              : "Component lines show Estonian market averages before assembly. Components without history are shown at their current market reference."}
          </p>
        </div>
        {latestTotal ? (
          <div className="text-right text-xs text-[color:var(--muted)]">
            <p>{isEt ? "Viimane turu kogusumma" : "Latest market total"}</p>
            <p className="font-mono text-lg font-semibold text-[color:var(--foreground)]">{fmtEur(latestTotal.price)}</p>
            <p>{latestTotal.componentCount}/{series.length} {isEt ? "komponenti" : "components"}</p>
          </div>
        ) : null}
      </div>

      {hasHistoricalRangeData ? (
        <div className="mb-3 flex gap-1">
          {(["7d", "30d", "90d"] as RangeKey[]).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={selectedRange === key}
              onClick={() => { setSelectedRange(key); setHoveredDate(null); }}
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
      ) : null}

      {hasData ? (
        <>
          {usesCurrentOnly ? (
            <div className="mb-3 rounded-lg border border-[color:var(--panel-border)] bg-[color:var(--panel)]/60 p-3 text-xs leading-5 text-[color:var(--muted)]">
              {isEt
                ? "Hinnalugu algab esimesest edukast hinnavärskendusest. Praegused komponentide hinnad on olemas, kuid trendi jaoks on vaja rohkem päevi."
                : "Price history begins after the first successful pricing refresh. Current component pricing is available, but more historical data is needed to show a trend."}
            </div>
          ) : null}
          <div className="mb-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-[color:var(--muted)]">
            <span className="inline-flex items-center gap-1">
              <span className="h-0.5 w-5 rounded bg-[color:var(--foreground)]" />
              <span>{isEt ? "Turu kogusumma" : "Market total"}</span>
            </span>
            {componentSeries.map((item) => (
              <span key={item.key} className="inline-flex max-w-full items-center gap-1">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                <span className="truncate">{item.label}</span>
              </span>
            ))}
          </div>

          <svg
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={isEt ? "Komponentide turu keskmise hinnagraafik" : "Component market average price chart"}
            className="w-full"
            style={{ height: 290, minHeight: 290 }}
            onMouseLeave={() => setHoveredDate(null)}
          >
            {yTicks.map((tick) => {
              const y = yForPrice(tick);
              return (
                <g key={tick}>
                  <line x1={PX} y1={y} x2={W - PX} y2={y} stroke="var(--panel-border)" strokeOpacity={0.45} strokeDasharray="3 3" />
                  <text x={PX - 8} y={y + 3} fill="var(--muted)" fontSize={10} textAnchor="end">
                    {fmtEur(tick)}
                  </text>
                </g>
              );
            })}

            {dates.map((date) => {
              const x = xForDate(date);
              return (
                <rect
                  key={`hit-${date}`}
                  x={x - Math.max(8, plotW / Math.max(dates.length, 2) / 2)}
                  y={PY}
                  width={Math.max(16, plotW / Math.max(dates.length, 2))}
                  height={plotH}
                  fill="transparent"
                  onMouseEnter={() => setHoveredDate(date)}
                  style={{ cursor: "crosshair" }}
                />
              );
            })}

            {componentSeries.map((item) => item.points.length > 0 ? (
              <g key={item.key}>
                <path d={pathFor(item.points)} fill="none" stroke={item.color} strokeWidth={1.5} strokeOpacity={0.9} />
                {item.points.map((point) => (
                  <circle key={`${item.key}-${point.date}`} cx={xForDate(point.date)} cy={yForPrice(point.price)} r={2.5} fill={item.color} />
                ))}
              </g>
            ) : null)}

            {totalPath ? (
              <path d={totalPath} fill="none" stroke="var(--foreground)" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
            ) : null}
            {totalPoints.map((point) => (
              <circle key={`total-${point.date}`} cx={xForDate(point.date)} cy={yForPrice(point.price)} r={3.5} fill="var(--foreground)" />
            ))}

            {hoveredDate && (
              <g>
                <line x1={xForDate(hoveredDate)} y1={PY} x2={xForDate(hoveredDate)} y2={H - PY} stroke="var(--foreground)" strokeOpacity={0.35} strokeDasharray="3 3" />
              </g>
            )}

            {hoveredDate && hoveredTotal ? (() => {
              const x = xForDate(hoveredDate);
              const tooltipWidth = 220;
              const rowHeight = 13;
              const visibleRows = Math.min(hoveredComponents.length, 7);
              const tooltipHeight = 48 + visibleRows * rowHeight;
              const tooltipX = x + tooltipWidth + 12 > W ? x - tooltipWidth - 12 : x + 12;
              const tooltipY = Math.max(PY, Math.min(H - PY - tooltipHeight, yForPrice(hoveredTotal.price) - tooltipHeight / 2));
              return (
                <g>
                  <rect x={tooltipX} y={tooltipY} width={tooltipWidth} height={tooltipHeight} rx={5} fill="var(--panel)" stroke="var(--panel-border)" />
                  <text x={tooltipX + 8} y={tooltipY + 16} fill="var(--foreground)" fontSize={11} fontFamily="monospace">
                    {fmtDate(hoveredDate, lang)}
                  </text>
                  <text x={tooltipX + 8} y={tooltipY + 31} fill="var(--foreground)" fontSize={11} fontFamily="monospace">
                    {isEt ? "Turu kogusumma" : "Market total"}: {fmtEur(hoveredTotal.price)} ({hoveredTotal.componentCount}/{series.length})
                  </text>
                  {hoveredComponents.slice(0, 7).map(({ item, point }, index) => (
                    <text key={item.key} x={tooltipX + 8} y={tooltipY + 48 + index * rowHeight} fill={item.color} fontSize={10} fontFamily="monospace">
                      {item.label}: {fmtEur(point.price)}
                    </text>
                  ))}
                </g>
              );
            })() : null}
          </svg>
        </>
      ) : renderEmpty()}
    </div>
  );
}
