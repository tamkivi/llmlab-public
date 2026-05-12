import type { OrderStatus } from "@/lib/db";
import { orderTimeline, type OrderUxLanguage } from "@/lib/order-ux";

function stepClass(state: string): string {
  if (state === "complete") return "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (state === "current") return "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  if (state === "blocked") return "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300";
  return "border-[color:var(--panel-border)] bg-[color:var(--panel)] text-[color:var(--muted)]";
}

export function OrderTimeline({
  status,
  lang,
  compact = false,
}: {
  status: OrderStatus | "UNKNOWN";
  lang: OrderUxLanguage;
  compact?: boolean;
}) {
  const steps = orderTimeline(status, lang);

  return (
    <ol className={compact ? "mt-3 grid gap-2 sm:grid-cols-3" : "mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3"}>
      {steps.map((step, index) => (
        <li
          key={step.label}
          className={`rounded-md border px-3 py-2 text-xs font-semibold ${stepClass(step.state)}`}
        >
          <span className="text-[color:var(--muted)]">{index + 1}.</span> {step.label}
        </li>
      ))}
    </ol>
  );
}
