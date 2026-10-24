// GET /api/move/run/:id → the job with every leg's state, log and message (polled by the Move page while a run is live)
import { coded } from "@/lib/core/errors"
import { fail, ok } from "@/lib/http"
import { getJob, publicJob } from "@/lib/runner"

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const job = getJob(id)
  if (!job) return fail(coded("no such job (jobs live in memory; the Activity page has the ledger)", "not_found"), 404)
  return ok({ job: publicJob(job) })
}
