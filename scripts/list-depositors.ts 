
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Vault } from "../target/types/vault";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Vault as Program<Vault>;
  const vaultOwner = provider.wallet.publicKey;

  const [vaultStatePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault2"), vaultOwner.toBuffer()],
    program.programId
  );
  const [lpMintPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("lp_mint2"), vaultOwner.toBuffer()],
    program.programId
  );

  // Fetch vault state
  const vaultState = await program.account.vaultState.fetch(vaultStatePDA);
  const lpSupply = await program.provider.connection.getTokenSupply(lpMintPDA);
  const totalLp = lpSupply.value.uiAmount || 0;

  // Fetch ALL depositor accounts linked to this vault owner
  const allDepositors = await program.account.depositorState.all([
    {
      memcmp: {
        offset: 8 + 32, // skip discriminator + depositor pubkey → reach vault_owner field
        bytes: vaultOwner.toBase58(),
      },
    },
  ]);

  console.log("═══════════════════════════════════════════════════════");
  console.log("            VAULT DEPOSITORS LIST");
  console.log("═══════════════════════════════════════════════════════");
  console.log("Vault owner   :", vaultOwner.toString());
  console.log("Vault PDA     :", vaultStatePDA.toString());
  console.log("Vault balance :", Number(vaultState.balance) / LAMPORTS_PER_SOL, "SOL");
  console.log("Total LP      :", totalLp, "LP");
  console.log("Total users   :", allDepositors.length);
  console.log("───────────────────────────────────────────────────────");

  for (let i = 0; i < allDepositors.length; i++) {
    const d = allDepositors[i];
    const depositorAddress = d.account.depositor;

    // Get their LP token balance
    let lpBalance = 0;
    try {
      const tokenAccountAddress = await getAssociatedTokenAddress(lpMintPDA, depositorAddress);
      const tokenBalance = await program.provider.connection.getTokenAccountBalance(tokenAccountAddress);
      lpBalance = tokenBalance.value.uiAmount || 0;
    } catch (_) {}

    const sharePercent = totalLp > 0 ? ((lpBalance / totalLp) * 100).toFixed(2) : "0";
    const lpWorthSol = lpBalance * 0.1;

    console.log(`Depositor #${i + 1}`);
    console.log("  Wallet  :", depositorAddress.toString());
    console.log("  PDA     :", d.publicKey.toString());
    console.log("  LP held :", lpBalance, "LP");
    console.log("  Share   :", sharePercent, "%");
    console.log("  Worth   :", lpWorthSol.toFixed(2), "SOL");
    if (i < allDepositors.length - 1) console.log("  ───────────────────────────────────────");
  }
  console.log("═══════════════════════════════════════════════════════");
}

main().catch(console.error);
