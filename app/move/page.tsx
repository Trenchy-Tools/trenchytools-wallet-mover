"use client"

import * as React from "react"
import Link from "next/link"
import { Dices, Play, Search, Star, X } from "lucide-react"
import { ApiCalls, type ApiCall } from "@/components/api-calls"
import { ApiErrorBox } from "@/components/api-error"
import { JobLegs, jobRunning, useJobPolling } from "@/components/legs"
import { useStatus } from "@/components/providers"
import { RoutePicker, type RouteState } from "@/components/route-picker"
import { Button } from "@/components/ui/button"
import { Badge, Card, ChainMark } from "@/components/ui/card"
import { Input, Select } from "@/components/ui/input"
import { Empty, Mono } from "@/components/ui/table"
import { DEMO, TAB_NOTE } from "@/lib/browser/demo"
import { CHAINS, CHAIN_IDS, chainsForAddress, looksLikeAddress, shortAddress, type ChainId } from "@/lib/chains"
import { api, errorText, walletKey, type BalanceRow, type Endpoint, type MoveRequest, type PlanView, type PublicJob, type WalletInfo, type WalletsView } from "@/lib/client"
import { SHAPE_TEXT, amountSideOf, maxAmount, onGrid, shapeOf, splitEven, splitUneven, sum } from "@/lib/core/moves"
import { cn, fmt } from "@/lib/utils"

/** A basket line: a wallet of ours or a pasted address, with the amount typed on it (From rows can be "max"). */
type Item = Endpoint & { id: string; amount: string; max: boolean }
const AMOUNT_RE = /[^0-9.]/g
const PILLS = ["0.01", "0.05", "0.1", "0.5", "1"]

/**
 * The desk: wallets on the left, From and To baskets on the right, one Run button. The side with more wallets carries
 * the amounts (To when distributing, From otherwise). The plan line is the preview; Run asks once, then signs and sends.
 */
