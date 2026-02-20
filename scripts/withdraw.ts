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

  const [vaultStatePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault3"), vaultOwner.toBuffer()], program.programId
  );
  const [lpMintPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("lp_mint3"), vaultOwner.toBuffer()], program.programId
  );
  const [depositorStatePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("depositor3"), depositorKeypair.publicKey.toBuffer(), vaultOwner.toBuffer()],
    program.programId
  );

  const tokenAddress = await getAssociatedTokenAddress(lpMintPDA, depositorKeypair.publicKey);
  const depState = await program.account.depositorState.fetch(depositorStatePDA);
  const now = Math.floor(Date.now() / 1000);

  console.log("═══════════════════════════════════════════");
  console.log("         WITHDRAW");
  console.log("═══════════════════════════════════════════");

  if (depState.lockedAmount.toNumber() === 0) {
    console.log("❌ Nothing to withdraw");
    return;
  }

  if (now < depState.unlockTime.toNumber()) {
    const secondsLeft = depState.unlockTime.toNumber() - now;
    const daysLeft = Math.floor(secondsLeft / 86400);
    const hoursLeft = Math.floor((secondsLeft % 86400) / 3600);
    console.log("🔒 Funds still locked!");
    console.log("Unlock time :", new Date(depState.unlockTime.toNumber() * 1000).toLocaleString());
    console.log("Time left   :", daysLeft + "d " + hoursLeft + "h");
    return;
  }

  const solBefore = await connection.getBalance(depositorKeypair.publicKey);
  const lpBefore = (await connection.getTokenAccountBalance(tokenAddress)).value.uiAmount || 0;

  const tx = await program.methods
    .withdraw()
    .accountsPartial({
      depositor: depositorKeypair.publicKey,
      depositorState: depositorStatePDA,
      vaultState: vaultStatePDA,
      lpMint: lpMintPDA,
      depositorTokenAccount: tokenAddress,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  const solAfter = await connection.getBalance(depositorKeypair.publicKey);
  const lpAfter = (await connection.getTokenAccountBalance(tokenAddress)).value.uiAmount || 0;

  console.log("✅ Withdrawal successful!");
  console.log("SOL before  :", solBefore / LAMPORTS_PER_SOL, "SOL");
  console.log("SOL after   :", solAfter / LAMPORTS_PER_SOL, "SOL");
  console.log("LP burned   :", lpBefore - (lpAfter || 0));
  console.log("TX          :", tx);
  console.log("Explorer    : https://explorer.solana.com/tx/" + tx + "?cluster=devnet");
  console.log("═══════════════════════════════════════════");
}
main().catch(console.error);