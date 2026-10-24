// GET /api/activity?refresh=1   every transfer this app started (transfers.json) merged with GET /api/transfer (the API's
// view of the same orders: status, hashes, receipt, help). With ?refresh=1 each non-final local record is re-read with
// GET /api/transfer/:id so a leg the runner stopped following still moves along (lib/core/transfers.ts).
import { activity } from "@/lib/core/transfers"
import { fail, ok } from "@/lib/http"
import { trenchy } from "@/lib/settings"
import { fileLedger } from "@/lib/transfers"

export async function GET(req: Request) {
  try {
    return ok(await activity(trenchy(), fileLedger, new URL(req.url).searchParams.get("refresh") === "1"))
  } catch (e) { return fail(e) }
}
