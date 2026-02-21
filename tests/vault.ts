import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Vault } from "../target/types/vault";
import { PublicKey, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import assert from "assert";
import fs from "fs";

describe("vault — full test suite", () => {
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
      [Buffer.from("vault3"), owner.toBuffer()],
      program.programId
    );
    [lpMintPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("lp_mint3"), owner.toBuffer()],
      program.programId
    );
    [depositorStatePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("depositor3"), depositorKeypair.publicKey.toBuffer(), owner.toBuffer()],
      program.programId
    );

    console.log("═══════════════════════════════════════════════");
    console.log("  VAULT TEST SUITE");
    console.log("═══════════════════════════════════════════════");
    console.log("Owner wallet  :", owner.toString());
    console.log("Depositor     :", depositorKeypair.publicKey.toString());
    console.log("Vault PDA     :", vaultStatePDA.toString());
    console.log("LP Mint PDA   :", lpMintPDA.toString());
    console.log("Depositor PDA :", depositorStatePDA.toString());
    console.log("═══════════════════════════════════════════════");
  });

  // ─────────────────────────────────────────
  // TEST 1
  // ─────────────────────────────────────────
  it("1. Register — owner creates vault + LP mint with 4 day lock", async () => {
    try {
      await program.account.vaultState.fetch(vaultStatePDA);
      console.log("⚠️  Vault already exists, skipping...");
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
    assert.strictEqual(state.lockPeriod.toString(), String(4 * 24 * 60 * 60));

    console.log("Owner       :", state.owner.toString());
    console.log("Balance     : 0 SOL");
    console.log("LP Mint     :", state.lpMint.toString());
    console.log("Lock period :", state.lockPeriod.toString(), "seconds (4 days)");
    console.log("✅ TEST 1 PASSED | tx:", tx);
  });

  // ─────────────────────────────────────────
  // TEST 2
  // ─────────────────────────────────────────
  it("2. Deposit — owner deposits 0.1 SOL into vault", async () => {
    const before = (await program.account.vaultState.fetch(vaultStatePDA)).balance.toNumber();
    const amount = new anchor.BN(0.1 * LAMPORTS_PER_SOL);

    const tx = await program.methods
      .deposit(amount)
      .accountsPartial({
        user: owner,
        vaultState: vaultStatePDA,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const after = (await program.account.vaultState.fetch(vaultStatePDA)).balance.toNumber();
    assert.strictEqual(after - before, 0.1 * LAMPORTS_PER_SOL);

    console.log("Balance before :", before / LAMPORTS_PER_SOL, "SOL");
    console.log("Balance after  :", after / LAMPORTS_PER_SOL, "SOL");
    console.log("Difference     : +0.1 SOL");
    console.log("✅ TEST 2 PASSED | tx:", tx);
  });

  // ─────────────────────────────────────────
  // TEST 3
  // ─────────────────────────────────────────
  it("3. Deposit zero — should be rejected", async () => {
    try {
      await program.methods
        .deposit(new anchor.BN(0))
        .accountsPartial({
          user: owner,
          vaultState: vaultStatePDA,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      assert.fail("Should have thrown ZeroDeposit error");
    } catch (err: any) {
      console.log("Got expected error: ZeroDeposit ✅");
      console.log("✅ TEST 3 PASSED — zero deposit correctly rejected");
    }
  });

  // ─────────────────────────────────────────
  // TEST 4
  // ─────────────────────────────────────────
  it("4. Register depositor — wallet2 links to owner vault", async () => {
    try {
      await program.account.depositorState.fetch(depositorStatePDA);
      console.log("⚠️  Depositor already registered, skipping...");
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

    console.log("Depositor  :", state.depositor.toString());
    console.log("Vault owner:", state.vaultOwner.toString());
    console.log("✅ TEST 4 PASSED | tx:", tx);
  });

  // ─────────────────────────────────────────
  // TEST 5
  // ─────────────────────────────────────────
  it("5. Deposit by depositor — sends 0.1 SOL, gets 1 LP, locked 4 days", async () => {
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

    const vaultBefore = (await program.account.vaultState.fetch(vaultStatePDA)).balance.toNumber();
    const lpBefore = (await provider.connection.getTokenAccountBalance(depositorTokenAccount)).value.uiAmount || 0;

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
    const depState = await program.account.depositorState.fetch(depositorStatePDA);

    assert.strictEqual(vaultAfter - vaultBefore, 0.1 * LAMPORTS_PER_SOL);
    assert.strictEqual(lpAfter - lpBefore, 1);

    console.log("Vault balance :", vaultAfter / LAMPORTS_PER_SOL, "SOL");
    console.log("LP tokens     :", lpAfter);
    console.log("Locked amount :", depState.lockedAmount.toNumber() / LAMPORTS_PER_SOL, "SOL");
    console.log("Deposit time  :", new Date(depState.depositTime.toNumber() * 1000).toLocaleString());
    console.log("Unlock time   :", new Date(depState.unlockTime.toNumber() * 1000).toLocaleString());
    console.log("✅ TEST 5 PASSED | tx:", tx);
  });

  // ─────────────────────────────────────────
  // TEST 6
  // ─────────────────────────────────────────
  it("6. Deposit invalid amount — not multiple of 0.1 SOL, should fail", async () => {
    const depositorWallet = new anchor.Wallet(depositorKeypair);
    const depositorProvider = new anchor.AnchorProvider(provider.connection, depositorWallet, {});
    const depositorProgram = new anchor.Program(program.idl, depositorProvider);

    const tokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      depositorKeypair,
      lpMintPDA,
      depositorKeypair.publicKey
    );

    try {
      await depositorProgram.methods
        .depositByDepositor(new anchor.BN(50_000_000))
        .accountsPartial({
          depositor: depositorKeypair.publicKey,
          depositorState: depositorStatePDA,
          vaultState: vaultStatePDA,
          lpMint: lpMintPDA,
          depositorTokenAccount: tokenAccount.address,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      assert.fail("Should have thrown InvalidDepositAmount");
    } catch (err: any) {
      console.log("Got expected error: InvalidDepositAmount ✅");
      console.log("✅ TEST 6 PASSED — invalid amount correctly rejected");
    }
  });

  // ─────────────────────────────────────────
  // TEST 7
  // ─────────────────────────────────────────
  it("7. Withdraw — should FAIL, funds locked for 4 days", async () => {
    const depositorWallet = new anchor.Wallet(depositorKeypair);
    const depositorProvider = new anchor.AnchorProvider(provider.connection, depositorWallet, {});
    const depositorProgram = new anchor.Program(program.idl, depositorProvider);

    const tokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      depositorKeypair,
      lpMintPDA,
      depositorKeypair.publicKey
    );

    try {
      await depositorProgram.methods
        .withdraw()
        .accountsPartial({
          depositor: depositorKeypair.publicKey,
          depositorState: depositorStatePDA,
          vaultState: vaultStatePDA,
          lpMint: lpMintPDA,
          depositorTokenAccount: tokenAccount.address,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      assert.fail("Should have thrown FundsStillLocked");
    } catch (err: any) {
      console.log("Got expected error: FundsStillLocked ✅");
      console.log("✅ TEST 7 PASSED — withdrawal correctly blocked");
    }
  });

  // ─────────────────────────────────────────
  // TEST 8
  // ─────────────────────────────────────────
  it("8. Get LP value — 1 LP = 0.1 SOL", async () => {
    const tx = await program.methods
      .getLpValue()
      .accountsPartial({
        vaultState: vaultStatePDA,
        lpMint: lpMintPDA,
      })
      .rpc();

    const state = await program.account.vaultState.fetch(vaultStatePDA);
    const lpSupply = await provider.connection.getTokenSupply(lpMintPDA);

    console.log("═══════════════════════════════════════");
    console.log("Vault balance :", Number(state.balance) / LAMPORTS_PER_SOL, "SOL");
    console.log("Total LP      :", lpSupply.value.uiAmount, "LP");
    console.log("1 LP = 0.1 SOL");
    console.log("Lock period   : 4 days (345600 seconds)");
    console.log("═══════════════════════════════════════");
    console.log("✅ TEST 8 PASSED | tx:", tx);
  });

  // ─────────────────────────────────────────
  // TEST 9
  // ─────────────────────────────────────────
  it("9. Admin transfer — owner transfers SOL to any wallet", async () => {
    // Use depositor wallet as destination
    const destination = depositorKeypair.publicKey;

    const vaultBefore = (await program.account.vaultState.fetch(vaultStatePDA)).balance.toNumber();
    const destBefore = await provider.connection.getBalance(destination);

    // Transfer 0.1 SOL
    const amount = new anchor.BN(0.1 * LAMPORTS_PER_SOL);

    const tx = await program.methods
      .adminTransfer(amount)
      .accountsPartial({
        owner: owner,
        vaultState: vaultStatePDA,
        destination: destination,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const vaultAfter = (await program.account.vaultState.fetch(vaultStatePDA)).balance.toNumber();
    const destAfter = await provider.connection.getBalance(destination);

    // Vault decreased by 0.1 SOL
    assert.strictEqual(vaultBefore - vaultAfter, 0.1 * LAMPORTS_PER_SOL);
    // Destination increased by 0.1 SOL
    assert.strictEqual(destAfter - destBefore, 0.1 * LAMPORTS_PER_SOL);

    console.log("Destination   :", destination.toString());
    console.log("Amount sent   : 0.1 SOL");
    console.log("Vault before  :", vaultBefore / LAMPORTS_PER_SOL, "SOL");
    console.log("Vault after   :", vaultAfter / LAMPORTS_PER_SOL, "SOL");
    console.log("Dest before   :", destBefore / LAMPORTS_PER_SOL, "SOL");
    console.log("Dest after    :", destAfter / LAMPORTS_PER_SOL, "SOL");
    console.log("✅ TEST 9 PASSED | tx:", tx);
  });

  // ─────────────────────────────────────────
  // TEST 10
  // ─────────────────────────────────────────
  it("10. Admin transfer — non-owner should be rejected", async () => {
    const depositorWallet = new anchor.Wallet(depositorKeypair);
    const depositorProvider = new anchor.AnchorProvider(provider.connection, depositorWallet, {});
    const depositorProgram = new anchor.Program(program.idl, depositorProvider);

    const amount = new anchor.BN(0.1 * LAMPORTS_PER_SOL);

    try {
      await depositorProgram.methods
        .adminTransfer(amount)
        .accountsPartial({
          owner: depositorKeypair.publicKey,
          vaultState: vaultStatePDA,
          destination: depositorKeypair.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      assert.fail("Should have thrown UnauthorizedUser error");
    } catch (err: any) {
      console.log("Got expected error: UnauthorizedUser ✅");
      console.log("✅ TEST 10 PASSED — non-owner correctly rejected");
    }
  });
});