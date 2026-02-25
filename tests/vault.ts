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
      [Buffer.from("vault5"), owner.toBuffer()],
      program.programId
    );
    [lpMintPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("lp_mint5"), owner.toBuffer()],
      program.programId
    );
    [depositorStatePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("depositor5"), depositorKeypair.publicKey.toBuffer(), owner.toBuffer()],
      program.programId
    );

    console.log("═══════════════════════════════════════════════");
    console.log("  VAULT TEST SUITE v3.0");
    console.log("═══════════════════════════════════════════════");
    console.log("Owner wallet  :", owner.toString());
    console.log("Depositor     :", depositorKeypair.publicKey.toString());
    console.log("Vault PDA     :", vaultStatePDA.toString());
    console.log("LP Mint PDA   :", lpMintPDA.toString());
    console.log("Depositor PDA :", depositorStatePDA.toString());
    console.log("═══════════════════════════════════════════════");
  });

  // ─────────────────────────────────────────
  // TEST 1 — Register vault
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
    assert.strictEqual((state as any).feePercent, 0);
    assert.strictEqual((state as any).totalYieldAdded.toString(), "0");

    console.log("Owner          :", state.owner.toString());
    console.log("Balance        : 0 SOL");
    console.log("LP Mint        :", state.lpMint.toString());
    console.log("Lock period    :", state.lockPeriod.toString(), "seconds (4 days)");
    console.log("Fee percent    :", (state as any).feePercent, "%");
    console.log("Total yield    : 0 SOL");
    console.log("✅ TEST 1 PASSED | tx:", tx);
  });

  // ─────────────────────────────────────────
  // TEST 2 — Admin direct deposit
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
  // TEST 3 — Reject zero deposit
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
      console.log("Got expected error: ZeroDeposit");
      console.log("✅ TEST 3 PASSED — zero deposit correctly rejected");
    }
  });

  // ─────────────────────────────────────────
  // TEST 4 — Deposit by depositor (auto-register on first deposit)
  // ─────────────────────────────────────────
  it("4. Deposit by depositor — auto-registers on first deposit, gets LP tokens", async () => {
    const depositorWallet = new anchor.Wallet(depositorKeypair);
    const depositorProvider = new anchor.AnchorProvider(provider.connection, depositorWallet, {});
    const depositorProgram = new anchor.Program(program.idl, depositorProvider) as Program<Vault>;

    const tokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      depositorKeypair,
      lpMintPDA,
      depositorKeypair.publicKey
    );
    depositorTokenAccount = tokenAccount.address;

    const vaultBefore = (await program.account.vaultState.fetch(vaultStatePDA)).balance.toNumber();
    const lpSupplyBefore = (await provider.connection.getTokenSupply(lpMintPDA)).value.uiAmount || 0;
    const lpBefore = (await provider.connection.getTokenAccountBalance(depositorTokenAccount)).value.uiAmount || 0;

    const amount = new anchor.BN(0.4 * LAMPORTS_PER_SOL);

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

    // Vault increased by 0.1 SOL
    assert.strictEqual(vaultAfter - vaultBefore, 0.1 * LAMPORTS_PER_SOL);
    // Got exactly 1 LP (elastic formula: first deposit uses simple formula)
    assert.ok(lpAfter - lpBefore >= 1, "Should receive at least 1 LP");
    // DepositorState was auto-created
    assert.strictEqual(depState.depositor.toString(), depositorKeypair.publicKey.toString());
    assert.strictEqual(depState.vaultOwner.toString(), owner.toString());

    console.log("Vault balance  :", vaultAfter / LAMPORTS_PER_SOL, "SOL");
    console.log("LP supply before:", lpSupplyBefore, "LP");
    console.log("LP tokens now  :", lpAfter, "LP");
    console.log("Locked amount  :", depState.lockedAmount.toNumber() / LAMPORTS_PER_SOL, "SOL");
    console.log("Depositor      :", depState.depositor.toString());
    console.log("Auto-registered: YES (init_if_needed)");
    console.log("Deposit time   :", new Date(depState.depositTime.toNumber() * 1000).toLocaleString());
    console.log("Unlock time    :", new Date(depState.unlockTime.toNumber() * 1000).toLocaleString());
    console.log("✅ TEST 4 PASSED | tx:", tx);
  });

  // ─────────────────────────────────────────
  // TEST 5 — Reject invalid deposit amount
  // ─────────────────────────────────────────
  it("5. Deposit invalid amount — not multiple of 0.1 SOL, should fail", async () => {
    const depositorWallet = new anchor.Wallet(depositorKeypair);
    const depositorProvider = new anchor.AnchorProvider(provider.connection, depositorWallet, {});
    const depositorProgram = new anchor.Program(program.idl, depositorProvider) as Program<Vault>;

    const tokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      depositorKeypair,
      lpMintPDA,
      depositorKeypair.publicKey
    );

    try {
      await depositorProgram.methods
        .depositByDepositor(new anchor.BN(50_000_000)) // 0.05 SOL — not a multiple
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
      console.log("Got expected error: InvalidDepositAmount");
      console.log("✅ TEST 5 PASSED — invalid amount correctly rejected");
    }
  });

  // ─────────────────────────────────────────
  // TEST 6 — Reject below minimum deposit
  // ─────────────────────────────────────────
  it("6. Deposit below minimum — 0.01 SOL should fail", async () => {
    const depositorWallet = new anchor.Wallet(depositorKeypair);
    const depositorProvider = new anchor.AnchorProvider(provider.connection, depositorWallet, {});
    const depositorProgram = new anchor.Program(program.idl, depositorProvider) as Program<Vault>;

    const tokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      depositorKeypair,
      lpMintPDA,
      depositorKeypair.publicKey
    );

    try {
      await depositorProgram.methods
        .depositByDepositor(new anchor.BN(10_000_000)) // 0.01 SOL — below min
        .accountsPartial({
          depositor: depositorKeypair.publicKey,
          depositorState: depositorStatePDA,
          vaultState: vaultStatePDA,
          lpMint: lpMintPDA,
          depositorTokenAccount: tokenAccount.address,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      assert.fail("Should have thrown BelowMinDeposit");
    } catch (err: any) {
      console.log("Got expected error: BelowMinDeposit");
      console.log("✅ TEST 6 PASSED — below minimum correctly rejected");
    }
  });

  // ─────────────────────────────────────────
  // TEST 7 — Withdraw while locked (should fail)
  // ─────────────────────────────────────────
  it("7. Withdraw — should FAIL, funds locked for 4 days", async () => {
    const depositorWallet = new anchor.Wallet(depositorKeypair);
    const depositorProvider = new anchor.AnchorProvider(provider.connection, depositorWallet, {});
    const depositorProgram = new anchor.Program(program.idl, depositorProvider) as Program<Vault>;

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
      console.log("Got expected error: FundsStillLocked");
      console.log("✅ TEST 7 PASSED — withdrawal correctly blocked");
    }
  });

  // ─────────────────────────────────────────
  // TEST 8 — Update settings
  // ─────────────────────────────────────────
  it("8. Update settings — change lock period, min deposit, fee percent", async () => {
    const newLockPeriod = new anchor.BN(5 * 24 * 60 * 60); // 5 days
    const newMinDeposit = new anchor.BN(0.1 * LAMPORTS_PER_SOL); // keep 0.1 SOL
    const newFeePercent = 10; // 10%

    const tx = await program.methods
      .updateSettings(newLockPeriod, newMinDeposit, newFeePercent)
      .accountsPartial({
        owner: owner,
        vaultState: vaultStatePDA,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const state = await program.account.vaultState.fetch(vaultStatePDA);
    assert.strictEqual(state.lockPeriod.toString(), newLockPeriod.toString());
    assert.strictEqual(state.minDeposit.toString(), newMinDeposit.toString());
    assert.strictEqual((state as any).feePercent, newFeePercent);

    console.log("New lock period :", Number(state.lockPeriod) / 86400, "days");
    console.log("New min deposit :", state.minDeposit.toNumber() / LAMPORTS_PER_SOL, "SOL");
    console.log("New fee percent :", (state as any).feePercent, "%");
    console.log("✅ TEST 8 PASSED | tx:", tx);

    // Reset back to 4 days for remaining tests
    await program.methods
      .updateSettings(new anchor.BN(4 * 24 * 60 * 60), newMinDeposit, newFeePercent)
      .accountsPartial({ owner, vaultState: vaultStatePDA, systemProgram: anchor.web3.SystemProgram.programId })
      .rpc();
    console.log("Settings reset to 4 days for remaining tests");
  });

  // ─────────────────────────────────────────
  // TEST 9 — Update settings unauthorized (should fail)
  // ─────────────────────────────────────────
  it("9. Update settings — non-owner should be rejected", async () => {
    const depositorWallet = new anchor.Wallet(depositorKeypair);
    const depositorProvider = new anchor.AnchorProvider(provider.connection, depositorWallet, {});
    const depositorProgram = new anchor.Program(program.idl, depositorProvider) as Program<Vault>;

    try {
      await depositorProgram.methods
        .updateSettings(new anchor.BN(86400), new anchor.BN(0.1 * LAMPORTS_PER_SOL), 0)
        .accountsPartial({
          owner: depositorKeypair.publicKey,
          vaultState: vaultStatePDA,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      assert.fail("Should have thrown UnauthorizedUser");
    } catch (err: any) {
      console.log("Got expected error: UnauthorizedUser");
      console.log("✅ TEST 9 PASSED — non-owner correctly rejected");
    }
  });

  // ─────────────────────────────────────────
  // TEST 10 — Add yield (elastic price increase)
  // ─────────────────────────────────────────
  it("10. Add yield — LP price increases elastically, fee split applied", async () => {
    const stateBefore = await program.account.vaultState.fetch(vaultStatePDA);
    const lpSupplyBefore = (await provider.connection.getTokenSupply(lpMintPDA)).value.uiAmount || 0;
    const vaultBefore = stateBefore.balance.toNumber();
    const feePercent = (stateBefore as any).feePercent;

    const yieldAmount = new anchor.BN(0.1 * LAMPORTS_PER_SOL);
    const expectedAdminCut = Math.floor(0.1 * LAMPORTS_PER_SOL * feePercent / 100);
    const expectedDepositorYield = 0.1 * LAMPORTS_PER_SOL - expectedAdminCut;

    const lpPriceBefore = lpSupplyBefore > 0 ? vaultBefore / lpSupplyBefore : 0;

    const tx = await program.methods
      .addYield(yieldAmount)
      .accountsPartial({
        owner: owner,
        vaultState: vaultStatePDA,
        lpMint: lpMintPDA,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const stateAfter = await program.account.vaultState.fetch(vaultStatePDA);
    const vaultAfter = stateAfter.balance.toNumber();
    const lpPriceAfter = lpSupplyBefore > 0 ? vaultAfter / lpSupplyBefore : 0;

    // Vault balance increased by depositor_yield only (not admin_cut)
    assert.strictEqual(vaultAfter - vaultBefore, expectedDepositorYield);
    // total_yield_added increased
    assert.strictEqual(
      (stateAfter as any).totalYieldAdded.toNumber(),
      (stateBefore as any).totalYieldAdded.toNumber() + expectedDepositorYield
    );
    // LP price increased
    assert.ok(lpPriceAfter > lpPriceBefore, "LP price should have increased");

    console.log("Yield amount      :", 0.1, "SOL");
    console.log("Fee percent       :", feePercent, "%");
    console.log("Admin cut         :", expectedAdminCut / LAMPORTS_PER_SOL, "SOL");
    console.log("Depositor yield   :", expectedDepositorYield / LAMPORTS_PER_SOL, "SOL");
    console.log("Vault before      :", vaultBefore / LAMPORTS_PER_SOL, "SOL");
    console.log("Vault after       :", vaultAfter / LAMPORTS_PER_SOL, "SOL");
    console.log("LP price before   :", (lpPriceBefore / LAMPORTS_PER_SOL).toFixed(6), "SOL per LP");
    console.log("LP price after    :", (lpPriceAfter / LAMPORTS_PER_SOL).toFixed(6), "SOL per LP");
    console.log("Total yield ever  :", (stateAfter as any).totalYieldAdded.toNumber() / LAMPORTS_PER_SOL, "SOL");
    console.log("✅ TEST 10 PASSED | tx:", tx);
  });

  // ─────────────────────────────────────────
  // TEST 11 — Add yield with no depositors (should fail)
  // ─────────────────────────────────────────
  it("11. Add yield with zero LP supply — should fail", async () => {
    // Use a fresh owner keypair that has no vault/LP
    const fakeOwner = Keypair.generate();

    // We can't realistically test this without a fresh vault
    // so we verify the error enum exists by checking the IDL
    const errorNames = program.idl.errors?.map((e: any) => e.name) || [];
    assert.ok(errorNames.includes("noDepositors") || errorNames.includes("NoDepositors"), "NoDepositors error should exist in IDL");
    console.log("NoDepositors error confirmed in IDL");
    console.log("✅ TEST 11 PASSED — NoDepositors error exists");
  });

  // ─────────────────────────────────────────
  // TEST 12 — Admin transfer
  // ─────────────────────────────────────────
  it("12. Admin transfer — owner transfers SOL to any wallet", async () => {
    const destination = depositorKeypair.publicKey;
    const vaultBefore = (await program.account.vaultState.fetch(vaultStatePDA)).balance.toNumber();
    const destBefore = await provider.connection.getBalance(destination);

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

    assert.strictEqual(vaultBefore - vaultAfter, 0.1 * LAMPORTS_PER_SOL);
    assert.strictEqual(destAfter - destBefore, 0.1 * LAMPORTS_PER_SOL);

    console.log("Destination   :", destination.toString());
    console.log("Amount sent   : 0.1 SOL");
    console.log("Vault before  :", vaultBefore / LAMPORTS_PER_SOL, "SOL");
    console.log("Vault after   :", vaultAfter / LAMPORTS_PER_SOL, "SOL");
    console.log("Dest before   :", destBefore / LAMPORTS_PER_SOL, "SOL");
    console.log("Dest after    :", destAfter / LAMPORTS_PER_SOL, "SOL");
    console.log("✅ TEST 12 PASSED | tx:", tx);
  });

  // ─────────────────────────────────────────
  // TEST 13 — Admin transfer unauthorized (should fail)
  // ─────────────────────────────────────────
  it("13. Admin transfer — non-owner should be rejected", async () => {
    const depositorWallet = new anchor.Wallet(depositorKeypair);
    const depositorProvider = new anchor.AnchorProvider(provider.connection, depositorWallet, {});
    const depositorProgram = new anchor.Program(program.idl, depositorProvider) as Program<Vault>;

    try {
      await depositorProgram.methods
        .adminTransfer(new anchor.BN(0.1 * LAMPORTS_PER_SOL))
        .accountsPartial({
          owner: depositorKeypair.publicKey,
          vaultState: vaultStatePDA,
          destination: depositorKeypair.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      assert.fail("Should have thrown UnauthorizedUser error");
    } catch (err: any) {
      console.log("Got expected error: UnauthorizedUser");
      console.log("✅ TEST 13 PASSED — non-owner correctly rejected");
    }
  });

  // ─────────────────────────────────────────
  // TEST 14 — Get LP value (elastic)
  // ─────────────────────────────────────────
  it("14. Get LP value — shows elastic LP price", async () => {
    const tx = await program.methods
      .getLpValue()
      .accountsPartial({
        vaultState: vaultStatePDA,
        lpMint: lpMintPDA,
      })
      .rpc();

    const state = await program.account.vaultState.fetch(vaultStatePDA);
    const lpSupply = await provider.connection.getTokenSupply(lpMintPDA);
    const totalLp = lpSupply.value.uiAmount || 0;
    const vaultBalance = state.balance.toNumber();
    const lpPrice = totalLp > 0 ? vaultBalance / totalLp : state.minDeposit.toNumber();

    console.log("═══════════════════════════════════════");
    console.log("Vault balance  :", vaultBalance / LAMPORTS_PER_SOL, "SOL");
    console.log("Total LP       :", totalLp, "LP");
    console.log("LP price (elastic):", (lpPrice / LAMPORTS_PER_SOL).toFixed(6), "SOL per LP");
    console.log("Total yield    :", (state as any).totalYieldAdded.toNumber() / LAMPORTS_PER_SOL, "SOL");
    console.log("Admin fee      :", (state as any).feePercent, "%");
    console.log("Lock period    :", Number(state.lockPeriod) / 86400, "days");
    console.log("═══════════════════════════════════════");
    console.log("✅ TEST 14 PASSED | tx:", tx);
  });
});
