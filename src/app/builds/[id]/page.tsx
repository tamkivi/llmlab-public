import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Masthead } from "@/components/masthead";
import { PageNav } from "@/components/page-nav";
import { PurchaseBuildButton } from "@/components/purchase-build-button";
import { BuildPriceHistoryChart } from "@/components/build-price-history-chart";
import { AiCapabilitySummary } from "@/components/ai-capability-summary";
import { BuyerTrustSection } from "@/components/buyer-trust-section";
import { AssemblyQaChecklist } from "@/components/assembly-qa-checklist";
import { TrustLinksSection } from "@/components/trust-links-section";
import { PriceTransparencyBadges } from "@/components/price-transparency-badges";
import { getBuildDetailView, getPriceHistoryView } from "@/lib/server/catalog-service";
import { getRequestLanguage } from "@/lib/server/lang";
import { JsonLd, pageMetadata, productJsonLd } from "@/lib/seo";
import { workloadGuidance } from "@/lib/workload-guidance";

type BuildDetailParams = {
  params: Promise<{ id: string }>;
};

async function resolveBuildFromParams(params: Promise<{ id: string }>) {
  const resolvedParams = await params;
  const buildId = Number.parseInt(resolvedParams.id, 10);

  if (!Number.isFinite(buildId)) {
    return null;
  }

  return getBuildDetailView(buildId);
}

export async function generateMetadata({ params }: BuildDetailParams): Promise<Metadata> {
  const build = await resolveBuildFromParams(params);

  if (!build) {
    return pageMetadata({
      title: "Build not found",
      description: "The requested AI build could not be found.",
      path: "/",
      noIndex: true,
    });
  }

  return pageMetadata({
    title: `${build.buildName} AI build`,
    description: `AI-ready ${build.profileLabel} build with ${build.gpuName}, ${build.gpuVramGb}GB VRAM, and ${build.ramGb}GB RAM for local LLM workloads.`,
    path: `/builds/${build.id}`,
  });
}

