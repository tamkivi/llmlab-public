import type { SiteLanguage } from "@/lib/lang";

type PurchaseReassuranceProps = {
  lang?: SiteLanguage;
  mode?: "payment" | "quote";
  compact?: boolean;
};

export function PurchaseReassurance({ lang = "en", mode = "payment", compact = false }: PurchaseReassuranceProps) {
  const isEt = lang === "et";
  const items = mode === "quote"
    ? (isEt
      ? [
          "Vaatame üle kasutusjuhtumi, mudelid, ajakava ja eelarve.",
          "Kontrollime sobivad komponendid ning värsked Eesti turuhinnad.",
          "Saadame järgmise sammu või täpsustavad küsimused tavaliselt 1-2 tööpäeva jooksul.",
        ]
      : [
          "We review your use case, model targets, timeline, and budget.",
          "We verify suitable parts and current Estonian market pricing.",
          "We usually send the next step or follow-up questions within 1-2 business days.",
        ])
    : (isEt
      ? [
          "Saad tellimuse kinnituse e-postiga.",
          "Kontrollime komponentide saadavuse enne kokkupanekut.",
          "Plaanitud töövoog on osade tellimine, kokkupanek ja põhikontroll enne üleandmist.",
          "Kui mõni osa võib vajada asendust, võtame enne muudatust ühendust.",
        ]
      : [
          "You receive an order confirmation email.",
          "We verify component availability before assembly.",
          "The planned workflow is parts sourcing, assembly, and baseline checks before handover.",
          "If a part may need substitution, we contact you before changing it.",
        ]);

  return (
    <div className={`${compact ? "mt-4" : "mt-6"} hardware-rule pt-4`}>
      <p className="text-sm font-semibold">
        {mode === "quote"
          ? (isEt ? "Mis juhtub pärast päringut" : "What happens after your quote request")
          : (isEt ? "Mis juhtub pärast makset" : "What happens after payment")}
      </p>
      <ul className="arrow-list mt-3 space-y-1 text-xs leading-5 text-[color:var(--muted)]">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-[color:var(--muted)]">
        {isEt
          ? "Tugi ja küsimused liiguvad tellimuse või pakkumise e-posti kaudu."
          : "Support and questions continue through the order or quote email thread."}
      </p>
    </div>
  );
}
