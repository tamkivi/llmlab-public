import type { SiteLanguage } from "@/lib/lang";

export function BuyerTrustSection({ lang = "en", compact = false }: { lang?: SiteLanguage; compact?: boolean }) {
  const isEt = lang === "et";
  const items = isEt ? [
    ["Pärast makset", "Saad kinnituse e-postiga. Seejärel kontrollime komponentide saadavust ja anname teada, kui mõni osa võib vajada asendust."],
    ["Kokkupanek ja testimine", "Plaanitud töövoog on kokkupanek, tarkvara seadistus ning GPU/AI põhikontroll enne üleandmist."],
    ["Üleandmine Eestis", "Üleandmise või kohaletoimetamise viis ja ajakava lepitakse kokku pärast saadavuse kontrolli."],
    ["Garantii ja tugi", "Garantii käsitlus sõltub komponendist, tootjast ja müüjast. Küsimused liiguvad tellimuse või pakkumise e-posti lõimes."],
  ] : [
    ["After payment", "You receive a confirmation email. We then check part availability and contact you if any component may need a practical substitution."],
    ["Assembly and testing", "The planned workflow is assembly, software setup, and baseline GPU/AI checks before handover."],
    ["Handover in Estonia", "Pickup or local delivery method and timing are agreed after availability is checked."],
    ["Warranty and support", "Warranty handling depends on the component, manufacturer, and retailer. Support questions continue through the order or quote email thread."],
  ];

  return (
    <section className={`wireframe-panel ${compact ? "p-6" : "p-6 md:p-8"}`}>
      <p className="label-pill inline-block">{isEt ? "Usaldus ja protsess" : "Trust and process"}</p>
      <h2 className="font-display mt-4 text-2xl font-semibold md:text-3xl">
        {isEt ? "Mis juhtub pärast tellimist või pakkumise päringut" : "What happens after an order or quote request"}
      </h2>
      <div className="mt-5 grid gap-3 md:grid-cols-4">
        {items.map(([title, body]) => (
          <article key={title} className="inner-card p-4">
            <p className="text-sm font-semibold">{title}</p>
            <p className="mt-2 text-xs leading-5 text-[color:var(--muted)]">{body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
