import Link from "next/link";
import { Masthead } from "@/components/masthead";
import { PageNav } from "@/components/page-nav";
import { AssemblyQaChecklist } from "@/components/assembly-qa-checklist";
import { TrustLinksSection } from "@/components/trust-links-section";
import { getRequestLanguage } from "@/lib/server/lang";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "About",
  description: "How LLMLab.ee helps buyers choose AI-ready computers for local LLM inference, fine-tuning, and AI development workloads.",
  path: "/about",
});

export default async function AboutPage() {
  const lang = await getRequestLanguage();
  const copy = {
    title: lang === "et" ? "Meist" : "About LLMLab.ee",
    intro:
      lang === "et"
        ? "LLMLab.ee aitab valida ja tellida arvuteid kohalike suurte keelemudelite ehk LLM-ide käitamiseks. Mänguriarvutite üldiste soovituste asemel valime komponendid VRAM-i, mälu, ühilduvuse ja jahutuse järgi — selle põhjal, milliseid mudeleid soovid päriselt kasutada."
        : "LLMLab.ee is an AI-first PC build planner for people who want to run large language models locally. Instead of adapting gaming recommendations, it selects components based on VRAM, memory, compatibility, and cooling matched to the model sizes you actually intend to run.",
    solvesTitle: lang === "et" ? "Mida see lahendab" : "What It Solves",
    solvesItems:
      lang === "et"
        ? [
            "Seob tehisaru kasutuseesmärgid praktiliste riistvarakombinatsioonidega.",
            "Näitab iga profiili all mitu arvutikomplekti koos hinnangulise eelarvega.",
            "Toob ühilduvuse ja uuendustee küsimused planeerimisse varakult.",
            "Aitab vältida liiga nõrku masinaid LLM-ide käitamiseks ja peenhäälestuseks.",
          ]
        : [
            "Matches AI workload goals to practical hardware combinations.",
            "Shows multiple build options per profile with estimated budgets.",
            "Surfaces compatibility and upgrade path decisions early in planning.",
            "Helps avoid under-specced machines for LLM inference and fine-tuning.",
          ],
    recommendationTitle: lang === "et" ? "Kuidas soovitused töötavad" : "How Recommendations Work",
    recommendationItems:
      lang === "et"
        ? [
            "Komponendid on valitud tehisaru töökoormuste jaoks, mitte laenatud mängurisoovitustest.",
            "Komplektid on grupeeritud kasutusviisi järgi — kohalik mudelite käitamine, peenhäälestus või hübriidkasutus.",
            "Iga komplekt näitab, milliseid mudelisuurusi see toetab ja mida võid realistlikult oodata.",
            "Näed täielikku CPU/GPU paari, nii et midagi ei tule üllatusena.",
          ]
        : [
            "Parts are curated for AI workloads, not repurposed gaming specs.",
            "Builds are grouped by use case — local inference, fine-tuning, or hybrid.",
            "Each build shows which model sizes it supports and what you can realistically expect to run.",
            "You see the full component pairing so nothing comes as a surprise.",
          ],
    processTitle: lang === "et" ? "Kuidas protsess töötab" : "How The Process Works",
    processDescription:
      lang === "et"
        ? "Kui tellimus liigub edasi, kontrollin Eesti turult sinu valitud komplekti jaoks sobivate komponentide saadavust ja hinda, kinnitan võimalikud asendused enne jätkamist ning panen süsteemi kokku koos vajaliku tarkvara seadistusega."
        : "When an order proceeds, I check availability and pricing for compatible parts from Estonian retailers, confirm any practical substitutions before continuing, and assemble the system with the needed software setup.",
  };

  return (
    <main className="min-h-screen px-6 py-16 md:px-12">
      <section className="mx-auto max-w-6xl">
        <Masthead lang={lang} />
        <header className="mb-14 stagger-in" style={{ animationDelay: "80ms" }}>
          <PageNav links={[{ href: "/", label: lang === "et" ? "Avaleht" : "Home" }, { href: "/faq", label: "FAQ" }]} lang={lang} />
          <h1 className="font-display mt-6 text-4xl font-semibold tracking-tight md:text-6xl">{copy.title}</h1>
          <p className="mt-6 max-w-2xl text-lg text-[color:var(--muted)]">{copy.intro}</p>
        </header>

        <div className="grid gap-8 md:grid-cols-2 stagger-in" style={{ animationDelay: "200ms" }}>
          <section className="wireframe-panel p-8">
            <h2 className="font-display text-2xl font-semibold">{copy.solvesTitle}</h2>
            <ul className="arrow-list mt-6 space-y-3 text-sm text-[color:var(--muted)]">
              {copy.solvesItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>

          <section className="wireframe-panel p-8">
            <h2 className="font-display text-2xl font-semibold">{copy.recommendationTitle}</h2>
            <ul className="arrow-list mt-6 space-y-3 text-sm text-[color:var(--muted)]">
              {copy.recommendationItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        </div>

        <section className="wireframe-panel mt-8 p-8 stagger-in" style={{ animationDelay: "320ms" }}>
          <h2 className="font-display text-2xl font-semibold">{copy.processTitle}</h2>
          <p className="mt-4 max-w-2xl text-[color:var(--muted)]">{copy.processDescription}</p>
          <div className="mt-8 flex flex-wrap gap-4">
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-full bg-[color:var(--accent)] px-6 py-3 text-sm font-semibold text-white"
              style={{ boxShadow: "0 0 24px color-mix(in srgb, var(--accent) 45%, transparent)" }}
            >
              {lang === "et" ? "Sirvi komplekte" : "Browse builds"} →
            </Link>
            <Link href="/faq" className="label-pill inline-flex items-center px-5 py-2.5 text-sm">
              {lang === "et" ? "Loe KKK-d" : "Read the FAQ"}
            </Link>
          </div>
        </section>

        <div className="mt-8">
          <AssemblyQaChecklist lang={lang} />
        </div>

        <div className="mt-8">
          <TrustLinksSection lang={lang} />
        </div>
      </section>
    </main>
  );
}
