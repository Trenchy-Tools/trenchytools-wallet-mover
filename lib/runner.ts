/**
 * Runs a move: preflight balances → create order(s) → verify deposit → sign → send → /sent → poll status.
 *
 * Nothing is created before every source is known to hold its legs plus the gas reserve (the preflight stops the move
 * with a plain message otherwise). The backup rule is checked BEFORE a job exists (preflightBackups, in the route).
 *
 *   direct leg    POST /api/transfer (route "direct", a record) → GET /api/sol/blockhash | GET /api/rh/account →
 *                 build + sign locally → POST /api/sol/send | POST /api/rh/send → POST /api/transfer/:id/sent →
 *                 GET /api/sol/tx/:sig | GET /api/rh/tx/:hash until confirmed
 *   exchange leg  POST /api/transfer or /batch → verify the unsigned deposit (payer, destination, exact amount) →
 *                 sign → POST /api/sol/send | /api/rh/send → POST /api/transfer/:id/sent → GET /api/transfer/:id
 *                 until completed | failed | expired | refunded | cancelled; `receipt` and `help` shown verbatim
 *   pool (many→many)  phase 1 consolidates into the relay wallet; once it holds the pool, phase 2 cuts it for the destinations
 *
 * Jobs live in memory (globalThis, so a dev reload keeps them); every leg is also written to transfers.json.
 */
import { CHAINS, shortAddress, type ChainId } from "./chains"
import { accountFromKey, signEvmTransfer, toWei, verifyEvmDeposit, type EvmAccountInfo } from "./evm"
import { fixedEach, maxAmount, requiredBySource, seededRandom, splitEven, splitUneven, sum, type MovePlan, type PlannedLeg } from "./moves"
import { serverState } from "./paths"
import { effectiveSettings } from "./settings"
import { buildSolTransfer, depositTxFromBase64, keypairFromSecret, signSol, toLamports, verifySolDeposit } from "./sol"
import { ApiError, isLegError, transferDone, trenchy, type DepositTx, type TransferCreated, type TransferHelp, type TransferStatus, type Trenchy } from "./trenchy"
import { upsertRecord, type TransferRecord } from "./transfers"
import { assertBackedUp, createWallets, getWallet, missingFiles, secretOf, type WalletInfo } from "./wallets"

export type LegState = PlannedLeg & {
  index: number
  /** planned · refused · created · sent · confirmed · awaiting_deposit · exchanging · completed · failed · expired · refunded · cancelled · stuck */
  status: string
  transferId?: string
  depositAddress?: string
  depositAmount?: number
  depositHash?: string | null
  payoutHash?: string | null
  expectedReceive?: number | null
  venueUsed?: string | null
  venueHonoured?: boolean
  /** the unsigned deposit the API built (exchange legs); verified, then signed */
  transaction?: DepositTx
  receipt?: string
  help?: TransferHelp
  error?: string
  code?: string
  hint?: string
  docs?: string
  updatedAt: number
}
export type Job = {
  id: string
  createdAt: number
  updatedAt: number
  shape: MovePlan["shape"]
  status: "preflight" | "running" | "done" | "failed"
  message?: string
  legs: LegState[]
  relay?: { publicKey: string; chain: ChainId; file: string; path: string }
  log: Array<{ t: number; msg: string }>
}

const jobs = serverState("jobs", () => new Map<string, Job>())
export const getJob = (id: string) => jobs.get(id)
/** A job for the UI: the unsigned deposit bytes stay on the server. */
export const publicJob = (j: Job) => ({ ...j, legs: j.legs.map(({ transaction: _t, ...l }) => l) })
export type PublicJob = ReturnType<typeof publicJob>
export const listJobs = () => [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt)
export const runningJob = () => [...jobs.values()].find((j) => j.status === "preflight" || j.status === "running")

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const key = (chain: ChainId, address: string) => `${chain}:${address.toLowerCase()}`
const DONE_OK = new Set(["completed", "confirmed"])
const isOurs = (chain: ChainId, address: string) => !!getWallet(address, chain) || missingFiles().some((m) => m.chain === chain && m.publicKey.toLowerCase() === address.toLowerCase())

/**
 * The backup rule, before a job exists: every source signs with a key that must be on disk, and every destination of
 * ours must have its file (a wallet the folder or wallets.csv knows is "ours", whatever the client said). Throws
 * NotBackedUpError → the route answers 409 not_backed_up.
 */
