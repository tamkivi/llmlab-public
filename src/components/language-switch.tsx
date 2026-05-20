import { type SiteLanguage } from "@/lib/lang";

type LanguageSwitchProps = {
  lang: SiteLanguage;
};

export function LanguageSwitch({ lang }: LanguageSwitchProps) {
  return (
    <div
      className="inline-flex items-center gap-1 rounded-full border border-[color:var(--panel-border)] bg-[color:var(--panel)] p-1"
      aria-label="Language selection"
      title="Estonian UI is temporarily disabled while public pages are served from static cache."
    >
      <button
        type="button"
        className={`nav-pill ${lang === "en" ? "" : "opacity-70"}`}
        aria-pressed={lang === "en"}
        disabled
      >
        EN
      </button>
      <button
        type="button"
        className={`nav-pill ${lang === "et" ? "" : "opacity-40"}`}
        aria-pressed={lang === "et"}
        disabled
      >
        EE
      </button>
    </div>
  );
}
