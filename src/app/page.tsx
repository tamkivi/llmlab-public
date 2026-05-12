import { getHomeCatalogView } from "@/lib/server/catalog-service";
import { CatalogBrowser, type CatalogGroup } from "@/components/catalog-browser";
import { BuyerTrustSection } from "@/components/buyer-trust-section";
import { HomepageScrollStory } from "@/components/homepage-scroll-story";
import { Masthead } from "@/components/masthead";
import { PageNav } from "@/components/page-nav";
import { ProfileBuildsBrowser } from "@/components/profile-builds-browser";
import { SoftwareReadySection } from "@/components/software-ready-section";

import { estimateAiCapability } from "@/lib/ai-capability";
import { getRequestLanguage } from "@/lib/server/lang";
import { JsonLd, absoluteUrl, pageMetadata } from "@/lib/seo";
import { estimateWorkloadTier, normalizeGpuVendor, workloadGuidance } from "@/lib/workload-guidance";
import Link from "next/link";

export const revalidate = 3600;

export const metadata = pageMetadata({
  title: "AI-ready computers for local LLMs",
  description: "Compare AI-ready PCs, Mac systems, and components for local LLM inference, fine-tuning, and AI development in Estonia.",
  path: "/",
});

export default async function Home() {
  const lang = await getRequestLanguage();
  const copy = {
    headingLead: lang === "et" ? "Tehisaruks valmis arvutid" : "AI-ready computers assembled",
    headingAccent: lang === "et" ? "sinu vajaduste järgi." : "for your needs.",
    preorderDescription:
      lang === "et"
        ? "Vali sobiv arvutikomplekt, jätka Stripe'i maksega ainult siis, kui hinnastus on kontrollitud, või küsi kohandatud pakkumist. Komponentide valik põhineb Eesti pakkumistel ja saadavus kontrollitakse enne kokkupanekut."
        : "Choose a build profile, continue to Stripe payment only when pricing is verified, or request a custom quote. Parts are selected from Estonian listings and availability is checked before assembly.",
  };

  const profileCards = [
    {
      key: "local-llm-inference",
      name: lang === "et" ? "Kohalik LLM" : "Local LLM Inference",
      target: lang === "et" ? "7B-70B kvantiseeritud mudelid" : "7B-70B quantized models",
      workload: lang === "et" ? "Parim 7B/13B igapäevatööks; 30B/70B sõltub VRAM-ist" : "Best for 7B/13B daily use; 30B/70B depends on VRAM",
      priority: lang === "et" ? "Võimalikult palju VRAM-i euro kohta" : "Max VRAM per dollar",
    },
    {
      key: "llm-finetune-starter",
      name: lang === "et" ? "LLM-i peenhäälestus" : "LLM Fine-Tune Starter",
      target: lang === "et" ? "LoRA adapterid ja kohandatud treeningud" : "LoRA and adapter tuning",
      workload: lang === "et" ? "Sobib 7B/13B LoRA tööde alustamiseks" : "Good starting point for 7B/13B LoRA work",
      priority: lang === "et" ? "RAM ja jahutuse stabiilsus" : "RAM + cooling stability",
    },
    {
      key: "hybrid-ai-gaming",
      name: lang === "et" ? "Tehisaru + mängimine" : "Hybrid AI + Gaming",
      target: lang === "et" ? "Päeval arendus, õhtul mängimine" : "Daytime dev, nighttime play",
      workload: lang === "et" ? "Hea 7B/13B jaoks; 30B on riistvarast sõltuv" : "Good for 7B/13B; 30B depends on the GPU",
      priority: lang === "et" ? "Tasakaalus CPU/GPU eelarve" : "Balanced CPU/GPU spend",
    },
    {
      key: "workstation-ai",
      name: lang === "et" ? "Tehisaru tööjaamad ja multi-GPU" : "AI Workstations & Multi-GPU",
      target: lang === "et" ? "Threadripper / Xeon, 48-192GB+ VRAM" : "Threadripper / Xeon, 48-192GB+ VRAM",
      workload: lang === "et" ? "Parem 30B/70B+ töödeks ja meeskonnakasutuseks" : "Better for 30B/70B+ work and team use",
      priority: lang === "et" ? "Suured mudelid, meeskonnad ja maksimaalne läbilaskevõime" : "Large models, teams, and maximum throughput",
    },
  ];

  const { gpus, cpus, ramKits, powerSupplies, cases, motherboards, storageDrives, cpuCoolers, compactAiSystems, macSystems, externalGpuEnclosures, profileBuilds } = await getHomeCatalogView();
  const pricing = (item: {
    priceSource: "market_live" | "seed_fallback";
    checkedAt: string | null;
    sampleCount: number | null;
    marketDataStatus?: "fresh" | "stale" | "none";
    latestCheckedAt?: string | null;
    latestSampleCount?: number | null;
  }) => ({
    priceSource: item.priceSource,
    checkedAt: item.checkedAt,
    sampleCount: item.sampleCount,
    marketDataStatus: item.marketDataStatus,
    latestCheckedAt: item.latestCheckedAt,
    latestSampleCount: item.latestSampleCount,
  });
  const checkoutMode = (item: {
    priceSource: "market_live" | "seed_fallback";
    marketDataStatus?: "fresh" | "stale" | "none";
  }, quoteOnly = false) => (
    quoteOnly || item.priceSource !== "market_live" || item.marketDataStatus === "stale" ? "quote" as const : "direct" as const
  );
  const workloadKeywords = (tier: "7b" | "13b" | "30b" | "70b") => {
    if (tier === "70b") return ["70B", "70B+", "large model", "workstation"];
    if (tier === "30b") return ["30B", "34B", "30B-class", "larger model"];
    if (tier === "13b") return ["13B", "14B", "mid-size model"];
    return ["7B", "8B", "starter model"];
  };
  const comparisonBuilds = profileBuilds.filter((build) => (build.componentTotalEur ?? 0) > 0).slice(0, 6);
  const buildPricingText = (build: typeof profileBuilds[number]) => {
    const live = build.pricingLiveCount ?? 0;
    const fallback = build.pricingFallbackCount ?? 0;
    if (fallback === 0 && live > 0) return lang === "et" ? "Kõik komponendid turuhinnaga" : "All parts market-priced";
    if (live > 0) return lang === "et" ? `${live} turuhinda, ${fallback} viitehinnangut` : `${live} market, ${fallback} reference`;
    return lang === "et" ? "Viitehinnangud" : "Reference estimates";
  };

  const catalogGroups: CatalogGroup[] = [
    {
      key: "gpu",
      label: { en: "GPU Catalog", et: "GPU kataloog" },
      items: gpus.map((g) => {
        const workloadTier = estimateWorkloadTier({ gpuVramGb: g.vramGb, gpuName: g.name, platform: "component" });
        return { id: g.id, name: g.name, category: "GPU", specs: [`${g.brand} | ${g.vramGb}GB VRAM | ${g.architecture} | AI ${g.aiScore}`], preorderPriceEur: g.preorderPriceEur, href: `/catalog/gpu/${g.id}`, pricing: pricing(g), checkoutMode: checkoutMode(g), gpuVendor: normalizeGpuVendor(g.brand), gpuVramGb: g.vramGb, platform: "desktop" as const, workloadTier, searchKeywords: workloadKeywords(workloadTier) };
      }),
    },
    {
      key: "cpu",
      label: { en: "CPU Catalog", et: "CPU kataloog" },
      items: cpus.map((c) => ({ id: c.id, name: c.name, category: "CPU", specs: [`${c.brand} | ${c.cores}C/${c.threads}T | ${c.socket} | AI ${c.aiScore}`], preorderPriceEur: c.preorderPriceEur, href: `/catalog/cpu/${c.id}`, pricing: pricing(c), checkoutMode: checkoutMode(c), platform: "desktop" as const })),
    },
    {
      key: "ram_kit",
      label: { en: "RAM Kits", et: "Mälukomplektid" },
      items: ramKits.map((r) => {
        const workloadTier = estimateWorkloadTier({ systemRamGb: r.capacityGb, platform: "component" });
        return { id: r.id, name: r.name, category: "RAM", specs: [`${r.modules} | ${r.ddrGen} ${r.speedMtS} | ${r.casLatency}`, `Profiles: ${r.profileSupport}`], preorderPriceEur: r.preorderPriceEur, href: `/catalog/ram_kit/${r.id}`, pricing: pricing(r), checkoutMode: checkoutMode(r), systemRamGb: r.capacityGb, platform: "desktop" as const, workloadTier, searchKeywords: workloadKeywords(workloadTier) };
      }),
    },
    {
      key: "motherboard",
      label: { en: "Motherboards", et: "Emaplaadid" },
      items: motherboards.map((m) => {
        const workloadTier = estimateWorkloadTier({ systemRamGb: m.maxMemoryGb, platform: "component" });
        return { id: m.id, name: m.name, category: "Motherboard", specs: [`${m.socket} | ${m.chipset} | ${m.memorySupport}`, `Max memory: ${m.maxMemoryGb}GB | PCIe Gen5: ${m.pcieGen5Support ? "Yes" : "No"}`], preorderPriceEur: m.preorderPriceEur, href: `/catalog/motherboard/${m.id}`, pricing: pricing(m), checkoutMode: checkoutMode(m), systemRamGb: m.maxMemoryGb, platform: "desktop" as const, workloadTier, searchKeywords: workloadKeywords(workloadTier) };
      }),
    },
    {
      key: "power_supply",
      label: { en: "Power Supplies", et: "Toiteplokid" },
      items: powerSupplies.map((p) => ({ id: p.id, name: p.name, category: "PSU", specs: [`${p.wattage}W | ${p.efficiencyRating} | ${p.atxStandard}`, `${p.modularity} | 12V-2x6/PCIe5: ${p.pcie5Support ? "Supported" : "No"}`], preorderPriceEur: p.preorderPriceEur, href: `/catalog/power_supply/${p.id}`, pricing: pricing(p), checkoutMode: checkoutMode(p), platform: "desktop" as const })),
    },
    {
      key: "case",
      label: { en: "Cases", et: "Kastid" },
      items: cases.map((c) => ({ id: c.id, name: c.name, category: "Case", specs: [`${c.formFactor} | Max GPU: ${c.maxGpuMm}mm`, `Radiator: ${c.radiatorSupport} | Fans: ${c.includedFans}`], preorderPriceEur: c.preorderPriceEur, href: `/catalog/case/${c.id}`, pricing: pricing(c), checkoutMode: checkoutMode(c), platform: "desktop" as const })),
    },
    {
      key: "storage_drive",
      label: { en: "Storage Drives", et: "Salvestusseadmed" },
      items: storageDrives.map((d) => ({ id: d.id, name: d.name, category: "Storage", specs: [`${d.driveType} | ${d.interface} | ${d.capacityGb}GB`, `Read: ${d.seqReadMbS} MB/s | TBW: ${d.enduranceTbw === 0 ? "n/a" : d.enduranceTbw}`], preorderPriceEur: d.preorderPriceEur, href: `/catalog/storage_drive/${d.id}`, pricing: pricing(d), checkoutMode: checkoutMode(d), platform: "desktop" as const })),
    },
    {
      key: "cpu_cooler",
      label: { en: "CPU Coolers", et: "CPU jahutid" },
      items: cpuCoolers.map((c) => ({ id: c.id, name: c.name, category: "Cooler", specs: [`${c.coolerType} | Size: ${c.radiatorOrHeightMm}mm | Max TDP: ${c.maxTdpW}W`, `Sockets: ${c.socketSupport} | Noise: ${c.noiseDb}`], preorderPriceEur: c.preorderPriceEur, href: `/catalog/cpu_cooler/${c.id}`, pricing: pricing(c), checkoutMode: checkoutMode(c), platform: "desktop" as const })),
    },
    {
      key: "compact_ai_system",
      label: { en: "Compact AI Systems", et: "Kompaktsed tehisaru süsteemid" },
      items: compactAiSystems.map((s) => {
        const platform = normalizeGpuVendor(`${s.vendor} ${s.chip}`) === "apple" ? "mac" as const : "desktop" as const;
        const workloadTier = estimateWorkloadTier({ systemRamGb: s.memoryGb, unifiedMemoryGb: platform === "mac" ? s.memoryGb : undefined, gpuName: s.gpuClass, platform });
        return { id: s.id, name: s.name, category: "Compact AI", specs: [`${s.chip} | ${s.memoryGb}GB | ${s.storageGb}GB`, `${s.gpuClass} | ${s.bestFor}`], preorderPriceEur: s.preorderPriceEur, href: `/catalog/compact_ai_system/${s.id}`, pricing: pricing(s), checkoutMode: checkoutMode(s), gpuVendor: normalizeGpuVendor(`${s.vendor} ${s.gpuClass} ${s.chip}`), systemRamGb: s.memoryGb, platform, workloadTier, searchKeywords: workloadKeywords(workloadTier) };
      }),
    },
    {
      key: "mac_system",
      label: { en: "Quote-only Mac Systems", et: "Pakkumispõhised Maci süsteemid" },
      items: macSystems.map((m) => {
        const workloadTier = estimateWorkloadTier({ unifiedMemoryGb: m.unifiedMemoryGb, gpuName: m.chip, platform: "mac" });
        return { id: m.id, name: m.name, category: "Mac", specs: [`${m.chip} | ${m.unifiedMemoryGb}GB unified | ${m.storageGb}GB SSD`, `${m.gpuCores} GPU cores | macOS ${m.macosMinVersion}+`], preorderPriceEur: m.preorderPriceEur, href: `/catalog/mac_system/${m.id}`, pricing: pricing(m), quoteOnly: true, checkoutMode: "quote" as const, gpuVendor: "apple" as const, systemRamGb: m.unifiedMemoryGb, platform: "mac" as const, workloadTier, searchKeywords: workloadKeywords(workloadTier) };
      }),
    },
    {
      key: "external_gpu_enclosure",
      label: { en: "eGPU Enclosures", et: "eGPU karbid" },
      items: externalGpuEnclosures.map((e) => ({ id: e.id, name: e.name, category: "eGPU", specs: [`${e.connectionType} | ${e.pcieGeneration} x${e.pcieLanes}`, `Max GPU: ${e.maxGpuLengthMm}mm | PSU: ${e.includedPsuWatts > 0 ? `${e.includedPsuWatts}W` : "External"}`], preorderPriceEur: e.preorderPriceEur, href: `/catalog/external_gpu_enclosure/${e.id}`, pricing: pricing(e), quoteOnly: true, checkoutMode: "quote" as const, platform: "mac-egpu" as const, searchKeywords: ["external GPU", "eGPU", "Mac eGPU", "quote-only"] })),
    },
  ];

  return (
    <main className="min-h-screen px-6 pb-20 pt-6 md:px-12 md:pb-24 md:pt-8">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "AI-ready computer catalog",
          description: "Buyer guidance for AI-ready PCs, Mac systems, and components for local LLM workloads.",
          url: absoluteUrl("/"),
        }}
      />
      <section className="mx-auto max-w-6xl">
        <HomepageScrollStory>
          <div className="homepage-scroll-pin">
            <div className="hero-scroll-panel home-hero-panel">
              <div className="home-hero-brand">
                <Masthead lang={lang} />
                <PageNav links={[{ href: "/about", label: lang === "et" ? "Meist" : "About" }, { href: "/faq", label: "FAQ" }]} lang={lang} />
              </div>
              <header className="home-hero-copy stagger-in" style={{ animationDelay: "80ms" }}>
                <h1 className="font-display mx-auto mt-8 max-w-4xl text-center text-4xl font-semibold leading-[1.12] tracking-tight md:text-6xl">
                  {copy.headingLead}{" "}
                  <span className="text-[color:var(--accent)]">{copy.headingAccent}</span>
                </h1>
                <p className="mx-auto mt-8 max-w-2xl text-center text-lg leading-8 text-[color:var(--muted)]">{copy.preorderDescription}</p>
                <div className="home-hero-actions">
                  <div className="home-hero-action-dock">
                    <Link
                      href="#build-profiles"
                      className="btn-primary hero-glow inline-flex items-center gap-2 text-sm md:text-base"
                    >
                      {lang === "et" ? "Leia mulle sobivaim komplekt →" : "Find the best build for me →"}
                    </Link>
                    <div className="home-hero-secondary-actions">
                      <Link
                        href="/about"
                        className="btn-secondary inline-flex items-center gap-2 text-sm"
                      >
                        {lang === "et" ? "Miks valida LLMLab.ee? →" : "Why choose LLMLab.ee? →"}
                      </Link>
                      <Link
                        href="#component-catalog"
                        className="btn-secondary inline-flex items-center gap-2 text-sm"
                      >
                        {lang === "et" ? "Sirvi komponente" : "Browse components"}
                      </Link>
                    </div>
                  </div>
                </div>
              </header>
            </div>

            <div className="software-scroll-panel">
              <SoftwareReadySection lang={lang} />
            </div>

            <span id="build-profiles" className="build-profiles-anchor" aria-hidden="true" />
            <div className="builds-scroll-panel">
              <ProfileBuildsBrowser profiles={profileCards} lang={lang} />
            </div>
          </div>
        </HomepageScrollStory>

        <section className="mt-28 storefront-section p-6 md:p-8">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="label-pill inline-block">{lang === "et" ? "Võrdle tööjaamu" : "Compare workstations"}</p>
              <h2 className="font-display mt-4 text-3xl font-semibold md:text-4xl">
                {lang === "et" ? "Kiire ülevaade enne valimist" : "A practical shortlist before you choose"}
              </h2>
              <p className="mt-3 max-w-2xl text-xs leading-5 text-[color:var(--muted)]">
                {lang === "et"
                  ? "AI sobivus on ligikaudne hinnang; mudel, runtime ja kvantimine mõjutavad tulemust."
                  : "AI fit is a rough estimate; model/runtime/quantization affects results."}
              </p>
            </div>
            <Link href="#build-profiles" className="label-pill">
              {lang === "et" ? "Vaata kategooriaid" : "View categories"}
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-[color:var(--panel-border)] text-left text-xs uppercase tracking-wide text-[color:var(--muted)]">
                  <th className="py-3 pr-4">{lang === "et" ? "Komplekt" : "Build"}</th>
                  <th className="py-3 pr-4">GPU</th>
                  <th className="py-3 pr-4">VRAM</th>
                  <th className="py-3 pr-4">RAM</th>
                  <th className="py-3 pr-4">{lang === "et" ? "Sobivus" : "AI fit"}</th>
                  <th className="py-3 pr-4">{lang === "et" ? "Hind" : "Price"}</th>
                  <th className="py-3 pr-4">{lang === "et" ? "Hinnaandmed" : "Price data"}</th>
                  <th className="py-3 text-right">{lang === "et" ? "Tegevus" : "Action"}</th>
                </tr>
              </thead>
              <tbody>
                {comparisonBuilds.map((build) => {
                  const capability = estimateAiCapability({
                    gpuVramGb: build.gpuVramGb,
                    systemRamGb: build.ramGb,
                    gpuName: build.gpuName,
                    gpuArchitecture: build.gpuArchitecture,
                  }, lang);
                  const workloadFit = workloadGuidance({
                    gpuVramGb: build.gpuVramGb,
                    systemRamGb: build.ramGb,
                    gpuName: build.gpuName,
                    platform: "desktop",
                  }, lang);
                  return (
                    <tr key={build.id} className="border-b border-[color:var(--panel-border)] align-top">
                      <td className="py-3 pr-4 font-semibold">{build.buildName}</td>
                      <td className="py-3 pr-4 text-xs text-[color:var(--muted)]">{build.gpuName}</td>
                      <td className="py-3 pr-4 font-mono text-xs">{build.gpuVramGb}GB</td>
                      <td className="py-3 pr-4 font-mono text-xs">{build.ramGb}GB</td>
                      <td className="py-3 pr-4 text-xs text-[color:var(--muted)]">
                        <span className="block font-semibold text-[color:var(--foreground)]">{workloadFit.label}</span>
                        <span className="mt-1 block">{capability.headline}</span>
                      </td>
                      <td className="py-3 pr-4 font-mono">€{build.componentTotalEur?.toLocaleString()}</td>
                      <td className="py-3 pr-4 text-xs text-[color:var(--muted)]">{buildPricingText(build)}</td>
                      <td className="py-3 text-right">
                        <Link href={`/builds/${build.id}`} className="btn-secondary inline-flex px-3 py-2 text-xs">
                          {lang === "et" ? "Vaata" : "View"}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <div className="mt-10">
          <BuyerTrustSection lang={lang} />
        </div>

        <div id="component-catalog" className="mt-40 scroll-mt-12 md:mt-48">
          <div className="mb-12">
            <p className="label-pill inline-block mb-5">
              {lang === "et" ? "Eraldi komponendid" : "Individual components"}
            </p>
            <h2 className="font-display text-4xl font-semibold tracking-tight md:text-5xl">
              {lang === "et" ? "PC komponentide kataloog" : "PC component catalog"}
            </h2>
            <p className="mt-5 max-w-2xl leading-7 text-[color:var(--muted)]">
              {lang === "et"
                ? "Sirvi saadaval olevaid GPU-sid, CPU-sid, mälukomplekte ja muid komponente Eesti turu hindadega."
                : "Browse available GPUs, CPUs, memory, and other components at Estonian market prices."}
            </p>
            <p className="mt-5 max-w-3xl text-xs leading-6 text-[color:var(--muted)]">
              {lang === "et"
                ? "Hinnad on hinnangulised ja põhinevad Eesti turu pakkumistel. Lõplik hind võib sõltuda komponentide saadavusest, konfiguratsioonist ja kokkupaneku valikutest."
                : "Prices are estimated from current Estonian listings and may change based on part availability, configuration, and assembly options."}
            </p>
          </div>

          <CatalogBrowser groups={catalogGroups} lang={lang} />
        </div>
      </section>
    </main>
  );
}
