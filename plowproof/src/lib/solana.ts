import "server-only";
import bs58 from "bs58";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  type ParsedInstruction,
} from "@solana/web3.js";

/** SPL Memo v2. Writes UTF-8 text into the transaction; costs only the base fee. */
export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

export const SOLANA_CLUSTER = process.env.SOLANA_CLUSTER ?? "devnet";
const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

export const connection = () => new Connection(RPC_URL, "confirmed");

let cachedKeypair: Keypair | null = null;

/** Accepts the base58 secret (Phantom export) or the JSON byte array from solana-keygen. */
export function anchorKeypair(): Keypair {
  if (cachedKeypair) return cachedKeypair;
  const raw = process.env.SOLANA_ANCHOR_SECRET_KEY?.trim();
  if (!raw) throw new Error("SOLANA_ANCHOR_SECRET_KEY is not set. Run `npm run solana:keygen`.");
  const bytes = raw.startsWith("[") ? Uint8Array.from(JSON.parse(raw) as number[]) : bs58.decode(raw);
  cachedKeypair = Keypair.fromSecretKey(bytes);
  return cachedKeypair;
}

export async function writeMemo(memo: string): Promise<string> {
  const payer = anchorKeypair();
  const ix = new TransactionInstruction({
    programId: MEMO_PROGRAM_ID,
    keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: false }],
    data: Buffer.from(memo, "utf8"),
  });
  return sendAndConfirmTransaction(connection(), new Transaction().add(ix), [payer], { commitment: "confirmed" });
}

export type OnchainMemo = { memo: string; signer: string; blockTime: Date | null; slot: number };

/** Read the memo back from the chain, independent of our database. */
export async function readMemo(signature: string): Promise<OnchainMemo | null> {
  const tx = await connection().getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
  if (!tx) return null;
  const ix = tx.transaction.message.instructions.find(
    (i): i is ParsedInstruction => i.programId.equals(MEMO_PROGRAM_ID) && "parsed" in i,
  );
  if (!ix) return null;
  return {
    memo: String(ix.parsed),
    signer: tx.transaction.message.accountKeys.find((k) => k.signer)?.pubkey.toBase58() ?? "",
    blockTime: tx.blockTime ? new Date(tx.blockTime * 1000) : null,
    slot: tx.slot,
  };
}

export function explorerUrl(signature: string) {
  const base = `https://explorer.solana.com/tx/${signature}`;
  if (SOLANA_CLUSTER === "mainnet-beta") return base;
  if (SOLANA_CLUSTER === "localnet") return `${base}?cluster=custom&customUrl=${encodeURIComponent(RPC_URL)}`;
  return `${base}?cluster=${SOLANA_CLUSTER}`;
}
