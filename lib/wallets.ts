/**
 * The wallet store IS the backup folder (lib/paths.ts: BACKUP_DIR), shared with the sibling starters.
 *
 *   <date>-<chain>-<role>-<address>.json   { publicKey, privateKey, chain, role, label, createdAt, app, note }
 *   wallets.csv                            one line per wallet: createdAt,chain,role,label,publicKey,privateKey
 *
 * Solana files hold a base58 64-byte secret; EVM files (rh / eth / bnb) a 0x key. A file without `chain` is a
 * Solana wallet from an older starter. An EVM key owns the same address on every EVM chain, so the same 0x address
 * may appear once per chain: a wallet is identified by (publicKey, chain).
 *
 * The app lists wallets by reading the folder. A wallet is written to disk BEFORE create/import returns, and no leg
 * ever pays a wallet of ours unless its file exists: assertBackedUp() throws NotBackedUpError, which the routes
 * answer as HTTP 409 { code: "not_backed_up" }. "Rewrite backups" restores a missing file from its wallets.csv line
 * and adds missing CSV lines for existing files (idempotent).
 */
import fs from "node:fs"
import path from "node:path"
import { CHAINS, isChainId, isRole, ROLES, type ChainId, type Role } from "./chains"
import { accountFromKey, generateEvm } from "./evm"
import { BACKUP_DIR, ensureDirs } from "./paths"
import { generateSol, keypairFromSecret } from "./sol"

export { ROLES, isRole, type Role }
export const APP_NAME = "trenchytools-wallet-mover"

export type WalletFile = { publicKey: string; privateKey: string; chain: ChainId; role: Role; label: string; createdAt: string; app: string }
/** What the UI sees: everything but the secret, plus the file name. */
export type WalletInfo = Omit<WalletFile, "privateKey"> & { file: string }

const CSV_FILE = path.join(BACKUP_DIR, "wallets.csv")
const CSV_HEADER = "createdAt,chain,role,label,publicKey,privateKey\n"
const ADDR_RE = /-([1-9A-HJ-NP-Za-km-z]{32,44}|0x[0-9a-fA-F]{40})\.json$/
const sameAddr = (a: string, b: string) => (a.startsWith("0x") ? a.toLowerCase() === b.toLowerCase() : a === b)

export class NotBackedUpError extends Error {
  code = "not_backed_up" as const
  hint = "Run 'Rewrite backups' on the Wallets page, or restore the file from wallets.csv"
  constructor(public publicKey: string, public chain: ChainId) {
    super(`Wallet ${publicKey.slice(0, 8)}… (${chain}) has no file in ${BACKUP_DIR}; refusing to pay or use it`)
  }
}

const publicView = (w: WalletFile, file: string): WalletInfo => ({ publicKey: w.publicKey, chain: w.chain, role: w.role, label: w.label, createdAt: w.createdAt, app: w.app, file: path.basename(file) })

/** Parse one wallet file; null when the address in the name does not match its content. */
function readFile(file: string): WalletFile | null {
  const m = ADDR_RE.exec(path.basename(file))
  if (!m) return null
  try {
    const w = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<WalletFile>
    if (typeof w.publicKey !== "string" || !sameAddr(w.publicKey, m[1]) || typeof w.privateKey !== "string" || !w.privateKey) return null
    const chain: ChainId = isChainId(w.chain) ? w.chain : "sol"
    if ((CHAINS[chain].kind === "evm") !== w.publicKey.startsWith("0x")) return null // an address of the wrong shape for its chain
    const role: Role = isRole(w.role) ? w.role : "trader"
    return { publicKey: w.publicKey, privateKey: w.privateKey, chain, role, label: String(w.label ?? role), createdAt: String(w.createdAt ?? ""), app: String(w.app ?? "") }
  } catch {
    return null
  }
}

/** The file holding (publicKey, chain), verified to exist and to hold that key, or null. */
function findFile(publicKey: string, chain: ChainId): string | null {
  if (!fs.existsSync(BACKUP_DIR)) return null
  for (const name of fs.readdirSync(BACKUP_DIR)) {
    if (!name.toLowerCase().endsWith(`-${publicKey.toLowerCase()}.json`)) continue
    const w = readFile(path.join(BACKUP_DIR, name))
    if (w && sameAddr(w.publicKey, publicKey) && w.chain === chain) return path.join(BACKUP_DIR, name)
  }
  return null
}

