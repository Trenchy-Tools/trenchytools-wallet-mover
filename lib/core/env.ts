/**
 * What the shared flows (lib/core/plan-body.ts, runner.ts, transfers.ts) need from the outside world.
 *
 *   local mode  lib/wallets.ts (files in the backup folder), transfers.json, settings.json / .env, the server's key
 *   demo mode   lib/browser/keystore.ts + the browser engine (localStorage), the visitor's own key
 *
 * Every wallet method is synchronous on purpose: both stores are (fs sync calls / localStorage). No node imports.
 */
import { CHAINS, type ChainId, type Mode, type RouteChoice } from "../chains"
import type { Trenchy } from "../trenchy"
import type { WalletInfo } from "./wallet-record"

export type WalletStore = {
  /** where keys live, for messages: "folder" (local mode) or "browser" (demo mode) */
  place: "folder" | "browser"
  /** a wallet of ours on that chain (archived ones too), or null */
  get(publicKey: string, chain: ChainId): WalletInfo | null
  /** the store knows the address on that chain, even when its key can no longer be used (a file gone missing) */
  isOurs(chain: ChainId, address: string): boolean
  /** the backup rule: throws NotBackedUpError unless the key is safely backed up */
  assertBackedUp(publicKey: string, chain: ChainId): void
  /** the secret for signing; throws NotBackedUpError when the wallet is unknown or not backed up */
  secretOf(publicKey: string, chain: ChainId): string
  /** a pool move's relay wallet: created AND backed up before anything pays it */
  createRelay(chain: ChainId, label: string): WalletInfo & { path: string }
  /** where a relay's key stays, for the run's messages */
  relayKept: { sentence: string; aside: string }
}

/** The settings both modes use for moves (local: settings.json over .env; demo: this browser). */
export type MoveSettings = { gasReserveSol: number; gasReserveEth: number; route: RouteChoice; mode: Mode; venue: string }

/** The gas reserve kept in a wallet of that chain. */
export const reserveOf = (s: Pick<MoveSettings, "gasReserveSol" | "gasReserveEth">) => (chain: ChainId) => (CHAINS[chain].kind === "sol" ? s.gasReserveSol : s.gasReserveEth)

/** Defaults both modes use when settings say nothing. */
export const DEFAULT_API_URL = "https://api.trenchy.tools"
export const DEFAULTS: MoveSettings = { gasReserveSol: 0.001, gasReserveEth: 0.00005, route: "direct", mode: "float", venue: "auto" }

export type Env = {
  api: Trenchy
  wallets: WalletStore
  settings: MoveSettings
}
