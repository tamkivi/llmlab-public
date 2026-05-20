import "server-only";
import { revalidateTag } from "next/cache";

export const PUBLIC_PRICING_CACHE_TAGS = [
  "public-catalog",
  "public-build-detail",
  "public-catalog-detail",
  "public-price-history",
] as const;

export function revalidatePublicPricingCaches(): { tags: string[]; failedTags: string[] } {
  const failedTags: string[] = [];
  for (const tag of PUBLIC_PRICING_CACHE_TAGS) {
    try {
      revalidateTag(tag, "max");
    } catch {
      failedTags.push(tag);
    }
  }
  return {
    tags: [...PUBLIC_PRICING_CACHE_TAGS],
    failedTags,
  };
}
