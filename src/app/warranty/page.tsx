import { LegalInfoPage } from "@/components/legal-info-page";
import { getRequestLanguage } from "@/lib/server/lang";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Warranty",
  description: "Warranty and support overview for LLMLab.ee AI workstation orders.",
  path: "/warranty",
});

export default async function WarrantyPage() {
  const lang = await getRequestLanguage();
  const copy = lang === "et"
    ? {
        title: "Garantii ja tugi",
        intro: "LLMLab.ee süsteemid põhinevad tavapärastel arvutikomponentidel ja praktilisel tellimusejärgsel toel.",
        sections: [
          { title: "Komponentide garantii", body: ["Komponentidele kehtivad tootja või jaemüüja garantiitingimused. Tellimuse dokumentatsioon säilitatakse, et vajadusel garantiijuhtumit lihtsamalt lahendada."] },
          { title: "Koostekvaliteet", body: ["Enne üleandmist kontrollitakse süsteemi põhilist stabiilsust, jahutust ja tarkvara valmisolekut kokkulepitud kasutuseks.", "Kui probleem ilmneb pärast üleandmist, võta ühendust kirjelduse ja võimalike veateadetega."] },
          { title: "Tarkvara", body: ["Kohaliku AI tarkvara ökosüsteem muutub kiiresti. Tarkvara seadistus antakse üle heas usus toimiva algseisuna, kuid mudelite ja tööriistade hilisemad muudatused võivad vajada uuendamist."] },
        ],
      }
    : {
        title: "Warranty and Support",
        intro: "LLMLab.ee systems use standard PC components and practical post-order support.",
        sections: [
          { title: "Component warranty", body: ["Components are covered by the applicable manufacturer or retailer warranty terms. Order documentation is retained so warranty cases can be handled more easily when needed."] },
          { title: "Assembly quality", body: ["Before handover, the system is checked for basic stability, cooling, and software readiness for the agreed use case.", "If a problem appears after handover, contact LLMLab.ee with a description and any relevant error messages."] },
          { title: "Software", body: ["The local AI software ecosystem changes quickly. Software setup is delivered as a working starting point in good faith, but later model and tool changes may require updates."] },
        ],
      };

  return <LegalInfoPage lang={lang} {...copy} />;
}
