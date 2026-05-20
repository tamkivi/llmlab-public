import type { MetadataRoute } from "next";
import { getHomeCatalogView, getProfileView, type CatalogItemType } from "@/lib/server/catalog-service";
import { absoluteUrl } from "@/lib/seo";

const profilePaths = [
  "/profiles/local-llm-inference",
  "/profiles/llm-finetune-starter",
  "/profiles/hybrid-ai-gaming",
  "/profiles/workstation-ai",
  "/profiles/macos-systems",
  "/profiles/mac-egpu-ai",
];

function sitemapEntry(
  url: string,
  priority: number,
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] = "weekly",
): MetadataRoute.Sitemap[number] {
  return {
    url: absoluteUrl(url),
    lastModified: new Date(),
    changeFrequency,
    priority,
  };
}

function catalogEntry(type: CatalogItemType, id: number) {
  return sitemapEntry(`/catalog/${type}/${id}`, 0.6);
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [catalog, profileView] = await Promise.all([getHomeCatalogView(), getProfileView()]);

  return [
    sitemapEntry("/", 1, "daily"),
    sitemapEntry("/about", 0.7, "monthly"),
    sitemapEntry("/faq", 0.8, "monthly"),
    sitemapEntry("/terms", 0.4, "monthly"),
    sitemapEntry("/privacy", 0.4, "monthly"),
    sitemapEntry("/returns", 0.4, "monthly"),
    sitemapEntry("/warranty", 0.4, "monthly"),
    sitemapEntry("/contact", 0.5, "monthly"),
    ...profilePaths.map((path) => sitemapEntry(path, 0.75)),
    ...profileView.profileBuilds.map((build) => sitemapEntry(`/builds/${build.id}`, 0.7)),
    ...profileView.macEgpuBuilds.map((build) => sitemapEntry(`/mac-egpu-builds/${build.id}`, 0.65)),
    ...catalog.gpus.map((item) => catalogEntry("gpu", item.id)),
    ...catalog.cpus.map((item) => catalogEntry("cpu", item.id)),
    ...catalog.ramKits.map((item) => catalogEntry("ram_kit", item.id)),
    ...catalog.powerSupplies.map((item) => catalogEntry("power_supply", item.id)),
    ...catalog.cases.map((item) => catalogEntry("case", item.id)),
    ...catalog.motherboards.map((item) => catalogEntry("motherboard", item.id)),
    ...catalog.storageDrives.map((item) => catalogEntry("storage_drive", item.id)),
    ...catalog.cpuCoolers.map((item) => catalogEntry("cpu_cooler", item.id)),
    ...catalog.compactAiSystems.map((item) => catalogEntry("compact_ai_system", item.id)),
    ...catalog.macSystems.map((item) => catalogEntry("mac_system", item.id)),
    ...catalog.externalGpuEnclosures.map((item) => catalogEntry("external_gpu_enclosure", item.id)),
  ];
}
