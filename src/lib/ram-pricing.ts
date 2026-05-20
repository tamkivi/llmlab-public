export const RAM_PRICE_MIN_RATIO = 0.55;
export const RAM_PRICE_MAX_RATIO = 1.75;
export const RAM_DIRECT_CHECKOUT_MATERIAL_DEVIATION_RATIO = 1.25;

type RamSpec = {
  totalCapacityGb: number | null;
  moduleCount: number | null;
  moduleCapacityGb: number | null;
  ddrGeneration: string | null;
  speedMtS: number | null;
  casLatency: number | null;
  formFactor: "dimm" | "sodimm" | "rdimm" | "udimm" | null;
  rgb: boolean | null;
  lineTokens: string[];
  tokens: Set<string>;
};

export type RamCandidateValidation = {
  ok: boolean;
  reasons: string[];
  catalog: RamSpec;
  candidate: RamSpec;
};

const RAM_NON_LINE_TOKENS = new Set([
  "amd",
  "black",
  "cl",
  "dimm",
  "dual",
  "ecc",
  "expo",
  "intel",
  "jedec",
  "kit",
  "memory",
  "mhz",
  "mt",
  "mts",
  "pc",
  "ram",
  "rdimm",
  "retail",
  "sdram",
  "udimm",
  "white",
  "xmp",
]);

