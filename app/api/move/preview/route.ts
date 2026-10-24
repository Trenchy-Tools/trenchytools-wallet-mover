// POST /api/move/preview  (same body as /run)  → the legs with a quote each from GET /api/transfer/routes, nothing created.
// One quote per distinct (from chain, to chain, amount); the row matching the leg's route · mode · venue is attached,
// legs under the route's minimum are flagged. The desk itself uses /api/move/plan (no quotes); this stays for scripts.
import { planFromBody, previewPlan, type MoveBody } from "@/lib/core/plan-body"
import { serverEnv } from "@/lib/env"
import { body, fail, ok } from "@/lib/http"

export async function POST(req: Request) {
  try {
    const env = serverEnv()
    return ok(await previewPlan(env, await planFromBody(env, await body<MoveBody>(req))))
  } catch (e) { return fail(e, 400) }
}
