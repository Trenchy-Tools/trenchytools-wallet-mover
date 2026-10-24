/**
 * Settings: `_app/wallet-mover/settings.json` in the wallet folder (written by the Settings sheet) over `.env` defaults.
 *   apiKey          TRENCHY_API_KEY
 *   apiUrl          TRENCHY_API_URL      default https://api.trenchy.tools
 *   gasReserveSol   kept in a Solana wallet on "Max"          default 0.001 SOL
 *   gasReserveEth   kept in an EVM wallet on "Max"            default 0.00005 ETH
 *   route / mode / venue   defaults for the Move desk         direct · float · auto
 *   mainWallet      the ★ wallet per chain (pays for everything, receives gathers)   { sol: "…", rh: "0x…" }
 *   archived        wallets hidden from the lists ("chain:address", lower-cased); their files stay in the folder
 */
import { MODES, ROUTES, isChainId, type ChainId, type Mode, type RouteChoice } from "./chains"
import { DEFAULT_API_URL, DEFAULTS } from "./core/env"
import { SETTINGS_FILE, readJson, writeJson } from "./paths"
import { Trenchy } from "./trenchy"

export { DEFAULT_API_URL, MODES, ROUTES, type Mode, type RouteChoice }

export type Settings = {
  apiKey?: string; apiUrl?: string; gasReserveSol?: number; gasReserveEth?: number; route?: RouteChoice; mode?: Mode; venue?: string
  mainWallet?: Partial<Record<ChainId, string>>
  archived?: string[]
}
const NUM_KEYS = ["gasReserveSol", "gasReserveEth"] as const
const STR_KEYS = ["apiKey", "apiUrl", "venue"] as const

export const walletKey = (chain: ChainId, address: string) => `${chain}:${address.toLowerCase()}`

export function readSettings(): Settings {
  const raw = readJson<Settings>(SETTINGS_FILE, {})
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined)
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined)
  const main: Partial<Record<ChainId, string>> = {}
  if (raw.mainWallet && typeof raw.mainWallet === "object") for (const [c, a] of Object.entries(raw.mainWallet)) if (isChainId(c) && typeof a === "string" && a) main[c] = a
  return {
    apiKey: str(raw.apiKey), apiUrl: str(raw.apiUrl), venue: str(raw.venue),
    gasReserveSol: num(raw.gasReserveSol), gasReserveEth: num(raw.gasReserveEth),
    route: ROUTES.includes(raw.route as RouteChoice) ? raw.route : undefined,
    mode: MODES.includes(raw.mode as Mode) ? raw.mode : undefined,
    mainWallet: Object.keys(main).length ? main : undefined,
    archived: Array.isArray(raw.archived) ? raw.archived.filter((x): x is string => typeof x === "string") : undefined,
  }
}

/** A field left undefined keeps its value; null or "" clears it (back to the .env / built-in default). */
export function updateSettings(patch: { [K in keyof Settings]?: Settings[K] | null }): Settings {
  const next: Settings = { ...readSettings() }
  for (const k of STR_KEYS) {
    if (patch[k] === undefined) continue
    const v = typeof patch[k] === "string" ? patch[k]!.trim() : ""
    if (v) next[k] = v
    else delete next[k]
  }
  for (const k of NUM_KEYS) {
    if (patch[k] === undefined) continue
    const v = patch[k]
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) next[k] = v
    else delete next[k]
  }
  if (patch.route !== undefined) { if (ROUTES.includes(patch.route as RouteChoice)) next.route = patch.route as RouteChoice; else delete next.route }
  if (patch.mode !== undefined) { if (MODES.includes(patch.mode as Mode)) next.mode = patch.mode as Mode; else delete next.mode }
  writeJson(SETTINGS_FILE, next)
  return next
}

/** The ★ wallet of a chain, or null. */
export const mainWalletOf = (chain: ChainId): string | null => readSettings().mainWallet?.[chain] ?? null

/** Make a wallet the ★ of its chain (null clears it). */
export function setMainWallet(chain: ChainId, address: string | null): Settings {
  const next = readSettings()
  const main = { ...(next.mainWallet ?? {}) }
  if (address) main[chain] = address
  else delete main[chain]
  next.mainWallet = Object.keys(main).length ? main : undefined
  writeJson(SETTINGS_FILE, next)
  return next
}

export const archivedKeys = (): Set<string> => new Set(readSettings().archived ?? [])

/** Hide (or show again) wallets in the lists. Files are never touched. */
export function setArchived(items: Array<{ chain: ChainId; address: string }>, archived: boolean): Settings {
  const next = readSettings()
  const set = new Set(next.archived ?? [])
  for (const i of items) { const k = walletKey(i.chain, i.address); if (archived) set.add(k); else set.delete(k) }
  next.archived = set.size ? [...set] : undefined
  writeJson(SETTINGS_FILE, next)
  return next
}

export type Effective = { apiUrl: string; apiKey: string; gasReserveSol: number; gasReserveEth: number; route: RouteChoice; mode: Mode; venue: string; apiKeyFrom: "settings" | "env" | "none" }

/** What the app actually uses: settings.json over .env over the built-in default. */
export function effectiveSettings(): Effective {
  const s = readSettings()
  const envKey = (process.env.TRENCHY_API_KEY || "").trim()
  return {
    apiUrl: (s.apiUrl || process.env.TRENCHY_API_URL || DEFAULT_API_URL).trim().replace(/\/+$/, ""),
    apiKey: s.apiKey || envKey,
    gasReserveSol: s.gasReserveSol ?? DEFAULTS.gasReserveSol,
    gasReserveEth: s.gasReserveEth ?? DEFAULTS.gasReserveEth,
    route: s.route ?? DEFAULTS.route,
    mode: s.mode ?? DEFAULTS.mode,
    venue: s.venue ?? DEFAULTS.venue,
    apiKeyFrom: s.apiKey ? "settings" : envKey ? "env" : "none",
  }
}

/** The API client with the current settings (lib/trenchy.ts, key injected). Cheap: build one per request. */
export function trenchy(): Trenchy {
  const { apiUrl, apiKey } = effectiveSettings()
  return new Trenchy(apiUrl, apiKey)
}
