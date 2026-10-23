// GET  /api/wallets?chain=sol|rh|eth|bnb   every wallet in the folder (all chains without ?chain) + CSV lines whose file is
//                                          missing + the ★ per chain + the archived keys ("chain:address")
// POST /api/wallets { count, chain, role?, label? }   create N wallets ("Wallet N" without a label); each file is on disk
//                                          before this answers (paths in the response). The first wallet of a chain becomes ★.
import { isChainId } from "@/lib/chains"
import { body, fail, num, ok, str } from "@/lib/http"
import { BACKUP_DIR } from "@/lib/paths"
import { archivedKeys, mainWalletOf, readSettings, setMainWallet } from "@/lib/settings"
import { createWallets, isRole, listWallets, missingFiles } from "@/lib/wallets"

export async function GET(req: Request) {
  const chain = new URL(req.url).searchParams.get("chain")
  try {
    const s = readSettings()
    return ok({ dir: BACKUP_DIR, wallets: listWallets(isChainId(chain) ? chain : undefined), missing: missingFiles(), mainWallet: s.mainWallet ?? {}, archived: [...archivedKeys()] })
  } catch (e) { return fail(e) }
}

export async function POST(req: Request) {
  try {
    const b = await body<{ count: number; chain: string; role: string; label: string }>(req)
    if (!isChainId(b.chain)) return fail(new Error("chain must be sol, rh, eth or bnb"), 400)
    const role = isRole(b.role) ? b.role : "trader"
    const wallets = createWallets(num(b.count, 1), b.chain, role, str(b.label) || undefined)
    let starred: string | null = null
    if (!mainWalletOf(b.chain) && wallets[0]) { setMainWallet(b.chain, wallets[0].publicKey); starred = wallets[0].publicKey }
    return ok({ dir: BACKUP_DIR, wallets, starred })
  } catch (e) { return fail(e) }
}
