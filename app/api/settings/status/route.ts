// GET /api/settings/status — the shared header's status dot: the API key, the ★ Solana wallet (else the ★ Robinhood one)
// with its balance, and the backup folder.
import { fail, ok } from "@/lib/http"
import { BACKUP_DIR } from "@/lib/paths"
import { balancesFor } from "@/lib/runner"
import { mainWalletOf, trenchy } from "@/lib/settings"
import { getWallet, isBackedUp } from "@/lib/wallets"
import type { ChainId } from "@/lib/chains"
import { settingsView } from "@/lib/settings-view"

export async function GET() {
  try {
    const v = await settingsView()
    const sol = mainWalletOf("sol"), rh = mainWalletOf("rh")
    const pick: { chain: ChainId; pk: string } | null = sol ? { chain: "sol", pk: sol } : rh ? { chain: "rh", pk: rh } : null
    let funding: { publicKey: string; label: string; sol: number | null; backedUp: boolean } | null = null
    if (pick) {
      const bal = await balancesFor(trenchy(), [{ chain: pick.chain, address: pick.pk }]).catch(() => null)
      const key = `${pick.chain}:${pick.pk.toLowerCase()}`
      funding = { publicKey: pick.pk, label: getWallet(pick.pk, pick.chain)?.label ?? "main", sol: bal?.get(key) ?? null, backedUp: isBackedUp(pick.pk, pick.chain) }
    }
    return ok({ api: { configured: v.apiKeySet, connected: v.connected, url: v.apiUrl, keyPrefix: v.keyPrefix, error: v.error?.error, code: v.error?.code }, funding, backups: { dir: BACKUP_DIR, wallets: v.wallets } })
  } catch (e) { return fail(e) }
}
