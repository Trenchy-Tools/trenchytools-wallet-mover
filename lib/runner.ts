/**
 * Local mode's move runner: jobs in this server's memory (globalThis, so a dev reload keeps them), keys from the wallet
 * folder, every leg written to transfers.json. The run itself (preflight → create → verify → sign → send → sent → poll)
 * is lib/core/runner.ts, shared with the browser engine of demo mode.
 */
import { balancesFor, isRunning, newJob, preflightBackups as checkBackups, prepareRelay as makeRelay, publicJob, runJob, type Job, type PublicJob } from "./core/runner"
import type { MovePlan } from "./core/moves"
import type { WalletInfo } from "./core/wallet-record"
import { serverEnv } from "./env"
import { serverState } from "./paths"
import { upsertRecord } from "./transfers"
import { walletStore } from "./wallets"

export { balancesFor, publicJob, type Job, type PublicJob }

const jobs = serverState("jobs", () => new Map<string, Job>())
export const getJob = (id: string) => jobs.get(id)
export const listJobs = () => [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt)
export const runningJob = () => [...jobs.values()].find(isRunning)

/** The backup rule before a job exists: every wallet of ours in the plan has its file (409 not_backed_up otherwise). */
export const preflightBackups = (plan: MovePlan) => checkBackups(walletStore, plan)
/** A pool move's relay wallet: written to the folder before anything else. */
export const prepareRelay = (plan: MovePlan) => makeRelay(walletStore, plan)

export function startJob(plan: MovePlan, relay?: WalletInfo & { path: string }): Job {
  const job = newJob(plan, relay)
  jobs.set(job.id, job)
  void runJob({ ...serverEnv(), ledger: { upsert: upsertRecord }, print: (j, line) => console.log(`[move ${j.id}] ${line}`) }, job, plan)
  return job
}
