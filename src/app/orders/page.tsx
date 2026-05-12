import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Masthead } from "@/components/masthead";
import { OrderTimeline } from "@/components/order-timeline";
import { PageNav } from "@/components/page-nav";
import { requireAuth } from "@/lib/server/auth-helpers";
import { getRequestLanguage } from "@/lib/server/lang";
import { getUserOrdersView } from "@/lib/server/order-service";
import { orderStatusCopy, orderSupportHref } from "@/lib/order-ux";

type UserOrderView = Awaited<ReturnType<typeof getUserOrdersView>>[number];

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

function OrderCard({ order, lang }: { order: UserOrderView; lang: "en" | "et" }) {
  const copy = orderStatusCopy(order.status, lang);

  return (
    <article className="product-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-[color:var(--muted)]">{lang === "et" ? "Tellimus" : "Order"}</p>
          <p className="mt-1 text-lg font-semibold">#{order.id}</p>
        </div>
        <span className="label-pill">{copy.label}</span>
      </div>
      <p className="mt-2 text-sm text-[color:var(--muted)]">{lang === "et" ? "Toode" : "Item"}: {order.buildName}</p>
      <p className="text-sm text-[color:var(--muted)]">{lang === "et" ? "Summa" : "Amount"}: €{order.amountEur}</p>
      <p className="text-xs text-[color:var(--muted)]">{lang === "et" ? "Loodud" : "Created"}: {order.createdAt}</p>
      <p className="mt-3 text-sm text-[color:var(--muted)]">{copy.body}</p>
      <OrderTimeline status={order.status} lang={lang} compact />
      <div className="mt-3 flex flex-wrap gap-3">
        {order.checkoutSessionId ? (
          <Link
            href={`/checkout/success?session_id=${encodeURIComponent(order.checkoutSessionId)}`}
            className="inline-block rounded-md bg-[color:var(--accent-2)] px-3 py-1 text-xs font-semibold text-white"
          >
            {lang === "et" ? "Vaata makse andmeid" : "View payment details"}
          </Link>
        ) : null}
        {order.status === "PAID" ? null : (
          <a href={orderSupportHref(order.id)} className="label-pill inline-block">
            {lang === "et" ? "Võta ühendust" : "Contact support"}
          </a>
        )}
      </div>
    </article>
  );
}

export default async function OrdersPage() {
  const lang = await getRequestLanguage();
  const auth = await requireAuth();

  if (!auth) {
    redirect("/");
  }

  const orders = await getUserOrdersView(auth.user.id);

  return (
    <main className="min-h-screen px-6 py-10 md:px-12">
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

          <h1 className="font-display mt-4 text-4xl font-semibold tracking-tight md:text-6xl">{lang === "et" ? "Minu tellimused" : "My Orders"}</h1>
          <p className="mt-3 text-sm text-[color:var(--muted)]">
            {lang === "et" ? "Jälgi oma tellimuste makse-, saadavuse kontrolli ja komplekteerimisolekut." : "Track payment, availability-check, and build status for your orders."}
          </p>
        </header>

        <section className="wireframe-panel p-6">
          {orders.length === 0 ? (
            <div className="py-8 text-center">
              <p className="font-display text-2xl font-semibold">
                {lang === "et" ? "Tellimusi veel ei ole" : "No orders yet"}
              </p>
              <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[color:var(--muted)]">
                {lang === "et" ? "Vali komplekt, komponent või süsteem ning jätka Stripe'i maksega või küsi pakkumist." : "Pick a build, component, or system and continue to Stripe checkout or request a quote."}
              </p>
              <Link href="/" className="btn-primary mt-5 inline-flex text-sm">
                {lang === "et" ? "Sirvi komplekte" : "Browse builds"}
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {orders.map((order) => (
                <OrderCard key={order.id} order={order} lang={lang} />
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
