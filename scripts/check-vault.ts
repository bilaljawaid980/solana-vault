
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
    [Buffer.from("vault2"), owner.toBuffer()],
    program.programId
  );

  const state = await program.account.vaultState.fetch(vaultStatePDA);

  console.log("═══════════════════════════════════════");
  console.log("           VAULT BALANCE");
  console.log("═══════════════════════════════════════");
  console.log("Owner     :", state.owner.toString());
  console.log("Vault PDA :", vaultStatePDA.toString());
  console.log("Balance   :", state.balance.toString(), "lamports");
  console.log("Balance   :", Number(state.balance) / LAMPORTS_PER_SOL, "SOL");
  console.log("═══════════════════════════════════════");
}

main().catch(console.error);
