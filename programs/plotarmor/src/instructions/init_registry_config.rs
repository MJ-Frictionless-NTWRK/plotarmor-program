use anchor_lang::prelude::*;

use crate::error::PlotArmorError;
use crate::program::Plotarmor;
use crate::state::RegistryConfig;

#[derive(Accounts)]
pub struct InitRegistryConfig<'info> {
    #[account(
        init,
        payer = signer,
        space = RegistryConfig::LEN,
        seeds = [b"config"],
        bump,
    )]
    pub registry_config: Account<'info, RegistryConfig>,
    #[account(mut)]
    pub signer: Signer<'info>,
    pub system_program: Program<'info, System>,
    #[account(
        constraint = program.programdata_address()? == Some(program_data.key()) @ PlotArmorError::Unauthorized,
    )]
    pub program: Program<'info, Plotarmor>,
    #[account(
        constraint = program_data.upgrade_authority_address == Some(signer.key()) @ PlotArmorError::Unauthorized,
    )]
    pub program_data: Account<'info, ProgramData>,
}

pub fn handler(ctx: Context<InitRegistryConfig>) -> Result<()> {
    let config = &mut ctx.accounts.registry_config;
    config.authority = ctx.accounts.signer.key();
    config.schema_version = 1;
    config.enabled_anchor_modes = 0;
    config.paused = false;
    Ok(())
}
