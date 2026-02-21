use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount};

declare_id!("DmvnbCoGjvP8zfEZeBkrHft2EMQpkjuQ4wZq1AFt7dEL");

const LP_PRICE_IN_LAMPORTS: u64 = 100_000_000;
const FOUR_DAYS_IN_SECONDS: i64 = 4 * 24 * 60 * 60;

#[program]
pub mod vault {
    use super::*;

    pub fn register(ctx: Context<Register>) -> Result<()> {
        let vault_state = &mut ctx.accounts.vault_state;
        vault_state.owner = ctx.accounts.user.key();
        vault_state.balance = 0;
        vault_state.bump = ctx.bumps.vault_state;
        vault_state.lp_mint = ctx.accounts.lp_mint.key();
        vault_state.lp_mint_bump = ctx.bumps.lp_mint;
        vault_state.lock_period = FOUR_DAYS_IN_SECONDS;

        msg!("Vault registered for owner: {}", vault_state.owner);
        msg!("LP Mint created: {}", vault_state.lp_mint);
        msg!("Lock period: {} seconds (4 days)", vault_state.lock_period);
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::ZeroDeposit);

        let cpi_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.user.to_account_info(),
                to: ctx.accounts.vault_state.to_account_info(),
            },
        );
        system_program::transfer(cpi_ctx, amount)?;
        ctx.accounts.vault_state.balance += amount;

        msg!("Owner deposited: {} lamports", amount);
        msg!("New vault balance: {} lamports", ctx.accounts.vault_state.balance);
        Ok(())
    }

    pub fn register_depositor(ctx: Context<RegisterDepositor>) -> Result<()> {
        let depositor_state = &mut ctx.accounts.depositor_state;
        depositor_state.depositor = ctx.accounts.depositor.key();
        depositor_state.vault_owner = ctx.accounts.vault_state.owner;
        depositor_state.bump = ctx.bumps.depositor_state;
        depositor_state.deposit_time = 0;
        depositor_state.unlock_time = 0;
        depositor_state.locked_amount = 0;
        depositor_state.lp_amount = 0;

        msg!("Depositor registered: {}", depositor_state.depositor);
        msg!("Linked to vault owner: {}", depositor_state.vault_owner);
        Ok(())
    }

    pub fn deposit_by_depositor(ctx: Context<DepositByDepositor>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::ZeroDeposit);
        require!(amount % LP_PRICE_IN_LAMPORTS == 0, VaultError::InvalidDepositAmount);

        let cpi_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.depositor.to_account_info(),
                to: ctx.accounts.vault_state.to_account_info(),
            },
        );
        system_program::transfer(cpi_ctx, amount)?;

        let clock = Clock::get()?;
        let current_time = clock.unix_timestamp;
        let lock_period = ctx.accounts.vault_state.lock_period;
        let vault_owner = ctx.accounts.vault_state.owner;
        let lp_mint_bump = ctx.accounts.vault_state.lp_mint_bump;

        ctx.accounts.vault_state.balance += amount;

        let depositor_state = &mut ctx.accounts.depositor_state;
        depositor_state.deposit_time = current_time;
        depositor_state.unlock_time = current_time + lock_period;
        depositor_state.locked_amount += amount;

        let lp_to_mint = amount / LP_PRICE_IN_LAMPORTS;
        depositor_state.lp_amount += lp_to_mint;

        let seeds = &[b"lp_mint3", vault_owner.as_ref(), &[lp_mint_bump]];
        let signer_seeds = &[&seeds[..]];

        let mint_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.lp_mint.to_account_info(),
                to: ctx.accounts.depositor_token_account.to_account_info(),
                authority: ctx.accounts.lp_mint.to_account_info(),
            },
            signer_seeds,
        );
        token::mint_to(mint_ctx, lp_to_mint)?;

        msg!("Depositor sent: {} lamports", amount);
        msg!("LP tokens minted: {}", lp_to_mint);
        msg!("Deposit time: {}", current_time);
        msg!("Unlock time: {}", depositor_state.unlock_time);
        msg!("Locked for 4 days ({} seconds)", lock_period);
        msg!("New vault balance: {} lamports", ctx.accounts.vault_state.balance);
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
        let clock = Clock::get()?;
        let current_time = clock.unix_timestamp;
        let unlock_time = ctx.accounts.depositor_state.unlock_time;

        require!(current_time >= unlock_time, VaultError::FundsStillLocked);

        let locked_amount = ctx.accounts.depositor_state.locked_amount;
        let lp_amount = ctx.accounts.depositor_state.lp_amount;
        require!(locked_amount > 0, VaultError::NothingToWithdraw);

        let vault_owner = ctx.accounts.vault_state.owner;
        let lp_mint_bump = ctx.accounts.vault_state.lp_mint_bump;
        let seeds = &[b"lp_mint3", vault_owner.as_ref(), &[lp_mint_bump]];
        let signer_seeds = &[&seeds[..]];

        let burn_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.lp_mint.to_account_info(),
                from: ctx.accounts.depositor_token_account.to_account_info(),
                authority: ctx.accounts.lp_mint.to_account_info(),
            },
            signer_seeds,
        );
        token::burn(burn_ctx, lp_amount)?;

        **ctx.accounts.vault_state.to_account_info().try_borrow_mut_lamports()? -= locked_amount;
        **ctx.accounts.depositor.to_account_info().try_borrow_mut_lamports()? += locked_amount;

        ctx.accounts.vault_state.balance -= locked_amount;

        ctx.accounts.depositor_state.locked_amount = 0;
        ctx.accounts.depositor_state.lp_amount = 0;
        ctx.accounts.depositor_state.deposit_time = 0;
        ctx.accounts.depositor_state.unlock_time = 0;

        msg!("Withdrawal successful!");
        msg!("SOL returned: {} lamports", locked_amount);
        msg!("LP tokens burned: {}", lp_amount);
        msg!("New vault balance: {} lamports", ctx.accounts.vault_state.balance);
        Ok(())
    }

    pub fn get_lp_value(ctx: Context<GetLpValue>) -> Result<()> {
        let vault_balance = ctx.accounts.vault_state.balance;
        let lp_supply = ctx.accounts.lp_mint.supply;
        msg!("Vault SOL balance : {} lamports", vault_balance);
        msg!("Total LP supply   : {} tokens", lp_supply);
        msg!("1 LP = {} lamports (0.1 SOL)", LP_PRICE_IN_LAMPORTS);
        Ok(())
    }

    // ─────────────────────────────────────────
    // Admin Transfer — only vault owner
    // ─────────────────────────────────────────
    pub fn admin_transfer(ctx: Context<AdminTransfer>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::ZeroDeposit);
        require!(
            ctx.accounts.vault_state.balance >= amount,
            VaultError::NotEnoughFunds
        );

        **ctx.accounts.vault_state.to_account_info().try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.destination.to_account_info().try_borrow_mut_lamports()? += amount;

        ctx.accounts.vault_state.balance -= amount;

        msg!("Admin transfer by: {}", ctx.accounts.owner.key());
        msg!("Destination      : {}", ctx.accounts.destination.key());
        msg!("Amount           : {} lamports", amount);
        msg!("New vault balance: {} lamports", ctx.accounts.vault_state.balance);
        Ok(())
    }
}