export function normalizeRamMatchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, " ")
    .replace(/(\d+)\s*(gb|mhz|mt\/s|mts)\b/g, "$1$2")
    .replace(/pc5\s*[- ]\s*(\d+)/g, "pc5$1")
    .replace(/so\s*[- ]\s*dimm/g, "sodimm")
    .replace(/[^a-z0-9+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseKit(normalized: string): { moduleCount: number; moduleCapacityGb: number } | null {
  const match = normalized.match(/\b(\d+)\s*x\s*(\d+)gb\b/);
  if (!match) return null;
  const moduleCount = Number.parseInt(match[1], 10);
  const moduleCapacityGb = Number.parseInt(match[2], 10);
  return Number.isFinite(moduleCount) && Number.isFinite(moduleCapacityGb)
    ? { moduleCount, moduleCapacityGb }
    : null;
}

function parseDdrGeneration(normalized: string): string | null {
  const match = normalized.match(/\bddr\s*([345])\b/) ?? normalized.match(/\bddr([345])\b/);
  return match ? `ddr${match[1]}` : null;
}

function parseSpeed(normalized: string): number | null {
  const direct = normalized.match(/\b(?:ddr[345]\s*)?([3456789]\d{3})(?:mhz|mts|mt)?\b/);
  if (direct) {
    const parsed = Number.parseInt(direct[1], 10);
    if (Number.isFinite(parsed)) return parsed;
  }

  const pc5 = normalized.match(/\bpc5(\d{5})\b/);
  if (pc5) {
    const parsed = Number.parseInt(pc5[1], 10);
    if (Number.isFinite(parsed)) return Math.round(parsed / 8);
  }

  return null;
}

function parseCasLatency(normalized: string): number | null {
  const match = normalized.match(/\bcl\s*(\d{2})\b/) ?? normalized.match(/\b(\d{2})\s*cl\b/);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseFormFactor(normalized: string): RamSpec["formFactor"] {
  if (normalized.includes("sodimm") || normalized.includes("laptop") || normalized.includes("notebook")) return "sodimm";
  if (normalized.includes("rdimm") || normalized.includes("registered")) return "rdimm";
  if (normalized.includes("udimm")) return "udimm";
  if (normalized.includes("dimm")) return "dimm";
  return null;
}

function parseRgb(normalized: string): boolean | null {
  return normalized.includes("rgb") ? true : null;
}

function lineTokens(normalized: string): string[] {
  const tokens = normalized
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .filter((token) => !RAM_NON_LINE_TOKENS.has(token))
    .filter((token) => !/^\d+x\d+gb$/.test(token))
    .filter((token) => !/^\d+gb$/.test(token))
    .filter((token) => !/^ddr[345]$/.test(token))
    .filter((token) => !/^cl\d+$/.test(token))
    .filter((token) => !/^[3456789]\d{3}$/.test(token))
    .filter((token) => !/^pc5\d+$/.test(token));

  return [...new Set(tokens)];
}

export function parseRamSpec(value: string): RamSpec {
  const normalized = normalizeRamMatchText(value);
  const kit = parseKit(normalized);
  const capacities = [...normalized.matchAll(/\b(\d+)gb\b/g)]
    .map((match) => Number.parseInt(match[1], 10))
    .filter((value) => Number.isFinite(value));
  const totalCapacityGb = kit
    ? kit.moduleCount * kit.moduleCapacityGb
    : capacities.length > 0
      ? Math.max(...capacities)
      : null;

  return {
    totalCapacityGb,
    moduleCount: kit?.moduleCount ?? null,
    moduleCapacityGb: kit?.moduleCapacityGb ?? null,
    ddrGeneration: parseDdrGeneration(normalized),
    speedMtS: parseSpeed(normalized),
    casLatency: parseCasLatency(normalized),
    formFactor: parseFormFactor(normalized),
    rgb: parseRgb(normalized),
    lineTokens: lineTokens(normalized),
    tokens: new Set(normalized.split(" ").filter(Boolean)),
  };
}

export function looksLikeRamCatalogName(value: string): boolean {
  const spec = parseRamSpec(value);
  return Boolean(spec.ddrGeneration && spec.totalCapacityGb && spec.speedMtS);
}

function missingLineTokens(catalog: RamSpec, candidate: RamSpec): string[] {
  return catalog.lineTokens.filter((token) => !candidate.tokens.has(token));
}

export function validateRamRetailerCandidate(catalogName: string, candidateContext: string): RamCandidateValidation {
  const catalog = parseRamSpec(catalogName);
  const candidate = parseRamSpec(candidateContext);
  const reasons: string[] = [];

  const missingTokens = missingLineTokens(catalog, candidate);
  if (missingTokens.length > 0) reasons.push(`ram_line_token_missing:${missingTokens.join("|")}`);

  if (!candidate.ddrGeneration) reasons.push("ram_ddr_generation_missing");
  else if (catalog.ddrGeneration && candidate.ddrGeneration !== catalog.ddrGeneration) reasons.push("ram_ddr_generation_mismatch");

  if (!candidate.totalCapacityGb) reasons.push("ram_capacity_missing");
  else if (catalog.totalCapacityGb && candidate.totalCapacityGb !== catalog.totalCapacityGb) reasons.push("ram_capacity_mismatch");

  if (candidate.moduleCount !== null || candidate.moduleCapacityGb !== null) {
    if (catalog.moduleCount !== null && candidate.moduleCount !== catalog.moduleCount) reasons.push("ram_module_count_mismatch");
    if (catalog.moduleCapacityGb !== null && candidate.moduleCapacityGb !== catalog.moduleCapacityGb) reasons.push("ram_module_capacity_mismatch");
  }

  if (!candidate.speedMtS) reasons.push("ram_speed_missing");
  else if (catalog.speedMtS && Math.abs(candidate.speedMtS - catalog.speedMtS) > 100) reasons.push("ram_speed_mismatch");

  if (!candidate.casLatency) reasons.push("ram_cas_missing");
  else if (catalog.casLatency && Math.abs(candidate.casLatency - catalog.casLatency) > 2) reasons.push("ram_cas_mismatch");

  if (candidate.formFactor === "sodimm") reasons.push("ram_sodimm_mismatch");
  if (catalog.formFactor === "rdimm" && candidate.formFactor && candidate.formFactor !== "rdimm") reasons.push("ram_rdimm_missing");
  if (catalog.formFactor !== "rdimm" && candidate.formFactor === "rdimm") reasons.push("ram_rdimm_mismatch");

  if (catalog.rgb === true && candidate.rgb !== true) reasons.push("ram_rgb_missing");
  if (catalog.rgb !== true && candidate.rgb === true) reasons.push("ram_rgb_mismatch");

  return {
    ok: reasons.length === 0,
    reasons,
    catalog,
    candidate,
  };
}

export function ramReferencePriceBounds(referencePriceEur: number): { min: number; max: number } {
  return {
    min: referencePriceEur * RAM_PRICE_MIN_RATIO,
    max: referencePriceEur * RAM_PRICE_MAX_RATIO,
  };
}

export function ramPriceWithinReferenceBounds(priceEur: number, referencePriceEur: number): boolean {
  if (!Number.isFinite(priceEur) || !Number.isFinite(referencePriceEur) || referencePriceEur <= 0) return false;
  const bounds = ramReferencePriceBounds(referencePriceEur);
  return priceEur >= bounds.min && priceEur <= bounds.max;
}

export function ramPriceMateriallyDeviates(priceEur: number, referencePriceEur: number): boolean {
  if (!Number.isFinite(priceEur) || !Number.isFinite(referencePriceEur) || referencePriceEur <= 0) return true;
  const ratio = priceEur / referencePriceEur;
  return ratio > RAM_DIRECT_CHECKOUT_MATERIAL_DEVIATION_RATIO
    || ratio < 1 / RAM_DIRECT_CHECKOUT_MATERIAL_DEVIATION_RATIO;
}