export function preflightBackups(plan: MovePlan): void {
  const placeholder = (a: string) => a.startsWith("(") // the relay of a pool move before prepareRelay() created it
  for (const l of plan.legs) {
    if (!placeholder(l.from.address)) assertBackedUp(l.from.address, l.from.chain)
    if (!placeholder(l.to.address) && (l.to.ours || isOurs(l.to.chain, l.to.address))) assertBackedUp(l.to.address, l.to.chain)
  }
}

/** A pool move's relay wallet: created and backed up on the spot, then written into the plan's legs. */
export function prepareRelay(plan: MovePlan): (WalletInfo & { path: string }) | undefined {
  if (!plan.pool) return undefined
  const [relay] = createWallets(1, plan.pool.relayChain, "relay", `relay ${new Date().toISOString().slice(0, 16).replace("T", " ")}`)
  for (const l of plan.legs) {
    if (l.phase === 1) l.to = { chain: relay.chain, address: relay.publicKey, label: relay.label, ours: true }
    else l.from = { chain: relay.chain, address: relay.publicKey, label: relay.label, ours: true }
  }
  return relay
}

export function startJob(plan: MovePlan, relay?: WalletInfo & { path: string }): Job {
  const now = Date.now()
  const job: Job = {
    id: `m_${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, createdAt: now, updatedAt: now, shape: plan.shape, status: "preflight",
    legs: plan.legs.map((l, index) => ({ ...l, index, status: "planned", updatedAt: now })),
    relay: relay ? { publicKey: relay.publicKey, chain: relay.chain, file: relay.file, path: relay.path } : undefined,
    log: [],
  }
  jobs.set(job.id, job)
  void run(job, plan).catch((e) => { job.status = "failed"; job.message = msg(e); log(job, `Failed: ${msg(e)}`) })
  return job
}

function log(job: Job, line: string) {
  job.log.push({ t: Date.now(), msg: line })
  job.updatedAt = Date.now()
  console.log(`[move ${job.id}] ${line}`)
}

function touch(job: Job, leg: LegState, patch: Partial<LegState>) {
  Object.assign(leg, patch, { updatedAt: Date.now() })
  job.updatedAt = Date.now()
  if (leg.status !== "planned") upsertRecord(recordOf(job, leg))
}

function failLeg(job: Job, leg: LegState, e: unknown, status = "failed") {
  const patch: Partial<LegState> = { status, error: msg(e) }
  if (e instanceof ApiError) Object.assign(patch, { code: e.code, hint: e.hint, docs: e.docs })
  touch(job, leg, patch)
  log(job, `leg ${leg.index + 1} ${status}: ${msg(e)}`)
}

const recordOf = (job: Job, l: LegState): TransferRecord => ({
  id: l.transferId ?? `local:${job.id}:${l.index}`, jobId: job.id, createdAt: job.createdAt, updatedAt: l.updatedAt,
  from: { chain: l.from.chain, address: l.from.address, label: l.from.label }, to: { chain: l.to.chain, address: l.to.address, label: l.to.label },
  amount: l.amount, expectedReceive: l.expectedReceive ?? null, route: l.route, mode: l.mode, venue: l.venueUsed ?? l.venue, venueRequested: l.venue ?? undefined, venueHonoured: l.venueHonoured,
  status: l.status, depositHash: l.depositHash ?? null, payoutHash: l.payoutHash ?? null, receipt: l.receipt, help: l.help, error: l.error, code: l.code,
})

/** Native balances for a set of (chain, address): GET /api/sol/balances?wallets= and GET /api/rh/balances?wallets=. Unreadable chains → null. */
export async function balancesFor(api: Trenchy, items: Array<{ chain: ChainId; address: string }>): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>()
  const sol = [...new Set(items.filter((i) => i.chain === "sol").map((i) => i.address))]
  const rh = [...new Set(items.filter((i) => i.chain === "rh").map((i) => i.address))]
  if (sol.length) for (const b of await api.sol.balances(sol)) out.set(key("sol", b.wallet), b.sol)
  if (rh.length) for (const b of await api.rh.balances(rh)) out.set(key("rh", b.wallet), b.eth)
  for (const i of items) if (!out.has(key(i.chain, i.address))) out.set(key(i.chain, i.address), CHAINS[i.chain].balances ? 0 : null)
  return out
}

// ── the run ─────────────────────────────────────────────────────────────────

async function run(job: Job, plan: MovePlan): Promise<void> {
  const api = trenchy()
  const s = effectiveSettings()
  const reserve = (c: ChainId) => (CHAINS[c].kind === "sol" ? s.gasReserveSol : s.gasReserveEth)

  // 1. preflight: every source holds its legs + the gas reserve, or nothing happens
  log(job, "Preflight: reading source balances")
  const required = requiredBySource(plan, reserve)
  const balances = await balancesFor(api, required)
  const short = required.filter((r) => (balances.get(key(r.chain, r.address)) ?? 0) < r.needs)
  if (short.length) {
    const native = (c: ChainId) => CHAINS[c].native
    job.status = "failed"
    job.message = `Preflight stopped the move: ${short.map((r) => `${r.label ?? shortAddress(r.address)} holds ${balances.get(key(r.chain, r.address)) ?? 0} ${native(r.chain)}, needs ${r.needs} ${native(r.chain)} (${r.legs} leg${r.legs > 1 ? "s" : ""} + ${reserve(r.chain)} gas reserve)`).join("; ")}. Nothing was created, signed or sent.`
    for (const l of job.legs) touch(job, l, { status: "planned" })
    log(job, job.message)
    return
  }
  job.status = "running"
  log(job, `Preflight passed for ${required.length} source wallet${required.length > 1 ? "s" : ""}`)

  // 2. phase 1
  await runPhase(job, plan, api, 1)

  // 3. phase 2 of a pool move: wait for the relay to hold the pool, cut it, pay the destinations
  if (plan.pool && job.relay) {
    const landed = job.legs.filter((l) => l.phase === 1 && DONE_OK.has(l.status))
    if (!landed.length) {
      job.status = "failed"
      job.message = "No phase-1 leg reached the relay wallet; phase 2 was not started. The relay wallet's file stays in the folder."
      log(job, job.message)
      return
    }
    const relayChain = job.relay.chain
    log(job, `Waiting for the relay ${shortAddress(job.relay.publicKey)} on ${CHAINS[relayChain].name} to hold the pool`)
    let pool = 0
    const until = Date.now() + 15 * 60_000
    while (Date.now() < until) {
      const b = (await balancesFor(api, [{ chain: relayChain, address: job.relay.publicKey }]).catch(() => new Map<string, number | null>())).get(key(relayChain, job.relay.publicKey)) ?? 0
      pool = maxAmount(b, reserve(relayChain))
      if (pool > 0 && landed.length === job.legs.filter((l) => l.phase === 1).length) break
      if (pool > 0 && Date.now() > until - 12 * 60_000) break // some legs failed: go with what landed after a short grace
      await sleep(10_000)
    }
    const phase2 = job.legs.filter((l) => l.phase === 2)
    let cuts: number[]
    try {
      cuts = plan.pool.split === "fixed" ? fixedEach(plan.pool.fixedEach ?? 0, phase2.length) : plan.pool.split === "even" ? splitEven(pool, phase2.length) : splitUneven(pool, phase2.length, plan.pool.seed !== undefined ? seededRandom(plan.pool.seed) : Math.random)
      if (sum(cuts) > pool) throw new Error(`the relay holds ${pool} ${CHAINS[relayChain].native} after its gas reserve; the cuts need ${sum(cuts)}`)
    } catch (e) {
      job.status = "failed"
      job.message = `Phase 2 not started: ${msg(e)}. The pool stays in the relay wallet (its file is in the folder).`
      log(job, job.message)
      return
    }
    phase2.forEach((l, i) => touch(job, l, { amount: cuts[i] }))
    log(job, `Relay holds ${pool} ${CHAINS[relayChain].native}; phase 2 cuts: ${cuts.join(", ")}`)
    await runPhase(job, plan, api, 2)
  }

  const failed = job.legs.filter((l) => !DONE_OK.has(l.status))
  job.status = "done"
  job.message = failed.length ? `${job.legs.length - failed.length} of ${job.legs.length} legs landed; ${failed.length} did not (see each leg)` : `All ${job.legs.length} legs landed`
  log(job, job.message)
}

/** Create the orders of one phase (batch when every leg shares a route, else one POST /api/transfer per leg), then sign, send and follow each. */
async function runPhase(job: Job, plan: MovePlan, api: Trenchy, phase: 1 | 2) {
  const legs = job.legs.filter((l) => l.phase === phase)
  const routes = new Set(legs.map((l) => l.route))
  const batchable = phase === 1 && (plan.shape === "distribute" || plan.shape === "consolidate") && routes.size === 1
  const apply = (leg: LegState, c: TransferCreated) => touch(job, leg, {
    status: "created", transferId: c.transferId, depositAddress: c.deposit?.address, depositAmount: c.deposit?.amount, transaction: c.transaction,
    expectedReceive: c.expected?.receive ?? null, venueUsed: c.venue ?? null, venueHonoured: c.venueHonoured,
  })
  const common = (l: LegState) => ({ route: l.route, ...(l.route === "exchange" ? { mode: l.mode ?? undefined, venue: l.venue ?? undefined } : {}) })

  if (batchable) {
    log(job, `Creating ${legs.length} legs with POST /api/transfer/batch (${legs[0].route})`)
    try {
      const body = plan.shape === "distribute"
        ? { from: { chain: legs[0].from.chain, wallet: legs[0].from.address }, to: legs.map((l) => ({ chain: l.to.chain, address: l.to.address, amount: l.amount })), ...common(legs[0]) }
        : { from: legs.map((l) => ({ chain: l.from.chain, wallet: l.from.address, amount: l.amount })), to: { chain: legs[0].to.chain, address: legs[0].to.address }, ...common(legs[0]) }
      const res = await api.transfer.batch(body)
      legs.forEach((leg, i) => {
        const r = res.legs[i]
        if (!r) return failLeg(job, leg, new Error("the API returned no leg for this row"))
        if (isLegError(r)) return failLeg(job, leg, new ApiError(r.error, 400, r.code))
        apply(leg, r)
      })
    } catch (e) {
      for (const leg of legs) failLeg(job, leg, e)
      return
    }
  } else {
    log(job, `Creating ${legs.length} legs with POST /api/transfer`)
    for (const leg of legs) {
      try { apply(leg, await api.transfer.create({ from: { chain: leg.from.chain, wallet: leg.from.address }, to: { chain: leg.to.chain, address: leg.to.address }, amount: leg.amount, ...common(leg) })) }
      catch (e) { failLeg(job, leg, e) }
    }
  }

  // sign + send, one leg at a time (EVM nonces are handed out in order per wallet)
  const nonces = new Map<string, EvmAccountInfo & { next: number }>()
  for (const leg of legs.filter((l) => l.status === "created")) {
    try { await signAndSend(job, api, leg, nonces) }
    catch (e) { failLeg(job, leg, e) }
  }

  // follow the exchange legs until a terminal status (direct legs were confirmed inside signAndSend)
  await follow(job, api, legs.filter((l) => l.route === "exchange" && l.status === "sent"))
}

/** GET /api/rh/account once per wallet; then pendingNonce + 1 per transaction sent in a row. */
async function evmAccount(api: Trenchy, nonces: Map<string, EvmAccountInfo & { next: number }>, wallet: string) {
  const k = wallet.toLowerCase()
  if (!nonces.has(k)) { const a = await api.rh.account(wallet); nonces.set(k, { ...a, next: a.pendingNonce }) }
  return nonces.get(k)!
}

async function signAndSend(job: Job, api: Trenchy, leg: LegState, nonces: Map<string, EvmAccountInfo & { next: number }>) {
  const chain = CHAINS[leg.from.chain]
  const secret = secretOf(leg.from.address, leg.from.chain) // NotBackedUpError if the file went missing since preflight
  let hash: string

  if (leg.route === "direct") {
    if (chain.kind === "sol") {
      const kp = keypairFromSecret(secret)
      const { blockhash } = await api.sol.blockhash()                                    // GET /api/sol/blockhash
      const tx = buildSolTransfer(kp.publicKey, leg.to.address, toLamports(leg.amount), blockhash)
      const signed = signSol(tx, kp)
      hash = (await api.sol.send(signed.base64, false)).signature                        // POST /api/sol/send (simulated first)
    } else {
      const acct = await evmAccount(api, nonces, leg.from.address)                       // GET /api/rh/account
      const raw = await signEvmTransfer(accountFromKey(secret), { chainId: acct.chainId, nonce: acct.next++, to: leg.to.address, valueWei: toWei(leg.amount), maxFeePerGas: acct.maxFeePerGas, maxPriorityFeePerGas: acct.maxPriorityFeePerGas })
      hash = (await api.rh.send(raw)).hash                                               // POST /api/rh/send
    }
    touch(job, leg, { status: "sent", depositHash: hash })
    if (leg.transferId) await api.transfer.sent(leg.transferId, hash).catch((e) => log(job, `/sent for ${leg.transferId}: ${msg(e)}`)) // POST /api/transfer/:id/sent
    log(job, `leg ${leg.index + 1} sent: ${hash}`)
    await confirmDirect(job, api, leg, hash)
    return
  }

  // exchange leg: the API built the deposit; it must be exactly what we agreed to sign
  const created = leg.depositAddress && leg.depositAmount !== undefined
  if (!created) throw new Error("the order has no deposit address yet (it was still being created); nothing was signed, the order expires on its own")
  if (leg.depositAmount! > leg.amount * 1.05) throw new Error(`deposit amount ${leg.depositAmount} is above the ${leg.amount} asked for; refusing`)
  const order = await api.transfer.status(leg.transferId!).catch(() => null)
  if (order && transferDone(order)) throw new Error(`the order is already ${order.status}`)
  const tx = leg.transaction
  if (!tx) throw new Error("the order carries no deposit transaction")
  if (chain.kind === "sol") {
    const kp = keypairFromSecret(secret)
    const unsigned = depositTxFromBase64(tx.encoding === "base64" && tx.transaction ? tx.transaction : "")
    verifySolDeposit(unsigned, kp.publicKey, leg.depositAddress!, toLamports(leg.depositAmount!))
    const signed = signSol(unsigned, kp)
    hash = (await api.sol.send(signed.base64, false)).signature                          // POST /api/sol/send
  } else {
    if (tx.encoding !== "evm" || !tx.evm) throw new Error("the order carries no EVM deposit transaction")
    verifyEvmDeposit(tx.evm, leg.from.address, leg.depositAddress!, toWei(leg.depositAmount!), chain.chainId!)
    const acct = await evmAccount(api, nonces, leg.from.address)                         // GET /api/rh/account
    const raw = await signEvmTransfer(accountFromKey(secret), { chainId: tx.evm.chainId, nonce: acct.next++, to: tx.evm.to, valueWei: BigInt(tx.evm.value), maxFeePerGas: acct.maxFeePerGas, maxPriorityFeePerGas: acct.maxPriorityFeePerGas })
    hash = (await api.rh.send(raw)).hash                                                 // POST /api/rh/send
  }
  touch(job, leg, { status: "sent", depositHash: hash })
  await api.transfer.sent(leg.transferId!, hash).catch((e) => log(job, `/sent for ${leg.transferId}: ${msg(e)}`)) // POST /api/transfer/:id/sent
  log(job, `leg ${leg.index + 1} deposit sent: ${hash}`)
}

/** A direct leg is done when the chain confirms it: GET /api/sol/tx/:sig or GET /api/rh/tx/:hash, up to 2 minutes. */
async function confirmDirect(job: Job, api: Trenchy, leg: LegState, hash: string) {
  const until = Date.now() + 120_000
  while (Date.now() < until) {
    if (leg.from.chain === "sol") {
      const s = await api.sol.tx(hash).catch(() => null)
      if (s?.err) throw new Error(`transaction failed on chain: ${JSON.stringify(s.err)}`)
      if (s?.confirmationStatus === "confirmed" || s?.confirmationStatus === "finalized") return touch(job, leg, { status: "confirmed", payoutHash: hash })
    } else {
      const s = await api.rh.tx(hash).catch(() => null)
      if (s?.status === "reverted") throw new Error("transaction reverted on chain")
      if (s?.status === "success") return touch(job, leg, { status: "confirmed", payoutHash: hash })
    }
    await sleep(2000)
  }
  touch(job, leg, { status: "sent", error: "not confirmed within 2 minutes; check the hash on the explorer before retrying" })
}

/** Poll GET /api/transfer/:id for every exchange leg until a terminal status; keep `receipt` and `help` verbatim. Gives up after 90 minutes (status "stuck"). */
async function follow(job: Job, api: Trenchy, legs: LegState[]) {
  if (!legs.length) return
  const until = Date.now() + 90 * 60_000
  const pending = new Set(legs)
  while (pending.size && Date.now() < until) {
    for (const leg of pending) {
      const st: TransferStatus | null = await api.transfer.status(leg.transferId!).catch(() => null)
      if (!st) continue
      const patch: Partial<LegState> = { status: st.status, depositHash: st.depositHash ?? leg.depositHash, payoutHash: st.payoutHash, expectedReceive: st.expectedReceive, venueUsed: st.venue, receipt: st.receipt, help: st.help }
      if (st.reason) patch.error = st.reason
      if (JSON.stringify(patch) !== JSON.stringify({ status: leg.status, depositHash: leg.depositHash, payoutHash: leg.payoutHash, expectedReceive: leg.expectedReceive, venueUsed: leg.venueUsed, receipt: leg.receipt, help: leg.help, ...(leg.error ? { error: leg.error } : {}) })) touch(job, leg, patch)
      if (transferDone(st)) { pending.delete(leg); log(job, `leg ${leg.index + 1} ${st.status}${st.payoutHash ? `: ${st.payoutHash}` : ""}`) }
    }
    if (pending.size) await sleep(10_000)
  }
  for (const leg of pending) touch(job, leg, { status: "stuck", error: "no terminal status after 90 minutes; the Activity page keeps following it" })
}