export default function MovePage() {
  const { status } = useStatus()
  const reserve = (c: ChainId) => (CHAINS[c].kind === "sol" ? status?.gasReserveSol ?? 0.001 : status?.gasReserveEth ?? 0.00005)

  const [wallets, setWallets] = React.useState<WalletInfo[]>([])
  const [mainWallet, setMainWallet] = React.useState<Partial<Record<ChainId, string>>>({})
  const [archived, setArchived] = React.useState<Set<string>>(new Set())
  const [balances, setBalances] = React.useState<Record<string, number | null>>({})
  const [filter, setFilter] = React.useState<"all" | ChainId>("all")
  const [search, setSearch] = React.useState("")

  const [from, setFrom] = React.useState<Item[]>([])
  const [to, setTo] = React.useState<Item[]>([])
  const [routeState, setRouteState] = React.useState<RouteState>({ route: "direct", mode: "float", venue: "auto" })
  const [defaultsApplied, setDefaultsApplied] = React.useState(false)
  const [scatter, setScatter] = React.useState(false)
  const [seed, setSeed] = React.useState(() => Math.floor(Math.random() * 1e9))
  const [splitTotal, setSplitTotal] = React.useState("")
  const [plan, setPlan] = React.useState<PlanView | null>(null)
  const [planError, setPlanError] = React.useState<string | null>("Put at least one wallet in From.")
  const [job, setJob] = React.useState<PublicJob | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<unknown>(null)

  const loadBalances = React.useCallback(async (items: Array<{ chain: ChainId; address: string }>) => {
    const want = items.filter((i) => CHAINS[i.chain].balances)
    if (!want.length) return
    const r = await api<{ balances: BalanceRow[] }>("/api/wallets/balances", { json: { wallets: want } }).catch(() => null)
    if (r) setBalances((b) => ({ ...b, ...Object.fromEntries(r.balances.map((x) => [walletKey(x.chain, x.address), x.balance])) }))
  }, [])
  React.useEffect(() => {
    api<WalletsView>("/api/wallets").then((d) => { setWallets(d.wallets); setMainWallet(d.mainWallet); setArchived(new Set(d.archived)); void loadBalances(d.wallets.map((w) => ({ chain: w.chain, address: w.publicKey }))) }).catch(setError)
  }, [loadBalances])
  React.useEffect(() => { if (status && !defaultsApplied) { setRouteState({ route: status.route, mode: status.mode, venue: status.venue }); setDefaultsApplied(true) } }, [status, defaultsApplied])
  const onTick = React.useCallback(() => void loadBalances([...from, ...to, ...(job?.relay ? [{ chain: job.relay.chain, address: job.relay.publicKey }] : [])]), [from, to, job, loadBalances])
  useJobPolling(job, setJob, onTick)

  // ── baskets ───────────────────────────────────────────────────────────────
  const shape = shapeOf(from.length, to.length, scatter)
  const side = shape ? amountSideOf(shape) : "from"
  const bal = (e: { chain: ChainId; address: string }) => balances[walletKey(e.chain, e.address)]
  const maxOf = (e: { chain: ChainId; address: string }) => maxAmount(bal(e) ?? 0, reserve(e.chain))
  const inFrom = new Set(from.map((i) => i.id))
  const inTo = new Set(to.map((i) => i.id))
  const itemOf = (w: WalletInfo): Item => ({ id: walletKey(w.chain, w.publicKey), chain: w.chain, address: w.publicKey, label: w.label, ours: true, amount: "", max: false })
  const toggleBasket = (basket: "from" | "to", w: WalletInfo) => {
    const item = itemOf(w)
    const [set, has] = basket === "from" ? [setFrom, inFrom] : [setTo, inTo]
    set((xs) => (has.has(item.id) ? xs.filter((x) => x.id !== item.id) : [...xs, item]))
    setJob(null)
  }
  const removeItem = (basket: "from" | "to", id: string) => (basket === "from" ? setFrom : setTo)((xs) => xs.filter((x) => x.id !== id))
  const setAmount = (basket: "from" | "to", id: string, amount: string) => (basket === "from" ? setFrom : setTo)((xs) => xs.map((x) => (x.id === id ? { ...x, amount, max: false } : x)))
  const setMax = (id: string, max: boolean) => setFrom((xs) => xs.map((x) => (x.id === id ? { ...x, max } : x)))
  const maxAll = () => setFrom((xs) => xs.map((x) => ({ ...x, max: true })))
  const sameAmount = (v: string) => (side === "from" ? setFrom((xs) => xs.map((x) => ({ ...x, amount: v, max: false }))) : setTo((xs) => xs.map((x) => ({ ...x, amount: v }))))

  const deskChain: ChainId = from[0]?.chain ?? to[0]?.chain ?? "sol"
  const native = CHAINS[deskChain].native
  const crossChain = from.some((f) => to.some((t) => t.chain !== f.chain))
  const sourceMax = from[0] && bal(from[0]) !== undefined ? maxOf(from[0]) : null
  React.useEffect(() => { if (sourceMax !== null && !splitTotal) setSplitTotal(String(sourceMax)) }, [sourceMax, splitTotal])
  const applySplit = (kind: "even" | "uneven") => {
    const t = Number(splitTotal)
    if (!(t > 0) || !to.length) { setError({ error: "Set the total to split.", status: 0 }); return }
    try {
      const cuts = kind === "even" ? splitEven(onGrid(t), to.length) : splitUneven(onGrid(t), to.length)
      setTo((xs) => xs.map((x, i) => ({ ...x, amount: String(cuts[i]) })))
      setError(null)
    } catch (e) { setError({ error: errorText(e), status: 0 }) }
  }

  const [pasted, setPasted] = React.useState("")
  const pastedChains = chainsForAddress(pasted.trim())
  const pastedChain: ChainId | null = pastedChains.length ? (pastedChains.includes(deskChain) ? deskChain : pastedChains[0]) : null
  const [pastedPick, setPastedPick] = React.useState<ChainId | null>(null)
  const addPasted = () => {
    const address = pasted.trim()
    const chain = pastedPick && pastedChains.includes(pastedPick) ? pastedPick : pastedChain
    if (!chain || !looksLikeAddress(chain, address)) return
    const own = wallets.find((w) => w.chain === chain && w.publicKey.toLowerCase() === address.toLowerCase())
    const id = walletKey(chain, address)
    if (!inTo.has(id)) setTo((xs) => [...xs, { id, chain, address: own?.publicKey ?? address, label: own?.label, ours: !!own, amount: "", max: false }])
    setPasted(""); setPastedPick(null)
  }

  // ── the plan: the desk's preview, re-read whenever the baskets change ─────
  const body = React.useMemo<MoveRequest | null>(() => {
    if (!shape) return null
    const rows = side === "from" ? from : to
    return { from: from.map(({ id: _i, amount: _a, max: _m, ...e }) => e), to: to.map(({ id: _i, amount: _a, max: _m, ...e }) => e), amounts: rows.map((r) => (side === "from" && r.max ? "max" : Number(r.amount || 0))), ...routeState, scatter, seed }
  }, [shape, side, from, to, routeState, scatter, seed])
  React.useEffect(() => {
    if (!body) { setPlan(null); setPlanError(from.length ? "Put a wallet in To, or paste an address to send to." : "Put at least one wallet in From."); return }
    let alive = true
    const t = setTimeout(async () => {
      try { const p = await api<PlanView>("/api/move/plan", { json: body }); if (alive) { setPlan(p); setPlanError(null) } }
      catch (e) { if (alive) { setPlan(null); setPlanError(errorText(e)) } }
    }, 250)
    return () => { alive = false; clearTimeout(t) }
  }, [body, from.length])

  const describe = (p: PlanView) => {
    const f = p.legs.filter((l) => l.phase === 1)
    const fromLabel = f[0]?.from.label ?? shortAddress(f[0]?.from.address ?? "")
    const toLabel = p.legs.at(-1)?.to.label ?? shortAddress(p.legs.at(-1)?.to.address ?? "")
    if (p.shape === "send") return `${fromLabel} → ${toLabel}`
    if (p.shape === "distribute") return `${fromLabel} → ${to.length} wallets`
    if (p.shape === "consolidate") return `${from.length} wallets → ${toLabel}`
    if (p.shape === "pairwise") return `${from.length} wallets → ${to.length} wallets, paired`
    return `${from.length} wallets → ${to.length} wallets, pooled through a relay`
  }
  const receives = plan ? (plan.shape === "pool" ? (plan.poolCuts ? sum(plan.poolCuts) : null) : plan.total) : null
  const runLabel = !shape ? "Run" : shape === "send" ? "Send" : shape === "distribute" ? "Distribute" : shape === "consolidate" ? "Consolidate" : shape === "pairwise" ? "Pair up" : "Pool & redistribute"

  const doRun = async () => {
    if (!plan || !body) return
    const n = plan.legs.filter((l) => l.phase === 1).length
    if (!window.confirm(`${describe(plan)}\n${fmt(plan.total)} ${native} in ${n} transfer${n === 1 ? "" : "s"} · ${plan.route === "direct" ? "direct" : `exchange · ${plan.venue} · ${plan.mode}`}${plan.shape === "pool" ? `, then the relay pays ${to.length} wallets` : ""}.\nSign and send now?`)) return
    setBusy(true); setError(null)
    try { setJob((await api<{ job: PublicJob }>("/api/move/run", { json: body })).job) } catch (e) { setError(e) } finally { setBusy(false) }
  }

  const listed = wallets.filter((w) => !archived.has(walletKey(w.chain, w.publicKey)) && (filter === "all" || w.chain === filter) && (!search || `${w.label} ${w.publicKey}`.toLowerCase().includes(search.toLowerCase())))
  const isMain = (w: WalletInfo) => mainWallet[w.chain]?.toLowerCase() === w.publicKey.toLowerCase()
  const running = jobRunning(job)

  return (
    <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
      {/* ── your wallets ───────────────────────────────────────────────── */}
      <Card className="self-start">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <span className="text-sm font-semibold">Your wallets</span>
          <span className="text-muted-foreground text-xs">{listed.length}</span>
          <Link href="/wallets" className="text-muted-foreground hover:text-foreground ml-auto text-xs underline-offset-2 hover:underline">+ new / import</Link>
        </div>
        <div className="flex gap-2 border-b px-3 py-2">
          <Select value={filter} onChange={(e) => setFilter(e.target.value as "all" | ChainId)} className="h-8 w-28 text-xs"><option value="all">all chains</option>{CHAIN_IDS.map((c) => <option key={c} value={c}>{CHAINS[c].name}</option>)}</Select>
          <div className="relative flex-1"><Search className="text-muted-foreground absolute top-2 left-2 size-3.5" /><Input className="h-8 pl-7 text-xs" placeholder="label or address" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        </div>
        <ul className="max-h-[72vh] overflow-y-auto text-sm">
          {listed.map((w) => {
            const id = walletKey(w.chain, w.publicKey)
            const b = bal({ chain: w.chain, address: w.publicKey })
            return (
              <li key={id} className="flex items-center gap-2 border-b px-3 py-1.5 last:border-b-0">
                <ChainMark chain={w.chain} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1 truncate">{isMain(w) && <Star className="size-3 shrink-0 text-amber-500" fill="currentColor" />}<span className="truncate">{w.label}</span></div>
                  <div className="text-muted-foreground flex gap-2 text-xs"><Mono>{shortAddress(w.publicKey)}</Mono><Mono>{CHAINS[w.chain].balances ? (b === undefined ? "…" : `${fmt(b)} ${CHAINS[w.chain].native}`) : "—"}</Mono></div>
                </div>
                <Pill on={inFrom.has(id)} disabled={!CHAINS[w.chain].source} title={CHAINS[w.chain].source ? (inFrom.has(id) ? "Take out of From" : "Put in From") : `${CHAINS[w.chain].name} wallets cannot sign here: they can receive but not send`} onClick={() => toggleBasket("from", w)}>From</Pill>
                <Pill on={inTo.has(id)} title={inTo.has(id) ? "Take out of To" : "Put in To"} onClick={() => toggleBasket("to", w)}>To</Pill>
              </li>
            )
          })}
          {!listed.length && <Empty>{wallets.length ? "No match." : <>No wallets yet: <Link href="/wallets" className="underline">create some</Link>.</>}</Empty>}
        </ul>
      </Card>

      {/* ── the desk ───────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 xl:grid-cols-2">
          <Basket
            title="From" items={from} showAmount={side === "from"} resolved={side === "from" ? plan?.amounts : undefined} bal={bal}
            summary={<>holds {fmt(sum(from.map((f) => bal(f) ?? 0)))} {native}</>}
            tools={from.length > 0 && side === "from" ? <Button size="xs" variant="secondary" onClick={maxAll} title="Every From row sends everything it holds minus the gas reserve">Max all</Button> : null}
            onAmount={(id, v) => setAmount("from", id, v)} onMax={setMax} onRemove={(id) => removeItem("from", id)} onClear={() => setFrom([])}
            empty={<>the wallets money leaves · press <b>From</b> on a wallet</>}
            footer={side === "from" && from.length > 0 && <Fills onPick={sameAmount} extra={<button className={pill(false)} onClick={maxAll}>max</button>} />}
          />
          <Basket
            title="To" items={to} showAmount={side === "to"} bal={bal}
            summary={plan && receives !== null ? <>receives {plan.shape === "pool" ? "≈ " : ""}{fmt(receives)} {native}</> : <>holds {fmt(sum(to.map((t) => bal(t) ?? 0)))} {native}</>}
            tools={to.length > 1 && from.length === 1 ? (
              <span className="inline-flex items-center gap-1.5">
                <Button size="xs" variant="secondary" onClick={() => applySplit("even")} title="Cut the total into equal shares on the 0.001 grid">Split evenly</Button>
                <Button size="xs" variant="secondary" onClick={() => applySplit("uneven")} title="Same total, uneven cuts: biggest about three times the smallest, none under 40 % of the even share, on the 0.001 grid. Press again for a different draw."><Dices /> Split unevenly</Button>
                <span className="text-muted-foreground text-xs">of</span>
                <Input inputMode="decimal" className="h-6 w-24 text-xs" value={splitTotal} onChange={(e) => setSplitTotal(e.target.value.replace(AMOUNT_RE, ""))} title={sourceMax !== null ? `${from[0].label} can part with ${fmt(sourceMax)} ${native}` : "the total to split"} />
              </span>
            ) : null}
            onAmount={(id, v) => setAmount("to", id, v)} onRemove={(id) => removeItem("to", id)} onClear={() => setTo([])}
            empty={<>where it lands · press <b>To</b> on a wallet, or paste an address below</>}
            footer={
              <>
                {side === "to" && to.length > 0 && <Fills onPick={sameAmount} />}
                <div className="flex items-center gap-2 border-t px-3 py-2">
                  <Input className="h-8 font-mono text-xs" placeholder="…or paste an address to send to" value={pasted} onChange={(e) => { setPasted(e.target.value); setPastedPick(null) }} onKeyDown={(e) => { if (e.key === "Enter") addPasted() }} />
                  {pasted.trim() && (pastedChains.length > 1
                    ? <Select className="h-8 w-28 text-xs" value={pastedPick ?? pastedChain ?? ""} onChange={(e) => setPastedPick(e.target.value as ChainId)}>{pastedChains.map((c) => <option key={c} value={c}>{CHAINS[c].name}</option>)}</Select>
                    : <Badge tone={pastedChain ? "info" : "bad"}>{pastedChain ? CHAINS[pastedChain].name : "not an address"}</Badge>)}
                  <Button size="sm" variant="secondary" onClick={addPasted} disabled={!pastedChain}>Add</Button>
                </div>
              </>
            }
          />
        </div>

        {/* ── run bar ────────────────────────────────────────────────── */}
        <Card className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
            <RoutePicker value={routeState} onChange={setRouteState} crossChain={crossChain} />
            {from.length > 1 && to.length > 1 && (
              <label className="inline-flex h-8 items-center gap-1.5 text-xs" title="Pool what the sources send in a fresh relay wallet and hand the destinations unrelated amounts. Pairing sends the same number out of one wallet and into another, which stays matchable by amount and timing even with an exchange in between.">
                <input type="checkbox" checked={scatter} onChange={(e) => { setScatter(e.target.checked); setSeed(Math.floor(Math.random() * 1e9)) }} />
                Scatter amounts
              </label>
            )}
            {scatter && from.length > 1 && to.length > 1 && <Button size="xs" variant="secondary" onClick={() => setSeed(Math.floor(Math.random() * 1e9))} title="Draw a different split. Nothing has been sent yet."><Dices /> Re-roll</Button>}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1 text-sm">
              {plan ? (
                <span className="inline-flex flex-wrap items-center gap-2">
                  <Badge tone="info">{SHAPE_TEXT[plan.shape]}</Badge>
                  <span>{describe(plan)}</span>
                  <span className="text-muted-foreground">· {fmt(plan.total)} {native} in {plan.legs.filter((l) => l.phase === 1).length} transfer{plan.legs.filter((l) => l.phase === 1).length === 1 ? "" : "s"}{plan.shape === "pool" && plan.poolCuts ? `, then ≈ ${plan.poolCuts.map((c) => fmt(c)).join(" · ")} to the ${to.length} destinations` : ""}</span>
                </span>
              ) : <span className="text-muted-foreground">{planError ?? "…"}</span>}
              {plan && plan.required.length > 0 && <p className="text-muted-foreground mt-1 text-xs">Sources must hold {plan.required.map((r) => `${r.label ?? shortAddress(r.address)} ${fmt(r.needs)} ${CHAINS[r.chain].native}`).join(" · ")} (legs + gas reserve); Run checks that first and stops if one is short.</p>}
              {DEMO && <p className="text-muted-foreground mt-1 text-xs">{TAB_NOTE}</p>}
            </div>
            <Button onClick={doRun} disabled={!plan || busy || running} title={plan ? `${describe(plan)} · ${plan.route}` : planError ?? ""}><Play /> {running ? "Running…" : busy ? "Starting…" : runLabel}</Button>
          </div>
          <ApiErrorBox error={error} />
          {plan ? (
            <details className="border-t pt-3 text-sm">
              <summary className="text-muted-foreground hover:text-foreground cursor-pointer select-none">Dry run · the API calls behind this plan{(plan as PlanView & { calls?: ApiCall[] }).calls?.length ? ` (${(plan as PlanView & { calls?: ApiCall[] }).calls!.length})` : ""} ▾</summary>
              <ApiCalls className="mt-2" calls={(plan as PlanView & { calls?: ApiCall[] }).calls} title="" empty="The plan needed no API call (no balances to read)." />
            </details>
          ) : null}
          {job && <div className="border-t pt-3"><JobLegs job={job} onClear={() => setJob(null)} /></div>}
        </Card>
      </div>
    </div>
  )
}

