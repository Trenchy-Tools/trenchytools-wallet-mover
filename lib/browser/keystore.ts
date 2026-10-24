"use client"

/**
 * The wallet store of demo mode: the visitor's browser (localStorage). ONE store for every chain (sol / rh / eth / bnb):
 * each record carries its `chain`, like a wallet file does, and the same 0x address may exist once per chain.
 *
 *   <prefix>.wallet.<chain>.<publicKey>   one JSON per wallet, the same shape as a wallet file of local mode:
 *                                         { publicKey, privateKey, chain, role, label, createdAt, app }
 *   <prefix>.backedUp                     { "chain:address": ISO time the key was downloaded }
 *   <prefix>.archived                     { "chain:address": ISO time it was archived }   (hidden from the lists only)
 *   <prefix>.main                         { [chain]: address of that chain's ★ wallet }
 *
 * THE BACKUP RULE (non-negotiable): a wallet is created NOT backed up. Until its key has been downloaded no move pays it
 * or signs with it: `assertBackedUp` / `signerSecret` throw NotBackedUpError (409 not_backed_up, "download your backup
 * first"), the same refusal local mode gives for a missing file. `downloadBackup()` saves every not-yet-backed-up
 * wallet as ONE JSON file (CSV text inside) through a normal browser download, and only then marks them backed up.
 * `exportAll()` downloads every key, any time.
 *
 * A write that the browser refuses (private window, storage full) throws: a wallet is never handed out unless it is
 * stored. Clearing the site's data deletes every key here, which is why the backup comes first.
 */
import { CHAINS, isChainId, isRole, type ChainId, type Role } from "../chains"
import { NotBackedUpError } from "../core/errors"
import { CSV_HEADER, KEEP_NOTE, csvLine, sameAddr, type WalletFile } from "../core/wallet-record"
import { addressOf } from "./signer"

/** A wallet as stored: exactly the wallet-file shape. */
export type KeyRecord = WalletFile
/** What the pages see: no secret, plus the backup state. */
export type KeyView = Omit<KeyRecord, "privateKey"> & { backedUp: boolean; backedUpAt: string | null }

const NOT_BACKED_UP_HINT = "Press “Download backup” (status strip or Wallets page): the key is saved as a file on your computer, then the wallet can be used."

/** "chain:address" (lower-cased), the key the lists, ★ and archive use in both modes. */
export const idOf = (chain: string, address: string) => `${chain}:${address.toLowerCase()}`

// ── localStorage, carefully ─────────────────────────────────────────────────

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}
/** Write and read back; throws when the browser did not keep it. */
function write(key: string, value: unknown): void {
  const text = JSON.stringify(value)
  try {
    window.localStorage.setItem(key, text)
  } catch (e) {
    throw new Error(`This browser refused to store the data (${e instanceof Error ? e.message : e}). Private windows and full storage cannot hold wallets.`)
  }
  if (window.localStorage.getItem(key) !== text) throw new Error("This browser did not keep the data it was given; wallets cannot be stored here.")
}

/** Save a text file through a normal browser download. */
export function downloadFile(name: string, text: string, type = "application/json"): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.rel = "noopener"
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")

// ── the store ───────────────────────────────────────────────────────────────

export type Keystore = ReturnType<typeof createKeystore>

