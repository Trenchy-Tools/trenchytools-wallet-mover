// POST /api/wallets/archive { wallets: [{ chain, publicKey }], archived: true | false }   hide wallets from the lists (or show
// them again). Files and wallets.csv are never touched: an archived wallet is still backed up and still refuses nothing.
import { isChainId, type ChainId } from "@/lib/chains"
import { body, fail, ok } from "@/lib/http"
import { archivedKeys, setArchived } from "@/lib/settings"

export async function POST(req: Request) {
  try {
    const b = await body<{ wallets: Array<{ chain: string; publicKey: string }>; archived: boolean }>(req)
    const items = (Array.isArray(b.wallets) ? b.wallets : []).filter((w): w is { chain: ChainId; publicKey: string } => isChainId(w?.chain) && typeof w.publicKey === "string").map((w) => ({ chain: w.chain, address: w.publicKey }))
    if (!items.length) return fail(new Error("wallets is required"), 400)
    setArchived(items, b.archived !== false)
    return ok({ archived: [...archivedKeys()] })
  } catch (e) { return fail(e) }
}
