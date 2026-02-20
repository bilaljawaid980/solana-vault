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
    [Buffer.from("vault2"), vaultOwner.toBuffer()],
    program.programId
  );
  const [lpMintPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("lp_mint2"), vaultOwner.toBuffer()],
    program.programId
  );

  const tokenAccountAddress = await getAssociatedTokenAddress(
    lpMintPDA,
    depositorKeypair.publicKey
  );

  // Fetch all data
  const solBalanceLamports = await connection.getBalance(depositorKeypair.publicKey);
  const lpBalance = await connection.getTokenAccountBalance(tokenAccountAddress);
  const lpSupply = await connection.getTokenSupply(lpMintPDA);
  const vaultState = await program.account.vaultState.fetch(vaultStatePDA);

  const myLp = lpBalance.value.uiAmount || 0;
  const totalLp = lpSupply.value.uiAmount || 0;
  const vaultSol = Number(vaultState.balance) / LAMPORTS_PER_SOL;
  const mySharePercent = totalLp > 0 ? ((myLp / totalLp) * 100).toFixed(2) : "0";
  const myLpWorthSol = myLp * 0.1;

  console.log("═══════════════════════════════════════");
  console.log("       DEPOSITOR WALLET STATUS");
  console.log("═══════════════════════════════════════");
  console.log("Wallet address    :", depositorKeypair.publicKey.toString());
  console.log("───────────────────────────────────────");
  console.log("SOL balance       :", solBalanceLamports / LAMPORTS_PER_SOL, "SOL");
  console.log("───────────────────────────────────────");
  console.log("LP token account  :", tokenAccountAddress.toString());
  console.log("My LP tokens      :", myLp, "LP");
  console.log("Total LP supply   :", totalLp, "LP");
  console.log("My vault share    :", mySharePercent, "%");
  console.log("───────────────────────────────────────");
  console.log("1 LP = 0.1 SOL");
  console.log("My LP worth       :", myLpWorthSol.toFixed(2), "SOL");
  console.log("Total vault SOL   :", vaultSol, "SOL");
  console.log("═══════════════════════════════════════");
}

main().catch(console.error);