/** One store per app. `prefix` namespaces every localStorage key; `fileTag` names the downloads (trenchytools-<fileTag>-backup-<time>.json). */
export function createKeystore(o: { prefix: string; app: string; fileTag: string }) {
  const K = { wallet: `${o.prefix}.wallet.`, backedUp: `${o.prefix}.backedUp`, archived: `${o.prefix}.archived`, main: `${o.prefix}.main` }
  const slot = (chain: ChainId, publicKey: string) => `${K.wallet}${chain}.${publicKey}`
  const changed = () => window.dispatchEvent(new Event("wallets-changed"))

  /** Every record (all chains, archived too), oldest first. A record whose slot does not match its content is ignored. */
  function records(): KeyRecord[] {
    const out: KeyRecord[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)
      if (!key?.startsWith(K.wallet)) continue
      const r = read<Partial<KeyRecord> | null>(key, null)
      if (!r || typeof r.publicKey !== "string" || typeof r.privateKey !== "string" || !r.privateKey || !isChainId(r.chain)) continue
      if (key !== slot(r.chain, r.publicKey)) continue
      if ((CHAINS[r.chain].kind === "evm") !== r.publicKey.startsWith("0x")) continue // an address of the wrong shape for its chain
      out.push({ publicKey: r.publicKey, privateKey: r.privateKey, chain: r.chain, role: isRole(r.role) ? r.role : "trader", label: String(r.label ?? ""), createdAt: String(r.createdAt ?? ""), app: String(r.app ?? o.app) })
    }
    return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }
  const backedUpMap = () => read<Record<string, string>>(K.backedUp, {})
  const archivedMap = () => read<Record<string, string>>(K.archived, {})
  const view = (r: KeyRecord, b = backedUpMap()): KeyView => {
    const { privateKey: _s, ...rest } = r
    void _s
    const at = b[idOf(r.chain, r.publicKey)] ?? null
    return { ...rest, backedUp: !!at, backedUpAt: at }
  }
  const record = (publicKey: string, chain: ChainId): KeyRecord | null => records().find((r) => r.chain === chain && sameAddr(r.publicKey, publicKey)) ?? null

  /** Every wallet stored here (archived ones too: the pages filter them, as in local mode), oldest first. */
  const list = (): KeyView[] => { const b = backedUpMap(); return records().map((r) => view(r, b)) }
  const get = (publicKey: string, chain: ChainId): KeyView | null => { const r = record(publicKey, chain); return r ? view(r) : null }
  /** How many wallets were ever stored here: label numbers never repeat. */
  const seen = () => records().length

  /** Store a new wallet (never overwrites). Returns the stored view and whether it was already there. */
  function add(r: KeyRecord): { wallet: KeyView; existed: boolean } {
    const old = record(r.publicKey, r.chain)
    if (old) return { wallet: view(old), existed: true }
    write(slot(r.chain, r.publicKey), { ...r, app: o.app })
    changed()
    return { wallet: view(record(r.publicKey, r.chain)!), existed: false }
  }

  function update(publicKey: string, chain: ChainId, patch: { label?: string; role?: Role }): KeyView {
    const r = record(publicKey, chain)
    if (!r) throw missing(publicKey, chain)
    const next: KeyRecord = { ...r, label: patch.label?.trim() || r.label, role: patch.role ?? r.role }
    write(slot(r.chain, r.publicKey), next)
    changed()
    return view(next)
  }

  /** The ★ wallet of each chain that names a stored wallet. */
  function main(): Partial<Record<ChainId, string>> {
    const m = read<Partial<Record<ChainId, string>>>(K.main, {})
    const out: Partial<Record<ChainId, string>> = {}
    for (const [c, a] of Object.entries(m)) if (isChainId(c) && typeof a === "string" && record(a, c)) out[c] = a
    return out
  }
  function setMain(chain: ChainId, publicKey: string): Partial<Record<ChainId, string>> {
    const r = record(publicKey, chain)
    if (!r) throw missing(publicKey, chain)
    write(K.main, { ...main(), [chain]: r.publicKey })
    changed()
    return main()
  }

  /** Hide (or show again) wallets in the lists. Keys are never touched; archived wallets stay in every backup. */
  function setArchived(items: Array<{ chain: ChainId; address: string }>, archived: boolean): string[] {
    const a = archivedMap()
    for (const i of items) { const k = idOf(i.chain, i.address); if (archived) a[k] ??= new Date().toISOString(); else delete a[k] }
    write(K.archived, a)
    changed()
    return Object.keys(a)
  }
  const archivedKeys = () => Object.keys(archivedMap())

  // ── the backup rule ──

  const missing = (publicKey: string, chain: ChainId) => new NotBackedUpError(publicKey, chain, `Wallet ${publicKey.slice(0, 8)}… (${chain}) is not in this browser; refusing to pay or use it`, "Import its key on the Wallets page first.")
  const isBackedUp = (publicKey: string, chain: ChainId) => !!backedUpMap()[idOf(chain, publicKey)]

  /** The gate: call before any leg pays a wallet of ours, and before a wallet's key signs anything. */
  function assertBackedUp(publicKey: string, chain: ChainId): void {
    if (!record(publicKey, chain)) throw missing(publicKey, chain)
    if (!isBackedUp(publicKey, chain)) throw new NotBackedUpError(publicKey, chain, `Wallet ${publicKey.slice(0, 8)}… (${chain}) is not backed up yet: download your backup first; refusing to pay or use it`, NOT_BACKED_UP_HINT)
  }
  /** The secret for signing: only for a stored, backed-up wallet, and only when the key really is the key of that address. */
  function signerSecret(publicKey: string, chain: ChainId): string {
    assertBackedUp(publicKey, chain)
    const r = record(publicKey, chain)!
    if (!sameAddr(addressOf(chain, r.privateKey), r.publicKey)) throw new Error(`The stored key of ${publicKey.slice(0, 8)}… does not match its address`)
    return r.privateKey
  }
  /** The secret to show (the Key button): any stored wallet, backed up or not. */
  function secret(publicKey: string, chain: ChainId): string {
    const r = record(publicKey, chain)
    if (!r) throw missing(publicKey, chain)
    return r.privateKey
  }
  /** A CSV copy of the chosen wallets, keys included (Export keys on the selection bar). */
  function exportCsv(selection: Array<{ publicKey: string; chain: ChainId }>): string {
    let out = CSV_HEADER
    for (const s of selection) { const r = record(s.publicKey, s.chain); if (r) out += csvLine(r) }
    return out
  }

  /** Wallets whose key has not been downloaded yet (archived ones too: they still hold a key). */
  const pending = (): KeyView[] => { const b = backedUpMap(); return records().filter((r) => !b[idOf(r.chain, r.publicKey)]).map((r) => view(r, b)) }

  /** ONE file per click (browsers block or prompt on a second automatic download): a JSON with every wallet and its
   *  key, and the same rows as CSV text inside it (`csv`), so a spreadsheet copy is one paste away. */
  function download(rs: KeyRecord[], kind: string): string[] {
    const a = archivedMap()
    const name = `trenchytools-${o.fileTag}-${kind}-${stamp()}.json`
    const json = { app: o.app, chains: [...new Set(rs.map((r) => r.chain))], createdAt: new Date().toISOString(), note: KEEP_NOTE, wallets: rs.map((r) => ({ ...r, archived: !!a[idOf(r.chain, r.publicKey)] })), csv: CSV_HEADER + rs.map(csvLine).join("") }
    downloadFile(name, JSON.stringify(json, null, 2))
    return [name]
  }
  function markBackedUp(rs: KeyRecord[]): void {
    const b = backedUpMap()
    const at = new Date().toISOString()
    for (const r of rs) b[idOf(r.chain, r.publicKey)] ??= at
    write(K.backedUp, b)
    changed()
  }

  /** `Download backup`: the not-yet-backed-up wallets, downloaded, THEN marked backed up. */
  function downloadBackup(): { count: number; files: string[] } {
    const b = backedUpMap()
    const rs = records().filter((r) => !b[idOf(r.chain, r.publicKey)])
    if (!rs.length) return { count: 0, files: [] }
    const files = download(rs, "backup")
    markBackedUp(rs)
    return { count: rs.length, files }
  }
  /** `Export all keys`: every wallet stored here, any time (this is a backup too). */
  function exportAll(): { count: number; files: string[] } {
    const rs = records()
    if (!rs.length) return { count: 0, files: [] }
    const files = download(rs, "export")
    markBackedUp(rs)
    return { count: rs.length, files }
  }
  /** One wallet's own backup download (a pool move's fresh relay wallet), THEN marked backed up. */
  function backupOne(publicKey: string, chain: ChainId, kind: string): string {
    const r = record(publicKey, chain)
    if (!r) throw missing(publicKey, chain)
    const [file] = download([r], kind)
    markBackedUp([r])
    return file
  }

  return { list, get, add, update, main, setMain, setArchived, archivedKeys, seen, isBackedUp, assertBackedUp, signerSecret, secret, exportCsv, pending, downloadBackup, exportAll, backupOne, missing }
}
