import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AiCapabilitySummary } from "@/components/ai-capability-summary";
import { Masthead } from "@/components/masthead";
import { PageNav } from "@/components/page-nav";
import { PriceTransparencyBadges } from "@/components/price-transparency-badges";
import { getProfileView } from "@/lib/server/catalog-service";
import { getRequestLanguage } from "@/lib/server/lang";
import { JsonLd, absoluteUrl, pageMetadata } from "@/lib/seo";
import { normalizeGpuVendor, workloadGuidance, type WorkloadGuidance } from "@/lib/workload-guidance";

type ProfileMeta = {
  name: { en: string; et: string };
  label: { en: string; et: string };
  description: { en: string; et: string };
  benefits: { en: string[]; et: string[] };
  drawbacks: { en: string[]; et: string[] };
};

const profileMeta: Record<string, ProfileMeta> = {
  "local-llm-inference": {
    name: { en: "Local LLM Inference", et: "Kohalik LLM" },
    label: { en: "Cost-Efficient Local LLMs", et: "Kulutõhusad kohalikud LLM-id" },
    description: {
      en: "Builds optimised for daily 7B/13B local models, with higher tiers for larger quantized workloads when memory allows.",
      et: "Komplektid igapäevasteks 7B/13B kohalikeks mudeliteks, suurema mäluga klassid suuremate kvantiseeritud tööde jaoks.",
    },
    benefits: {
      en: ["Daily local chat, coding, and document workflows", "Best VRAM per euro for most users", "Good first step into local LLMs"],
      et: ["Igapäevane kohalik vestlus, kodeerimine ja dokumenditöö", "Enamiku kasutajate jaoks parim VRAM euro kohta", "Hea esimene samm kohalike LLM-ide juurde"],
    },
    drawbacks: {
      en: ["Not the best choice for serious fine-tuning", "Very large 70B+ workloads may need workstation hardware", "Gaming is not the primary optimization target"],
      et: ["Ei ole parim valik tõsiseks peenhäälestuseks", "Väga suured 70B+ töökoormused võivad vajada tööjaama riistvara", "Mängimine ei ole peamine optimeerimise eesmärk"],
    },
  },
  "llm-finetune-starter": {
    name: { en: "LLM Fine-Tune Starter", et: "LLM-i peenhäälestus" },
    label: { en: "Tuning Stability", et: "Treenimise stabiilsus" },
    description: {
      en: "Platforms with enough system RAM and stable cooling for LoRA adapters and custom training runs.",
      et: "Platvormid piisava süsteemi RAM-i ja stabiilse jahutusega LoRA adapterite ning kohandatud treeningute jaoks.",
    },
    benefits: {
      en: ["LoRA and QLoRA adapter training", "Longer sustained workloads with stable cooling", "More system RAM for datasets and tooling"],
      et: ["LoRA ja QLoRA adapterite treenimine", "Pikemad töökoormused stabiilse jahutusega", "Rohkem süsteemi RAM-i andmestike ja tööriistade jaoks"],
    },
    drawbacks: {
      en: ["Overbuilt if you only want local chat", "Full model training still needs much larger hardware", "Costs more than inference-first systems"],
      et: ["Liigne, kui vajad ainult kohalikku vestlust", "Täismudelite treenimine vajab siiski palju suuremat riistvara", "Kallim kui ainult mudelite käitamisele suunatud süsteemid"],
    },
  },
  "hybrid-ai-gaming": {
    name: { en: "Hybrid AI + Gaming", et: "Tehisaru + mängimine" },
    label: { en: "Multitasking", et: "Multitegumtöötlus" },
    description: {
      en: "Balanced builds for AI development during the day and high-refresh gaming at night.",
      et: "Tasakaalustatud komplektid tehisaru arenduseks päeval ja sujuvaks mängimiseks õhtul.",
    },
    benefits: {
      en: ["One machine for gaming and local AI", "Strong GPU performance outside AI workloads", "Good fit for creators and students"],
      et: ["Üks masin mängimiseks ja kohalikuks tehisaruks", "Tugev GPU jõudlus ka väljaspool tehisaru töökoormusi", "Sobib loojatele ja õppijatele"],
    },
    drawbacks: {
      en: ["Less VRAM than pure AI-first builds at the same price", "Higher peak power and heat", "Not ideal for multi-user or lab workloads"],
      et: ["Sama hinna juures vähem VRAM-i kui ainult tehisarule suunatud komplektidel", "Suurem tippvõimsus ja soojus", "Ei sobi hästi mitme kasutaja või labori töökoormusteks"],
    },
  },
  "workstation-ai": {
    name: { en: "AI Workstations & Multi-GPU Systems", et: "Tehisaru tööjaamad ja multi-GPU süsteemid" },
    label: { en: "Heavy AI & Multi-GPU", et: "Rasked töökoormused ja multi-GPU" },
    description: {
      en: "Single- and multi-GPU workstation platforms for larger models, multi-session serving, research, and team deployments.",
      et: "Ühe või mitme GPU-ga tööjaamad suuremate mudelite, mitme samaaegse seansi, uurimistöö ja meeskonna kasutuse jaoks.",
    },
    benefits: {
      en: ["70B+ models, research, and team use", "Single- or multi-GPU configurations", "ECC RAM, high VRAM, and workstation cooling"],
      et: ["70B+ mudelid, uurimistöö ja meeskonna kasutus", "Ühe või mitme GPU-ga konfiguratsioonid", "ECC RAM, suur VRAM ja tööjaama jahutus"],
    },
    drawbacks: {
      en: ["Much higher cost and power draw", "Physically larger and louder under load", "Unnecessary for basic local chat or small models"],
      et: ["Oluliselt kõrgem hind ja voolutarve", "Füüsiliselt suurem ning koormuse all valjem", "Liigne lihtsa kohaliku vestluse või väikeste mudelite jaoks"],
    },
  },
  "macos-systems": {
    name: { en: "macOS-based systems", et: "macOS-il põhinevad süsteemid" },
    label: { en: "Compact & Quiet", et: "Kompaktne ja vaikne" },
    description: {
      en: "Apple Silicon Mac minis pre-configured with Ollama, LM Studio, and local AI tooling. No GPU required.",
      et: "Apple Siliconiga Mac minid, kus Ollama, LM Studio ja kohalikud tehisaru tööriistad on eelseadistatud. Eraldi GPU-d pole vaja.",
    },
    benefits: {
      en: ["Quiet, compact, and simple to start", "Excellent macOS desktop experience", "Unified memory works well for many local models"],
      et: ["Vaikne, kompaktne ja lihtne alustada", "Väga hea macOS-i töölauakogemus", "Ühtne mälu töötab paljude kohalike mudelitega hästi"],
    },
    drawbacks: {
      en: ["No CUDA and no native NVIDIA workflow", "GPU cannot be upgraded later", "Large models are limited by unified memory size"],
      et: ["CUDA puudub ja NVIDIA töövoog ei ole loomulik valik", "GPU-d ei saa hiljem uuendada", "Suuri mudeleid piirab ühtse mälu maht"],
    },
  },
  "mac-egpu-ai": {
    name: { en: "Mac + External GPU AI", et: "Mac + väline GPU tehisaruks" },
    label: { en: "Experimental / Advanced", et: "Eksperimentaalne / Edasijõudnud" },
    description: {
      en: "Apple Silicon Macs paired with external NVIDIA/AMD GPUs for AI compute workflows. For AI compute only — not gaming or macOS graphics acceleration.",
      et: "Apple Siliconiga Macid koos väliste NVIDIA/AMD GPU-dega tehisaru arvutustööde jaoks. Ainult tehisaru arvutusteks — mitte mängimiseks ega macOS-i graafika kiirendamiseks.",
    },
    benefits: {
      en: ["Experimental CUDA/VRAM path for Mac users", "Useful for tinygrad/TinyGPU-style research", "Keeps macOS as the main desktop environment"],
      et: ["Eksperimentaalne CUDA/VRAM-i tee Maci kasutajatele", "Kasulik tinygrad/TinyGPU-laadseks uurimistööks", "macOS jääb põhiliseks töölauakeskkonnaks"],
    },
    drawbacks: {
      en: ["Does not accelerate macOS graphics, displays, games, or creative apps", "Depends on experimental third-party driver paths", "Not suitable for production use"],
      et: ["Ei kiirenda macOS-i graafikat, kuvareid, mänge ega loomerakendusi", "Sõltub eksperimentaalsetest kolmanda osapoole draiveritest", "Ei sobi tootmiskasutuseks"],
    },
  },
};