export default async function BuildDetailPage({
  params,
}: BuildDetailParams) {
  const lang = await getRequestLanguage();
  const isEt = lang === "et";
  const build = await resolveBuildFromParams(params);
  if (!build) {
    notFound();
  }
  const directCheckoutEligible = build.checkoutEligible === true;
  const workloadFit = workloadGuidance({
    gpuVramGb: build.gpuVramGb,
    systemRamGb: build.ramGb,
    gpuName: build.gpuName,
    platform: "desktop",
  }, lang);

  const componentHistory = build.componentPrices
    ? await Promise.all(
        build.componentPrices.map(async (cp) => ({
          key: `${cp.category}:${cp.itemId}`,
          label: cp.label,
          name: cp.name,
          orderPriceEur: cp.priceEur,
          marketAvgEur: cp.marketAvgEur,
          ranges: {
            "7d": await getPriceHistoryView(cp.category, cp.itemId, 7),
            "30d": await getPriceHistoryView(cp.category, cp.itemId, 30),
            "90d": await getPriceHistoryView(cp.category, cp.itemId, 90),
          },
        })),
      )
    : [];

  return (
    <main className="min-h-screen px-6 py-10 md:px-12">
      <JsonLd
        data={productJsonLd({
          name: build.buildName,
          description: build.bestFor,
          category: "AI workstation",
          url: `/builds/${build.id}`,
          brand: "LLMLab.ee",
          additionalProperty: [
            { name: "Profile", value: build.profileLabel },
            { name: "GPU", value: build.gpuName },
            { name: "VRAM", value: `${build.gpuVramGb}GB` },
            { name: "RAM", value: `${build.ramGb}GB` },
            { name: "Storage", value: `${build.storageGb}GB` },
            { name: "Model target", value: build.targetModel },
          ],
        })}
      />
      <section className="mx-auto max-w-6xl">
        <Masthead lang={lang} />
        <header className="mb-8">
          <PageNav links={[{ href: "/faq", label: "FAQ" }]} lang={lang} />

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <h1 className="font-display text-4xl font-semibold tracking-tight md:text-6xl">{build.buildName}</h1>
          </div>
          <p className="mt-3 text-lg text-[color:var(--muted)]">{build.bestFor}</p>
          <p className="mt-2 text-sm text-[color:var(--muted)]">{isEt ? "Profiil" : "Profile"}: {build.profileLabel}</p>
        </header>

        <div className="grid gap-5 md:grid-cols-2">
          <section className="wireframe-panel p-6">
            <h2 className="font-display text-3xl font-semibold">{isEt ? "Põhikonfiguratsioon" : "Core Configuration"}</h2>
            <div className="spec-grid mt-5 sm:grid-cols-2">
              {[
                ["CPU", build.cpuName],
                ["GPU", build.gpuName],
                ["VRAM", `${build.gpuVramGb}GB`],
                ["RAM", `${build.ramGb}GB`],
                [isEt ? "Salvestus" : "Storage", `${build.storageGb}GB`],
                [isEt ? "Mudeli siht" : "Model target", build.targetModel],
              ].map(([label, value]) => (
                <div key={label} className="spec-tile">
                  <p className="text-[11px] uppercase tracking-wide text-[color:var(--muted)]">{label}</p>
                  <p className="mt-1 text-sm font-semibold">{value}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="wireframe-panel p-6">
            <h2 className="font-display text-3xl font-semibold">{isEt ? "Jõudlus ja võimsus" : "Performance & Power"}</h2>
            <div className="spec-grid mt-5 sm:grid-cols-2">
              {[
                [isEt ? "Läbilaskevõime" : "Throughput", build.estimatedTokensPerSec],
                [isEt ? "Süsteemivõimsus" : "System power", `~${build.estimatedSystemPowerW}W`],
                [isEt ? "Soovitatav PSU" : "Recommended PSU", `${build.recommendedPsuW}W`],
                [isEt ? "Jahutus" : "Cooling", build.coolingProfile],
              ].map(([label, value]) => (
                <div key={label} className="spec-tile">
                  <p className="text-[11px] uppercase tracking-wide text-[color:var(--muted)]">{label}</p>
                  <p className="mt-1 text-sm font-semibold">{value}</p>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="mt-6 wireframe-panel p-6">
          <h2 className="font-display text-3xl font-semibold">{isEt ? "Mida see komplekt käitada saab?" : "What can this build run?"}</h2>
          <div className="mt-4 rounded-lg border border-[color:var(--panel-border)] bg-[color:var(--background)]/30 p-4">
            <p className="text-sm font-semibold">{workloadFit.label}</p>
            <p className="mt-1 text-sm leading-6 text-[color:var(--muted)]">{workloadFit.detail}</p>
          </div>
          <AiCapabilitySummary
            input={{
              gpuVramGb: build.gpuVramGb,
              systemRamGb: build.ramGb,
              gpuName: build.gpuName,
              gpuArchitecture: build.gpuArchitecture,
            }}
            lang={lang}
          />
        </section>

        {(build.componentPrices && build.componentPrices.length > 0) || (build.missingComponents && build.missingComponents.length > 0) ? (
          <section className="mt-6 wireframe-panel p-6">
            <h2 className="font-display text-3xl font-semibold">{isEt ? "Komponentide hinnajaotus" : "Component Pricing Breakdown"}</h2>
            <p className="mt-2 text-sm text-[color:var(--muted)]">
              {isEt
                ? "Võimalusel kasutame Eesti turuhindu, muul juhul viitehinnangut. Tellimuse hind sisaldab planeeritud kokkupanekut ja seadistust."
                : "Prices use Estonian market data when available, otherwise reference estimates. Order price includes planned assembly and configuration."}
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[color:var(--panel-border)]">
                    <th className="py-2 pr-4 text-left text-xs uppercase tracking-wide text-[color:var(--muted)]">{isEt ? "Komponent" : "Component"}</th>
                    <th className="py-2 pr-4 text-left text-xs uppercase tracking-wide text-[color:var(--muted)]">{isEt ? "Toode" : "Product"}</th>
                    <th className="py-2 text-right text-xs uppercase tracking-wide text-[color:var(--muted)]">{isEt ? "Tellimuse hind" : "Order price"}</th>
                  </tr>
                </thead>
                <tbody>
                  {build.componentPrices?.map((cp) => (
                    <tr key={`${cp.category}:${cp.itemId}`} className="border-b border-[color:var(--panel-border)]">
                      <td className="py-2 pr-4 font-mono text-xs text-[color:var(--muted)]">{cp.label}</td>
                      <td className="py-2 pr-4">
                        <span>{cp.name}</span>
                        <PriceTransparencyBadges
                          pricing={cp}
                          lang={lang}
                          compact
                        />
                      </td>
                      <td className="py-2 text-right font-mono">€{cp.priceEur.toLocaleString()}</td>
                    </tr>
                  ))}
                  {build.missingComponents?.map((label) => (
                    <tr key={`missing-${label}`} className="border-b border-[color:var(--panel-border)]">
                      <td className="py-2 pr-4 font-mono text-xs text-[color:var(--muted)]">{label}</td>
                      <td className="py-2 pr-4 text-xs italic text-[color:var(--muted)]">
                        {isEt ? "Hinnainfo puudub" : "Pricing unavailable"}
                      </td>
                      <td className="py-2 text-right font-mono text-xs text-[color:var(--muted)]">—</td>
                    </tr>
                  ))}
                </tbody>
                {build.componentTotalEur != null && (
                  <tfoot>
                    <tr className="border-t-2 border-[color:var(--panel-border)]">
                      <td colSpan={2} className="py-3 font-semibold">{isEt ? "Osade vahesumma" : "Parts subtotal"}</td>
                      <td className="py-3 text-right font-mono font-semibold">€{build.componentTotalEur.toLocaleString()}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </section>
        ) : null}

        {build.componentPrices && build.componentPrices.length > 0 ? (
          <section className="mt-6 wireframe-panel p-6">
            <h2 className="font-display text-2xl font-semibold">{isEt ? "Komplekti hinnalugu" : "Build price history"}</h2>
            <div className="mt-4">
              <BuildPriceHistoryChart series={componentHistory} lang={lang} />
            </div>
          </section>
        ) : null}

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <section className="wireframe-panel p-6">
            <h2 className="font-display text-xl font-semibold">{isEt ? "Komplekti märkmed" : "Build Notes"}</h2>
            <p className="mt-3 text-sm text-[color:var(--muted)]">{build.notes}</p>
            <p className="mt-3 font-mono text-xs text-[color:var(--muted)]">{isEt ? "Allikad" : "Source refs"}: {build.sourceRefs}</p>
          </section>

          <section className="purchase-panel p-6 md:p-7">
            <h2 className="font-display text-xl font-semibold">{isEt ? "Tellimine" : "Order"}</h2>
            <p className="mt-3 text-xs uppercase tracking-wide text-[color:var(--muted)]">
              {directCheckoutEligible
                ? (isEt ? "Tellimuse hind" : "Order price")
                : (isEt ? "Pakkumise alushind" : "Quote reference price")}
            </p>
            <p className="price-lockup mt-3">€{(build.componentTotalEur ?? 0).toLocaleString()}</p>
            <p className="mt-1 text-xs text-[color:var(--muted)]">
              {directCheckoutEligible
                ? (isEt
                  ? "Tellimuse hind põhineb praegu kontrollitud komponentide tellimushindade summal."
                  : "Order price is based on the currently checked component order prices.")
                : (isEt
                  ? "Näidatud hind on planeerimiseks. Otsekassa jääb pakkumispõhiseks kuni värske turuhind ja saadavus on kontrollitud."
                  : "Shown for planning. Direct checkout remains quote-only until fresh market pricing and availability are checked.")}
            </p>
            <p className="mt-2 text-xs text-[color:var(--muted)]">
              {isEt
                ? "Hinnagraafik näitab tellimuse hinnale vastavat ajalugu koos kokkupaneku juurdehindlusega."
                : "Price chart shows order-equivalent history including assembly markup."}
            </p>
            {build.componentTotalEur && build.componentTotalEur > 0 ? (
              <PurchaseBuildButton
                itemType="profile_build"
                itemId={build.id}
                priceEur={build.componentTotalEur}
                isProfileBuild
                lang={lang}
                checkoutAvailable={directCheckoutEligible}
                checkoutUnavailableReason={build.checkoutDisabledReason}
              />
            ) : (
              <p className="mt-3 text-xs text-yellow-400">
                {isEt
                  ? "Mõne komponendi hinnainfo puudub, seega ei saa tellimust praegu avada."
                  : "Some components are missing pricing data, so checkout is currently unavailable."}
              </p>
            )}
            <div className="mt-4">
              <Link href="/" className="label-pill inline-block">
                {isEt ? "Tagasi kataloogi" : "Back to catalog"}
              </Link>
            </div>
          </section>
        </div>

        <div className="mt-6">
          <BuyerTrustSection lang={lang} compact />
        </div>
        <div className="mt-6">
          <AssemblyQaChecklist lang={lang} compact />
        </div>
        <div className="mt-6">
          <TrustLinksSection lang={lang} compact />
        </div>
      </section>
    </main>
  );
}
