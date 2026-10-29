// POST /api/move/plan  (same body as /run) → the resolved plan: shape, amount side, per-row amounts ("max" rows filled
// from fresh balances), total, legs, what each source must hold. Nothing is quoted, created, signed or sent: this is
// the desk's plan line. A plan that cannot run answers 400 { error } with the sentence the desk shows.
import { planFromBody, type MoveBody } from "@/lib/core/plan-body"
import { serverEnv } from "@/lib/env"
import { body, fail, ok } from "@/lib/http"

// `calls` on the answer: every request the plan made to the TrenchyTools API (balances), the desk's dry-run trace.
export async function POST(req: Request) {
  const env = serverEnv()
  env.api.beginTrace()
  try { const plan = await planFromBody(env, await body<MoveBody>(req)); return ok({ ...plan, calls: env.api.endTrace() }) } catch (e) { return fail(e, 400) }
}
