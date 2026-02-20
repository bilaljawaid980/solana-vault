import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Vault } from "../target/types/vault";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Vault as Program<Vault>;
  const owner = provider.wallet.publicKey;

  const [vaultStatePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault3"), owner.toBuffer()], program.programId
  );
  const [lpMintPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("lp_mint3"), owner.toBuffer()], program.programId
  );

  const state = await program.account.vaultState.fetch(vaultStatePDA);
  const lpSupply = await provider.connection.getTokenSupply(lpMintPDA);
  const ownerSolBalance = await provider.connection.getBalance(owner);

  const totalLp = lpSupply.value.uiAmount || 0;
  const vaultSolLamports = state.balance.toNumber();
  const vaultSol = vaultSolLamports / LAMPORTS_PER_SOL;

  console.log("═══════════════════════════════════════════");
  console.log("         VAULT CURRENT STATE");
  console.log("═══════════════════════════════════════════");
  console.log("Owner wallet  :", owner.toString());
  console.log("Owner SOL bal :", ownerSolBalance / LAMPORTS_PER_SOL, "SOL");
  console.log("───────────────────────────────────────────");
  console.log("Vault PDA     :", vaultStatePDA.toString());
  console.log("LP Mint       :", state.lpMint.toString());
  console.log("───────────────────────────────────────────");
  console.log("Vault Balance :", vaultSolLamports, "lamports");
  console.log("Vault Balance :", vaultSol, "SOL");
  console.log("───────────────────────────────────────────");
  console.log("LP Distributed:", totalLp, "LP tokens");
  console.log("LP Value      : 1 LP = 0.1 SOL = 100,000,000 lamports");
  console.log("Total LP worth:", (totalLp * 0.1).toFixed(2), "SOL");
  console.log("───────────────────────────────────────────");
  console.log("Lock Period   :", state.lockPeriod.toString(), "seconds");
  console.log("Lock Period   :", Number(state.lockPeriod) / 86400, "days");
  console.log("═══════════════════════════════════════════");
}
main().catch(console.error);