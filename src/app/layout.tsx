import type { Metadata } from "next";
import { Fraunces, JetBrains_Mono, Public_Sans } from "next/font/google";
import { BackButton } from "@/components/back-button";
import { getRequestLanguage } from "@/lib/server/lang";
import { DEFAULT_DESCRIPTION, JsonLd, SITE_NAME, SITE_URL, organizationJsonLd, websiteJsonLd } from "@/lib/seo";
import "./globals.css";

const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
});

const jetBrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} | AI-ready computers in Estonia`,
    template: `%s | ${SITE_NAME}`,
  },
  description: DEFAULT_DESCRIPTION,
  applicationName: SITE_NAME,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: `${SITE_NAME} | AI-ready computers in Estonia`,
    description: DEFAULT_DESCRIPTION,
    url: "/",
    siteName: SITE_NAME,
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} | AI-ready computers in Estonia`,
    description: DEFAULT_DESCRIPTION,
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const lang = await getRequestLanguage();

  return (
    <html lang={lang} data-theme="dark">
      <body
        className={`${publicSans.variable} ${fraunces.variable} ${jetBrainsMono.variable} antialiased`}
      >
        <div aria-hidden="true" className="gradient-bg" />
        <BackButton />
        <JsonLd data={[organizationJsonLd(), websiteJsonLd()]} />
        <div className="flex min-h-screen flex-col">
          <div className="flex-1">{children}</div>
          {/* TODO: Add formal terms, returns, warranty, privacy, and business-identity links after human legal confirmation. */}
          <footer className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-6 pb-8 pt-10 text-xs text-[color:var(--muted)] sm:flex-row sm:items-center sm:justify-between">
            <span>© {new Date().getFullYear()} LLMLab.ee</span>
            <nav className="flex flex-wrap gap-4" aria-label="Footer">
              <a href="/about" className="hover:text-[color:var(--foreground)]">About</a>
              <a href="/faq" className="hover:text-[color:var(--foreground)]">FAQ</a>
            </nav>
          </footer>
        </div>
      </body>
    </html>
  );
}
