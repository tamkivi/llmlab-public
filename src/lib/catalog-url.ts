export type CheckoutFilter = "all" | "direct" | "quote";
export type BudgetFilter = "all" | "under-1200" | "1200-2000" | "2000-3500" | "3500-plus";
export type VendorFilter = "all" | "nvidia" | "amd" | "intel" | "apple";
export type MemoryFilter = "all" | "8" | "12" | "16" | "24" | "32" | "48" | "64" | "128";
export type WorkloadFilter = "all" | "7b" | "13b" | "30b" | "70b";
export type PlatformFilter = "all" | "desktop" | "mac" | "mac-egpu";
export type SortOption = "default" | "price-asc" | "price-desc";

export type CatalogFilters = {
  checkout: CheckoutFilter;
  budget: BudgetFilter;
  vendor: VendorFilter;
  vram: MemoryFilter;
  ram: MemoryFilter;
  workload: WorkloadFilter;
  platform: PlatformFilter;
};

export type CatalogUrlState = {
  search: string;
  sort: SortOption;
  filters: CatalogFilters;
};

export const CATALOG_ANCHOR = "component-catalog";

export const catalogQueryKeys = {
  search: "q",
  sort: "sort",
  checkout: "checkout",
  budget: "budget",
  vendor: "gpu",
  vram: "vram",
  ram: "ram",
  workload: "model",
  platform: "platform",
} as const;

export const defaultCatalogFilters: CatalogFilters = {
  checkout: "all",
  budget: "all",
  vendor: "all",
  vram: "all",
  ram: "all",
  workload: "all",
  platform: "all",
};

export const defaultCatalogUrlState: CatalogUrlState = {
  search: "",
  sort: "default",
  filters: defaultCatalogFilters,
};

const sortOptions = ["default", "price-asc", "price-desc"] as const;
const checkoutOptions = ["all", "direct", "quote"] as const;
const budgetOptions = ["all", "under-1200", "1200-2000", "2000-3500", "3500-plus"] as const;
const vendorOptions = ["all", "nvidia", "amd", "intel", "apple"] as const;
const memoryOptions = ["all", "8", "12", "16", "24", "32", "48", "64", "128"] as const;
const workloadOptions = ["all", "7b", "13b", "30b", "70b"] as const;
const platformOptions = ["all", "desktop", "mac", "mac-egpu"] as const;

type SearchParamReader = {
  get(name: string): string | null;
};

function optionOrDefault<T extends readonly string[]>(value: string | null, allowed: T, fallback: T[number]): T[number] {
  return value && allowed.includes(value) ? value : fallback;
}

function cleanSearch(value: string | null) {
  return (value ?? "").trim().slice(0, 120);
}

export function readCatalogUrlState(params: SearchParamReader): CatalogUrlState {
  return {
    search: cleanSearch(params.get(catalogQueryKeys.search)),
    sort: optionOrDefault(params.get(catalogQueryKeys.sort), sortOptions, "default"),
    filters: {
      checkout: optionOrDefault(params.get(catalogQueryKeys.checkout), checkoutOptions, "all"),
      budget: optionOrDefault(params.get(catalogQueryKeys.budget), budgetOptions, "all"),
      vendor: optionOrDefault(params.get(catalogQueryKeys.vendor), vendorOptions, "all"),
      vram: optionOrDefault(params.get(catalogQueryKeys.vram), memoryOptions, "all"),
      ram: optionOrDefault(params.get(catalogQueryKeys.ram), memoryOptions, "all"),
      workload: optionOrDefault(params.get(catalogQueryKeys.workload), workloadOptions, "all"),
      platform: optionOrDefault(params.get(catalogQueryKeys.platform), platformOptions, "all"),
    },
  };
}

export function writeCatalogUrlState(params: URLSearchParams, state: CatalogUrlState) {
  Object.values(catalogQueryKeys).forEach((key) => params.delete(key));

  const search = cleanSearch(state.search);
  if (search) params.set(catalogQueryKeys.search, search);
  if (state.sort !== "default") params.set(catalogQueryKeys.sort, state.sort);

  const { filters } = state;
  if (filters.checkout !== "all") params.set(catalogQueryKeys.checkout, filters.checkout);
  if (filters.budget !== "all") params.set(catalogQueryKeys.budget, filters.budget);
  if (filters.vendor !== "all") params.set(catalogQueryKeys.vendor, filters.vendor);
  if (filters.vram !== "all") params.set(catalogQueryKeys.vram, filters.vram);
  if (filters.ram !== "all") params.set(catalogQueryKeys.ram, filters.ram);
  if (filters.workload !== "all") params.set(catalogQueryKeys.workload, filters.workload);
  if (filters.platform !== "all") params.set(catalogQueryKeys.platform, filters.platform);

  return params;
}

type CatalogHrefInput = Omit<Partial<CatalogUrlState>, "filters"> & {
  filters?: Partial<CatalogFilters>;
};

export function catalogHref(state: CatalogHrefInput) {
  const merged: CatalogUrlState = {
    search: state.search ?? "",
    sort: state.sort ?? "default",
    filters: {
      ...defaultCatalogFilters,
      ...(state.filters ?? {}),
    },
  };
  const params = writeCatalogUrlState(new URLSearchParams(), merged);
  const query = params.toString();
  return `/${query ? `?${query}` : ""}#${CATALOG_ANCHOR}`;
}
