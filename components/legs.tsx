"use client"

import * as React from "react"
import { ArrowRight, Check, ExternalLink, Loader2, Minus, TriangleAlert, X } from "lucide-react"
import { HashLink, HelpBlock } from "./transfer-bits"
import { Button } from "./ui/button"
import { Badge, ChainMark } from "./ui/card"
import { Mono } from "./ui/table"
import { CHAINS, shortAddress } from "@/lib/chains"
import { api, type PublicJob } from "@/lib/client"
import { cn, fmt } from "@/lib/utils"

const OK = new Set(["completed", "confirmed"])
const BAD = new Set(["failed", "expired", "refunded", "cancelled", "refused"])
export const jobRunning = (job: PublicJob | null | undefined) => !!job && (job.status === "preflight" || job.status === "running")

/** Follow a job (GET /api/move/run/:id every 1.5 s) until it is done or failed. */
export function useJobPolling(job: PublicJob | null, setJob: (j: PublicJob) => void, onTick?: () => void) {
  const running = jobRunning(job)
  React.useEffect(() => {
    if (!job || !running) return
    const t = setInterval(async () => {
      const r = await api<{ job: PublicJob }>(`/api/move/run/${job.id}`).catch(() => null)
      if (r) setJob(r.job)
      onTick?.()
    }, 1500)
    return () => clearInterval(t)
  }, [job, running, setJob, onTick])
}

function Icon({ status }: { status: string }) {
  if (OK.has(status)) return <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
  if (BAD.has(status)) return <X className="size-3.5 text-red-600 dark:text-red-400" />
  if (status === "stuck") return <TriangleAlert className="size-3.5 text-amber-600 dark:text-amber-400" />
  if (status === "planned") return <Minus className="text-muted-foreground size-3.5" />
  return <Loader2 className="text-muted-foreground size-3.5 animate-spin" />
}

/**
 * What the run is doing, leg by leg: one line each with live status, hashes and the receipt link. Every leg is its own
 * transaction, so a run that stops half way has really moved the legs marked done and really not moved the rest.
 */
export function JobLegs({ job, onClear, compact }: { job: PublicJob; onClear?: () => void; compact?: boolean }) {
  const running = jobRunning(job)
  const done = job.legs.filter((l) => OK.has(l.status)).length
  const failed = job.legs.filter((l) => BAD.has(l.status) || l.status === "stuck").length
  const preflightStop = job.status === "failed" && job.legs.every((l) => l.status === "planned")
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="font-medium">{running ? (job.status === "preflight" ? "Checking balances…" : "Running") : preflightStop ? "Stopped before sending" : failed ? "Finished with failures" : "Finished"}</span>
        <span className="text-muted-foreground text-xs">{done} of {job.legs.length} landed{failed ? ` · ${failed} did not` : ""}{job.legs.length - done - failed > 0 && !running ? ` · ${job.legs.length - done - failed} not attempted` : ""}</span>
        {job.relay && <span className="text-muted-foreground text-xs">relay <ChainMark chain={job.relay.chain} /> <Mono>{shortAddress(job.relay.publicKey)}</Mono> · <Mono>{job.relay.file}</Mono></span>}
        {onClear && !running && <Button size="xs" variant="outline" className="ml-auto" onClick={onClear}>Clear</Button>}
      </div>
      {job.message && <p className={cn("text-xs", job.status === "failed" ? "text-red-700 dark:text-red-300" : "text-muted-foreground")}>{job.message}</p>}
      <ul className="divide-y rounded-md border text-sm">
        {job.legs.map((l) => (
          <li key={l.index} className={cn("flex flex-col gap-1 px-3 py-1.5", BAD.has(l.status) && "bg-red-500/5")}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Icon status={l.status} />
              <span className="text-muted-foreground w-5 text-xs">{l.phase === 2 ? "2·" : ""}{l.index + 1}</span>
              <ChainMark chain={l.from.chain} /><span className="truncate" title={l.from.address}>{l.from.label ?? shortAddress(l.from.address)}</span>
              <ArrowRight className="text-muted-foreground size-3.5" />
              {l.to.chain !== l.from.chain && <ChainMark chain={l.to.chain} />}<span className="truncate" title={l.to.address}>{l.to.label ?? shortAddress(l.to.address)}</span>
              <Mono className="text-muted-foreground">{l.amount > 0 ? `${fmt(l.amount)} ${CHAINS[l.from.chain].native}` : "pool cut"}</Mono>
              <Badge>{l.status.replace(/_/g, " ")}</Badge>
              {l.route === "exchange" && <Badge tone="info">{l.venueUsed ?? l.venue ?? "exchange"}{l.mode ? ` · ${l.mode}` : ""}</Badge>}
              {l.venueHonoured === false && <Badge tone="warn">venue not honoured</Badge>}
              {!compact && l.expectedReceive !== null && l.expectedReceive !== undefined && <span className="text-muted-foreground text-xs">≈ {fmt(l.expectedReceive)} {CHAINS[l.to.chain].native}</span>}
              <span className="ml-auto flex items-center gap-3 text-xs">
                {l.depositHash && <HashLink chain={l.from.chain} hash={l.depositHash} />}
                {l.payoutHash && l.payoutHash !== l.depositHash && <HashLink chain={l.to.chain} hash={l.payoutHash} />}
                {l.receipt && <a href={l.receipt} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline-offset-2 hover:underline">receipt <ExternalLink className="size-3" /></a>}
              </span>
            </div>
            {l.error && <p className="pl-7 text-xs text-red-700 dark:text-red-300">{l.error}{l.code && <Mono className="ml-2">{l.code}</Mono>}{l.hint && <span className="text-muted-foreground ml-2">{l.hint}</span>}{l.docs && <a href={l.docs} className="ml-2 underline" target="_blank" rel="noreferrer">docs</a>}</p>}
            {l.help && <div className="pl-7"><HelpBlock help={l.help} /></div>}
          </li>
        ))}
      </ul>
      {!compact && !!job.log.length && (
        <details className="text-xs">
          <summary className="text-muted-foreground cursor-pointer">log</summary>
          <pre className="text-muted-foreground mt-1 max-h-48 overflow-y-auto text-[11px] leading-5 whitespace-pre-wrap">{job.log.map((l) => `${new Date(l.t).toLocaleTimeString()}  ${l.msg}`).join("\n")}</pre>
        </details>
      )}
    </div>
  )
}
