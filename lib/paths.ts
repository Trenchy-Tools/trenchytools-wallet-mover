/**
 * Where this app keeps its files. There is exactly one folder: the wallet backup folder.
 *
 *   WALLET_BACKUP_DIR     when set (point all three starters at one folder to share wallets)
 *   ./wallets             otherwise: inside the cloned repo (git-ignored), next to the code that uses it
 *
 * Wallet files live at its top level (one JSON per wallet + wallets.csv), shared with the sibling starters
 * (pumpfun-starter, pons-starter): a wallet made here is usable there at once. This app's own state sits in
 * `_app/wallet-mover/`: settings.json and transfers.json. Nothing else is stored anywhere.
 */
import fs from "node:fs"
import path from "node:path"

export const BACKUP_DIR: string = (() => {
  const env = (process.env.WALLET_BACKUP_DIR || "").trim()
  if (env) return path.resolve(env)
  return path.join(process.cwd(), "wallets")
})()

export const APP_DIR = path.join(BACKUP_DIR, "_app", "wallet-mover")
export const SETTINGS_FILE = path.join(APP_DIR, "settings.json")
export const TRANSFERS_FILE = path.join(APP_DIR, "transfers.json")

/** Create the folders (idempotent). */
export function ensureDirs(): void {
  fs.mkdirSync(APP_DIR, { recursive: true })
}

/** Read a JSON file, or the fallback when it is missing or unreadable. */
export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T
  } catch {
    return fallback
  }
}

/** Write a JSON file atomically (write a temp file, then rename over the old one). */
export function writeJson(file: string, data: unknown, mode = 0o600): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode })
  fs.renameSync(tmp, file)
}

/** Server state that must survive a dev-server hot reload (running move jobs): module scope is re-created on reload, `globalThis` is not. */
export function serverState<T>(key: string, init: () => T): T {
  const g = globalThis as unknown as Record<string, T>
  const k = `__wallet_mover_${key}`
  if (!(k in g)) g[k] = init()
  return g[k]
}
