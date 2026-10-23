/**
 * The chains this app knows, exactly as the API's /api/transfer knows them. Safe to import from the browser.
 *
 *   id    kind  key              source  destination  balances
 *   sol   sol   base58 keypair   yes     yes          GET /api/sol/balances?wallets=
 *   rh    evm   0x key (4663)    yes     yes          GET /api/rh/balances?wallets=
 *   eth   evm   0x key (1)       no      yes          not available through the API: shown as "—"
 *   bnb   evm   0x key (56)      no      yes          not available: "—"
 *
 * An EVM key works on every EVM chain; a wallet file still carries ONE chain (the one it was created for).
 */
export type ChainId = "sol" | "rh" | "eth" | "bnb"
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
  explorerTx: string
  explorerAddress: string
}

export const CHAINS: Record<ChainId, Chain> = {
  sol: { id: "sol", name: "Solana", mark: "SOL", kind: "sol", native: "SOL", source: true, balances: true, gasReserve: 0.001, explorerTx: "https://solscan.io/tx/", explorerAddress: "https://solscan.io/account/" },
  rh: { id: "rh", name: "Robinhood", mark: "RH", kind: "evm", chainId: 4663, native: "ETH", source: true, balances: true, gasReserve: 0.00005, explorerTx: "https://explorer.robinhood.com/tx/", explorerAddress: "https://explorer.robinhood.com/address/" },
  eth: { id: "eth", name: "Ethereum", mark: "ETH", kind: "evm", chainId: 1, native: "ETH", source: false, balances: false, gasReserve: 0.00005, explorerTx: "https://etherscan.io/tx/", explorerAddress: "https://etherscan.io/address/" },
  bnb: { id: "bnb", name: "BNB", mark: "BNB", kind: "evm", chainId: 56, native: "BNB", source: false, balances: false, gasReserve: 0.00005, explorerTx: "https://bscscan.com/tx/", explorerAddress: "https://bscscan.com/address/" },
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
  /^0x[0-9a-fA-F]{40}$/.test(address) ? ["rh", "eth", "bnb"] : /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) ? ["sol"] : []

export const shortAddress = (a: string, n = 4) => (a.length > 2 * n + 2 ? `${a.slice(0, n + (a.startsWith("0x") ? 2 : 0))}…${a.slice(-n)}` : a)
