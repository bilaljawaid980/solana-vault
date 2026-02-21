import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Vault } from "../target/types/vault";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import * as readline from "readline";

async function askQuestion(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Vault as Program<Vault>;
  const owner = provider.wallet.publicKey;

  const [vaultStatePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault4"), owner.toBuffer()],
    program.programId
  );

  // Fetch current settings
  const state = await program.account.vaultState.fetch(vaultStatePDA);

  const currentLockDays = Number(state.lockPeriod) / 86400;
  const currentLockSeconds = Number(state.lockPeriod);
  const currentMinLamports = state.minDeposit.toNumber();
  const currentMinSol = currentMinLamports / LAMPORTS_PER_SOL;

  console.log("═══════════════════════════════════════════");
  console.log("         VAULT SETTINGS");
  console.log("═══════════════════════════════════════════");
  console.log("Admin wallet    :", owner.toString());
  console.log("───────────────────────────────────────────");
  console.log("CURRENT RULES:");
  console.log("Lock period     :", currentLockSeconds, "seconds");
  console.log("Lock period     :", currentLockDays, "days");
  console.log("Min deposit     :", currentMinLamports, "lamports");
  console.log("Min deposit     :", currentMinSol, "SOL");
  console.log("───────────────────────────────────────────");
  console.log("What do you want to change?");
  console.log("1. Change lock period");
  console.log("2. Change minimum deposit");
  console.log("3. Change both");
  console.log("4. Exit");
  console.log("───────────────────────────────────────────");

  const choice = await askQuestion("\nEnter choice (1/2/3/4): ");

  if (choice === "4") {
    console.log("Exiting...");
    return;
  }

  let newLockPeriod = new anchor.BN(currentLockSeconds);
  let newMinDeposit = new anchor.BN(currentMinLamports);

  // ─────────────────────────────────────────
  // Change Lock Period
  // ─────────────────────────────────────────
  if (choice === "1" || choice === "3") {
    console.log("\n───────────────────────────────────────────");
    console.log("CHANGE LOCK PERIOD");
    console.log("Current:", currentLockDays, "days (", currentLockSeconds, "seconds )");
    console.log("Examples: 1 day = 86400 | 2 days = 172800 | 4 days = 345600 | 7 days = 604800");

    const lockInput = await askQuestion("Enter new lock period in DAYS (e.g. 1, 2, 4, 7): ");
    const lockDays = parseFloat(lockInput);

    if (isNaN(lockDays) || lockDays <= 0) {
      console.log("❌ Invalid lock period!");
      return;
    }

    const lockSeconds = Math.floor(lockDays * 86400);
    newLockPeriod = new anchor.BN(lockSeconds);

    console.log("New lock period :", lockDays, "days =", lockSeconds, "seconds");
  }

  // ─────────────────────────────────────────
  // Change Min Deposit
  // ─────────────────────────────────────────
  if (choice === "2" || choice === "3") {
    console.log("\n───────────────────────────────────────────");
    console.log("CHANGE MINIMUM DEPOSIT");
    console.log("Current:", currentMinLamports, "lamports =", currentMinSol, "SOL");
    console.log("Examples: 0.1 SOL = 100000000 | 0.5 SOL = 500000000 | 1 SOL = 1000000000");

    const minInput = await askQuestion("Enter new minimum deposit in SOL (e.g. 0.1, 0.5, 1): ");
    const minSol = parseFloat(minInput);

    if (isNaN(minSol) || minSol <= 0) {
      console.log("❌ Invalid minimum deposit!");
      return;
    }

    const minLamports = Math.floor(minSol * LAMPORTS_PER_SOL);
    newMinDeposit = new anchor.BN(minLamports);

    console.log("New min deposit :", minLamports, "lamports =", minSol, "SOL");
  }

  // ─────────────────────────────────────────
  // Confirm and Execute
  // ─────────────────────────────────────────
  console.log("\n───────────────────────────────────────────");
  console.log("SUMMARY OF CHANGES:");
  console.log("Lock period :", currentLockSeconds, "seconds →", newLockPeriod.toString(), "seconds");
  console.log("Lock period :", currentLockDays, "days →", Number(newLockPeriod) / 86400, "days");
  console.log("Min deposit :", currentMinLamports, "lamports →", newMinDeposit.toString(), "lamports");
  console.log("Min deposit :", currentMinSol, "SOL →", newMinDeposit.toNumber() / LAMPORTS_PER_SOL, "SOL");
  console.log("───────────────────────────────────────────");

  const confirm = await askQuestion("Confirm changes? (yes/no): ");

  if (confirm.toLowerCase() !== "yes") {
    console.log("❌ Cancelled. No changes made.");
    return;
  }

  const tx = await program.methods
    .updateSettings(newLockPeriod, newMinDeposit)
    .accountsPartial({
      owner: owner,
      vaultState: vaultStatePDA,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  // Fetch updated state
  const updated = await program.account.vaultState.fetch(vaultStatePDA);

  console.log("\n═══════════════════════════════════════════");
  console.log("✅ Settings updated successfully!");
  console.log("───────────────────────────────────────────");
  console.log("New lock period :", Number(updated.lockPeriod), "seconds");
  console.log("New lock period :", Number(updated.lockPeriod) / 86400, "days");
  console.log("New min deposit :", updated.minDeposit.toNumber(), "lamports");
  console.log("New min deposit :", updated.minDeposit.toNumber() / LAMPORTS_PER_SOL, "SOL");
  console.log("───────────────────────────────────────────");
  console.log("TX      :", tx);
  console.log("Explorer: https://explorer.solana.com/tx/" + tx + "?cluster=devnet");
  console.log("═══════════════════════════════════════════");
}
main().catch(console.error);