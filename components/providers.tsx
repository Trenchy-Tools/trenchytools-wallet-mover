"use client"

import * as React from "react"
import { ThemeProvider } from "next-themes"
import { api, type StatusView } from "@/lib/client"

type Status = { status: StatusView | null; error: unknown; refresh: () => Promise<void> }
const StatusCtx = React.createContext<Status>({ status: null, error: null, refresh: async () => {} })

/** Theme (dark-first) + the app status (GET /api/settings: Connected check, backup folder, wallet count), refreshed every 30 s. */
export function Providers({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = React.useState<StatusView | null>(null)
  const [error, setError] = React.useState<unknown>(null)
  const refresh = React.useCallback(async () => {
    try { setStatus(await api<StatusView>("/api/settings")); setError(null) } catch (e) { setError(e) }
  }, [])
  React.useEffect(() => {
    void refresh()
    const t = setInterval(refresh, 30_000)
    return () => clearInterval(t)
  }, [refresh])
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange enableColorScheme>
      <StatusCtx.Provider value={{ status, error, refresh }}>{children}</StatusCtx.Provider>
    </ThemeProvider>
  )
}

export const useStatus = () => React.useContext(StatusCtx)
