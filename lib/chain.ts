/**
 * What the shared shell (demos/_shared: header, suite switcher, Settings, toasts) needs to know about this app. The
 * launchers keep their chain here; the mover is a tool across chains, so this only names it, its pages and its fee.
 * The chains the mover moves between are lib/chains.ts.
 */
export const chain = {
  suiteId: "mover",
  appName: "Wallet mover",
  /** the short name (the header on a phone) */
  launchpad: "Mover",
  launchpadLogo: "/logos/tools/mover.svg",
  logo: "/logos/tools/mover.svg",
  /** the header's status line shows the main Solana wallet */
  symbol: "SOL",
  decimals: 4,
  /** transfers pay no API fee; an exchange hop costs the exchange's spread (shown in every quote) */
  apiFeeRate: 0,
  tipName: null as string | null,
  nav: [
    { href: "/move", label: "Move" },
    { href: "/wallets", label: "Wallets" },
    { href: "/history", label: "History" },
  ],
  description: "Move SOL and ETH between your wallets and across chains (Solana, Robinhood, Ethereum, BNB) on the TrenchyTools API",
  feeText: "No API fee on transfers. A move between two chains goes through an exchange, which keeps a small spread: the quote shows what arrives before you press Move.",
  fmt: (n: number) => n.toFixed(4),
}
