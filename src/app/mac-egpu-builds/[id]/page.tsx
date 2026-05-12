import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Masthead } from "@/components/masthead";
import { PageNav } from "@/components/page-nav";
import { QuoteRequestForm } from "@/components/quote-request-form";
import { TrustLinksSection } from "@/components/trust-links-section";
import { getMacEgpuBuildDetailView } from "@/lib/server/catalog-service";
import { getRequestLanguage } from "@/lib/server/lang";
import { JsonLd, pageMetadata, productJsonLd } from "@/lib/seo";
import { workloadGuidance } from "@/lib/workload-guidance";

type MacEgpuBuildDetailParams = {
  params: Promise<{ id: string }>;
};

async function resolveMacEgpuBuildFromParams(params: Promise<{ id: string }>) {
  const resolvedParams = await params;
  const buildId = Number.parseInt(resolvedParams.id, 10);

  if (!Number.isFinite(buildId)) {
    return null;
  }

  return getMacEgpuBuildDetailView(buildId);
}

export async function generateMetadata({ params }: MacEgpuBuildDetailParams): Promise<Metadata> {
  const build = await resolveMacEgpuBuildFromParams(params);

  if (!build) {
    return pageMetadata({
      title: "Mac eGPU build not found",
      description: "The requested Mac eGPU AI compute setup could not be found.",
      path: "/profiles/mac-egpu-ai",
      noIndex: true,
    });
  }

  return pageMetadata({
    title: `${build.name} Mac eGPU AI setup`,
    description: `Mac + external GPU AI compute setup with ${build.macSystemName}, ${build.egpuEnclosureName}, and ${build.gpuName}. Fit is reviewed before quote or payment.`,
    path: `/mac-egpu-builds/${build.id}`,
  });
}

