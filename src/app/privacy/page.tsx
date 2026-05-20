import { LegalInfoPage } from "@/components/legal-info-page";
import { getRequestLanguage } from "@/lib/server/lang";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Privacy",
  description: "Privacy overview for LLMLab.ee account, checkout, and support data.",
  path: "/privacy",
});

export default async function PrivacyPage() {
  const lang = await getRequestLanguage();
  const copy = lang === "et"
    ? {
        title: "Privaatsus",
        intro: "LLMLab.ee kogub ainult tellimuse, konto ja klienditoe jaoks vajalikku infot.",
        sections: [
          { title: "Kogutavad andmed", body: ["Konto loomiseks salvestatakse e-post ja parooli räsi. Tellimuse jaoks salvestatakse valitud toode, hind, Stripe'i makseviited ja tellimuse olek.", "Pakkumise küsimisel salvestatakse nimi, e-post, valitud toode ja ostja lisainfo."] },
          { title: "Makseandmed", body: ["Kaardiandmeid töötleb Stripe. LLMLab.ee hoiab ainult Stripe'i sessiooni või makse viiteid, mis on vajalikud tellimuse kinnitamiseks ja tõrgete lahendamiseks."] },
          { title: "Ligipääs ja kustutamine", body: ["Andmeid kasutatakse tellimuse täitmiseks, kliendisuhtluseks, turvalisuseks ja operatiivseks diagnostikaks.", "Andmetega seotud küsimuste või kustutamistaotluste jaoks kasuta kontaktilehte."] },
        ],
      }
    : {
        title: "Privacy",
        intro: "LLMLab.ee collects only the information needed for accounts, orders, checkout, and customer support.",
        sections: [
          { title: "Data collected", body: ["Account creation stores an email address and password hash. Orders store the selected item, price, Stripe payment references, and order status.", "Quote requests store the buyer name, email, selected product, and buyer-provided notes."] },
          { title: "Payment data", body: ["Card details are processed by Stripe. LLMLab.ee stores only Stripe session or payment references needed to confirm orders and resolve failures."] },
          { title: "Access and deletion", body: ["Data is used for order handling, customer communication, security, and operational diagnostics.", "For data questions or deletion requests, use the contact page."] },
        ],
      };

  return <LegalInfoPage lang={lang} {...copy} />;
}
