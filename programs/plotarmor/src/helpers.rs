use anchor_lang::prelude::*;

use crate::error::PlotArmorError;
use crate::modes::AnchorMode;
use crate::state::RegistryConfig;

// Called first in every anchor-creating handler.
// On mainnet builds (feature = "mainnet"), Simulated is hardcoded-rejected in compiled code,
// not via any mutable config account. RegistryConfig gates only UserSigned and MultiParty.
pub fn assert_mode_allowed(anchor_mode_arg: u8, registry_config: &RegistryConfig) -> Result<()> {
    let mode = AnchorMode::from_u8(anchor_mode_arg)
        .map_err(|_| error!(PlotArmorError::AnchorModeNotAllowed))?;

    #[cfg(feature = "mainnet")]
    require!(mode != AnchorMode::Simulated, PlotArmorError::SimulatedModeRejected);

    // Symmetric environment gate: a build compiled for one network must not
    // accept an anchor_mode_arg asserting the other network's attestation.
    // Decided 2026-07-03 in Claude Chat (Option 1): extend the existing
    // feature-gated rejection pattern rather than leaving this caller-controlled.
    #[cfg(feature = "mainnet")]
    require!(
        mode != AnchorMode::AttestedDevnet,
        PlotArmorError::AnchorModeNotAllowed
    );
    #[cfg(not(feature = "mainnet"))]
    require!(
        mode != AnchorMode::AttestedMainnet,
        PlotArmorError::AnchorModeNotAllowed
    );

    match mode {
        AnchorMode::UserSigned => {
            require!(
                registry_config.enabled_anchor_modes & (1u16 << 0) != 0,
                PlotArmorError::AnchorModeNotAllowed
            );
        }
        AnchorMode::MultiParty => {
            require!(
                registry_config.enabled_anchor_modes & (1u16 << 1) != 0,
                PlotArmorError::AnchorModeNotAllowed
            );
        }
        _ => {}
    }

    Ok(())
}
