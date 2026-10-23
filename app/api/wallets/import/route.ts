// POST /api/wallets/import { secret, chain, role, label }   a base58 (Solana) or 0x (EVM) secret → written to the folder first, like a created one
import { isChainId } from "@/lib/chains"
import { body, fail, ok, str } from "@/lib/http"
import { BACKUP_DIR } from "@/lib/paths"
import { importWallet, isRole } from "@/lib/wallets"

export async function POST(req: Request) {
  try {
    const b = await body<{ secret: string; chain: string; role: string; label: string }>(req)
    if (!isChainId(b.chain)) return fail(new Error("chain must be sol, rh, eth or bnb"), 400)
    if (!str(b.secret)) return fail(new Error("secret is required"), 400)
    const role = isRole(b.role) ? b.role : "trader"
    const wallet = importWallet(str(b.secret), b.chain, role, str(b.label) || "imported")
    return ok({ dir: BACKUP_DIR, wallet })
  } catch (e) { return fail(e, 400) }
}
