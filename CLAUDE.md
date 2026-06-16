# PlotArmor Anchor Program — Build Context

You are implementing an already-locked specification. Do NOT redesign the architecture.
The full spec is the PlotArmor White Paper v2.83. This file is the cheat-sheet. When a
detail is missing here, ask for the relevant white-paper appendix rather than inventing it.

Prefer the Solana Developer MCP tools over your own memory for any Solana or Anchor API
detail. Versions drift; the MCP has current docs.

## Model assessment protocol (read before every task)
Before starting any task, output one of these lines first, before anything else:

STAY ON SONNET — this task is within normal complexity.
SWITCH TO HAIKU — this task is mechanical (rename, format, find-replace, comment update).
  Then tell the human: type /model haiku before sending the next prompt.
COME TO CLAUDE CHAT — this task needs deep reasoning beyond Sonnet's reliability
  (anti-fork logic, security review, a bug not solved in 2 Sonnet attempts, architectural decision).
  Then tell the human: bring this to the Claude chat window, resolve it there, then return with the answer.

If partway through a task the complexity escalates beyond what Sonnet handles reliably,
stop mid-task and output: ESCALATE — stopping here, bring this to Claude chat.
Do not guess through hard problems. Flag them.

## Session opening prompt (the human pastes this at the start of every session)
"Read CLAUDE.md fully. Confirm the model-assessment protocol is active. Before every task
I give you today, output your model flag first. Current model: [whatever /model shows]. Ready."

## Hard rules (never violate)
- This is rights-evidence infrastructure. Correctness beats speed. No "vibe coding."
- Implement the canon exactly as written below. If something seems wrong, flag it and stop;
  do not silently "fix" a seed, a field, or an invariant.
- Devnet prototype only until told otherwise. No mainnet deploy. Anchor mode is attested_devnet.
- No em-dashes in any prose or comments. Do not use the word "noise".

## PDA canon (permanent; seeds must never change)
```
RegistryConfig PDA        = ["config"]                                              // deploy-time singleton
ContentArtifact PDA       = ["content", raw_artifact_hash]
WorkClaim PDA             = ["claim", root_artifact_pda, claimant_pubkey]
ClaimArtifactLink PDA     = ["claim_artifact", work_claim_pda, link_nonce]
Ownership PDA             = ["ownership", work_claim_pda]
OwnerRecord PDA           = ["owner", ownership_pda, owner_pubkey]
ContractArtifact PDA      = ["contract_artifact", raw_contract_hash]
EvidenceAnchor PDA        = ["evidence", anchorer_pubkey, contract_artifact_pda]
AuthorizedContractAnchor  = ["authorized_contract", work_claim_pda, contract_artifact_pda]
AnchorRecord PDA          = ["anchor", anchored_object_pda, anchor_nonce]
// Reserved, year-two, do NOT implement now:
WorkMetadata PDA          = ["work_meta", work_claim_pda]
WorkRelation PDA          = ["work_relation", parent_work_claim_pda, child_work_claim_pda]
```

