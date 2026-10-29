import type { Metadata } from "next"
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google"
import { DemoBanner } from "@/components/demo-banner"
import { Providers } from "@/components/providers"
import { TopBar } from "@/components/top-bar"
import "./globals.css"

// Fonts as on the docs site: Space Grotesk for text, IBM Plex Mono for addresses, amounts and code.
const sans = Space_Grotesk({ subsets: ["latin"], variable: "--font-sans" })
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-mono" })

export const metadata: Metadata = {
  title: { default: "wallet mover · TrenchyTools", template: "%s · wallet mover" },
  description: process.env.NEXT_PUBLIC_DEMO === "1" ? "Move money between many wallets and chains on the TrenchyTools API, from your browser." : "Move money between many wallets and chains on the TrenchyTools API.",
  icons: { icon: "/icon.svg" },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable}`}>
      <body className="bg-background text-foreground min-h-dvh font-sans antialiased">
        <Providers>
          <TopBar />
          <DemoBanner />
          <main className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6">{children}</main>
        </Providers>
      </body>
    </html>
  )
}
