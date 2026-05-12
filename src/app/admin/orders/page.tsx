import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminOperationsView } from "@/components/admin-operations-view";
import { Masthead } from "@/components/masthead";
import { PageNav } from "@/components/page-nav";
import { requireAuth } from "@/lib/server/auth-helpers";
import { getRequestLanguage } from "@/lib/server/lang";
import { getAdminOperationsView } from "@/lib/server/order-service";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default async function AdminOrdersPage() {
  const lang = await getRequestLanguage();
  const auth = await requireAuth();

  if (!auth || auth.user.role !== "ADMIN") {
    redirect("/");
  }

  const data = await getAdminOperationsView();

  return (
    <main className="min-h-screen px-6 py-10 md:px-12">
      <section className="mx-auto max-w-6xl">
        <Masthead lang={lang} />
        <header className="mb-8">
          <PageNav
            links={[
              { href: "/", label: lang === "et" ? "Avaleht" : "Home" },
              { href: "/orders", label: lang === "et" ? "Minu tellimused" : "My Orders" },
            ]}
            lang={lang}
          />

          <h1 className="font-display mt-4 text-4xl font-semibold tracking-tight md:text-6xl">Admin Orders</h1>
          <p className="mt-3 text-sm text-[color:var(--muted)]">Monitor all customer orders and payment lifecycle states.</p>
        </header>

        <AdminOperationsView data={data} />
      </section>
    </main>
  );
}
