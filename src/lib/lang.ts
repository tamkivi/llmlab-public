export const LANGUAGE_COOKIE_NAME = "fp_lang";

export type SiteLanguage = "en" | "et";

export function normalizeLanguage(value: string | null | undefined): SiteLanguage {
  return value === "et" ? "et" : "en";
}
