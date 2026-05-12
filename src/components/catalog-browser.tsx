"use client";

import Link from "next/link";
import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  defaultCatalogFilters,
  readCatalogUrlState,
  writeCatalogUrlState,
  type BudgetFilter,
  type CatalogFilters,
  type CheckoutFilter,
  type MemoryFilter,
  type PlatformFilter,
  type SortOption,
  type VendorFilter,
  type WorkloadFilter,
} from "@/lib/catalog-url";
import type { PricingTransparency } from "@/lib/price-transparency";
import { getPriceTransparencyBadges } from "@/lib/price-transparency";
import {
  workloadGuidance,
  workloadTierRank,
  type WorkloadTier,
} from "@/lib/workload-guidance";

export type SearchableCatalogItem = {
  id: number;
  name: string;
  category: string;
  specs: string[];
  preorderPriceEur: number;
  href: string;
  pricing: PricingTransparency;
  quoteOnly?: boolean;
  checkoutMode?: "direct" | "quote";
  gpuVendor?: "nvidia" | "amd" | "intel" | "apple" | "other";
  gpuVramGb?: number;
  systemRamGb?: number;
  platform?: "desktop" | "mac" | "mac-egpu";
  workloadTier?: WorkloadTier;
  searchKeywords?: string[];
};

export type CatalogGroup = {
  key: string;
  label: { en: string; et: string };
  items: SearchableCatalogItem[];
};

type PreparedCatalogItem = SearchableCatalogItem & {
  searchText: string;
};

type PreparedCatalogGroup = Omit<CatalogGroup, "items"> & {
  items: PreparedCatalogItem[];
};

const GROUP_PAIRS: string[][] = [
  ["gpu", "cpu"],
  ["ram_kit", "motherboard"],
  ["power_supply", "case"],
  ["storage_drive", "cpu_cooler"],
  ["compact_ai_system", "mac_system"],
  ["external_gpu_enclosure"],
];

function priceMatches(price: number, filter: BudgetFilter) {
  if (filter === "under-1200") return price < 1200;
  if (filter === "1200-2000") return price >= 1200 && price < 2000;
  if (filter === "2000-3500") return price >= 2000 && price < 3500;
  if (filter === "3500-plus") return price >= 3500;
  return true;
}

function thresholdMatches(value: number | undefined, filter: MemoryFilter) {
  if (filter === "all") return true;
  return typeof value === "number" && value >= Number(filter);
}

function workloadMatches(tier: WorkloadTier | undefined, filter: WorkloadFilter) {
  if (filter === "all") return true;
  return Boolean(tier && workloadTierRank(tier) >= workloadTierRank(filter));
}

