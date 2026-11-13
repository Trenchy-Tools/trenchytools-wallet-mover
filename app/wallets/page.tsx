"use client"

/**
 * Wallets: every wallet this app holds, one tab per chain, with its balance. Make one, import a key, star the main one
 * (the Move page picks it first), rename, show the key, archive. In demo mode the keys live in this browser: the
 * backup download comes before any wallet can be used (the banner and the toasts say so).
 */
import { useCallback, useEffect, useState } from "react"
import { Archive, Copy, Download, Eye, KeyRound, Loader2, Pencil, Plus, Star } from "lucide-react"
import { get, post, failureOf, walletsChanged } from "@/lib/api"
import { CHAIN_IDS, CHAINS, type ChainId } from "@/lib/chains"
import { ImportDialog } from "@/components/import-dialog"
import { cn } from "@/lib/cn"
import { copy, short } from "@/lib/client"
import { DEMO } from "@/lib/browser/demo"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Dialog } from "@/components/ui/dialog"
import { Pill } from "@/components/ui/pill"
import { BrandIcon } from "@/components/ui/brand"
import { ask } from "@/components/ui/confirm"
import { backupAction, toast, toastFailure } from "@/components/ui/toast"

type W = { publicKey: string; chain: ChainId; label: string; role: string; backedUp?: boolean; createdAt?: string }
type WalletsResp = { wallets: W[]; mainWallet: Partial<Record<ChainId, string>>; archived?: string[] }
const TABS: ChainId[] = CHAIN_IDS
const idOf = (chain: ChainId, a: string) => `${chain}:${a.toLowerCase()}`
const fmt = (n: number | null | undefined, chain: ChainId) => (n === null || n === undefined ? "–" : `${+n.toFixed(n < 1 ? 5 : 4)} ${CHAINS[chain].native}`)