/** Every wallet in the folder (all chains, or one), oldest first. */
export function listWallets(chain?: ChainId): WalletInfo[] {
  if (!fs.existsSync(BACKUP_DIR)) return []
  const out: WalletInfo[] = []
  for (const name of fs.readdirSync(BACKUP_DIR)) {
    if (!ADDR_RE.test(name)) continue
    const file = path.join(BACKUP_DIR, name)
    const w = readFile(file)
    if (w && (!chain || w.chain === chain)) out.push(publicView(w, file))
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export const getWallet = (publicKey: string, chain: ChainId): WalletInfo | null => {
  const file = findFile(publicKey, chain)
  const w = file ? readFile(file) : null
  return w && file ? publicView(w, file) : null
}

export const isBackedUp = (publicKey: string, chain: ChainId): boolean => !!findFile(publicKey, chain)

/** The gate: call before any leg pays a wallet of ours, and before a wallet's key signs anything. */
export function assertBackedUp(publicKey: string, chain: ChainId): void {
  if (!findFile(publicKey, chain)) throw new NotBackedUpError(publicKey, chain)
}

/** The secret of a wallet, read from its file (the only place keys live). Throws NotBackedUpError when the file is missing. */
export function secretOf(publicKey: string, chain: ChainId): string {
  const file = findFile(publicKey, chain)
  const w = file ? readFile(file) : null
  if (!w) throw new NotBackedUpError(publicKey, chain)
  return w.privateKey
}

const safe = (s: string) => (s.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "wallet").slice(0, 40)
const csvField = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

/**
 * Write one wallet: its JSON file (created exclusively, never overwritten) and its CSV line. Synchronous, and done
 * before the caller gets the wallet back. Returns the file path. An existing file for (key, chain) is left alone.
 */
function writeWallet(w: WalletFile): { file: string; existed: boolean } {
  ensureDirs()
  const existing = findFile(w.publicKey, w.chain)
  if (existing) return { file: existing, existed: true }
  const stamp = w.createdAt.replace(/[:.]/g, "-") // colons are not allowed in Windows file names
  const file = path.join(BACKUP_DIR, `${stamp}-${w.chain}-${safe(w.role)}-${w.publicKey}.json`)
  fs.writeFileSync(file, JSON.stringify({ ...w, note: "Keep this file. Anyone with privateKey controls the wallet." }, null, 2), { flag: "wx", mode: 0o600 })
  if (!csvRows().some((r) => r.chain === w.chain && sameAddr(r.publicKey, w.publicKey))) appendCsv(w)
  console.log(`[wallets] ${w.chain} ${w.role} ${w.publicKey.slice(0, 8)}… → ${file}`)
  return { file, existed: false }
}

const csvLine = (w: WalletFile) => [w.createdAt, w.chain, w.role, csvField(w.label), w.publicKey, w.privateKey].join(",") + "\n"

/** Rewrite wallets.csv in the shared 6-column layout from what it holds (legacy 5-column lines become chain=sol, duplicates collapse). */
function normalizeCsv(): void {
  const rows = csvRows()
  const tmp = `${CSV_FILE}.${process.pid}.tmp`
  fs.writeFileSync(tmp, CSV_HEADER + rows.map(csvLine).join(""), { mode: 0o600 })
  fs.renameSync(tmp, CSV_FILE)
}
const csvHasChainHeader = () => (fs.readFileSync(CSV_FILE, "utf8").split(/\r?\n/)[0] ?? "").split(",").includes("chain")

function appendCsv(w: WalletFile): void {
  if (!fs.existsSync(CSV_FILE)) fs.writeFileSync(CSV_FILE, CSV_HEADER, { mode: 0o600 })
  else if (!csvHasChainHeader()) normalizeCsv() // an older starter wrote the 5-column layout: upgrade the file first
  fs.appendFileSync(CSV_FILE, csvLine(w))
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let cur = ""
  let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') q = false
      else cur += c
    } else if (c === '"') q = true
    else if (c === ",") { cells.push(cur); cur = "" }
    else cur += c
  }
  cells.push(cur)
  return cells
}

const ADDR_SHAPE = /^([1-9A-HJ-NP-Za-km-z]{32,44}|0x[0-9a-fA-F]{40})$/

/**
 * wallets.csv as records. The layout is decided per line, not by the header: a 6-cell line is
 * createdAt,chain,role,label,publicKey,privateKey; a 5-cell line is the older createdAt,role,label,publicKey,privateKey
 * (a Solana wallet). Lines whose publicKey is not an address are skipped. Duplicates of (chain, publicKey) collapse.
 */
function csvRows(): WalletFile[] {
  if (!fs.existsSync(CSV_FILE)) return []
  const rows = new Map<string, WalletFile>()
  for (const line of fs.readFileSync(CSV_FILE, "utf8").split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue
    const cells = parseCsvLine(line)
    const [createdAt, chain, role, label, publicKey, privateKey] = cells.length >= 6 ? cells : [cells[0], "sol", ...cells.slice(1)]
    if (!publicKey || !privateKey || !ADDR_SHAPE.test(publicKey)) continue
    const c: ChainId = isChainId(chain) ? chain : "sol"
    if ((CHAINS[c].kind === "evm") !== publicKey.startsWith("0x")) continue
    const k = `${c}:${publicKey.toLowerCase()}`
    if (!rows.has(k)) rows.set(k, { createdAt, chain: c, role: isRole(role) ? role : "trader", label: label ?? "", publicKey, privateKey, app: APP_NAME })
  }
  return [...rows.values()]
}

