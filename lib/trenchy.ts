/**
 * The TrenchyTools API client: the one file that talks to https://api.trenchy.tools.
 *
 * Every method names the endpoint it calls, grouped as `sol.*`, `rh.*` and `transfer.*`. The API builds deposit
 * transactions and sends signed ones; this app signs locally with keys from the wallet folder and never talks to an
 * RPC node itself.
 *
 * Client-safe (no node imports): the server uses it with the key from settings (lib/settings.ts `trenchy()`), the
 * hosted demo uses the same class in the browser with the visitor's own key (lib/browser/engine.ts). The key is injected
 * through the constructor; nothing here reads settings.
 *
 * Copy this file into your own project. It depends on nothing but fetch. Docs for every endpoint:
 * https://api.trenchy.tools/AGENTS.md and https://trenchy.tools/openapi.json
 */
import type { ChainId, Mode } from "./chains"
import { ApiError } from "./core/errors"
import type { EvmAccountInfo, EvmDeposit } from "./core/evm"

export { ApiError }

// ── shapes (apps/api/src/transfer/index.ts) ──────────────────────────────────

export type TransferRoute = { route: "direct" | "exchange"; mode: Mode | null; venue: string | null; status?: "open" | "closed" | "unknown"; receive: number; fee: number; networkFee?: number; etaS: number; min?: number; max?: number; note?: string }
export type TransferRoutes = { from: string; to: string; amount: number; routes: TransferRoute[]; venues?: string[]; chains?: Record<string, { name: string; native: string; source: boolean; destination: boolean }>; modes?: Mode[]; exchange?: "on" | "off" }
export type TransferVenues = { exchange: "on" | "off" | "degraded"; checkedAt: string | null; venues: Record<string, { status: "open" | "closed" | "unknown"; reason?: string; default?: boolean }>; note?: string }
export type DepositTx = { chain: string; encoding: "base64" | "evm"; transaction?: string; evm?: EvmDeposit }
export type TransferCreateBody = { from: { chain: ChainId; wallet: string }; to: { chain: ChainId; address: string }; amount: number; route?: "auto" | "direct" | "exchange"; mode?: Mode; venue?: string; refundAddress?: string }
export type TransferCreated = {
  transferId: string; status: string; route: "direct" | "exchange"; mode?: Mode; venue?: string; venueRequested?: string; venueHonoured?: boolean
  from: { chain: string; wallet: string }; to: { chain: string; address: string }; amount: number; expected?: { receive: number; fee: number; etaS: number }
  deposit: { chain: string; address: string; amount: number; tag?: string; deadline?: string; note?: string } | null
  transaction?: DepositTx; poll?: string; warning?: string
}
export type TransferBatchBody =
  | { from: { chain: ChainId; wallet: string }; to: Array<{ chain: ChainId; address: string; amount: number }>; route?: "auto" | "direct" | "exchange"; mode?: Mode; venue?: string }
  | { from: Array<{ chain: ChainId; wallet: string; amount: number }>; to: { chain: ChainId; address: string }; route?: "auto" | "direct" | "exchange"; mode?: Mode; venue?: string }
