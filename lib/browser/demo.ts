"use client"

/**
 * Demo mode: the mode flag, this app's constants, and THE SEAM between the pages and whatever answers them.
 *
 *   local mode (default)        appFetch("/api/…") is fetch("/api/…"): the app's own route handlers on this machine
 *   demo mode (NEXT_PUBLIC_DEMO=1, build time)
 *                               appFetch("/api/…") is answered in the browser by lib/browser/engine.ts, which has the
 *                               same routes with the same request and response shapes, keeps the wallets in
 *                               localStorage and calls https://api.trenchy.tools straight from the tab
 *
 * The pages never know which one answered: lib/client.ts (the fetch wrapper) calls appFetch. The engine is a separate
 * chunk, loaded only in demo mode; a local build never ships it. (This app has no server-sent-event routes, so the
 * pump.fun starter's appEvents half of the seam is not needed here.)
 */

// ── this app ────────────────────────────────────────────────────────────────

/** Built with NEXT_PUBLIC_DEMO=1: the hosted demo. Inlined at build time, so the unused branch is dropped. */
export const DEMO = process.env.NEXT_PUBLIC_DEMO === "1"
/** Where visitors clone the app to run it on their own machine. */
export const REPO_URL = "https://github.com/Trenchy-Tools/trenchytools-wallet-mover"
/** The API the demo talks to, straight from the browser (the CSP in next.config.ts allows exactly this host). */
export const DEMO_API_URL = "https://api.trenchy.tools"
/** The label of the per-visitor key: GET /api/create-api-key?label=demo-mover */
export const DEMO_KEY_LABEL = "demo-mover"
/** localStorage namespace: every key this app writes starts with it. */
export const STORE_PREFIX = "trenchytools.wallet-mover"
/** What the status strip says instead of the folder path. */
export const KEYS_HOME = "this browser"

export const BANNER = "Demo mode: your wallets live in this browser only. Download your backup before funding anything. Clearing site data deletes them. We never see your keys."
export const TAB_NOTE = "Keep this tab open while a move runs: it signs, sends and follows every leg from here."

// ── the seam ────────────────────────────────────────────────────────────────

type Engine = { handle: (req: Request) => Promise<Response> }
let engine: Promise<Engine> | null = null
const loadEngine = () => (engine ??= import("./engine") as Promise<Engine>)

/** fetch() for the app's own /api/* routes: the server in local mode, the browser engine in demo mode. */
export async function appFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!DEMO) return fetch(path, init)
  const { handle } = await loadEngine()
  return handle(new Request(new URL(path, window.location.origin), init))
}

/** Warm the engine early (demo mode): the visitor's key is created and interrupted moves are marked as soon as a page opens. */
export function startEngine(): void {
  if (DEMO) void loadEngine()
}
