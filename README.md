# 🏦 Solana Vault

A decentralized **time-lock vault** smart contract built on **Solana** using the **Anchor framework**. Users deposit SOL, receive LP tokens representing their vault share, and withdraw after a 4-day lock period. Vault owner has full admin controls including SOL transfers to any wallet.

> ✅ **Live on Solana Devnet**  
> 📄 **Full documentation** — see `solana-vault-documentation.docx`

---

## 📌 What It Does

```
User deposits 0.1 SOL
        │
        ├── Receives 1 LP token
        ├── SOL locked for 4 days
        └── After 4 days → withdraw SOL, LP tokens burned
```

---

## ✨ Features

| Feature | Description |
|---|---|
| 🔐 Time-Lock | Deposited SOL locked for 4 days |
| 🪙 LP Tokens | 1 LP = 0.1 SOL — represents vault share |
| 🔥 Auto Burn | LP tokens burned on withdrawal |
| 👤 Open Registration | Any wallet can register and deposit |
| 🛡️ Admin Transfer | Vault owner can transfer SOL to any wallet |
| 📊 Vault Dashboard | Full CLI to check vault state and history |
| 🔒 Security | All constraints enforced on-chain |

---

## 🏗️ Architecture

### Program Addresses (Devnet)

| Account | Address |
|---|---|
| Program ID | `DmvnbCoGjvP8zfEZeBkrHft2EMQpkjuQ4wZq1AFt7dEL` |
| Vault PDA | `FfLv54imAmVe51twP55EUP1CsWLhhwM7TiGffKCiievo` |
| LP Mint PDA | `BKQxg5o24kpLbXXHwbRXgVWMdu6yqLbM7v6YzbNyMQLc` |

### PDA Seeds

```
VaultState     →  ["vault3",     owner_pubkey]
LP Mint        →  ["lp_mint3",   owner_pubkey]
DepositorState →  ["depositor3", depositor_pubkey, owner_pubkey]
```

---

## 📦 Tech Stack

- **Blockchain** — Solana Devnet
- **Framework** — Anchor 0.32.1
- **Smart Contract** — Rust
- **Scripts** — TypeScript
- **Token Standard** — SPL Token

---

## ⚙️ Setup & Installation

### Prerequisites

- Node.js v18+
- Yarn
- Rust
- Solana CLI
- Anchor CLI 0.32.1

### 1. Install Solana CLI

```bash
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
export PATH="/root/.local/share/solana/install/active_release/bin:$PATH"
```

### 2. Install Anchor CLI

```bash
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install 0.32.1 && avm use 0.32.1
```

### 3. Configure Devnet

```bash
solana config set --url https://api.devnet.solana.com
solana-keygen new --outfile ~/.config/solana/id.json
solana airdrop 5
```

### 4. Clone & Install

```bash
git clone https://github.com/bilaljawaid980/solana-vault.git
cd solana-vault
yarn install
```

### 5. Build & Deploy

```bash
anchor build && anchor deploy
```

---

## 🧪 Run Tests

```bash
anchor test --skip-local-validator
```

### Test Results

```
✅ Test 1 — Register vault with 4 day lock period
✅ Test 2 — Owner deposit — balance increases correctly
✅ Test 3 — Zero deposit — rejected with ZeroDeposit error
✅ Test 4 — Register depositor — wallet linked to vault
✅ Test 5 — Deposit by depositor — SOL locked, LP tokens minted
✅ Test 6 — Invalid amount — not multiple of 0.1 SOL rejected
✅ Test 7 — Withdraw while locked — FundsStillLocked error thrown
✅ Test 8 — Get LP value — 1 LP = 0.1 SOL

8 passing
```

---

## 🖥️ CLI Scripts

All scripts are in the `scripts/` folder. Run with:

```bash
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET=~/.config/solana/<your-wallet>.json \
npx ts-node -P tsconfig.json scripts/<script-name>.ts
```

### Owner Scripts

| Script | Description |
|---|---|
| `vault-state.ts` | Full vault dashboard — balance, LP supply, admin transfer history |
| `owner-deposit.ts` | Deposit SOL into vault (CLI asks amount) |
| `admin-transfer.ts` | Transfer SOL to any wallet (CLI asks destination + amount) |
| `vault-users.ts` | List all depositors with LP balance and lock status |

### Depositor Scripts

