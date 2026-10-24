"use client"

/**
 * The browser engine of demo mode: this app's /api/* routes, answered inside the visitor's tab.
 *
 * Same paths, same request bodies, same JSON answers and error shapes as the route handlers in app/api/** (local
 * mode), so the pages run unchanged on top of it (lib/browser/demo.ts appFetch is the switch). The flows are the shared
 * ones in lib/core/* (desk body → plan, preview quotes, the runner, the activity merge); only the storage differs:
 *
 *   wallets           lib/browser/keystore.ts (localStorage, all chains in one store; not usable until downloaded)
 *   API key           lib/browser/api-key.ts (one per visitor, created on first visit, label demo-mover)
 *   move jobs         in this tab's memory, mirrored to localStorage <prefix>.jobs; a move runs in this tab
 *   activity ledger   localStorage <prefix>.transfers (local mode: transfers.json)
 *   settings          localStorage <prefix>.settings (gas reserves, default route / mode / venue)
 *
 * Every API call goes from the browser straight to https://api.trenchy.tools with the visitor's key (lib/trenchy.ts,
 * the same client class the server uses). Nothing touches the app's own server.
 *
 * Loaded only in demo mode (a dynamic import in demo.ts).
 */
import { MODES, ROUTES, isChainId, isRole, type ChainId, type Mode, type RouteChoice } from "../chains"
import { DEFAULTS, type Env, type MoveSettings, type WalletStore } from "../core/env"
import { coded, errorBody } from "../core/errors"
import { planFromBody, previewPlan, type MoveBody } from "../core/plan-body"
import { balancesFor, isRunning, newJob, preflightBackups, prepareRelay, publicJob, runJob, type Job, type PublicJob } from "../core/runner"
import { activity, upsertInto, type Ledger, type TransferRecord } from "../core/transfers"
import { APP_NAME, newLabel, type WalletInfo } from "../core/wallet-record"
import { ApiError, Trenchy } from "../trenchy"
import { ensureApiKey, keyError, maskKey, readApiKey, replaceApiKey, setApiKey, type KeyOptions } from "./api-key"
import { DEMO_API_URL, DEMO_KEY_LABEL, KEYS_HOME, STORE_PREFIX } from "./demo"
import { createKeystore, idOf, type KeyView } from "./keystore"
import { generateKey, parseSecret } from "./signer"

const P = STORE_PREFIX
const KEY_OPTS: KeyOptions = { storageKey: `${P}.apiKey`, apiUrl: DEMO_API_URL, label: DEMO_KEY_LABEL }

// ── small storage helpers ───────────────────────────────────────────────────

function load<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}
function save(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch (e) {
    throw new Error(`This browser refused to store the data (${e instanceof Error ? e.message : e})`)
  }
}

// ── settings (local mode: settings.json over .env) ──────────────────────────

type BrowserSettings = Partial<MoveSettings>
const NUM_KEYS = ["gasReserveSol", "gasReserveEth"] as const
function settings(): MoveSettings {
  const s = load<BrowserSettings>(`${P}.settings`, {})
  const n = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : d)
  return {
    gasReserveSol: n(s.gasReserveSol, DEFAULTS.gasReserveSol),
    gasReserveEth: n(s.gasReserveEth, DEFAULTS.gasReserveEth),
    route: ROUTES.includes(s.route as RouteChoice) ? s.route! : DEFAULTS.route,
    mode: MODES.includes(s.mode as Mode) ? s.mode! : DEFAULTS.mode,
    venue: typeof s.venue === "string" && s.venue.trim() ? s.venue.trim() : DEFAULTS.venue,
  }
}

/** The API client with the visitor's key (the same class the server uses with its key). */
const api = () => new Trenchy(DEMO_API_URL, readApiKey(KEY_OPTS) ?? "")

// ── wallets: the key store as the store the shared flows use ────────────────

const ks = createKeystore({ prefix: P, app: APP_NAME, fileTag: "mover" })

