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

## Verification standard (hard rule, no exceptions)
No claim of correctness, security, or completeness (in code, in commit messages, in
AUDITOR_BRIEF.md, or when reporting back to the human) may be made until it has been
through 4 independent verification passes. A "pass" means: an actual test run, an actual
live behavioral check against the deployed target (not just reading source), or an
independent re-audit by a different session/agent. Passing a test suite once is 1 pass,
not 4. "The code looks correct" from reading it is not a pass at all.

This standard exists because 3 live P0 security vulnerabilities (anonymous metadata leak
via verify_work_by_hash, and two project_members privilege-escalation bugs) sat in
production on 2026-07-01 despite being "fixed" in committed SQL files that were never
actually applied to the live database, and despite multiple sessions describing the
codebase as solid. Documentation and committed code are not evidence of live state.
Live state must be checked directly, every time, before any claim is made. The same
discipline applies here: AUDITOR_BRIEF.md and CLAUDE.md test-coverage claims must be
re-verified against actual cargo test / anchor test output, not trusted from prior
commits, since the demo-repo incident showed committed fixes and live deployments can
silently diverge.

When reporting findings or completed work back to the human, always state the actual
audit-pass count and what remains unverified. Do not round up. "Fixed and verified once"
is not "fixed." Provisional language is required until pass 4.

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
ContractSignature PDA     = ["signature", contract_artifact_pda, signer_pubkey]              // added 2026-07-15, sign_contract
// Reserved, year-two, do NOT implement now:
WorkMetadata PDA          = ["work_meta", work_claim_pda]
WorkRelation PDA          = ["work_relation", parent_work_claim_pda, child_work_claim_pda]
```

### AnchorRecord seed base is the anchored object, including for add_version
Audit finding M1, 2026-09-03. Decision 2026-09-04: DOCUMENT, DO NOT CHANGE THE SEED.

All four anchoring instructions satisfy seed_base == anchored_object, which is exactly
what the canon line above specifies:
  register_work_claim         ["anchor", work_claim, nonce]                  kind 0
  add_version                 ["anchor", content_artifact, nonce]            kind 1
  anchor_evidence_contract    ["anchor", evidence_anchor, nonce]             kind 2
  anchor_authorized_contract  ["anchor", authorized_contract_anchor, nonce]  kind 3

add_version is therefore NOT a deviation. It looks different only because
ContentArtifact is content-addressed and shared across claimants, while work_claim,
evidence_anchor and authorized_contract_anchor each already embed a principal in their
own seeds. So add_version's AnchorRecord PDA is the only one carrying no principal.

THE CONSEQUENCE, and it is real: two claimants who registered the same content bytes
and then add the same version content with the same anchor_nonce derive the SAME
AnchorRecord address. The second loses with account-already-in-use. A party who
observes a pending add_version can take that PDA first and deliberately grief a
specific creator, for the cost of rent plus a fee.

RECOVERY: generate a FRESH anchor_nonce and resubmit. Reuse the link_nonce unchanged,
because a failed transaction reverts atomically and creates no ClaimArtifactLink. This
does not violate the "reuse nonces unchanged on retry" invariant further down: that
invariant governs idempotent retries of the SAME intent, and a stolen PDA is a new
intent. An accidental collision between honest users requires a 32-byte nonce match and
is not a practical concern; only deliberate front-running reaches this.

WHY NO SEED CHANGE. Adding work_claim to the seed would fix the collision, confirmed by
derivation (Alice and Bob stop colliding). It was rejected because: (1) seeds are
permanent per the heading above; (2) it would make add_version the ONLY instruction
whose seed base is not its anchored object, breaking a uniform rule any indexer can
rely on; (3) 32 AnchorRecords created by add_version already exist on devnet, read from
chain 2026-09-04, and NONE is reachable under the new derivation for any nonce, since
the seed base moves from content_artifact to work_claim; (4) a later add_version reusing
an old (work_claim, content, nonce) triple would then succeed at the new address,
creating a duplicate AnchorRecord for one logical event, which is a data-integrity
regression in a rights-evidence ledger; (5) it needs a program redeploy and breaks live
client code, including plotarmor-demo/src/vault/UploadFlow.tsx:556 plus 34 derivation
sites in this repo. The trade was judged bad against a recoverable griefing vector.

PINNED BY TEST: add_version_anchor_record_is_content_scoped_not_claimant_scoped in
programs/plotarmor/tests/security_tests.rs asserts the collision AND the recovery, so
this cannot be silently "fixed" by someone who has not read this entry. If that test
starts failing, someone changed the seed. Read this section before deciding it is a bug.

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
    pub total_shares: u16,            // RECORDED, NOT ENFORCED. See Known v1 limitations, item H.
    pub threshold_shares: u16,        // RECORDED, NOT ENFORCED. No instruction reads this to authorize anything. See item H.
    pub admin: Pubkey,                // the ONLY authority the program actually checks on this account
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
    pub content_kind: u8,             // CONFIRMED SPEC DEVIATION 2026-07-04: white paper Section 8.6 /
                                       // Appendix B.1 name this field contract_kind. Deployed field is
                                       // content_kind (camelCase contentKind in IDL/TS), almost certainly
                                       // copy-pasted from ContentArtifact's own field and never renamed.
                                       // The anchor_evidence_contract/anchor_authorized_contract
                                       // INSTRUCTION ARGUMENT is correctly named contract_kind (contractKind
                                       // in TS) and matches the white paper -- only the ACCOUNT STRUCT FIELD
                                       // that stores it deviates. Do not silently rename; a field rename
                                       // requires a program redeploy. See Known v1 limitations, item F.
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
    pub external_ref_hash: [u8; 32],  // IPFS CIDv0 digest (32 bytes after stripping 0x12 0x20 multihash prefix); zero when no IPFS binding yet
}
pub struct ContractSignature {        // ~121 bytes; added 2026-07-15, sign_contract, Option 2 (no on-chain creator check)
    pub contract_artifact: Pubkey,
    pub signer: Pubkey,               // any funded wallet; creator/party restriction is enforced OFF-CHAIN only. See Known v1 limitations, item G.
    pub content_hash: [u8; 32],       // must equal contract_artifact.raw_hash; checked in handler (ContentHashMismatch, 6011) not via seed derivation
    pub signed_at: i64,               // Clock::get().unix_timestamp, program-captured -- never a client-supplied argument
    pub slot: u64,                    // Clock::get().slot, for explorer cross-reference
    pub bump: u8,
    // No is_initialized field: uses plain `init` (not init_if_needed), so Anchor's own
    // account-already-exists check is the anti-double-sign guard. See Known v1 limitations, item G.
}
```

## Instructions (v1 set)
The v1 program has SEVEN instructions, all present in the deployed devnet program and all
listed below: init_registry_config, add_owner, anchor_authorized_contract,
anchor_evidence_contract, add_version, register_work_claim, sign_contract. Corrected
2026-09-03: sessions have repeatedly been briefed that the program is "frozen at four
instructions." Four is the count of ANCHOR-CREATING instructions (register_work_claim,
add_version, anchor_evidence_contract, anchor_authorized_contract), which is the correct
scope for the external_ref_hash and AnchorRecord sections further down, but it is NOT the
instruction count. Five is the count of instructions called from TypeScript and checked by
scripts/verify_calls.py. Seven is the total. Verified by grep of `pub fn` in
programs/plotarmor/src/lib.rs. Scope remains frozen: no eighth instruction.

