import { isClientError } from "@/lib/client"

/** Every API error exactly as returned: message · code · hint · docs link. */
export function ApiErrorBox({ error, className = "" }: { error: unknown; className?: string }) {
  if (!error) return null
  const e = isClientError(error) ? error : { error: error instanceof Error ? error.message : String(error), status: 0 }
  return (
    <div role="alert" className={`rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm ${className}`}>
      <p className="text-red-700 dark:text-red-300">{e.error}</p>
      <p className="text-muted-foreground mt-1 flex flex-wrap gap-x-3 text-xs">
        {e.code && <span className="font-mono">{e.code}</span>}
        {e.status ? <span>HTTP {e.status}</span> : null}
        {e.hint && <span>{e.hint}</span>}
        {e.dir && <span className="font-mono break-all">{e.dir}</span>}
        {e.docs && <a href={e.docs} target="_blank" rel="noreferrer" className="underline underline-offset-2">docs</a>}
      </p>
    </div>
  )
}
