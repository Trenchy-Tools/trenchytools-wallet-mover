/**
 * The errors every flow can throw, and the one JSON shape they leave the app in. Shared by the server routes
 * (lib/http.ts, local mode) and the browser engine (lib/browser/engine.ts, demo mode). No node imports.
 *
 *   ApiError          the TrenchyTools API refused: { error, code, hint?, docs? }, status as sent
 *   NotBackedUpError  the backup rule: a wallet whose key is not backed up is never paid or used (409 not_backed_up)
 */
import type { ChainId } from "../chains"

/** Every API error body is `{ error, code, hint?, docs? }`. All of it rides along here; show it verbatim, branch on `code`. */
export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public hint?: string, public docs?: string) {
    super(message)
    this.name = "ApiError"
  }
  toJSON() {
    return { error: this.message, code: this.code, hint: this.hint, docs: this.docs, status: this.status }
  }
}

/**
 * The backup rule's refusal. Local mode says which folder is missing the file (lib/wallets.ts); demo mode says the key
 * has not been downloaded yet (lib/browser/keystore.ts). Same code, same status, everywhere.
 */
export class NotBackedUpError extends Error {
  code = "not_backed_up" as const
  constructor(public publicKey: string, public chain: ChainId, message: string, public hint: string, public dir?: string) {
    super(message)
    this.name = "NotBackedUpError"
  }
}

/** Any thrown value → the status and JSON body a route answers with: `{ error, code?, hint?, docs?, … }`. */
export function errorBody(err: unknown, status?: number): { status: number; body: Record<string, unknown> } {
  if (err instanceof NotBackedUpError) return { status: 409, body: { error: err.message, code: err.code, hint: err.hint, publicKey: err.publicKey, chain: err.chain, ...(err.dir ? { dir: err.dir } : {}) } }
  if (err instanceof ApiError) return { status: err.status >= 400 && err.status < 600 ? err.status : 502, body: { error: err.message, code: err.code, hint: err.hint, docs: err.docs } }
  const message = err instanceof Error ? err.message : err && typeof err === "object" && "error" in err ? String((err as { error: unknown }).error) : String(err)
  const code = (err as { code?: string })?.code
  return { status: status ?? 500, body: { error: message, ...(typeof code === "string" ? { code } : {}) } }
}

/** A refusal with a code and its own status (busy, not_found, …). */
export const coded = (message: string, code: string) => Object.assign(new Error(message), { code })

/** The answer of a route that does not exist in this mode (demo mode: every server route; see lib/http.ts demoGuard). */
export const DEMO_MODE_BODY = {
  error: "This hosted demo keeps no server state: wallets, moves and the activity ledger live in your browser.",
  code: "demo_mode",
  hint: "Use the pages of this app (they call the TrenchyTools API straight from the browser), or clone the repo to run it on your own machine: https://github.com/Trenchy-Tools/trenchytools-wallet-mover",
}