type ProfilePageParams = {
  params: Promise<{ key: string }>;
  searchParams?: Promise<{ sort?: string | string[] }>;
};

export const revalidate = 900;
export const dynamicParams = true;

export function generateStaticParams() {
  return Object.keys(profileMeta).map((key) => ({ key }));
}

type BuildSortOption = "recommended" | "price-desc" | "price-asc";

export async function generateMetadata({ params }: ProfilePageParams): Promise<Metadata> {
  const { key } = await params;
  const effectiveKey = key === "multi-gpu-ai" ? "workstation-ai" : key;
  const meta = profileMeta[effectiveKey];

  if (!meta) {
    return pageMetadata({
      title: "Profile not found",
      description: "The requested AI hardware profile could not be found.",
      path: "/",
      noIndex: true,
    });
  }

  return pageMetadata({
    title: meta.name.en,
    description: meta.description.en,
    path: `/profiles/${effectiveKey}`,
  });
}

function FitSummary({
  benefits,
  drawbacks,
  lang,
}: {
  benefits: { en: string[]; et: string[] };
  drawbacks: { en: string[]; et: string[] };
  lang: string;
}) {
  const isEt = lang === "et";

  return (
    <div className="mb-8 grid gap-6 md:grid-cols-2">
      <section className="product-card border-green-500/35 bg-green-500/5 p-6">
        <h2 className="font-display text-xl font-semibold text-green-400">
          {isEt ? "Sobib hästi" : "Best for"}
        </h2>
        <ul className="arrow-list mt-3 space-y-1 text-sm text-[color:var(--muted)]">
          {benefits[isEt ? "et" : "en"].map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="product-card border-red-500/35 bg-red-500/5 p-6">
        <h2 className="font-display text-xl font-semibold text-red-400">
          {isEt ? "Ei ole parim valik" : "Not ideal for"}
        </h2>
        <ul className="arrow-list mt-3 space-y-1 text-sm text-[color:var(--muted)]">
          {drawbacks[isEt ? "et" : "en"].map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function WorkloadFitNote({ fit }: { fit: WorkloadGuidance }) {
  return (
    <div className="mt-4 rounded-lg border border-[color:var(--panel-border)] bg-[color:var(--background)]/30 px-3 py-2">
      <p className="text-xs font-semibold leading-5 text-[color:var(--foreground)]">{fit.label}</p>
      <p className="mt-1 text-xs leading-5 text-[color:var(--muted)]">{fit.detail}</p>
    </div>
  );
}

function parseBuildSort(value: string | string[] | undefined): BuildSortOption {
  const sort = Array.isArray(value) ? value[0] : value;
  return sort === "price-desc" || sort === "price-asc" ? sort : "recommended";
}

function buildSortHref(key: string, sort: BuildSortOption) {
  return sort === "recommended" ? `/profiles/${key}` : `/profiles/${key}?sort=${sort}`;
}

function sortByPrice<T>(items: T[], sort: BuildSortOption, priceFor: (item: T) => number | null | undefined): T[] {
  if (sort === "recommended") return items;

  return [...items].sort((a, b) => {
    const priceA = priceFor(a);
    const priceB = priceFor(b);
    const hasPriceA = typeof priceA === "number" && Number.isFinite(priceA);
    const hasPriceB = typeof priceB === "number" && Number.isFinite(priceB);

    if (!hasPriceA && !hasPriceB) return 0;
    if (!hasPriceA) return 1;
    if (!hasPriceB) return -1;

    return sort === "price-asc" ? priceA - priceB : priceB - priceA;
  });
}

function BuildSortBar({ activeSort, lang, profileKey }: { activeSort: BuildSortOption; lang: string; profileKey: string }) {
  const isEt = lang === "et";
  const options: Array<{ value: BuildSortOption; label: string }> = [
    { value: "recommended", label: isEt ? "Soovitatud" : "Recommended" },
    { value: "price-desc", label: isEt ? "Hind: kõrge-madal" : "Highest to lowest price" },
    { value: "price-asc", label: isEt ? "Hind: madal-kõrge" : "Lowest to highest price" },
  ];

  return (
    <nav className="mb-5 flex flex-wrap items-center gap-2" aria-label={isEt ? "Sorteeri komplekte" : "Sort builds"}>
      <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">
        {isEt ? "Sorteeri" : "Sort"}
      </span>
      {options.map((option) => {
        const isActive = option.value === activeSort;

        return (
          <Link
            key={option.value}
            href={buildSortHref(profileKey, option.value)}
            aria-current={isActive ? "page" : undefined}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
              isActive
                ? "border-[color:var(--accent)] bg-[color:var(--accent)] text-black"
                : "border-[color:var(--panel-border)] text-[color:var(--muted)] hover:border-[color:var(--accent)] hover:text-[color:var(--foreground)]"
            }`}
          >
            {option.label}
          </Link>
        );
      })}
    </nav>
  );
}

export default async function ProfilePage({
  params,
  searchParams,
}: ProfilePageParams) {
  const lang = await getRequestLanguage();
  const { key } = await params;
  const sort = parseBuildSort((await searchParams)?.sort);

  if (key === "multi-gpu-ai") {
    redirect("/profiles/workstation-ai");
  }

  if (!profileMeta[key]) {
    notFound();
  }

  const meta = profileMeta[key];
  const { profileBuilds, compactAiSystems, macSystems, macEgpuBuilds } = await getProfileView();
  const filteredProfileBuilds = profileBuilds.filter((build) => build.profileKey === key || (key === "workstation-ai" && build.profileKey === "multi-gpu-ai"));
  const sortedProfileBuilds = sortByPrice(filteredProfileBuilds, sort, (build) => build.componentTotalEur);
  const sortedMacSystems = sortByPrice(macSystems, sort, (system) => system.preorderPriceEur);
  const sortedCompactAiSystems = sortByPrice(compactAiSystems, sort, (system) => system.preorderPriceEur);
  const sortedMacEgpuBuilds = sortByPrice(macEgpuBuilds, sort, (build) => {
    const macPrice = build.macSystemMarketPriceEur ?? build.macSystemBasePriceEur;
    const enclosurePrice = build.egpuEnclosureMarketPriceEur ?? build.egpuEnclosureBasePriceEur;
    return macPrice + enclosurePrice;
  });

  const t = {
    viewMore: lang === "et" ? "Vaata detaile" : "View details",
    chip: lang === "et" ? "Kiip" : "Chip",
    memory: lang === "et" ? "Mälu" : "Memory",
    storage: lang === "et" ? "Salvestus" : "Storage",
    software: lang === "et" ? "Tarkvara" : "Software",
    preorder: lang === "et" ? "Tellimuse hind" : "Order price",
    inStock: lang === "et" ? "Laos" : "In Stock",
    outOfStock: lang === "et" ? "Otsas" : "Out of Stock",
    gpu: "GPU",
    cpu: "CPU",
    ram: "RAM",
    target: lang === "et" ? "Mudeli siht" : "Target",
    andMore: lang === "et" ? "ja veel" : "and more",
    builtBy: "Configured by LLMLab.ee",
  };

  return (
    <main className="min-h-screen px-6 py-10 md:px-12">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: meta.name.en,
          description: meta.description.en,
          url: absoluteUrl(`/profiles/${key}`),
        }}
      />
      <section className="mx-auto max-w-6xl">
        <Masthead lang={lang} />
        <header className="mb-10">
          <PageNav links={[{ href: "/faq", label: "FAQ" }]} lang={lang} />
          <p className="category-tag mt-6 inline-block">{lang === "et" ? meta.label.et : meta.label.en}</p>
          <h1 className="font-display mt-3 text-4xl font-semibold tracking-tight md:text-6xl">
            {lang === "et" ? meta.name.et : meta.name.en}
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-[color:var(--muted)]">
            {lang === "et" ? meta.description.et : meta.description.en}
          </p>
        </header>

        {key === "macos-systems" ? (
          <div>
            <FitSummary benefits={meta.benefits} drawbacks={meta.drawbacks} lang={lang} />
            <BuildSortBar activeSort={sort} lang={lang} profileKey={key} />
            <section className="mb-8">
              <p className="label-pill mb-4 inline-block">{lang === "et" ? "Pakkumispõhised Maci süsteemid" : "Quote-only Mac systems"}</p>
              <div className="grid gap-6 md:grid-cols-3">
                {sortedMacSystems.map((system) => (
                  <article key={system.id} className="product-card flex flex-col p-6">
                    <p className="font-display text-xl font-semibold">{system.name}</p>
                    <p className="mt-2 text-sm text-[color:var(--muted)]">{system.notes}</p>
                    <div className="mt-4 space-y-1 font-mono text-xs text-[color:var(--muted)]">
                      <p>{t.chip}: {system.chip}</p>
                      <p>{t.memory}: {system.unifiedMemoryGb}GB unified</p>
                      <p>{t.storage}: {system.storageGb}GB SSD</p>
                    </div>
                    <WorkloadFitNote
                      fit={workloadGuidance({
                        unifiedMemoryGb: system.unifiedMemoryGb,
                        gpuName: system.chip,
                        platform: "mac",
                      }, lang)}
                    />
                    <p className="price-lockup mt-5">€{system.preorderPriceEur.toLocaleString()}</p>
                    <p className="mt-1 text-xs uppercase tracking-wide text-[color:var(--muted)]">{lang === "et" ? "Pakkumise alus" : "Quote reference"}</p>
                    <PriceTransparencyBadges pricing={system} lang={lang} compact />
                    <p className="mt-3 text-xs text-[color:var(--muted)]">
                      {lang === "et" ? "Macid jäävad pakkumispõhiseks: enne makset kontrollime konfiguratsiooni, saadavuse ja sobiva tarkvara." : "Mac systems remain quote-only: configuration, availability, and software fit are reviewed before any payment."}
                    </p>
                    <div className="mt-auto flex justify-end pt-5">
                      <Link
                        href={`/catalog/mac_system/${system.id}`}
                        className="btn-secondary inline-flex w-full justify-center text-sm sm:w-auto"
                      >
                        {t.viewMore}
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            </section>
            <div className="grid gap-6 md:grid-cols-3">
              {sortedCompactAiSystems.map((system) => (
                <article key={system.id} className="product-card flex flex-col p-6">
                  <p className="font-display text-xl font-semibold">{system.name}</p>
                  <p className="mt-1 text-sm text-[color:var(--muted)]">{system.vendor}</p>
                  <p className="mt-2 text-sm text-[color:var(--muted)]">{system.bestFor}</p>
                  <div className="mt-4 space-y-1 font-mono text-xs text-[color:var(--muted)]">
                    <p>{t.chip}: {system.chip}</p>
                    <p>{t.memory}: {system.memoryGb}GB unified</p>
                    <p>{t.storage}: {system.storageGb}GB SSD</p>
                    <p>
                      {t.software}:{" "}
                      {(() => {
                        const apps = system.installedSoftware.split(", ");
                        const shown = apps.slice(0, 3).join(", ");
                        return apps.length > 3 ? `${shown} ${t.andMore}` : shown;
                      })()}
                    </p>
                  </div>
                  <WorkloadFitNote
                    fit={workloadGuidance({
                      systemRamGb: system.memoryGb,
                      unifiedMemoryGb: normalizeGpuVendor(`${system.vendor} ${system.chip}`) === "apple" ? system.memoryGb : undefined,
                      gpuName: system.gpuClass,
                      platform: normalizeGpuVendor(`${system.vendor} ${system.chip}`) === "apple" ? "mac" : "desktop",
                    }, lang)}
                  />
                  <div className="mt-5 flex items-start justify-between gap-3">
                    <span>
                      <span className="price-lockup block">€{system.preorderPriceEur}</span>
                      <span className="mt-1 block text-xs uppercase tracking-wide text-[color:var(--muted)]">{t.preorder}</span>
                    </span>
                    <span className="label-pill">{system.inStock ? t.inStock : t.outOfStock}</span>
                  </div>
                  <PriceTransparencyBadges pricing={system} lang={lang} compact />
                  <div className="mt-auto flex justify-end pt-5">
                    <Link
                      href={`/catalog/compact_ai_system/${system.id}`}
                      className="btn-secondary inline-flex w-full justify-center text-sm sm:w-auto"
                    >
                      {t.viewMore}
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : key === "mac-egpu-ai" ? (
          <div>
            <div className="mb-8 rounded-xl border-2 border-red-500/50 bg-red-500/5 p-6">
              <p className="font-display text-lg font-semibold text-red-400">
                {lang === "et" ? "Oluline hoiatus" : "Important warning"}
              </p>
              <p className="mt-2 text-sm text-[color:var(--muted)]">
                {lang === "et"
                  ? "Välised GPU-d Apple Siliconiga Macidel on mõeldud ainult tehisaru arvutustöödeks. Need ei kiirenda macOS-i graafikat, mänge, kuvareid, Final Cuti ega Blenderi vaateakna renderdamist."
                  : "External GPUs on Apple Silicon Macs are for AI compute workflows only. They do not accelerate macOS graphics, gaming, displays, Final Cut, or Blender viewport rendering."}
              </p>
              <p className="mt-2 text-xs text-[color:var(--muted)]">
                {lang === "et"
                  ? "Apple'i ametlik eGPU tugi kehtib ainult Inteli protsessoriga Macidele. Apple Siliconi tugi sõltub TinyGPU/tinygrad-stiilis tehisaru arvutusdraiveritest."
                  : "Apple's official eGPU support is Intel-Mac-only. Apple Silicon support depends on TinyGPU/tinygrad-style AI compute drivers."}
              </p>
            </div>
            <BuildSortBar activeSort={sort} lang={lang} profileKey={key} />
            <div className="grid gap-6 md:grid-cols-2">
              {sortedMacEgpuBuilds.map((build) => (
                <article key={build.id} className="product-card flex flex-col p-6">
                  <div className="flex items-center gap-2 mb-3">
                    <span className={`category-tag ${build.riskLevel === "experimental" ? "!border-red-400/50 !text-red-400" : "!border-yellow-400/50 !text-yellow-400"}`}>
                      {build.riskLevel === "experimental" ? "Experimental" : build.riskLevel === "advanced" ? "Advanced" : "Stable"}
                    </span>
                  </div>
                  <p className="font-display text-xl font-semibold">{build.name}</p>
                  <div className="mt-3 space-y-1 font-mono text-xs text-[color:var(--muted)]">
                    <p>Mac: {build.macSystemName} ({build.macSystemMemoryGb}GB unified)</p>
                    <p>eGPU: {build.egpuEnclosureName}</p>
                    <p>GPU: {build.gpuName} ({build.gpuVramGb}GB VRAM, {build.gpuArchitecture})</p>
                  </div>
                  <WorkloadFitNote
                    fit={workloadGuidance({
                      gpuVramGb: build.gpuVramGb,
                      systemRamGb: build.macSystemMemoryGb,
                      gpuName: build.gpuName,
                      platform: "mac-egpu",
                    }, lang)}
                  />
                  <div className="mt-3">
                    <p className="text-xs font-semibold text-green-400">{lang === "et" ? "Toetatud:" : "Supported:"}</p>
                    <ul className="arrow-list mt-1 space-y-0.5 text-xs text-[color:var(--muted)]">
                      {build.targetWorkloads.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="mt-3">
                    <p className="text-xs font-semibold text-red-400">{lang === "et" ? "Ei toeta:" : "Not supported:"}</p>
                    <ul className="arrow-list mt-1 space-y-0.5 text-xs text-[color:var(--muted)]">
                      {build.unsupportedWorkloads.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  </div>
                  <p className="mt-3 text-xs text-[color:var(--muted)] italic">{build.buyerWarning}</p>
                  <div className="mt-3 space-y-1">
                    <p className="text-xs text-[color:var(--muted)]">
                      Mac: {build.macSystemMarketPriceEur != null ? `€${build.macSystemMarketPriceEur}` : `€${build.macSystemBasePriceEur}`}
                    </p>
                    <p className="text-xs text-[color:var(--muted)]">
                      Enclosure: {build.egpuEnclosureMarketPriceEur != null ? `€${build.egpuEnclosureMarketPriceEur}` : `€${build.egpuEnclosureBasePriceEur}`}
                    </p>
                  </div>
                  <p className="mt-2 text-xs text-[color:var(--muted)]">{build.notes}</p>
                  <div className="mt-auto flex justify-end pt-5">
                    <Link
                      href={`/mac-egpu-builds/${build.id}`}
                      className="btn-secondary inline-flex w-full justify-center text-sm sm:w-auto"
                    >
                      {t.viewMore}
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <FitSummary benefits={meta.benefits} drawbacks={meta.drawbacks} lang={lang} />
            <p className="mb-5 text-xs leading-5 text-[color:var(--muted)]">
              {lang === "et"
                ? "AI sobivus on ligikaudne hinnang; mudel, runtime ja kvantimine mõjutavad tulemust."
                : "AI fit is a rough estimate; model/runtime/quantization affects results."}
            </p>
            <BuildSortBar activeSort={sort} lang={lang} profileKey={key} />
            <div className="grid gap-6 md:grid-cols-3">
              {sortedProfileBuilds.map((build) => (
                  <article key={build.id} className="product-card flex flex-col p-6">
                    {key === "workstation-ai" ? (
                      <p className="category-tag mb-3 inline-block">
                        {build.profileKey === "multi-gpu-ai"
                          ? (lang === "et" ? "Multi-GPU / meeskond" : "Multi-GPU / team system")
                          : (lang === "et" ? "Tööjaam" : "Workstation")}
                      </p>
                    ) : null}
                    <p className="font-display text-xl font-semibold">{build.buildName}</p>
                    {key === "workstation-ai" && (
                      <p className="mt-1 text-sm text-[color:var(--muted)]">{t.builtBy}</p>
                    )}
                    <p className="mt-2 text-sm text-[color:var(--muted)]">{build.notes}</p>
                    <div className="mt-4 space-y-1 font-mono text-xs text-[color:var(--muted)]">
                      <p>{t.gpu}: {build.gpuName}</p>
                      <p>{t.cpu}: {build.cpuName}</p>
                      <p>{t.ram}: {build.ramGb}GB | {t.storage}: {build.storageGb}GB</p>
                      <p>{t.target}: {build.targetModel}</p>
                    </div>
                    <WorkloadFitNote
                      fit={workloadGuidance({
                        gpuVramGb: build.gpuVramGb,
                        systemRamGb: build.ramGb,
                        gpuName: build.gpuName,
                        platform: "desktop",
                      }, lang)}
                    />
                    <AiCapabilitySummary
                      input={{
                        gpuVramGb: build.gpuVramGb,
                        systemRamGb: build.ramGb,
                        gpuName: build.gpuName,
                        gpuArchitecture: build.gpuArchitecture,
                      }}
                      lang={lang}
                      compact
                    />
                    <p className="price-lockup mt-5">
                      {build.componentTotalEur && build.componentTotalEur > 0
                        ? <>€{build.componentTotalEur.toLocaleString()}</>
                        : <>{lang === "et" ? "Hind puudub" : "Price unavailable"}</>}
                    </p>
                    <p className="mt-2 text-xs text-[color:var(--muted)]">
                      {(build.pricingFallbackCount ?? 0) > 0
                        ? (lang === "et"
                          ? `${build.pricingLiveCount ?? 0} komponenti turuhinnaga, ${build.pricingFallbackCount ?? 0} viitehinnanguga`
                          : `${build.pricingLiveCount ?? 0} market-priced parts, ${build.pricingFallbackCount ?? 0} reference estimates`)
                        : (lang === "et" ? "Kõik hinnatud komponendid kasutavad turuandmeid" : "All priced components use market data")}
                    </p>
                    <div className="mt-auto flex justify-end pt-5">
                      <Link
                        href={`/builds/${build.id}`}
                        className="btn-secondary inline-flex w-full justify-center text-sm sm:w-auto"
                      >
                        {t.viewMore}
                      </Link>
                    </div>
                  </article>
                ))}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
