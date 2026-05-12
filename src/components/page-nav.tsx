import Link from "next/link";
import { AuthPanel } from "@/components/auth-panel";
import { LanguageSwitch } from "@/components/language-switch";
import { ThemeToggle } from "@/components/theme-toggle";
import { type SiteLanguage } from "@/lib/lang";

type NavLink = { href: string; label: string };

export function PageNav({ links, lang }: { links: NavLink[]; lang?: SiteLanguage }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {links.map((link) => (
          <Link key={link.href} href={link.href} className="nav-pill inline-block">
            {link.label}
          </Link>
        ))}
        {lang !== undefined && <LanguageSwitch lang={lang} />}
      </div>
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <AuthPanel />
      </div>
    </div>
  );
}
