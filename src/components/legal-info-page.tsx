import { Masthead } from "@/components/masthead";
import { PageNav } from "@/components/page-nav";
import type { SiteLanguage } from "@/lib/lang";

type LegalInfoSection = {
  title: string;
  body: string[];
};

export function LegalInfoPage({
  lang,
  title,
  intro,
  sections,
}: {
  lang: SiteLanguage;
  title: string;
  intro: string;
  sections: LegalInfoSection[];
}) {
  return (
    <main className="min-h-screen px-6 py-16 md:px-12">
      <section className="mx-auto max-w-5xl">
        <Masthead lang={lang} />
        <header className="mb-10">
          <PageNav
            links={[
              { href: "/", label: lang === "et" ? "Avaleht" : "Home" },
              { href: "/faq", label: "FAQ" },
              { href: "/contact", label: lang === "et" ? "Kontakt" : "Contact" },
            ]}
            lang={lang}
          />
          <h1 className="font-display mt-6 text-4xl font-semibold tracking-tight md:text-6xl">{title}</h1>
          <p className="mt-5 max-w-3xl text-[color:var(--muted)]">{intro}</p>
          <p className="mt-4 rounded-md border border-amber-500/35 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
            {lang === "et"
              ? "See on ettevaatlik avalik infoleht. Lõplikud juriidilised tingimused tuleb enne avalikku lansseerimist üle vaadata."
              : "This is a conservative public information page. Final legal terms should be reviewed before public launch."}
          </p>
        </header>

        <div className="space-y-4">
          {sections.map((section) => (
            <section key={section.title} className="wireframe-panel p-6">
              <h2 className="font-display text-2xl font-semibold">{section.title}</h2>
              <div className="mt-4 space-y-3 text-sm leading-6 text-[color:var(--muted)]">
                {section.body.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>
    </main>
  );
}
