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
    #[msg("Work claim has been superseded")]
    SupersededClaim,
    // Reserved error codes (unused in v1, reserved for future use):
    // AlreadyInitialized (6000) - reserved; is_initialized guard currently
    //   returns account-exists error via Anchor before this triggers.
    // ReservedFieldNonZero (6006) - reserved for when privacy_mode,
    //   commitment_root, and discoverability become caller-settable.
    // ThresholdNotMet (6007) - reserved for full threshold governance
    //   once the custody-model decision (Decision 5) lands.
}