const info = (w: KeyView): WalletInfo => ({ publicKey: w.publicKey, chain: w.chain, role: w.role, label: w.label, createdAt: w.createdAt, app: w.app, file: KEYS_HOME })

/** Create N wallets on a chain ("Wallet N" without a label), stored before this returns; none is usable until backed up. */
function createWallets(count: number, chain: ChainId, role: WalletInfo["role"] = "trader", label?: string): Array<WalletInfo & { path: string }> {
  const n = Math.min(Math.max(Math.floor(count) || 1, 1), 100)
  const start = ks.seen() + 1
  const out: Array<WalletInfo & { path: string }> = []
  for (let i = 0; i < n; i++) {
    const { wallet } = ks.add({ ...generateKey(chain), chain, role, label: newLabel(label, n, i, start), createdAt: new Date(Date.now() + i).toISOString(), app: APP_NAME })
    out.push({ ...info(wallet), path: KEYS_HOME })
  }
  return out
}

const walletStore: WalletStore = {
  place: "browser",
  get: (pk, chain) => { const w = ks.get(pk, chain); return w ? info(w) : null },
  isOurs: (chain, address) => !!ks.get(address, chain),
  assertBackedUp: (pk, chain) => ks.assertBackedUp(pk, chain),
  secretOf: (pk, chain) => ks.signerSecret(pk, chain),
  /** A pool move's relay: a fresh wallet whose key is downloaded at once (its own backup file), THEN paid. */
  createRelay: (chain, label) => {
    const [relay] = createWallets(1, chain, "relay", label)
    const file = ks.backupOne(relay.publicKey, chain, "relay-backup")
    return { ...relay, file, path: file }
  },
  relayKept: { sentence: "The relay wallet's key stays in this browser and in its backup download.", aside: "(its key is in this browser and in its backup download)" },
}

const env = (): Env => ({ api: api(), wallets: walletStore, settings: settings() })

// ── the activity ledger (local mode: transfers.json) ────────────────────────

const readLedger = () => load<TransferRecord[]>(`${P}.transfers`, [])
const ledger: Ledger = {
  list: () => readLedger().sort((a, b) => b.createdAt - a.createdAt),
  upsert: (r) => { try { save(`${P}.transfers`, upsertInto(readLedger(), r)) } catch { /* the ledger is a convenience; the API keeps every order */ } },
}

// ── move jobs: run in this tab, mirrored to localStorage so a reload still shows them ────────────────────────────

const jobs = new Map<string, Job>()
const storedJobs = () => load<PublicJob[]>(`${P}.jobs`, [])
function saveJob(job: Job): void {
  const pub = publicJob(job)
  try { save(`${P}.jobs`, [pub, ...storedJobs().filter((j) => j.id !== job.id)].slice(0, 20)) } catch { /* a convenience: the ledger has the legs */ }
}
const locks = () => (typeof navigator !== "undefined" && "locks" in navigator ? navigator.locks : null)
const moveLock = (id: string) => `${P}.move.${id}`
async function heldMoves(): Promise<Set<string>> {
  const l = locks()
  return l ? new Set(((await l.query()).held ?? []).map((x) => x.name ?? "")) : new Set()
}

/** Run a job in this tab, holding a lock so another tab (or a reload) can tell it is still running. */
function runInTab(job: Job, plan: Parameters<typeof runJob>[2]): void {
  const go = () => runJob({ ...env(), ledger, changed: saveJob }, job, plan)
  const l = locks()
  if (l) void l.request(moveLock(job.id), go)
  else void go()
}

/** A job still "running" whose tab is gone (no lock held) was interrupted: say so on the stored job. */
async function recoverJobs(): Promise<void> {
  if (!locks()) return
  const held = await heldMoves()
  const all = storedJobs()
  let touched = false
  for (const j of all) {
    if ((j.status !== "preflight" && j.status !== "running") || held.has(moveLock(j.id)) || jobs.has(j.id)) continue
    j.status = "failed"
    j.message = "Interrupted: the tab running this move was closed. Legs already sent stay sent; check the balances and the Activity page before trying again."
    j.log.push({ t: Date.now(), msg: j.message })
    touched = true
  }
  if (touched) try { save(`${P}.jobs`, all) } catch { /* convenience */ }
}

