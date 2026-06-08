use anchor_lang::prelude::*;

use crate::error::PlotArmorError;
use crate::helpers::assert_mode_allowed;
use crate::state::{
    AnchorRecord, ClaimArtifactLink, ContentArtifact, Ownership, OwnerRecord, RegistryConfig,
    WorkClaim,
};

#[derive(Accounts)]
#[instruction(
    raw_hash: [u8; 32],
    content_kind: u8,
    claim_kind: u8,
    total_shares: u16,
    threshold_shares: u16,
    link_nonce: [u8; 32],
    anchor_nonce: [u8; 32],
    anchor_mode_arg: u8
)]
pub struct RegisterWorkClaim<'info> {
    #[account(
        seeds = [b"config"],
        bump,
    )]
    pub registry_config: Account<'info, RegistryConfig>,

    #[account(
        init_if_needed,
        payer = signer,
        space = ContentArtifact::LEN,
        seeds = [b"content", raw_hash.as_ref()],
        bump,
    )]
    pub content_artifact: Account<'info, ContentArtifact>,

    #[account(
        init,
        payer = signer,
        space = WorkClaim::LEN,
        seeds = [b"claim", content_artifact.key().as_ref(), signer.key().as_ref()],
        bump,
    )]
    pub work_claim: Account<'info, WorkClaim>,

    #[account(
        init,
        payer = signer,
        space = Ownership::LEN,
        seeds = [b"ownership", work_claim.key().as_ref()],
        bump,
    )]
    pub ownership: Account<'info, Ownership>,

    #[account(
        init,
        payer = signer,
        space = OwnerRecord::LEN,
        seeds = [b"owner", ownership.key().as_ref(), signer.key().as_ref()],
        bump,
    )]
    pub owner_record: Account<'info, OwnerRecord>,

    #[account(
        init,
        payer = signer,
        space = ClaimArtifactLink::LEN,
        seeds = [b"claim_artifact", work_claim.key().as_ref(), link_nonce.as_ref()],
        bump,
    )]
    pub claim_artifact_link: Account<'info, ClaimArtifactLink>,

    #[account(
        init,
        payer = signer,
        space = AnchorRecord::LEN,
        seeds = [b"anchor", work_claim.key().as_ref(), anchor_nonce.as_ref()],
        bump,
    )]
    pub anchor_record: Account<'info, AnchorRecord>,

    #[account(mut)]
    pub signer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<RegisterWorkClaim>,
    raw_hash: [u8; 32],
    content_kind: u8,
    claim_kind: u8,
    total_shares: u16,
    threshold_shares: u16,
    _link_nonce: [u8; 32],
    _anchor_nonce: [u8; 32],
    anchor_mode_arg: u8,
) -> Result<()> {
    // 1. Validate anchor mode before any state changes.
    assert_mode_allowed(anchor_mode_arg, &ctx.accounts.registry_config)?;

    // 2. Reject if paused.
    require!(!ctx.accounts.registry_config.paused, PlotArmorError::Paused);

    // 3. Validate share parameters.
    require!(
        total_shares > 0 && threshold_shares > 0 && threshold_shares <= total_shares,
        PlotArmorError::ShareSumMismatch
    );

    let now = Clock::get()?.unix_timestamp;

    // Pre-compute keys before any mutable borrows.
    let signer_key = ctx.accounts.signer.key();
    let content_artifact_key = ctx.accounts.content_artifact.key();
    let work_claim_key = ctx.accounts.work_claim.key();
    let ownership_key = ctx.accounts.ownership.key();
    let claim_artifact_link_key = ctx.accounts.claim_artifact_link.key();

    // 4. ContentArtifact init_if_needed guard — write fields exactly once.
    if !ctx.accounts.content_artifact.is_initialized {
        ctx.accounts.content_artifact.is_initialized = true;
        ctx.accounts.content_artifact.raw_hash = raw_hash;
        ctx.accounts.content_artifact.content_kind = content_kind;
        ctx.accounts.content_artifact.created_at = now;
    }

    // 5. WorkClaim — latest_link set to default here, updated in step 8.
    ctx.accounts.work_claim.root_artifact = content_artifact_key;
    ctx.accounts.work_claim.latest_artifact = content_artifact_key;
    ctx.accounts.work_claim.latest_link = Pubkey::default();
    ctx.accounts.work_claim.claimant = signer_key;
    ctx.accounts.work_claim.ownership = ownership_key;
    ctx.accounts.work_claim.created_at = now;
    ctx.accounts.work_claim.claim_kind = claim_kind;
    ctx.accounts.work_claim.discoverability = 0;
    ctx.accounts.work_claim.superseded_by = Pubkey::default();

    // 6. Ownership.
    ctx.accounts.ownership.work_claim = work_claim_key;
    ctx.accounts.ownership.total_shares = total_shares;
    ctx.accounts.ownership.threshold_shares = threshold_shares;
    ctx.accounts.ownership.admin = signer_key;
    ctx.accounts.ownership.rules_version = 0;
    ctx.accounts.ownership.privacy_mode = 0;
    ctx.accounts.ownership.commitment_root = [0u8; 32];

    // 7. OwnerRecord — sole initial owner receives all shares.
    ctx.accounts.owner_record.ownership = ownership_key;
    ctx.accounts.owner_record.owner = signer_key;
    ctx.accounts.owner_record.share = total_shares;
    ctx.accounts.owner_record.role = 0;

    // 8. ClaimArtifactLink (root link: previous_link = zero), then update latest_link.
    ctx.accounts.claim_artifact_link.work_claim = work_claim_key;
    ctx.accounts.claim_artifact_link.content_artifact = content_artifact_key;
    ctx.accounts.claim_artifact_link.previous_link = Pubkey::default();
    ctx.accounts.claim_artifact_link.created_at = now;
    ctx.accounts.work_claim.latest_link = claim_artifact_link_key;

    // 9. AnchorRecord for the WorkClaim registration event only.
    ctx.accounts.anchor_record.anchored_object = work_claim_key;
    ctx.accounts.anchor_record.anchored_object_kind = 0; // WorkClaim
    ctx.accounts.anchor_record.anchor_mode = anchor_mode_arg;
    ctx.accounts.anchor_record.created_at = now;
    ctx.accounts.anchor_record.external_ref_hash = [0u8; 32];

    Ok(())
}
