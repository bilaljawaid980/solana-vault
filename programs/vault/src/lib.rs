
use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount};

declare_id!("DmvnbCoGjvP8zfEZeBkrHft2EMQpkjuQ4wZq1AFt7dEL");

const LP_PRICE_IN_LAMPORTS: u64 = 100_000_000;

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
        msg!("Vault registered for owner: {}", vault_state.owner);
        msg!("LP Mint created: {}", vault_state.lp_mint);
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

        let vault_owner = ctx.accounts.vault_state.owner;
        let lp_mint_bump = ctx.accounts.vault_state.lp_mint_bump;
        ctx.accounts.vault_state.balance += amount;

        let lp_to_mint = amount / LP_PRICE_IN_LAMPORTS;

        let seeds = &[b"lp_mint2", vault_owner.as_ref(), &[lp_mint_bump]];
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
        seeds = [b"vault2", user.key().as_ref()],
        bump
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        init,
        payer = user,
        mint::decimals = 0,
        mint::authority = lp_mint,
        seeds = [b"lp_mint2", user.key().as_ref()],
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
        seeds = [b"vault2", user.key().as_ref()],
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
        seeds = [b"vault2", vault_state.owner.as_ref()],
        bump = vault_state.bump,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        init,
        payer = depositor,
        space = DepositorState::SIZE,
        seeds = [b"depositor2", depositor.key().as_ref(), vault_state.owner.as_ref()],
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
        seeds = [b"depositor2", depositor.key().as_ref(), vault_state.owner.as_ref()],
        bump = depositor_state.bump,
        constraint = depositor_state.depositor == depositor.key() @ VaultError::UnauthorizedUser,
        constraint = depositor_state.vault_owner == vault_state.owner @ VaultError::WrongVault,
    )]
    pub depositor_state: Account<'info, DepositorState>,

    #[account(
        mut,
        seeds = [b"vault2", vault_state.owner.as_ref()],
        bump = vault_state.bump,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        mut,
        seeds = [b"lp_mint2", vault_state.owner.as_ref()],
        bump = vault_state.lp_mint_bump,
    )]
    pub lp_mint: Account<'info, Mint>,

    // ✅ FIXED: just mut, token account already created before calling this instruction
    #[account(mut)]
    pub depositor_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct GetLpValue<'info> {
    #[account(
        seeds = [b"vault2", vault_state.owner.as_ref()],
        bump = vault_state.bump,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        seeds = [b"lp_mint2", vault_state.owner.as_ref()],
        bump = vault_state.lp_mint_bump,
    )]
    pub lp_mint: Account<'info, Mint>,
}

// ─────────────────────────────────────────
// State
// ─────────────────────────────────────────

#[account]
pub struct VaultState {
    pub owner: Pubkey,
    pub balance: u64,
    pub bump: u8,
    pub lp_mint: Pubkey,
    pub lp_mint_bump: u8,
}

impl VaultState {
    pub const SIZE: usize = 8 + 32 + 8 + 1 + 32 + 1;
}

#[account]
pub struct DepositorState {
    pub depositor: Pubkey,
    pub vault_owner: Pubkey,
    pub bump: u8,
}

impl DepositorState {
    pub const SIZE: usize = 8 + 32 + 32 + 1;
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
}