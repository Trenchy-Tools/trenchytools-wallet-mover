"use client"

/** Import a wallet by its private key, for any chain (the Move page and the Wallets page both open it). */
import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { post, failureOf, walletsChanged } from "@/lib/api"
import { CHAIN_IDS, CHAINS, type ChainId } from "@/lib/chains"
import { cn } from "@/lib/cn"
import { short } from "@/lib/client"
import { DEMO } from "@/lib/browser/demo"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { Field, Input, Textarea } from "@/components/ui/input"
import { BrandIcon } from "@/components/ui/brand"
import { backupAction, toast, toastFailure } from "@/components/ui/toast"

export function ImportDialog({ open, chain, onClose, onDone }: { open: boolean; chain: ChainId; onClose: () => void; onDone: (w: { publicKey: string; chain: ChainId }) => void }) {
  const [c, setC] = useState<ChainId>(chain)
  const [secret, setSecret] = useState("")
  const [label, setLabel] = useState("")
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) { setC(chain); setSecret(""); setLabel("") } }, [open, chain])
  const submit = async () => {
    setBusy(true)
    try {
      const r = await post<{ wallet: { publicKey: string; existed: boolean } }>("/api/wallets/import", { chain: c, secret: secret.trim(), label: label.trim() || "imported" })
      toast({ tone: "ok", title: r.wallet.existed ? "That wallet was already here" : `Imported ${short(r.wallet.publicKey)}`, ...(DEMO && !r.wallet.existed ? { detail: "Download the backup to use it.", actions: [backupAction()] } : {}) })
      walletsChanged()
      onDone({ publicKey: r.wallet.publicKey, chain: c })
    } catch (e) { toastFailure(failureOf(e)) } finally { setBusy(false) }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Import a wallet">
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex flex-wrap gap-1">
          {CHAIN_IDS.map((x) => (
            <button key={x} type="button" onClick={() => setC(x)} className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs", x === c ? "border-brand bg-brand/10" : "text-muted-foreground")}>
              <BrandIcon src={CHAINS[x].logo} label={CHAINS[x].name} size={14} />{CHAINS[x].name}
            </button>
          ))}
        </div>
        <Field label="Private key" hint={CHAINS[c].kind === "sol" ? "The base58 secret key (Phantom: Settings → Show private key)" : "The 0x… private key. It works on every EVM chain here."}>
          <Textarea rows={3} value={secret} onChange={(e) => setSecret(e.target.value)} className="font-mono text-xs" spellCheck={false} />
        </Field>
        <Field label="Name (optional)"><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="imported" /></Field>
        <Button onClick={() => void submit()} disabled={busy || !secret.trim()}>{busy ? <Loader2 className="size-3.5 animate-spin" /> : null}Import</Button>
      </div>
    </Dialog>
  )
}
