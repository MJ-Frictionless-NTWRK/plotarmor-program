pub mod constants;
pub mod error;
pub mod helpers;
pub mod instructions;
pub mod modes;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
#[allow(unused_imports)]
use instructions::add_version::__client_accounts_add_version;
pub use instructions::AddVersion;
#[allow(unused_imports)]
use instructions::init_registry_config::__client_accounts_init_registry_config;
pub use instructions::InitRegistryConfig;
#[allow(unused_imports)]
use instructions::register_work_claim::__client_accounts_register_work_claim;
pub use instructions::RegisterWorkClaim;
pub use state::*;

declare_id!("HSU9d7nCkGNWmBSCmwWpTHBZCHiNFhwFC4e9M2jWFFCm");

#[program]
pub mod plotarmor {
    use super::*;

    pub fn init_registry_config(ctx: Context<InitRegistryConfig>) -> Result<()> {
        instructions::init_registry_config::handler(ctx)
    }

    pub fn add_version(
        ctx: Context<AddVersion>,
        raw_hash: [u8; 32],
        content_kind: u8,
        link_nonce: [u8; 32],
        anchor_nonce: [u8; 32],
        anchor_mode_arg: u8,
        expected_previous_link: Pubkey,
    ) -> Result<()> {
        instructions::add_version::handler(
            ctx,
            raw_hash,
            content_kind,
            link_nonce,
            anchor_nonce,
            anchor_mode_arg,
            expected_previous_link,
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
        )
    }
}
