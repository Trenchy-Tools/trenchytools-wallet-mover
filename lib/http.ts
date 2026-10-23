/**
 * Route-handler helpers. Every error leaves the server in the same shape the API uses: { error, code?, hint?, docs? }.
 * An ApiError from lib/trenchy.ts is passed through with its status; a NotBackedUpError is 409 not_backed_up.
 */
import { BACKUP_DIR } from "./paths"
import { ApiError } from "./trenchy"
import { NotBackedUpError } from "./wallets"

export const ok = (data: unknown, status = 200) => Response.json(data, { status })

export function fail(err: unknown, status?: number): Response {
  if (err instanceof NotBackedUpError) return Response.json({ error: err.message, code: err.code, hint: err.hint, publicKey: err.publicKey, chain: err.chain, dir: BACKUP_DIR }, { status: 409 })
  if (err instanceof ApiError) return Response.json({ error: err.message, code: err.code, hint: err.hint, docs: err.docs }, { status: err.status >= 400 && err.status < 600 ? err.status : 502 })
  const message = err instanceof Error ? err.message : String(err)
  const code = (err as { code?: string })?.code
  return Response.json({ error: message, ...(typeof code === "string" ? { code } : {}) }, { status: status ?? 500 })
}

/** The JSON body of a request, {} when there is none. */
export async function body<T extends Record<string, unknown>>(req: Request): Promise<Partial<T>> {
  try {
    return (await req.json()) as Partial<T>
  } catch {
    return {}
  }
}

/** A number from a form field, or the default. */
export const num = (v: unknown, d: number): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? n : d
}

export const str = (v: unknown, d = ""): string => (typeof v === "string" ? v.trim() : d)