/** Wallets that have a CSV line but no file (deleted or moved): shown on the Wallets page, restored by rewriteBackups(). */
export function missingFiles(): Array<Pick<WalletInfo, "publicKey" | "chain" | "role" | "label" | "createdAt">> {
  return csvRows().filter((r) => !findFile(r.publicKey, r.chain)).map(({ publicKey, chain, role, label, createdAt }) => ({ publicKey, chain, role, label, createdAt }))
}

const generate = (chain: ChainId) => (CHAINS[chain].kind === "sol" ? generateSol() : generateEvm())

/**
 * Create N wallets on a chain. Each file is on disk before this returns; the result carries the file paths.
 * Without a label the wallets are "Wallet N", numbered after every wallet already in the folder.
 */
export function createWallets(count: number, chain: ChainId, role: Role = "trader", label?: string): Array<WalletInfo & { path: string }> {
  const n = Math.min(Math.max(Math.floor(count) || 1, 1), 100)
  const start = listWallets().length + 1
  const out: Array<WalletInfo & { path: string }> = []
  for (let i = 0; i < n; i++) {
    const createdAt = new Date(Date.now() + i).toISOString() // unique stamps, stable sort order
    const name = label ? (n > 1 ? `${label} ${i + 1}` : label) : `Wallet ${start + i}`
    const w: WalletFile = { ...generate(chain), chain, role, label: name, createdAt, app: APP_NAME }
    const { file } = writeWallet(w)
    out.push({ ...publicView(w, file), path: file })
  }
  return out
}

/** Rename a wallet (and optionally re-tag its role): the JSON file is rewritten in place, its wallets.csv line follows. */
export function renameWallet(publicKey: string, chain: ChainId, patch: { label?: string; role?: Role }): WalletInfo {
  const file = findFile(publicKey, chain)
  const w = file ? readFile(file) : null
  if (!w || !file) throw new NotBackedUpError(publicKey, chain)
  const next: WalletFile = { ...w, label: patch.label?.trim() || w.label, role: patch.role ?? w.role }
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ ...next, note: "Keep this file. Anyone with privateKey controls the wallet." }, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, file)
  if (fs.existsSync(CSV_FILE)) {
    const rows = csvRows().map((r) => (r.chain === chain && sameAddr(r.publicKey, publicKey) ? { ...r, label: next.label, role: next.role } : r))
    const csvTmp = `${CSV_FILE}.${process.pid}.tmp`
    fs.writeFileSync(csvTmp, CSV_HEADER + rows.map(csvLine).join(""), { mode: 0o600 })
    fs.renameSync(csvTmp, CSV_FILE)
  }
  return publicView(next, file)
}

/** Import a secret (base58 for Solana, 0x hex for EVM chains) as a wallet of a role (written to the folder first, like a created one). */
export function importWallet(secret: string, chain: ChainId, role: Role, label: string): WalletInfo & { path: string; existed: boolean } {
  let publicKey: string
  let privateKey: string
  if (CHAINS[chain].kind === "sol") {
    const kp = keypairFromSecret(secret)
    publicKey = kp.publicKey.toBase58()
    privateKey = secret.trim()
  } else {
    const acct = accountFromKey(secret)
    publicKey = acct.address
    privateKey = secret.trim().startsWith("0x") ? secret.trim() : `0x${secret.trim()}`
  }
  const w: WalletFile = { publicKey, privateKey, chain, role, label, createdAt: new Date().toISOString(), app: APP_NAME }
  const { file, existed } = writeWallet(w)
  return { ...publicView(existed ? readFile(file)! : w, file), path: file, existed }
}

/**
 * Idempotent export: restore every wallet that has a CSV line but no file, and add a CSV line for every file that
 * has none. Returns the folder, how many files exist now and what was written.
 */
export function rewriteBackups(): { dir: string; files: number; restored: string[]; csvAdded: number } {
  ensureDirs()
  if (fs.existsSync(CSV_FILE)) normalizeCsv()
  const restored: string[] = []
  for (const row of csvRows()) {
    if (findFile(row.publicKey, row.chain)) continue
    const { file } = writeWallet({ ...row, createdAt: row.createdAt || new Date().toISOString() })
    restored.push(path.basename(file))
  }
  let csvAdded = 0
  const inCsv = csvRows()
  for (const name of fs.readdirSync(BACKUP_DIR)) {
    if (!ADDR_RE.test(name)) continue
    const w = readFile(path.join(BACKUP_DIR, name))
    if (w && !inCsv.some((r) => r.chain === w.chain && sameAddr(r.publicKey, w.publicKey))) { appendCsv(w); csvAdded++ }
  }
  return { dir: BACKUP_DIR, files: listWallets().length, restored, csvAdded }
}

/** A CSV copy of the chosen wallets, keys included (the Export action; the UI confirms first). */
export function exportCsv(selection: Array<{ publicKey: string; chain: ChainId }>): string {
  let out = CSV_HEADER
  for (const s of selection) {
    const file = findFile(s.publicKey, s.chain)
    const w = file ? readFile(file) : null
    if (w) out += [w.createdAt, w.chain, w.role, csvField(w.label), w.publicKey, w.privateKey].join(",") + "\n"
  }
  return out
}
