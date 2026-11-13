"use client"

/**
 * Move: pick where the money comes from, where it goes, how much. The route picks itself: the same chain is one direct
 * transfer (optionally through an exchange so the two wallets are not linked), two chains always go through an exchange
 * (SOL → ETH, Robinhood ETH → SOL, …), with the live quote of what arrives. One button; then each step is shown as it
 * happens. Everything runs through POST /api/move/run (lib/core/runner.ts), the same in local and demo mode.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { ArrowDown, ArrowDownUp, Check, ClipboardPaste, ExternalLink, KeyRound, Loader2, Plus, ShieldCheck, Star, Wallet, X } from "lucide-react"
import { get, post, failureOf, walletsChanged } from "@/lib/api"
import { CHAIN_IDS, CHAINS, looksLikeAddress, type ChainId } from "@/lib/chains"
import { cn } from "@/lib/cn"
import { short, copy } from "@/lib/client"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Pill } from "@/components/ui/pill"
import { Toggle } from "@/components/ui/toggle"
import { BrandIcon } from "@/components/ui/brand"
import { backupAction, toast, toastFailure } from "@/components/ui/toast"
import { ImportDialog } from "@/components/import-dialog"

type W = { publicKey: string; chain: ChainId; label: string; role: string; backedUp?: boolean; /** listed on another EVM chain: the same key, saved for this chain */ via?: ChainId }
type WalletsResp = { wallets: W[]; mainWallet: Partial<Record<ChainId, string>>; archived?: string[] }
type Quote = { route: "direct" | "exchange"; mode: string | null; venue: string | null; status?: string; receive: number; fee: number; networkFee?: number; etaS: number; min?: number; max?: number; note?: string }
type Leg = { index: number; status: string; amount: number; route: "direct" | "exchange"; from: { chain: ChainId; address: string; label?: string }; to: { chain: ChainId; address: string; label?: string }; depositHash?: string | null; payoutHash?: string | null; expectedReceive?: number | null; error?: string; hint?: string; receipt?: string }
type Job = { id: string; status: "preflight" | "running" | "done" | "failed"; message?: string; legs: Leg[] }

const SOURCES: ChainId[] = CHAIN_IDS.filter((c) => CHAINS[c].source)
const ALL: ChainId[] = CHAIN_IDS
const idOf = (chain: ChainId, a: string) => `${chain}:${a.toLowerCase()}`
const fmt = (n: number | null | undefined, chain: ChainId) => (n === null || n === undefined ? "–" : `${+n.toFixed(n < 1 ? 5 : 4)} ${CHAINS[chain].native}`)
const eta = (s: number) => (s < 90 ? `about ${Math.max(5, Math.round(s / 5) * 5)} seconds` : `about ${Math.round(s / 60)} minutes`)
const DONE = new Set(["completed", "confirmed"])
const EVM: ChainId[] = CHAIN_IDS.filter((c) => CHAINS[c].kind === "evm")
const an = (name: string) => `${/^[AEIOU]/.test(name) ? "an" : "a"} ${name}`
const BAD = new Set(["failed", "expired", "refunded", "cancelled", "refused", "stuck"])

