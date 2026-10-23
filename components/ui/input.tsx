import * as React from "react"
import { cn } from "@/lib/utils"

const field = "border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-9 rounded-md border px-3 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input data-slot="input" className={cn(field, "w-full min-w-0 file:border-0 file:bg-transparent file:text-sm", props.type === "number" && "font-mono", className)} {...props} />
}

export function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <select data-slot="select" className={cn(field, "appearance-none bg-[length:12px] bg-[position:right_0.6rem_center] bg-no-repeat pr-8", "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%239a9aa2%22 stroke-width=%222%22><path d=%22m6 9 6 6 6-6%22/></svg>')]", className)} {...props}>
      {children}
    </select>
  )
}

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return <label className={cn("text-muted-foreground text-xs font-medium", className)} {...props} />
}

/** Label over a control. */
export function Field({ label, children, className }: { label: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <Label>{label}</Label>
      {children}
    </div>
  )
}
