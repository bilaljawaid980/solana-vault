
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Vault } from "../target/types/vault";
import { PublicKey, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import fs from "fs";

async function main() {
  const depositorKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync("/root/.config/solana/wallet2.json", "utf-8")))
  );

  const connection = new anchor.web3.Connection("https://api.devnet.solana.com", "confirmed");
  const wallet = new anchor.Wallet(depositorKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, {});
  anchor.setProvider(provider);

  const program = anchor.workspace.Vault as Program<Vault>;
  const vaultOwner = new PublicKey("7LA1ZMrc4j19sCSnXFmmiLvjo6KVWENwv9aS4oXYKq2E");

  const [vaultStatePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault2"), vaultOwner.toBuffer()],
    program.programId
  );
  const [lpMintPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("lp_mint2"), vaultOwner.toBuffer()],
    program.programId
  );
  const [depositorStatePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("depositor2"), depositorKeypair.publicKey.toBuffer(), vaultOwner.toBuffer()],
    program.programId
  );

  // Get or create token account
  const tokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    depositorKeypair,
    lpMintPDA,
    depositorKeypair.publicKey
  );

  // ── Change this amount (must be multiple of 0.1 SOL) ──
  const SOL_AMOUNT = 0.1;
  // ──────────────────────────────────────────────────────
  const amount = new anchor.BN(SOL_AMOUNT * LAMPORTS_PER_SOL);

  console.log("Depositing", SOL_AMOUNT, "SOL from wallet2 into vault...");

  const tx = await program.methods
    .depositByDepositor(amount)
    .accountsPartial({
      depositor: depositorKeypair.publicKey,
      depositorState: depositorStatePDA,
      vaultState: vaultStatePDA,
      lpMint: lpMintPDA,
      depositorTokenAccount: tokenAccount.address,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  const vaultState = await program.account.vaultState.fetch(vaultStatePDA);
  const lpBalance = await connection.getTokenAccountBalance(tokenAccount.address);

  console.log("═══════════════════════════════════════");
  console.log("✅ Deposit successful!");
  console.log("TX        :", tx);
  console.log("Explorer  : https://explorer.solana.com/tx/" + tx + "?cluster=devnet");
  console.log("───────────────────────────────────────");
  console.log("Vault balance :", Number(vaultState.balance) / LAMPORTS_PER_SOL, "SOL");
  console.log("Your LP tokens:", lpBalance.value.uiAmount, "LP");
  console.log("═══════════════════════════════════════");
}

main().catch(console.error);