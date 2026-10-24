/**
 * The desk's arithmetic: shapes, splits and leg planning. Pure functions, shared by local mode (the server routes) and demo mode (the browser engine). No node imports.
 *
 *   From  To    Shape         Amounts
 *   1     1     send          one amount, or Max (balance − gas reserve)
 *   1     many  distribute    split evenly · split unevenly (random cuts) · fixed each
 *   many  1     consolidate   per-source amount, or Max all
 *   many  many  pairwise      equal counts pair up: row i of From pays row i of To (amount per source)
 *   many  many  pool          "Scatter amounts": sources → a fresh relay wallet (phase 1), relay → destinations with unrelated cuts (phase 2)
 *
 * The side with more wallets carries the amounts (the launcher's rule): To rows when distributing, From rows otherwise.
 * All splits live on a 0.001 grid and sum exactly to the total. Cross-chain legs always take the exchange route.
 */
import { CHAINS, type ChainId, type Mode } from "../chains"

export type Shape = "send" | "distribute" | "consolidate" | "pairwise" | "pool"
export type Split = "even" | "uneven" | "fixed"
export type RouteKind = "direct" | "exchange"
export type AmountSide = "from" | "to"

export const GRID = 0.001
const UNIT = 1000 // grid steps per coin
export const toUnits = (x: number) => Math.round(x * UNIT)
export const fromUnits = (u: number) => u / UNIT
/** Snap to the grid (half up), never below one step. */
export const onGrid = (x: number) => Math.max(GRID, fromUnits(toUnits(x)))

/** The shape the counts give; many→many is pairwise unless the amounts are to be scattered through a relay. */
export function shapeOf(nFrom: number, nTo: number, scatter = false): Shape | null {
  if (!nFrom || !nTo) return null
  if (nFrom === 1) return nTo === 1 ? "send" : "distribute"
  if (nTo === 1) return "consolidate"
  return scatter ? "pool" : "pairwise"
}

/** Which basket carries the per-row amounts: To when distributing, From for every other shape. */
export const amountSideOf = (shape: Shape): AmountSide => (shape === "distribute" ? "to" : "from")

export const SHAPE_TEXT: Record<Shape, string> = { send: "send", distribute: "distribute", consolidate: "consolidate", pairwise: "pair up", pool: "pool & redistribute" }

/** A small seeded generator (mulberry32) so a "Re-roll" on the desk and the run that follows draw the same cuts. */
export function seededRandom(seed: number): () => number {
  let a = (seed >>> 0) || 1
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Even cuts on the grid; the remainder (at most n−1 steps) goes one step each to the first legs. */
export function splitEven(total: number, n: number): number[] {
  const units = toUnits(total)
  if (n < 1 || units < n) throw new Error(`${total} cannot be split ${n} ways on a ${GRID} grid`)
  const base = Math.floor(units / n)
  const rem = units - base * n
  return Array.from({ length: n }, (_, i) => fromUnits(base + (i < rem ? 1 : 0)))
}

/**
 * Random cuts: largest ≈ 3× smallest, none under 40 % of the even share, on the grid, summing exactly to the total.
 * Weights are drawn in [1, 3] (so max/min ≤ 3), then pulled toward the even share just enough that the smallest cut
 * reaches the 40 % floor (pulling toward even only shrinks the max/min ratio). Rounding uses the largest-remainder
 * method; any step a floor still misses is taken from the largest cut. Press again for a new draw.
 */
export function splitUneven(total: number, n: number, rand: () => number = Math.random): number[] {
  const units = toUnits(total)
  if (n < 1 || units < n) throw new Error(`${total} cannot be split ${n} ways on a ${GRID} grid`)
  if (n === 1) return [fromUnits(units)]
  const even = units / n
  const floor = Math.ceil(0.4 * even)
  const w = Array.from({ length: n }, () => 1 + 2 * rand())
  const sum = w.reduce((a, b) => a + b, 0)
  let cuts = w.map((x) => (x / sum) * units)
  const minCut = Math.min(...cuts)
  if (minCut < floor) {
    // cuts' = λ·cuts + (1−λ)·even keeps the sum; choose λ so the smallest cut lands on the floor
    const lambda = (even - floor) / (even - minCut)
    cuts = cuts.map((c) => lambda * c + (1 - lambda) * even)
  }
  // largest-remainder rounding to whole grid steps
  const floors = cuts.map(Math.floor)
  let left = units - floors.reduce((a, b) => a + b, 0)
  const order = cuts.map((c, i) => ({ i, frac: c - Math.floor(c) })).sort((a, b) => b.frac - a.frac)
  for (const { i } of order) { if (left <= 0) break; floors[i]++; left-- }
  // rounding may leave a cut under its floor, or push max/min past 3 on a coarse grid: move single steps from the
  // largest cut to the smallest until both hold (each move shrinks the spread, so this ends)
  for (let guard = 0; guard < units; guard++) {
    const big = floors.indexOf(Math.max(...floors))
    const small = floors.indexOf(Math.min(...floors))
    if (floors[small] >= floor && floors[big] <= 3 * floors[small]) break
    if (floors[big] - 1 < floors[small] + 1) break
    floors[big]--
    floors[small]++
  }
  return floors.map(fromUnits)
}

export const fixedEach = (each: number, n: number): number[] => Array.from({ length: n }, () => onGrid(each))

/** Max out a wallet: balance minus the chain's gas reserve, rounded down to 6 decimals, never negative. */
export function maxAmount(balance: number, gasReserve: number): number {
  return Math.max(0, Math.floor((balance - gasReserve) * 1e6) / 1e6)
}

export const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 1e9) / 1e9

