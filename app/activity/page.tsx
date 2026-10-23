"use client"

import * as React from "react"
import { ArrowRight, ExternalLink } from "lucide-react"
import { ApiErrorBox } from "@/components/api-error"
import { HashLink, HelpBlock, Party, StatusBadge } from "@/components/transfer-bits"
import { Button } from "@/components/ui/button"
import { Badge, Card, CardHeader } from "@/components/ui/card"
import { Select } from "@/components/ui/input"
import { Empty, Mono, Table, TBody, THead } from "@/components/ui/table"
import { CHAINS } from "@/lib/chains"
import { api, type ActivityRow } from "@/lib/client"
import { ago, fmt } from "@/lib/utils"

/** Every transfer this app started (transfers.json) merged with GET /api/transfer, newest first, filtered by status. */
export default function ActivityPage() {
  const [rows, setRows] = React.useState<ActivityRow[] | null>(null)
  const [remoteError, setRemoteError] = React.useState<string | undefined>()
  const [filter, setFilter] = React.useState("all")
  const [error, setError] = React.useState<unknown>(null)
  const [busy, setBusy] = React.useState(false)

  const load = React.useCallback(async (refresh = false) => {
    setBusy(true)
    try { const r = await api<{ transfers: ActivityRow[]; remoteError?: string }>(`/api/activity${refresh ? "?refresh=1" : ""}`); setRows(r.transfers); setRemoteError(r.remoteError); setError(null) }
    catch (e) { setError(e) } finally { setBusy(false) }
  }, [])
  React.useEffect(() => { void load(true) }, [load])

  const statuses = [...new Set((rows ?? []).map((r) => r.status))].sort()
  const shown = (rows ?? []).filter((r) => filter === "all" || r.status === filter)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h1 className="text-lg font-semibold tracking-tight">Activity</h1>
        <p className="text-muted-foreground text-xs">Every transfer this app started, merged with the API&apos;s record of your orders. Legs that have not ended are re-read on Refresh.</p>
      </div>
      <ApiErrorBox error={error} />
      {remoteError && <p className="text-muted-foreground text-xs">Could not read GET /api/transfer: {remoteError}. Showing the local ledger only.</p>}
      <Card>
        <CardHeader
          title={`${shown.length} transfer${shown.length === 1 ? "" : "s"}`}
          actions={
            <>
              <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="h-8 w-44 text-xs">
                <option value="all">all statuses</option>
                {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
              <Button size="sm" variant="outline" onClick={() => load(true)} disabled={busy}>{busy ? "Refreshing…" : "Refresh"}</Button>
            </>
          }
        />
        {shown.length ? (
          <Table>
            <THead>
              <tr><th>When</th><th>From</th><th></th><th>To</th><th className="text-right">Amount</th><th className="text-right">Receive</th><th>Route</th><th>Status</th><th>Deposit</th><th>Payout</th><th>Receipt</th></tr>
            </THead>
            <TBody>
              {shown.map((r) => (
                <React.Fragment key={r.id}>
                  <tr>
                    <td className="text-muted-foreground whitespace-nowrap text-xs" title={new Date(r.createdAt).toLocaleString()}>{ago(r.createdAt)}{!r.mine && <Badge className="ml-1" title="created by another app on this key">other app</Badge>}</td>
                    <td><Party chain={r.from.chain} address={r.from.address} label={r.from.label} /></td>
                    <td><ArrowRight className="text-muted-foreground size-3.5" /></td>
                    <td><Party chain={r.to.chain} address={r.to.address} label={r.to.label} /></td>
                    <td className="text-right"><Mono>{fmt(r.amount)} {CHAINS[r.from.chain]?.native}</Mono></td>
                    <td className="text-right"><Mono>{r.expectedReceive === null || r.expectedReceive === undefined ? "—" : `${fmt(r.expectedReceive)} ${CHAINS[r.to.chain]?.native}`}</Mono></td>
                    <td className="text-xs whitespace-nowrap">{r.route}{r.mode ? ` · ${r.mode}` : ""}{r.venue ? ` · ${r.venue}` : ""}{r.venueHonoured === false && <Badge tone="warn" className="ml-1">venue not honoured</Badge>}</td>
                    <td><StatusBadge status={r.status} /></td>
                    <td><HashLink chain={r.from.chain} hash={r.depositHash} /></td>
                    <td><HashLink chain={r.to.chain} hash={r.payoutHash} /></td>
                    <td>{r.receipt ? <a href={r.receipt} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs underline-offset-2 hover:underline">receipt <ExternalLink className="size-3" /></a> : <span className="text-muted-foreground">—</span>}</td>
                  </tr>
                  {(r.help || r.error) && (
                    <tr className="border-t-0!"><td colSpan={11} className="pt-0!">
                      {r.error && !r.help && <p className="text-xs text-red-700 dark:text-red-300">{r.error}{r.code && <Mono className="ml-2">{r.code}</Mono>}</p>}
                      <HelpBlock help={r.help} />
                    </td></tr>
                  )}
                </React.Fragment>
              ))}
            </TBody>
          </Table>
        ) : <Empty>{rows ? "No transfers yet. Press Run on the Move page, or Fund / Gather on the Wallets page." : "Loading…"}</Empty>}
      </Card>
    </div>
  )
}
