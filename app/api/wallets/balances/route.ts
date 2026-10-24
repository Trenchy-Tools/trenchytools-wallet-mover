// POST /api/wallets/balances { wallets: [{ chain, address }] }   native balances: GET /api/sol/balances?wallets= and GET /api/rh/balances?wallets=
// eth / bnb balances are not available through the API and come back as null (shown as "—").
import { isChainId, type ChainId } from "@/lib/chains"
import { body, fail, ok } from "@/lib/http"
import { balancesFor } from "@/lib/core/runner"
import { trenchy } from "@/lib/settings"

export async function POST(req: Request) {
  try {
    const b = await body<{ wallets: Array<{ chain: string; address: string }> }>(req)
    const items = (Array.isArray(b.wallets) ? b.wallets : []).filter((w): w is { chain: ChainId; address: string } => isChainId(w?.chain) && typeof w.address === "string")
    const map = await balancesFor(trenchy(), items)
    return ok({ balances: items.map((i) => ({ ...i, balance: map.get(`${i.chain}:${i.address.toLowerCase()}`) ?? null })) })
  } catch (e) { return fail(e) }
}
