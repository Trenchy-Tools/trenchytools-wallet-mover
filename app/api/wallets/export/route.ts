// POST /api/wallets/export { wallets: [{ chain, publicKey }] }   a CSV copy of the chosen rows, KEYS INCLUDED (the UI confirms first)
import { isChainId, type ChainId } from "@/lib/chains"
import { body, fail } from "@/lib/http"
import { exportCsv } from "@/lib/wallets"

export async function POST(req: Request) {
  try {
    const b = await body<{ wallets: Array<{ chain: string; publicKey: string }> }>(req)
    const items = (Array.isArray(b.wallets) ? b.wallets : []).filter((w): w is { chain: ChainId; publicKey: string } => isChainId(w?.chain) && typeof w.publicKey === "string")
    return new Response(exportCsv(items), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="wallets-export-${new Date().toISOString().slice(0, 10)}.csv"` } })
  } catch (e) { return fail(e) }
}
