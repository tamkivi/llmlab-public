import { cookies } from "next/headers";
import { normalizeLanguage, type SiteLanguage, LANGUAGE_COOKIE_NAME } from "@/lib/lang";

export async function getRequestLanguage(): Promise<SiteLanguage> {
  const store = await cookies();
  return normalizeLanguage(store.get(LANGUAGE_COOKIE_NAME)?.value);
}