export default function MovePage() {
  const [data, setData] = useState<WalletsResp | null>(null)
  const [bal, setBal] = useState<Map<string, number | null>>(new Map())
  const [fromChain, setFromChain] = useState<ChainId>("sol")
  const [fromPk, setFromPk] = useState<string | null>(null)
  const [toChain, setToChain] = useState<ChainId>("rh")
  const [toKind, setToKind] = useState<"mine" | "paste">("mine")
  const [toPk, setToPk] = useState<string | null>(null)
  const [pasted, setPasted] = useState("")
  const [amount, setAmount] = useState("")
  const [isMax, setIsMax] = useState(false)
  const [privateHop, setPrivateHop] = useState(false)
  const [quote, setQuote] = useState<{ q: Quote | null; error?: string; loading: boolean } | null>(null)
  const [job, setJob] = useState<Job | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [importFor, setImportFor] = useState<{ side: "from" | "to"; chain: ChainId } | null>(null)

  // ── wallets + balances ─────────────────────────────────────────────────────
  const load = useCallback(async () => {
    const r = await get<WalletsResp>("/api/wallets")
    const archived = new Set((r.archived ?? []).map((x) => x.toLowerCase()))
    const wallets = r.wallets.filter((w) => !archived.has(idOf(w.chain, w.publicKey)) && w.role !== "relay")
    setData({ ...r, wallets })
    if (wallets.length) {
      // an EVM key is the same address on every EVM chain: read each EVM wallet on all three
      const items = new Map<string, { chain: ChainId; address: string }>()
      for (const w of wallets) for (const c of CHAINS[w.chain].kind === "evm" ? EVM : [w.chain]) items.set(idOf(c, w.publicKey), { chain: c, address: w.publicKey })
      const b = await post<{ balances: Array<{ chain: ChainId; address: string; balance: number | null }> }>("/api/wallets/balances", { wallets: [...items.values()] }).catch(() => null)
      if (b) setBal(new Map(b.balances.map((x) => [idOf(x.chain, x.address), x.balance])))
    }
  }, [])
  useEffect(() => {
    void load().catch((e) => toastFailure(failureOf(e)))
    window.addEventListener("wallets-changed", load)
    return () => window.removeEventListener("wallets-changed", load)
  }, [load])

  const walletsOn = useCallback((c: ChainId) => {
    const all = data?.wallets ?? []
    const list: W[] = all.filter((w) => w.chain === c)
    if (CHAINS[c].kind === "evm") for (const w of all) if (w.chain !== c && CHAINS[w.chain].kind === "evm" && !list.some((x) => x.publicKey.toLowerCase() === w.publicKey.toLowerCase())) list.push({ ...w, chain: c, via: w.chain })
    const main = data?.mainWallet?.[c]
    return [...list].sort((a, b) => (a.publicKey === main ? -1 : b.publicKey === main ? 1 : (bal.get(idOf(b.chain, b.publicKey)) ?? 0) - (bal.get(idOf(a.chain, a.publicKey)) ?? 0)))
  }, [data, bal])

  // sensible defaults: the main (else the richest) wallet on each side, never the same wallet twice
  useEffect(() => {
    if (!data) return
    const froms = walletsOn(fromChain)
    if (!fromPk || !froms.some((w) => w.publicKey === fromPk)) setFromPk(froms[0]?.publicKey ?? null)
  }, [data, fromChain, fromPk, walletsOn])
  useEffect(() => {
    if (!data) return
    const tos = walletsOn(toChain).filter((w) => !(toChain === fromChain && w.publicKey === fromPk))
    if (!toPk || !tos.some((w) => w.publicKey === toPk)) setToPk(tos[0]?.publicKey ?? null)
  }, [data, toChain, fromChain, fromPk, toPk, walletsOn])

  const fromW = walletsOn(fromChain).find((w) => w.publicKey === fromPk) ?? null
  const fromBal = fromW ? bal.get(idOf(fromChain, fromW.publicKey)) ?? null : null
  const reserve = CHAINS[fromChain].gasReserve
  const maxAmt = fromBal !== null ? Math.max(0, +(fromBal - reserve).toFixed(6)) : 0
  const toAddress = toKind === "paste" ? pasted.trim() : toPk ?? ""
  const toValid = !!toAddress && looksLikeAddress(toChain, toAddress) && !(toChain === fromChain && toAddress.toLowerCase() === (fromPk ?? "").toLowerCase())
  const toW = walletsOn(toChain).find((w) => w.publicKey.toLowerCase() === toAddress.toLowerCase()) ?? null
  const amt = isMax ? maxAmt : Number(amount)
  const sameChain = fromChain === toChain
  const route: "direct" | "exchange" = sameChain && !privateHop ? "direct" : "exchange"

  // ── the live quote (exchange routes) ───────────────────────────────────────
  const qSeq = useRef(0)
  useEffect(() => {
    if (route !== "exchange" || !(amt > 0)) { setQuote(null); return }
    const seq = ++qSeq.current
    setQuote((q) => ({ q: q?.q ?? null, loading: true }))
    const t = setTimeout(async () => {
      try {
        const r = await get<{ routes: Quote[]; exchange?: string }>(`/api/transfer/routes?from=${fromChain}&to=${toChain}&amount=${amt}`)
        if (seq !== qSeq.current) return
        const ex = r.routes.filter((x) => x.route === "exchange")
        const q = ex.find((x) => x.venue === "auto" && x.mode === "float") ?? ex.find((x) => x.venue === "auto") ?? ex[0] ?? null
        setQuote({ q, loading: false, error: q ? undefined : r.exchange === "off" ? "The exchange route is off right now." : `No exchange route from ${CHAINS[fromChain].name} to ${CHAINS[toChain].name} right now.` })
      } catch (e) { if (seq === qSeq.current) setQuote({ q: null, loading: false, error: failureOf(e).error }) }
    }, 500)
    return () => clearTimeout(t)
  }, [route, amt, fromChain, toChain])

  // ── what stops the button ──────────────────────────────────────────────────
  const problem = !data ? "Loading your wallets…"
    : !fromW ? `Make ${an(CHAINS[fromChain].name)} wallet to send from`
    : !toAddress ? (toKind === "paste" ? "Paste the address to send to" : `Pick or make ${an(CHAINS[toChain].name)} wallet to send to`)
    : !toValid ? (toChain === fromChain && toAddress.toLowerCase() === (fromPk ?? "").toLowerCase() ? "From and To are the same wallet" : `That is not a ${CHAINS[toChain].name} address`)
    : !(amt > 0) ? (isMax ? "Nothing to send: the wallet is empty after the network fee" : "Type an amount")
    : fromBal !== null && amt > maxAmt + 1e-9 ? `More than the wallet holds (${fmt(maxAmt, fromChain)} after the network fee)`
    : route === "exchange" && quote?.loading ? "Getting a quote…"
    : route === "exchange" && quote?.error ? quote.error
    : route === "exchange" && quote?.q?.min !== undefined && amt < quote.q.min ? `The exchange takes at least ${fmt(quote.q.min, fromChain)}`
    : route === "exchange" && quote?.q?.status === "closed" ? "The exchange route is closed right now: try again in a few minutes"
    : null

  // ── run + follow ───────────────────────────────────────────────────────────
  const running = job && (job.status === "preflight" || job.status === "running")
  useEffect(() => {
    if (!job || !running) return
    const t = setInterval(async () => {
      try {
        const r = await get<{ job: Job }>(`/api/move/run/${job.id}`)
        setJob(r.job)
        if (r.job.status === "done" || r.job.status === "failed") { walletsChanged(); void load() }
      } catch { /* next tick */ }
    }, 2000)
    return () => clearInterval(t)
  }, [job, running, load])

  const move = async () => {
    if (problem || !fromW) return
    setBusy("move")
    try {
      const r = await post<{ job: Job }>("/api/move/run", {
        from: [{ chain: fromChain, address: fromW.publicKey, label: fromW.label, ours: true }],
        to: [{ chain: toChain, address: toAddress, label: toW?.label, ours: !!toW }],
        amounts: [isMax ? "max" : amt],
        route, mode: "float", venue: "auto",
      })
      setJob(r.job)
    } catch (e) {
      const f = failureOf(e)
      toastFailure(f, f.code === "not_backed_up" ? "Download your backup first" : "The move did not start")
    } finally { setBusy(null) }
  }

  const makeWallet = async (chain: ChainId, side: "from" | "to") => {
    setBusy(`new:${chain}`)
    try {
      const r = await post<{ wallets: W[] }>("/api/wallets", { count: 1, chain })
      await load()
      walletsChanged()
      const w = r.wallets[0]
      if (w) { if (side === "from") setFromPk(w.publicKey); else { setToKind("mine"); setToPk(w.publicKey) } }
      toast({ tone: "ok", title: `New ${CHAINS[chain].name} wallet: ${short(w?.publicKey ?? "")}`, detail: "Download the backup before you send anything to it.", actions: [backupAction()] })
    } catch (e) { toastFailure(failureOf(e)) } finally { setBusy(null) }
  }

  const flip = () => {
    if (!SOURCES.includes(toChain) || toKind !== "mine" || !toPk) return
    const fc = fromChain, fp = fromPk
    setFromChain(toChain); setFromPk(toPk); setToChain(fc); setToPk(fp); setAmount(""); setIsMax(false)
  }

  const summary = route === "direct"
    ? { title: "Direct transfer", detail: `Arrives in a few seconds. Only the ${CHAINS[fromChain].name} network fee.` }
    : { title: "Through an exchange", detail: sameChain ? "The two wallets are not linked on chain: the exchange pays the destination." : `${CHAINS[fromChain].native} on ${CHAINS[fromChain].name} becomes ${CHAINS[toChain].native} on ${CHAINS[toChain].name}.` }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-3">
      <div className="mb-1">
        <h1 className="text-xl font-semibold tracking-tight">Move</h1>
        <p className="text-muted-foreground text-sm">Pick where it comes from and where it goes. The route picks itself.</p>
      </div>

      {/* FROM */}
      <Card className="gap-3 p-4">
        <SideHead label="From" chains={SOURCES} chain={fromChain} onChain={(c) => { setFromChain(c); setAmount(""); setIsMax(false) }} />
        <WalletList chain={fromChain} wallets={walletsOn(fromChain)} main={data?.mainWallet?.[fromChain]} bal={bal} selected={fromPk} onSelect={setFromPk} loading={!data}
          empty={<EmptySide chain={fromChain} busy={busy === `new:${fromChain}`} onMake={() => void makeWallet(fromChain, "from")} onImport={() => setImportFor({ side: "from", chain: fromChain })} hint="then send it some to start" />} />
        {walletsOn(fromChain).length > 0 && <AddRow chain={fromChain} busy={busy === `new:${fromChain}`} onMake={() => void makeWallet(fromChain, "from")} onImport={() => setImportFor({ side: "from", chain: fromChain })} />}
      </Card>

      <div className="relative z-10 -my-5 flex justify-center">
        <button type="button" onClick={flip} disabled={!SOURCES.includes(toChain) || toKind !== "mine" || !toPk} title={SOURCES.includes(toChain) ? "Swap From and To" : `${CHAINS[toChain].name} can only receive`}
          className="bg-background hover:bg-muted disabled:hover:bg-background inline-flex size-9 items-center justify-center rounded-full border shadow-sm transition-colors disabled:opacity-60">
          {SOURCES.includes(toChain) && toKind === "mine" && toPk ? <ArrowDownUp className="size-4" /> : <ArrowDown className="size-4" />}
        </button>
      </div>

      {/* TO */}
      <Card className="gap-3 p-4">
        <SideHead label="To" chains={ALL} chain={toChain} onChain={setToChain} />
        <div className="bg-muted inline-flex w-fit rounded-lg p-0.5 text-sm">
          {(["mine", "paste"] as const).map((k) => (
            <button key={k} type="button" onClick={() => setToKind(k)} className={cn("rounded-md px-3 py-1 transition-colors", toKind === k ? "bg-background shadow-xs" : "text-muted-foreground hover:text-foreground")}>
              {k === "mine" ? "My wallet" : "Another address"}
            </button>
          ))}
        </div>
        {toKind === "mine" ? (
          <WalletList chain={toChain} wallets={walletsOn(toChain).filter((w) => !(toChain === fromChain && w.publicKey === fromPk))} main={data?.mainWallet?.[toChain]} bal={bal} selected={toPk} onSelect={setToPk} loading={!data}
            empty={<EmptySide chain={toChain} busy={busy === `new:${toChain}`} onMake={() => void makeWallet(toChain, "to")} onImport={() => setImportFor({ side: "to", chain: toChain })} hint="a fresh wallet to receive in" />} />
        ) : null}
        {toKind === "mine" && walletsOn(toChain).filter((w) => !(toChain === fromChain && w.publicKey === fromPk)).length > 0 && <AddRow chain={toChain} busy={busy === `new:${toChain}`} onMake={() => void makeWallet(toChain, "to")} onImport={() => setImportFor({ side: "to", chain: toChain })} />}
        {toKind === "mine" ? null : (
          <div className="flex gap-2">
            <Input autoFocus placeholder={CHAINS[toChain].kind === "sol" ? "Solana address" : "0x… address"} value={pasted} onChange={(e) => setPasted(e.target.value)} className={cn("font-mono text-sm", pasted && !looksLikeAddress(toChain, pasted.trim()) && "border-destructive")} spellCheck={false} />
            <Button variant="outline" size="icon" title="Paste" onClick={async () => { try { setPasted((await navigator.clipboard.readText()).trim()) } catch { /* no clipboard permission */ } }}><ClipboardPaste className="size-4" /></Button>
          </div>
        )}
      </Card>

      {/* AMOUNT */}
      <Card className="gap-3 p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">Amount</span>
          {fromW && <span className="text-muted-foreground">Balance {fmt(fromBal, fromChain)}</span>}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Input inputMode="decimal" placeholder="0.0" value={isMax ? String(maxAmt) : amount} onChange={(e) => { setIsMax(false); setAmount(e.target.value.replace(",", ".")) }} className="h-12 pr-16 text-xl font-semibold tabular-nums" />
            <span className="text-muted-foreground absolute top-1/2 right-3 -translate-y-1/2 text-sm font-medium">{CHAINS[fromChain].native}</span>
          </div>
          {[25, 50].map((p) => (
            <Button key={p} variant="outline" size="sm" className="h-12" disabled={!maxAmt} onClick={() => { setIsMax(false); setAmount(String(+(maxAmt * p / 100).toFixed(6))) }}>{p}%</Button>
          ))}
          <Button variant={isMax ? "default" : "outline"} size="sm" className="h-12" disabled={!maxAmt} onClick={() => setIsMax(true)}>Max</Button>
        </div>
      </Card>

      {/* ROUTE */}
      <div className="flex flex-col gap-2 rounded-xl border border-dashed p-3 text-sm">
        <div className="flex items-start gap-2">
          <ShieldCheck className="text-brand mt-0.5 size-4 shrink-0" />
          <div className="flex-1">
            <div className="font-medium">{summary.title}</div>
            <div className="text-muted-foreground">{summary.detail}</div>
          </div>
        </div>
        {route === "exchange" && amt > 0 && (
          <div className="bg-muted/60 flex items-center justify-between rounded-lg px-3 py-2">
            <span className="text-muted-foreground">You get about</span>
            <span className="font-semibold tabular-nums">
              {quote?.loading ? <Loader2 className="size-4 animate-spin" /> : quote?.q ? `${fmt(quote.q.receive, toChain)} · ${eta(quote.q.etaS)}` : "–"}
            </span>
          </div>
        )}
        {sameChain && <Toggle checked={privateHop} onChange={setPrivateHop} label={<span className="text-muted-foreground">Don&apos;t link the two wallets (go through an exchange)</span>} />}
      </div>

      <Button size="lg" className="bg-brand h-12 text-base text-white hover:opacity-90 hover:bg-brand" disabled={!!problem || !!busy || !!running} onClick={() => void move()}>
        {busy === "move" ? <Loader2 className="size-4 animate-spin" /> : null}
        {problem ?? `Move ${isMax ? "everything" : `${+amt.toFixed(6)} ${CHAINS[fromChain].native}`} → ${toW ? toW.label : CHAINS[toChain].name}`}
      </Button>

      {job && <Progress job={job} onClose={() => setJob(null)} />}

      <ImportDialog open={!!importFor} chain={importFor?.chain ?? fromChain} onClose={() => setImportFor(null)} onDone={async (w) => {
        const side = importFor?.side
        setImportFor(null)
        await load()
        if (side === "from") { setFromChain(w.chain); setFromPk(w.publicKey) } else if (side === "to") { setToChain(w.chain); setToKind("mine"); setToPk(w.publicKey) }
      }} />

      <p className="text-muted-foreground px-1 text-center text-xs">
        Need many wallets at once (fund ten from one, sweep them back)? That is coming here next. Your moves are on the <Link href="/history" className="underline underline-offset-4">History</Link> page.
      </p>
    </div>
  )
}

