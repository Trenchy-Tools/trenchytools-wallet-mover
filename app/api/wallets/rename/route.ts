// POST /api/wallets/rename { chain, publicKey, label?, role? }   rewrite the wallet's file (label, optional role tag) and its wallets.csv line
import { isChainId } from "@/lib/chains"
import { body, fail, ok, str } from "@/lib/http"
import { isRole, renameWallet } from "@/lib/wallets"

export async function POST(req: Request) {
  try {
    const b = await body<{ chain: string; publicKey: string; label?: string; role?: string }>(req)
    if (!isChainId(b.chain) || !str(b.publicKey)) return fail(new Error("chain and publicKey are required"), 400)
    const label = str(b.label) || undefined
    const role = isRole(b.role) ? b.role : undefined
    if (!label && !role) return fail(new Error("nothing to change"), 400)
    return ok({ wallet: renameWallet(str(b.publicKey), b.chain, { label, role }) })
  } catch (e) { return fail(e) }
}
