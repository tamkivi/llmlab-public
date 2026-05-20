import { LegalInfoPage } from "@/components/legal-info-page";
import { getRequestLanguage } from "@/lib/server/lang";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Terms",
  description: "Practical ordering terms for LLMLab.ee AI workstation buyers.",
  path: "/terms",
});

export default async function TermsPage() {
  const lang = await getRequestLanguage();
  const copy = lang === "et"
    ? {
        title: "Tingimused",
        intro: "Siin on lühike ülevaade sellest, kuidas LLMLab.ee tellimusi käsitleb ja millist infot ostja enne maksmist näeb.",
        sections: [
          { title: "Tellimuse alus", body: ["Otsekassa tellimus põhineb maksmise hetkel näidatud komplektil, hinnal ja saadavuse eeldusel.", "Pakkumispõhised tooted vaadatakse enne makset käsitsi üle."] },
          { title: "Hind ja saadavus", body: ["Komponendihinnad võivad muutuda. Kui tellimuse täitmiseks on vaja asendust, kinnitatakse see ostjaga enne jätkamist.", "Kui tellimust ei saa mõistlikult täita, pakutakse tühistamist või muud kokkulepitud lahendust."] },
          { title: "Maksed", body: ["Kaardimakseid töötleb Stripe. LLMLab.ee ei salvesta kaardiandmeid.", "Tellimuse töötlus algab pärast makse kinnitamist ja vajaliku kontaktinfo olemasolu."] },
        ],
      }
    : {
        title: "Terms",
        intro: "A short practical overview of how LLMLab.ee handles orders and what buyers can expect before payment.",
        sections: [
          { title: "Order basis", body: ["A direct checkout order is based on the build, price, and availability assumptions shown at payment time.", "Quote-only products are reviewed manually before any payment is requested."] },
          { title: "Price and availability", body: ["Component prices can change. If an order needs a practical substitution, the buyer is contacted before continuing.", "If an order cannot reasonably be fulfilled, cancellation or another agreed solution will be offered."] },
          { title: "Payments", body: ["Card payments are processed by Stripe. LLMLab.ee does not store card details.", "Order handling starts after payment is confirmed and required contact information is available."] },
        ],
      };

  return <LegalInfoPage lang={lang} {...copy} />;
}