| Script | Description |
|---|---|
| `depositor-deposit.ts` | Register or deposit — works with ANY wallet via CLI |
| `my-account.ts` | Check wallet SOL balance, LP tokens, vault share |
| `check-lock-time.ts` | See exactly how long until funds unlock |
| `withdraw.ts` | Withdraw SOL after lock period — burns LP tokens |

---

## 📋 Contract Instructions

| Instruction | Who Can Call | Description |
|---|---|---|
| `register()` | Owner only | Create vault + LP mint |
| `deposit()` | Owner only | Deposit SOL into vault |
| `register_depositor()` | Anyone | Register wallet into vault |
| `deposit_by_depositor()` | Registered depositors | Send SOL, receive LP tokens |
| `withdraw()` | Registered depositors | Burn LP tokens, get SOL back |
| `admin_transfer()` | Owner only | Transfer SOL to any wallet |
| `get_lp_value()` | Anyone | View LP price and vault stats |

---

## 🔐 Error Codes

| Error | Description |
|---|---|
| `ZeroDeposit` | Deposit amount must be greater than zero |
| `UnauthorizedUser` | You are not the owner of this vault |
| `WrongVault` | Depositor not registered to this vault |
| `InvalidDepositAmount` | Must be a multiple of 0.1 SOL |
| `FundsStillLocked` | Wait until lock period expires |
| `NothingToWithdraw` | No active deposit found |
| `NotEnoughFunds` | Vault does not have enough SOL |

---

## 👤 User Flow

### New Depositor — Step by Step

```bash
# Step 1 — Create a new wallet
solana-keygen new --outfile ~/.config/solana/mywallet.json

# Step 2 — Get devnet SOL
solana airdrop 2 $(solana-keygen pubkey ~/.config/solana/mywallet.json) --url devnet

# Step 3 — Register into vault (choose option 1)
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET=~/.config/solana/id.json \
npx ts-node -P tsconfig.json scripts/depositor-deposit.ts

# Step 4 — Deposit SOL (choose option 2)
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET=~/.config/solana/id.json \
npx ts-node -P tsconfig.json scripts/depositor-deposit.ts

# Step 5 — Check your account
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET=~/.config/solana/id.json \
npx ts-node -P tsconfig.json scripts/my-account.ts

# Step 6 — After 4 days, withdraw
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET=~/.config/solana/id.json \
npx ts-node -P tsconfig.json scripts/withdraw.ts
```

---

## 📁 Project Structure

```
solana-vault/
├── programs/vault/src/
│   └── lib.rs                       ← Full smart contract (Rust)
├── tests/
│   └── vault.ts                     ← Complete test suite (8 tests)
├── scripts/
│   ├── vault-state.ts               ← Vault dashboard
│   ├── owner-deposit.ts             ← Owner deposits SOL
│   ├── admin-transfer.ts            ← Admin transfers SOL
│   ├── vault-users.ts               ← List all depositors
│   ├── depositor-deposit.ts         ← Any wallet deposits
│   ├── my-account.ts                ← Check account status
│   ├── check-lock-time.ts           ← Check lock time
│   └── withdraw.ts                  ← Withdraw SOL
├── Anchor.toml                      ← Anchor config
├── Cargo.toml                       ← Rust dependencies
├── package.json                     ← Node dependencies
└── solana-vault-documentation.docx  ← Full documentation
```

---

## 🔗 Links

- **Explorer (Program)** — [View on Solana Explorer](https://explorer.solana.com/address/DmvnbCoGjvP8zfEZeBkrHft2EMQpkjuQ4wZq1AFt7dEL?cluster=devnet)
- **Explorer (Vault PDA)** — [View Vault Account](https://explorer.solana.com/address/FfLv54imAmVe51twP55EUP1CsWLhhwM7TiGffKCiievo?cluster=devnet)
- **Explorer (LP Mint)** — [View LP Mint](https://explorer.solana.com/address/BKQxg5o24kpLbXXHwbRXgVWMdu6yqLbM7v6YzbNyMQLc?cluster=devnet)

---

## 🚀 What's Next

- [ ] Yield generation — staking rewards for LP holders
- [ ] Multiple vaults per owner
- [ ] Variable lock periods chosen at deposit time
- [ ] Penalty fee for early withdrawal

---

## 📄 License

MIT License — free to use and modify.

---

*Built with ❤️ on Solana by [bilaljawaid980](https://github.com/bilaljawaid980)*
