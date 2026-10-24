/**
 * Every transfer this app started: `_app/wallet-mover/transfers.json`. One record per leg, upserted by the runner as
 * the leg moves along; the Activity page merges this with GET /api/transfer (lib/core/transfers.ts, shared with demo
 * mode, which keeps the same records in localStorage).
 */
import { upsertInto, type Ledger, type TransferRecord } from "./core/transfers"
import { TRANSFERS_FILE, readJson, writeJson } from "./paths"

export type { TransferRecord }

export const listRecords = (): TransferRecord[] => readJson<TransferRecord[]>(TRANSFERS_FILE, []).sort((a, b) => b.createdAt - a.createdAt)

export function upsertRecord(r: TransferRecord): void {
  writeJson(TRANSFERS_FILE, upsertInto(readJson<TransferRecord[]>(TRANSFERS_FILE, []), r))
}

/** transfers.json as the ledger the shared flows use. */
export const fileLedger: Ledger = { list: listRecords, upsert: upsertRecord }
