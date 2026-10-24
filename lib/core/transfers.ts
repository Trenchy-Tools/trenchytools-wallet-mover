/**
 * The Activity ledger: one record per leg this app started, upserted by the runner as the leg moves along, merged with
 * GET /api/transfer (the API's view of the same orders). No node imports.
 *
 *   local mode  `_app/wallet-mover/transfers.json` (lib/transfers.ts)
 *   demo mode   localStorage `<prefix>.transfers` (lib/browser/engine.ts)
 */
import type { ChainId, Mode } from "../chains"
import { TRANSFER_FINAL, type TransferHelp, type TransferStatus, type Trenchy } from "../trenchy"

export type TransferRecord = {
  /** the API's transferId, or `local:<job>:<n>` for a leg that never got one */
  id: string
  jobId: string
  createdAt: number
  updatedAt: number
  from: { chain: ChainId; address: string; label?: string }
  to: { chain: ChainId; address: string; label?: string }
  amount: number
  expectedReceive: number | null
  route: "direct" | "exchange"
  mode: Mode | null
  venue: string | null
  venueRequested?: string
  venueHonoured?: boolean
  status: string
  depositHash: string | null
  payoutHash: string | null
  receipt?: string
  help?: TransferHelp
  error?: string
  code?: string
}

export type Ledger = { list(): TransferRecord[]; upsert(r: TransferRecord): void }

/** Insert or replace a record by id in a list (both stores keep one array). */
export function upsertInto(all: TransferRecord[], r: TransferRecord): TransferRecord[] {
  const i = all.findIndex((x) => x.id === r.id)
  if (i >= 0) all[i] = r
  else all.push(r)
  return all
}

/**
 * GET /api/activity: the ledger (newest first) merged with GET /api/transfer. With `refresh` each non-final local record
 * the API list does not carry is re-read with GET /api/transfer/:id, so a leg the runner stopped following moves along.
 */
export async function activity(api: Trenchy, ledger: Ledger, refresh: boolean): Promise<{ transfers: Array<TransferRecord & { mine: boolean }>; remoteError?: string }> {
  const records = ledger.list()
  let remote: TransferStatus[] = []
  let remoteError: string | undefined
  if (api.configured) {
    try { remote = (await api.transfer.list()).transfers } catch (e) { remoteError = e instanceof Error ? e.message : String(e) }
  }
  const byId = new Map(remote.map((t) => [t.transferId, t]))
  const merged: Array<TransferRecord & { mine: boolean }> = []
  for (const r of records) {
    let t = byId.get(r.id)
    if (refresh && !t && !r.id.startsWith("local:") && !TRANSFER_FINAL.has(r.status) && r.status !== "confirmed") t = await api.transfer.status(r.id).catch(() => undefined)
    if (t) {
      const next: TransferRecord = { ...r, status: t.route === "direct" && r.status === "confirmed" ? r.status : t.status, depositHash: t.depositHash ?? r.depositHash, payoutHash: t.payoutHash ?? r.payoutHash, expectedReceive: t.expectedReceive ?? r.expectedReceive, venue: t.venue ?? r.venue, receipt: t.receipt ?? r.receipt, help: t.help ?? r.help, error: t.reason ?? r.error, updatedAt: Math.max(r.updatedAt, t.updatedAt) }
      if (JSON.stringify(next) !== JSON.stringify(r)) ledger.upsert(next)
      merged.push({ ...next, mine: true })
      byId.delete(r.id)
    } else merged.push({ ...r, mine: true })
  }
  // orders this key made elsewhere (another app on the same key, or a run whose record was lost)
  for (const t of byId.values()) merged.push({ id: t.transferId, jobId: "", createdAt: t.createdAt, updatedAt: t.updatedAt, from: { chain: t.from.chain as TransferRecord["from"]["chain"], address: t.from.wallet }, to: { chain: t.to.chain as TransferRecord["to"]["chain"], address: t.to.address }, amount: t.amount, expectedReceive: t.expectedReceive, route: t.route, mode: t.mode, venue: t.venue, status: t.status, depositHash: t.depositHash, payoutHash: t.payoutHash, receipt: t.receipt, help: t.help, error: t.reason, mine: false })
  merged.sort((a, b) => b.createdAt - a.createdAt)
  return { transfers: merged, remoteError }
}