export function CatalogBrowser({ groups, lang }: { groups: CatalogGroup[]; lang: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamString = searchParams.toString();
  const state = useMemo(
    () => readCatalogUrlState(searchParams),
    [searchParams],
  );

  function replaceCatalogUrl(nextState: { search: string; sort: SortOption; filters: CatalogFilters }) {
    const params = writeCatalogUrlState(new URLSearchParams(searchParamString), nextState);
    const query = params.toString();
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    router.replace(`${pathname}${query ? `?${query}` : ""}${hash}`, { scroll: false });
  }

  return <CatalogBrowserView groups={groups} lang={lang} state={state} onStateChange={replaceCatalogUrl} />;
}

export function CatalogBrowserView({
  groups,
  lang,
  state,
  onStateChange,
}: {
  groups: CatalogGroup[];
  lang: string;
  state: { search: string; sort: SortOption; filters: CatalogFilters };
  onStateChange?: (state: { search: string; sort: SortOption; filters: CatalogFilters }) => void;
}) {
  const isEt = lang === "et";
  const { search, sort, filters } = state;

  const groupMap = useMemo(() => {
    const map = new Map<string, PreparedCatalogGroup>();
    for (const group of groups) {
      map.set(group.key, {
        ...group,
        items: group.items.map((item) => ({
          ...item,
          searchText: [item.name, item.category, ...item.specs, ...(item.searchKeywords ?? [])].join(" ").toLowerCase(),
        })),
      });
    }
    return map;
  }, [groups]);

  const { filtered, totalResults } = useMemo(() => {
    const q = search.toLowerCase().trim();
    let resultCount = 0;
    const filteredPairs: PreparedCatalogGroup[][] = [];

    for (const pair of GROUP_PAIRS) {
      const filteredPair: PreparedCatalogGroup[] = [];

      for (const key of pair) {
        const group = groupMap.get(key);
        if (!group) continue;

        let items = group.items;

        if (q) {
          items = items.filter((item) => item.searchText.includes(q));
        }

        items = items.filter((item) => {
          const checkoutMode = item.checkoutMode ?? (item.quoteOnly ? "quote" : "direct");
          if (filters.checkout !== "all" && checkoutMode !== filters.checkout) return false;
          if (filters.platform !== "all" && item.platform !== filters.platform) return false;
          if (filters.vendor !== "all" && item.gpuVendor !== filters.vendor) return false;
          if (!priceMatches(item.preorderPriceEur, filters.budget)) return false;
          if (!thresholdMatches(item.gpuVramGb, filters.vram)) return false;
          if (!thresholdMatches(item.systemRamGb, filters.ram)) return false;
          if (!workloadMatches(item.workloadTier, filters.workload)) return false;
          return true;
        });

        if (sort === "price-asc") {
          items = [...items].sort((a, b) => a.preorderPriceEur - b.preorderPriceEur);
        } else if (sort === "price-desc") {
          items = [...items].sort((a, b) => b.preorderPriceEur - a.preorderPriceEur);
        }

        resultCount += items.length;
        if (items.length > 0) filteredPair.push({ ...group, items });
      }

      if (filteredPair.length > 0) filteredPairs.push(filteredPair);
    }

    return { filtered: filteredPairs, totalResults: resultCount };
  }, [filters, groupMap, search, sort]);

  const hasSearch = search.trim().length > 0;
  const hasFilters = Object.values(filters).some((value) => value !== "all");
  const hasDiscoveryConstraints = hasSearch || hasFilters;

  function updateSearch(value: string) {
    onStateChange?.({ search: value, sort, filters });
  }

  function updateSort(value: SortOption) {
    onStateChange?.({ search, sort: value, filters });
  }

  function updateFilter<K extends keyof CatalogFilters>(key: K, value: CatalogFilters[K]) {
    onStateChange?.({ search, sort, filters: { ...filters, [key]: value } });
  }

  function clearDiscovery() {
    onStateChange?.({ search: "", sort: "default", filters: defaultCatalogFilters });
  }

  return (
    <div>
      <div className="mb-10 rounded-xl border border-[color:var(--panel-border)] bg-[color:var(--panel)]/70 p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative min-w-[200px] flex-1">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--muted)]"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => updateSearch(e.target.value)}
              aria-label={isEt ? "Otsi komponente" : "Search components"}
              placeholder={isEt ? "Otsi kasutuse, GPU või mudeli järgi..." : "Search by use case, GPU, or model size..."}
              className="w-full rounded-lg border border-[color:var(--panel-border)] bg-[color:var(--panel)] px-4 py-2 pl-10 text-sm text-[color:var(--foreground)] placeholder:text-[color:var(--muted)] focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <FilterSelect
              label={isEt ? "Sorteeri" : "Sort"}
              value={sort}
              onChange={(value) => updateSort(value as SortOption)}
              options={[
                ["default", isEt ? "Soovitatud" : "Recommended"],
                ["price-asc", isEt ? "Hind: madal-kõrge" : "Price: Low-High"],
                ["price-desc", isEt ? "Hind: kõrge-madal" : "Price: High-Low"],
              ]}
            />
            {hasDiscoveryConstraints ? (
              <span className="text-sm text-[color:var(--muted)]">
                {totalResults} {isEt ? (totalResults === 1 ? "tulemus" : "tulemust") : totalResults === 1 ? "result" : "results"}
              </span>
            ) : null}
          </div>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          <FilterSelect
            label={isEt ? "Ostuviis" : "Checkout"}
            value={filters.checkout}
            onChange={(value) => updateFilter("checkout", value as CheckoutFilter)}
            options={[
              ["all", isEt ? "Kõik" : "All"],
              ["direct", isEt ? "Otsekassa" : "Direct checkout"],
              ["quote", isEt ? "Pakkumine" : "Quote-only"],
            ]}
          />
          <FilterSelect
            label={isEt ? "Eelarve" : "Budget"}
            value={filters.budget}
            onChange={(value) => updateFilter("budget", value as BudgetFilter)}
            options={[
              ["all", isEt ? "Kõik hinnad" : "Any price"],
              ["under-1200", "€0-1,200"],
              ["1200-2000", "€1,200-2,000"],
              ["2000-3500", "€2,000-3,500"],
              ["3500-plus", "€3,500+"],
            ]}
          />
          <FilterSelect
            label="GPU"
            value={filters.vendor}
            onChange={(value) => updateFilter("vendor", value as VendorFilter)}
            options={[
              ["all", isEt ? "Kõik" : "Any"],
              ["nvidia", "NVIDIA"],
              ["amd", "AMD"],
              ["intel", "Intel"],
              ["apple", "Apple"],
            ]}
          />
          <FilterSelect
            label="VRAM"
            value={filters.vram}
            onChange={(value) => updateFilter("vram", value as MemoryFilter)}
            options={[
              ["all", isEt ? "Kõik" : "Any"],
              ["8", "8GB+"],
              ["12", "12GB+"],
              ["16", "16GB+"],
              ["24", "24GB+"],
              ["48", "48GB+"],
            ]}
          />
          <FilterSelect
            label="RAM"
            value={filters.ram}
            onChange={(value) => updateFilter("ram", value as MemoryFilter)}
            options={[
              ["all", isEt ? "Kõik" : "Any"],
              ["16", "16GB+"],
              ["32", "32GB+"],
              ["64", "64GB+"],
              ["128", "128GB+"],
            ]}
          />
          <FilterSelect
            label={isEt ? "Mudel" : "Model"}
            value={filters.workload}
            onChange={(value) => updateFilter("workload", value as WorkloadFilter)}
            options={[
              ["all", isEt ? "Kõik" : "Any"],
              ["7b", "7B+"],
              ["13b", "13B+"],
              ["30b", "30B+"],
              ["70b", "70B+"],
            ]}
          />
          <FilterSelect
            label={isEt ? "Platvorm" : "Platform"}
            value={filters.platform}
            onChange={(value) => updateFilter("platform", value as PlatformFilter)}
            options={[
              ["all", isEt ? "Kõik" : "Any"],
              ["desktop", "Desktop PC"],
              ["mac", "Mac"],
              ["mac-egpu", "Mac/eGPU"],
            ]}
          />
        </div>

        {hasDiscoveryConstraints ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--panel-border)] pt-3">
            <p className="text-xs leading-5 text-[color:var(--muted)]">
              {isEt
                ? "Filtrid on ligikaudsed ostuotsuse abivahendid; mudeli sobivus sõltub kvantimisest ja runtime'ist."
                : "Filters are buyer guidance only; model fit still depends on quantization and runtime."}
            </p>
            <button type="button" onClick={clearDiscovery} className="btn-secondary text-xs">
              {isEt ? "Tühjenda filtrid" : "Clear filters"}
            </button>
          </div>
        ) : (
          <p className="mt-3 border-t border-[color:var(--panel-border)] pt-3 text-xs leading-5 text-[color:var(--muted)]">
            {isEt
              ? "Alusta mudeli suurusest või eelarvest, kui sa ei tea veel täpset GPU või komponendi nime."
              : "Start with model size or budget if you do not know the exact GPU or component name yet."}
          </p>
        )}
      </div>

      {hasDiscoveryConstraints && totalResults === 0 ? (
        <div className="storefront-section p-10 text-center md:p-12">
          <p className="font-display text-2xl font-semibold">
            {isEt ? "Sobivaid tooteid ei leitud." : "No matching products found."}
          </p>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[color:var(--muted)]">
            {isEt
              ? "Proovi laiemat eelarvet, madalamat VRAM/RAM piiri või vaata pakkumispõhiseid süsteeme."
              : "Try a wider budget, lower VRAM/RAM threshold, or include quote-only systems."}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={clearDiscovery}
              className="btn-primary text-sm"
            >
              {isEt ? "Tühjenda filtrid" : "Clear filters"}
            </button>
            <Link href="#build-profiles" className="btn-secondary text-sm">
              {isEt ? "Kasuta kategooriaid" : "Use build categories"}
            </Link>
          </div>
        </div>
      ) : (
        filtered.map((pair) => (
          <div key={pair.map((g) => g.key).join("-")} className="mt-8 grid items-start gap-6 md:grid-cols-2 md:gap-8">
            {pair.map((group) => (
              <CatalogSection
                key={group.key}
                title={isEt ? group.label.et : group.label.en}
                count={group.items.length}
                lang={lang}
              >
                {group.items.map((item) => (
                  <CatalogItem
                    key={`${group.key}-${item.id}`}
                    name={item.name}
                    specs={item.specs}
                    preorderPriceEur={item.preorderPriceEur}
                    href={item.href}
                    pricing={item.pricing}
                    quoteOnly={item.quoteOnly}
                    gpuVramGb={item.gpuVramGb}
                    systemRamGb={item.systemRamGb}
                    platform={item.platform}
                    workloadTier={item.workloadTier}
                    lang={lang}
                  />
                ))}
              </CatalogSection>
            ))}
          </div>
        ))
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[color:var(--muted)]">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-[color:var(--panel-border)] bg-[color:var(--panel)] px-3 py-2 text-sm text-[color:var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>{optionLabel}</option>
        ))}
      </select>
    </label>
  );
}

