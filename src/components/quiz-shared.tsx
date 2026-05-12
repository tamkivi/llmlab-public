import { type ReactNode } from "react"

export function QuizProgressBar({ total, progress, className, barClassName }: {
  total: number
  progress: number
  className?: string
  barClassName?: string
}) {
  return (
    <div className={["flex items-center gap-2", className].filter(Boolean).join(" ")}>
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={["flex-1 rounded-full transition-colors duration-300", barClassName ?? "h-1.5"].join(" ")}
          style={{
            background: i < progress
              ? "var(--accent)"
              : "color-mix(in srgb, var(--panel-border) 80%, transparent)",
          }}
        />
      ))}
    </div>
  )
}

export function QuizOptionButton({ children, onClick, className }: {
  children: ReactNode
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left inner-card rounded-lg border border-[color:var(--panel-border)] px-4 ${className ?? "py-3"} text-sm text-[color:var(--foreground)] transition-colors hover:border-[color:var(--accent)] cursor-pointer`}
    >
      {children}
    </button>
  )
}

export function QuizBackButton({ onClick, isEt }: {
  onClick: () => void
  isEt: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-5 label-pill cursor-pointer text-xs"
    >
      ← {isEt ? "Tagasi" : "Back"}
    </button>
  )
}

export function QuizResultCard({ children }: {
  children: ReactNode
}) {
  return (
    <div
      className="inner-card rounded-xl border border-[color:var(--accent)] p-6"
      style={{ boxShadow: "0 0 0 1px color-mix(in srgb, var(--accent) 30%, transparent)" }}
    >
      {children}
    </div>
  )
}

export function QuizResultHeader({ label, onReset, resetLabel }: {
  label: string
  onReset: () => void
  resetLabel: string
}) {
  return (
    <div className="mb-6 flex items-center justify-between gap-4">
      <p className="category-tag">{label}</p>
      <button
        type="button"
        onClick={onReset}
        className="label-pill cursor-pointer text-xs"
      >
        {resetLabel}
      </button>
    </div>
  )
}

export function QuizStepCounter({ current, total, isEt }: {
  current: number
  total: number
  isEt: boolean
}) {
  return (
    <p className="mb-1 text-xs text-[color:var(--muted)] font-mono">
      {isEt ? `Küsimus ${current} / ${total}` : `Question ${current} of ${total}`}
    </p>
  )
}
