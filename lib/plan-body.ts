/**
 * The desk's request body → a MovePlan (lib/moves.ts). Shared by POST /api/move/plan (the plan line), /preview (quotes)
 * and /run (signs and sends), so what the desk shows is exactly what runs.
 *
 *   { from: Endpoint[], to: Endpoint[],
 *     amounts: Array<number | "max">,   one per row of the amount side (To rows when distributing, From rows otherwise);
 *                                       "max" on a From row = its balance minus the chain's gas reserve, read now
 *     total?, split?: "even" | "uneven" | "fixed", fixedEach?   distribute without amounts: cut `total` for the To rows
 *     route, mode, venue, scatter?, seed? }
 *
 * Every address is checked for its chain; a wallet the folder knows is "ours" whatever the client said.
 */
import { CHAINS, isChainId, looksLikeAddress, type ChainId } from "./chains"
import { amountSideOf, fixedEach, maxAmount, onGrid, planLegs, planTotal, poolCutsPreview, requiredBySource, shapeOf, splitEven, splitUneven, type Endpoint, type MovePlan, type PlanInput, type Split } from "./moves"
import { balancesFor } from "./runner"
import { MODES, effectiveSettings, type Mode } from "./settings"
import { trenchy } from "./trenchy"
import { getWallet } from "./wallets"

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

function endpoints(v: unknown, what: string): Endpoint[] {
  if (!Array.isArray(v)) throw new Error(`${what}: a list of { chain, address } is required`)
  return v.map((e: { chain?: unknown; address?: unknown; label?: unknown }) => {
    const chain = e?.chain
    const address = typeof e?.address === "string" ? e.address.trim() : ""
    if (!isChainId(chain)) throw new Error(`${what}: unknown chain "${String(chain)}"`)
    if (!looksLikeAddress(chain, address)) throw new Error(`${what}: "${address}" is not a ${CHAINS[chain].name} address`)
    // "ours" when the folder knows the wallet, or when the client picked it from its list (a deleted file must still be refused, not treated as an outside address)
    const ours = getWallet(address, chain as ChainId)
    return { chain, address: ours?.publicKey ?? address, label: ours?.label ?? (typeof e.label === "string" ? e.label : undefined), ours: !!ours || (e as { ours?: unknown }).ours === true }
  })
}

const isSplit = (v: unknown): v is Split => (["even", "uneven", "fixed"] as const).includes(v as Split)

/** The body → a plan with every amount resolved. Reads balances only when a "max" row asks for them. */
export async function planFromBody(b: MoveBody): Promise<PlanView> {
  const s = effectiveSettings()
  const reserve = (c: ChainId) => (CHAINS[c].kind === "sol" ? s.gasReserveSol : s.gasReserveEth)
  const from = endpoints(b.from, "from")
  const to = endpoints(b.to, "to")
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
    const balances = maxRows.length ? await balancesFor(trenchy(), maxRows) : new Map<string, number | null>()
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
