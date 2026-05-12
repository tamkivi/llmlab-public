import Link from "next/link";
import type { Metadata } from "next";
import { CheckoutSessionStatus } from "@/components/checkout-session-status";
import { Masthead } from "@/components/masthead";
import { PageNav } from "@/components/page-nav";
import { requireAuth } from "@/lib/server/auth-helpers";
import { getRequestLanguage } from "@/lib/server/lang";
import { getCheckoutOrderView } from "@/lib/server/order-service";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const lang = await getRequestLanguage();
  const params = await searchParams;
  const sessionId = params.session_id;

  const auth = await requireAuth();

  const order = auth && sessionId
    ? await getCheckoutOrderView(auth.user.id, sessionId)
    : null;

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

        <h1 className="font-display text-4xl font-semibold">{lang === "et" ? "Makse kontroll" : "Payment status"}</h1>
        <p className="mt-3 text-sm text-[color:var(--muted)]">
          {lang === "et"
            ? "Kontrollime Stripe'i makseolekut ja näitame sama tellimuse viidet, mida kasutame e-kirjades ja kontol."
            : "We are checking Stripe's payment state and showing the same order reference used in email and your account."}
        </p>

        <CheckoutSessionStatus sessionId={sessionId ?? null} initialOrder={order} lang={lang} />

        <div className="mt-6 rounded-lg border border-[color:var(--panel-border)] bg-[color:var(--panel)] p-4">
          <p className="text-sm font-semibold">{lang === "et" ? "Järgmised sammud" : "Next steps"}</p>
          <ul className="arrow-list mt-3 space-y-1 text-xs leading-5 text-[color:var(--muted)]">
            <li>{lang === "et" ? "Kui Stripe kinnitab makse, saabub kinnituskiri tavaliselt mõne minuti jooksul." : "When Stripe confirms payment, the confirmation email usually arrives within a few minutes."}</li>
            <li>{lang === "et" ? "Seejärel kontrollime saadavust, tellime komponendid, paneme süsteemi kokku ja teeme põhikontrolli." : "We then check availability, source parts, assemble the system, and run baseline checks."}</li>
            <li>{lang === "et" ? "Kui saadavus võib nõuda asendust, võtame enne muudatust ühendust." : "If availability may require a substitution, we contact you before changing the order."}</li>
          </ul>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/orders" className="rounded-md bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-white">
            {lang === "et" ? "Vaata minu tellimusi" : "View my orders"}
          </Link>
          <Link href="/" className="label-pill inline-block">{lang === "et" ? "Tagasi komplektide juurde" : "Back to builds"}</Link>
        </div>
      </section>
    </main>
  );
}