- register_work_claim(raw_hash, content_kind, claim_kind, share params, link_nonce, anchor_nonce, anchor_mode_arg, external_ref_hash)
  Creates ContentArtifact (init_if_needed), WorkClaim, Ownership, first OwnerRecord,
  the FIRST ClaimArtifactLink (previous_link = zero), and an AnchorRecord for the registration.
  Sets work_claim.latest_link to that first link. anchor_mode_arg passed through assert_mode_allowed.
- add_version(raw_hash, content_kind, link_nonce, anchor_nonce, anchor_mode_arg, expected_previous_link, external_ref_hash)
  MUST validate expected_previous_link == work_claim.latest_link, else revert StaleLineageHead.
  Then create new ContentArtifact (init_if_needed), new ClaimArtifactLink (previous_link = old head),
  new AnchorRecord, and update BOTH latest_link and latest_artifact in place.
- add_owner / ownership ops (threshold-governed)
- anchor_evidence_contract(raw_contract_hash, contract_kind, anchor_nonce, anchor_mode_arg, asserted_work_claim, external_ref_hash) -> ContractArtifact (init_if_needed) + EvidenceAnchor + AnchorRecord
- anchor_authorized_contract(raw_contract_hash, contract_kind, anchor_nonce, anchor_mode_arg, external_ref_hash) -> ContractArtifact + AuthorizedContractAnchor + AnchorRecord
  (requires threshold-meeting signatures from the WorkClaim's Ownership)
- sign_contract(content_hash) -> ContractSignature (added 2026-07-15, sign_contract-spec.md, Option 2 locked by Milan)
  ContractArtifact must already exist on-chain (never init'd here; sign_contract does not stand alone).
  Re-derives contract_artifact's seed from the account's OWN stored raw_hash, then separately requires
  content_hash == contract_artifact.raw_hash in the handler (ContentHashMismatch, 6011) -- kept as two
  distinct checks so the custom error stays reachable instead of collapsing into a generic ConstraintSeeds
  failure. Uses plain `init` on ContractSignature (not init_if_needed): a repeat signer for the same
  (contract, signer) pair hits Anchor's account-already-exists error, which is the correct anti-double-sign
  behavior. No creator/party check on-chain -- signer may be any funded wallet; see Known v1 limitations,
  item G. Does NOT create an AnchorRecord (not in the AnchorRecord-creating instruction list below).

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
  EvidenceAnchor, AuthorizedContractAnchor. NOT for Ownership or OwnerRecord init, and NOT for
  sign_contract (added 2026-07-15) -- a ContractSignature is not an anchoring event in the
  AnchoredObjectKind sense; it records a signature against an already-anchored ContractArtifact.
- anchor_mode immutable per AnchorRecord; re-anchor = new AnchorRecord with new nonce
- No close instruction exists in v1 for ANY account -- ContentArtifact, ClaimArtifactLink,
  EvidenceAnchor, AuthorizedContractAnchor, AnchorRecord, OwnerRecord, or WorkClaim. Corrected
  2026-07-15: this line previously read "OwnerRecord closeable only via governed ownership
  change," which is not true of the current v1 program (grepped: zero `close =` constraints
  anywhere in programs/plotarmor/src/instructions/). That wording comes from white paper
  Appendix G.7's mainnet-readiness acceptance checklist, which states the closure policy a
  FUTURE close instruction must satisfy once one is built -- it is a target constraint on
  implementation, not a description of current behavior. Read it as: when an OwnerRecord close
  instruction is eventually added, it must require governed ownership change, not be added as
  an unrestricted close. WorkClaim closure remains unsupported by design in v1.

## Simulated-mode rejection (security-critical)
- Mainnet builds compile with a `mainnet` Cargo feature that hardcodes rejection of
  anchor_mode = simulated inside an assert_mode_allowed helper in EVERY anchor-creating handler.
- RegistryConfig gates user_signed and multi_party only. It can NEVER enable simulated.
- The rejection lives in the compiled handler, not in any mutable config account.

## Hashing (three layers)
- Layer 1 raw hash: SHA-256("plotarmor:raw:v1\n" || raw_bytes). On-chain identity. Seeds ContentArtifact.
- Layer 1 contract raw hash (white paper v2.84, Section 5.6/8.6, corrected 2026-07-04):
  SHA-256("plotarmor:contract_raw:v1\n" || raw_bytes). On-chain identity. Seeds ContractArtifact
  (raw_contract_hash). raw_bytes are the actual rendered contract document (e.g. PDF), generated
  ONCE at finalization time and never re-rendered/re-hashed, parallel to how ContentArtifact works
  for screenplays. Do NOT hash canonical JSON of form fields (title/description/parties/etc.) --
  that is a different problem (Layer 2) and produces the wrong on-chain identity. An earlier
  correction of this file/session used "plotarmor:contract:v1\n" and canonical-JSON hashing; both
  were wrong and were never actually implemented on-chain or in the demo repo before this
  correction landed.
- "plotarmor:contract:v1\n" (no "_raw") is reserved for a DIFFERENT, off-chain Layer 2 canonical-
  text hash used by the Rights Index. Do not conflate the two prefixes.
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

Error codes 6000-6011: AlreadyInitialized(6000), StaleLineageHead(6001), AnchorModeNotAllowed(6002),
  SimulatedModeRejected(6003), ShareOverflow(6004), ShareSumMismatch(6005),
  ReservedFieldNonZero(6006, reserved), ThresholdNotMet(6007, reserved), Paused(6008),
  Unauthorized(6009), SupersededClaim(6010), ContentHashMismatch(6011, sign_contract, added 2026-07-15)
Reserved codes (6006, 6007) are unused in v1 — do not remove them, they hold their slot.

## Cost baseline (reference, $90/SOL; confirm on devnet)
register ~$0.88, add-version ~$0.39, evidence-anchor ~$0.39, authorized-anchor ~$0.37,
re-anchor ~$0.13, add-co-owner ~$0.13, RegistryConfig ~$0.11 one-time,
sign_contract ~$0.1564 (added 2026-07-15, measured 2026-07-22).
sign_contract measured live on devnet: 1,738,040 lamports total (0.00173804 SOL, ~$0.1564
at $90/SOL) = 1,733,040 lamports rent-exemption for the 121-byte ContractSignature account
+ 5,000 lamports base tx fee. Measured via a wallet balance-delta check isolated to the
sign_contract call alone (scripts/devnet_sign_contract_test.ts), not derived from account
size -- real tx: mMCthtHF12bGA5YHhLmKzufokJdsjK779gk2z7dqdNd35pNvFBsUVLM1kGToAKD1DrmaM8GiaoX4FCWTYc2hB49.
Superseded a prior "not yet measured, ~$0.13 estimate" placeholder.

## Toolchain (as installed on this machine; paper specifies older, reconcile before building)
Rust 1.96.0, Solana CLI 4.0.1 (Agave), Anchor CLI 1.0.1, Node v24.10.0, Yarn 1.22.22.
NOTE: installer pulled newer versions than the white paper (paper specifies Solana 3.x,
Anchor 0.32.1). Verify via the Solana MCP that no API change affects the canon before building.
TS client: @coral-xyz/anchor + @solana/web3.js (or @solana/kit), wallet-adapter.
Tests: two-layer suite.
  Layer 1 — Rust/LiteSVM: `cargo test` runs 52 tests total per build: 1 unit test in
    src/lib.rs, 11 in happy_paths.rs, 33 in security_tests.rs (one of the two build-specific
    AttestedMainnet/AttestedDevnet cross-environment tests is active per build, see Finding 1
    in Known v1 limitations), and 7 in sign_contract_tests.rs (added 2026-07-15). Fast, no
    validator needed. `cargo test --features mainnet` additionally requires a mainnet-featured
    .so at target/deploy-mainnet/plotarmor.so — see programs/plotarmor/tests/common/mod.rs.
    Live-verified 2026-07-22: both the default (devnet) and `--features mainnet` builds ran
    clean at 52/52 after rebuilding target/deploy-mainnet/plotarmor.so, which had gone stale
    (predated the sign_contract commit and failed 6/7 sign_contract_tests.rs cases with
    InstructionFallbackNotFound before the rebuild). Rebuild command:
    `cargo build-sbf --manifest-path programs/plotarmor/Cargo.toml --features mainnet --sbf-out-dir target/deploy-mainnet`.
    Keep that artifact in sync after every source change or `--features mainnet` runs stale.
  Layer 2 — TypeScript/Anchor: `anchor test` deploys to a local validator and runs 34
    Mocha/Chai tests in tests/plotarmor.ts (added 2026-07-22: 4 sign_contract tests, up from
    30). Covers all seven instructions with 15 happy-path on-chain state assertions and 19
    rejection tests verifying every error code path. sign_contract's Layer 2 coverage: 1 happy
    path (creates ContractSignature, asserts contractArtifact/signer/contentHash match and
    signedAt/slot are populated from the chain) + 3 rejections (wrong content_hash ->
    ContentHashMismatch 6011; double-sign by same signer -> already in use; signing a
    nonexistent ContractArtifact -> account-validation failure), mirroring the error paths
    already covered in sign_contract_tests.rs. Live-verified 2026-07-22 (1 pass, this
    session): `anchor test`, 34/34 passing on first run.
  Combined: `yarn test` runs cargo test then anchor test sequentially.

## Devnet deploy history (established from chain 2026-09-03)

Read from ProgramData Dr8S95D7bHGBrd6gFSAommQjBNH1qcBMJpofe9ooLRpL, which has exactly 9
transactions, so this is the COMPLETE history. Every one is signed by
EjeeFw3Ft856o9Ek2VWti6aAco9RXxGUyeLk96dPSWzd, a single key. Program byte counts are derived
from each upgrade buffer's rent-exempt balance (buffer_len = 37 + program_len,
rent = (128 + data_len) * 6960); that constant was verified exactly against the live
ProgramData account before use ((128 + 472005) * 6960 = 3,286,045,680, its actual balance).

  slot 468720131  2026-06-11 15:30:02Z  createAccount + deployWithMaxDataLen   372,136 bytes
  slot 471473143  2026-06-23 18:56:47Z  createAccount + initializeBuffer + extendProgram
  slot 471473176  2026-06-23 18:56:59Z  upgrade                                451,488 bytes
  slot 473711141  2026-07-03 14:35:36Z  extendProgram
  slot 473711199  2026-07-03 14:35:58Z  upgrade  (Finding 1)                   451,944 bytes
  slot 476271233  2026-07-14 19:42:52Z  extendProgram
  slot 476271283  2026-07-14 19:43:11Z  upgrade  UNDOCUMENTED until now        469,472 bytes
  slot 476272042  2026-07-14 19:47:48Z  upgrade  UNDOCUMENTED until now        470,280 bytes
  slot 476301346  2026-07-14 22:46:50Z  upgrade  (current head)                470,280 bytes

