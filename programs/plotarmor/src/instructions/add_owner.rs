use anchor_lang::prelude::*;

use crate::error::PlotArmorError;
use crate::modes::OwnerRole;
use crate::state::{Ownership, OwnerRecord, RegistryConfig, WorkClaim};

#[derive(Accounts)]
pub struct AddOwner<'info> {
    #[account(
        seeds = [b"config"],
        bump,
    )]
    pub registry_config: Account<'info, RegistryConfig>,

    #[account(
        seeds = [b"claim", work_claim.root_artifact.as_ref(), work_claim.claimant.as_ref()],
        bump,
    )]
    pub work_claim: Account<'info, WorkClaim>,

    #[account(
        mut,
        seeds = [b"ownership", work_claim.key().as_ref()],
        bump,
        has_one = admin @ PlotArmorError::Unauthorized,
    )]
    pub ownership: Account<'info, Ownership>,

    #[account(
        init,
        payer = admin,
        space = OwnerRecord::LEN,
        seeds = [b"owner", ownership.key().as_ref(), new_owner.key().as_ref()],
        bump,
    )]
    pub new_owner_record: Account<'info, OwnerRecord>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub new_owner: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<AddOwner>,
    new_share: u16,
    new_role: u8,
    new_threshold_shares: u16,
) -> Result<()> {
    // 1. Reject if paused.
    require!(!ctx.accounts.registry_config.paused, PlotArmorError::Paused);

    // 2. new_share must be positive; zero-share owners are not meaningful records.
    require!(new_share > 0, PlotArmorError::ShareSumMismatch);

    // Validate new_role is a known value.
    OwnerRole::from_u8(new_role)
        .map_err(|_| error!(PlotArmorError::AnchorModeNotAllowed))?;

    // 3. Checked add to satisfy invariant C.5: sum(OwnerRecord.share) == total_shares.
    let new_total = ctx
        .accounts
        .ownership
        .total_shares
        .checked_add(new_share)
        .ok_or(error!(PlotArmorError::ShareOverflow))?;

    // 4. Validate proposed threshold: positive and no greater than new total.
    require!(
        new_threshold_shares > 0 && new_threshold_shares <= new_total,
        PlotArmorError::ShareSumMismatch
    );

    let ownership_key = ctx.accounts.ownership.key();

    // 5. Write OwnerRecord for the incoming co-owner.
    ctx.accounts.new_owner_record.ownership = ownership_key;
    ctx.accounts.new_owner_record.owner = ctx.accounts.new_owner.key();
    ctx.accounts.new_owner_record.share = new_share;
    ctx.accounts.new_owner_record.role = new_role;

    // 6. Update Ownership totals atomically — both fields written together so the
    //    invariant holds even if a future reader observes only partial state.
    ctx.accounts.ownership.total_shares = new_total;
    ctx.accounts.ownership.threshold_shares = new_threshold_shares;

    Ok(())
}