// ── routes ──────────────────────────────────────────────────────────────────

const ok = (data: unknown, status = 200) => Response.json(data, { status })
const fail = (err: unknown, status?: number) => { const r = errorBody(err, status); return Response.json(r.body, { status: r.status }) }
const bad = (message: string) => fail(new Error(message), 400)
async function body<T extends Record<string, unknown>>(req: Request): Promise<Partial<T>> {
  try { return (await req.json()) as Partial<T> } catch { return {} }
}
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "")
const selection = (v: unknown) => (Array.isArray(v) ? v : []).filter((w): w is { chain: ChainId; publicKey: string } => isChainId(w?.chain) && typeof w.publicKey === "string")

type Handler = (req: Request, params: string[]) => Promise<Response> | Response
/** [method, path pattern, handler, default status of a failure] — the same table as app/api/**. */
const routes: Array<[string, RegExp, Handler, number?]> = []
const route = (method: string, pattern: RegExp, h: Handler, failStatus?: number) => routes.push([method, pattern, h, failStatus])

// wallets
route("GET", /^\/api\/wallets$/, (req) => {
  const chain = new URL(req.url).searchParams.get("chain")
  const all = ks.list()
  return ok({ dir: KEYS_HOME, wallets: all.filter((w) => !isChainId(chain) || w.chain === chain).map(info), missing: [], mainWallet: ks.main(), archived: ks.archivedKeys(), pending: ks.pending().map((w) => ({ publicKey: w.publicKey, chain: w.chain, label: w.label })) })
})
route("POST", /^\/api\/wallets$/, async (req) => {
  const b = await body<{ count: number; chain: string; role: string; label: string }>(req)
  if (!isChainId(b.chain)) return bad("chain must be sol, rh, eth or bnb")
  const wallets = createWallets(Number(b.count) || 1, b.chain, isRole(b.role) ? b.role : "trader", str(b.label) || undefined)
  let starred: string | null = null
  if (!ks.main()[b.chain] && wallets[0]) { ks.setMain(b.chain, wallets[0].publicKey); starred = wallets[0].publicKey }
  return ok({ dir: `${KEYS_HOME}: press Download backup before funding`, wallets, starred })
})
route("POST", /^\/api\/wallets\/import$/, async (req) => {
  const b = await body<{ secret: string; chain: string; role: string; label: string }>(req)
  if (!isChainId(b.chain)) return bad("chain must be sol, rh, eth or bnb")
  if (!str(b.secret)) return bad("secret is required")
  const k = parseSecret(b.chain, str(b.secret))
  const { wallet, existed } = ks.add({ ...k, chain: b.chain, role: isRole(b.role) ? b.role : "trader", label: str(b.label) || "imported", createdAt: new Date().toISOString(), app: APP_NAME })
  return ok({ dir: KEYS_HOME, wallet: { ...info(wallet), path: KEYS_HOME, existed } })
}, 400)
/** Starring moves no money: any stored wallet can be ★ (every move still checks the backup rule). */
route("POST", /^\/api\/wallets\/main$/, async (req) => {
  const b = await body<{ chain: string; publicKey: string }>(req)
  if (!isChainId(b.chain) || !str(b.publicKey)) return bad("chain and publicKey are required")
  return ok({ mainWallet: ks.setMain(b.chain, str(b.publicKey)) })
})
route("POST", /^\/api\/wallets\/rename$/, async (req) => {
  const b = await body<{ chain: string; publicKey: string; label: string; role: string }>(req)
  if (!isChainId(b.chain) || !str(b.publicKey)) return bad("chain and publicKey are required")
  const label = str(b.label) || undefined
  const role = isRole(b.role) ? b.role : undefined
  if (!label && !role) return bad("nothing to change")
  return ok({ wallet: info(ks.update(str(b.publicKey), b.chain, { label, role })) })
})
route("POST", /^\/api\/wallets\/key$/, async (req) => {
  const b = await body<{ chain: string; publicKey: string }>(req)
  if (!isChainId(b.chain) || !str(b.publicKey)) return bad("chain and publicKey are required")
  return ok({ publicKey: str(b.publicKey), chain: b.chain, privateKey: ks.secret(str(b.publicKey), b.chain) })
})
route("POST", /^\/api\/wallets\/archive$/, async (req) => {
  const b = await body<{ wallets: unknown; archived: boolean }>(req)
  const items = selection(b.wallets).map((w) => ({ chain: w.chain, address: w.publicKey }))
  if (!items.length) return bad("wallets is required")
  return ok({ archived: ks.setArchived(items, b.archived !== false) })
})
route("POST", /^\/api\/wallets\/export$/, async (req) => {
  const csv = ks.exportCsv(selection((await body<{ wallets: unknown }>(req)).wallets))
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="wallets-export-${new Date().toISOString().slice(0, 10)}.csv"` } })
})
/** Demo only: `Download backup` (the not-yet-backed-up wallets) and `Export all keys` (every wallet), one file each. */
route("POST", /^\/api\/wallets\/backup$/, () => ok(ks.downloadBackup()))
route("POST", /^\/api\/wallets\/export-all$/, () => ok(ks.exportAll()))
/** Local mode's "Rewrite backups", in the browser: the same download as `Download backup`. */
route("POST", /^\/api\/wallets\/rewrite-backups$/, () => { const r = ks.downloadBackup(); return ok({ dir: KEYS_HOME, files: ks.list().length, restored: [], csvAdded: r.count, downloaded: r.files }) })
route("POST", /^\/api\/wallets\/balances$/, async (req) => {
  const b = await body<{ wallets: unknown }>(req)
  const items = (Array.isArray(b.wallets) ? b.wallets : []).filter((w): w is { chain: ChainId; address: string } => isChainId(w?.chain) && typeof w.address === "string")
  const map = await balancesFor(api(), items)
  return ok({ balances: items.map((i) => ({ ...i, balance: map.get(idOf(i.chain, i.address)) ?? null })) })
})

// settings + status (local mode: GET / PATCH /api/settings)
async function settingsView() {
  const key = await ensureApiKey(KEY_OPTS)
  const s = settings()
  let connected = false
  let keyPrefix: string | undefined
  let error: { error: string; code?: string; hint?: string; docs?: string } | undefined
  if (key) {
    try { keyPrefix = (await api().me()).keyPrefix; connected = true }
    catch (e) { error = e instanceof ApiError ? { error: e.message, code: e.code, hint: e.hint, docs: e.docs } : { error: e instanceof Error ? e.message : String(e) } }
  }
  return {
    apiUrl: DEMO_API_URL, apiKeySet: !!key, apiKeyFrom: "browser", connected, keyPrefix: keyPrefix ?? (key ? maskKey(key) : undefined), error, backupDir: KEYS_HOME, wallets: ks.list().length,
    gasReserveSol: s.gasReserveSol, gasReserveEth: s.gasReserveEth, route: s.route, mode: s.mode, venue: s.venue,
    demo: true, pending: ks.pending().length, keyError: key ? null : keyError(),
  }
}
route("GET", /^\/api\/settings$/, async () => ok(await settingsView()))
route("PATCH", /^\/api\/settings$/, async (req) => {
  const b = await body<{ apiKey: string | null; createKey: boolean; gasReserveSol: number | null; gasReserveEth: number | null; route: string | null; mode: string | null; venue: string | null }>(req)
  if (b.createKey === true) await replaceApiKey(KEY_OPTS) // the API's refusal (rate_limited, …) is thrown verbatim
  if (b.apiKey !== undefined) setApiKey(KEY_OPTS, typeof b.apiKey === "string" ? b.apiKey : null)
  const cur = load<BrowserSettings>(`${P}.settings`, {})
  for (const k of NUM_KEYS) {
    if (b[k] === undefined) continue
    const v = b[k]
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) cur[k] = v
    else delete cur[k]
  }
  if (b.route !== undefined) { if (ROUTES.includes(b.route as RouteChoice)) cur.route = b.route as RouteChoice; else delete cur.route }
  if (b.mode !== undefined) { if (MODES.includes(b.mode as Mode)) cur.mode = b.mode as Mode; else delete cur.mode }
  if (b.venue !== undefined) { if (str(b.venue)) cur.venue = str(b.venue); else delete cur.venue }
  save(`${P}.settings`, cur)
  return ok(await settingsView())
})

// transfer routes + venues, straight from the API
route("GET", /^\/api\/transfer\/routes$/, async (req) => {
  const q = new URL(req.url).searchParams
  const from = q.get("from"), to = q.get("to"), amount = Number(q.get("amount"))
  if (!isChainId(from) || !isChainId(to)) return bad("from and to must be sol, rh, eth or bnb")
  if (!(amount > 0)) return bad("amount must be greater than zero")
  return ok(await api().transfer.routes(from, to, amount))
})
route("GET", /^\/api\/transfer\/venues$/, async () => ok(await api().transfer.venues()))

// the desk
route("POST", /^\/api\/move\/plan$/, async (req) => ok(await planFromBody(env(), await body<MoveBody>(req))), 400)
route("POST", /^\/api\/move\/preview$/, async (req) => { const e = env(); return ok(await previewPlan(e, await planFromBody(e, await body<MoveBody>(req)))) }, 400)
route("GET", /^\/api\/move\/run$/, () => {
  const live = [...jobs.values()].map(publicJob)
  return ok({ jobs: [...live, ...storedJobs().filter((j) => !jobs.has(j.id))].sort((a, b) => b.createdAt - a.createdAt) })
})
route("POST", /^\/api\/move\/run$/, async (req) => {
  const held = await heldMoves()
  if ([...jobs.values()].some(isRunning) || storedJobs().some((j) => held.has(moveLock(j.id)))) return fail(coded("a move is already running; wait for it to finish", "busy"), 409)
  const e = env()
  const plan = await planFromBody(e, await body<MoveBody>(req))
  preflightBackups(e.wallets, plan)             // 409 not_backed_up: a wallet of ours whose key has not been downloaded
  const relay = prepareRelay(e.wallets, plan)   // pool moves: a fresh relay wallet, its key downloaded before anything pays it
  if (relay) preflightBackups(e.wallets, plan)
  const job = newJob(plan, relay)
  jobs.set(job.id, job)
  saveJob(job)
  runInTab(job, plan)
  return ok({ job: publicJob(job) }, 202)
}, 400)
route("GET", /^\/api\/move\/run\/([^/]+)$/, (_req, [id]) => {
  const job = jobs.get(decodeURIComponent(id))
  if (job) return ok({ job: publicJob(job) })
  const stored = storedJobs().find((j) => j.id === decodeURIComponent(id))
  return stored ? ok({ job: stored }) : fail(coded("no such job (moves live in the tab that ran them; the Activity page has the ledger)", "not_found"), 404)
})

// activity (local mode: transfers.json merged with GET /api/transfer)
route("GET", /^\/api\/activity$/, async (req) => ok(await activity(api(), ledger, new URL(req.url).searchParams.get("refresh") === "1")))

/** One request → the route's Response (404 for an unknown path, the API's error shape for every failure). */
export async function handle(req: Request): Promise<Response> {
  const path = new URL(req.url).pathname
  for (const [method, pattern, h, failStatus] of routes) {
    if (method !== req.method) continue
    const m = pattern.exec(path)
    if (!m) continue
    try {
      return await h(req, m.slice(1))
    } catch (e) {
      return fail(e, failStatus)
    }
  }
  return fail(coded(`No route ${req.method} ${path} in the browser engine`, "not_found"), 404)
}

// ── start-up: the visitor's key, interrupted moves ──────────────────────────

if (typeof window !== "undefined") {
  void ensureApiKey(KEY_OPTS)
  void recoverJobs().catch(() => {})
}