export default function WalletsPage() {
  const [data, setData] = useState<WalletsResp | null>(null)
  const [bal, setBal] = useState<Map<string, number | null>>(new Map())
  const [tab, setTab] = useState<ChainId>("sol")
  const [busy, setBusy] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [keyView, setKeyView] = useState<{ w: W; key: string } | null>(null)

  const load = useCallback(async () => {
    const r = await get<WalletsResp>("/api/wallets")
    const archived = new Set((r.archived ?? []).map((x) => x.toLowerCase()))
    const wallets = r.wallets.filter((w) => !archived.has(idOf(w.chain, w.publicKey)))
    setData({ ...r, wallets })
    if (wallets.length) {
      const b = await post<{ balances: Array<{ chain: ChainId; address: string; balance: number | null }> }>("/api/wallets/balances", { wallets: wallets.map((w) => ({ chain: w.chain, address: w.publicKey })) }).catch(() => null)
      if (b) setBal(new Map(b.balances.map((x) => [idOf(x.chain, x.address), x.balance])))
    }
  }, [])
  useEffect(() => {
    void load().catch((e) => toastFailure(failureOf(e)))
    window.addEventListener("wallets-changed", load)
    return () => window.removeEventListener("wallets-changed", load)
  }, [load])

  const act = async (id: string, f: () => Promise<void>) => {
    setBusy(id)
    try { await f(); await load(); walletsChanged() } catch (e) { toastFailure(failureOf(e)) } finally { setBusy(null) }
  }
  const list = (data?.wallets ?? []).filter((w) => w.chain === tab)
  const main = data?.mainWallet?.[tab]
  const total = list.reduce((s, w) => s + (bal.get(idOf(w.chain, w.publicKey)) ?? 0), 0)

  const make = () => act("new", async () => {
    const r = await post<{ wallets: W[] }>("/api/wallets", { count: 1, chain: tab })
    toast({ tone: "ok", title: `New ${CHAINS[tab].name} wallet: ${short(r.wallets[0]?.publicKey ?? "")}`, detail: DEMO ? "Download the backup before you send anything to it." : `Saved to its file in your wallet folder.`, ...(DEMO ? { actions: [backupAction()] } : {}) })
  })
  const star = (w: W) => act(`star:${w.publicKey}`, async () => { await post("/api/wallets/main", { chain: w.chain, publicKey: w.publicKey }) })
  const rename = (w: W) => {
    const label = window.prompt("Name this wallet", w.label)?.trim()
    if (!label || label === w.label) return
    void act(`rename:${w.publicKey}`, async () => { await post("/api/wallets/rename", { chain: w.chain, publicKey: w.publicKey, label }) })
  }
  const archive = async (w: W) => {
    const b = bal.get(idOf(w.chain, w.publicKey)) ?? 0
    if (!(await ask(b > 0 ? `${w.label} still holds ${fmt(b, w.chain)}. Archive it anyway? (Its key stays saved; it is only hidden.)` : `Archive ${w.label}? Its key stays saved; it is only hidden from the lists.`, { confirmLabel: "Archive" }))) return
    void act(`archive:${w.publicKey}`, async () => { await post("/api/wallets/archive", { wallets: [{ chain: w.chain, publicKey: w.publicKey }], archived: true }) })
  }
  const showKey = async (w: W) => {
    if (!(await ask(`Show the private key of ${w.label}? Anyone who sees it controls the wallet.`, { confirmLabel: "Show key", danger: true }))) return
    try { const r = await post<{ privateKey: string }>("/api/wallets/key", { chain: w.chain, publicKey: w.publicKey }); setKeyView({ w, key: r.privateKey }) } catch (e) { toastFailure(failureOf(e)) }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Wallets</h1>
          <p className="text-muted-foreground text-sm">{DEMO ? "The keys live in this browser. Download the backup before you fund anything." : "Each wallet is a file in your wallet folder."} One 0x key works on every EVM chain (Robinhood, Ethereum, Base, BNB, Arc, Elysium).</p>
        </div>
        <div className="flex gap-2">
          {DEMO && <Button variant="outline" size="sm" onClick={() => void backupAction().run()}><Download className="size-3.5" />Download backup</Button>}
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}><KeyRound className="size-3.5" />Import</Button>
          <Button size="sm" className="bg-brand text-white hover:bg-brand hover:opacity-90" onClick={() => void make()} disabled={busy === "new"}>{busy === "new" ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}New {CHAINS[tab].name} wallet</Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {TABS.map((c) => {
          const n = (data?.wallets ?? []).filter((w) => w.chain === c).length
          return (
            <button key={c} type="button" onClick={() => setTab(c)} className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors", c === tab ? "border-brand bg-brand/10" : "text-muted-foreground hover:text-foreground")}>
              <BrandIcon src={CHAINS[c].logo} label={CHAINS[c].name} size={16} />{CHAINS[c].name}<span className="text-muted-foreground text-xs">{n}</span>
            </button>
          )
        })}
      </div>

      <Card className="gap-0 p-0">
        <div className="text-muted-foreground flex items-center justify-between border-b px-4 py-2 text-xs">
          <span>{list.length} wallet{list.length === 1 ? "" : "s"} on {CHAINS[tab].name}</span>
          <span className="font-mono">{fmt(total, tab)}</span>
        </div>
        {!data ? <div className="text-muted-foreground flex items-center gap-2 p-4 text-sm"><Loader2 className="size-4 animate-spin" /> Loading…</div>
          : !list.length ? <div className="text-muted-foreground p-6 text-center text-sm">No {CHAINS[tab].name} wallet yet. Press <b>New {CHAINS[tab].name} wallet</b> or import a key.</div>
          : list.map((w) => {
            const b = bal.get(idOf(w.chain, w.publicKey))
            return (
              <div key={w.publicKey} className="flex items-center gap-3 border-b px-4 py-2.5 text-sm last:border-0">
                <button type="button" title={w.publicKey === main ? "Main wallet (picked first on the Move page)" : "Make it the main wallet"} onClick={() => void star(w)} className="shrink-0">
                  <Star className={cn("size-4", w.publicKey === main ? "fill-brand text-brand" : "text-muted-foreground hover:text-foreground")} />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 font-medium">{w.label}{w.backedUp === false && <Pill tone="warn" className="text-[10px]">not backed up</Pill>}</div>
                  <button type="button" onClick={() => { void copy(w.publicKey); toast({ tone: "muted", title: "Address copied" }) }} className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 font-mono text-xs">{short(w.publicKey, 6)}<Copy className="size-3" /></button>
                </div>
                <span className={cn("font-mono tabular-nums", (b ?? 0) > 0 ? "" : "text-muted-foreground")}>{fmt(b, w.chain)}</span>
                <div className="flex shrink-0 gap-0.5">
                  <Button variant="ghost" size="icon-sm" title="Rename" onClick={() => rename(w)}><Pencil className="size-3.5" /></Button>
                  <Button variant="ghost" size="icon-sm" title="Show the private key" onClick={() => void showKey(w)}><Eye className="size-3.5" /></Button>
                  <Button variant="ghost" size="icon-sm" title="Archive (hide)" onClick={() => void archive(w)} disabled={busy === `archive:${w.publicKey}`}><Archive className="size-3.5" /></Button>
                </div>
              </div>
            )
          })}
      </Card>

      <ImportDialog open={importOpen} chain={tab} onClose={() => setImportOpen(false)} onDone={() => { setImportOpen(false); void load(); walletsChanged() }} />
      <Dialog open={!!keyView} onClose={() => setKeyView(null)} title={keyView ? `Private key · ${keyView.w.label}` : ""}>
        {keyView && (
          <div className="flex flex-col gap-3 text-sm">
            <p className="text-muted-foreground">Anyone with this key controls the wallet. Never paste it into a website you do not trust.</p>
            <code className="bg-muted rounded-md p-3 font-mono text-xs break-all">{keyView.key}</code>
            <Button variant="outline" onClick={() => { void copy(keyView.key); toast({ tone: "muted", title: "Key copied" }) }}><Copy className="size-3.5" />Copy key</Button>
          </div>
        )}
      </Dialog>
    </div>
  )
}