export default async function MacEgpuBuildDetailPage({
  params,
}: MacEgpuBuildDetailParams) {
  const lang = await getRequestLanguage();
  const build = await resolveMacEgpuBuildFromParams(params);
  if (!build) {
    notFound();
  }

  const riskColors: Record<string, string> = {
    experimental: "!border-red-400/50 !text-red-400",
    advanced: "!border-yellow-400/50 !text-yellow-400",
    stable: "!border-green-400/50 !text-green-400",
  };
  const workloadFit = workloadGuidance({
    gpuVramGb: build.gpuVramGb,
    systemRamGb: build.macSystemMemoryGb,
    gpuName: build.gpuName,
    platform: "mac-egpu",
  }, lang);

  const t = {
    macSystem: lang === "et" ? "Maci süsteem" : "Mac System",
    enclosure: lang === "et" ? "eGPU karp" : "eGPU Enclosure",
    gpu: "GPU",
    supported: lang === "et" ? "Toetatud kasutusviisid" : "Supported Workloads",
    unsupported: lang === "et" ? "Mitte toetatud" : "Not Supported",
    warning: lang === "et" ? "Hoiatus ostjale" : "Buyer Warning",
    pricing: lang === "et" ? "Komponentide hinnad" : "Component Pricing",
    notes: lang === "et" ? "Märkmed" : "Notes",
    requestQuote: lang === "et" ? "Küsi pakkumist" : "Request Custom Quote",
    backToProfile: lang === "et" ? "Tagasi Mac eGPU profiili" : "Back to Mac eGPU profile",
    pricingDisclaimer: lang === "et"
      ? "Komponentide turuhinnad muutuvad iga päev. See on viitehinnang; makset ei võeta enne kohandatud pakkumise kinnitamist."
      : "Component market prices change daily. This is a reference estimate; no payment is taken from this form, and payment only follows an agreed custom quote.",
    chip: lang === "et" ? "Kiip" : "Chip",
    memory: lang === "et" ? "Ühtne mälu" : "Unified Memory",
    storage: lang === "et" ? "Salvestus" : "Storage",
    vram: "VRAM",
    architecture: lang === "et" ? "Arhitektuur" : "Architecture",
    macPrice: lang === "et" ? "Maci hind" : "Mac price",
    enclosurePrice: lang === "et" ? "Karbi hind" : "Enclosure price",
  };

  return (
    <main className="min-h-screen px-6 py-10 md:px-12">
      <JsonLd
        data={productJsonLd({
          name: build.name,
          description: build.notes,
          category: "Mac external GPU AI compute setup",
          url: `/mac-egpu-builds/${build.id}`,
          brand: "LLMLab.ee",
          additionalProperty: [
            { name: "Mac system", value: build.macSystemName },
            { name: "eGPU enclosure", value: build.egpuEnclosureName },
            { name: "GPU", value: build.gpuName },
            { name: "VRAM", value: `${build.gpuVramGb}GB` },
            { name: "Risk level", value: build.riskLevel },
          ],
        })}
      />
      <section className="mx-auto max-w-6xl">
        <Masthead lang={lang} />
        <header className="mb-8">
          <PageNav links={[{ href: "/faq", label: "FAQ" }]} lang={lang} />
          <div className="flex items-center gap-3 mt-4">
            <span className={`category-tag ${riskColors[build.riskLevel] ?? ""}`}>
              {build.riskLevel.charAt(0).toUpperCase() + build.riskLevel.slice(1)}
            </span>
          </div>
          <h1 className="font-display mt-3 text-4xl font-semibold tracking-tight md:text-6xl">{build.name}</h1>
        </header>

        {build.riskLevel === "experimental" && (
          <div className="mb-6 rounded-xl border-2 border-red-500/50 bg-red-500/5 p-6">
            <p className="font-display text-lg font-semibold text-red-400">
              {lang === "et" ? "Eksperimentaalne seadistus" : "Experimental Setup"}
            </p>
            <p className="mt-2 text-sm text-[color:var(--muted)]">
              {lang === "et"
                ? "See seadistus kasutab eksperimentaalseid draivereid ja tarkvara. See ei sobi tootmiskasutuseks."
                : "This setup uses experimental drivers and software. Not suitable for production use."}
            </p>
          </div>
        )}

        <div className="grid gap-5 md:grid-cols-3">
          <section className="product-card p-6">
            <h2 className="font-display text-xl font-semibold">{t.macSystem}</h2>
            <div className="mt-4 space-y-2 text-sm text-[color:var(--muted)]">
              <p>{build.macSystemName}</p>
              <p>{t.chip}: {build.macSystemChip}</p>
              <p>{t.memory}: {build.macSystemMemoryGb}GB</p>
              <p>{t.storage}: {build.macSystemStorageGb}GB</p>
            </div>
            <p className="mt-3 text-sm font-semibold">
              {t.macPrice}: €{build.macSystemMarketPriceEur ?? build.macSystemBasePriceEur}
            </p>
          </section>

          <section className="product-card p-6">
            <h2 className="font-display text-xl font-semibold">{t.enclosure}</h2>
            <div className="mt-4 space-y-2 text-sm text-[color:var(--muted)]">
              <p>{build.egpuEnclosureName}</p>
            </div>
            <p className="mt-3 text-sm font-semibold">
              {t.enclosurePrice}: €{build.egpuEnclosureMarketPriceEur ?? build.egpuEnclosureBasePriceEur}
            </p>
          </section>

          <section className="product-card p-6">
            <h2 className="font-display text-xl font-semibold">{t.gpu}</h2>
            <div className="mt-4 space-y-2 text-sm text-[color:var(--muted)]">
              <p>{build.gpuName}</p>
              <p>{t.vram}: {build.gpuVramGb}GB</p>
              <p>{t.architecture}: {build.gpuArchitecture}</p>
            </div>
          </section>
        </div>

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <section className="wireframe-panel p-6 md:col-span-2">
            <h2 className="font-display text-xl font-semibold">{workloadFit.label}</h2>
            <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">{workloadFit.detail}</p>
            <p className="mt-2 text-xs leading-5 text-[color:var(--muted)]">
              {lang === "et"
                ? "See on ostuotsuse abihinnang. Mac + eGPU sobivus sõltub draiveritest, runtime'ist ja sellest, kui palju mudelit saab GPU VRAM-i paigutada."
                : "This is buyer guidance only. Mac + eGPU fit depends on drivers, runtime, and how much of the model fits in GPU VRAM."}
            </p>
          </section>
          <section className="wireframe-panel p-6">
            <h2 className="font-display text-xl font-semibold text-green-400">{t.supported}</h2>
            <ul className="arrow-list mt-3 space-y-1 text-sm text-[color:var(--muted)]">
              {build.targetWorkloads.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </section>

          <section className="wireframe-panel p-6">
            <h2 className="font-display text-xl font-semibold text-red-400">{t.unsupported}</h2>
            <ul className="arrow-list mt-3 space-y-1 text-sm text-[color:var(--muted)]">
              {build.unsupportedWorkloads.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </section>
        </div>

        <div className="mt-6 wireframe-panel p-6">
          <h2 className="font-display text-xl font-semibold text-yellow-400">{t.warning}</h2>
          <p className="mt-3 text-sm text-[color:var(--muted)]">{build.buyerWarning}</p>
          <p className="mt-3 text-xs text-[color:var(--muted)]">
            {lang === "et"
              ? "Selle vormi eesmärk on sobivuse kontroll, mitte kohene makse. Draiveri- ja tarkvarariskid vaadatakse enne võimaliku tellimuse kinnitamist üle."
              : "This flow is for fit review, not immediate payment. Driver and software risks are reviewed before any possible order is confirmed."}
          </p>
        </div>

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <section className="wireframe-panel p-6">
            <h2 className="font-display text-xl font-semibold">{t.pricing}</h2>
            <div className="mt-3 space-y-2 text-sm text-[color:var(--muted)]">
              <p>Mac ({build.macSystemName}): €{build.macSystemMarketPriceEur ?? build.macSystemBasePriceEur}</p>
              <p>Enclosure ({build.egpuEnclosureName}): €{build.egpuEnclosureMarketPriceEur ?? build.egpuEnclosureBasePriceEur}</p>
              <p>GPU ({build.gpuName}): <span className="italic">{lang === "et" ? "sõltub valikust" : "depends on selection"}</span></p>
            </div>
            <p className="mt-2 text-xs text-[color:var(--muted)]">{t.pricingDisclaimer}</p>
          </section>

          <section className="purchase-panel flex flex-col p-6 md:p-7">
            <h2 className="font-display text-xl font-semibold">{t.notes}</h2>
            <p className="mt-3 text-sm text-[color:var(--muted)] flex-1">{build.notes}</p>
            <div className="mt-6">
              <QuoteRequestForm
                productType="mac_egpu_build"
                productId={build.id}
                productName={build.name}
                lang={lang}
              />
            </div>
          </section>
        </div>

        <div className="mt-6">
          <Link href="/profiles/mac-egpu-ai" className="label-pill inline-block">
            {t.backToProfile} →
          </Link>
        </div>

        <div className="mt-6">
          <TrustLinksSection lang={lang} compact />
        </div>
      </section>
    </main>
  );
}
