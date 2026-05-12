import type { SiteLanguage } from "@/lib/lang";

export function TrustLinksSection({ lang = "en", compact = false }: { lang?: SiteLanguage; compact?: boolean }) {
  const isEt = lang === "et";
  const items = isEt
    ? [
        ["Kontakt ja tugi", "Vastame tellimuse või pakkumise e-posti lõimes. Kiireim tee on vastata saadud kinnitusele."],
        ["Garantii", "Garantiikäsitlus sõltub komponendist, tootjast ja müüjast; kinnitame praktilise tee juhtumipõhiselt."],
        ["Üleandmine Eestis", "Üleandmise või kohaletoimetamise viis ja ajakava lepitakse kokku pärast saadavuse kontrolli."],
        ["Tühistamine ja muudatused", "Kuni ametlike tingimuste avaldamiseni käsitleme tühistusi ja muudatusi juhtumipõhiselt ning kinnitame muudatused enne jätkamist."],
        ["Makse turvalisus", "Kaardiandmed sisestatakse Stripe'i kassas. LLMLab.ee ei kogu ega salvesta täielikke kaardinumbreid."],
        ["Hinna meetod", "Kuvame Eesti turu keskmist enne kokkupanekut ning tellimuse hinda koos 15% kokkupaneku ja seadistuse juurdehindlusega."],
      ]
    : [
        ["Contact and support", "Questions continue through the order or quote email thread. Replying to the confirmation is the fastest path."],
        ["Warranty", "Warranty handling depends on the component, manufacturer, and retailer; the practical path is confirmed case by case."],
        ["Handover in Estonia", "Pickup or local delivery method and timing are agreed after availability is checked."],
        ["Cancellations and changes", "Until formal terms are published, cancellations and changes are handled case by case, and order changes are confirmed before continuing."],
        ["Payment security", "Card details are entered in Stripe checkout. LLMLab.ee does not collect or store full card numbers."],
        ["Pricing method", "We show the Estonian market average before assembly and the order price with the 15% assembly and configuration markup."],
      ];

  return (
    <section className={`wireframe-panel ${compact ? "p-5" : "p-6 md:p-8"}`}>
      <p className="label-pill inline-block">{isEt ? "Usaldus" : "Trust details"}</p>
      <h2 className="font-display mt-4 text-2xl font-semibold md:text-3xl">
        {isEt ? "Oluline enne tellimist" : "Important before ordering"}
      </h2>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
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
