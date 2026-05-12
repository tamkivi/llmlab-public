import { Masthead } from "@/components/masthead";
import { PageNav } from "@/components/page-nav";
import { getRequestLanguage } from "@/lib/server/lang";
import Link from "next/link";

export default async function NotFound() {
  const lang = await getRequestLanguage();

  return (
    <main className="min-h-screen px-6 py-16 md:px-12">
      <section className="mx-auto max-w-6xl">
        <Masthead lang={lang} />
        <header className="mb-8">
          <PageNav links={[{ href: "/", label: lang === "et" ? "Avaleht" : "Home" }]} lang={lang} />
        </header>
        <div className="wireframe-panel p-12 text-center">
          <p className="font-display text-8xl font-semibold text-[color:var(--muted)]">404</p>
          <p className="mt-6 text-xl text-[color:var(--muted)]">
            {lang === "et" ? "Seda lehte ei leitud." : "This page could not be found."}
          </p>
          <Link
            href="/"
            className="mt-8 inline-flex items-center gap-2 rounded-full bg-[color:var(--accent)] px-8 py-4 text-base font-bold text-white"
          >
            {lang === "et" ? "Tagasi avalehele" : "Back to homepage"} →
          </Link>
        </div>
      </section>
    </main>
  );
}
