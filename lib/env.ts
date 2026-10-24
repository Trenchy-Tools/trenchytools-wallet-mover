/**
 * Local mode's Env (lib/core/env.ts): the wallet folder, the settings and the API client built from them. The shared
 * flows in lib/core/* run on it; the browser engine builds its own Env from localStorage (lib/browser/engine.ts).
 */
import type { Env } from "./core/env"
import { effectiveSettings, trenchy } from "./settings"
import { walletStore } from "./wallets"

/** The Env with the current settings. Cheap: build one per request. */
export function serverEnv(): Env {
  const s = effectiveSettings()
  return { api: trenchy(), wallets: walletStore, settings: { gasReserveSol: s.gasReserveSol, gasReserveEth: s.gasReserveEth, route: s.route, mode: s.mode, venue: s.venue } }
}
