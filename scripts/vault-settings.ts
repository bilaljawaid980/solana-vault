import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Vault } from "../target/types/vault";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import * as readline from "readline";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function askQuestion(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Vault as Program<Vault>;
  const owner = provider.wallet.publicKey;

  const [vaultStatePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault5"), owner.toBuffer()],
    program.programId
  );

  const state = await program.account.vaultState.fetch(vaultStatePDA);

  const currentLockSeconds = Number(state.lockPeriod);
  const currentLockDays = currentLockSeconds / 86400;
  const currentMinLamports = state.minDeposit.toNumber();
  const currentMinSol = currentMinLamports / LAMPORTS_PER_SOL;
  const currentFeePercent = (state as any).feePercent ?? 0;

  console.log("═══════════════════════════════════════════");
  console.log("         VAULT SETTINGS");
  console.log("═══════════════════════════════════════════");
  console.log("Admin wallet    :", owner.toString());
  console.log("───────────────────────────────────────────");
  console.log("CURRENT RULES:");
  console.log("Lock period     :", currentLockDays, "days (", currentLockSeconds, "seconds )");
  console.log("Min deposit     :", currentMinSol, "SOL (", currentMinLamports, "lamports )");
  console.log("Vault fee       :", currentFeePercent, "% of yield kept by admin");
  console.log("───────────────────────────────────────────");
  console.log("What do you want to change?");
  console.log("1. Change lock period");
  console.log("2. Change minimum deposit");
  console.log("3. Change vault fee percentage");
  console.log("4. Change all");
  console.log("5. Exit");
  console.log("───────────────────────────────────────────");

  const choice = await askQuestion("\nEnter choice (1/2/3/4/5): ");

  if (choice === "5") {
    console.log("Exiting...");
    rl.close(); return;
  }

  let newLockPeriod = new anchor.BN(currentLockSeconds);
  let newMinDeposit = new anchor.BN(currentMinLamports);
  let newFeePercent = currentFeePercent;

  // ─────────────────────────────────────────
  // Change Lock Period
  // ─────────────────────────────────────────
  if (choice === "1" || choice === "4") {
    console.log("\n─── CHANGE LOCK PERIOD ─────────────────────");
    console.log("Current:", currentLockDays, "days");

    const lockInput = await askQuestion("Enter new lock period in DAYS (e.g. 1, 2, 4, 7): ");
    const lockDays = parseFloat(lockInput);

    if (isNaN(lockDays) || lockDays <= 0) {
      console.log("❌ Invalid lock period!");
      rl.close(); return;
    }

    const lockSeconds = Math.floor(lockDays * 86400);
    newLockPeriod = new anchor.BN(lockSeconds);
    console.log("✅ New lock period:", lockDays, "days =", lockSeconds, "seconds");
  }

  // ─────────────────────────────────────────
  // Change Min Deposit
  // ─────────────────────────────────────────
  if (choice === "2" || choice === "4") {
    console.log("\n─── CHANGE MINIMUM DEPOSIT ─────────────────");
    console.log("Current:", currentMinSol, "SOL");

    const minInput = await askQuestion("Enter new minimum deposit in SOL (e.g. 0.1, 0.5, 1): ");
    const minSol = parseFloat(minInput);

    if (isNaN(minSol) || minSol <= 0) {
      console.log("❌ Invalid minimum deposit!");
      rl.close(); return;
    }

    const minLamports = Math.floor(minSol * LAMPORTS_PER_SOL);
    newMinDeposit = new anchor.BN(minLamports);
    console.log("✅ New min deposit:", minSol, "SOL =", minLamports, "lamports");
  }

  // ─────────────────────────────────────────
  // Change Vault Fee Percentage
  // ─────────────────────────────────────────
  if (choice === "3" || choice === "4") {
    console.log("\n─── CHANGE VAULT FEE PERCENTAGE ────────────");
    console.log("Current fee     :", currentFeePercent, "%");
    console.log("This is the % of yield admin keeps when add_yield() is called.");
    console.log("Example: fee = 10% → admin adds 1 SOL yield → 0.9 SOL goes to depositors");
    console.log("         fee = 0%  → all yield goes to depositors");

    const feeInput = await askQuestion("Enter new fee percentage (0-100, e.g. 0, 5, 10, 20): ");
    const fee = parseFloat(feeInput);

    if (isNaN(fee) || fee < 0 || fee > 100) {
      console.log("❌ Invalid fee! Must be between 0 and 100.");
      rl.close(); return;
    }

    newFeePercent = Math.floor(fee);
    console.log("✅ New vault fee:", newFeePercent, "%");

    if (newFeePercent === 0) {
      console.log("   ℹ️  0% fee — 100% of yield goes to depositors");
    } else if (newFeePercent === 100) {
      console.log("   ⚠️  100% fee — ALL yield stays with admin, depositors get nothing!");
    } else {
      console.log("   Admin keeps :", newFeePercent, "% of each yield deposit");
      console.log("   Depositors get:", 100 - newFeePercent, "% of each yield deposit");
    }
  }

  // ─────────────────────────────────────────
  // Summary & Confirm
  // ─────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════");
  console.log("SUMMARY OF CHANGES:");
  console.log("Lock period :", currentLockDays, "days →", Number(newLockPeriod) / 86400, "days");
  console.log("Min deposit :", currentMinSol, "SOL →", newMinDeposit.toNumber() / LAMPORTS_PER_SOL, "SOL");
  console.log("Vault fee   :", currentFeePercent, "% →", newFeePercent, "%");
  console.log("───────────────────────────────────────────");

  const confirm = await askQuestion("Confirm changes? (yes/no): ");
  if (confirm.toLowerCase() !== "yes") {
    console.log("❌ Cancelled. No changes made.");
    rl.close(); return;
  }

  const tx = await program.methods
    .updateSettings(newLockPeriod, newMinDeposit, newFeePercent)
    .accountsPartial({
      owner: owner,
      vaultState: vaultStatePDA,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  const updated = await program.account.vaultState.fetch(vaultStatePDA);

  console.log("\n═══════════════════════════════════════════");
  console.log("✅ Settings updated successfully!");
  console.log("───────────────────────────────────────────");
  console.log("Lock period :", Number(updated.lockPeriod) / 86400, "days");
  console.log("Min deposit :", updated.minDeposit.toNumber() / LAMPORTS_PER_SOL, "SOL");
  console.log("Vault fee   :", (updated as any).feePercent, "%");
  console.log("───────────────────────────────────────────");
  console.log("TX      :", tx);
  console.log("Explorer: https://explorer.solana.com/tx/" + tx + "?cluster=devnet");
  console.log("═══════════════════════════════════════════");

  rl.close();
}
main().catch((e) => { console.error(e); rl.close(); });