// ─────────────────────────────────────────
// Account Contexts
// ─────────────────────────────────────────

#[derive(Accounts)]
pub struct Register<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        init,
        payer = user,
        space = VaultState::SIZE,
        seeds = [b"vault3", user.key().as_ref()],
        bump
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        init,
        payer = user,
        mint::decimals = 0,
        mint::authority = lp_mint,
        seeds = [b"lp_mint3", user.key().as_ref()],
        bump
    )]
    pub lp_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault3", user.key().as_ref()],
        bump = vault_state.bump,
        constraint = vault_state.owner == user.key() @ VaultError::UnauthorizedUser
    )]
    pub vault_state: Account<'info, VaultState>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RegisterDepositor<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,

    #[account(
        seeds = [b"vault3", vault_state.owner.as_ref()],
        bump = vault_state.bump,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        init,
        payer = depositor,
        space = DepositorState::SIZE,
        seeds = [b"depositor3", depositor.key().as_ref(), vault_state.owner.as_ref()],
        bump
    )]
    pub depositor_state: Account<'info, DepositorState>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositByDepositor<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,

    #[account(
        mut,
        seeds = [b"depositor3", depositor.key().as_ref(), vault_state.owner.as_ref()],
        bump = depositor_state.bump,
        constraint = depositor_state.depositor == depositor.key() @ VaultError::UnauthorizedUser,
        constraint = depositor_state.vault_owner == vault_state.owner @ VaultError::WrongVault,
    )]
    pub depositor_state: Account<'info, DepositorState>,

    #[account(
        mut,
        seeds = [b"vault3", vault_state.owner.as_ref()],
        bump = vault_state.bump,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        mut,
        seeds = [b"lp_mint3", vault_state.owner.as_ref()],
        bump = vault_state.lp_mint_bump,
    )]
    pub lp_mint: Account<'info, Mint>,

    #[account(mut)]
    pub depositor_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,

    #[account(
        mut,
        seeds = [b"depositor3", depositor.key().as_ref(), vault_state.owner.as_ref()],
        bump = depositor_state.bump,
        constraint = depositor_state.depositor == depositor.key() @ VaultError::UnauthorizedUser,
        constraint = depositor_state.vault_owner == vault_state.owner @ VaultError::WrongVault,
    )]
    pub depositor_state: Account<'info, DepositorState>,

    #[account(
        mut,
        seeds = [b"vault3", vault_state.owner.as_ref()],
        bump = vault_state.bump,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        mut,
        seeds = [b"lp_mint3", vault_state.owner.as_ref()],
        bump = vault_state.lp_mint_bump,
    )]
    pub lp_mint: Account<'info, Mint>,

    #[account(mut)]
    pub depositor_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct GetLpValue<'info> {
    #[account(
        seeds = [b"vault3", vault_state.owner.as_ref()],
        bump = vault_state.bump,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        seeds = [b"lp_mint3", vault_state.owner.as_ref()],
        bump = vault_state.lp_mint_bump,
    )]
    pub lp_mint: Account<'info, Mint>,
}

