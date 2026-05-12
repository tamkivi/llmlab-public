import type { Metadata } from "next";

function normalizeSiteUrl() {
  const candidate = process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://llmlab.ee";

  try {
    return new URL(candidate).origin;
  } catch {
    return "https://llmlab.ee";
  }
}

export const SITE_URL = normalizeSiteUrl();
export const SITE_NAME = "LLMLab.ee";
export const DEFAULT_DESCRIPTION =
  "AI-ready computers and component guidance for local LLM inference, fine-tuning, and AI development in Estonia.";

export function absoluteUrl(path = "/") {
  return new URL(path, SITE_URL).toString();
}

export function pageMetadata({
  title,
  description,
  path,
  type = "website",
  noIndex = false,
}: {
  title: string;
  description: string;
  path: string;
  type?: "website" | "article";
  noIndex?: boolean;
}): Metadata {
  const url = absoluteUrl(path);

  return {
    title,
    description,
    alternates: {
      canonical: url,
    },
    openGraph: {
      title,
      description,
      url,
      siteName: SITE_NAME,
      type,
      locale: "en_US",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
    robots: noIndex
      ? {
          index: false,
          follow: false,
        }
      : undefined,
  };
}

export function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}

export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: absoluteUrl("/"),
    description: DEFAULT_DESCRIPTION,
    areaServed: {
      "@type": "Country",
      name: "Estonia",
    },
  };
}

export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: absoluteUrl("/"),
    description: DEFAULT_DESCRIPTION,
    potentialAction: {
      "@type": "SearchAction",
      target: `${absoluteUrl("/")}?q={search_term_string}#component-catalog`,
      "query-input": "required name=search_term_string",
    },
  };
}

export function productJsonLd({
  name,
  description,
  category,
  url,
  brand,
  additionalProperty,
}: {
  name: string;
  description: string;
  category: string;
  url: string;
  brand?: string;
  additionalProperty?: Array<{ name: string; value: string | number }>;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name,
    description,
    category,
    url: absoluteUrl(url),
    brand: brand
      ? {
          "@type": "Brand",
          name: brand,
        }
      : undefined,
    additionalProperty: additionalProperty?.map((property) => ({
      "@type": "PropertyValue",
      name: property.name,
      value: String(property.value),
    })),
  };
}
