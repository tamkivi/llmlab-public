import Link from "next/link";

export function Masthead({ lang }: { lang?: string }) {
  const subtitle = lang === "et" ? "Tehisaru tööjaamad Eestis" : "AI Workstations in Estonia";
  return (
    <div className="mb-7 flex flex-wrap items-center justify-between gap-2">
      <Link href="/" className="font-display text-3xl font-semibold tracking-tight">
        LLMLab.ee
      </Link>
      <p className="font-mono text-xs text-[color:var(--muted)]">{subtitle}</p>
    </div>
  );
}
