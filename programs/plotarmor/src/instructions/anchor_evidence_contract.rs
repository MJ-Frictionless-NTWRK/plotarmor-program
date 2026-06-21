use anchor_lang::prelude::*;

use crate::error::PlotArmorError;
use crate::helpers::assert_mode_allowed;
use crate::modes::{AnchoredObjectKind, ContractKind};
use crate::state::{AnchorRecord, ContractArtifact, EvidenceAnchor, RegistryConfig};

#[derive(Accounts)]
#[instruction(
    raw_contract_hash: [u8; 32],
    contract_kind: u8,
    anchor_nonce: [u8; 32],
    anchor_mode_arg: u8,
    asserted_work_claim: Pubkey,
)]
pub struct AnchorEvidenceContract<'info> {
    #[account(
        seeds = [b"config"],
        bump,
    )]
    pub registry_config: Account<'info, RegistryConfig>,

    #[account(
        init_if_needed,
        payer = anchorer,
        space = ContractArtifact::LEN,
        seeds = [b"contract_artifact", raw_contract_hash.as_ref()],
        bump,
    )]
    pub contract_artifact: Account<'info, ContractArtifact>,

    #[account(
        init,
        payer = anchorer,
        space = EvidenceAnchor::LEN,
        seeds = [b"evidence", anchorer.key().as_ref(), contract_artifact.key().as_ref()],
        bump,
    )]
    pub evidence_anchor: Account<'info, EvidenceAnchor>,

    #[account(
        init,
        payer = anchorer,
        space = AnchorRecord::LEN,
        seeds = [b"anchor", evidence_anchor.key().as_ref(), anchor_nonce.as_ref()],
        bump,
    )]
    pub anchor_record: Account<'info, AnchorRecord>,

    #[account(mut)]
    pub anchorer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<AnchorEvidenceContract>,
    raw_contract_hash: [u8; 32],
    contract_kind: u8,
    _anchor_nonce: [u8; 32],
    anchor_mode_arg: u8,
    asserted_work_claim: Pubkey,
    external_ref_hash: [u8; 32],
) -> Result<()> {
    // 1. Validate anchor mode before any state changes.
    assert_mode_allowed(anchor_mode_arg, &ctx.accounts.registry_config)?;

    // 2. Reject if paused.
    require!(!ctx.accounts.registry_config.paused, PlotArmorError::Paused);

    // Validate contract_kind is a known value.
    ContractKind::from_u8(contract_kind)
        .map_err(|_| error!(PlotArmorError::AnchorModeNotAllowed))?;

    let now = Clock::get()?.unix_timestamp;

    let contract_artifact_key = ctx.accounts.contract_artifact.key();
    let evidence_anchor_key = ctx.accounts.evidence_anchor.key();

    // 3. ContractArtifact init_if_needed guard — write fields exactly once.
    //    A second call with the same hash is a no-op; the first registration's
    //    existence fact is immutable. is_initialized is never cleared.
    if !ctx.accounts.contract_artifact.is_initialized {
        ctx.accounts.contract_artifact.is_initialized = true;
        ctx.accounts.contract_artifact.raw_hash = raw_contract_hash;
        ctx.accounts.contract_artifact.content_kind = contract_kind;
        ctx.accounts.contract_artifact.created_at = now;
    }

    // 4. EvidenceAnchor — unilateral; asserted_work_claim is a client assertion,
    //    zero pubkey is allowed, and the program performs no validation on it.
    ctx.accounts.evidence_anchor.anchorer = ctx.accounts.anchorer.key();
    ctx.accounts.evidence_anchor.contract_artifact = contract_artifact_key;
    ctx.accounts.evidence_anchor.asserted_work_claim = asserted_work_claim;
    ctx.accounts.evidence_anchor.timestamp = now;

    // 5. AnchorRecord for this evidence-anchor event.
    ctx.accounts.anchor_record.anchored_object = evidence_anchor_key;
    ctx.accounts.anchor_record.anchored_object_kind = AnchoredObjectKind::EvidenceAnchor as u8;
    ctx.accounts.anchor_record.anchor_mode = anchor_mode_arg;
    ctx.accounts.anchor_record.created_at = now;
    ctx.accounts.anchor_record.external_ref_hash = external_ref_hash;

    Ok(())
}
