"use client"

import * as React from "react"
import Link from "next/link"
import { Check, ChevronDown, Copy, Download, KeyRound, Minus, Plus, RefreshCw, Search, Star, X } from "lucide-react"
import { ApiErrorBox } from "@/components/api-error"
import { JobLegs, jobRunning, useJobPolling } from "@/components/legs"
import { useStatus } from "@/components/providers"
import { Button } from "@/components/ui/button"
import { Badge, Card, ChainMark } from "@/components/ui/card"
import { Input, Select } from "@/components/ui/input"
import { Empty, Mono, Table, TBody, THead } from "@/components/ui/table"
import { CHAINS, CHAIN_IDS, MODES, ROLES, type ChainId, type Mode, type Role } from "@/lib/chains"
import { api, errorText, walletKey, type BalanceRow, type MoveRequest, type PlanView, type PublicJob, type TransferVenues, type WalletInfo, type WalletsView } from "@/lib/client"
import { cn, fmt } from "@/lib/utils"

const AMOUNT_RE = /[^0-9.]/g

/**
 * One list of wallets. ★ is the main wallet of its chain: it pays for every Fund and receives every Gather. Keys are
 * files in the folder; every action here is a button on the row or on the bar that appears when rows are selected.
 */
export default function WalletsPage() {
  const { status, refresh } = useStatus()
  const [data, setData] = React.useState<WalletsView | null>(null)
  const [balances, setBalances] = React.useState<Record<string, number | null>>({})
  const [filter, setFilter] = React.useState<"all" | ChainId>("all")
  const [search, setSearch] = React.useState("")
  const [showArchived, setShowArchived] = React.useState(false)
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [error, setError] = React.useState<unknown>(null)
  const [notice, setNotice] = React.useState<React.ReactNode>(null)
  const [busy, setBusy] = React.useState<string | null>(null)

  // toolbar
  const [count, setCount] = React.useState(1)
  const [askChain, setAskChain] = React.useState(false)
  const [importOpen, setImportOpen] = React.useState(false)
  const [secret, setSecret] = React.useState("")

  // per-row popovers
  const [rename, setRename] = React.useState<{ key: string; label: string; role: Role | "" } | null>(null)
  const [reveal, setReveal] = React.useState<{ key: string; privateKey: string } | null>(null)
  const [fundRow, setFundRow] = React.useState<{ key: string; amount: string } | null>(null)

  // the bulk bar
  const [each, setEach] = React.useState("0.05")
  const [viaExchange, setViaExchange] = React.useState(false)
  const [mode, setMode] = React.useState<Mode>("float")
  const [venue, setVenue] = React.useState("auto")
  const [venues, setVenues] = React.useState<TransferVenues | null>(null)

  // the run started from this page
  const [job, setJob] = React.useState<PublicJob | null>(null)

  const loadBalances = React.useCallback(async (ws: Array<{ chain: ChainId; publicKey: string }>) => {
    const items = ws.filter((w) => CHAINS[w.chain].balances).map((w) => ({ chain: w.chain, address: w.publicKey }))
    if (!items.length) return
    const r = await api<{ balances: BalanceRow[] }>("/api/wallets/balances", { json: { wallets: items } }).catch(() => null)
    if (r) setBalances((b) => ({ ...b, ...Object.fromEntries(r.balances.map((x) => [walletKey(x.chain, x.address), x.balance])) }))
  }, [])
  const load = React.useCallback(async () => {
    try {
      const d = await api<WalletsView>("/api/wallets")
      setData(d)
      void loadBalances(d.wallets)
    } catch (e) { setError(e) }
  }, [loadBalances])
  React.useEffect(() => { void load() }, [load])
  React.useEffect(() => { if (status) { setMode(status.mode); setVenue(status.venue) } }, [status])
  React.useEffect(() => { if (viaExchange && !venues) api<TransferVenues>("/api/transfer/venues").then(setVenues).catch(() => null) }, [viaExchange, venues])
  const onTick = React.useCallback(() => { if (data) void loadBalances(data.wallets) }, [data, loadBalances])
  useJobPolling(job, setJob, onTick)

  const run = async (what: string, fn: () => Promise<React.ReactNode | void>) => {
    setBusy(what); setError(null); setNotice(null)
    try { const n = await fn(); if (n) setNotice(n); await load(); await refresh() } catch (e) { setError(e) } finally { setBusy(null) }
  }

  // ── wallets ───────────────────────────────────────────────────────────────
  const archived = new Set(data?.archived ?? [])
  const all = data?.wallets ?? []
  const mainOf = (chain: ChainId) => data?.mainWallet[chain]
  const isMain = (w: WalletInfo) => mainOf(w.chain)?.toLowerCase() === w.publicKey.toLowerCase()
  const rows = all.filter((w) => (filter === "all" || w.chain === filter) && (showArchived ? archived.has(walletKey(w.chain, w.publicKey)) : !archived.has(walletKey(w.chain, w.publicKey))) && (!search || `${w.label} ${w.publicKey} ${w.role}`.toLowerCase().includes(search.toLowerCase())))
  const counts = Object.fromEntries(CHAIN_IDS.map((c) => [c, all.filter((w) => w.chain === c && !archived.has(walletKey(w.chain, w.publicKey))).length]))
  const live = all.filter((w) => !archived.has(walletKey(w.chain, w.publicKey)))
  const bal = (w: { chain: ChainId; publicKey: string }) => balances[walletKey(w.chain, w.publicKey)]
  const balText = (w: { chain: ChainId; publicKey: string }) => (CHAINS[w.chain].balances ? (bal(w) === undefined ? "…" : `${fmt(bal(w))} ${CHAINS[w.chain].native}`) : "—")
  const byKey = (k: string) => all.find((w) => walletKey(w.chain, w.publicKey) === k)

  const create = (chain: ChainId) => run("create", async () => {
    setAskChain(false)
    const r = await api<{ wallets: WalletInfo[]; starred: string | null }>("/api/wallets", { json: { count, chain } })
    setCount(1)
    return <>{r.wallets.length} {CHAINS[chain].name} wallet{r.wallets.length > 1 ? "s" : ""} created: {r.wallets.map((w) => w.label).join(", ")}{r.starred ? " · the first is now ★" : ""}.</>
  })
  const doImport = () => run("import", async () => {
    const s = secret.trim()
    const chain: ChainId = s.startsWith("0x") || /^[0-9a-fA-F]{64}$/.test(s) ? (filter !== "all" && CHAINS[filter].kind === "evm" ? filter : "rh") : "sol"
    const r = await api<{ wallet: WalletInfo & { existed: boolean } }>("/api/wallets/import", { json: { secret: s, chain, label: `Imported ${live.length + 1}` } })
    setSecret(""); setImportOpen(false)
    if (!mainOf(chain)) await api("/api/wallets/main", { json: { chain, publicKey: r.wallet.publicKey } })
    return <>{r.wallet.existed ? "Already in the folder" : "Imported"}: {r.wallet.label} on {CHAINS[chain].name}.</>
  })
  const doRewrite = () => run("rewrite", async () => {
    const r = await api<{ files: number; restored: string[]; csvAdded: number }>("/api/wallets/rewrite-backups", { method: "POST" })
    return <>{r.files} wallet files; restored {r.restored.length} from wallets.csv; {r.csvAdded} CSV line{r.csvAdded === 1 ? "" : "s"} added.</>
  })
  const setMain = (w: WalletInfo) => run("main", async () => { await api("/api/wallets/main", { json: { chain: w.chain, publicKey: w.publicKey } }) })
  const saveRename = () => {
    if (!rename) return
    const w = byKey(rename.key)
    if (!w) return
    void run("rename", async () => {
      await api("/api/wallets/rename", { json: { chain: w.chain, publicKey: w.publicKey, label: rename.label, role: rename.role || undefined } })
      setRename(null)
    })
  }
  const showKey = async (w: WalletInfo) => {
    if (!window.confirm(`Show the private key of ${w.label}? Anyone who sees it controls the wallet.`)) return
    setError(null)
    try { const r = await api<{ privateKey: string }>("/api/wallets/key", { json: { chain: w.chain, publicKey: w.publicKey } }); setReveal({ key: walletKey(w.chain, w.publicKey), privateKey: r.privateKey }) } catch (e) { setError(e) }
  }
  const doExport = async () => {
    const list = [...selected].map(byKey).filter((w): w is WalletInfo => !!w).map((w) => ({ chain: w.chain, publicKey: w.publicKey }))
    if (!list.length) return
    if (!window.confirm(`Export ${list.length} wallet${list.length > 1 ? "s" : ""} as CSV? The file contains the PRIVATE KEYS. Anyone with the file controls the wallets.`)) return
    setBusy("export"); setError(null)
    try {
      const res = await fetch("/api/wallets/export", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallets: list }) })
      if (!res.ok) throw await res.json()
      const url = URL.createObjectURL(await res.blob())
      const a = Object.assign(document.createElement("a"), { href: url, download: `wallets-export-${new Date().toISOString().slice(0, 10)}.csv` })
      a.click(); URL.revokeObjectURL(url)
    } catch (e) { setError(e) } finally { setBusy(null) }
  }
  const doArchive = (flag: boolean) => run(flag ? "archive" : "unarchive", async () => {
    const list = [...selected].map(byKey).filter((w): w is WalletInfo => !!w)
    if (flag) {
      const funded = list.filter((w) => (bal(w) ?? 0) > 0)
      if (funded.length && !window.confirm(`${funded.length} of these still hold${funded.length === 1 ? "s" : ""} a balance. Archive anyway? (Files stay in the folder; archived wallets can be shown again.)`)) return
    }
    await api("/api/wallets/archive", { json: { wallets: list.map((w) => ({ chain: w.chain, publicKey: w.publicKey })), archived: flag } })
    setSelected(new Set())
  })

  // ── money: every action is a plan + one confirm + /api/move/run ───────────
  const startMove = async (what: string, body: MoveRequest, describe: (p: PlanView) => string) => {
    setBusy(what); setError(null); setNotice(null)
    try {
      const plan = await api<PlanView>("/api/move/plan", { json: body })
      const native = CHAINS[plan.legs[0].from.chain].native
      if (!window.confirm(`${describe(plan)}\n${fmt(plan.total)} ${native} in ${plan.legs.filter((l) => l.phase === 1).length} transfer${plan.legs.length === 1 ? "" : "s"} · ${plan.route === "direct" ? "direct" : `exchange · ${plan.venue} · ${plan.mode}`}.\nSign and send now?`)) return
      const r = await api<{ job: PublicJob }>("/api/move/run", { json: body })
      setJob(r.job); setFundRow(null)
    } catch (e) { setError(e) } finally { setBusy(null) }
  }
  const endpoint = (w: WalletInfo) => ({ chain: w.chain, address: w.publicKey, label: w.label, ours: true })
  const routeBody = (exchange: boolean) => (exchange ? { route: "exchange" as const, mode, venue } : { route: "direct" as const, mode, venue })
  const fundOne = (w: WalletInfo, amount: string) => {
    const star = byKey(walletKey(w.chain, mainOf(w.chain) ?? ""))
    if (!star) return
    void startMove("fund", { from: [endpoint(star)], to: [endpoint(w)], amounts: [Number(amount)], ...routeBody(false) }, () => `Fund ${w.label} from ★ ${star.label}.`)
  }
  const sel = [...selected].map(byKey).filter((w): w is WalletInfo => !!w)
  const selChains = new Set(sel.map((w) => w.chain))
  const selChain = selChains.size === 1 ? sel[0].chain : null
  const selStar = selChain ? byKey(walletKey(selChain, mainOf(selChain) ?? "")) : undefined
  const targets = sel.filter((w) => !selStar || walletKey(w.chain, w.publicKey) !== walletKey(selStar.chain, selStar.publicKey))
  const bulkIssue = !selChain ? "Pick wallets on one chain" : !selStar ? `No ★ on ${CHAINS[selChain].name} yet: star a wallet first` : !CHAINS[selChain].source ? `${CHAINS[selChain].name} wallets cannot sign here: fund them from the Move page` : !targets.length ? "Only ★ is selected" : null
  const fundSelected = (exchange: boolean) => {
    if (!selStar || bulkIssue) return
    const n = Number(each)
    if (!(n > 0)) { setError({ error: "Set the amount each wallet receives.", status: 0 }); return }
    void startMove("fund", { from: [endpoint(selStar)], to: targets.map(endpoint), amounts: targets.map(() => n), ...routeBody(exchange) }, () => `Fund ${targets.length} wallet${targets.length > 1 ? "s" : ""} with ${each} ${CHAINS[selStar.chain].native} each from ★ ${selStar.label}${exchange ? " via the exchange route" : ""}.`)
  }
  const gather = () => {
    if (!selStar || bulkIssue) return
    void startMove("gather", { from: targets.map(endpoint), to: [endpoint(selStar)], amounts: targets.map(() => "max" as const), ...routeBody(false) }, () => `Gather everything (minus the gas reserve) from ${targets.length} wallet${targets.length > 1 ? "s" : ""} into ★ ${selStar.label}.`)
  }

  const toggle = (k: string) => setSelected((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const allShown = rows.length > 0 && rows.every((w) => selected.has(walletKey(w.chain, w.publicKey)))
  const copy = (s: string) => navigator.clipboard.writeText(s)
  const archivedCount = all.filter((w) => archived.has(walletKey(w.chain, w.publicKey))).length

  return (
    <div className="flex flex-col gap-4 pb-24">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h1 className="text-lg font-semibold tracking-tight">Wallets</h1>
        <p className="text-muted-foreground text-xs">Keys are saved to <code className="text-foreground break-all">{data?.dir ?? status?.backupDir ?? "…"}</code> · <button className="underline underline-offset-2 hover:text-foreground" onClick={doRewrite} disabled={busy !== null}>Rewrite backups</button></p>
      </div>

      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Button onClick={() => setAskChain((v) => !v)} disabled={busy !== null}><Plus /> {busy === "create" ? "Creating…" : count > 1 ? `New wallets × ${count}` : "New wallet"}</Button>
          {askChain && (
            <div className="bg-popover absolute top-full left-0 z-20 mt-1 flex items-center gap-2 rounded-lg border p-2 shadow-lg">
              <span className="text-muted-foreground px-1 text-xs">Chain</span>
              <Button size="sm" variant="secondary" onClick={() => create("sol")}><ChainMark chain="sol" /> Solana</Button>
              <Button size="sm" variant="secondary" onClick={() => create(filter !== "all" && CHAINS[filter].kind === "evm" ? filter : "rh")} title="One 0x key works on Robinhood, Ethereum and BNB; the file is made for Robinhood unless the list is filtered to another EVM chain"><ChainMark chain={filter !== "all" && CHAINS[filter].kind === "evm" ? filter : "rh"} /> EVM</Button>
              <button className="text-muted-foreground hover:text-foreground p-1" onClick={() => setAskChain(false)} aria-label="close"><X className="size-3.5" /></button>
            </div>
          )}
        </div>
        <div className="inline-flex h-9 items-center rounded-md border">
          <button className="text-muted-foreground hover:text-foreground px-2" onClick={() => setCount((c) => Math.max(1, c - 1))} aria-label="fewer"><Minus className="size-3.5" /></button>
          <span className="min-w-8 text-center font-mono text-sm">× {count}</span>
          <button className="text-muted-foreground hover:text-foreground px-2" onClick={() => setCount((c) => Math.min(100, c + 1))} aria-label="more"><Plus className="size-3.5" /></button>
        </div>
        <Button variant="outline" onClick={() => setImportOpen((v) => !v)}><Download /> Import <ChevronDown className={cn("size-3.5 transition-transform", importOpen && "rotate-180")} /></Button>
        <Button variant="ghost" onClick={() => { setBalances({}); void load() }} disabled={busy !== null}><RefreshCw /> Refresh</Button>
        <div className="relative ml-auto w-full sm:w-64"><Search className="text-muted-foreground absolute top-2.5 left-2.5 size-4" /><Input className="pl-8" placeholder="search label or address" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      </div>
      {importOpen && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
          <Input type="password" autoComplete="off" className="flex-1 font-mono" placeholder="base58 secret (Solana) or 0x key (EVM)" value={secret} onChange={(e) => setSecret(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && secret.trim()) doImport() }} />
          <Button onClick={doImport} disabled={busy !== null || !secret.trim()}>{busy === "import" ? "Importing…" : "Import"}</Button>
          <span className="text-muted-foreground text-xs">A 0x key lands on {filter !== "all" && CHAINS[filter].kind === "evm" ? CHAINS[filter].name : "Robinhood"}; written to the folder like a created one.</span>
        </div>
      )}

      {/* chain filter */}
      <div className="flex flex-wrap items-center gap-1">
        {(["all", ...CHAIN_IDS] as const).map((t) => (
          <button key={t} onClick={() => setFilter(t)} className={cn("rounded-md px-2.5 py-1 text-xs font-medium", filter === t ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}>
            {t === "all" ? `All · ${live.length}` : `${CHAINS[t].name} · ${counts[t]}`}
          </button>
        ))}
        {archivedCount > 0 && <button onClick={() => { setShowArchived((v) => !v); setSelected(new Set()) }} className={cn("ml-auto rounded-md px-2.5 py-1 text-xs", showArchived ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}>{archivedCount} archived · {showArchived ? "hide" : "show"}</button>}
      </div>

      {notice && <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm">{notice}</div>}
      <ApiErrorBox error={error} />
      {!!data?.missing.length && (
        <p className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">
          {data.missing.length} wallet{data.missing.length > 1 ? "s" : ""} in wallets.csv {data.missing.length > 1 ? "have" : "has"} no file ({data.missing.map((m) => `${m.chain} ${m.publicKey.slice(0, 6)}…`).join(", ")}); nothing is paid to them until <button className="underline" onClick={doRewrite} disabled={busy !== null}>Rewrite backups</button> restores them.
        </p>
      )}
      {job && <Card className="p-3"><JobLegs job={job} compact onClear={() => setJob(null)} /></Card>}

      {/* the list */}
      <Card>
        {rows.length ? (
          <Table>
            <THead>
              <tr>
                <th className="w-8"><input type="checkbox" checked={allShown} onChange={() => setSelected(allShown ? new Set() : new Set(rows.map((w) => walletKey(w.chain, w.publicKey))))} aria-label="select all" /></th>
                <th className="w-8"></th>
                <th>Label</th><th>Address</th><th className="text-right">Balance</th><th className="text-right"></th>
              </tr>
            </THead>
            <TBody>
              {rows.map((w) => {
                const k = walletKey(w.chain, w.publicKey)
                const star = isMain(w)
                const starOnChain = !!mainOf(w.chain)
                const canFund = !star && starOnChain && CHAINS[w.chain].source
                return (
                  <React.Fragment key={k}>
                    <tr className={cn(selected.has(k) && "bg-accent/40")}>
                      <td><input type="checkbox" checked={selected.has(k)} onChange={() => toggle(k)} aria-label={`select ${w.label}`} /></td>
                      <td>
                        <button onClick={() => !star && setMain(w)} disabled={busy !== null} title={star ? `${w.label} is the ${CHAINS[w.chain].name} main wallet: it pays for every Fund and receives every Gather` : `Make ${w.label} the ${CHAINS[w.chain].name} main wallet`} className={cn("p-0.5", star ? "text-amber-500" : "text-muted-foreground/60 hover:text-foreground")}>
                          <Star className="size-4" fill={star ? "currentColor" : "none"} />
                        </button>
                      </td>
                      <td>
                        {rename?.key === k ? (
                          <span className="inline-flex flex-wrap items-center gap-1.5">
                            <Input autoFocus className="h-7 w-40 text-xs" value={rename.label} onChange={(e) => setRename({ ...rename, label: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") saveRename(); if (e.key === "Escape") setRename(null) }} />
                            <Select className="h-7 w-32 text-xs" value={rename.role} onChange={(e) => setRename({ ...rename, role: e.target.value as Role | "" })} title="Optional tag the launchers pick wallets up by">
                              <option value="">no tag</option>
                              {ROLES.filter((r) => r !== "relay").map((r) => <option key={r} value={r}>{r}</option>)}
                            </Select>
                            <Button size="xs" onClick={saveRename} disabled={busy !== null}><Check /> Save</Button>
                            <button className="text-muted-foreground hover:text-foreground" onClick={() => setRename(null)} aria-label="cancel"><X className="size-3.5" /></button>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5">
                            <ChainMark chain={w.chain} />
                            <button className="hover:underline underline-offset-2" title="Click to rename" onClick={() => setRename({ key: k, label: w.label, role: w.role === "trader" ? "" : w.role })}>{w.label}</button>
                            {w.role !== "trader" && <Badge>{w.role}</Badge>}
                          </span>
                        )}
                      </td>
                      <td>
                        <span className="inline-flex items-center gap-1.5">
                          <Mono title={w.publicKey}>{w.publicKey.slice(0, 8)}…{w.publicKey.slice(-6)}</Mono>
                          <button className="text-muted-foreground hover:text-foreground" onClick={() => copy(w.publicKey)} title="copy address"><Copy className="size-3.5" /></button>
                        </span>
                      </td>
                      <td className="text-right"><Mono>{balText(w)}</Mono></td>
                      <td className="text-right whitespace-nowrap">
                        {fundRow?.key === k ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Input autoFocus inputMode="decimal" className="h-7 w-24 text-xs" placeholder={CHAINS[w.chain].native} value={fundRow.amount} onChange={(e) => setFundRow({ key: k, amount: e.target.value.replace(AMOUNT_RE, "") })} onKeyDown={(e) => { if (e.key === "Enter" && Number(fundRow.amount) > 0) fundOne(w, fundRow.amount); if (e.key === "Escape") setFundRow(null) }} />
                            <Button size="xs" onClick={() => fundOne(w, fundRow.amount)} disabled={busy !== null || !(Number(fundRow.amount) > 0) || jobRunning(job)}>Send from ★</Button>
                            <button className="text-muted-foreground hover:text-foreground" onClick={() => setFundRow(null)} aria-label="cancel"><X className="size-3.5" /></button>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <Button size="xs" variant="outline" disabled={!canFund || jobRunning(job)} title={star ? "This is ★: it does the funding" : !starOnChain ? `No ★ on ${CHAINS[w.chain].name} yet` : !CHAINS[w.chain].source ? `${CHAINS[w.chain].name} wallets are funded from the Move page (exchange route)` : `Send ${CHAINS[w.chain].native} here from ★`} onClick={() => setFundRow({ key: k, amount: "" })}>Fund</Button>
                            <Button size="xs" variant="outline" onClick={() => showKey(w)} title="Show the private key"><KeyRound /> Key</Button>
                          </span>
                        )}
                      </td>
                    </tr>
                    {reveal?.key === k && (
                      <tr className="border-t-0!"><td colSpan={6} className="pt-0!">
                        <span className="inline-flex max-w-full items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-xs">
                          <KeyRound className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                          <Mono className="break-all">{reveal.privateKey}</Mono>
                          <button className="text-muted-foreground hover:text-foreground shrink-0" onClick={() => copy(reveal.privateKey)} title="copy key"><Copy className="size-3.5" /></button>
                          <button className="text-muted-foreground hover:text-foreground shrink-0" onClick={() => setReveal(null)} aria-label="hide key"><X className="size-3.5" /></button>
                        </span>
                      </td></tr>
                    )}
                  </React.Fragment>
                )
              })}
            </TBody>
          </Table>
        ) : <Empty>{data ? (showArchived ? "No archived wallets here." : all.length ? "No match." : "No wallets yet: press + New wallet.") : "Loading…"}</Empty>}
      </Card>

      {/* the bar for selected rows */}
      {selected.size > 0 && (
        <div className="bg-background/95 fixed inset-x-0 bottom-0 z-30 border-t backdrop-blur-md">
          <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-2 px-4 py-2.5 text-sm sm:px-6">
            <span className="font-medium">{selected.size} selected</span>
            <button className="text-muted-foreground hover:text-foreground text-xs" onClick={() => setSelected(new Set())}>clear</button>
            {!showArchived && (
              <>
                <span className="text-muted-foreground ml-2 text-xs">Amount each</span>
                <Input inputMode="decimal" className="h-8 w-24 text-xs" value={each} onChange={(e) => setEach(e.target.value.replace(AMOUNT_RE, ""))} />
                <Button size="sm" onClick={() => fundSelected(false)} disabled={busy !== null || !!bulkIssue || jobRunning(job)} title={bulkIssue ?? `★ ${selStar?.label} pays ${each} ${selChain ? CHAINS[selChain].native : ""} to each selected wallet, direct`}>Fund from ★</Button>
                <Button size="sm" variant="outline" onClick={() => setViaExchange((v) => !v)} disabled={!!bulkIssue} title={bulkIssue ?? "★ pays an exchange, the exchange pays each wallet: no on-chain path between them"}>Fund via exchange <ChevronDown className={cn("size-3.5 transition-transform", viaExchange && "rotate-180")} /></Button>
                {viaExchange && !bulkIssue && (
                  <span className="inline-flex items-center gap-1.5">
                    <Select className="h-8 w-24 text-xs" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>{MODES.map((m) => <option key={m} value={m}>{m}</option>)}</Select>
                    <Select className="h-8 w-36 text-xs" value={venue} onChange={(e) => setVenue(e.target.value)}>
                      <option value="auto">auto</option><option value="random">random</option>
                      {venues && Object.entries(venues.venues).map(([v, s]) => <option key={v} value={v} disabled={s.status === "closed"}>{v}{s.status === "closed" ? ` · closed${s.reason ? `: ${s.reason}` : ""}` : ""}</option>)}
                    </Select>
                    <Button size="sm" onClick={() => fundSelected(true)} disabled={busy !== null || jobRunning(job)}>Send</Button>
                  </span>
                )}
                <Button size="sm" variant="outline" onClick={gather} disabled={busy !== null || !!bulkIssue || jobRunning(job)} title={bulkIssue ?? `Everything (minus the gas reserve) from the selected wallets into ★ ${selStar?.label}`}>Gather to ★</Button>
              </>
            )}
            <span className="ml-auto inline-flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={doExport} disabled={busy !== null}><Download /> Export keys</Button>
              {showArchived
                ? <Button size="sm" variant="outline" onClick={() => doArchive(false)} disabled={busy !== null}>Unarchive</Button>
                : <Button size="sm" variant="outline" onClick={() => doArchive(true)} disabled={busy !== null} title="Hide from the lists; the key files stay in the folder">Archive</Button>}
            </span>
          </div>
        </div>
      )}
      {!data?.wallets.length && data && <p className="text-muted-foreground text-xs">Then open <Link href="/move" className="underline underline-offset-2">Move</Link> to send between wallets.</p>}
    </div>
  )
}
