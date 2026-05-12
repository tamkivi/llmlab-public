import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Masthead } from "@/components/masthead";
import { PageNav } from "@/components/page-nav";
import { PriceGraph } from "@/components/price-graph";
import { PriceTransparencyBadges } from "@/components/price-transparency-badges";
import { PurchaseBuildButton } from "@/components/purchase-build-button";
import { QuoteRequestForm } from "@/components/quote-request-form";
import { BuyerTrustSection } from "@/components/buyer-trust-section";
import { AssemblyQaChecklist } from "@/components/assembly-qa-checklist";
import { TrustLinksSection } from "@/components/trust-links-section";
import { type CatalogItemType, type PublicCatalogItemDetail, getCatalogItemDetailView, getPriceHistoryView } from "@/lib/server/catalog-service";
import { getRequestLanguage } from "@/lib/server/lang";
import { JsonLd, pageMetadata, productJsonLd } from "@/lib/seo";
import { workloadGuidance } from "@/lib/workload-guidance";

function parseCatalogType(value: string): CatalogItemType | null {
  const allowed: CatalogItemType[] = [
    "gpu",
    "cpu",
    "ram_kit",
    "power_supply",
    "case",
    "motherboard",
    "compact_ai_system",
    "storage_drive",
    "cpu_cooler",
    "mac_system",
    "external_gpu_enclosure",
  ];
  return allowed.includes(value as CatalogItemType) ? (value as CatalogItemType) : null;
}

function extractSpecNumber(value?: string) {
  const match = value?.match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : undefined;
}

function getSpecNumber(item: PublicCatalogItemDetail, labels: string[]) {
  const spec = item.specs.find((entry) => labels.includes(entry.label));
  return extractSpecNumber(spec?.value);
}

function catalogWorkloadFit(item: PublicCatalogItemDetail, lang: "en" | "et") {
  const supportedTypes: CatalogItemType[] = ["gpu", "cpu", "ram_kit", "motherboard", "compact_ai_system", "mac_system"];
  if (!supportedTypes.includes(item.itemType)) return null;

  const gpuVramGb = getSpecNumber(item, ["VRAM"]);
  const memoryGb = getSpecNumber(item, ["Capacity", "Max Memory", "Memory", "Unified Memory"]);
  const isMacLike = item.itemType === "mac_system" || item.specs.some((spec) => spec.value.toLowerCase().includes("unified"));

  return workloadGuidance({
    gpuVramGb,
    systemRamGb: memoryGb,
    unifiedMemoryGb: isMacLike ? memoryGb : undefined,
    gpuName: item.name,
    platform: isMacLike ? "mac" : "desktop",
  }, lang);
}

function catalogCategoryLabel(itemType: CatalogItemType) {
  return itemType.replaceAll("_", " ");
}

async function resolveCatalogItemFromParams(params: Promise<{ type: string; id: string }>) {
  const resolvedParams = await params;
  const itemType = parseCatalogType(resolvedParams.type);
  const itemId = Number.parseInt(resolvedParams.id, 10);

  if (!itemType || !Number.isFinite(itemId) || itemId <= 0) {
    return null;
  }

  return getCatalogItemDetailView(itemType, itemId);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ type: string; id: string }>;
}): Promise<Metadata> {
  const item = await resolveCatalogItemFromParams(params);

  if (!item) {
    return pageMetadata({
      title: "Catalog item not found",
      description: "The requested catalog item could not be found.",
      path: "/",
      noIndex: true,
    });
  }

  return pageMetadata({
    title: item.name,
    description: `${item.subtitle} Buyer guidance and specifications for AI-ready systems and components from LLMLab.ee.`,
    path: `/catalog/${item.itemType}/${item.itemId}`,
  });
}

