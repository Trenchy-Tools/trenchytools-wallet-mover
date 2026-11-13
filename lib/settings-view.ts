// What GET /api/settings answers (local mode), shared by app/api/settings and app/api/settings/status: what the app
// uses, the Connected check (GET /api/me), the backup folder, plus the names the shared Settings sheet reads.
import { BACKUP_DIR } from "./paths"
import { effectiveSettings, trenchy } from "./settings"
import { ApiError } from "./trenchy"
import { listWallets } from "./wallets"

export async function settingsView() {
  const s = effectiveSettings()
  let connected = false
  let keyPrefix: string | undefined
  let error: { error: string; code?: string; hint?: string; docs?: string } | undefined
  if (s.apiKey) {
    try { keyPrefix = (await trenchy().me()).keyPrefix; connected = true }
    catch (e) { error = e instanceof ApiError ? { error: e.message, code: e.code, hint: e.hint, docs: e.docs } : { error: e instanceof Error ? e.message : String(e) } }
  }
  return { apiUrl: s.apiUrl, apiKeySet: !!s.apiKey, apiKeyFrom: s.apiKeyFrom, connected, keyPrefix, error, backupDir: BACKUP_DIR, wallets: listWallets().length,
    gasReserveSol: s.gasReserveSol, gasReserveEth: s.gasReserveEth, route: s.route, mode: s.mode, venue: s.venue,
    // the shared Settings sheet's names (components/settings-sheet.tsx)
    apiKeyConfigured: !!s.apiKey, apiKeyPrefix: keyPrefix ?? (s.apiKey ? `${s.apiKey.slice(0, 6)}…` : null), slippage: 0, dir: BACKUP_DIR, file: BACKUP_DIR }
}
