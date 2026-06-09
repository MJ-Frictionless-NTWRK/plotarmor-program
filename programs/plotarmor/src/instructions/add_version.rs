use anchor_lang::prelude::*;

use crate::error::PlotArmorError;
use crate::helpers::assert_mode_allowed;
use crate::modes::AnchoredObjectKind;
use crate::state::{AnchorRecord, ClaimArtifactLink, ContentArtifact, RegistryConfig, WorkClaim};

#[derive(Accounts)]
#[instruction(
    raw_hash: [u8; 32],
    content_kind: u8,
    link_nonce: [u8; 32],
    anchor_nonce: [u8; 32],
    anchor_mode_arg: u8,
    expected_previous_link: Pubkey,
)]
pub struct AddVersion<'info> {
    #[account(
        seeds = [b"config"],
        bump,
    )]
    pub registry_config: Account<'info, RegistryConfig>,

    #[account(
        mut,
        seeds = [b"claim", work_claim.root_artifact.as_ref(), work_claim.claimant.as_ref()],
        bump,
    )]
    pub work_claim: Account<'info, WorkClaim>,

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
        space = ClaimArtifactLink::LEN,
        seeds = [b"claim_artifact", work_claim.key().as_ref(), link_nonce.as_ref()],
        bump,
    )]
    pub claim_artifact_link: Account<'info, ClaimArtifactLink>,

    #[account(
        init,
        payer = signer,
        space = AnchorRecord::LEN,
        seeds = [b"anchor", content_artifact.key().as_ref(), anchor_nonce.as_ref()],
        bump,
    )]
    pub anchor_record: Account<'info, AnchorRecord>,

    #[account(mut)]
    pub signer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<AddVersion>,
    raw_hash: [u8; 32],
    content_kind: u8,
    _link_nonce: [u8; 32],
    _anchor_nonce: [u8; 32],
    anchor_mode_arg: u8,
    expected_previous_link: Pubkey,
) -> Result<()> {
    // 1. Validate anchor mode before any state changes.
    assert_mode_allowed(anchor_mode_arg, &ctx.accounts.registry_config)?;

    // 2. Reject if paused.
    require!(!ctx.accounts.registry_config.paused, PlotArmorError::Paused);

    // 3. Signer must be the registered claimant.
    require!(
        ctx.accounts.signer.key() == ctx.accounts.work_claim.claimant,
        PlotArmorError::Unauthorized
    );

    // 4. Anti-fork check: client must hold the current lineage head.
    //    Validates against latest_link, NOT latest_artifact, to prevent a silent fork
    //    if a version-add transaction reverts after the link account was created.
    require!(
        ctx.accounts.work_claim.latest_link == expected_previous_link,
        PlotArmorError::StaleLineageHead
    );

    let now = Clock::get()?.unix_timestamp;

    let content_artifact_key = ctx.accounts.content_artifact.key();
    let work_claim_key = ctx.accounts.work_claim.key();
    let claim_artifact_link_key = ctx.accounts.claim_artifact_link.key();

    // 5. ContentArtifact init_if_needed guard — write fields exactly once.
    //    The same hash may legitimately reappear in the chain (revert / intentional reuse).
    if !ctx.accounts.content_artifact.is_initialized {
        ctx.accounts.content_artifact.is_initialized = true;
        ctx.accounts.content_artifact.raw_hash = raw_hash;
        ctx.accounts.content_artifact.content_kind = content_kind;
        ctx.accounts.content_artifact.created_at = now;
    }

    // 6. ClaimArtifactLink — previous_link records the head this link extends.
    ctx.accounts.claim_artifact_link.work_claim = work_claim_key;
    ctx.accounts.claim_artifact_link.content_artifact = content_artifact_key;
    ctx.accounts.claim_artifact_link.previous_link = expected_previous_link;
    ctx.accounts.claim_artifact_link.created_at = now;

    // 7. AnchorRecord for this version-add event.
    ctx.accounts.anchor_record.anchored_object = content_artifact_key;
    ctx.accounts.anchor_record.anchored_object_kind = AnchoredObjectKind::ContentArtifact as u8;
    ctx.accounts.anchor_record.anchor_mode = anchor_mode_arg;
    ctx.accounts.anchor_record.created_at = now;
    ctx.accounts.anchor_record.external_ref_hash = [0u8; 32];

    // 8. Advance both WorkClaim heads atomically — never update one without the other.
    ctx.accounts.work_claim.latest_artifact = content_artifact_key;
    ctx.accounts.work_claim.latest_link = claim_artifact_link_key;

    Ok(())
}