export type TransferLegError = { error: string; code: string; leg: { from: { chain: string; wallet: string }; to: { chain: string; address: string }; amount: number } }
export type TransferBatch = { batchId: string; legs: Array<TransferCreated | TransferLegError>; venues: string[] }
export const isLegError = (l: TransferCreated | TransferLegError): l is TransferLegError => "error" in l
/** The `help` block the API attaches to a stuck or failed exchange leg; shown verbatim. */
export type TransferHelp = { orderId?: string | null; receipt?: string; why: string; whatToDo: string; support: { trenchytools: string; exchangeRoute: { telegram: string; email: string }; include: string[] }; warning: string }
export type TransferStatus = {
  transferId: string; status: string; route: "direct" | "exchange"; mode: Mode | null; venue: string | null; batchId?: string
  from: { chain: string; wallet: string }; to: { chain: string; address: string }; amount: number; expectedReceive: number | null
  deposit: { chain: string; address: string; deadline?: string } | null; depositHash: string | null; payoutHash: string | null; reason?: string
  orderId?: string; receipt?: string; help?: TransferHelp; createdAt: number; updatedAt: number
}
/** Statuses after which a transfer will not change any more ("sent" is final for direct transfers only). */
export const TRANSFER_FINAL = new Set(["completed", "failed", "expired", "refunded", "cancelled"])
export const transferDone = (t: { status: string; route: string }) => TRANSFER_FINAL.has(t.status) || (t.route === "direct" && t.status === "sent")

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class Trenchy {
  constructor(public readonly url: string, private readonly key: string) {}

  get configured(): boolean {
    return !!this.key
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.key) throw new ApiError(`No TrenchyTools API key. Create one at ${this.url}/api/create-api-key?label=wallet-mover and paste it in Settings.`, 401, "no_key")
    const headers = new Headers(init.headers)
    headers.set("x-api-key", this.key)
    for (let attempt = 0; ; attempt++) {
      let res: Response
      try {
        res = await fetch(`${this.url}${path}`, { ...init, headers, signal: AbortSignal.timeout(45_000) })
      } catch (e) {
        if (attempt < 2) { await sleep(500 * (attempt + 1)); continue }
        throw new ApiError(`TrenchyTools API unreachable at ${this.url} (${e instanceof Error ? e.message : e})`, 0, "unreachable")
      }
      // 429 carries retry-after: wait as the API says, a few times, rather than failing a move midway.
      if (res.status === 429 && attempt < 4) { await sleep((Number(res.headers.get("retry-after")) || 1) * 1000); continue }
      const text = await res.text()
      let body: Record<string, unknown> | null = null
      try { body = JSON.parse(text) } catch { /* not JSON */ }
      if (!res.ok) throw new ApiError(String(body?.error ?? `TrenchyTools API ${res.status}`), res.status, body?.code as string, body?.hint as string, body?.docs as string)
      return body as T
    }
  }
  private get<T>(path: string) { return this.call<T>(path) }
  private post<T>(path: string, body: unknown) {
    return this.call<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  }

  /** GET /api/me: the key's prefix and 30-day usage. The "Connected" check. */
  me() { return this.get<{ keyPrefix?: string; usage30d?: unknown[] }>("/api/me") }

  // ── Solana ──────────────────────────────────────────────────────────────
  sol = {
    /** GET /api/sol/balances?wallets=…: SOL for up to 100 wallets per call. */
    balances: async (wallets: string[]): Promise<Array<{ wallet: string; sol: number }>> => {
      const out: Array<{ wallet: string; sol: number }> = []
      for (let i = 0; i < wallets.length; i += 100) {
        const r = await this.get<{ wallets: Array<{ wallet: string; sol: number }> }>(`/api/sol/balances?wallets=${wallets.slice(i, i + 100).join(",")}`)
        out.push(...r.wallets)
      }
      return out
    },
    /** GET /api/sol/blockhash: for the direct transfers this app builds itself. */
    blockhash: () => this.get<{ blockhash: string; lastValidBlockHeight: number }>("/api/sol/blockhash"),
    /** POST /api/sol/send: a signed transaction (base64) through the API's node and every Jito region at once. skipPreflight false = simulated first. */
    send: (base64: string, skipPreflight = false) => this.post<{ signature: string; lanes: string[] }>("/api/sol/send", { transaction: base64, skipPreflight }),
    /** GET /api/sol/tx/:signature: confirmation status and error, if any. */
    tx: (signature: string) => this.get<{ signature: string; confirmationStatus: string | null; err?: unknown }>(`/api/sol/tx/${encodeURIComponent(signature)}`),
  }

  // ── Robinhood chain (EVM) ───────────────────────────────────────────────
  rh = {
    /** GET /api/rh/account?wallet=…: chain id, pending nonce, fee values, balance — what the local signer needs. */
    account: (wallet: string) => this.get<EvmAccountInfo>(`/api/rh/account?wallet=${wallet}`),
    /** GET /api/rh/balances?wallets=…: ETH for up to 100 wallets per call (strings, as the API formats them). */
    balances: async (wallets: string[]): Promise<Array<{ wallet: string; eth: number }>> => {
      const out: Array<{ wallet: string; eth: number }> = []
      for (let i = 0; i < wallets.length; i += 100) {
        const r = await this.get<{ wallets: Array<{ wallet: string; eth: string }> }>(`/api/rh/balances?wallets=${wallets.slice(i, i + 100).join(",")}`)
        out.push(...r.wallets.map((w) => ({ wallet: w.wallet, eth: Number(w.eth) })))
      }
      return out
    },
    /** POST /api/rh/send { transaction: "0x…signed raw" } → { hash }. */
    send: (raw: string) => this.post<{ hash: string }>("/api/rh/send", { transaction: raw }),
    /** GET /api/rh/tx/:hash: success | reverted | pending_or_unknown. */
    tx: (hash: string) => this.get<{ hash: string; status: string; block?: number; gasUsed?: string }>(`/api/rh/tx/${encodeURIComponent(hash)}`),
  }

  // ── transfers (wallet → wallet, direct or through an exchange hop) ──────
  transfer = {
    /** GET /api/transfer/routes?from&to&amount: every route/mode/venue open right now with receive, fee, min, eta. Also validates both chains. */
    routes: (from: ChainId, to: ChainId, amount: number) => this.get<TransferRoutes>(`/api/transfer/routes?from=${from}&to=${to}&amount=${amount}`),
    /** GET /api/transfer/venues: which exchange venues are open (probed every 2 minutes, nothing is created). */
    venues: () => this.get<TransferVenues>("/api/transfer/venues"),
    /** POST /api/transfer: one order → deposit address + unsigned deposit transaction (200 direct, 202 exchange). */
    create: (body: TransferCreateBody) => this.post<TransferCreated>("/api/transfer", body),
    /** POST /api/transfer/batch: fan-out (one → many) or consolidate (many → one); one order + deposit per leg, failed legs reported inline. */
    batch: (body: TransferBatchBody) => this.post<TransferBatch>("/api/transfer/batch", body),
    /** GET /api/transfer/:id: awaiting_deposit → exchanging → completed (payoutHash), or a terminal failure with `help`. */
    status: (id: string) => this.get<TransferStatus>(`/api/transfer/${encodeURIComponent(id)}`),
    /** POST /api/transfer/:id/sent { hash }: record the signature of the deposit you sent. */
    sent: (id: string, hash: string) => this.post<{ ok: boolean }>(`/api/transfer/${encodeURIComponent(id)}/sent`, { hash }),
    /** GET /api/transfer: your last 50 transfers. */
    list: () => this.get<{ transfers: TransferStatus[] }>("/api/transfer"),
  }
}
