"use client"

import { FolderOpen } from "lucide-react"
import { useStatus } from "./providers"

/** The strip under the top bar: the backup folder path is always visible, with the API state next to it. */
export function StatusStrip() {
  const { status, error } = useStatus()
  return (
    <div className="bg-muted/40 border-b">
      <div className="text-muted-foreground mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-5 gap-y-1 px-4 py-1.5 text-xs sm:px-6">
        <span className="inline-flex items-center gap-1.5">
          <FolderOpen className="size-3.5" />
          <span>backups</span>
          <code className="text-foreground break-all">{status?.backupDir ?? "…"}</code>
        </span>
        <span>API <code className="text-foreground">{status?.apiUrl ?? "…"}</code></span>
        <span>{status ? (status.connected ? <span className="text-emerald-600 dark:text-emerald-400">connected</span> : status.apiKeySet ? <span className="text-red-600 dark:text-red-400">key rejected: {status.error?.error}</span> : <span className="text-amber-600 dark:text-amber-400">no API key: open Settings</span>) : error ? <span className="text-red-600 dark:text-red-400">app server unreachable</span> : "checking…"}</span>
        <span className="ml-auto hidden sm:inline">gas reserves {status ? `${status.gasReserveSol} SOL · ${status.gasReserveEth} ETH` : "…"}</span>
      </div>
    </div>
  )
}
