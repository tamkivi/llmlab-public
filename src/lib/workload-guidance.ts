import type { SiteLanguage } from "@/lib/lang";

export type WorkloadTier = "7b" | "13b" | "30b" | "70b";

export type WorkloadGuidanceInput = {
  gpuVramGb?: number | null;
  systemRamGb?: number | null;
  unifiedMemoryGb?: number | null;
  gpuName?: string | null;
  platform?: "desktop" | "mac" | "mac-egpu" | "component";
};

export type WorkloadGuidance = {
  tier: WorkloadTier;
  label: string;
  detail: string;
};

const tierRank: Record<WorkloadTier, number> = {
  "7b": 1,
  "13b": 2,
  "30b": 3,
  "70b": 4,
};

export function workloadTierRank(tier: WorkloadTier): number {
  return tierRank[tier];
}

export function normalizeGpuVendor(value?: string | null): "nvidia" | "amd" | "intel" | "apple" | "other" | undefined {
  const text = (value ?? "").toLowerCase();
  if (!text) return undefined;
  if (text.includes("nvidia") || text.includes("rtx") || text.includes("geforce") || text.includes("quadro")) return "nvidia";
  if (text.includes("amd") || text.includes("radeon") || text.includes("rx ")) return "amd";
  if (text.includes("intel") || text.includes("arc")) return "intel";
  if (text.includes("apple") || text.includes("m1") || text.includes("m2") || text.includes("m3") || text.includes("m4")) return "apple";
  return "other";
}

export function estimateWorkloadTier(input: WorkloadGuidanceInput): WorkloadTier {
  const memory = Math.max(input.systemRamGb ?? 0, input.unifiedMemoryGb ?? 0);
  const vram = Math.max(input.gpuVramGb ?? 0);

  if (input.platform === "mac") {
    if (memory >= 64) return "70b";
    if (memory >= 32) return "30b";
    if (memory >= 24) return "13b";
    return "7b";
  }

  if (vram >= 48 && memory >= 128) return "70b";
  if (vram >= 24 && memory >= 64) return "30b";
  if (vram >= 12 && memory >= 32) return "13b";
  if (vram >= 8 || memory >= 16) return "7b";

  if (vram >= 48) return "70b";
  if (vram >= 24) return "30b";
  if (vram >= 12) return "13b";
  return "7b";
}

export function workloadGuidance(input: WorkloadGuidanceInput, lang: SiteLanguage = "en"): WorkloadGuidance {
  const isEt = lang === "et";
  const tier = estimateWorkloadTier(input);

  const copy: Record<WorkloadTier, WorkloadGuidance> = isEt
    ? {
        "7b": {
          tier: "7b",
          label: "Parim 7B/8B mudeliteks",
          detail: "Sobib alustamiseks, vestluseks ja kodeerimisabilisteks; suuremad mudelid vajavad rohkem mälu.",
        },
        "13b": {
          tier: "13b",
          label: "Sobib 13B-klassi mudeliteks",
          detail: "Hea igapäevaseks kohalikuks LLM kasutuseks; 30B võib vajada tugevamat mälu või kvantimist.",
        },
        "30b": {
          tier: "30b",
          label: "Parem 30B-klassi mudeliteks",
          detail: "Tugevam valik suuremate kvantiseeritud mudelite jaoks; tegelik sobivus sõltub runtime'ist.",
        },
        "70b": {
          tier: "70b",
          label: "70B nõuab tõsist mäluvalikut",
          detail: "70B-klassi mudelid sõltuvad tugevalt VRAM/RAM mahust, kvantimisest ja kontekstipikkusest.",
        },
      }
    : {
        "7b": {
          tier: "7b",
          label: "Best for 7B/8B models",
          detail: "Good starting point for chat and coding assistants; larger models need more memory.",
        },
        "13b": {
          tier: "13b",
          label: "Good for 13B-class models",
          detail: "Strong everyday local LLM tier; 30B may need more memory or heavier quantization.",
        },
        "30b": {
          tier: "30b",
          label: "Better for 30B-class models",
          detail: "Stronger fit for larger quantized models; actual fit depends on runtime and settings.",
        },
        "70b": {
          tier: "70b",
          label: "70B needs serious memory tradeoffs",
          detail: "70B-class models depend heavily on VRAM/RAM, quantization, and context length.",
        },
      };

  return copy[tier];
}
