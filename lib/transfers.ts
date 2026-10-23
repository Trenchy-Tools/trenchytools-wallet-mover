/**
 * Every transfer this app started: `_app/wallet-mover/transfers.json`. One record per leg, upserted by the runner as
 * the leg moves along; the Activity page merges this with GET /api/transfer (the API's view of the same orders).
 */
import type { ChainId } from "./chains"
import { TRANSFERS_FILE, readJson, writeJson } from "./paths"
import type { Mode } from "./settings"
import type { TransferHelp } from "./trenchy"

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

export const listRecords = (): TransferRecord[] => readJson<TransferRecord[]>(TRANSFERS_FILE, []).sort((a, b) => b.createdAt - a.createdAt)

export function upsertRecord(r: TransferRecord): void {
  const all = readJson<TransferRecord[]>(TRANSFERS_FILE, [])
  const i = all.findIndex((x) => x.id === r.id)
  if (i >= 0) all[i] = r
  else all.push(r)
  writeJson(TRANSFERS_FILE, all)
}
