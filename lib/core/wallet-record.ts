/**
 * One wallet, as a record: the shape of a wallet file in the backup folder (local mode) and of a wallet entry in the
 * visitor's localStorage (demo mode). The CSV line both write. No node imports.
 *
 *   { publicKey, privateKey, chain: "sol" | "rh" | "eth" | "bnb", role, label, createdAt, app }
 *
 * Solana keys are base58 64-byte secrets, EVM keys 0x hex. An EVM key owns the same address on every EVM chain, so the
 * same 0x address may exist once per chain: a wallet is identified by (publicKey, chain).
 */
import type { ChainId, Role } from "../chains"

export const APP_NAME = "trenchytools-wallet-mover"

export type WalletFile = { publicKey: string; privateKey: string; chain: ChainId; role: Role; label: string; createdAt: string; app: string }
/** What the UI sees: everything but the secret, plus the file name (local mode) or where the key lives (demo mode). */
export type WalletInfo = Omit<WalletFile, "privateKey"> & { file: string }

/** The note written into every wallet file / backup download. */
export const KEEP_NOTE = "Keep this file. Anyone with privateKey controls the wallet."

/** Same address? (EVM addresses compare case-insensitively, Solana ones exactly.) */
export const sameAddr = (a: string, b: string) => (a.startsWith("0x") ? a.toLowerCase() === b.toLowerCase() : a === b)

/** The label of the i-th of `n` new wallets: "Wallet N" (N counts every wallet so far), or `label` (numbered when n > 1). */
export const newLabel = (label: string | undefined, n: number, i: number, nextNumber: number): string =>
  label ? (n > 1 ? `${label} ${i + 1}` : label) : `Wallet ${nextNumber + i}`

// ── wallets.csv: createdAt,chain,role,label,publicKey,privateKey ─────────────────────────────────────────────────

export const CSV_HEADER = "createdAt,chain,role,label,publicKey,privateKey\n"
export const csvField = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
/** One CSV line, newline included. */
export const csvLine = (w: { createdAt: string; chain: string; role: string; label: string; publicKey: string; privateKey: string }) =>
  [w.createdAt, w.chain, w.role, csvField(w.label), w.publicKey, w.privateKey].join(",") + "\n"

export function parseCsvLine(line: string): string[] {
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
