import * as React from "react"
import { cn } from "@/lib/utils"

export function Card({ className, ...props }: React.ComponentProps<"section">) {
  return <section data-slot="card" className={cn("bg-card text-card-foreground rounded-xl border", className)} {...props} />
}

export function CardHeader({ title, description, actions, className }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <header className={cn("flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3", className)}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {description && <p className="text-muted-foreground mt-0.5 text-xs">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

export function CardBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("px-4 py-3", className)} {...props} />
}

export function Badge({ className, tone = "muted", ...props }: React.ComponentProps<"span"> & { tone?: "muted" | "ok" | "warn" | "bad" | "info" }) {
  const tones = {
    muted: "bg-muted text-muted-foreground",
    ok: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    warn: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    bad: "bg-red-500/15 text-red-700 dark:text-red-300",
    info: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  }
  return <span className={cn("inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium whitespace-nowrap", tones[tone], className)} {...props} />
}

/** A chain mark: SOL · RH · ETH · BNB. */
export function ChainMark({ chain, className }: { chain: string; className?: string }) {
  const marks: Record<string, string> = { sol: "SOL", rh: "RH", eth: "ETH", bnb: "BNB" }
  return <span className={cn("bg-secondary text-secondary-foreground inline-flex h-5 min-w-9 items-center justify-center rounded px-1.5 font-mono text-[10px] font-semibold tracking-wide", className)}>{marks[chain] ?? chain.toUpperCase()}</span>
}

export const statusTone = (s: string): "muted" | "ok" | "warn" | "bad" | "info" =>
  ["completed", "confirmed"].includes(s) ? "ok" : ["failed", "expired", "refunded", "cancelled", "refused"].includes(s) ? "bad" : ["stuck"].includes(s) ? "warn" : ["planned"].includes(s) ? "muted" : "info"
