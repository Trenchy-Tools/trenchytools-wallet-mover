/**
 * Route-handler helpers. Every error leaves the server in the same shape the API uses: { error, code?, hint?, docs? }.
 * An ApiError from lib/trenchy.ts is passed through with its status; a NotBackedUpError is 409 not_backed_up (the
 * shape itself is lib/core/errors.ts, shared with the browser engine of demo mode).
 *
 * Demo mode (DEMO_MODE=1, the hosted app): `demoGuard` answers every app/api/* route with 404 demo_mode before the
 * handler runs, so the hosted container never touches a wallet folder. It is applied once, to every route, by
 * proxy.ts at the project root.
 */
import { DEMO_MODE_BODY, errorBody } from "./core/errors"

export const ok = (data: unknown, status = 200) => Response.json(data, { status })

export function fail(err: unknown, status?: number): Response {
  const r = errorBody(err, status)
  return Response.json(r.body, { status: r.status })
}

/** True when this server runs as the hosted demo (DEMO_MODE=1): it keeps no state and serves no wallet route. */
export const isDemoServer = () => process.env.DEMO_MODE === "1"

/** The demo-mode answer for an app/api/* route (404 demo_mode), or null in local mode. */
export function demoGuard(): Response | null {
  return isDemoServer() ? Response.json(DEMO_MODE_BODY, { status: 404 }) : null
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
