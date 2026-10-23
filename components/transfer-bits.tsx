import { ExternalLink } from "lucide-react"
import { Badge, ChainMark, statusTone } from "./ui/card"
import { Mono } from "./ui/table"
import { CHAINS, shortAddress, type ChainId } from "@/lib/chains"
import type { TransferHelp } from "@/lib/trenchy"

/** A transaction hash as a short explorer link. */
export function HashLink({ chain, hash, label }: { chain: ChainId | string; hash: string | null | undefined; label?: string }) {
  if (!hash) return <span className="text-muted-foreground">—</span>
  const c = CHAINS[chain as ChainId]
  return (
    <a href={c ? `${c.explorerTx}${hash}` : "#"} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline-offset-2 hover:underline" title={hash}>
      <Mono>{label ?? shortAddress(hash, 6)}</Mono><ExternalLink className="size-3" />
    </a>
  )
}

/** chain mark + label/address. */
export function Party({ chain, address, label }: { chain: ChainId | string; address: string; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5" title={address}>
      <ChainMark chain={chain} />
      <span className="truncate">{label ?? <Mono>{shortAddress(address)}</Mono>}</span>
    </span>
  )
}

export const StatusBadge = ({ status }: { status: string }) => <Badge tone={statusTone(status)}>{status.replace(/_/g, " ")}</Badge>

/** The API's `help` block for a stuck or failed exchange leg, shown as it came. */
export function HelpBlock({ help }: { help: TransferHelp | undefined }) {
  if (!help) return null
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">
      <p className="font-medium">{help.why}</p>
      <p className="text-muted-foreground mt-1">{help.whatToDo}</p>
      <p className="mt-1 flex flex-wrap gap-x-3">
        {help.receipt && <a className="underline underline-offset-2" href={help.receipt} target="_blank" rel="noreferrer">receipt page</a>}
        <a className="underline underline-offset-2" href={help.support.trenchytools} target="_blank" rel="noreferrer">TrenchyTools support</a>
        <a className="underline underline-offset-2" href={help.support.exchangeRoute.telegram} target="_blank" rel="noreferrer">exchange route · Telegram</a>
        <a className="underline underline-offset-2" href={`mailto:${help.support.exchangeRoute.email}`}>{help.support.exchangeRoute.email}</a>
      </p>
      {help.orderId && <p className="mt-1">order <Mono>{help.orderId}</Mono></p>}
      <p className="text-muted-foreground mt-1">Include: {help.support.include.join(" · ")}</p>
      <p className="mt-1 text-amber-700 dark:text-amber-300">{help.warning}</p>
    </div>
  )
}
