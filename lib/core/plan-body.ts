/**
 * The desk's request body → a MovePlan (lib/core/moves.ts). Shared by POST /api/move/plan (the plan line), /preview
 * (quotes) and /run (signs and sends), in both modes, so what the desk shows is exactly what runs. No node imports.
 *
 *   { from: Endpoint[], to: Endpoint[],
 *     amounts: Array<number | "max">,   one per row of the amount side (To rows when distributing, From rows otherwise);
 *                                       "max" on a From row = its balance minus the chain's gas reserve, read now
 *     total?, split?: "even" | "uneven" | "fixed", fixedEach?   distribute without amounts: cut `total` for the To rows
 *     route, mode, venue, scatter?, seed? }
 *
 * Every address is checked for its chain; a wallet the store knows is "ours" whatever the client said.
 */
import { CHAINS, MODES, isChainId, looksLikeAddress, type ChainId, type Mode } from "../chains"
import type { TransferRoute } from "../trenchy"
import { reserveOf, type Env } from "./env"
import { amountSideOf, fixedEach, maxAmount, onGrid, planLegs, planTotal, poolCutsPreview, requiredBySource, shapeOf, splitEven, splitUneven, type Endpoint, type MovePlan, type PlanInput, type Split } from "./moves"
import { balancesFor } from "./runner"

export type MoveBody = { from?: unknown; to?: unknown; amounts?: unknown; total?: unknown; route?: unknown; mode?: unknown; venue?: unknown; scatter?: unknown; split?: unknown; fixedEach?: unknown; seed?: unknown }

export type PlanView = MovePlan & {
  amountSide: "from" | "to"
  /** the resolved per-row amounts of the amount side ("max" rows filled in) */
  amounts: number[]
  total: number
  required: Array<{ chain: ChainId; address: string; label?: string; needs: number; legs: number }>
  /** pool moves: what the relay is expected to hand each destination (estimates; the runner re-cuts from what lands) */
  poolCuts?: number[] | null
}

function endpoints(env: Env, v: unknown, what: string): Endpoint[] {
  if (!Array.isArray(v)) throw new Error(`${what}: a list of { chain, address } is required`)
  return v.map((e: { chain?: unknown; address?: unknown; label?: unknown }) => {
    const chain = e?.chain
    const address = typeof e?.address === "string" ? e.address.trim() : ""
    if (!isChainId(chain)) throw new Error(`${what}: unknown chain "${String(chain)}"`)
    if (!looksLikeAddress(chain, address)) throw new Error(`${what}: "${address}" is not a ${CHAINS[chain].name} address`)
    // "ours" when the store knows the wallet, or when the client picked it from its list (a lost key must still be refused, not treated as an outside address)
    const ours = env.wallets.get(address, chain as ChainId)
    return { chain, address: ours?.publicKey ?? address, label: ours?.label ?? (typeof e.label === "string" ? e.label : undefined), ours: !!ours || (e as { ours?: unknown }).ours === true }
  })
}

const isSplit = (v: unknown): v is Split => (["even", "uneven", "fixed"] as const).includes(v as Split)

/** The body → a plan with every amount resolved. Reads balances only when a "max" row asks for them. */
export async function planFromBody(env: Env, b: MoveBody): Promise<PlanView> {
  const s = env.settings
  const reserve = reserveOf(s)
  const from = endpoints(env, b.from, "from")
  const to = endpoints(env, b.to, "to")
  const scatter = b.scatter === true
  const shape = shapeOf(from.length, to.length, scatter)
  if (!shape) throw new Error(from.length ? "Put a wallet in To, or paste an address to send to." : "Put at least one wallet in From.")
  const side = amountSideOf(shape)
  const rows = side === "from" ? from : to
  const split = isSplit(b.split) ? b.split : undefined
  const fixed = Number(b.fixedEach) > 0 ? Number(b.fixedEach) : undefined

  let amounts: number[]
  const raw = Array.isArray(b.amounts) ? b.amounts : []
  if (shape === "distribute" && split && !raw.length) {
    // the desk's Split evenly / Split unevenly / fixed each: cut the total for the To rows
    const total = Number(b.total)
    if (split === "fixed") amounts = fixedEach(fixed ?? 0, to.length)
    else {
      if (!(total > 0)) throw new Error("Set the total to split.")
      amounts = split === "even" ? splitEven(onGrid(total), to.length) : splitUneven(onGrid(total), to.length)
    }
  } else {
    if (raw.length !== rows.length) throw new Error(`Set an amount on every ${side === "from" ? "From" : "To"} row (${rows.length} row${rows.length === 1 ? "" : "s"}, ${raw.length} amount${raw.length === 1 ? "" : "s"}).`)
    const maxRows = rows.filter((_, i) => raw[i] === "max")
    if (maxRows.length && side === "to") throw new Error("Max applies to From rows only.")
    const balances = maxRows.length ? await balancesFor(env.api, maxRows) : new Map<string, number | null>()
    amounts = rows.map((r, i) => {
      if (raw[i] === "max") {
        const bal = balances.get(`${r.chain}:${r.address.toLowerCase()}`)
        if (bal === null || bal === undefined) throw new Error(`${r.label ?? r.address}: balance not readable on ${CHAINS[r.chain].name}, type the amount.`)
        const m = maxAmount(bal, reserve(r.chain))
        if (!(m > 0)) throw new Error(`${r.label ?? r.address} holds ${bal} ${CHAINS[r.chain].native}: nothing left after the ${reserve(r.chain)} gas reserve.`)
        return m
      }
      const n = Number(raw[i])
      if (!(n > 0)) throw new Error(`Set an amount for ${r.label ?? r.address}.`)
      return n
    })
  }

  const input: PlanInput = {
    from, to, amounts,
    route: b.route === "exchange" ? "exchange" : "direct",
    mode: MODES.includes(b.mode as Mode) ? (b.mode as Mode) : s.mode,
    venue: typeof b.venue === "string" && b.venue ? b.venue : s.venue,
    scatter, split, fixedEach: fixed,
    seed: Number.isFinite(Number(b.seed)) ? Number(b.seed) : undefined,
  }
  const plan = planLegs(input)
  return { ...plan, amountSide: side, amounts, total: planTotal(plan), required: requiredBySource(plan, reserve), poolCuts: plan.pool ? poolCutsPreview(plan, reserve(plan.pool.relayChain)) : undefined }
}

/**
 * POST /api/move/preview: the legs with a quote each from GET /api/transfer/routes, nothing created. One quote per
 * distinct (from chain, to chain, amount); the row matching the leg's route · mode · venue is attached, legs under the
 * route's minimum are flagged.
 */
export async function previewPlan(env: Env, plan: PlanView) {
  const cache = new Map<string, Promise<{ routes: TransferRoute[]; venues?: string[] } | { error: string; code?: string }>>()
  const quoteFor = (from: ChainId, to: ChainId, amount: number) => {
    const k = `${from}>${to}@${amount}`
    if (!cache.has(k)) cache.set(k, env.api.transfer.routes(from, to, amount).catch((e) => ({ error: e instanceof Error ? e.message : String(e), code: (e as { code?: string }).code })))
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
  return { ...plan, legs }
}

export type { MovePlan }
