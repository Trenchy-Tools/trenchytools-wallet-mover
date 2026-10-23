import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))

/** An amount for the tables: up to 6 decimals, trailing zeros dropped, "—" when unknown. */
export const fmt = (n: number | null | undefined, max = 6): string => (n === null || n === undefined || !Number.isFinite(n) ? "—" : String(Math.round(n * 10 ** max) / 10 ** max))

export const ago = (t: number): string => {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000))
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : new Date(t).toLocaleDateString()
}
