/**
 * The browser side of this app: one fetch helper for the route handlers under /api, and the shapes they answer with.
 * Every failure is thrown as a ClientError carrying the API's `error · code · hint · docs` verbatim (components/api-error.tsx shows it).
 */
import type { ChainId } from "./chains"
import type { Endpoint, MovePlan, PlannedLeg, Split } from "./moves"
import type { PlanView } from "./plan-body"
import type { PublicJob } from "./runner"
import type { Mode } from "./settings"
import type { TransferRoute, TransferVenues } from "./trenchy"
import type { TransferRecord } from "./transfers"
import type { Role, WalletInfo } from "./wallets"

export type ClientError = { error: string; code?: string; hint?: string; docs?: string; status: number; dir?: string; publicKey?: string }
export const isClientError = (e: unknown): e is ClientError => typeof e === "object" && !!e && "error" in e && "status" in e
export const errorText = (e: unknown): string => (isClientError(e) ? e.error : e instanceof Error ? e.message : String(e))

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {}
  const res = await fetch(path, json !== undefined ? { ...rest, method: rest.method ?? "POST", headers: { "content-type": "application/json", ...rest.headers }, body: JSON.stringify(json) } : rest)
  const text = await res.text()
  let data: unknown = null
  try { data = JSON.parse(text) } catch { data = text }
  if (!res.ok) {
    const d = (typeof data === "object" && data ? data : { error: String(data || res.statusText) }) as Partial<ClientError>
    throw { error: d.error ?? `HTTP ${res.status}`, code: d.code, hint: d.hint, docs: d.docs, dir: d.dir, publicKey: d.publicKey, status: res.status } satisfies ClientError
  }
  return data as T
}

export type StatusView = { apiUrl: string; apiKeySet: boolean; apiKeyFrom: "settings" | "env" | "none"; connected: boolean; keyPrefix?: string; error?: { error: string; code?: string; hint?: string; docs?: string }; backupDir: string; wallets: number; gasReserveSol: number; gasReserveEth: number; route: "direct" | "exchange"; mode: Mode; venue: string }
export type WalletsView = { dir: string; wallets: WalletInfo[]; missing: Array<{ publicKey: string; chain: ChainId; role: Role; label: string; createdAt: string }>; mainWallet: Partial<Record<ChainId, string>>; archived: string[] }
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
