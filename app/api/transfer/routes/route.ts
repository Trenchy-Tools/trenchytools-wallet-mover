// GET /api/transfer/routes?from=sol&to=rh&amount=0.5   → GET /api/transfer/routes on the API: quotes, minimums, venue status
import { isChainId } from "@/lib/chains"
import { fail, num, ok } from "@/lib/http"
import { trenchy } from "@/lib/trenchy"

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams
  const from = q.get("from"), to = q.get("to"), amount = num(q.get("amount"), 0)
  if (!isChainId(from) || !isChainId(to)) return fail(new Error("from and to must be sol, rh, eth or bnb"), 400)
  if (!(amount > 0)) return fail(new Error("amount must be greater than zero"), 400)
  try { return ok(await trenchy().transfer.routes(from, to, amount)) } catch (e) { return fail(e) }
}
