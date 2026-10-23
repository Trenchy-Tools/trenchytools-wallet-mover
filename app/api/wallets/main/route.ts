// POST /api/wallets/main { chain, publicKey }   make a wallet the ★ of its chain (it pays for everything and receives gathers)
import { isChainId } from "@/lib/chains"
import { body, fail, ok, str } from "@/lib/http"
import { setMainWallet } from "@/lib/settings"
import { assertBackedUp } from "@/lib/wallets"

export async function POST(req: Request) {
  try {
    const b = await body<{ chain: string; publicKey: string }>(req)
    if (!isChainId(b.chain) || !str(b.publicKey)) return fail(new Error("chain and publicKey are required"), 400)
    assertBackedUp(str(b.publicKey), b.chain)
    const s = setMainWallet(b.chain, str(b.publicKey))
    return ok({ mainWallet: s.mainWallet ?? {} })
  } catch (e) { return fail(e) }
}