// ─────────────────────────────────────────
// Admin Transfer Context
// ─────────────────────────────────────────
#[derive(Accounts)]
pub struct AdminTransfer<'info> {
    #[account(
        mut,
        constraint = owner.key() == vault_state.owner @ VaultError::UnauthorizedUser
    )]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault3", owner.key().as_ref()],
        bump = vault_state.bump,
    )]
    pub vault_state: Account<'info, VaultState>,

    /// CHECK: destination can be any wallet
    #[account(mut)]
    pub destination: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

// ─────────────────────────────────────────
// State
// ─────────────────────────────────────────

#[account]
pub struct VaultState {
    pub owner: Pubkey,       // 32
    pub balance: u64,        // 8
    pub bump: u8,            // 1
    pub lp_mint: Pubkey,     // 32
    pub lp_mint_bump: u8,    // 1
    pub lock_period: i64,    // 8
}

impl VaultState {
    pub const SIZE: usize = 8 + 32 + 8 + 1 + 32 + 1 + 8;
}

#[account]
pub struct DepositorState {
    pub depositor: Pubkey,    // 32
    pub vault_owner: Pubkey,  // 32
    pub bump: u8,             // 1
    pub deposit_time: i64,    // 8
    pub unlock_time: i64,     // 8
    pub locked_amount: u64,   // 8
    pub lp_amount: u64,       // 8
}

impl DepositorState {
    pub const SIZE: usize = 8 + 32 + 32 + 1 + 8 + 8 + 8 + 8;
}

// ─────────────────────────────────────────
// Errors
// ─────────────────────────────────────────

#[error_code]
pub enum VaultError {
    #[msg("Deposit amount must be greater than zero")]
    ZeroDeposit,
    #[msg("You are not the owner of this vault")]
    UnauthorizedUser,
    #[msg("Depositor is not registered to this vault")]
    WrongVault,
    #[msg("Deposit must be a multiple of 0.1 SOL (100000000 lamports)")]
    InvalidDepositAmount,
    #[msg("Funds are still locked, please wait until unlock time")]
    FundsStillLocked,
    #[msg("Nothing to withdraw")]
    NothingToWithdraw,
    #[msg("Vault does not have enough funds")]
    NotEnoughFunds,
}