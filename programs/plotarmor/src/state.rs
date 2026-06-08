use anchor_lang::prelude::*;

// RegistryConfig — ["config"] — deploy-time singleton, ~44 bytes
#[account]
pub struct RegistryConfig {
    pub authority: Pubkey,
    pub schema_version: u8,
    pub enabled_anchor_modes: u16,
    pub paused: bool,
}

impl RegistryConfig {
    pub const LEN: usize = 8 + 32 + 1 + 2 + 1;
}

// ContentArtifact — ["content", raw_artifact_hash] — ~50 bytes
// is_initialized is an explicit init guard; set once, never cleared.
#[account]
pub struct ContentArtifact {
    pub is_initialized: bool,
    pub raw_hash: [u8; 32],
    pub content_kind: u8,
    pub created_at: i64,
}

impl ContentArtifact {
    pub const LEN: usize = 8 + 1 + 32 + 1 + 8;
}

// WorkClaim — ["claim", root_artifact_pda, claimant_pubkey] — ~210 bytes
#[account]
pub struct WorkClaim {
    pub root_artifact: Pubkey,
    pub latest_artifact: Pubkey,
    pub latest_link: Pubkey,
    pub claimant: Pubkey,
    pub ownership: Pubkey,
    pub created_at: i64,
    pub claim_kind: u8,
    pub discoverability: u8,
    pub superseded_by: Pubkey,
}

impl WorkClaim {
    pub const LEN: usize = 8 + 32 + 32 + 32 + 32 + 32 + 8 + 1 + 1 + 32;
}

// ClaimArtifactLink — ["claim_artifact", work_claim_pda, link_nonce] — ~112 bytes
#[account]
pub struct ClaimArtifactLink {
    pub work_claim: Pubkey,
    pub content_artifact: Pubkey,
    pub previous_link: Pubkey,
    pub created_at: i64,
}

impl ClaimArtifactLink {
    pub const LEN: usize = 8 + 32 + 32 + 32 + 8;
}

// Ownership — ["ownership", work_claim_pda] — ~110 bytes
#[account]
pub struct Ownership {
    pub work_claim: Pubkey,
    pub total_shares: u16,
    pub threshold_shares: u16,
    pub admin: Pubkey,
    pub rules_version: u8,
    pub privacy_mode: u8,
    pub commitment_root: [u8; 32],
}

impl Ownership {
    pub const LEN: usize = 8 + 32 + 2 + 2 + 32 + 1 + 1 + 32;
}

// OwnerRecord — ["owner", ownership_pda, owner_pubkey] — ~75 bytes
#[account]
pub struct OwnerRecord {
    pub ownership: Pubkey,
    pub owner: Pubkey,
    pub share: u16,
    pub role: u8,
}

impl OwnerRecord {
    pub const LEN: usize = 8 + 32 + 32 + 2 + 1;
}

// ContractArtifact — ["contract_artifact", raw_contract_hash] — ~50 bytes
// is_initialized is an explicit init guard; set once, never cleared.
#[account]
pub struct ContractArtifact {
    pub is_initialized: bool,
    pub raw_hash: [u8; 32],
    pub content_kind: u8,
    pub created_at: i64,
}

impl ContractArtifact {
    pub const LEN: usize = 8 + 1 + 32 + 1 + 8;
}

// EvidenceAnchor — ["evidence", anchorer_pubkey, contract_artifact_pda] — ~112 bytes
#[account]
pub struct EvidenceAnchor {
    pub anchorer: Pubkey,
    pub contract_artifact: Pubkey,
    pub asserted_work_claim: Pubkey,
    pub timestamp: i64,
}

impl EvidenceAnchor {
    pub const LEN: usize = 8 + 32 + 32 + 32 + 8;
}

// AuthorizedContractAnchor — ["authorized_contract", work_claim_pda, contract_artifact_pda] — ~80 bytes
#[account]
pub struct AuthorizedContractAnchor {
    pub work_claim: Pubkey,
    pub contract_artifact: Pubkey,
    pub timestamp: i64,
}

impl AuthorizedContractAnchor {
    pub const LEN: usize = 8 + 32 + 32 + 8;
}

// AnchorRecord — ["anchor", anchored_object_pda, anchor_nonce] — ~82 bytes
#[account]
pub struct AnchorRecord {
    pub anchored_object: Pubkey,
    pub anchored_object_kind: u8,
    pub anchor_mode: u8,
    pub created_at: i64,
    pub external_ref_hash: [u8; 32],
}

impl AnchorRecord {
    pub const LEN: usize = 8 + 32 + 1 + 1 + 8 + 32;
}
