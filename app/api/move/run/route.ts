// POST /api/move/run  (same body as /plan) → 202 { job }   the backup rule first (409 not_backed_up), the relay wallet
// of a pool move created + backed up, then the job starts: preflight balances → create → sign → send → follow (lib/runner.ts).
// GET  /api/move/run  → { jobs }  every job of this server process, newest first.
import { body, fail, ok } from "@/lib/http"
import { planFromBody, type MoveBody } from "@/lib/plan-body"
import { listJobs, preflightBackups, prepareRelay, publicJob, runningJob, startJob } from "@/lib/runner"

export async function GET() {
  return ok({ jobs: listJobs().map(publicJob) })
}

export async function POST(req: Request) {
  try {
    if (runningJob()) return fail(Object.assign(new Error("a move is already running; wait for it to finish"), { code: "busy" }), 409)
    const plan = await planFromBody(await body<MoveBody>(req))
    preflightBackups(plan)                 // 409 not_backed_up when a wallet of ours has no file
    const relay = prepareRelay(plan)       // pool moves: a fresh relay wallet, written to the folder before anything else
    if (relay) preflightBackups(plan)
    return ok({ job: publicJob(startJob(plan, relay)) }, 202)
  } catch (e) { return fail(e, 400) }
}
