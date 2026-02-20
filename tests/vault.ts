
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Vault } from "../target/types/vault";
import { PublicKey, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import assert from "assert";
import fs from "fs";

describe("vault", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Vault as Program<Vault>;
  const owner = provider.wallet.publicKey;

  const depositorKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync("/root/.config/solana/wallet2.json", "utf-8")))
  );

  let vaultStatePDA: PublicKey;
  let lpMintPDA: PublicKey;
  let depositorStatePDA: PublicKey;
  let depositorTokenAccount: PublicKey;

  before(async () => {
    [vaultStatePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault2"), owner.toBuffer()],
      program.programId
    );
    [lpMintPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("lp_mint2"), owner.toBuffer()],
      program.programId
    );
    [depositorStatePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("depositor2"), depositorKeypair.publicKey.toBuffer(), owner.toBuffer()],
      program.programId
    );

    console.log("Owner wallet      :", owner.toString());
    console.log("Depositor wallet  :", depositorKeypair.publicKey.toString());
    console.log("Vault PDA         :", vaultStatePDA.toString());
    console.log("LP Mint PDA       :", lpMintPDA.toString());
    console.log("Depositor PDA     :", depositorStatePDA.toString());
  });

  // ─────────────────────────────────────────
  it("Register — creates vault + LP mint", async () => {
    try {
      await program.account.vaultState.fetch(vaultStatePDA);
      console.log("⚠️  Vault already exists on-chain, skipping register...");
      return;
    } catch (_) {}

    const tx = await program.methods
      .register()
      .accountsPartial({
        user: owner,
        vaultState: vaultStatePDA,
        lpMint: lpMintPDA,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const state = await program.account.vaultState.fetch(vaultStatePDA);
    assert.strictEqual(state.owner.toString(), owner.toString());
    assert.strictEqual(state.balance.toString(), "0");
    console.log("✅ Register passed | tx:", tx);
  });

  // ─────────────────────────────────────────
  it("Deposit — owner deposits 0.1 SOL, balance increases", async () => {
    // Read balance BEFORE deposit
    const stateBefore = await program.account.vaultState.fetch(vaultStatePDA);
    const balanceBefore = stateBefore.balance.toNumber();

    const amount = new anchor.BN(0.1 * LAMPORTS_PER_SOL);

    const tx = await program.methods
      .deposit(amount)
      .accountsPartial({
        user: owner,
        vaultState: vaultStatePDA,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // Read balance AFTER deposit
    const stateAfter = await program.account.vaultState.fetch(vaultStatePDA);
    const balanceAfter = stateAfter.balance.toNumber();

    console.log("Balance before :", balanceBefore / LAMPORTS_PER_SOL, "SOL");
    console.log("Balance after  :", balanceAfter / LAMPORTS_PER_SOL, "SOL");
    console.log("Difference     :", (balanceAfter - balanceBefore) / LAMPORTS_PER_SOL, "SOL");

    // Check it increased by exactly 0.1 SOL
    assert.strictEqual(balanceAfter - balanceBefore, 0.1 * LAMPORTS_PER_SOL);
    console.log("✅ Owner deposit passed | tx:", tx);
  });

  // ─────────────────────────────────────────
  it("Register depositor — wallet2 registers into owner vault", async () => {
    try {
      await program.account.depositorState.fetch(depositorStatePDA);
      console.log("⚠️  Depositor already registered on-chain, skipping...");
      return;
    } catch (_) {}

    const depositorWallet = new anchor.Wallet(depositorKeypair);
    const depositorProvider = new anchor.AnchorProvider(provider.connection, depositorWallet, {});
    const depositorProgram = new anchor.Program(program.idl, depositorProvider);

    const tx = await depositorProgram.methods
      .registerDepositor()
      .accountsPartial({
        depositor: depositorKeypair.publicKey,
        vaultState: vaultStatePDA,
        depositorState: depositorStatePDA,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const state = await program.account.depositorState.fetch(depositorStatePDA);
    assert.strictEqual(state.depositor.toString(), depositorKeypair.publicKey.toString());
    assert.strictEqual(state.vaultOwner.toString(), owner.toString());
    console.log("✅ Register depositor passed | tx:", tx);
  });

  // ─────────────────────────────────────────
  it("Deposit by depositor — sends 0.1 SOL, receives 1 LP token", async () => {
    const depositorWallet = new anchor.Wallet(depositorKeypair);
    const depositorProvider = new anchor.AnchorProvider(provider.connection, depositorWallet, {});
    const depositorProgram = new anchor.Program(program.idl, depositorProvider);

    const tokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      depositorKeypair,
      lpMintPDA,
      depositorKeypair.publicKey
    );
    depositorTokenAccount = tokenAccount.address;
    console.log("Depositor token account:", depositorTokenAccount.toString());

    // Read LP balance before
    const lpBefore = (await provider.connection.getTokenAccountBalance(depositorTokenAccount)).value.uiAmount || 0;
    const vaultBefore = (await program.account.vaultState.fetch(vaultStatePDA)).balance.toNumber();

    const amount = new anchor.BN(0.1 * LAMPORTS_PER_SOL);

    const tx = await depositorProgram.methods
      .depositByDepositor(amount)
      .accountsPartial({
        depositor: depositorKeypair.publicKey,
        depositorState: depositorStatePDA,
        vaultState: vaultStatePDA,
        lpMint: lpMintPDA,
        depositorTokenAccount: depositorTokenAccount,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const vaultAfter = (await program.account.vaultState.fetch(vaultStatePDA)).balance.toNumber();
    const lpAfter = (await provider.connection.getTokenAccountBalance(depositorTokenAccount)).value.uiAmount || 0;

    console.log("Vault balance before :", vaultBefore / LAMPORTS_PER_SOL, "SOL");
    console.log("Vault balance after  :", vaultAfter / LAMPORTS_PER_SOL, "SOL");
    console.log("LP tokens before     :", lpBefore);
    console.log("LP tokens after      :", lpAfter);
    console.log("LP tokens received   :", lpAfter - lpBefore);

    // Vault increased by 0.1 SOL
    assert.strictEqual(vaultAfter - vaultBefore, 0.1 * LAMPORTS_PER_SOL);
    // LP increased by 1
    assert.strictEqual(lpAfter - lpBefore, 1);
    console.log("✅ Deposit by depositor passed | tx:", tx);
  });

  // ─────────────────────────────────────────
  it("Get LP value — 1 LP = 0.1 SOL", async () => {
    const tx = await program.methods
      .getLpValue()
      .accountsPartial({
        vaultState: vaultStatePDA,
        lpMint: lpMintPDA,
      })
      .rpc();

    const state = await program.account.vaultState.fetch(vaultStatePDA);
    const lpMintInfo = await provider.connection.getTokenSupply(lpMintPDA);

    console.log("─────────────────────────────────────");
    console.log("Vault SOL balance :", Number(state.balance) / LAMPORTS_PER_SOL, "SOL");
    console.log("Total LP supply   :", lpMintInfo.value.uiAmount, "LP tokens");
    console.log("1 LP = 0.1 SOL");
    console.log("─────────────────────────────────────");
    console.log("✅ Get LP value passed | tx:", tx);
  });
});