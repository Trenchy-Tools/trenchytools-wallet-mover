"use client"

import * as React from "react"
import { FolderOpen, KeyRound } from "lucide-react"
import { useStatus } from "./providers"
import { DEMO, KEYS_HOME } from "@/lib/browser/demo"
import { api, errorText } from "@/lib/client"

/**
 * The strip under the top bar: the backup folder path is always visible, with the API state next to it. Demo mode:
 * "Keys: this browser · Download backup" instead of the folder (the download is what makes a new wallet usable).
 */
export function StatusStrip() {
  const { status, error, refresh } = useStatus()
  const [downloading, setDownloading] = React.useState(false)
  const [note, setNote] = React.useState<string | null>(null)
  const pending = status?.pending ?? 0
  const downloadBackup = async () => {
    setDownloading(true); setNote(null)
    try {
      const r = await api<{ count: number; files: string[] }>("/api/wallets/backup", { method: "POST" })
      setNote(r.count ? `Backup downloaded: ${r.count} wallet${r.count === 1 ? "" : "s"}, now usable (${r.files.join(", ")})` : "Every wallet is already backed up")
      await refresh()
    } catch (e) { setNote(errorText(e)) } finally { setDownloading(false) }
  }
  React.useEffect(() => {
    if (!DEMO) return
    const on = () => void refresh()
    window.addEventListener("wallets-changed", on)
    return () => window.removeEventListener("wallets-changed", on)
  }, [refresh])
  return (
    <div className="bg-muted/40 border-b">
      <div className="text-muted-foreground mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-5 gap-y-1 px-4 py-1.5 text-xs sm:px-6">
        {DEMO ? (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <KeyRound className="size-3.5" />
            <span>Keys: <span className="text-foreground">{KEYS_HOME}</span></span>
            <span>·</span>
            <button className="text-foreground underline underline-offset-2" onClick={() => void downloadBackup()} disabled={downloading} title={pending ? `${pending} wallet${pending === 1 ? "" : "s"} not backed up yet: download the backup before funding` : "Every key is backed up. Clearing this site's data deletes the keys stored here."}>{downloading ? "Downloading…" : "Download backup"}</button>
            {pending > 0 && <span className="text-red-600 dark:text-red-400">({pending} not backed up)</span>}
            {note && <span>· {note}</span>}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <FolderOpen className="size-3.5" />
            <span>backups</span>
            <code className="text-foreground break-all">{status?.backupDir ?? "…"}</code>
          </span>
        )}
        <span>API <code className="text-foreground">{status?.apiUrl ?? "…"}</code></span>
        <span>{status ? (status.connected ? <span className="text-emerald-600 dark:text-emerald-400">connected</span> : status.apiKeySet ? <span className="text-red-600 dark:text-red-400">key rejected: {status.error?.error}</span> : DEMO && status.keyError ? <span className="text-red-600 dark:text-red-400">no API key: {status.keyError.code ?? status.keyError.error} (open Settings)</span> : <span className="text-amber-600 dark:text-amber-400">no API key: open Settings</span>) : error ? <span className="text-red-600 dark:text-red-400">app server unreachable</span> : "checking…"}</span>
        <span className="ml-auto hidden sm:inline">gas reserves {status ? `${status.gasReserveSol} SOL · ${status.gasReserveEth} ETH` : "…"}</span>
      </div>
    </div>
  )
}