// ── legs ────────────────────────────────────────────────────────────────────

export type Endpoint = { chain: ChainId; address: string; label?: string; ours: boolean }
export type PlannedLeg = { phase: 1 | 2; from: Endpoint; to: Endpoint; amount: number; route: RouteKind; mode: Mode | null; venue: string | null }
export type PoolRule = { relayChain: ChainId; split: Split; fixedEach?: number; seed?: number }
export type MovePlan = { shape: Shape; legs: PlannedLeg[]; pool?: PoolRule; route: RouteKind; mode: Mode; venue: string; notes: string[] }

export type PlanInput = {
  from: Endpoint[]
  to: Endpoint[]
  /** one per row of the amount side: To rows when distributing, From rows otherwise (send: [amount]) */
  amounts: number[]
  route: RouteKind
  mode: Mode
  venue: string
  /** many→many: pool the sources in a relay and hand the destinations unrelated cuts (else equal counts pair up) */
  scatter?: boolean
  /** pool only: how the relay cuts the pool for the destinations (default uneven) and the draw's seed */
  split?: Split
  fixedEach?: number
  seed?: number
}

const legRoute = (from: Endpoint, to: Endpoint, chosen: RouteKind): RouteKind => (from.chain !== to.chain ? "exchange" : chosen)

function leg(phase: 1 | 2, from: Endpoint, to: Endpoint, amount: number, p: { route: RouteKind; mode: Mode; venue: string }): PlannedLeg {
  const route = legRoute(from, to, p.route)
  return { phase, from, to, amount, route, mode: route === "exchange" ? p.mode : null, venue: route === "exchange" ? p.venue : null }
}

/** The relay of a pool move lives where phase 2 can be signed: the destinations' chain when they share a source-capable one, else the first source's chain. */
export function relayChainFor(from: Endpoint[], to: Endpoint[]): ChainId {
  const toChains = new Set(to.map((t) => t.chain))
  if (toChains.size === 1) { const c = to[0].chain; if (CHAINS[c].source) return c }
  return from[0].chain
}

