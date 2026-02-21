import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Vault } from "../target/types/vault";
import { PublicKey, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import * as readline from "readline";
import fs from "fs";

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
  const connection = new anchor.web3.Connection(
    "https://api.devnet.solana.com",
    "confirmed"
  );

  console.log("═══════════════════════════════════════════");
  console.log("       VAULT DEPOSITOR CLI");
  console.log("═══════════════════════════════════════════");

  // Ask for wallet keypair path
  const walletPath = await askQuestion(
    "Enter your wallet keypair path (e.g. /root/.config/solana/id.json): "
  );

  if (!fs.existsSync(walletPath)) {
    console.log("❌ Wallet file not found at:", walletPath);
    return;
  }

  let userKeypair: Keypair;
  try {
    userKeypair = Keypair.fromSecretKey(
      Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
    );
  } catch (e) {
    console.log("❌ Invalid keypair file!");
    return;
  }

  // Ask for vault owner address
  const vaultOwnerInput = await askQuestion(
    "Enter vault owner address: "
  );

  let vaultOwner: PublicKey;
  try {
    vaultOwner = new PublicKey(vaultOwnerInput);
  } catch (e) {
    console.log("❌ Invalid vault owner address!");
    return;
  }

  const wallet = new anchor.Wallet(userKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);
  const program = anchor.workspace.Vault as Program<Vault>;

  const [vaultStatePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault3"), vaultOwner.toBuffer()], program.programId
  );
  const [lpMintPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("lp_mint3"), vaultOwner.toBuffer()], program.programId
  );
  const [depositorStatePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("depositor3"), userKeypair.publicKey.toBuffer(), vaultOwner.toBuffer()],
    program.programId
  );

  // Check vault exists
  let vaultState: any;
  try {
    vaultState = await program.account.vaultState.fetch(vaultStatePDA);
  } catch (e) {
    console.log("❌ Vault not found for this owner address!");
    return;
  }

  const solBalance = await connection.getBalance(userKeypair.publicKey);

  console.log("───────────────────────────────────────────");
  console.log("Your wallet   :", userKeypair.publicKey.toString());
  console.log("Your SOL bal  :", solBalance / LAMPORTS_PER_SOL, "SOL");
  console.log("Vault owner   :", vaultOwner.toString());
  console.log("Vault balance :", vaultState.balance.toNumber() / LAMPORTS_PER_SOL, "SOL");
  console.log("Lock period   :", Number(vaultState.lockPeriod) / 86400, "days");
  console.log("───────────────────────────────────────────");

  // Check if already registered
  let isRegistered = false;
  try {
    await program.account.depositorState.fetch(depositorStatePDA);
    isRegistered = true;
    console.log("✅ You are already registered in this vault");
  } catch (e) {
    console.log("⚠️  You are NOT registered in this vault yet");
  }

  // Ask what to do
  console.log("\nWhat do you want to do?");
  console.log("1. Register into vault");
  console.log("2. Deposit SOL");
  console.log("3. Exit");

  const choice = await askQuestion("\nEnter choice (1/2/3): ");

  // ─────────────────────────────────────────
  // OPTION 1 — Register
  // ─────────────────────────────────────────
  if (choice === "1") {
    if (isRegistered) {
      console.log("❌ You are already registered!");
      return;
    }

    const confirm = await askQuestion(
      `\nRegister your wallet into vault (${vaultOwnerInput})? (yes/no): `
    );
    if (confirm.toLowerCase() !== "yes") {
      console.log("❌ Cancelled.");
      return;
    }

    const tx = await program.methods
      .registerDepositor()
      .accountsPartial({
        depositor: userKeypair.publicKey,
        vaultState: vaultStatePDA,
        depositorState: depositorStatePDA,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    console.log("\n✅ Registered successfully!");
    console.log("TX      :", tx);
    console.log("Explorer: https://explorer.solana.com/tx/" + tx + "?cluster=devnet");
  }

  // ─────────────────────────────────────────
  // OPTION 2 — Deposit
  // ─────────────────────────────────────────
  else if (choice === "2") {
    if (!isRegistered) {
      console.log("❌ You must register first! Run again and choose option 1.");
      return;
    }

    const amountInput = await askQuestion(
      "\nEnter amount to deposit in SOL (must be multiple of 0.1): "
    );
    const solAmount = parseFloat(amountInput);

    if (isNaN(solAmount) || solAmount <= 0) {
      console.log("❌ Invalid amount!");
      return;
    }

    if ((solAmount * LAMPORTS_PER_SOL) % 100_000_000 !== 0) {
      console.log("❌ Amount must be a multiple of 0.1 SOL!");
      return;
    }

    if (solBalance < solAmount * LAMPORTS_PER_SOL) {
      console.log("❌ Not enough SOL in your wallet!");
      console.log("Your balance:", solBalance / LAMPORTS_PER_SOL, "SOL");
      return;
    }

    const unlockDate = new Date(Date.now() + Number(vaultState.lockPeriod) * 1000);
    console.log("\n⚠️  Your SOL will be locked until:", unlockDate.toLocaleString());

    const confirm = await askQuestion(
      `\nConfirm deposit of ${solAmount} SOL? (yes/no): `
    );
    if (confirm.toLowerCase() !== "yes") {
      console.log("❌ Deposit cancelled.");
      return;
    }

    // Get or create token account
    const tokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      userKeypair,
      lpMintPDA,
      userKeypair.publicKey
    );

    const amount = new anchor.BN(solAmount * LAMPORTS_PER_SOL);
    const vaultBefore = vaultState.balance.toNumber();

    const tx = await program.methods
      .depositByDepositor(amount)
      .accountsPartial({
        depositor: userKeypair.publicKey,
        depositorState: depositorStatePDA,
        vaultState: vaultStatePDA,
        lpMint: lpMintPDA,
        depositorTokenAccount: tokenAccount.address,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const vaultAfter = (await program.account.vaultState.fetch(vaultStatePDA)).balance.toNumber();
    const lpBalance = await connection.getTokenAccountBalance(tokenAccount.address);
    const depState = await program.account.depositorState.fetch(depositorStatePDA);

    console.log("\n═══════════════════════════════════════════");
    console.log("✅ Deposit successful!");
    console.log("───────────────────────────────────────────");
    console.log("Deposited     :", solAmount, "SOL");
    console.log("LP received   :", solAmount / 0.1, "LP tokens");
    console.log("Vault before  :", vaultBefore / LAMPORTS_PER_SOL, "SOL");
    console.log("Vault after   :", vaultAfter / LAMPORTS_PER_SOL, "SOL");
    console.log("Your LP total :", lpBalance.value.uiAmount, "LP");
    console.log("Unlock time   :", new Date(depState.unlockTime.toNumber() * 1000).toLocaleString());
    console.log("───────────────────────────────────────────");
    console.log("TX      :", tx);
    console.log("Explorer: https://explorer.solana.com/tx/" + tx + "?cluster=devnet");
    console.log("═══════════════════════════════════════════");
  }

  // ─────────────────────────────────────────
  // OPTION 3 — Exit
  // ─────────────────────────────────────────
  else if (choice === "3") {
    console.log("Goodbye!");
  } else {
    console.log("❌ Invalid choice!");
  }
}
main().catch(console.error);