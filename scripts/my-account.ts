import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Vault } from "../target/types/vault";
import { PublicKey, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
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

  const [lpMintPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("lp_mint3"), vaultOwner.toBuffer()], program.programId
  );
  const [depositorStatePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("depositor3"), depositorKeypair.publicKey.toBuffer(), vaultOwner.toBuffer()],
    program.programId
  );

  const solBalance = await connection.getBalance(depositorKeypair.publicKey);
  const tokenAddress = await getAssociatedTokenAddress(lpMintPDA, depositorKeypair.publicKey);
  const lpBalance = await connection.getTokenAccountBalance(tokenAddress);
  const depState = await program.account.depositorState.fetch(depositorStatePDA);
  const lpSupply = await connection.getTokenSupply(lpMintPDA);

  const myLp = lpBalance.value.uiAmount || 0;
  const totalLp = lpSupply.value.uiAmount || 0;
  const sharePercent = totalLp > 0 ? ((myLp / totalLp) * 100).toFixed(2) : "0";

  console.log("═══════════════════════════════════════════");
  console.log("         MY ACCOUNT STATUS");
  console.log("═══════════════════════════════════════════");
  console.log("Wallet address  :", depositorKeypair.publicKey.toString());
  console.log("SOL balance     :", solBalance / LAMPORTS_PER_SOL, "SOL");
  console.log("───────────────────────────────────────────");
  console.log("LP token account:", tokenAddress.toString());
  console.log("My LP tokens    :", myLp, "LP");
  console.log("Total LP supply :", totalLp, "LP");
  console.log("My vault share  :", sharePercent, "%");
  console.log("My LP worth     :", (myLp * 0.1).toFixed(2), "SOL");
  console.log("Locked SOL      :", depState.lockedAmount.toNumber() / LAMPORTS_PER_SOL, "SOL");
  console.log("═══════════════════════════════════════════");
}
main().catch(console.error);