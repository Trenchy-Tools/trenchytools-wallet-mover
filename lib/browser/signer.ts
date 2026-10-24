"use client"

/**
 * Keys in the browser (demo mode), per chain: make a wallet, read a pasted secret. The only chain-specific piece of the
 * browser key store. Signing itself is the shared code the server uses too: lib/core/sol.ts (web3.js Keypair,
 * SystemProgram transfers, the deposit check) and lib/core/evm.ts (viem account, {to, value, gas: 21000}).
 *
 *   sol          base58 public key + base58 64-byte secret
 *   rh/eth/bnb   checksummed 0x address + 0x 32-byte key (one key owns the address on every EVM chain)
 */
import bs58 from "bs58"
import { CHAINS, type ChainId } from "../chains"
import { accountFromKey, generateEvm } from "../core/evm"
import { generateSol, keypairFromSecret } from "../core/sol"

/** A new wallet on a chain, in the wallet-file format. */
export const generateKey = (chain: ChainId): { publicKey: string; privateKey: string } => (CHAINS[chain].kind === "sol" ? generateSol() : generateEvm())

/** A pasted secret → its address and the key as stored (Solana: base58 even when a JSON byte array was pasted; EVM: 0x). Throws on anything else. */
export function parseSecret(chain: ChainId, secret: string): { publicKey: string; privateKey: string } {
  if (CHAINS[chain].kind === "sol") {
    const kp = keypairFromSecret(secret)
    return { publicKey: kp.publicKey.toBase58(), privateKey: bs58.encode(kp.secretKey) }
  }
  const acct = accountFromKey(secret)
  const s = secret.trim()
  return { publicKey: acct.address, privateKey: s.startsWith("0x") ? s : `0x${s}` }
}

/** The address a stored secret really belongs to (the key store checks it against the record before signing). */
export const addressOf = (chain: ChainId, privateKey: string): string => parseSecret(chain, privateKey).publicKey
