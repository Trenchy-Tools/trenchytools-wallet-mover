"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

/** A right-hand slide-over (the docs site's sheet without radix). Closes on Escape and on the overlay. */
export function Sheet({ open, onClose, title, description, children, className }: { open: boolean; onClose: () => void; title: React.ReactNode; description?: React.ReactNode; children: React.ReactNode; className?: string }) {
  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])
  if (!open || typeof document === "undefined") return null
  // a portal onto <body>: the top bar's backdrop blur would otherwise trap this fixed panel inside the bar's box
  return createPortal(
    <div className="fixed inset-0 z-50">
      <button aria-label="Close" className="absolute inset-0 bg-black/50" onClick={onClose} />
      <aside role="dialog" aria-modal className={cn("bg-background absolute inset-y-0 right-0 flex w-full max-w-sm flex-col border-l shadow-lg", className)}>
        <header className="flex items-start justify-between gap-3 border-b p-4">
          <div>
            <h2 className="font-semibold">{title}</h2>
            {description && <p className="text-muted-foreground mt-0.5 text-sm">{description}</p>}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground rounded p-1" aria-label="Close">
            <X className="size-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </aside>
    </div>,
    document.body,
  )
}
