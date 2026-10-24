/**
 * The browser side of this app: one fetch helper for the route handlers under /api, and the shapes they answer with.
 * Every failure is thrown as a ClientError carrying the API's `error · code · hint · docs` verbatim (components/api-error.tsx shows it).
 *
 * The routes are answered by this app's server in local mode and by the browser engine in demo mode: appFetch
 * (lib/browser/demo.ts) picks which. The pages do not know the difference.
 */
import { appFetch } from "./browser/demo"
import type { ChainId, Mode, Role } from "./chains"
import type { Endpoint, MovePlan, PlannedLeg, Split } from "./core/moves"
import type { PlanView } from "./core/plan-body"
import type { PublicJob } from "./core/runner"
import type { TransferRecord } from "./core/transfers"
import type { WalletInfo } from "./core/wallet-record"
import type { TransferRoute, TransferVenues } from "./trenchy"

export type ClientError = { error: string; code?: string; hint?: string; docs?: string; status: number; dir?: string; publicKey?: string }
export const isClientError = (e: unknown): e is ClientError => typeof e === "object" && !!e && "error" in e && "status" in e
export const errorText = (e: unknown): string => (isClientError(e) ? e.error : e instanceof Error ? e.message : String(e))

/** A route's raw Response (the server's in local mode, the browser engine's in demo mode), for downloads. */
export const rawApi = (path: string, init?: RequestInit) => appFetch(path, init)

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {}
  const res = await appFetch(path, json !== undefined ? { ...rest, method: rest.method ?? "POST", headers: { "content-type": "application/json", ...rest.headers }, body: JSON.stringify(json) } : rest)
  const text = await res.text()
  let data: unknown = null
  try { data = JSON.parse(text) } catch { data = text }
  if (!res.ok) {
    const d = (typeof data === "object" && data ? data : { error: String(data || res.statusText) }) as Partial<ClientError>
    throw { error: d.error ?? `HTTP ${res.status}`, code: d.code, hint: d.hint, docs: d.docs, dir: d.dir, publicKey: d.publicKey, status: res.status } satisfies ClientError
  }
  return data as T
}

/**
 * GET /api/settings. Demo mode adds `demo`, `pending` (wallets whose key has not been downloaded yet) and `keyError`
 * (why creating the visitor's key failed, verbatim from the API); `apiKeyFrom` is then "browser".
 */
export type StatusView = {
  apiUrl: string; apiKeySet: boolean; apiKeyFrom: "settings" | "env" | "none" | "browser"; connected: boolean; keyPrefix?: string; error?: { error: string; code?: string; hint?: string; docs?: string }; backupDir: string; wallets: number; gasReserveSol: number; gasReserveEth: number; route: "direct" | "exchange"; mode: Mode; venue: string
  demo?: boolean; pending?: number; keyError?: { error: string; code?: string; hint?: string; docs?: string; status?: number } | null
}
/** GET /api/wallets. `pending`: demo mode only, the wallets whose key has not been downloaded yet (not usable until it is). */
export type WalletsView = { dir: string; wallets: WalletInfo[]; missing: Array<{ publicKey: string; chain: ChainId; role: Role; label: string; createdAt: string }>; mainWallet: Partial<Record<ChainId, string>>; archived: string[]; pending?: Array<{ publicKey: string; chain: ChainId; label: string }> }
export type BalanceRow = { chain: ChainId; address: string; balance: number | null }
export type Quote = { route: "direct" | "exchange"; mode: Mode | null; venue: string | null; status?: string; receive: number; fee: number; networkFee?: number; etaS: number; min?: number; max?: number; note?: string; underMin: boolean; closed: boolean }
export type PreviewLeg = PlannedLeg & { quote: Quote | null; error?: string; code?: string; note?: string }
export type Preview = Omit<PlanView, "legs"> & { legs: PreviewLeg[] }
/** The body of POST /api/move/plan and /run: amounts one per row of the amount side; "max" on a From row = balance − gas reserve. */
export type MoveRequest = { from: Endpoint[]; to: Endpoint[]; amounts: Array<number | "max">; route: "direct" | "exchange"; mode: Mode; venue: string; scatter?: boolean; split?: Split; fixedEach?: number; total?: number; seed?: number }
export type ActivityRow = TransferRecord & { mine: boolean }
export type { PublicJob, TransferVenues, TransferRoute, WalletInfo, Endpoint, MovePlan, PlanView, Role }

/** "chain:address" as the lists key wallets (the same key the server uses for ★ and archived). */
export const walletKey = (chain: string, address: string) => `${chain}:${address.toLowerCase()}`
