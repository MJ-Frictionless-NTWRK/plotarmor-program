pub mod constants;
pub mod error;
pub mod helpers;
pub mod instructions;
pub mod modes;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
#[allow(unused_imports)]
use instructions::add_owner::__client_accounts_add_owner;
pub use instructions::AddOwner;
#[allow(unused_imports)]
use instructions::anchor_authorized_contract::__client_accounts_anchor_authorized_contract;
pub use instructions::AnchorAuthorizedContract;
#[allow(unused_imports)]
use instructions::anchor_evidence_contract::__client_accounts_anchor_evidence_contract;
pub use instructions::AnchorEvidenceContract;
#[allow(unused_imports)]
use instructions::add_version::__client_accounts_add_version;
pub use instructions::AddVersion;
#[allow(unused_imports)]
use instructions::init_registry_config::__client_accounts_init_registry_config;
pub use instructions::InitRegistryConfig;
#[allow(unused_imports)]
use instructions::register_work_claim::__client_accounts_register_work_claim;
pub use instructions::RegisterWorkClaim;
#[allow(unused_imports)]
use instructions::sign_contract::__client_accounts_sign_contract;
pub use instructions::SignContract;
pub use state::*;

// on-chain security.txt (solana-security-txt 1.1.3). Embedded in .rodata only;
// adds no code. Gated off for the no-entrypoint build so dependent crates that
// pull this program in as a library do not inherit a second copy of the blob.
//
// WARNING: contacts and policy below are UNRESOLVED PLACEHOLDERS. They are
// deliberately set to values that cannot resolve (RFC 2606 .invalid TLD) so that
// any attempt to deploy this binary fails review rather than shipping a security
// contact that nobody reads. Do NOT deploy until Milan supplies both values.
// project_url and source_code are intentionally "private" while the source
// repository is private. Per the approved scope, source_revision, source_release
// and auditors are omitted rather than filled with provisional values.
#[cfg(not(feature = "no-entrypoint"))]
use solana_security_txt::security_txt;

#[cfg(not(feature = "no-entrypoint"))]
security_txt! {
    name: "PlotArmor",
    project_url: "private",
    contacts: "email:UNSET-PLACEHOLDER-DO-NOT-DEPLOY@example.invalid",
    policy: "UNSET-PLACEHOLDER-DO-NOT-DEPLOY",
    source_code: "private"
}

declare_id!("3h9CzV9MJDeD5yjhVhdE6cupuXVRnLW1Cu6P14EJBKv2");

#[program]
pub mod plotarmor {
    use super::*;

    pub fn init_registry_config(ctx: Context<InitRegistryConfig>) -> Result<()> {
        instructions::init_registry_config::handler(ctx)
    }

    pub fn add_owner(
        ctx: Context<AddOwner>,
        new_share: u16,
        new_role: u8,
        new_threshold_shares: u16,
    ) -> Result<()> {
        instructions::add_owner::handler(ctx, new_share, new_role, new_threshold_shares)
    }

    pub fn anchor_authorized_contract(
        ctx: Context<AnchorAuthorizedContract>,
        raw_contract_hash: [u8; 32],
        contract_kind: u8,
        anchor_nonce: [u8; 32],
        anchor_mode_arg: u8,
        external_ref_hash: [u8; 32],
    ) -> Result<()> {
        instructions::anchor_authorized_contract::handler(
            ctx,
            raw_contract_hash,
            contract_kind,
            anchor_nonce,
            anchor_mode_arg,
            external_ref_hash,
        )
    }

    pub fn anchor_evidence_contract(
        ctx: Context<AnchorEvidenceContract>,
        raw_contract_hash: [u8; 32],
        contract_kind: u8,
        anchor_nonce: [u8; 32],
        anchor_mode_arg: u8,
        asserted_work_claim: Pubkey,
        external_ref_hash: [u8; 32],
    ) -> Result<()> {
        instructions::anchor_evidence_contract::handler(
            ctx,
            raw_contract_hash,
            contract_kind,
            anchor_nonce,
            anchor_mode_arg,
            asserted_work_claim,
            external_ref_hash,
        )
    }

    pub fn add_version(
        ctx: Context<AddVersion>,
        raw_hash: [u8; 32],
        content_kind: u8,
        link_nonce: [u8; 32],
        anchor_nonce: [u8; 32],
        anchor_mode_arg: u8,
        expected_previous_link: Pubkey,
        external_ref_hash: [u8; 32],
    ) -> Result<()> {
        instructions::add_version::handler(
            ctx,
            raw_hash,
            content_kind,
            link_nonce,
            anchor_nonce,
            anchor_mode_arg,
            expected_previous_link,
            external_ref_hash,
        )
    }

    pub fn register_work_claim(
        ctx: Context<RegisterWorkClaim>,
        raw_hash: [u8; 32],
        content_kind: u8,
        claim_kind: u8,
        total_shares: u16,
        threshold_shares: u16,
        link_nonce: [u8; 32],
        anchor_nonce: [u8; 32],
        anchor_mode_arg: u8,
        external_ref_hash: [u8; 32],
    ) -> Result<()> {
        instructions::register_work_claim::handler(
            ctx,
            raw_hash,
            content_kind,
            claim_kind,
            total_shares,
            threshold_shares,
            link_nonce,
            anchor_nonce,
            anchor_mode_arg,
            external_ref_hash,
        )
    }

    pub fn sign_contract(
        ctx: Context<SignContract>,
        content_hash: [u8; 32],
    ) -> Result<()> {
        instructions::sign_contract::handler(ctx, content_hash)
    }
}
