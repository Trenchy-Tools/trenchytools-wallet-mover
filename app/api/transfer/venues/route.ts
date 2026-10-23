// GET /api/transfer/venues   → GET /api/transfer/venues on the API: which exchange venues are open right now
import { fail, ok } from "@/lib/http"
import { trenchy } from "@/lib/trenchy"

export async function GET() {
  try { return ok(await trenchy().transfer.venues()) } catch (e) { return fail(e) }
}
