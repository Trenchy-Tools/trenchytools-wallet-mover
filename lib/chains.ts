/**
 * The chains this app knows, exactly as the API's /api/transfer knows them. Safe to import from the browser.
 * Every chain can send and receive: directly on the same chain (one signed transfer through /api/<chain>/send), or
 * between two chains through an exchange (POST /api/transfer). Arc is direct only (the exchange does not list it).
 * One 0x key owns the same address on every EVM chain; a wallet file still names one chain (the one it was made for).
 */
export type ChainId = "sol" | "rh" | "eth" | "base" | "bnb" | "arc" | "elysium"
export type ChainKind = "sol" | "evm"

export type Chain = {
  id: ChainId
  name: string
  /** short name for the chain mark in tables */
  mark: string
  kind: ChainKind
  /** EVM chain id; absent on Solana */
  chainId?: number
  native: string
  /** can sign a deposit (the API builds deposit transactions from wallets here) */
  source: boolean
  /** balances readable through the API */
  balances: boolean
  /** kept in a wallet so the transaction fee is always payable (SOL / ETH-on-RH; eth/bnb are destination only) */
  gasReserve: number
  /** the chain's logo under public/logos/chains/ */
  logo: string
  explorerTx: string
  explorerAddress: string
}

export const CHAINS: Record<ChainId, Chain> = {
  sol: { id: "sol", name: "Solana", mark: "SOL", kind: "sol", native: "SOL", source: true, balances: true, gasReserve: 0.001, logo: "/logos/chains/solana.svg", explorerTx: "https://solscan.io/tx/", explorerAddress: "https://solscan.io/account/" },
  rh: { id: "rh", name: "Robinhood", mark: "RH", kind: "evm", chainId: 4663, native: "ETH", source: true, balances: true, gasReserve: 0.0001, logo: "/logos/chains/robinhood.svg", explorerTx: "https://explorer.robinhood.com/tx/", explorerAddress: "https://explorer.robinhood.com/address/" },
  eth: { id: "eth", name: "Ethereum", mark: "ETH", kind: "evm", chainId: 1, native: "ETH", source: true, balances: true, gasReserve: 0.0005, logo: "/logos/chains/ethereum.svg", explorerTx: "https://etherscan.io/tx/", explorerAddress: "https://etherscan.io/address/" },
  base: { id: "base", name: "Base", mark: "BASE", kind: "evm", chainId: 8453, native: "ETH", source: true, balances: true, gasReserve: 0.00005, logo: "/logos/chains/base.svg", explorerTx: "https://basescan.org/tx/", explorerAddress: "https://basescan.org/address/" },
  bnb: { id: "bnb", name: "BNB Chain", mark: "BNB", kind: "evm", chainId: 56, native: "BNB", source: true, balances: true, gasReserve: 0.0005, logo: "/logos/chains/bnb.svg", explorerTx: "https://bscscan.com/tx/", explorerAddress: "https://bscscan.com/address/" },
  arc: { id: "arc", name: "Arc", mark: "ARC", kind: "evm", chainId: 5042, native: "USDC", source: true, balances: true, gasReserve: 0.05, logo: "/logos/chains/arc.png", explorerTx: "https://arcscan.app/tx/", explorerAddress: "https://arcscan.app/address/" },
  elysium: { id: "elysium", name: "Elysium", mark: "ELY", kind: "evm", chainId: 99901, native: "HYPE", source: true, balances: true, gasReserve: 0.002, logo: "/logos/chains/elysium.svg", explorerTx: "https://elyscan.live/tx/", explorerAddress: "https://elyscan.live/address/" },
}

/** Route and mode names as /api/transfer takes them (here, not in lib/settings.ts, so the browser can import them). */
export const ROUTES = ["direct", "exchange"] as const
export const MODES = ["float", "fixed", "private"] as const
export type RouteChoice = (typeof ROUTES)[number]
export type Mode = (typeof MODES)[number]

/** Wallet roles: `trader` by default; the others are what the sibling launchers pick wallets up by. `relay` is the pool wallet of a many→many move. */
export const ROLES = ["trader", "funding", "bundle", "sniper", "holder", "dev", "relay"] as const
export type Role = (typeof ROLES)[number]
export const isRole = (v: unknown): v is Role => typeof v === "string" && (ROLES as readonly string[]).includes(v)

export const CHAIN_IDS = Object.keys(CHAINS) as ChainId[]
export const isChainId = (v: unknown): v is ChainId => typeof v === "string" && v in CHAINS
export const chainOf = (v: unknown): Chain => {
  if (!isChainId(v)) throw new Error(`unknown chain "${String(v)}" (${CHAIN_IDS.join(", ")})`)
  return CHAINS[v]
}

/** Address shape for a chain (the API validates again when a route is quoted). */
export function looksLikeAddress(chain: ChainId, address: string): boolean {
  return CHAINS[chain].kind === "sol" ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) : /^0x[0-9a-fA-F]{40}$/.test(address)
}

/** Which chain an address could belong to, by its shape ("sol" or the EVM chains). */
export const chainsForAddress = (address: string): ChainId[] =>
  /^0x[0-9a-fA-F]{40}$/.test(address) ? CHAIN_IDS.filter((x) => CHAINS[x].kind === "evm") : /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) ? ["sol"] : []

export const shortAddress = (a: string, n = 4) => (a.length > 2 * n + 2 ? `${a.slice(0, n + (a.startsWith("0x") ? 2 : 0))}…${a.slice(-n)}` : a)
