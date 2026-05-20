export const LANGUAGE_COOKIE_NAME = "fp_lang";
export const DEFAULT_SITE_LANGUAGE: SiteLanguage = "en";

export type SiteLanguage = "en" | "et";

export function normalizeLanguage(value: string | null | undefined): SiteLanguage {
  return value === "et" ? "et" : "en";
}