// ── pieces ─────────────────────────────────────────────────────────────────

const pill = (on: boolean) => cn("inline-flex h-6 items-center rounded-full border px-2 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40", on ? "bg-primary text-primary-foreground border-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent")
function Pill({ on, children, ...p }: React.ComponentProps<"button"> & { on: boolean }) {
  return <button type="button" className={pill(on)} {...p}>{children}</button>
}

/** "Set every amount to" 0.01 · 0.05 · 0.1 · 0.5 · 1 on whichever side carries the amounts. */
function Fills({ onPick, extra }: { onPick: (v: string) => void; extra?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-t px-3 py-2">
      <span className="text-muted-foreground mr-1 text-xs">Set every amount to</span>
      {PILLS.map((v) => <button key={v} className={pill(false)} onClick={() => onPick(v)}>{v}</button>)}
      {extra}
    </div>
  )
}

/** One side of the transfer: the rows, their balances and (on the side that carries them) the amounts. */
function Basket({ title, items, showAmount, resolved, bal, summary, tools, footer, empty, onAmount, onMax, onRemove, onClear }: {
  title: "From" | "To"; items: Item[]; showAmount: boolean; resolved?: number[]; bal: (e: { chain: ChainId; address: string }) => number | null | undefined
  summary: React.ReactNode; tools?: React.ReactNode; footer?: React.ReactNode; empty: React.ReactNode
  onAmount: (id: string, v: string) => void; onMax?: (id: string, max: boolean) => void; onRemove: (id: string) => void; onClear: () => void
}) {
  return (
    <Card>
      <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-muted-foreground text-xs">{items.length} wallet{items.length === 1 ? "" : "s"}</span>
        <Mono className="text-muted-foreground text-xs">{summary}</Mono>
        <span className="ml-auto inline-flex items-center gap-1.5">
          {tools}
          {items.length > 0 && <button className="text-muted-foreground hover:text-foreground p-0.5" title={`Empty ${title}`} onClick={onClear}><X className="size-3.5" /></button>}
        </span>
      </header>
      <ul className="text-sm">
        {items.length > 0 && (
          <li className="text-muted-foreground grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 px-3 py-1 text-[11px]"><span>Wallet</span><span className="text-right">Balance</span><span className="w-[9.5rem] text-right">{showAmount ? "Amount" : ""}</span><span className="w-4" /></li>
        )}
        {items.map((it, i) => (
          <li key={it.id} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 border-t px-3 py-1.5">
            <span className="flex min-w-0 items-center gap-1.5" title={it.address}>
              <ChainMark chain={it.chain} />
              <span className="truncate">{it.label ?? <Mono>{shortAddress(it.address)}</Mono>}</span>
              {!it.ours && <Badge>pasted</Badge>}
              {it.label && <Mono className="text-muted-foreground hidden text-xs sm:inline">{shortAddress(it.address)}</Mono>}
            </span>
            <Mono className="text-muted-foreground text-xs">{CHAINS[it.chain].balances ? (bal(it) === undefined ? "…" : `${fmt(bal(it))} ${CHAINS[it.chain].native}`) : "—"}</Mono>
            <span className="inline-flex w-[9.5rem] items-center justify-end gap-1">
              {showAmount && (
                <>
                  <Input inputMode="decimal" placeholder="0.0" className="h-7 w-24 text-right text-xs" value={it.max ? (resolved?.[i] !== undefined ? fmt(resolved[i]) : "max") : it.amount} disabled={it.max} onChange={(e) => onAmount(it.id, e.target.value.replace(AMOUNT_RE, ""))} />
                  {onMax && <button className={pill(it.max)} title="Send everything, leaving only the gas reserve" onClick={() => onMax(it.id, !it.max)}>Max</button>}
                </>
              )}
            </span>
            <button className="text-muted-foreground hover:text-foreground w-4" title="Take out of this basket" onClick={() => onRemove(it.id)}><X className="size-3.5" /></button>
          </li>
        ))}
        {!items.length && <li className="text-muted-foreground px-3 py-4 text-center text-xs">{empty}</li>}
      </ul>
      {footer}
    </Card>
  )
}
