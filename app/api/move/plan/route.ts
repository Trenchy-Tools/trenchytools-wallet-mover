// POST /api/move/plan  (same body as /run) → the resolved plan: shape, amount side, per-row amounts ("max" rows filled
// from fresh balances), total, legs, what each source must hold. Nothing is quoted, created, signed or sent: this is
// the desk's plan line. A plan that cannot run answers 400 { error } with the sentence the desk shows.
import { body, fail, ok } from "@/lib/http"
import { planFromBody, type MoveBody } from "@/lib/plan-body"

export async function POST(req: Request) {
  try { return ok(await planFromBody(await body<MoveBody>(req))) } catch (e) { return fail(e, 400) }
}
