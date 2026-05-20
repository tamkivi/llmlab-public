import Link from "next/link";
import type { Metadata } from "next";
import { Masthead } from "@/components/masthead";
import { PageNav } from "@/components/page-nav";
import { orderSupportHref } from "@/lib/order-ux";
import { getRequestLanguage } from "@/lib/server/lang";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default async function CheckoutCancelPage() {
  const lang = await getRequestLanguage();

  return (
    <main className="min-h-screen px-6 py-10 md:px-12">
      <section className="mx-auto max-w-3xl wireframe-panel p-6">
        <Masthead lang={lang} />
        <div className="mb-6">
          <PageNav
            links={[
              { href: "/", label: lang === "et" ? "Avaleht" : "Home" },
              { href: "/about", label: lang === "et" ? "Meist" : "About" },
              { href: "/faq", label: "FAQ" },
            ]}
            lang={lang}
          />
        </div>

        <h1 className="font-display text-4xl font-semibold">{lang === "et" ? "Makse katkestati" : "Checkout Canceled"}</h1>
        <p className="mt-3 text-sm text-[color:var(--muted)]">
          {lang === "et"
            ? "Makset ei võetud. Võid komplekti lehele tagasi minna ja makset igal ajal uuesti alustada."
            : "No payment was captured. You can return to the build page and start checkout again at any time."}
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/" className="label-pill inline-block">{lang === "et" ? "Tagasi komplektide juurde" : "Back to builds"}</Link>
          <a href={orderSupportHref()} className="label-pill inline-block">
            {lang === "et" ? "Võta ühendust" : "Contact support"}
          </a>
        </div>
      </section>
    </main>
  );
}
