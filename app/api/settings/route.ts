// GET  /api/settings   what the app uses + the Connected check (GET /api/me) + the backup folder (lib/settings-view.ts)
// PATCH /api/settings  { apiKey?, apiUrl?, gasReserveSol?, gasReserveEth?, route?, mode?, venue? }  (null / "" clears a field)
// PUT  /api/settings   the shared Settings sheet's save: { apiKey?, apiUrl? } (its slippage / tip fields mean nothing here)
import { body, fail, ok } from "@/lib/http"
import { updateSettings, type Settings } from "@/lib/settings"
import { settingsView } from "@/lib/settings-view"

export async function GET() {
  try { return ok(await settingsView()) } catch (e) { return fail(e) }
}

export async function PATCH(req: Request) {
  try {
    const b = await body<{ [K in keyof Settings]: Settings[K] | null }>(req)
    updateSettings(b)
    return ok(await settingsView())
  } catch (e) { return fail(e) }
}

export async function PUT(req: Request) {
  try {
    const b = await body<{ apiKey?: string | null; apiUrl?: string | null }>(req)
    const patch: { apiKey?: string | null; apiUrl?: string | null } = {}
    if (b.apiKey !== undefined) patch.apiKey = b.apiKey
    if (b.apiUrl !== undefined) patch.apiUrl = b.apiUrl
    updateSettings(patch as { [K in keyof Settings]?: Settings[K] | null })
    return ok(await settingsView())
  } catch (e) { return fail(e) }
}
