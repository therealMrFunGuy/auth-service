// Creates the keypair that signs PlowProof's anchor transactions.
// Usage: npm run solana:keygen
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

const kp = Keypair.generate();
console.log(`
Public key (fund this wallet):
  ${kp.publicKey.toBase58()}

Add to .env (keep it secret; it only needs enough SOL for fees):
  SOLANA_ANCHOR_SECRET_KEY=${bs58.encode(kp.secretKey)}

Devnet SOL for testing:
  solana airdrop 1 ${kp.publicKey.toBase58()} --url devnet
  or https://faucet.solana.com

Each storm costs one memo transaction (about 0.000005 SOL on mainnet).
`);
