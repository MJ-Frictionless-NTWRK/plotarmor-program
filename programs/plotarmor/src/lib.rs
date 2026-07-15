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
