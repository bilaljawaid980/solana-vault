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

  // ── Change this amount ──
  const SOL_AMOUNT = 0.1;
  // ────────────────────────
  const amount = new anchor.BN(SOL_AMOUNT * LAMPORTS_PER_SOL);

  const before = (await program.account.vaultState.fetch(vaultStatePDA)).balance.toNumber();

  const tx = await program.methods
    .deposit(amount)
    .accountsPartial({
      user: owner,
      vaultState: vaultStatePDA,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  const after = (await program.account.vaultState.fetch(vaultStatePDA)).balance.toNumber();

  console.log("═══════════════════════════════════════════");
  console.log("         OWNER DEPOSIT");
  console.log("═══════════════════════════════════════════");
  console.log("Deposited     :", SOL_AMOUNT, "SOL");
  console.log("Balance before:", before / LAMPORTS_PER_SOL, "SOL");
  console.log("Balance after :", after / LAMPORTS_PER_SOL, "SOL");
  console.log("───────────────────────────────────────────");
  console.log("✅ Deposit successful!");
  console.log("TX      :", tx);
  console.log("Explorer: https://explorer.solana.com/tx/" + tx + "?cluster=devnet");
  console.log("═══════════════════════════════════════════");
}
main().catch(console.error);