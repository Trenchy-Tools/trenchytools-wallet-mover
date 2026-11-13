"use client"

/**
 * History: every transfer this app made (and every transfer the API has for this key), newest first, with where it
 * stands. GET /api/activity (refresh=1 asks the API for fresh statuses).
 */
import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { ArrowRight, ExternalLink, Loader2, RefreshCw } from "lucide-react"
import { get, failureOf } from "@/lib/api"
import { CHAINS, type ChainId } from "@/lib/chains"
import { cn } from "@/lib/cn"
import { ago, short } from "@/lib/client"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Pill } from "@/components/ui/pill"
import { BrandIcon } from "@/components/ui/brand"
import { toastFailure } from "@/components/ui/toast"

type Rec = {
  id: string; createdAt: number; from: { chain: ChainId; address: string; label?: string }; to: { chain: ChainId; address: string; label?: string }
  amount: number; expectedReceive: number | null; route: "direct" | "exchange"; status: string; depositHash: string | null; payoutHash: string | null; error?: string; receipt?: string
}
const DONE = new Set(["completed", "confirmed"])
const BAD = new Set(["failed", "expired", "refunded", "cancelled", "refused", "stuck"])
const WORDS: Record<string, string> = { completed: "arrived", confirmed: "arrived", awaiting_deposit: "waiting for the deposit", exchanging: "exchanging", sent: "sent", created: "starting", planned: "starting", failed: "failed", expired: "expired", refunded: "refunded", cancelled: "cancelled", refused: "refused", stuck: "stuck" }
const fmt = (n: number | null | undefined, chain: ChainId) => (n === null || n === undefined ? "–" : `${+n.toFixed(n < 1 ? 5 : 4)} ${CHAINS[chain]?.native ?? ""}`)

export default function HistoryPage() {
  const [rows, setRows] = useState<Rec[] | null>(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(async (refresh = false) => {
    setBusy(true)
    try { setRows((await get<{ transfers: Rec[] }>(`/api/activity${refresh ? "?refresh=1" : ""}`)).transfers.sort((a, b) => b.createdAt - a.createdAt)) }
    catch (e) { toastFailure(failureOf(e)) } finally { setBusy(false) }
  }, [])
  useEffect(() => { void load(true) }, [load])

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
      <div className="flex items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">History</h1>
          <p className="text-muted-foreground text-sm">Every move, newest first.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load(true)} disabled={busy}>{busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}Refresh</Button>
      </div>
      <Card className="gap-0 p-0">
        {!rows ? <div className="text-muted-foreground flex items-center gap-2 p-4 text-sm"><Loader2 className="size-4 animate-spin" /> Loading…</div>
          : !rows.length ? <div className="text-muted-foreground p-6 text-center text-sm">Nothing moved yet. <Link href="/move" className="underline underline-offset-4">Make your first move</Link>.</div>
          : rows.map((r) => {
            const tone = DONE.has(r.status) ? "ok" : BAD.has(r.status) ? "error" : "muted"
            const fc = CHAINS[r.from.chain], tc = CHAINS[r.to.chain]
            return (
              <div key={r.id} className="flex flex-col gap-1 border-b px-4 py-3 text-sm last:border-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 font-medium">{fc && <BrandIcon src={fc.logo} label={fc.name} size={14} />}{fmt(r.amount, r.from.chain)}</span>
                  <ArrowRight className="text-muted-foreground size-3.5" />
                  <span className="inline-flex items-center gap-1.5">{tc && <BrandIcon src={tc.logo} label={tc.name} size={14} />}{r.expectedReceive ? `≈ ${fmt(r.expectedReceive, r.to.chain)}` : tc?.name}</span>
                  <Pill tone={tone} className="ml-auto">{WORDS[r.status] ?? r.status}</Pill>
                </div>
                <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <span>{r.from.label ?? short(r.from.address)} → {r.to.label ?? short(r.to.address)}</span>
                  <span>{r.route === "direct" ? "direct" : "through an exchange"}</span>
                  <span>{ago(r.createdAt)} ago</span>
                  {r.depositHash && fc && <a className="hover:text-foreground inline-flex items-center gap-1" href={`${fc.explorerTx}${r.depositHash}`} target="_blank" rel="noreferrer">sent <ExternalLink className="size-3" /></a>}
                  {r.payoutHash && tc && <a className="hover:text-foreground inline-flex items-center gap-1" href={`${tc.explorerTx}${r.payoutHash}`} target="_blank" rel="noreferrer">arrived <ExternalLink className="size-3" /></a>}
                </div>
                {(r.error || (r.receipt && !DONE.has(r.status))) && <p className={cn("text-xs", r.error ? "text-destructive" : "text-muted-foreground")}>{r.error ?? r.receipt}</p>}
              </div>
            )
          })}
      </Card>
    </div>
  )
}