function SideHead({ label, chains, chain, onChain, note }: { label: string; chains: ChainId[]; chain: ChainId; onChain: (c: ChainId) => void; note?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">{label}</span>
      <div className="flex flex-wrap items-center gap-1" title={note}>
        {chains.map((c) => (
          <button key={c} type="button" onClick={() => onChain(c)}
            className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors", c === chain ? "border-brand bg-brand/10 text-foreground" : "text-muted-foreground hover:text-foreground")}>
            <BrandIcon src={CHAINS[c].logo} label={CHAINS[c].name} size={14} />{CHAINS[c].name}
          </button>
        ))}
      </div>
    </div>
  )
}

function WalletList({ chain, wallets, main, bal, selected, onSelect, empty, loading }: { chain: ChainId; wallets: W[]; main?: string; bal: Map<string, number | null>; selected: string | null; onSelect: (pk: string) => void; empty: React.ReactNode; loading: boolean }) {
  if (loading) return <div className="text-muted-foreground flex items-center gap-2 py-3 text-sm"><Loader2 className="size-4 animate-spin" /> Loading wallets…</div>
  if (!wallets.length) return <>{empty}</>
  return (
    <div className="flex max-h-56 flex-col gap-1 overflow-y-auto">
      {wallets.map((w) => {
        const on = w.publicKey === selected
        const b = bal.get(idOf(chain, w.publicKey))
        return (
          <button key={w.publicKey} type="button" onClick={() => onSelect(w.publicKey)}
            className={cn("flex items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors", on ? "border-brand bg-brand/5" : "hover:bg-muted border-transparent")}>
            <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-full border", on && "border-brand bg-brand text-white")}>{on && <Check className="size-3" />}</span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 font-medium">{w.label}{w.publicKey === main && <Star className="fill-brand text-brand size-3" />}{w.via && <span className="text-muted-foreground text-[11px] font-normal">same key as on {CHAINS[w.via].name}</span>}{w.backedUp === false && <Pill tone="warn" className="text-[10px]">not backed up</Pill>}</span>
              <span className="text-muted-foreground font-mono text-xs">{short(w.publicKey, 5)}</span>
            </span>
            <span className={cn("font-mono text-sm tabular-nums", (b ?? 0) > 0 ? "" : "text-muted-foreground")}>{fmt(b, chain)}</span>
          </button>
        )
      })}
    </div>
  )
}

