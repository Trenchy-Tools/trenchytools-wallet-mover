"use client"

import * as React from "react"
import { ArrowRightLeft, ChevronDown, Shuffle } from "lucide-react"
import { Select } from "./ui/input"
import { MODES, type Mode } from "@/lib/chains"
import { api, type TransferVenues } from "@/lib/client"
import { cn } from "@/lib/utils"

export type RouteState = { route: "direct" | "exchange"; mode: Mode; venue: string }

const MODE_NOTE: Record<Mode, string> = { float: "market rate · fastest", fixed: "locked output · 0.8 %", private: "privacy-coin leg · 1 % · 5+ min" }

/**
 * How the money travels: Direct (we sign it, the two wallets are linked on chain) or Exchange (the exchange pays the
 * destination). Venue and mode sit inline next to Exchange; a closed venue stays listed, disabled, with its reason.
 * Cross-chain baskets force Exchange. Venue health lives in the small ▾ under the picker.
 */
export function RoutePicker({ value, onChange, crossChain, className }: { value: RouteState; onChange: (v: RouteState) => void; crossChain: boolean; className?: string }) {
  const [venues, setVenues] = React.useState<TransferVenues | null>(null)
  const [health, setHealth] = React.useState(false)
  React.useEffect(() => {
    let alive = true
    const load = () => api<TransferVenues>("/api/transfer/venues").then((v) => alive && setVenues(v)).catch(() => alive && setVenues(null))
    void load()
    const t = setInterval(load, 60_000)
    return () => { alive = false; clearInterval(t) }
  }, [])
  React.useEffect(() => { if (crossChain && value.route === "direct") onChange({ ...value, route: "exchange" }) }, [crossChain, value, onChange])
  // a saved venue that has since closed falls back to auto rather than failing every leg
  const closed = (v: string) => venues?.venues[v]?.status === "closed"
  React.useEffect(() => { if (venues && value.venue !== "auto" && value.venue !== "random" && closed(value.venue)) onChange({ ...value, venue: "auto" }) }, [venues]) // eslint-disable-line react-hooks/exhaustive-deps

  const rows = venues ? Object.entries(venues.venues) : []
  const seg = (on: boolean) => cn("inline-flex h-8 items-center gap-1.5 px-3 text-xs font-medium transition-colors first:rounded-l-md last:rounded-r-md", on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent", "disabled:cursor-not-allowed disabled:opacity-40")

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-xs">Route</span>
        <div className="inline-flex overflow-hidden rounded-md border">
          <button type="button" className={seg(value.route === "direct")} disabled={crossChain} title={crossChain ? "Different chains: only the exchange route crosses" : "We sign one transfer per leg; the two wallets are linked on chain"} onClick={() => onChange({ ...value, route: "direct" })}><ArrowRightLeft className="size-3" /> Direct</button>
          <button type="button" className={seg(value.route === "exchange")} title="The exchange pays the destination: no on-chain path from your wallet to it (reduces on-chain linkability)" onClick={() => onChange({ ...value, route: "exchange" })}><Shuffle className="size-3" /> Exchange</button>
        </div>
        {value.route === "exchange" && (
          <>
            <Select className="h-8 w-44 text-xs" value={value.venue} onChange={(e) => onChange({ ...value, venue: e.target.value })} title="Which exchange pays the destination">
              <option value="auto">auto · best execution</option>
              <option value="random">random · a venue per leg</option>
              {rows.map(([v, s]) => <option key={v} value={v} disabled={s.status === "closed"}>{v}{s.default ? " · default" : ""}{s.status === "closed" ? ` · closed${s.reason ? `: ${s.reason}` : ""}` : s.status === "unknown" ? " · status unknown" : ""}</option>)}
            </Select>
            <Select className="h-8 w-52 text-xs" value={value.mode} onChange={(e) => onChange({ ...value, mode: e.target.value as Mode })} title="float: market rate · fixed: locked output · private: a privacy-coin leg">
              {MODES.map((m) => <option key={m} value={m}>{m} · {MODE_NOTE[m]}</option>)}
            </Select>
            <button type="button" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 text-xs" onClick={() => setHealth((h) => !h)}>venues <ChevronDown className={cn("size-3 transition-transform", health && "rotate-180")} /></button>
          </>
        )}
      </div>
      <p className="text-muted-foreground text-xs">
        {value.route === "direct" ? "Signed here; the two wallets are linked on chain. Pick Exchange to avoid that." : value.venue !== "auto" && value.venue !== "random" ? `${value.venue} pays the destination from that exchange: breaks the wallet cluster (about 1 % more than auto).` : value.venue === "random" ? "An open venue is rolled per leg: destinations do not all arrive from one place." : "The destination is paid by the exchange, not by your wallet: reduces on-chain linkability."}
        {crossChain && " Cross-chain legs always take the exchange route."}
        {venues?.exchange === "off" && " The exchange route is off on this server right now."}
      </p>
      {health && value.route === "exchange" && (
        <ul className="bg-muted/40 grid gap-x-4 gap-y-0.5 rounded-md border px-3 py-2 text-xs sm:grid-cols-2">
          <li className="text-muted-foreground sm:col-span-2">exchange route · {venues?.exchange ?? "unknown"}{venues?.checkedAt ? ` · checked ${new Date(venues.checkedAt).toLocaleTimeString()}` : ""}{venues?.note ? ` · ${venues.note}` : ""}</li>
          {rows.map(([v, s]) => <li key={v} className="flex items-center justify-between gap-2"><span>{v}{s.default ? " · default" : ""}</span><span className={s.status === "open" ? "text-emerald-600 dark:text-emerald-400" : s.status === "closed" ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}>{s.status}{s.reason ? ` · ${s.reason}` : ""}</span></li>)}
          {!rows.length && <li className="text-muted-foreground">venue list not available</li>}
        </ul>
      )}
    </div>
  )
}