## Account structs (fixed-size; 8-byte Anchor discriminator not shown)
```rust
pub struct RegistryConfig {           // singleton, ~44 bytes
    pub authority: Pubkey,            // protocol multisig; config updates only
    pub schema_version: u8,
    pub enabled_anchor_modes: u16,    // bitfield; gates user_signed / multi_party only
    pub paused: bool,
}
pub struct ContentArtifact {          // ~50 bytes; global raw-byte identity fact
    pub is_initialized: bool,         // init guard; set once on first init, blocks field overwrite on repeat
    pub raw_hash: [u8; 32],
    pub content_kind: u8,
    pub created_at: i64,
}
pub struct WorkClaim {                // ~210 bytes
    pub root_artifact: Pubkey,        // immutable; in seed
    pub latest_artifact: Pubkey,      // mutable head content artifact
    pub latest_link: Pubkey,          // mutable head ClaimArtifactLink
    pub claimant: Pubkey,
    pub ownership: Pubkey,
    pub created_at: i64,
    pub claim_kind: u8,
    pub discoverability: u8,          // 0 = public (only value used in v1)
    pub superseded_by: Pubkey,        // zero pubkey if active
}
pub struct ClaimArtifactLink {        // ~112 bytes
    pub work_claim: Pubkey,
    pub content_artifact: Pubkey,
    pub previous_link: Pubkey,        // zero pubkey for the first (root) link
    pub created_at: i64,
}
pub struct Ownership {                // ~110 bytes
    pub work_claim: Pubkey,
    pub total_shares: u16,
    pub threshold_shares: u16,
    pub admin: Pubkey,
    pub rules_version: u8,
    pub privacy_mode: u8,             // 0 = transparent (only value used in v1)
    pub commitment_root: [u8; 32],    // zero in v1
}
pub struct OwnerRecord {              // ~75 bytes
    pub ownership: Pubkey,
    pub owner: Pubkey,
    pub share: u16,
    pub role: u8,
}
pub struct ContractArtifact {         // ~50 bytes
    pub is_initialized: bool,         // init guard; set once on first init, blocks field overwrite on repeat
    pub raw_hash: [u8; 32],
    pub content_kind: u8,
    pub created_at: i64,
}
pub struct EvidenceAnchor {           // ~112 bytes; unilateral
    pub anchorer: Pubkey,
    pub contract_artifact: Pubkey,
    pub asserted_work_claim: Pubkey,  // zero pubkey allowed; NOT validated by program
    pub timestamp: i64,
}
pub struct AuthorizedContractAnchor { // ~80 bytes; threshold-approved
    pub work_claim: Pubkey,
    pub contract_artifact: Pubkey,
    pub timestamp: i64,
}
pub struct AnchorRecord {             // ~82 bytes; carries NO lifecycle state
    pub anchored_object: Pubkey,
    pub anchored_object_kind: u8,
    pub anchor_mode: u8,
    pub created_at: i64,
    pub external_ref_hash: [u8; 32],  // [0;32] when no secondary anchor
}
```

## Instructions (v1 set)
- register_work_claim(raw_hash, claim_kind, share params, link_nonce, anchor_nonce, anchor_mode_arg)
  Creates ContentArtifact (init_if_needed), WorkClaim, Ownership, first OwnerRecord,
  the FIRST ClaimArtifactLink (previous_link = zero), and an AnchorRecord for the registration.
  Sets work_claim.latest_link to that first link. anchor_mode_arg passed through assert_mode_allowed.
- add_version(link_nonce, anchor_nonce, expected_previous_link)
  MUST validate expected_previous_link == work_claim.latest_link, else revert StaleLineageHead.
  Then create new ContentArtifact (init_if_needed), new ClaimArtifactLink (previous_link = old head),
  new AnchorRecord, and update BOTH latest_link and latest_artifact in place.