/** Turn baskets + amounts into legs. Pool legs of phase 2 carry amount 0: they are cut once the relay holds the pool. */
export function planLegs(p: PlanInput): MovePlan {
  const shape = shapeOf(p.from.length, p.to.length, p.scatter)
  if (!shape) throw new Error(p.from.length ? "Put a wallet in To, or paste an address to send to." : "Put at least one wallet in From.")
  for (const f of p.from) if (!CHAINS[f.chain].source) throw new Error(`${CHAINS[f.chain].name} is a destination-only chain: it cannot be a source`)
  for (const f of p.from) for (const t of p.to) if (f.chain === t.chain && f.address.toLowerCase() === t.address.toLowerCase()) throw new Error(`${f.label ?? f.address} cannot send to itself.`)
  for (const a of p.amounts) if (!(a > 0)) throw new Error("Set an amount on every row.")
  const opts = { route: p.route, mode: p.mode, venue: p.venue }
  const notes: string[] = []
  const legs: PlannedLeg[] = []
  let pool: PoolRule | undefined

  if (shape === "send") legs.push(leg(1, p.from[0], p.to[0], p.amounts[0], opts))
  else if (shape === "distribute") {
    if (p.amounts.length !== p.to.length) throw new Error("distribute: one amount per destination")
    p.to.forEach((t, i) => legs.push(leg(1, p.from[0], t, p.amounts[i], opts)))
  } else if (shape === "consolidate") {
    if (p.amounts.length !== p.from.length) throw new Error("consolidate: one amount per source")
    p.from.forEach((f, i) => legs.push(leg(1, f, p.to[0], p.amounts[i], opts)))
  } else if (shape === "pairwise") {
    if (p.from.length !== p.to.length) throw new Error(`${p.from.length} into ${p.to.length} does not pair up: one destination, the same number on both sides, or tick Scatter amounts.`)
    if (p.amounts.length !== p.from.length) throw new Error("pair up: one amount per source")
    p.from.forEach((f, i) => legs.push(leg(1, f, p.to[i], p.amounts[i], opts)))
    notes.push("Paired: row i of From pays row i of To. Pairs stay matchable by amount and timing; tick Scatter amounts to pool and redistribute instead.")
  } else {
    if (p.amounts.length !== p.from.length) throw new Error("pool: one amount per source")
    const relayChain = relayChainFor(p.from, p.to)
    pool = { relayChain, split: p.split ?? "uneven", fixedEach: p.fixedEach, seed: p.seed }
    const relay: Endpoint = { chain: relayChain, address: "(relay wallet, created when the move runs)", label: "relay", ours: true }
    p.from.forEach((f, i) => legs.push(leg(1, f, relay, p.amounts[i], opts)))
    p.to.forEach((t) => legs.push(leg(2, relay, t, 0, opts)))
    notes.push(`Pool & redistribute: the ${p.from.length} sources pay a fresh relay wallet on ${CHAINS[relayChain].name} (created and backed up when the move starts); once every payment has landed, the relay pays the ${p.to.length} destinations ${pool.split === "fixed" ? `${pool.fixedEach} each` : `with ${pool.split} cuts of the pool`} (minus its gas reserve). Sources and destinations never meet in one transaction.`)
  }
  if (legs.some((l) => l.route === "exchange" && l.from.chain !== l.to.chain)) notes.push("Cross-chain legs always travel through the exchange route.")
  if (legs.some((l) => l.route === "direct")) notes.push("Direct legs: one signed transfer each; the two wallets are linked on chain.")
  if (legs.some((l) => l.route === "exchange")) notes.push(`Exchange legs: the destination is paid by the exchange, not by your wallet (reduces on-chain linkability)${p.venue !== "auto" && p.venue !== "random" ? `; venue ${p.venue} pays the destination from that exchange: breaks the wallet cluster` : ""}.`)
  return { shape, legs, pool, route: p.route, mode: p.mode, venue: p.venue, notes }
}

/** The amount leaving the sources (phase-1 legs): what the plan line reports. */
export const planTotal = (plan: MovePlan): number => sum(plan.legs.filter((l) => l.phase === 1).map((l) => l.amount))

/**
 * What a pool move's relay is expected to hand each destination: the phase-1 total minus the relay's gas reserve, cut
 * the way the runner will (same seed, same draw). The runner re-cuts from what actually lands, so these are estimates.
 */
export function poolCutsPreview(plan: MovePlan, relayReserve: number): number[] | null {
  if (!plan.pool) return null
  const n = plan.legs.filter((l) => l.phase === 2).length
  const pool = maxAmount(planTotal(plan), relayReserve)
  try {
    if (plan.pool.split === "fixed") return fixedEach(plan.pool.fixedEach ?? 0, n)
    return plan.pool.split === "even" ? splitEven(pool, n) : splitUneven(pool, n, plan.pool.seed !== undefined ? seededRandom(plan.pool.seed) : Math.random)
  } catch {
    return null
  }
}

/** What each source must hold before anything is created: its phase-1 legs plus the chain's gas reserve. */
export function requiredBySource(plan: MovePlan, reserve: (chain: ChainId) => number): Array<{ chain: ChainId; address: string; label?: string; needs: number; legs: number }> {
  const by = new Map<string, { chain: ChainId; address: string; label?: string; needs: number; legs: number }>()
  for (const l of plan.legs) {
    if (l.phase !== 1) continue
    const k = `${l.from.chain}:${l.from.address}`
    const cur = by.get(k) ?? { chain: l.from.chain, address: l.from.address, label: l.from.label, needs: reserve(l.from.chain), legs: 0 }
    cur.needs = Math.round((cur.needs + l.amount) * 1e9) / 1e9
    cur.legs++
    by.set(k, cur)
  }
  return [...by.values()]
}
