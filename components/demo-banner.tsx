"use client"

import { useEffect, useState } from "react"
import { DEMO, REPO_URL, startEngine } from "@/lib/browser/demo"
import { api, errorText } from "@/lib/client"
import { useStatus } from "./providers"

/**
 * Demo mode only: the one quiet line under the top bar. Where the keys live, that nothing is sent until a wallet is
 * funded, the backup download, the repo. It also starts the browser engine as soon as any page opens.
 */
export function DemoBanner() {
  const [downloading, setDownloading] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const { refresh } = useStatus()
  useEffect(() => { startEngine() }, [])
  if (!DEMO) return null
  const downloadBackup = async () => {
    setDownloading(true); setNote(null)
    try {
      const r = await api<{ count: number; files: string[] }>("/api/wallets/backup", { method: "POST" })
      setNote(r.count ? `backup downloaded, ${r.count} wallet${r.count === 1 ? "" : "s"} now usable` : "every wallet is already backed up")
      await refresh()
    } catch (e) { setNote(errorText(e)) } finally { setDownloading(false) }
  }
  return (
    <div role="note" className="text-muted-foreground border-b px-4 py-1.5 text-center text-xs sm:px-6">
      Demo: wallets live in this browser, nothing is sent until you fund one.{" "}
      <button type="button" className="hover:text-foreground underline underline-offset-4" onClick={() => void downloadBackup()} disabled={downloading}>{downloading ? "Downloading…" : "Download backup"}</button>
      {" · "}
      <a className="hover:text-foreground underline underline-offset-4" href={REPO_URL} target="_blank" rel="noreferrer">Clone it</a> to run locally.
      {note ? <span> · {note}</span> : null}
    </div>
  )
}
