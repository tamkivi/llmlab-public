import type { SiteLanguage } from "@/lib/lang";

export function AssemblyQaChecklist({ lang = "en", compact = false }: { lang?: SiteLanguage; compact?: boolean }) {
  const isEt = lang === "et";
  const checks = isEt
    ? [
        "BIOS-i ja püsivara põhikontroll",
        "Draiverite ja AI tööriistade paigaldus",
        "Temperatuuri ja koormuse kontroll",
        "Mälu ja salvestusseadme tervisekontroll",
        "Kohaliku AI töövoo suitsutest, kui see konfiguratsioonile sobib",
      ]
    : [
        "BIOS and firmware baseline check",
        "Driver and AI tooling installation",
        "Thermal and load sanity check",
        "Memory and storage health check",
        "Local AI smoke test where applicable",
      ];

  return (
    <section className={`wireframe-panel ${compact ? "p-5" : "p-6 md:p-8"}`}>
      <p className="label-pill inline-block">{isEt ? "Kvaliteedikontroll" : "Assembly QA"}</p>
      <h2 className="font-display mt-4 text-2xl font-semibold md:text-3xl">
        {isEt ? "Plaanitud põhikontroll enne üleandmist" : "Planned baseline checks before handover"}
      </h2>
      <ul className="arrow-list mt-5 grid gap-2 text-sm text-[color:var(--muted)] md:grid-cols-2">
        {checks.map((check) => (
          <li key={check}>{check}</li>
        ))}
      </ul>
    </section>
  );
}