THE TWO 14 JULY UPGRADES AT 19:43 AND 19:47 WERE NOT RECORDED ANYWHERE in this repo before
2026-09-03. Only the 2026-07-03 Finding 1 deploy had been logged. The +17,528 byte jump at
19:43 is sign_contract being added. The last two upgrades pushed IDENTICAL program lengths
(470,280 bytes); byte-identity between them cannot be proven from chain, because upgrade
buffers are closed and drained on execution and historical account data is not retrievable
from a standard RPC. The 22:46 transaction carries two ComputeBudget instructions and a
slightly higher fee (5,014 vs 5,000 lamports), which is the shape of a re-send with a
priority fee. That is consistent with a re-push of identical bytes but is NOT proof, and
must not be written up as if it were.

DEPLOY PRECEDED COMMIT. The last deploy is 2026-07-14 22:46 UTC. Commit 09c5bfc ("feat: add
Option 2 sign_contract") is dated 2026-07-15 12:39 UTC, about 14 hours LATER. The program
was deployed from uncommitted working-tree code and committed the next day. This ordering
is invisible in git history and would mislead an auditor reading it alone. It resolves
cleanly: see the reproduction proof in the next section, which confirms the deployed bytes
are exactly commit 09c5bfc. The habit is the risk, not this particular deploy.

## Build and deploy configuration (added 2026-09-03)

Current HEAD: 98a7ebb ("docs: close sign_contract 4-pass verification with live devnet
adversarial check"). Correcting a stale briefing: sessions have been told HEAD is 27556a0.
That commit is real but sits 10 commits back ("devnet_register_test: add external_ref_hash
parameter and on-chain round-trip verification"). Check `git rev-parse HEAD` rather than
trusting a briefed value.

DEPLOYED DEVNET BINARY IS BEHIND HEAD, and not for the usual reason. Source has not
drifted: programs/plotarmor/src has had zero changes between commit 09c5bfc (the deployed
source) and 98a7ebb. The COMPILER drifted. The deployed binary was produced by
platform-tools v1.52; cargo-build-sbf 4.0.0 now defaults to v1.53, and the two produce
different bytes from identical source (measured 2026-09-03: .text differs by 15,904 bytes,
.rodata by 32, .data.rel.ro identical, string tables identical, both SBPF v0). Two
independent cold builds under v1.53 agreed with each other exactly, so the build IS
deterministic per toolchain. A warm rebuild is NOT a reproducibility test: cargo's
fingerprint does not notice a platform-tools swap, so it will report success in ~1.5s
having recompiled nothing and simply copied the stale artifact. Always use a fresh
CARGO_TARGET_DIR when testing reproducibility. Pin the tools version explicitly with
`cargo build-sbf --tools-version v1.52` to reproduce the currently deployed bytes.

PROVEN 2026-09-03: commit 09c5bfc built with `--tools-version v1.52` from a fresh
CARGO_TARGET_DIR at a different filesystem path reproduces the deployed devnet binary
EXACTLY (sha256 of both, trailing zeros trimmed:
5663e20f992914ad1a2671888fd3062a36df69ecc6ac81ee1318f9e702bc3fb5, 470,257 bytes). So the
deployed binary is commit 09c5bfc, the build is fully reproducible once the tools version
is pinned, and platform-tools v1.52 is still installable via `--tools-version v1.52`.

THE TOOLCHAIN IS NOW PINNED TO platform-tools v1.52. RESOLVED 2026-09-03; the
divergence described below is fixed, and this paragraph is kept because the mechanism is
not obvious and will re-break if anchor-cli is upgraded without re-checking.

  The pin lives in TWO places and both must agree:
    Anchor.toml   anchor_version = "1.0.1"     pins the anchor path
    scripts/build.sh  PLATFORM_TOOLS_VERSION="v1.52"   pins the cargo path
  Build with `scripts/build.sh` (devnet), `scripts/build.sh --mainnet`, or
  `scripts/build.sh --anchor`. `scripts/build.sh --check` prints both pins.
  Do NOT call `cargo build-sbf` directly; it defaults to v1.53 and will drift.

  THE WRAPPER ALSO GUARDS AGAINST THE STALE-ARTIFACT TRAP described further down.
  It records the pin in target/.platform-tools-pin and, when that stamp does not match
  PLATFORM_TOOLS_VERSION, deletes target/sbpf-solana-solana so the next build is genuinely
  cold. This is necessary because cargo's fingerprint does not track the platform-tools
  version: without the guard, a build after a toolchain change reports "Finished in ~1.3s",
  recompiles nothing, and leaves an artifact built by the OTHER compiler sitting in
  target/deploy. That exact failure was reproduced in this repo on 2026-09-03 while testing
  the pin, which is why the guard exists rather than a comment telling people to be
  careful.

  WHY v1.52 AND NOT v1.53. anchor-cli 1.0.1 passes its OWN --tools-version to
  cargo-build-sbf and pins v1.52. It cannot be overridden: `anchor build -- --tools-version
  v1.53` fails with "the argument '--tools-version <STRING>' was provided more than once".
  Verified 2026-09-03 by watching a bare `anchor build` switch the registered rustup
  toolchain from v1.53 to v1.52 within 8 seconds. So v1.52 is the only value both paths can
  agree on today, and it is also the version that produced the deployed devnet binary,
  which therefore stays reproducible. Note Anchor.toml's solana_version key does NOT pin
  platform-tools: anchor documents -s/--solana-version and -d/--docker-image as applying to
  `--verifiable` docker builds only. Pinning anchor_version is what pins the anchor path.

  IF ANCHOR-CLI IS EVER UPGRADED, the tools version it selects will likely change and the
  two paths will silently diverge again. Re-run the cold-build proof below and update
  PLATFORM_TOOLS_VERSION to whatever the new anchor selects. Do not assume.

  COLD-BUILD PROOF, run 2026-09-03 at commit 0debdaa. Two fresh checkouts of the same tree,
  two fresh target dirs, one build per path:
    cargo path  scripts/build.sh                (passes --tools-version v1.52)
    anchor path anchor build --no-idl --ignore-keys (native v1.52, no override)
  Both took 17m 12s, so both genuinely recompiled, and both produced:
    sha256 31acf681b6b20206895ef3054d94b7419d97d67c2c1614cb51b5b53b12f1fed8, 470,553 bytes
  IDENTICAL. The two paths now agree. To re-run this proof, extract the tree twice with
  `git archive HEAD | tar -x -C <dir>`, build one copy each way, and compare the sha256 of
  each target/deploy/plotarmor.so with trailing zero bytes stripped. Use --ignore-keys on
  the anchor copy: a fresh extract has no target/deploy/plotarmor-keypair.json (target is
  gitignored), so anchor generates a random one and aborts on a program-ID mismatch. The
  keypair file does not affect the compiled bytes, since declare_id! is in source.

THE ORIGINAL DIVERGENCE, for context. `anchor build` / `anchor test` selected v1.52 while
`cargo build-sbf` defaulted to v1.53, and each silently uninstalled the other's rustup
toolchain on invocation. Which binary you got depended on which command you typed, and
this file's own former rebuild command for target/deploy-mainnet used cargo build-sbf
(v1.53) while target/deploy came from anchor build (v1.52), so those two artifacts were
compiled by different compilers. Never compare a hash across unpinned commands and assume
a source difference.

MAKING IT WORSE, cargo's fingerprint does not track the platform-tools swap. Observed twice
in one session: after switching toolchains, the SBF build reported "Finished release
profile in ~1.4s" having recompiled nothing and simply re-copied the artifact built by the
OTHER toolchain. `anchor test` did exactly this, so the .so it deployed to the local
validator was not built by the toolchain anchor had just selected. A build that finishes in
seconds after a toolchain change has not rebuilt anything. Note rust-toolchain.toml pins
the HOST rust (1.96.0) only and has no effect on the SBF build, which uses platform-tools'
own bundled rustc 1.89.0; it gives no reproducibility guarantee for the deployed artifact.

[workspace.metadata.cli] solana = "4.0.1" in the root Cargo.toml exists solely for
solana-verify. Do not remove it. solana-verify determines its docker image by reading that
key, falling back to scanning Cargo.lock for the `solana-program` crate. Anchor 1.0 uses
the split solana-* crates, so Cargo.lock contains no `solana-program` entry at all and the
fallback cannot work; without this key solana-verify fails with "Failed to determine Solana
version." Verified 2026-09-03 by reading solana-verify 0.5.1 source and by confirming
`solana-program` and `solana-sdk` are both absent from Cargo.lock.

ON-CHAIN security.txt: solana-security-txt 1.1.3, gated `#[cfg(not(feature =
"no-entrypoint"))]` in lib.rs above declare_id!. Measured cost 2026-09-03: +296 bytes under the
PINNED toolchain v1.52 (deployed 09c5bfc at 470,257 trimmed vs 0debdaa at 470,553; program
source is otherwise unchanged between those commits, so the delta is security.txt alone).
The same measurement under the unpinned v1.53 gave +496 bytes (454,017 -> 454,513); the
figure differs by compiler padding, so always state which toolchain a size came from. In
both cases the growth is entirely .rodata with .text byte-identical, so it adds no code and
no compute. It fits inside
the existing ProgramData allocation with roughly 17KB spare, so it needs no
`solana program extend` and no additional rent.

  BLOCKING: contacts and policy are UNRESOLVED PLACEHOLDERS pointing at the RFC 2606
  .invalid TLD, chosen deliberately so a deploy fails review rather than shipping a
  security contact nobody reads. THIS BINARY MUST NOT BE DEPLOYED until Milan supplies a
  real monitored security contact and a policy URL. No SECURITY.md exists in this repo yet.
  project_url and source_code are the literal string "private" because
  github.com/MJ-Frictionless-NTWRK/plotarmor-program is a private repo (confirmed 404
  unauthenticated 2026-09-03). source_revision, source_release and auditors are
  deliberately omitted rather than filled with provisional values; source_revision in
  particular would go stale silently on every deploy and become misleading evidence.

VERIFIED BUILDS are not yet possible here and are not merely unrun. Blockers, all confirmed
2026-09-03: docker is not installed on this machine; solana-verify is not installed; the
source repo is private, which blocks both verify-from-repo and remote submission; and
remote verification is mainnet-only, so devnet can never get a verification PDA or an
explorer badge, only a local hash comparison. A verified deployment therefore requires a
docker build AND a redeploy. Do not claim the deployed program is verifiable against HEAD;
it is not, and the reason is compiler drift, not source drift.

## Model guidance (Claude Pro: Sonnet default, Opus and Haiku both available on this plan)
- Default model for this project: Sonnet. It handles structs, most instructions, tests, and wiring.
- Use Haiku (`/model haiku`) for mechanical bulk work: renames, formatting, comment updates,
  find-and-replace across files. Cheapest; do not reason with it.
- Reserve Opus (`/model opus`, ~2x Sonnet usage) for: the add_version anti-fork logic, a bug Sonnet
  cannot solve after two attempts, and the security review. Prefer resolving the hardest reasoning
  in the Claude chat window first, then return and have Sonnet implement the resolved approach.
- Switch back down to Sonnet or Haiku immediately after a hard task; do not leave Opus running for
  routine edits. Run `/usage` to check the remaining window before a large task.

## Lane assignment (token efficiency — do not violate)
Work is split across two agents to preserve the Claude Pro window for what actually needs it.

Lane 1 — Claude Code (this session), Opus reserved for hard logic:
- Anchor program correctness: PDA seeds, anti-fork logic (add_version StaleLineageHead),
  threshold arithmetic, init_if_needed guards, account constraints
- Security review and architectural decisions
- Anything flagged COME TO CLAUDE CHAT or requiring Opus per the model assessment protocol

Lane 2 — Codex (GPT Plus), NOT Claude Code or Claude Chat:
- Boilerplate and test scaffolding
- React/web3 hook wiring (frontend IDL -> typed hooks -> wallet adapter)
- Mechanical demo-repo work: Edge Functions, query layer plumbing, UI wiring
- Anything Claude Code would flag SWITCH TO HAIKU should be evaluated for Codex instead --
  if it's mechanical wiring rather than Anchor-program-adjacent logic, it belongs in Codex.

Rule: before starting demo-repo (plotarmor-demo) frontend/wiring work in Claude Code or
Claude Chat, ask: "could this run in Codex instead?" If yes, it should run in Codex, not here.
This preserves the Claude Pro window for Lane 1 work, which is the harder and more
consequential lane (rights-evidence correctness on-chain).

Handoff rule: if Codex produces a change that touches the on-chain program, instruction
signatures, PDA seeds, or account structs, bring the diff to Lane 1 for review before merging.

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

Finding 1 (RESOLVED 2026-07-03): anchor_mode_arg was caller-controlled with no
environment cross-check. assert_mode_allowed previously only rejected AnchorMode::Simulated
on mainnet-featured builds; a caller could pass AttestedMainnet on a devnet build, or
AttestedDevnet on a mainnet build, with nothing catching the mismatch. Decided in Claude
Chat 2026-07-03 (Option 1): extend the existing feature-gated rejection pattern
symmetrically. Mainnet builds now also reject AttestedDevnet; non-mainnet builds now
reject AttestedMainnet. Both reuse error code AnchorModeNotAllowed (6002), not a new
code. See AUDITOR_BRIEF.md section 7 for full verification detail (5 passes: two live
cargo test runs against freshly rebuilt .so artifacts for each feature set, one live
anchor test run, one independent agent re-audit, one live devnet check against the
redeployed program itself via scripts/finding1_live_check.ts). Committed as 3bf2ac3
and DEPLOYED to devnet 2026-07-03 (upgrade tx
4zrHzvCEstu991QtUeLLU9QkZFxX1jHLuKA27KBAHMY5m7qU6sWdoXjPUsgiiTZvvKTVwdPwQ3GqfqYfzi37pExD).
The program account needed a one-time `solana program extend` (+10240 bytes) before the
upgrade fit; mechanical Solana CLI requirement (ExtendProgram minimum increment), not a
program-logic change.

F. CONFIRMED SPEC DEVIATION 2026-07-04: ContractArtifact's kind field is named
   content_kind in the deployed program (state.rs, IDL, generated TS client:
   contentKind), but the white paper (Section 8.6, Appendix B.1) names this field
   contract_kind for ContractArtifact. Almost certainly copy-pasted from
   ContentArtifact's own (correctly-named) content_kind field and never renamed
   when ContractArtifact was added. This does NOT affect the instruction argument:
   anchor_evidence_contract/anchor_authorized_contract's contract_kind argument
   (contractKind in TS) is correctly named and matches the white paper -- only the
   ACCOUNT STRUCT FIELD that stores the value on-chain deviates. Confirmed live via
   `grep -n "struct ContractArtifact" -A6 programs/plotarmor/src/state.rs` and the
   generated IDL/TS types (target/idl/plotarmor.json, target/types/plotarmor.ts).
   Not fixed here: renaming a Rust struct field requires a program redeploy
   (field names are not part of Borsh account serialization/layout, so a rename
   is non-breaking to existing on-chain data, but still requires recompiling and
   upgrading the deployed program). Flag any further work touching this field
   with COME TO CLAUDE CHAT if a rename is ever considered, since it touches a
   locked account struct per this file's hard rules.

G. ContractSignature.content_hash naming, confirmed correct 2026-07-15: verified against
   the literal struct definition in state.rs (`grep -n "struct ContractSignature" -A6
   programs/plotarmor/src/state.rs`) that the field is named content_hash, matching
   sign_contract-spec.md Section 2 exactly -- no deviation, no rename needed. This differs
   from ContractArtifact's own hash field name (raw_hash); the difference is NOT an
   intentional distinction between the two structs -- it reflects an earlier spec draft,
   not a deliberate design choice. Do not read design intent into the naming difference.
   is_initialized was deliberately omitted from ContractSignature: that flag exists only to
   guard init_if_needed accounts (ContentArtifact, ContractArtifact) against a second
   overwriting init call. ContractSignature uses plain init (per spec, confirmed in
   sign_contract.rs), so Anchor's own account-already-exists check at the runtime level
   already rejects a second signature attempt -- there is no second init call to guard
   against, so the flag would be dead weight. This matches the existing convention: every
   other init-only account in the program (WorkClaim, Ownership, OwnerRecord,
   ClaimArtifactLink, EvidenceAnchor, AuthorizedContractAnchor, AnchorRecord) also has no
   is_initialized field; only the two init_if_needed accounts do.

H. THRESHOLD IS A LEDGER OF STATED INTENT, NOT AN ENFORCED CONTROL. Audit finding M3,
   2026-09-03; documented 2026-09-04, no code change. This is the exact parallel of the
   ContractSignature caution above (state.rs signer field, and item G): that one says a
   signature proves "this wallet signed this hash," not "the creator signed." This one says
   Ownership.threshold_shares and OwnerRecord.share accurately record what the parties
   STATED, and nothing more.

   Ownership.threshold_shares, Ownership.total_shares and OwnerRecord.share are written and
   range-checked on the way in, and then never read by any authorization decision anywhere
   in the program. Re-verified 2026-09-04 by grepping every occurrence in
   programs/plotarmor/src: every single one is a struct declaration, a handler parameter, a
   range check on the value being written, or a write. Not one is a read feeding a decision.

   What actually authorizes each instruction today:
     add_version                 has_one = claimant           ONE signer, the claimant
     anchor_authorized_contract  admin.key() == ownership.admin  ONE signer, the admin
     add_owner                   has_one = admin              ONE signer, the admin
   anchor_authorized_contract is named "authorized" and the white paper specifies
   "threshold-meeting signatures from the WorkClaim's Ownership," but the deployed check is
   a single admin key. See also limitations A and E, which are the same gap seen from the
   instruction side; item H is that gap stated once from the data side.

   CONSEQUENCES, none of them hypothetical:
   - A single admin can act regardless of the recorded threshold. threshold_shares = 3 of 5
     does not stop the admin acting alone, because no code path consults it.
   - add_owner lets the admin set new_threshold_shares to any value in (0, new_total],
     including 1 (add_owner.rs, the new_threshold_shares > 0 && <= new_total check). See
     limitation D.
   - ThresholdNotMet (6007) is defined in error.rs and is raised by nothing. Confirmed by
     grep: the only occurrences are the enum variant and a comment.

   DO NOT DESCRIBE threshold_shares AS AN ON-CHAIN CONTROL, in UI, in partner or case-study
   material, in the Rights Index, or in anything court-facing. It is a truthful record of
   what the parties said they agreed, timestamped and immutable, which has real evidentiary
   value on its own terms. It is not a mechanism that prevented anybody from doing anything.
   Saying otherwise would overstate what the chain proves, which is the same failure mode
   the ContractSignature caution exists to prevent.

   This is a documentation fix, not a code fix. Real enforcement requires the custody-model
   decision (Decision 5, pending Sali Law Group) before implementation. Flag any work that
   would start enforcing thresholds with COME TO CLAUDE CHAT.

Implementation detail (not a limitation): register_work_claim sets initial OwnerRecord.role = 0 (Unspecified). If Author attribution is required, it must be set via a subsequent add_owner call.

UNVERIFIED CLAIM, flagged 2026-07-15: the line below ("confirmed clean by the Solana MCP
program_autofixer") has been in this file since its first commit (3e9cfa9, 2026-06-11) with
no reconstructable record of it ever actually running. No tool named program_autofixer is
discoverable in this project's toolset, and this project directory (plotarmor-program) has
no MCP server configured at all (empty mcpServers entry). A real Solana MCP server
(solana-mcp / solana-mcp-server, https://mcp.solana.com/mcp) is configured for two sibling
project paths (/home/sucka/plotarmor, /home/sucka/plotarmor/plotarmor), but that is a
different project directory, was not connected in the session that investigated this, and
there is no evidence a tool called program_autofixer exists on it or was ever invoked. Per
this file's own Verification standard, do not treat the sentence below as a completed audit
pass. Do not cite it as evidence of anything until someone produces an actual transcript or
tool output showing this check ran.

REAL RUN, 2026-07-15 (this note is additional evidence; it does not replace the flag above --
the ORIGINAL 2026-06-11 claim was still never backed by a real run, per the transcript search
documented in that flag): the solana-mcp server (https://mcp.solana.com/mcp) was registered
to this project directory via `claude mcp add --transport http solana-mcp
https://mcp.solana.com/mcp` and confirmed connected (`claude mcp list`). A session restart
was needed for tools to become visible; even after restart and a stable "Connected" health
check, Claude Code's own tool index for this session never surfaced any solana-mcp tools
(confirmed via repeated ToolSearch calls for the exact tool names). Rather than requesting a
third restart, the live server was queried directly over its own JSON-RPC/HTTP protocol
(the same protocol the native tool wiring uses), which is a real call to the real server,
not a simulation.

`tools/list` against the live server confirmed 5 tools exist, exact current names and
descriptions: `list_sections` (catalogue of Solana doc sources), `get_documentation`
(fetch full docs by source/section id), `Solana_Documentation_Search` (semantic RAG search),
`Solana_Expert__Ask_For_Help` (RAG Q&A framed for debugging), and `program_autofixer`
("Static security linter for Solana program Rust (Pinocchio + Anchor). Returns issues (with
stable `fingerprint`), suggestions, detected framework, `false_positive_hints`... and
`require_another_tool_call_after_fixing`."). program_autofixer is real and current --
the original 2026-06-11 claim named a tool that does in fact exist, even though that
specific claim was never shown to have actually been run.

program_autofixer was called for real via `tools/call` against all 14 .rs files under
programs/plotarmor/src (constants.rs, error.rs, helpers.rs, instructions.rs, lib.rs,
modes.rs, state.rs, and all 7 files under instructions/, INCLUDING sign_contract.rs, which
did not exist in June), concatenated to 43,713 bytes, framework hint "anchor". Full actual
response:
`{"issues":[],"suggestions":[],"framework_detected":"anchor","false_positive_hints":{},
"require_another_tool_call_after_fixing":false}`
-- zero issues, framework correctly detected, no further pass required.

Because an all-clear result is exactly the failure mode this whole investigation started
from, the tool was sanity-checked before trusting that output: a deliberately broken Anchor
snippet (unchecked balance subtraction, an `AccountInfo` field opting out of typed
validation) was submitted the same way. It correctly returned 3 issues (2 medium
unchecked-arithmetic, 1 low anchor-unchecked-account) with real rule names, locations,
descriptions, suggestions, and `require_another_tool_call_after_fixing: true`. This confirms
the tool is genuinely functioning, not returning an empty stub -- the clean result on the
real program above is a real finding, not a broken response.

Scope note: this checks mechanical/security lint patterns only (unchecked arithmetic,
untyped account fields, similar static rules). It says nothing about the business-logic
gaps already identified independently in this file (Known v1 Limitations A, D, E; the
Appendix C.6/C.10 threshold-enforcement gap) -- those are design decisions, not the kind of
issue this linter class checks for, and it correctly did not flag them.

ROOT CAUSE FOUND, 2026-07-15 -- why the native tool call needed a workaround at all: this
is a known, currently unresolved Claude Code bug, not a problem with this project's MCP
config. `claude mcp list` reported solana-mcp as "Connected" (stable across repeated
checks), yet `ToolSearch` for "program_autofixer", "solana-mcp", "solana", and "anchor
security" all returned "No matching deferred tools found" in the interactive session,
including after a full session restart. Byte-for-byte config comparison across all three
project directories ruled out scope/setup: this project's entry
(`{"type": "http", "url": "https://mcp.solana.com/mcp"}` under key "solana-mcp") is
structurally identical to /home/sucka/plotarmor's working entry -- not a config mistake.

Running `claude -p "..." --debug --debug-file <path>` (one-shot, non-interactive) surfaced
the actual mechanism: Claude Code loads a baseline pool of "deferred tools" at process start
(logged as "Dynamic tool loading: 0/20 deferred tools included"), and MCP-provided tools are
merged into that pool ASYNCHRONOUSLY sometime after -- a first one-shot process with a
generic prompt saw the pool stay at 20 (solana-mcp's 5 tools never merged in before the
process exited). A second one-shot process, given a prompt naming program_autofixer
explicitly, logged `ToolSearchTool: cache invalidated - deferred tools changed` followed
immediately by `ToolSearchTool: keyword search for "program_autofixer", found 1 matches`,
then `Dynamic tool loading: 1/25 deferred tools included` -- the pool grew from 20 to 25
(solana-mcp's 5 tools arrived) between process start and that ToolSearch call, and the
model successfully reached a real permission prompt for `mcp__solana-mcp__program_autofixer`
(denied only because `-p` mode has no TTY to approve it, not because the tool wasn't found).

This means: the deferred-tool pool merge is a real, working mechanism that CAN and DID
succeed within a single short-lived process. In the long-running interactive session used
for this whole investigation (including the one that followed the task-3b restart), that
merge evidently never landed during ToolSearch's lifetime, and nothing later re-triggers it
-- `claude mcp list`'s ongoing "Connected" health check is a different, lighter check than
the one-time pool-merge and does not reflect whether the merge succeeded.

CORRECTED 2026-07-15 (second pass): all 7 candidate anthropics/claude-code GitHub issues were
individually fetched and checked, not assumed from title alone. All 7 are CLOSED (not "open" --
an earlier draft of this note wrongly said "currently open," caught and fixed here). Of the 7,
only two are actual matches to this project's specific symptom (Connected via `claude mcp
list`, ToolSearch finds nothing, persists across restart, generic locally-configured HTTP
server): #39167 ("MCP server tools not exposed in session despite server responding
correctly," closed with no visible fix) and #38245 ("MCP server tools discovered but not
accessible via ToolSearch," closed as duplicate, no visible fix). The other five are real,
verified-to-exist bugs in the same general MCP/ToolSearch subsystem but describe DISTINCT
failure modes, not this one: #40314 is the opposite problem (HTTP tools loaded upfront,
un-deferred, causing token bloat -- not invisibility), closed as not planned; #25894 is
scoped specifically to the `mcp-remote` proxy tool, closed as duplicate; #60052 is about an
`InputValidationError` on first call AFTER the tool is found by ToolSearch, not tools never
being found, closed as duplicate; #55914 is scoped specifically to claude.ai-namespaced
remote connectors (Notion, Gmail, etc.), where the reporter states locally-configured
servers in the same session load fine, closed as duplicate; #42148 describes a closely
related mechanism (deferred-tool list frozen while MCP is "still connecting") but claims a
new user turn resolves it, which does not match what was observed here (many separate turns
across an extended session never recovered), closed as not planned. Do not cite the full
list of 7 as one undifferentiated "matching cluster" -- only #39167 and #38245 actually are.

Not fixable from this project's side -- it is client-side timing/caching behavior in the
Claude Code binary itself, not a settings or scope error. Workaround: `scripts/check_program_autofixer.sh`
concatenates every `.rs` file under `programs/plotarmor/src` and POSTs it directly to
`https://mcp.solana.com/mcp` over the same JSON-RPC/HTTP protocol Claude Code's own MCP
client uses -- a real call to the real tool, not a simulation, and it does not depend on
ToolSearch or native tool-calling working at all. Treat this as the durable path for running
program_autofixer going forward; do not spend further time trying to make the native path
work in an interactive session before checking this file first. A brand new interactive
session MIGHT succeed if its process start happens to land after the async merge completes
(as the one-shot tests showed is possible) -- but this is not guaranteed, and the script
works regardless.

Script confirmed usable going forward, checked 2026-07-15 (second pass, not just
demonstrated once): committed to git as a standalone file (commit 25db31f, "1 file changed,
74 insertions", not bundled with any other pending change); executable (mode 100755,
preserved through the commit); re-run independently from a fresh `bash -c` subshell
(different PID) and produced the byte-identical clean result; separately re-run with cwd set
to `/tmp` and invoked by full path to confirm `REPO_ROOT`/`SRC_DIR` resolution depends on the
script's own location (`${BASH_SOURCE[0]}`), not on cwd -- also byte-identical. Prerequisites
(curl, python3) are documented in the script's own header comment (line 14), which is the
only reachable place they are documented: a file named
`plotarmor-program-PRE_DEPLOY_CHECKLIST.md`, referenced as if it already existed and cross-
referenced this script, does NOT exist anywhere in this repo or elsewhere on this machine
(checked via `find`) -- if that checklist is meant to exist, it has not been created yet;
do not assume it does without checking again.

These findings were confirmed clean by the Solana MCP program_autofixer (zero mechanical
issues) and identified by manual review against the spec. Prague auditors should review
against Appendix C invariants and Appendix G acceptance checklist specifically.

## Test coverage report (June 2026; Rust count updated 2026-07-22, see sign_contract below)

Two suites run against the deployed program, totaling 74 tests as of commit c40f09a: 44
Rust/LiteSVM and 30 TypeScript/Mocha (local validator). All 74 pass as of that commit.

As of the 2026-07-03 Finding 1 fix (commit 3bf2ac3, deployed to devnet): Rust/LiteSVM was
45 tests per build (one test in security_tests.rs is build-specific: devnet default build
runs attested_mainnet_rejected_on_non_mainnet_build, mainnet-featured build runs
attested_devnet_rejected_on_mainnet_build instead). TypeScript/Mocha remained 30, unaffected.
Combined per-build total was 75. See AUDITOR_BRIEF.md section 7 for full verification detail.

As of the 2026-07-15 sign_contract addition (commit 09c5bfc, see Instructions v1 set and
Known v1 limitations item G): Rust/LiteSVM is now 52 tests per build (the 45 above plus 7
in sign_contract_tests.rs). Combined per-build total at that point: 82 (52 Rust + 30
TypeScript, sign_contract not yet covered at Layer 2).

As of 2026-07-22 (this session, still commit 09c5bfc -- no source change, docs/tests only):
TypeScript/Mocha is now 34 tests (30 above plus 4 new sign_contract tests in
tests/plotarmor.ts: 1 happy path asserting contractArtifact/signer/contentHash match and
signedAt/slot are populated from the chain, plus 3 rejections mirroring
sign_contract_tests.rs -- wrong content_hash -> ContentHashMismatch 6011, double-sign by
same signer -> already in use, signing a nonexistent ContractArtifact -> account-validation
failure). Combined per-build total: 86 (52 Rust + 34 TypeScript).

Live-verified 2026-07-22 (2 of 4 passes now complete):
(1) both the default (devnet) build and `cargo test --features mainnet` ran clean at
52/52, after rebuilding target/deploy-mainnet/plotarmor.so, which had gone stale since the
2026-07-03 Finding 1 deploy and did not yet contain the sign_contract instruction -- 6 of
the 7 sign_contract_tests.rs cases failed with InstructionFallbackNotFound against the
stale binary before the rebuild (build-artifact staleness, not a program-logic bug; see the
rebuild command in the Toolchain section).
(2) `anchor test` (TypeScript/Mocha, local validator -- a distinct execution harness from
LiteSVM) ran clean at 34/34 on first run, including the 4 new sign_contract tests.
Per this file's own Verification standard, this is 2 of 4 required passes -- do not treat
this as a closed claim until 2 more independent passes (e.g. an independent re-audit, a
live devnet adversarial re-check) have run.

Live-verified 2026-07-22 (session 2, this session -- 4 of 4 passes now complete):
(3) Independent re-audit: sign_contract.rs, state.rs, error.rs, and sign_contract-spec.md
were read fresh against each other in a separate session from the one that ran passes 1-2.
Confirmed: ContractSignature field layout and LEN (121 bytes) match the spec exactly;
error.rs's ContentHashMismatch is the only sign_contract-specific error code (UnauthorizedSigner
from the original spec draft was correctly never added, since Milan's Option 2 decision
dropped the on-chain creator check -- see Known v1 limitations item G); the seeds-vs-handler
double-check pattern for content_hash (PDA re-derivation from the account's own raw_hash,
separately checked against the client's content_hash argument) matches the comment rationale
in sign_contract.rs exactly. As part of this same pass, both cargo test builds (default and
--features mainnet) were independently re-run and reconfirmed 52/52 each, and anchor test was
independently re-run and reconfirmed 34/34 -- all three suite runs are new executions in this
session, not a re-read of the prior session's output.
(4) Live devnet adversarial check: the gap explicitly flagged in the Devnet script inventory
section below (no adversarial devnet scenarios for sign_contract had ever been run live, only
in LiteSVM and against a local validator) was closed. New script
scripts/devnet_sign_contract_adversarial_test.ts runs the three rejection paths against the
live deployed devnet program (3h9CzV9MJDeD5yjhVhdE6cupuXVRnLW1Cu6P14EJBKv2): wrong content_hash
-> ContentHashMismatch 6011, double-sign by the same signer -> already-in-use, and signing a
nonexistent ContractArtifact -> account-validation failure. All 3 passed on first live run
(fixture tx 4sgyWokaGGCYo3zHpHe82u8F91U76jZDNCxF1gQjRMJwn4BCpyaX6mp7CFJ4TXzCWQ5mf7uN8CGtbDRBPC3BoeJg,
first-sign tx XXaX1toBSGNThRXzyJAgroKZUpR7A7yecvfeRC5b9gyfBHDaMPCJLskxKq78oYC2oEmH5c16xg36Ati7mNnjCqY).
scripts/verify_calls.py and scripts/check_integrity.py both pass against the new file (5 call
sites, all correct arg counts and account/terminator shape); the full-repo grep for all 5
instruction call-site patterns was re-run and turned up nothing missed.
Per this file's own Verification standard, sign_contract has now completed all 4 required
verification passes: (1) LiteSVM/mainnet-featured build, (2) anchor test/local validator,
(3) independent re-audit, (4) live devnet adversarial check. This closes the previously
open item; the only remaining known gap is the design-accepted absence of an on-chain
creator/party check (Known v1 limitations item G, deliberate, not a verification gap).

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

Error codes confirmed rejecting correctly (all 16 negative TypeScript tests pass):
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

Auditor brief: AUDITOR_BRIEF.md in the repo root covers test coverage, invariants, error codes, known limitations A-E, and audit focus areas. Commit: c40f09a.
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

## Permanent verification toolchain (run before every commit)
- `python3 scripts/verify_calls.py scripts/measure_devnet.ts tests/plotarmor.ts scripts/devnet_register_test.ts scripts/devnet_ext_ref_hash_test.ts scripts/devnet_sign_contract_test.ts scripts/devnet_sign_contract_adversarial_test.ts`
  Checks argument counts for all 5 instruction call sites across all 6 TS files that call
  program instructions. Expected: registerWorkClaim=9, addVersion=7, anchorEvidenceContract=6,
  anchorAuthorizedContract=5, signContract=1. Fixed 2026-07-01: previously only read argv[1] and
  silently skipped every other file passed on the command line while still reporting success.
  UPDATED 2026-07-22: added devnet_sign_contract_test.ts to the file list and signContract=1
  to EXPECTED in both scripts/verify_calls.py and scripts/check_integrity.py -- neither had
  been updated when sign_contract was added on 2026-07-15, so signContract call sites were
  silently unchecked by this toolchain until this fix.
  UPDATED 2026-07-22 (session 2): added devnet_sign_contract_adversarial_test.ts to the file
  list; both checkers pass against it (5 call sites, all correct).
- `python3 scripts/check_integrity.py scripts/measure_devnet.ts tests/plotarmor.ts scripts/devnet_register_test.ts scripts/devnet_ext_ref_hash_test.ts scripts/devnet_sign_contract_test.ts scripts/devnet_sign_contract_adversarial_test.ts`
  Checks args + .accountsStrict() present + .rpc()/.instruction() terminator for every call.
- Both tools exit non-zero on any failure. Run both after any instruction signature change.
- `python3 scripts/test_checkers_negative.py` — negative-test suite for both checkers above;
  run after modifying either checker to confirm they still detect bad calls.
- FULL-REPO GREP before any instruction signature change:
  `grep -rn "\.registerWorkClaim\|\.addVersion\|\.anchorEvidenceContract\|\.anchorAuthorizedContract\|\.signContract" . | grep -v node_modules | grep -v target`

## Devnet script inventory (scripts/)
- `measure_devnet.ts` — 24 scenarios (1-7, 9-24; scenario 8 merged into 6). Primary devnet
  proof suite. Exits non-zero on any failure. Run with:
  `HELIUS_API_KEY=<key> node_modules/.bin/ts-node --transpile-only scripts/measure_devnet.ts`
- `devnet_register_test.ts` — standalone proof script for register_work_claim with real CID digest
- `devnet_ext_ref_hash_test.ts` — 14 adversarial scenarios across all 4 instructions:
  realistic CIDv0 digest, all-ones boundary, invalid contract_kind=99, invalid anchor_mode_arg=99.
  All 14 pass on live devnet.
- `finding1_live_check.ts` — one-off (not part of the permanent suite) live verification
  that the redeployed devnet program rejects anchor_mode_arg=AttestedMainnet(2) with
  AnchorModeNotAllowed(6002) and still accepts AttestedDevnet(1). Run 2026-07-03 against
  commit 3bf2ac3, both scenarios passed.
- `devnet_sign_contract_test.ts` (added 2026-07-15) — standalone proof script for
  sign_contract. Single happy-path scenario: anchor_evidence_contract creates a fresh
  ContractArtifact, then sign_contract signs it, then the resulting ContractSignature is
  independently decoded from raw connection.getAccountInfo bytes (not the Anchor client's
  fetch echo) and checked field-by-field (owner, contract_artifact, signer, content_hash,
  signed_at > 0, slot > 0). This was, until the adversarial script below was added, the only
  live-devnet coverage sign_contract had.
  UPDATED 2026-07-22: added a wallet balance-delta cost measurement isolated to the
  sign_contract call (before/after connection.getBalance around step 2 only, not step 1's
  anchor_evidence_contract). Real measured cost: 1,738,040 lamports (0.00173804 SOL, ~$0.1564
  at $90/SOL) = 1,733,040 lamports rent-exemption for the 121-byte ContractSignature account
  + 5,000 lamports base tx fee. See Cost baseline section for the canonical figure and tx id.
- `devnet_sign_contract_adversarial_test.ts` (added 2026-07-22, session 2 -- closes the gap
  the entry above used to flag): the 3 adversarial sign_contract paths, run live against the
  deployed devnet program (previously covered only in Rust/LiteSVM and TypeScript/local-validator,
  never against a real devnet RPC): wrong content_hash -> ContentHashMismatch 6011, double-sign
  by the same signer -> already-in-use, signing a nonexistent ContractArtifact -> account-
  validation failure. All 3 passed on first live run. Run with:
  `DEVNET_RPC_URL=<url> node_modules/.bin/ts-node --transpile-only scripts/devnet_sign_contract_adversarial_test.ts`

## external_ref_hash — full coverage summary
- All 4 anchoring instructions accept and store external_ref_hash: [u8; 32]
- Rust LiteSVM: 10 adversarial stress tests (zeros, all-ones, realistic CIDv0 digest, distinct
  per instruction) in security_tests.rs — helpers: add_version_with_ext_ref,
  anchor_evidence_with_ext_ref, anchor_authorized_with_ext_ref
- TypeScript: externalRefHash assertions in all 3 happy-path AnchorRecord tests
- Devnet round-trip: all 4 instructions verified YES-MATCH via measure_devnet.ts readback
- devnet_ext_ref_hash_test.ts: 14 adversarial devnet scenarios, all green
- CID digest extraction: bytes 2-33 (0-indexed) after stripping 0x12 0x20 multihash prefix

## Demo repo integration (plotarmor-demo, commit 3c3f8c9)
- `src/anchor/plotarmor.json` and `src/anchor/plotarmor.ts` — IDL and types copied from
  target/ after each anchor build. Keep in sync when program changes.
- `@solana/web3.js` and `@coral-xyz/anchor` installed as dependencies in demo repo.
- `src/vault/ipfs.ts` — cidToExternalRefHash() and cidToExternalRefHashArray() utilities.
  Use cidToExternalRefHashArray(cid) when passing external_ref_hash to program instructions.
- IPFS wiring: UploadFlow.tsx uploads encrypted blobs via Supabase Edge Function
  (supabase/functions/upload-to-ipfs/index.ts) to Pinata. file_path = "ipfs://" + cid.
  ipfs_cid column added to works table.
- Download routing: downloadFile(rawFilePath) in queries.ts branches on ipfs:// vs supabase://.
  Existing works with supabase:// paths unaffected.
- Cross-repo wiring proven: scripts/pa_solana_wiring_test.js uploads to Pinata, extracts
  CIDv0 digest, calls register_work_claim with that digest as external_ref_hash, reads back
  AnchorRecord.external_ref_hash on-chain — exact match confirmed on devnet.

## Wallet wiring (pending — do not start without human approval)
- Use @solana/wallet-adapter-react for Phantom/Backpack connection.
- Do NOT use @solana/kit for wallet connection (per canon above).
- register_work_claim triggered after successful IPFS upload in UploadFlow.tsx.
- Pass cidToExternalRefHashArray(cid) as external_ref_hash argument.
- Store returned PDAs (work_claim_pda, anchor_record_pda, content_artifact_pda) back to
  works row in Supabase. Progress anchor_state: "none" -> "submitted" -> "confirmed".
- Devnet only until told otherwise.
