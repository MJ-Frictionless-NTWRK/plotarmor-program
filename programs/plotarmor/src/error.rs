use anchor_lang::prelude::*;

#[error_code]
pub enum PlotArmorError {
    #[msg("Account already initialized")]
    AlreadyInitialized,
    #[msg("Lineage head is stale; refresh and retry")]
    StaleLineageHead,
    #[msg("Anchor mode not allowed by registry config")]
    AnchorModeNotAllowed,
    #[msg("Simulated anchor mode is rejected on this build")]
    SimulatedModeRejected,
    #[msg("Share arithmetic overflow")]
    ShareOverflow,
    #[msg("Share sum mismatch")]
    ShareSumMismatch,
    #[msg("Reserved field must be zero")]
    ReservedFieldNonZero,
    #[msg("Threshold not met")]
    ThresholdNotMet,
    #[msg("Program is paused")]
    Paused,
    #[msg("Signer is not the work claim claimant")]
    Unauthorized,
}
