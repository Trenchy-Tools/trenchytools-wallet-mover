// POST /api/wallets/key { chain, publicKey }   the wallet's private key, read from its file (the Key button; the UI confirms first)
import { isChainId } from "@/lib/chains"
import { body, fail, ok, str } from "@/lib/http"
import { secretOf } from "@/lib/wallets"

export async function POST(req: Request) {
  try {
    const b = await body<{ chain: string; publicKey: string }>(req)
    if (!isChainId(b.chain) || !str(b.publicKey)) return fail(new Error("chain and publicKey are required"), 400)
    return ok({ publicKey: str(b.publicKey), chain: b.chain, privateKey: secretOf(str(b.publicKey), b.chain) })
  } catch (e) { return fail(e) }
}