function EmptySide({ chain, busy, onMake, onImport, hint }: { chain: ChainId; busy: boolean; onMake: () => void; onImport: () => void; hint: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-5 text-center text-sm">
      <Wallet className="text-muted-foreground size-5" />
      <span className="text-muted-foreground">No {CHAINS[chain].name} wallet yet</span>
      <div className="flex gap-2">
        <Button size="sm" onClick={onMake} disabled={busy}>{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}Make one</Button>
        <Button size="sm" variant="outline" onClick={onImport}><KeyRound className="size-3.5" />Import a key</Button>
      </div>
      <span className="text-muted-foreground text-xs">{hint}</span>
    </div>
  )
}

/** Under a wallet list: make another wallet on this chain, or import one, without leaving the page. */
function AddRow({ chain, busy, onMake, onImport }: { chain: ChainId; busy: boolean; onMake: () => void; onImport: () => void }) {
  return (
    <div className="flex gap-3 px-1 text-xs">
      <button type="button" onClick={onMake} disabled={busy} className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1">{busy ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}New {CHAINS[chain].name} wallet</button>
      <button type="button" onClick={onImport} className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1"><KeyRound className="size-3" />Import a key</button>
    </div>
  )
}

/** The running move, leg by leg: sent → (exchange) swapping → arrived. */
function Progress({ job, onClose }: { job: Job; onClose: () => void }) {
  const done = job.status === "done", failed = job.status === "failed"
  return (
    <Card className={cn("gap-3 p-4", done && "border-ok/50", failed && "border-destructive/50")}>
      <div className="flex items-center justify-between">
        <span className="font-medium">{done ? "Done" : failed ? "The move stopped" : "Moving…"}</span>
        {(done || failed) && <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close"><X className="size-4" /></button>}
      </div>
      {job.message && <p className={cn("text-sm", failed ? "text-destructive" : "text-muted-foreground")}>{job.message}</p>}
      {job.legs.map((l) => {
        const ex = l.route === "exchange"
        const steps = ex ? ["Sent to the exchange", "Exchanging", "Arrived"] : ["Sent", "Arrived"]
        const at = DONE.has(l.status) ? steps.length : ex ? (["exchanging", "awaiting_deposit"].includes(l.status) && l.depositHash ? (l.status === "exchanging" ? 2 : 1) : l.depositHash || l.status === "sent" ? 1 : 0) : l.status === "sent" ? 1 : 0
        const bad = BAD.has(l.status)
        return (
          <div key={l.index} className="flex flex-col gap-2 text-sm">
            <div className="text-muted-foreground">{fmt(l.amount, l.from.chain)} · {l.from.label ?? short(l.from.address)} → {l.to.label ?? short(l.to.address)} on {CHAINS[l.to.chain].name}{l.expectedReceive ? ` (≈ ${fmt(l.expectedReceive, l.to.chain)})` : ""}</div>
            <ol className="flex items-center gap-2">
              {steps.map((s, i) => (
                <li key={s} className="flex flex-1 items-center gap-1.5">
                  <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px]", i < at ? "border-ok bg-ok text-white" : i === at && !bad && !DONE.has(l.status) ? "border-brand" : "", bad && i === at && "border-destructive bg-destructive text-white")}>
                    {i < at ? <Check className="size-3" /> : i === at && !bad && !DONE.has(l.status) ? <Loader2 className="text-brand size-3 animate-spin" /> : bad && i === at ? <X className="size-3" /> : i + 1}
                  </span>
                  <span className={cn("text-xs", i < at ? "" : "text-muted-foreground")}>{s}</span>
                  {i < steps.length - 1 && <span className={cn("h-px flex-1", i < at - 1 ? "bg-ok" : "bg-border")} />}
                </li>
              ))}
            </ol>
            {(l.error || l.receipt) && <p className={cn("text-xs", l.error ? "text-destructive" : "text-muted-foreground")}>{l.error ?? l.receipt}{l.hint ? ` · ${l.hint}` : ""}</p>}
            <div className="flex flex-wrap gap-3 text-xs">
              {l.depositHash && <a className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 underline-offset-4 hover:underline" href={`${CHAINS[l.from.chain].explorerTx}${l.depositHash}`} target="_blank" rel="noreferrer">sent <ExternalLink className="size-3" /></a>}
              {l.payoutHash && <a className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 underline-offset-4 hover:underline" href={`${CHAINS[l.to.chain].explorerTx}${l.payoutHash}`} target="_blank" rel="noreferrer">arrived <ExternalLink className="size-3" /></a>}
              <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => void copy(l.to.address)}>copy destination</button>
            </div>
          </div>
        )
      })}
      {(done || failed) && <Link href="/history" className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline">See it in History</Link>}
    </Card>
  )
}
