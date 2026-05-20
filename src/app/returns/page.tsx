import { LegalInfoPage } from "@/components/legal-info-page";
import { getRequestLanguage } from "@/lib/server/lang";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Returns and Cancellations",
  description: "Returns and cancellation overview for LLMLab.ee AI workstation orders.",
  path: "/returns",
});

export default async function ReturnsPage() {
  const lang = await getRequestLanguage();
  const copy = lang === "et"
    ? {
        title: "Tagastused ja tühistamised",
        intro: "Praktiline ülevaade sellest, kuidas tühistusi ja võimalikke tagastusi käsitletakse.",
        sections: [
          { title: "Enne töö algust", body: ["Kui tellimuse töötlus ei ole veel alanud, võta kiiresti ühendust, et tühistamise võimalus üle vaadata.", "Kui komponentide saadavus või hind muutub oluliselt, kinnitatakse järgmine samm ostjaga."] },
          { title: "Pärast komplekteerimist", body: ["Eritellimusena komplekteeritud ja seadistatud süsteemide puhul võib tagastamise käsitlus sõltuda tellimuse seisust, kasutatud komponentidest ja seadusest tulenevatest õigustest.", "Täpne lahendus kinnitatakse juhtumipõhiselt."] },
          { title: "Ebaõnnestunud maksed", body: ["Kui makse ei õnnestu, tellimust tasutuks ei märgita. Kui seisund tundub ebaselge, võta ühendust ja tellimust saab Stripe'i andmetega kontrollida."] },
        ],
      }
    : {
        title: "Returns and Cancellations",
        intro: "A practical overview of how cancellations and possible returns are handled.",
        sections: [
          { title: "Before work starts", body: ["If order handling has not started yet, contact LLMLab.ee quickly so cancellation can be reviewed.", "If component availability or pricing changes materially, the next step is confirmed with the buyer."] },
          { title: "After assembly", body: ["For custom assembled and configured systems, return handling may depend on order state, used components, and statutory rights.", "The exact solution is confirmed case by case."] },
          { title: "Failed payments", body: ["If payment fails, the order is not marked as paid. If the state looks unclear, contact LLMLab.ee and the order can be checked against Stripe records."] },
        ],
      };

  return <LegalInfoPage lang={lang} {...copy} />;
}