- add_owner / ownership ops (threshold-governed)
- anchor_evidence_contract(...) -> ContractArtifact (init_if_needed) + EvidenceAnchor + AnchorRecord
- anchor_authorized_contract(...) -> ContractArtifact + AuthorizedContractAnchor + AnchorRecord
  (requires threshold-meeting signatures from the WorkClaim's Ownership)

## Invariants (test every one)
- latest_link.content_artifact == latest_artifact (after every chain-touching tx)
- add_version validates against latest_link, NOT latest_artifact (prevents silent fork on revert)
- Registration always mints the root link, so latest_link is never zero; no first-version special case
- link_nonce and anchor_nonce are client INTENT nonces: generated once per user intent,
  persisted before submission, reused unchanged on retry. Never regenerate per submission attempt.
- Same ContentArtifact may appear more than once in one linear chain (revert / intentional reuse)
- Ownership: sum of OwnerRecord.share == total_shares at end of every modifying tx; use checked math
- Reserved fields enforced in v1: privacy_mode == 0, commitment_root == zero, discoverability == 0
- One WorkClaim per claimant per root artifact (accepted v1 constraint)
- One asserted_work_claim per EvidenceAnchor (accepted v1 constraint; zero pubkey allowed)
- AnchorRecord created ONLY for externally meaningful events: WorkClaim registration, version add,
  EvidenceAnchor, AuthorizedContractAnchor. NOT for Ownership or OwnerRecord init.
- anchor_mode immutable per AnchorRecord; re-anchor = new AnchorRecord with new nonce
- No close instruction for ContentArtifact, ClaimArtifactLink, EvidenceAnchor,
  AuthorizedContractAnchor, AnchorRecord. OwnerRecord closeable only via governed ownership change.
  WorkClaim closure unsupported in v1.

## Simulated-mode rejection (security-critical)
- Mainnet builds compile with a `mainnet` Cargo feature that hardcodes rejection of
  anchor_mode = simulated inside an assert_mode_allowed helper in EVERY anchor-creating handler.
- RegistryConfig gates user_signed and multi_party only. It can NEVER enable simulated.
- The rejection lives in the compiled handler, not in any mutable config account.

## Hashing (three layers)
- Layer 1 raw hash: SHA-256("plotarmor:raw:v1\n" || raw_bytes). On-chain identity. Seeds ContentArtifact.
- Layer 2 canonical hash: client-side, BEFORE encryption. Off-chain. Index identity-comparison key.
- Layer 3 similarity fingerprint: off-chain, client-side or deferred. Not part of canon.
- storage_hash: SHA-256 of canonical CID. Off-chain operational metadata only. NOT on-chain, NOT a seed.

## Solana limits (pass/fail before mainnet)
- Transaction max 1,232 serialized bytes. Signatures 64 bytes. Max 12 signatures per packet.
- 200,000 CU per instruction default; 1,400,000 CU per transaction max.
- init_if_needed is an audit surface: a second call with the same seed must NOT overwrite fields.
  Use the explicit is_initialized: bool flag on ContentArtifact and ContractArtifact. Set it true and
  write all fields exactly once on first init; on every later call, observe is_initialized == true and
  skip all writes. Do NOT use a created_at == 0 check (Anchor runs the handler body in full even when the
  account exists, and the timestamp zero case is ambiguous). No instruction may clear is_initialized.

## Locked enum numberings (do NOT change; on-chain integers are immutable)
These are committed to devnet state. Changing them requires a new program deployment.

AnchorMode: Simulated=0, AttestedDevnet=1, AttestedMainnet=2, UserSigned=3, MultiParty=4
AnchoredObjectKind: WorkClaim=0, ContentArtifact=1, EvidenceAnchor=2, AuthorizedContractAnchor=3
ClaimKind: Unspecified=0, Original=1, Adapted=2, WorkForHire=3, Derivative=4, Assignment=5
ContractKind: Unspecified=0, Nda=1, WriterAgreement=2, Collaboration=3, Option=4,
  OptionExtension=5, OptionExercise=6, Purchase=7, Amendment=8, Assignment=9, License=10, Other=11
ContentKind: Unspecified=0, Screenplay=1, Treatment=2, Outline=3, Contract=4, Score=5, Master=6, Foley=7
OwnerRole: Unspecified=0, Author=1, CoAuthor=2, Producer=3, Financier=4, Assignee=5

Error codes 6000-6010: AlreadyInitialized(6000), StaleLineageHead(6001), AnchorModeNotAllowed(6002),
  SimulatedModeRejected(6003), ShareOverflow(6004), ShareSumMismatch(6005),
  ReservedFieldNonZero(6006, reserved), ThresholdNotMet(6007, reserved), Paused(6008),
  Unauthorized(6009), SupersededClaim(6010)
Reserved codes (6006, 6007) are unused in v1 — do not remove them, they hold their slot.

## Cost baseline (reference, $90/SOL; confirm on devnet)
register ~$0.88, add-version ~$0.39, evidence-anchor ~$0.39, authorized-anchor ~$0.37,
re-anchor ~$0.13, add-co-owner ~$0.13, RegistryConfig ~$0.11 one-time.

## Toolchain (as installed on this machine; paper specifies older, reconcile before building)
Rust 1.96.0, Solana CLI 4.0.1 (Agave), Anchor CLI 1.0.1, Node v24.10.0, Yarn 1.22.22.
NOTE: installer pulled newer versions than the white paper (paper specifies Solana 3.x,
Anchor 0.32.1). Verify via the Solana MCP that no API change affects the canon before building.
TS client: @coral-xyz/anchor + @solana/web3.js (or @solana/kit), wallet-adapter.
Tests: two-layer suite.
  Layer 1 — Rust/LiteSVM: `cargo test` runs 28 integration tests in
    programs/plotarmor/tests/ (happy_paths.rs + security_tests.rs). Fast, no validator needed.
  Layer 2 — TypeScript/Anchor: `anchor test` deploys to a local validator and runs 29
    Mocha/Chai tests in tests/plotarmor.ts. Covers all six instructions with on-chain
    state assertions and 17 rejection tests verifying every error code path.
  Combined: `yarn test` runs cargo test then anchor test sequentially.

## Model guidance (Claude Pro: Sonnet default, Opus and Haiku both available on this plan)
- Default model for this project: Sonnet. It handles structs, most instructions, tests, and wiring.
- Use Haiku (`/model haiku`) for mechanical bulk work: renames, formatting, comment updates,
  find-and-replace across files. Cheapest; do not reason with it.
- Reserve Opus (`/model opus`, ~2x Sonnet usage) for: the add_version anti-fork logic, a bug Sonnet
  cannot solve after two attempts, and the security review. Prefer resolving the hardest reasoning
  in the Claude chat window first, then return and have Sonnet implement the resolved approach.
- Switch back down to Sonnet or Haiku immediately after a hard task; do not leave Opus running for
  routine edits. Run `/usage` to check the remaining window before a large task.

## Known v1 limitations (from security review, June 2026)
These are documented deviations and intentional gaps. Do not "fix" them silently — they require
explicit decisions. Flag any work touching these areas with COME TO CLAUDE CHAT.

A. anchor_authorized_contract uses single-admin authorization, not threshold governance.
   The spec says "threshold-meeting signatures from the WorkClaim's Ownership." The current
   implementation checks admin.key() == ownership.admin (one signer). This is acceptable for
   solo-creator case studies. Full threshold governance requires the custody-model decision
   (Decision 5, pending Sali Law Group) before implementation.

B. init_registry_config upgrade-authority constraint — FIXED. The instruction now requires
   two additional accounts: program (the program account itself) and program_data (the BPF
   upgradeable loader ProgramData PDA). Two constraints enforce: (1) program_data is the
   legitimate ProgramData for this program, and (2) the signer is the upgrade authority
   recorded in program_data. Error: Unauthorized(6009). Fixed in commit after 800fa99.

C. No pause or config-update instruction exists. The paused field and enabled_anchor_modes
   bitfield in RegistryConfig have no setter. The kill switch is intentionally deferred to
   a later phase. This is fail-safe (everything keeps working) not exploitable.

D. Admin can set threshold_shares to any value in (0, total_shares] on add_owner.
   A negligent admin could set threshold = 1, nullifying multi-party protection. Acceptable
   for v1 single-owner case studies. Revisit with threshold governance implementation.

E. add_version checks claimant signature only, not threshold approval from Ownership.
   The white paper (sections D.2 and 15.6) states that advancing latest_artifact requires
   threshold approval because it is a rights-affecting event. The deployed implementation
   checks only signer == work_claim.claimant. For the solo-creator case study the outcomes
   coincide. Full threshold governance on add_version requires the custody-model decision
   (Decision 5, pending Sali Law Group). Do not implement threshold on add_version until
   that decision lands. Sections D.2 and 15.6 in the white paper are scoped to v1 single-
   claimant flows; this limitation is acknowledged and documented, not a hidden gap.

Implementation detail (not a limitation): register_work_claim sets initial OwnerRecord.role = 0 (Unspecified). If Author attribution is required, it must be set via a subsequent add_owner call.

These findings were confirmed clean by the Solana MCP program_autofixer (zero mechanical
issues) and identified by manual review against the spec. Prague auditors should review
against Appendix C invariants and Appendix G acceptance checklist specifically.

## Test coverage report (June 2026)

Two suites run against the deployed program, totaling 57 tests: 28 Rust/LiteSVM and 29
TypeScript/Mocha (local validator). All 57 pass as of commit 2b55abb.

Invariants confirmed green by TypeScript on-chain assertions:
- latest_link.content_artifact == latest_artifact after every chain-touching tx
- add_version validates against latest_link, not latest_artifact (anti-fork)
- Two add_version instructions in one tx: second fails StaleLineageHead, entire tx reverts
  atomically — latest_link confirmed unchanged on-chain after revert
- Registration always produces a root ClaimArtifactLink (previous_link = zero pubkey);
  latest_link is never zero after registration
- Content-addressing convergence: two claimants, one ContentArtifact, two independent
  WorkClaims with different claimant pubkeys confirmed on-chain
- Reserved fields (privacyMode=0, commitmentRoot=[0;32], discoverability=0) verified
  on-chain for every account struct that carries them
- AnchorRecord anchors workClaim (kind=0) for register_work_claim; contentArtifact (kind=1)
  for add_version; evidenceAnchor (kind=2) for anchor_evidence_contract;
  authorizedContractAnchor (kind=3) for anchor_authorized_contract

Error codes confirmed rejecting correctly (all 17 negative TypeScript tests pass):
  StaleLineageHead(6001), Unauthorized(6009) for both wrong-claimant and wrong-admin paths,
  AnchorModeNotAllowed(6002) for content_kind=99/255 and claim_kind=99, ShareSumMismatch(6005)
  for total=0, threshold>total, add_owner share=0 and threshold=0 and threshold>new_total,
  already-in-use (System 0x0) for duplicate OwnerRecord, evidence replay, authorized PDA
  collision, and init_registry_config second call.

Implementation detail discovered during TypeScript testing (not a spec contradiction):
  register_work_claim sets initial OwnerRecord.role = 0 (Unspecified). The white paper does
  not specify the initial role value for the registering claimant. Note for future add_owner
  callers: if Author role is required, it must be set via a subsequent add_owner call.

devnet scenario coverage (scripts/measure_devnet.ts, 21 scenarios, all pass):
  Scenarios 1-8: positive measurements (register, add_version, evidence, authorized, add_owner)
  plus wrong-claimant, wrong-admin, simulated-mode rejections.
  Scenarios 9-21: adversarial edge cases including share=0, claim_kind boundary (u8 255),
  two-instruction atomicity, add_owner zero-share/zero-threshold/threshold>total, content-
  addressing convergence, threshold=0, duplicate pubkey, chain hash reuse, evidence replay,
  registry config replay, cross-claim add_version, cross-claim authorized contract,
  AuthorizedContractAnchor PDA collision. All pass; harness exits non-zero on any failure.

Auditor brief: AUDITOR_BRIEF.md in the repo root covers test coverage, invariants, error codes, known limitations A-E, and audit focus areas. Commit: 800fa99.
1. Rights Index ingestion: Supabase Edge Function listens for Solana events and writes to the database.
   No separate indexer service. Use a clean repository abstraction layer in the query code so the
   database can be swapped later without touching the rest of the codebase.
2. Storage path: encrypted file goes client → Supabase edge function → Pinata. The Pinata API key
   lives server-side only. Client never holds the Pinata key. CID returns to client and is included
   in the Solana transaction.
3. Wallet adapter: @solana/wallet-adapter-react. Do not use @solana/kit for wallet connection.
4. TypeScript client: @coral-xyz/anchor generated from the program IDL. Do not use Codama.
Database: Supabase (Postgres). All Rights Index queries go through a repository abstraction layer.

## Pending decisions (do NOT implement; ask the human when these come up)
5. Custody model policy for case-study partners (gates user_signed / multi_party modes; needs counsel).
6. Canonicalization spec v1 with test vectors (needed before case study onboarding; documentation task).
