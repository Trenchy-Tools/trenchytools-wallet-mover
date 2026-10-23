/**
 * Solana signing, local only. Keys come from the wallet folder (lib/wallets.ts) and never leave this process.
 *
 *   - direct legs:   build a SystemProgram transfer with a blockhash from GET /api/sol/blockhash, sign, POST /api/sol/send
 *   - exchange legs: the API hands back an unsigned v0 deposit transaction; verifySolDeposit() checks it is exactly
 *                    one SOL transfer, paid by our wallet, to the deposit address, for the agreed amount — then sign
 */
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js"
import bs58 from "bs58"

export const toLamports = (sol: number) => Math.round(sol * LAMPORTS_PER_SOL)
export const fromLamports = (lamports: number) => lamports / LAMPORTS_PER_SOL

/** A fresh keypair as the wallet file stores it: base58 public key, base58 64-byte secret. */
export function generateSol(): { publicKey: string; privateKey: string } {
  const kp = Keypair.generate()
  return { publicKey: kp.publicKey.toBase58(), privateKey: bs58.encode(kp.secretKey) }
}

/** A keypair from a base58 secret (64 bytes, the usual export) or a JSON array of bytes. Throws on anything else. */
export function keypairFromSecret(secret: string): Keypair {
  const s = secret.trim()
  try {
    if (s.startsWith("[")) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(s) as number[]))
    return Keypair.fromSecretKey(bs58.decode(s))
  } catch {
    throw new Error("Not a valid Solana secret key (base58 64-byte secret or a JSON byte array)")
  }
}

export const isSolAddress = (a: string) => { try { new PublicKey(a); return true } catch { return false } }

/** A direct leg: one SystemProgram transfer, unsigned (signSol() signs it). `blockhash` comes from GET /api/sol/blockhash. */
export function buildSolTransfer(from: PublicKey, to: string, lamports: number, blockhash: string): VersionedTransaction {
  const msg = new TransactionMessage({
    payerKey: from,
    recentBlockhash: blockhash,
    instructions: [SystemProgram.transfer({ fromPubkey: from, toPubkey: new PublicKey(to), lamports })],
  }).compileToV0Message()
  return new VersionedTransaction(msg)
}

/** The unsigned deposit transaction of a transfer leg (`transaction.transaction`, base64). */
export const depositTxFromBase64 = (b64: string) => VersionedTransaction.deserialize(Buffer.from(b64, "base64"))

/** The deposit transaction the API built must be exactly one SOL transfer, from our wallet, to the deposit address, for the agreed amount. */
export function verifySolDeposit(tx: VersionedTransaction, payer: PublicKey, depositAddress: string, expectedLamports: number): void {
  const msg = tx.message
  const keys = msg.staticAccountKeys
  if (!keys[0]?.equals(payer)) throw new Error("deposit transaction is not paid by our wallet")
  if (msg.compiledInstructions.length !== 1) throw new Error(`deposit transaction has ${msg.compiledInstructions.length} instructions, expected 1`)
  const ix = msg.compiledInstructions[0]
  if (!keys[ix.programIdIndex]?.equals(SystemProgram.programId)) throw new Error("deposit transaction is not a system transfer")
  const data = Buffer.from(ix.data)
  if (data.length !== 12 || data.readUInt32LE(0) !== 2) throw new Error("deposit transaction is not a SOL transfer")
  const lamports = Number(data.readBigUInt64LE(4))
  if (lamports !== expectedLamports) throw new Error(`deposit transaction moves ${fromLamports(lamports)} SOL, expected ${fromLamports(expectedLamports)}`)
  if (!keys[ix.accountKeyIndexes[0]]?.equals(payer)) throw new Error("deposit transaction does not send from our wallet")
  if (keys[ix.accountKeyIndexes[1]]?.toBase58() !== depositAddress) throw new Error("deposit transaction does not send to this transfer's deposit address")
}

/** Sign in place; returns the base64 bytes for POST /api/sol/send and the signature the chain will know it by. */
export function signSol(tx: VersionedTransaction, kp: Keypair): { base64: string; signature: string } {
  tx.sign([kp])
  return { base64: Buffer.from(tx.serialize()).toString("base64"), signature: bs58.encode(tx.signatures[0]) }
}
