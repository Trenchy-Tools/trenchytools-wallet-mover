"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Settings2 } from "lucide-react"
import { Logo } from "./logo"
import { useStatus } from "./providers"
import { SettingsSheet } from "./settings-sheet"
import { ThemeToggle } from "./theme-toggle"
import { Button } from "./ui/button"
import { Badge } from "./ui/card"
import { cn } from "@/lib/utils"

const NAV = [
  { href: "/wallets", label: "Wallets" },
  { href: "/move", label: "Move" },
  { href: "/activity", label: "Activity" },
]

/** logo · Wallets · Move · Activity · (right) API key pill · wallets pill · theme · Settings */
export function TopBar() {
  const path = usePathname()
  const { status } = useStatus()
  const [open, setOpen] = React.useState(false)
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
          <button onClick={() => setOpen(true)} className="hidden sm:block" title="API key">
            <Badge tone={status ? (status.connected ? "ok" : status.apiKeySet ? "bad" : "warn") : "muted"}>{status ? (status.connected ? `API key · ${status.keyPrefix ?? "connected"}` : status.apiKeySet ? "API key · not accepted" : "API key · missing") : "API key · …"}</Badge>
          </button>
          <Link href="/wallets" className="hidden sm:block"><Badge>{status ? `${status.wallets} wallets` : "wallets · …"}</Badge></Link>
          <ThemeToggle className="hidden sm:flex" />
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}><Settings2 /> Settings</Button>
        </div>
      </div>
      <SettingsSheet open={open} onClose={() => setOpen(false)} />
    </header>
  )
}
