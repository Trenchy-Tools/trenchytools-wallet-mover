/**
 * EVM signing (Robinhood chain 4663; the same 0x key also owns the address on Ethereum and BNB), in the process that holds
 * the key (the server in local mode, the visitor's tab in demo mode). No node imports.
 *
 * There is no RPC here. Everything a signer needs — chain id, pending nonce, fee values — comes from
 * GET /api/rh/account?wallet=…; a plain transfer is {to, value, gas: 21000}; the signed raw bytes go to POST /api/rh/send.
 */
import { formatEther, getAddress, isAddress, parseEther, type Hex } from "viem"
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts"

export const TRANSFER_GAS = 21000n

/** What GET /api/rh/account answers. */
export type EvmAccountInfo = { wallet: string; chainId: number; nonce: number; pendingNonce: number; balanceEth: string; block: number; gasPrice: string; maxFeePerGas: string; maxPriorityFeePerGas: string; transferGas: string }
/** The `transaction.evm` block of an exchange leg from /api/transfer. */
export type EvmDeposit = { chainId: number; from: string; to: string; value: string; gas: string; data?: string; label?: string }

/** A fresh key as the wallet file stores it: checksummed address, 0x-prefixed 32-byte key. */
export function generateEvm(): { publicKey: string; privateKey: string } {
  const privateKey = generatePrivateKey()
  return { publicKey: privateKeyToAccount(privateKey).address, privateKey }
}

/** An account from a 0x (or bare) 64-hex key. Throws on anything else. */
export function accountFromKey(secret: string): PrivateKeyAccount {
  const s = secret.trim()
  const hex = s.startsWith("0x") ? s : `0x${s}`
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) throw new Error("Not a valid EVM private key (32 bytes, hex)")
  return privateKeyToAccount(hex as Hex)
}

export const isEvmAddress = (a: string) => isAddress(a)
export const sameEvmAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** ETH amount → wei, the way the API does it (parseEther(String(amount))) so a deposit's value compares equal. */
export function toWei(eth: number): bigint {
  const s = String(eth)
  return parseEther((/e/i.test(s) ? eth.toFixed(18).replace(/0+$/, "").replace(/\.$/, "") : s) as `${number}`)
}
export const fromWei = (wei: bigint): number => Number(formatEther(wei))

/** The deposit the API built must be a plain transfer from our wallet to the deposit address for the agreed amount, on the chain we expect. */
export function verifyEvmDeposit(tx: EvmDeposit, from: string, depositAddress: string, expectedWei: bigint, chainId: number): void {
  if (tx.chainId !== chainId) throw new Error(`deposit transaction is for chain ${tx.chainId}, expected ${chainId}`)
  if (!sameEvmAddress(tx.from, from)) throw new Error("deposit transaction is not sent from our wallet")
  if (!sameEvmAddress(tx.to, depositAddress)) throw new Error("deposit transaction does not send to this transfer's deposit address")
  if (BigInt(tx.value) !== expectedWei) throw new Error(`deposit transaction moves ${formatEther(BigInt(tx.value))} ETH, expected ${formatEther(expectedWei)}`)
  if (BigInt(tx.gas) !== TRANSFER_GAS) throw new Error(`deposit transaction asks for ${tx.gas} gas, expected 21000`)
  if (tx.data && tx.data !== "0x") throw new Error("deposit transaction carries calldata; a plain transfer has none")
}

/**
 * Sign a plain transfer {to, value, gas: 21000} with the account data from GET /api/rh/account. `nonce` is
 * pendingNonce (+1 per transaction already sent in a row from this wallet). Returns the raw bytes for POST /api/rh/send.
 */
export async function signEvmTransfer(account: PrivateKeyAccount, p: { chainId: number; nonce: number; to: string; valueWei: bigint; maxFeePerGas: string; maxPriorityFeePerGas: string }): Promise<Hex> {
  return account.signTransaction({
    chainId: p.chainId,
    nonce: p.nonce,
    to: getAddress(p.to),
    value: p.valueWei,
    gas: TRANSFER_GAS,
    maxFeePerGas: BigInt(p.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(p.maxPriorityFeePerGas),
    type: "eip1559",
  })
}

/** The fee a transfer can cost at most, in ETH: 21000 × maxFeePerGas. */
export const maxTransferFeeEth = (acct: EvmAccountInfo) => fromWei(TRANSFER_GAS * BigInt(acct.maxFeePerGas))
