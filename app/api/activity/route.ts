// GET /api/activity?refresh=1   every transfer this app started (transfers.json) merged with GET /api/transfer (the API's
// view of the same orders: status, hashes, receipt, help). With ?refresh=1 each non-final local record is re-read with
// GET /api/transfer/:id so a leg the runner stopped following still moves along.
import { fail, ok } from "@/lib/http"
import { TRANSFER_FINAL, trenchy, type TransferStatus } from "@/lib/trenchy"
import { listRecords, upsertRecord, type TransferRecord } from "@/lib/transfers"

export async function GET(req: Request) {
  try {
    const api = trenchy()
    const refresh = new URL(req.url).searchParams.get("refresh") === "1"
    const records = listRecords()
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
        if (JSON.stringify(next) !== JSON.stringify(r)) upsertRecord(next)
        merged.push({ ...next, mine: true })
        byId.delete(r.id)
      } else merged.push({ ...r, mine: true })
    }
    // orders this key made elsewhere (another app on the same key, or a run whose record was lost)
    for (const t of byId.values()) merged.push({ id: t.transferId, jobId: "", createdAt: t.createdAt, updatedAt: t.updatedAt, from: { chain: t.from.chain as TransferRecord["from"]["chain"], address: t.from.wallet }, to: { chain: t.to.chain as TransferRecord["to"]["chain"], address: t.to.address }, amount: t.amount, expectedReceive: t.expectedReceive, route: t.route, mode: t.mode, venue: t.venue, status: t.status, depositHash: t.depositHash, payoutHash: t.payoutHash, receipt: t.receipt, help: t.help, error: t.reason, mine: false })
    merged.sort((a, b) => b.createdAt - a.createdAt)
    return ok({ transfers: merged, remoteError })
  } catch (e) { return fail(e) }
}
