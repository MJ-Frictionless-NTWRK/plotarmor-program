use anchor_lang::prelude::*;

use crate::error::PlotArmorError;
use crate::helpers::assert_mode_allowed;
use crate::modes::{AnchoredObjectKind, ContractKind};
use crate::state::{
    AnchorRecord, AuthorizedContractAnchor, ContractArtifact, Ownership, RegistryConfig, WorkClaim,
};

#[derive(Accounts)]
#[instruction(
    raw_contract_hash: [u8; 32],
    contract_kind: u8,
    anchor_nonce: [u8; 32],
    anchor_mode_arg: u8,
)]
pub struct AnchorAuthorizedContract<'info> {
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
        seeds = [b"ownership", work_claim.key().as_ref()],
        bump,
    )]
    pub ownership: Account<'info, Ownership>,

    #[account(
        init_if_needed,
        payer = admin,
        space = ContractArtifact::LEN,
        seeds = [b"contract_artifact", raw_contract_hash.as_ref()],
        bump,
    )]
    pub contract_artifact: Account<'info, ContractArtifact>,

    #[account(
        init,
        payer = admin,
        space = AuthorizedContractAnchor::LEN,
        seeds = [b"authorized_contract", work_claim.key().as_ref(), contract_artifact.key().as_ref()],
        bump,
    )]
    pub authorized_contract_anchor: Account<'info, AuthorizedContractAnchor>,

    #[account(
        init,
        payer = admin,
        space = AnchorRecord::LEN,
        seeds = [b"anchor", authorized_contract_anchor.key().as_ref(), anchor_nonce.as_ref()],
        bump,
    )]
    pub anchor_record: Account<'info, AnchorRecord>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<AnchorAuthorizedContract>,
    raw_contract_hash: [u8; 32],
    contract_kind: u8,
    _anchor_nonce: [u8; 32],
    anchor_mode_arg: u8,
    external_ref_hash: [u8; 32],
) -> Result<()> {
    // 1. Validate anchor mode before any state changes.
    assert_mode_allowed(anchor_mode_arg, &ctx.accounts.registry_config)?;

    // 2. Reject if paused.
    require!(!ctx.accounts.registry_config.paused, PlotArmorError::Paused);

    // 3. Admin must match the Ownership's governance authority.
    require!(
        ctx.accounts.admin.key() == ctx.accounts.ownership.admin,
        PlotArmorError::Unauthorized
    );

    // Validate contract_kind is a known value.
    ContractKind::from_u8(contract_kind)
        .map_err(|_| error!(PlotArmorError::AnchorModeNotAllowed))?;

    let now = Clock::get()?.unix_timestamp;

    let work_claim_key = ctx.accounts.work_claim.key();
    let contract_artifact_key = ctx.accounts.contract_artifact.key();
    let authorized_contract_anchor_key = ctx.accounts.authorized_contract_anchor.key();

    // 4. ContractArtifact init_if_needed guard — write fields exactly once.
    //    Two callers submitting the same contract bytes simultaneously both succeed;
    //    the first writer initializes the account, the second observes
    //    is_initialized == true and skips all writes. is_initialized is never cleared.
    if !ctx.accounts.contract_artifact.is_initialized {
        ctx.accounts.contract_artifact.is_initialized = true;
        ctx.accounts.contract_artifact.raw_hash = raw_contract_hash;
        ctx.accounts.contract_artifact.content_kind = contract_kind;
        ctx.accounts.contract_artifact.created_at = now;
    }

    // 5. AuthorizedContractAnchor — threshold-governed; PDA collision prevents a
    //    second authorized anchor for the same (WorkClaim, ContractArtifact) pair.
    ctx.accounts.authorized_contract_anchor.work_claim = work_claim_key;
    ctx.accounts.authorized_contract_anchor.contract_artifact = contract_artifact_key;
    ctx.accounts.authorized_contract_anchor.timestamp = now;

    // 6. AnchorRecord for this authorized-anchor event.
    ctx.accounts.anchor_record.anchored_object = authorized_contract_anchor_key;
    ctx.accounts.anchor_record.anchored_object_kind =
        AnchoredObjectKind::AuthorizedContractAnchor as u8;
    ctx.accounts.anchor_record.anchor_mode = anchor_mode_arg;
    ctx.accounts.anchor_record.created_at = now;
    ctx.accounts.anchor_record.external_ref_hash = external_ref_hash;

    Ok(())
}
