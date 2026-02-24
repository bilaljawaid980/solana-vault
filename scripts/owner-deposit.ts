
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Vault } from "../target/types/vault";
import { PublicKey, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import * as readline from "readline";
import fs from "fs";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function askQuestion(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

async function main() {
  const connection = new anchor.web3.Connection("https://api.devnet.solana.com", "confirmed");

  console.log("═══════════════════════════════════════════");
  console.log("       VAULT DEPOSIT");
  console.log("═══════════════════════════════════════════");

  // Ask wallet path
  const walletPath = await askQuestion("Enter your wallet keypair path: ");
  if (!fs.existsSync(walletPath)) {
    console.log("❌ Wallet file not found:", walletPath);
    rl.close(); return;
  }

  let userKeypair: Keypair;
  try {
    userKeypair = Keypair.fromSecretKey(Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8"))));
  } catch (e) {
    console.log("❌ Invalid keypair file!");
    rl.close(); return;
  }

  // Ask vault owner
  const vaultOwnerInput = await askQuestion("Enter vault owner address: ");
  let vaultOwner: PublicKey;
  try {
    vaultOwner = new PublicKey(vaultOwnerInput);
  } catch (e) {
    console.log("❌ Invalid vault owner address!");
    rl.close(); return;
  }

  const wallet = new anchor.Wallet(userKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);
  const program = anchor.workspace.Vault as Program<Vault>;

  const [vaultStatePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault4"), vaultOwner.toBuffer()], program.programId
  );
  const [lpMintPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("lp_mint4"), vaultOwner.toBuffer()], program.programId
  );
  const [depositorStatePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("depositor4"), userKeypair.publicKey.toBuffer(), vaultOwner.toBuffer()],
    program.programId
  );

  // Check vault exists
  let vaultState: any;
  try {
    vaultState = await program.account.vaultState.fetch(vaultStatePDA);
  } catch (e) {
    console.log("❌ Vault not found for this owner address!");
    rl.close(); return;
  }

  const solBalance = await connection.getBalance(userKeypair.publicKey);
  const minDepositLamports = vaultState.minDeposit.toNumber();
  const minDepositSol = minDepositLamports / LAMPORTS_PER_SOL;

  // Check if first time depositor
  let isFirstDeposit = false;
  try {
    await program.account.depositorState.fetch(depositorStatePDA);
  } catch (e) {
    isFirstDeposit = true;
  }

  console.log("───────────────────────────────────────────");
  console.log("Your wallet   :", userKeypair.publicKey.toString());
  console.log("Your SOL bal  :", solBalance / LAMPORTS_PER_SOL, "SOL");
  console.log("Vault owner   :", vaultOwner.toString());
  console.log("Vault balance :", vaultState.balance.toNumber() / LAMPORTS_PER_SOL, "SOL");
  console.log("Lock period   :", Number(vaultState.lockPeriod) / 86400, "days");
  console.log("Min deposit   :", minDepositSol, "SOL");
  if (isFirstDeposit) {
    console.log("Status        : 🆕 First deposit — account will be created automatically");
  } else {
    console.log("Status        : ✅ Returning depositor");
  }
  console.log("───────────────────────────────────────────");

  // Ask deposit amount
  const amountInput = await askQuestion(`Enter amount to deposit in SOL (min ${minDepositSol}, multiples only): `);
  const solAmount = parseFloat(amountInput);

  if (isNaN(solAmount) || solAmount <= 0) {
    console.log("❌ Invalid amount!");
    rl.close(); return;
  }

  const lamports = Math.round(solAmount * LAMPORTS_PER_SOL);

  if (lamports < minDepositLamports) {
    console.log("❌ Amount below minimum deposit of", minDepositSol, "SOL!");
    rl.close(); return;
  }

  if (lamports % minDepositLamports !== 0) {
    console.log("❌ Amount must be a multiple of", minDepositSol, "SOL!");
    rl.close(); return;
  }

  if (solBalance < lamports) {
    console.log("❌ Not enough SOL in your wallet!");
    console.log("   Your balance:", solBalance / LAMPORTS_PER_SOL, "SOL");
    rl.close(); return;
  }

  const unlockDate = new Date(Date.now() + Number(vaultState.lockPeriod) * 1000);
  const lpToReceive = lamports / minDepositLamports;

  console.log("───────────────────────────────────────────");
  console.log("Deposit amount :", solAmount, "SOL");
  console.log("LP to receive  :", lpToReceive, "LP tokens");
  console.log("Unlock time    :", unlockDate.toLocaleString());
  console.log("───────────────────────────────────────────");

  const confirm = await askQuestion("Confirm deposit? (yes/no): ");
  if (confirm.toLowerCase() !== "yes") {
    console.log("❌ Deposit cancelled.");
    rl.close(); return;
  }

  // Get or create LP token account
  const tokenAccount = await getOrCreateAssociatedTokenAccount(
    connection, userKeypair, lpMintPDA, userKeypair.publicKey
  );

  const amount = new anchor.BN(lamports);
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
  console.log("LP received   :", lpToReceive, "LP tokens");
  console.log("Vault before  :", vaultBefore / LAMPORTS_PER_SOL, "SOL");
  console.log("Vault after   :", vaultAfter / LAMPORTS_PER_SOL, "SOL");
  console.log("Your LP total :", lpBalance.value.uiAmount, "LP");
  console.log("Unlock time   :", new Date(depState.unlockTime.toNumber() * 1000).toLocaleString());
  console.log("───────────────────────────────────────────");
  console.log("TX      :", tx);
  console.log("Explorer: https://explorer.solana.com/tx/" + tx + "?cluster=devnet");
  console.log("═══════════════════════════════════════════");

  rl.close();
}
main().catch((e) => { console.error(e); rl.close(); });