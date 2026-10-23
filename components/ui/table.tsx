import * as React from "react"
import { cn } from "@/lib/utils"

export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full text-sm", className)} {...props} />
    </div>
  )
}
export const THead = ({ className, ...p }: React.ComponentProps<"thead">) => <thead className={cn("text-muted-foreground text-left text-xs [&_th]:h-9 [&_th]:px-3 [&_th]:font-medium", className)} {...p} />
export const TBody = ({ className, ...p }: React.ComponentProps<"tbody">) => <tbody className={cn("[&_td]:px-3 [&_td]:py-2 [&_tr]:border-t", className)} {...p} />
export const Mono = ({ className, ...p }: React.ComponentProps<"span">) => <span className={cn("font-mono text-[12.5px]", className)} {...p} />
export const Empty = ({ children }: { children: React.ReactNode }) => <p className="text-muted-foreground px-4 py-8 text-center text-sm">{children}</p>
