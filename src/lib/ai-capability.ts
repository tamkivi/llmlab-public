import type { SiteLanguage } from "@/lib/lang";

export type AiCapabilityInput = {
  gpuVramGb: number;
  systemRamGb: number;
  gpuName?: string;
  gpuArchitecture?: string;
};

export type AiCapabilityEstimate = {
  level: "starter" | "mainstream" | "advanced" | "workstation";
  headline: string;
  tiers: string[];
  caution: string;
};

function hasCudaHint(input: AiCapabilityInput): boolean {
  const text = `${input.gpuName ?? ""} ${input.gpuArchitecture ?? ""}`.toLowerCase();
  return text.includes("nvidia") || text.includes("rtx") || text.includes("cuda") || text.includes("ada") || text.includes("blackwell") || text.includes("hopper");
}

export function estimateAiCapability(input: AiCapabilityInput, lang: SiteLanguage = "en"): AiCapabilityEstimate {
  const vram = Math.max(0, input.gpuVramGb);
  const ram = Math.max(0, input.systemRamGb);
  const cuda = hasCudaHint(input);
  const isEt = lang === "et";

  const tiers: string[] = [];
  if (vram >= 8 && ram >= 16) tiers.push(isEt ? "kohalikud kodeerimisabilised ja 7B/8B mudelid" : "local coding assistants and 7B/8B models");
  if (vram >= 12 && ram >= 32) tiers.push(isEt ? "13B/14B kvantiseeritud mudelid" : "13B/14B quantized models");
  if (vram >= 24 && ram >= 64) tiers.push(isEt ? "30B/34B kvantiseeritud mudelid" : "30B/34B quantized models");
  if (vram >= 48 && ram >= 128) tiers.push(isEt ? "70B-klassi kvantiseeritud mudelid" : "70B-class quantized models");
  if (cuda && vram >= 12) tiers.push(isEt ? "CUDA-põhised pildi- ja arendustöövood" : "CUDA image generation and developer workloads");

  if (tiers.length === 0) {
    tiers.push(isEt ? "väiksemad kohalikud mudelid ja CPU-põhised töövood" : "smaller local models and CPU-backed workflows");
  }

  const level: AiCapabilityEstimate["level"] =
    vram >= 48 && ram >= 128 ? "workstation"
      : vram >= 24 && ram >= 64 ? "advanced"
      : vram >= 12 && ram >= 32 ? "mainstream"
      : "starter";

  const headlineByLevel: Record<AiCapabilityEstimate["level"], string> = isEt ? {
    starter: "Sobib väiksemateks kohalikeks tehisaru töödeks",
    mainstream: "Hea igapäevaseks kohalikuks LLM kasutuseks",
    advanced: "Tugev valik suuremate kvantiseeritud mudelite jaoks",
    workstation: "Tööjaama klass suuremate mudelite ja mitme töövoo jaoks",
  } : {
    starter: "Suitable for smaller local AI tasks",
    mainstream: "Good for everyday local LLM use",
    advanced: "Strong for larger quantized models",
    workstation: "Workstation tier for larger models and multiple workflows",
  };

  return {
    level,
    headline: headlineByLevel[level],
    tiers,
    caution: isEt
      ? "Tegelik sobivus sõltub kvantiseerimisest, mudelist ja käituskeskkonnast."
      : "Actual fit depends on quantization, model choice, and runtime.",
  };
}