function CatalogSection({
  title,
  count,
  children,
  lang,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
  lang: string;
}) {
  const countLabel = lang === "et" ? `${count} kirjet` : `${count} listed`;

  return (
    <section className="storefront-section p-5 md:p-7">
      <details className="catalog-dropdown" open>
        <summary className="catalog-summary mb-7 cursor-pointer list-none md:mb-8">
          <h3 className="font-display text-2xl md:text-3xl font-semibold">{title}</h3>
          <span className="label-pill">{countLabel}</span>
        </summary>
        <div className="space-y-4">{children}</div>
      </details>
    </section>
  );
}

function CatalogItem({
  name,
  specs,
  preorderPriceEur,
  href,
  pricing,
  quoteOnly,
  gpuVramGb,
  systemRamGb,
  platform,
  workloadTier,
  lang,
}: {
  name: string;
  specs: string[];
  preorderPriceEur: number;
  href: string;
  pricing: PricingTransparency;
  quoteOnly?: boolean;
  gpuVramGb?: number;
  systemRamGb?: number;
  platform?: "desktop" | "mac" | "mac-egpu";
  workloadTier?: WorkloadTier;
  lang: string;
}) {
  const isEt = lang === "et";
  const canPayNow = !quoteOnly && pricing.priceSource === "market_live" && pricing.marketDataStatus !== "stale";
  const guidance = workloadTier
    ? workloadGuidance({ gpuVramGb, systemRamGb, platform, gpuName: name }, isEt ? "et" : "en")
    : null;

  return (
    <div className="product-card p-5">
      <div className="flex min-h-20 flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <p className="text-base font-semibold leading-6">{name}</p>
          <p className="mt-2 text-xs leading-5 text-[color:var(--muted)]">{specs[0]}</p>
        </div>
        <div className="sm:text-right">
          <p className="text-[11px] uppercase tracking-wide text-[color:var(--muted)]">
            {canPayNow
              ? (isEt ? "Tellimuse hind" : "Order price")
              : quoteOnly
              ? (isEt ? "Pakkumise alus" : "Quote reference")
              : (isEt ? "Viitehinnang" : "Reference")}
          </p>
          <p className="mt-1 text-lg font-semibold">€{preorderPriceEur}</p>
        </div>
      </div>
      {specs.slice(1).map((spec) => (
        <p key={spec} className="mt-2 text-xs leading-5 text-[color:var(--muted)]">
          {spec}
        </p>
      ))}
      {guidance ? (
        <div className="mt-4 rounded-lg border border-[color:var(--panel-border)] bg-[color:var(--background)]/30 p-3">
          <p className="text-xs font-semibold text-[color:var(--foreground)]">{guidance.label}</p>
          <p className="mt-1 text-xs leading-5 text-[color:var(--muted)]">{guidance.detail}</p>
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {quoteOnly ? <span className="label-pill">{isEt ? "Ainult pakkumisega" : "Quote-only"}</span> : null}
        {getPriceTransparencyBadges(pricing, isEt ? "et" : "en", undefined, "compact").map((badge) => (
          <span key={badge} className="label-pill">{badge}</span>
        ))}
      </div>
      <Link href={href} className="btn-secondary mt-5 inline-flex w-full justify-center text-sm sm:w-auto">
        {isEt ? "Vaata detaile" : "View details"}
      </Link>
    </div>
  );
}
