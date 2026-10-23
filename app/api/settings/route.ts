// GET  /api/settings   what the app uses + the Connected check (GET /api/me) + the backup folder
// PATCH /api/settings  { apiKey?, apiUrl?, gasReserveSol?, gasReserveEth?, route?, mode?, venue? }  (null / "" clears a field)
import { body, fail, ok } from "@/lib/http"
import { BACKUP_DIR } from "@/lib/paths"
import { effectiveSettings, updateSettings, type Settings } from "@/lib/settings"
import { ApiError, trenchy } from "@/lib/trenchy"
import { listWallets } from "@/lib/wallets"

async function view() {
  const s = effectiveSettings()
  let connected = false
  let keyPrefix: string | undefined
  let error: { error: string; code?: string; hint?: string; docs?: string } | undefined
  if (s.apiKey) {
    try { keyPrefix = (await trenchy().me()).keyPrefix; connected = true }
    catch (e) { error = e instanceof ApiError ? { error: e.message, code: e.code, hint: e.hint, docs: e.docs } : { error: e instanceof Error ? e.message : String(e) } }
  }
  return { apiUrl: s.apiUrl, apiKeySet: !!s.apiKey, apiKeyFrom: s.apiKeyFrom, connected, keyPrefix, error, backupDir: BACKUP_DIR, wallets: listWallets().length,
    gasReserveSol: s.gasReserveSol, gasReserveEth: s.gasReserveEth, route: s.route, mode: s.mode, venue: s.venue }
}

export async function GET() {
  try { return ok(await view()) } catch (e) { return fail(e) }
}

export async function PATCH(req: Request) {
  try {
    const b = await body<{ [K in keyof Settings]: Settings[K] | null }>(req)
    updateSettings(b)
    return ok(await view())
  } catch (e) { return fail(e) }
}
