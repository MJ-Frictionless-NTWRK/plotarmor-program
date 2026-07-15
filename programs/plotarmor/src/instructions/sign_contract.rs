use anchor_lang::prelude::*;

use crate::error::PlotArmorError;
use crate::state::{ContractArtifact, ContractSignature};

#[derive(Accounts)]
#[instruction(content_hash: [u8; 32])]
pub struct SignContract<'info> {
    // The contract being signed. Must already exist on-chain; ContractArtifact
    // is never init'd here (sign_contract does not stand alone -- see spec §Design decisions #3).
    // Seeds re-derived from the account's OWN stored raw_hash (not the client's
    // content_hash arg) -- same pattern as work_claim in anchor_authorized_contract.rs
    // and add_owner.rs. This proves the passed account is a canonically-addressed
    // ContractArtifact, independent of and in addition to the handler's separate
    // content_hash == raw_hash check below (which stays the reachable source of
    // the custom ContentHashMismatch error; deriving seeds from content_hash
    // instead would make that error unreachable, replaced by a generic
    // Anchor ConstraintSeeds failure).
    #[account(
        seeds = [b"contract_artifact", contract_artifact.raw_hash.as_ref()],
        bump,
    )]
    pub contract_artifact: Account<'info, ContractArtifact>,

    // One signature PDA per (contract, signer) pair. `init`, not `init_if_needed`:
    // a repeat signer hits the account-already-exists error, which is the
    // correct anti-double-sign behavior (idempotent, no silent overwrite).
    #[account(
        init,
        payer = signer,
        space = ContractSignature::LEN,
        seeds = [b"signature", contract_artifact.key().as_ref(), signer.key().as_ref()],
        bump,
    )]
    pub contract_signature: Account<'info, ContractSignature>,

    #[account(mut)]
    pub signer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

// MVP creator-only authorization is intentionally NOT enforced on-chain here.
// ContractArtifact (state.rs) carries no creator/authority field -- it is
// content-addressed and shared, so any signer's first call to
// anchor_evidence_contract/anchor_authorized_contract may have initialized it.
// The only program-checked identity link to a contract is
// AuthorizedContractAnchor.work_claim -> Ownership.admin, which records "who
// authorized anchoring this hash," not "who is a party to this contract," and
// is not guaranteed to exist for every ContractArtifact (anchor_evidence_contract
// requires no such link at all). Building a real on-chain creator/party check
// would mean adding that representation to ContractArtifact first -- out of
// scope for this MVP pass (decision: Option 2, locked by Milan, see
// sign_contract-spec.md "Open question"). Consequently `signer` may be any
// funded wallet; creator/party restriction is enforced off-chain only
// (Supabase/RLS, gating which wallet the frontend will even prompt to sign).
// A ContractSignature therefore proves "this wallet signed this exact content
// hash at this on-chain time" -- not "the contract's creator signed." Do not
// describe it as on-chain proof of *who* in UI or docs.
pub fn handler(
    ctx: Context<SignContract>,
    content_hash: [u8; 32],
) -> Result<()> {
    require!(
        content_hash == ctx.accounts.contract_artifact.raw_hash,
        PlotArmorError::ContentHashMismatch
    );

    let clock = Clock::get()?;

    ctx.accounts.contract_signature.contract_artifact = ctx.accounts.contract_artifact.key();
    ctx.accounts.contract_signature.signer = ctx.accounts.signer.key();
    ctx.accounts.contract_signature.content_hash = content_hash;
    ctx.accounts.contract_signature.signed_at = clock.unix_timestamp;
    ctx.accounts.contract_signature.slot = clock.slot;
    ctx.accounts.contract_signature.bump = ctx.bumps.contract_signature;

    Ok(())
}