export default async function CatalogDetailPage({
  params,
}: {
  params: Promise<{ type: string; id: string }>;
}) {
  const lang = await getRequestLanguage();
  const item = await resolveCatalogItemFromParams(params);
  if (!item) {
    notFound();
  }
  const itemType = item.itemType;
  const itemId = item.itemId;
  const directCheckoutEligible = item.purchasable && item.checkoutEligible === true;
  const workloadFit = catalogWorkloadFit(item, lang);
  const brand = item.specs.find((spec) => ["Brand", "Vendor"].includes(spec.label))?.value;

  const [priceHistory7d, priceHistory30d, priceHistory90d] = await Promise.all([
    getPriceHistoryView(itemType, itemId, 7),
    getPriceHistoryView(itemType, itemId, 30),
    getPriceHistoryView(itemType, itemId, 90),
  ]);

  return (
    <main className="min-h-screen px-6 py-10 md:px-12">
      <JsonLd
        data={productJsonLd({
          name: item.name,
          description: item.subtitle,
          category: catalogCategoryLabel(item.itemType),
          url: `/catalog/${item.itemType}/${item.itemId}`,
          brand,
          additionalProperty: item.specs.slice(0, 10).map((spec) => ({
            name: spec.label,
            value: spec.value,
          })),
        })}
      />
      <section className="mx-auto max-w-6xl">
        <Masthead lang={lang} />
        <header className="mb-8">
          <PageNav
            links={[
              { href: "/", label: lang === "et" ? "Avaleht" : "Home" },
              { href: "/about", label: lang === "et" ? "Meist" : "About" },
              { href: "/faq", label: "FAQ" },
            ]}
            lang={lang}
          />

          <h1 className="font-display mt-4 text-4xl font-semibold tracking-tight md:text-6xl">{item.name}</h1>
          <p className="mt-3 text-lg text-[color:var(--muted)]">{item.subtitle}</p>
        </header>

        <section className="wireframe-panel p-6">
          <h2 className="font-display text-3xl font-semibold">{lang === "et" ? "Andmed" : "Details"}</h2>
          <div className="spec-grid mt-5 md:grid-cols-2">
            {item.specs.map((spec) => (
              <div key={spec.label} className="spec-tile">
                <p className="text-[11px] uppercase tracking-wide text-[color:var(--muted)]">{spec.label}</p>
                <p className="mt-1 text-sm font-semibold">{spec.value}</p>
              </div>
            ))}
          </div>
          {workloadFit ? (
            <div className="mt-5 rounded-lg border border-[color:var(--panel-border)] bg-[color:var(--background)]/30 p-4">
              <p className="text-sm font-semibold">{workloadFit.label}</p>
              <p className="mt-1 text-sm leading-6 text-[color:var(--muted)]">{workloadFit.detail}</p>
            </div>
          ) : null}
        </section>

        <section className="wireframe-panel mt-6 p-6">
          <h2 className="font-display text-3xl font-semibold">
            {item.purchasable
              ? (lang === "et" ? "Hinnaajalugu" : "Price History")
              : (lang === "et" ? "Hinnanguline turuhind" : "Estimated Market Pricing")}
          </h2>
          <p className="mt-2 text-sm text-[color:var(--muted)]">
            {item.purchasable
              ? (lang === "et"
                ? "Eesti turu keskmine hind enne kokkupanekut, uuendatud Eesti poodide andmete põhjal. Tellimuse hind sisaldab 15% kokkupaneku ja seadistuse juurdehindlust."
                : "Estonian market average before assembly, updated from Estonian store data. Order price includes the 15% assembly and configuration markup.")
              : (lang === "et"
                ? "Eesti turu viitehinnang enne kokkupanekut. Seda kasutatakse kohandatud hinnapakkumise ettevalmistamiseks."
                : "Estonian market reference estimate before assembly. Used to prepare your custom quote.")}
          </p>
          <PriceTransparencyBadges
            pricing={item}
            lang={lang}
          />
          <div className="mt-4">
            <PriceGraph
              ranges={{ "7d": priceHistory7d, "30d": priceHistory30d, "90d": priceHistory90d }}
              preorderPriceEur={item.preorderPriceEur}
              marketAvgEur={item.marketAvgEur}
              isQuoteProduct={!directCheckoutEligible}
              lang={lang}
            />
          </div>
        </section>

        <section className="purchase-panel mt-6 p-6 md:p-7">
          <h2 className="font-display text-3xl font-semibold">
            {lang === "et" ? "Hind ja ostmine" : "Pricing & Purchase"}
          </h2>
          {item.marketAvgEur !== null ? (
            <p className="mt-3 text-sm text-[color:var(--muted)]">
              {lang === "et" ? "Eesti turu keskmine enne kokkupanekut:" : "Estonian market average before assembly:"} €{item.marketAvgEur.toFixed(2)}
            </p>
          ) : null}
          <p className="price-lockup mt-3">
            {item.purchasable
              ? (directCheckoutEligible
                ? (lang === "et" ? "Tellimuse hind:" : "Order price:")
                : (lang === "et" ? "Pakkumise alushind:" : "Quote reference price:"))
              : (lang === "et" ? "Pakkumise alushind:" : "Quote reference price:")} €{item.preorderPriceEur}
          </p>
          <PriceTransparencyBadges
            pricing={item}
            lang={lang}
            compact
          />
          <p className="mt-2 text-xs text-[color:var(--muted)]">
              {directCheckoutEligible
                ? (lang === "et"
                  ? "Stripe'i kassas makstakse see tellimuse hind. Enne kokkupanekut kontrollime saadavuse üle."
                  : "This order price is paid in Stripe checkout. Availability is checked before assembly.")
                : (lang === "et"
                  ? "Näidatud hind on planeerimiseks. Otsekassa jääb pakkumispõhiseks kuni värske turuhind ja saadavus on kontrollitud."
                  : "Shown for planning. Direct checkout remains quote-only until fresh market pricing and availability are checked.")}
          </p>
          {item.purchasable ? (
            <PurchaseBuildButton
              itemType={item.checkoutItemType as "gpu" | "cpu" | "ram_kit" | "power_supply" | "case" | "motherboard" | "compact_ai_system" | "storage_drive" | "cpu_cooler"}
              itemId={item.itemId}
              priceEur={item.preorderPriceEur}
              buttonLabel={lang === "et" ? `Osta €${item.preorderPriceEur}` : `Purchase for €${item.preorderPriceEur}`}
              checkoutAvailable={directCheckoutEligible}
              checkoutUnavailableReason={item.checkoutDisabledReason}
            />
          ) : (
            <div className="mt-6">
              <QuoteRequestForm
                productType={item.itemType as "mac_system" | "external_gpu_enclosure"}
                productId={item.itemId}
                productName={item.name}
                lang={lang}
              />
            </div>
          )}
          <div className="mt-5">
            <Link href="/" className="label-pill inline-block">
              {lang === "et" ? "Tagasi kataloogi" : "Back to catalog"}
            </Link>
          </div>
        </section>

        <div className="mt-6">
          <BuyerTrustSection lang={lang} compact />
        </div>
        {item.purchasable ? (
          <div className="mt-6">
            <AssemblyQaChecklist lang={lang} compact />
          </div>
        ) : null}
        <div className="mt-6">
          <TrustLinksSection lang={lang} compact />
        </div>
      </section>
    </main>
  );
}
