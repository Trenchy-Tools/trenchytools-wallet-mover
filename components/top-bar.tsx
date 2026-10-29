"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Settings2 } from "lucide-react"
import { Logo } from "./logo"
import { MoreMenu } from "./more-menu"
import { useStatus } from "./providers"
import { SettingsSheet } from "./settings-sheet"
import { ThemeToggle } from "./theme-toggle"
import { cn } from "@/lib/utils"

const NAV = [
  { href: "/wallets", label: "Wallets" },
  { href: "/move", label: "Move" },
  { href: "/activity", label: "Activity" },
]
const LIVE = "https://mover.trenchy.tools"
const REPO = "https://github.com/Trenchy-Tools/trenchytools-wallet-mover"

/**
 * Seven targets: wordmark · Wallets · Move · Activity · one status dot (opens Settings) · Get an API key · ⋯ menu
 * (docs, examples, GitHub, theme, Settings). Everything about keys, wallets and folders lives behind the dot.
 */
export function TopBar() {
  const path = usePathname()
  const { status, error } = useStatus()
  const [open, setOpen] = React.useState(false)
  const pending = status?.pending ?? 0
  const tone = !status && !error ? "bg-muted-foreground" : error || (status?.apiKeySet && !status.connected) ? "bg-destructive" : status?.connected && status.wallets > 0 && !pending ? "bg-ok" : "bg-warn"
  const text = !status && !error ? "checking…" : error ? "app server unreachable" : status?.apiKeySet && !status.connected ? "API key rejected" : !status?.connected ? "no API key yet" : status.wallets === 0 ? "key ok · no wallets yet" : pending ? `${pending} wallet${pending === 1 ? "" : "s"} not backed up` : `key ok · ${status.wallets} wallet${status.wallets === 1 ? "" : "s"}`
  return (
    <header className="bg-background/80 sticky top-0 z-40 border-b backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-6 px-4 sm:px-6">
        <Link href="/wallets" aria-label="wallet mover home" className="flex text-[17px]"><Logo /></Link>
        <nav className="flex items-center gap-1 text-sm">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={cn("rounded-md px-2.5 py-1.5 transition-colors", path.startsWith(n.href) ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}>{n.label}</Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => setOpen(true)} className="text-muted-foreground hover:text-foreground inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs transition-colors" title={`${text}. Click for Settings.`}>
            <span className={cn("size-2 rounded-full", tone)} />
            <span className="hidden sm:inline">{text}</span>
          </button>
          <a href="https://trenchy.tools/docs/api-keys" target="_blank" rel="noreferrer" className="bg-foreground text-background inline-flex h-8 items-center rounded-md px-3 text-sm font-medium whitespace-nowrap transition-opacity hover:opacity-90">Get an API key</a>
          <MoreMenu current={LIVE} repo={REPO}>
            <div className="flex items-center justify-between px-2.5 py-1.5 text-sm"><span>Theme</span><ThemeToggle /></div>
            <button type="button" className="hover:bg-accent flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm" onClick={() => setOpen(true)}><Settings2 className="size-4" /> Settings</button>
          </MoreMenu>
        </div>
      </div>
      <SettingsSheet open={open} onClose={() => setOpen(false)} />
    </header>
  )
}
