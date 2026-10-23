// POST /api/move/preview  (same body as /run)  → the legs with a quote each from GET /api/transfer/routes, nothing created.
// One quote per distinct (from chain, to chain, amount); the row matching the leg's route · mode · venue is attached,
// legs under the route's minimum are flagged. The desk itself uses /api/move/plan (no quotes); this stays for scripts.
import { type ChainId } from "@/lib/chains"
import { body, fail, ok } from "@/lib/http"
import { planFromBody, type MoveBody } from "@/lib/plan-body"
import { trenchy, type TransferRoute } from "@/lib/trenchy"

export async function POST(req: Request) {
  try {
    const plan = await planFromBody(await body<MoveBody>(req))
    const api = trenchy()
    const cache = new Map<string, Promise<{ routes: TransferRoute[]; venues?: string[] } | { error: string; code?: string }>>()
    const quoteFor = (from: ChainId, to: ChainId, amount: number) => {
      const k = `${from}>${to}@${amount}`
      if (!cache.has(k)) cache.set(k, api.transfer.routes(from, to, amount).catch((e) => ({ error: e instanceof Error ? e.message : String(e), code: (e as { code?: string }).code })))
      return cache.get(k)!
    }
    const legs = await Promise.all(plan.legs.map(async (l) => {
      if (l.amount <= 0) return { ...l, quote: null, note: "cut once the relay holds the pool" }
      const r = await quoteFor(l.from.chain, l.to.chain, l.amount)
      if ("error" in r) return { ...l, quote: null, error: r.error, code: r.code }
      const rows = r.routes
      const known = (r as { venues?: string[] }).venues ?? []
      if (l.route === "exchange" && l.venue && known.length && !known.includes(l.venue)) return { ...l, quote: null, error: `unknown venue "${l.venue}" (the API knows ${known.join(", ")})` }
      const q = l.route === "direct"
        ? rows.find((x) => x.route === "direct")
        : rows.find((x) => x.route === "exchange" && x.venue === l.venue && (l.venue !== "auto" || x.mode === l.mode)) ?? rows.find((x) => x.route === "exchange" && x.mode === l.mode && x.venue === "auto")
      if (!q) return { ...l, quote: null, error: l.route === "direct" ? "no direct route for this pair (different chains?)" : "the exchange route is not open for this pair right now" }
      const underMin = q.min !== undefined && l.amount < q.min
      // a named venue's row carries the venue's health; the mode's fee is applied on top of the venue's quote the way the API does
      return { ...l, quote: { route: q.route, mode: l.route === "exchange" ? l.mode : null, venue: q.venue, status: q.status, receive: q.receive, fee: q.fee, networkFee: q.networkFee, etaS: q.etaS, min: q.min, max: q.max, note: q.note, underMin, closed: q.status === "closed" } }
    }))
    return ok({ ...plan, legs })
  } catch (e) { return fail(e, 400) }
}
