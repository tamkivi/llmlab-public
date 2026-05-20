import { LegalInfoPage } from "@/components/legal-info-page";
import { getRequestLanguage } from "@/lib/server/lang";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Contact",
  description: "Contact and business identity information for LLMLab.ee.",
  path: "/contact",
});

export default async function ContactPage() {
  const lang = await getRequestLanguage();
  const copy = lang === "et"
    ? {
        title: "Kontakt ja ettevõtte info",
        intro: "Kasuta seda lehte tellimuse, pakkumise, toe või andmekaitse küsimuste jaoks.",
        sections: [
          { title: "Kontakt", body: ["E-post: hello@llmlab.ee", "Tellimuse või makse küsimuse puhul lisa tellimuse number, kui see on olemas."] },
          { title: "Ettevõtte info", body: ["Avalik ettevõtte nimi, registrikood, käibemaksuinfo ja aadress tuleb enne avalikku lansseerimist lõplikult kinnitada ja siin avaldada.", "Seni ei tohiks seda lehte käsitleda lõpliku juriidilise identiteedi lehena."] },
          { title: "Tööaeg", body: ["Vastamine toimub esimesel võimalusel. Kiirete makse- või tellimusseisundi probleemide korral märgi teema e-kirjas selgelt."] },
        ],
      }
    : {
        title: "Contact and Business Identity",
        intro: "Use this page for order, quote, support, or privacy questions.",
        sections: [
          { title: "Contact", body: ["Email: hello@llmlab.ee", "For order or payment questions, include the order number if you have one."] },
          { title: "Business identity", body: ["The public company name, registry code, VAT information, and address should be confirmed and published here before public launch.", "Until then, this page should not be treated as the final legal identity page."] },
          { title: "Response time", body: ["Replies are handled as soon as practical. For urgent payment or order-state issues, make that clear in the email subject."] },
        ],
      };

  return <LegalInfoPage lang={lang} {...copy} />;
}
