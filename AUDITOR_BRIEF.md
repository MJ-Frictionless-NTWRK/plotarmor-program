# PlotArmor v1 Program — Auditor Brief

**Date:** June 2026
**Program ID:** `3h9CzV9MJDeD5yjhVhdE6cupuXVRnLW1Cu6P14EJBKv2`
**Network:** Solana devnet
**Framework:** Anchor 1.0.1, Rust 1.96.0, Solana CLI 4.0.1 (Agave)
**Spec reference:** PlotArmor White Paper v2.83

---

## 1. Scope

This brief covers the PlotArmor Anchor program implementing the v1 instruction set: `register_work_claim`, `add_version`, `add_owner`, `anchor_evidence_contract`, `anchor_authorized_contract`, `init_registry_config`, and `sign_contract` (added 2026-07-15, see §7). Year-two instructions (WorkMetadata, WorkRelation) are reserved PDA seeds, not implemented.

---

## 2. Program verification

**Mechanical review:** Solana MCP `program_autofixer` — zero issues found.

**Manual review:** Conducted against the white paper spec, Appendix C invariants, and Appendix G acceptance checklist.

**Test coverage — 86 tests total per build (52 Rust + 34 TypeScript), all passing as of commit `09c5bfc` (docs/tests only, no source change since), superseding the `3bf2ac3` count below:**

Layer 1 (Rust/LiteSVM, 52 tests per build: 1 unit test in `src/lib.rs` + 51 integration tests in `programs/plotarmor/tests/`; one test in `security_tests.rs` is build-specific, so the total is 52 on both the devnet default build and a `--features mainnet` build):
- `happy_paths.rs`: 11 tests — all instructions, content-addressing convergence, chained versions, chain reuse, reserved-field enforcement
- `security_tests.rs`: 33 tests — all error codes, atomicity, PDA collision, cross-claim rejections, enum boundary values, symmetric mainnet/devnet mode-rejection (Finding 1, see below)
- `sign_contract_tests.rs`: 7 tests (added 2026-07-15) — happy path, missing/nonexistent ContractArtifact, content_hash mismatch, double-sign-by-same-signer rejection, on-chain clock (not client-supplied) timestamp/slot, no-on-chain-creator-check confirmed (Option 2, see §7)
Live-verified 2026-07-22 (2 of the 4-pass standard): (1) both the devnet default build and `cargo test --features mainnet` ran 52/52 clean, after rebuilding `target/deploy-mainnet/plotarmor.so`, which had gone stale since the 2026-07-03 Finding 1 deploy and did not contain the `sign_contract` instruction — 6 of 7 `sign_contract_tests.rs` cases failed with `InstructionFallbackNotFound` against the stale binary before the rebuild (build-artifact staleness, not a program-logic defect); (2) `anchor test` (TypeScript/Mocha, local validator — a distinct execution harness from LiteSVM) ran 34/34 clean on first run, including the 4 new `sign_contract` tests below.

Layer 2 (TypeScript/Mocha, 34 tests, `tests/plotarmor.ts`, local validator; 30 original + 4 added 2026-07-22 for `sign_contract`):
- 15 happy-path tests with on-chain state assertions across all seven instructions
- 19 rejection tests confirming every error code path
- `sign_contract` Layer 2 coverage (added 2026-07-22): 1 happy path (creates `ContractSignature`, asserts `contractArtifact`/`signer`/`contentHash` match the submitted values and `signedAt`/`slot` are populated from the chain) + 3 rejections mirroring `sign_contract_tests.rs` — wrong `content_hash` → `ContentHashMismatch` (6011), double-sign by the same signer → account already in use, signing a nonexistent `ContractArtifact` → account-validation failure. No adversarial live-devnet coverage yet for these three paths — see §10.

*Prior count (`3bf2ac3`): 75 tests per build (45 Rust + 30 TypeScript). The 2026-07-15 `sign_contract` addition added 7 Rust tests, bringing the per-build Rust total to 52 and the combined total to 82. The 2026-07-22 Layer 2 addition brought TypeScript to 34 and the combined total to 86.*
*Prior count (`c40f09a`): 74 tests (44 Rust + 30 TypeScript).*

**Devnet scenario suite** (`scripts/measure_devnet.ts`): 24 scenarios (1-7, 9-24; scenario 8 intentionally merged into scenario 6) — positive measurements and adversarial edge cases. All pass. Script exits non-zero on any failure. `measure_devnet.ts` does not cover `sign_contract`; see `scripts/devnet_sign_contract_test.ts` above for its separate, standalone devnet proof.

---

## 3. On-chain invariants — confirmed green by TypeScript state assertions

| Invariant | Status |
|---|---|
| `latest_link.content_artifact == latest_artifact` after every chain-touching tx | CONFIRMED |
| `add_version` validates against `latest_link`, not `latest_artifact` (anti-fork) | CONFIRMED |
| Two `add_version` instructions in one tx: second reverts with `StaleLineageHead`; `latest_link` unchanged on-chain after revert | CONFIRMED |
| Root `ClaimArtifactLink` has `previous_link = zero pubkey`; `latest_link` is never zero after registration | CONFIRMED |
| Content-addressing convergence: two claimants, one `ContentArtifact`, two independent `WorkClaims` | CONFIRMED |
| `privacyMode=0`, `commitmentRoot=[0;32]`, `discoverability=0` (reserved fields) — enforced for all accounts that carry them | CONFIRMED |
| `AnchorRecord` for `register_work_claim`: `anchoredObjectKind=0` (WorkClaim), seeds off `workClaim` | CONFIRMED |
| `AnchorRecord` for `add_version`: `anchoredObjectKind=1` (ContentArtifact), seeds off `contentArtifact` | CONFIRMED |
| `AnchorRecord` for `anchor_evidence_contract`: `anchoredObjectKind=2` (EvidenceAnchor) | CONFIRMED |
| `AnchorRecord` for `anchor_authorized_contract`: `anchoredObjectKind=3` (AuthorizedContractAnchor) | CONFIRMED |
| `AnchorRecord.external_ref_hash: [u8; 32]` — all 4 anchoring instructions now accept and store this field instead of hardcoding zero. Intended to carry the 32-byte sha2-256 digest extracted from an IPFS CIDv0 (bytes 2–33 (0-indexed) of the base58-decoded CID, after stripping the 2-byte multihash prefix 0x12 0x20). Zero is a valid value (no IPFS binding). No uniqueness constraint — two records may share the same hash. Field is written unconditionally in all 4 handlers regardless of content_kind or contract_kind. Round-trip verified on devnet at slot 471473176. Adversarial stress tests: zeros, all-ones (0xFF×32), and realistic CIDv0 digest proven for all 4 instructions in Rust LiteSVM (security_tests.rs) and on live devnet (scripts/devnet_ext_ref_hash_test.ts, 14 scenarios). | CONFIRMED |
| `ContentArtifact.is_initialized` guard prevents field overwrite on `init_if_needed` second call | CONFIRMED |
| `ContractArtifact.is_initialized` guard prevents field overwrite on `init_if_needed` second call | CONFIRMED |

---

## 4. Error codes — confirmed rejecting correctly

| Code | Name | Verified by |
|---|---|---|
| 6000 | `AlreadyInitialized` | Reserved; not emitted by v1 handlers (`is_initialized` guard used instead) |
| 6001 | `StaleLineageHead` | TypeScript: stale link; two-instruction atomic revert confirmed via on-chain fetch |
| 6002 | `AnchorModeNotAllowed` | TypeScript: `content_kind=99`, `content_kind=255`, `claim_kind=99`. As of 2026-07-03 (Finding 1, see §7), also emitted for a symmetric environment mismatch: a mainnet-featured build rejects `anchor_mode_arg = AttestedDevnet`, and a non-mainnet build rejects `anchor_mode_arg = AttestedMainnet`. Verified by LiteSVM: `attested_devnet_rejected_on_mainnet_build` (mainnet-feature-gated), `attested_mainnet_rejected_on_non_mainnet_build` (default build). |
| 6003 | `SimulatedModeRejected` | Mainnet-feature-gated; not testable on devnet by design. Verified by LiteSVM: `cargo test --features mainnet`, `simulated_mode_rejected_on_mainnet_build`. (A build-tooling gap previously made this test load a stale non-mainnet `.so` regardless of the `--features mainnet` flag, correctly failing since the rejection logic was never compiled in; fixed 2026-07-01 by building a distinct mainnet-featured artifact — see `programs/plotarmor/tests/common/mod.rs`.) |
| 6004 | `ShareOverflow` | LiteSVM Rust tests |
| 6005 | `ShareSumMismatch` | TypeScript: `total=0`, `threshold>total`, `add_owner share=0`, `threshold=0`, `threshold>new_total` |
| 6006 | `ReservedFieldNonZero` | Reserved slot; not emitted in v1 |
| 6007 | `ThresholdNotMet` | Reserved slot; not emitted in v1 |
| 6008 | `Paused` | LiteSVM Rust tests |
| 6009 | `Unauthorized` | TypeScript: wrong claimant on `add_version`; wrong admin on `anchor_authorized_contract` |
| 6010 | `SupersededClaim` | LiteSVM Rust tests |
| 6011 | `ContentHashMismatch` | Added 2026-07-15 with `sign_contract`. LiteSVM: `wrong_content_hash_rejected` in `sign_contract_tests.rs`. Not yet exercised live on devnet. |

System Program `0x0` ("already in use") confirmed on: duplicate `OwnerRecord`, evidence replay, authorized contract PDA collision, `init_registry_config` second call, and (as of 2026-07-15) double-sign of the same `ContractSignature` PDA (`double_sign_by_same_signer_rejected`, LiteSVM only).

---

## 5. Locked enum numberings (on-chain integers, immutable post-deploy)

```
AnchorMode:           Simulated=0, AttestedDevnet=1, AttestedMainnet=2, UserSigned=3, MultiParty=4
AnchoredObjectKind:   WorkClaim=0, ContentArtifact=1, EvidenceAnchor=2, AuthorizedContractAnchor=3
ClaimKind:            Unspecified=0, Original=1, Adapted=2, WorkForHire=3, Derivative=4, Assignment=5
ContractKind:         Unspecified=0, Nda=1, WriterAgreement=2, Collaboration=3, Option=4,
                      OptionExtension=5, OptionExercise=6, Purchase=7, Amendment=8, Assignment=9,
                      License=10, Other=11
ContentKind:          Unspecified=0, Screenplay=1, Treatment=2, Outline=3, Contract=4,
                      Score=5, Master=6, Foley=7
OwnerRole:            Unspecified=0, Author=1, CoAuthor=2, Producer=3, Financier=4, Assignee=5
```

These integers are committed to devnet state and cannot change without redeployment.

---

## 6. Confirmed devnet cost baseline

At $90/SOL reference price (June 2026):

| Operation | Accounts created | Cost |
|---|---|---|
| `register_work_claim` | ContentArtifact + WorkClaim + Ownership + OwnerRecord + ClaimArtifactLink + AnchorRecord | ~$0.88 |
| `add_version` | ContentArtifact + ClaimArtifactLink + AnchorRecord | ~$0.39 |
| `anchor_evidence_contract` | ContractArtifact + EvidenceAnchor + AnchorRecord | ~$0.39 |
| `anchor_authorized_contract` | ContractArtifact + AuthorizedContractAnchor + AnchorRecord | ~$0.37 |
| Re-anchor (new `AnchorRecord` only) | AnchorRecord | ~$0.13 |
| `add_owner` | OwnerRecord | ~$0.13 |
| `init_registry_config` (one-time) | RegistryConfig | ~$0.11 |
| `sign_contract` (added 2026-07-15, measured 2026-07-22) | ContractSignature | ~$0.1564 (1,738,040 lamports = 1,733,040 rent-exemption for the 121-byte account + 5,000 base tx fee; measured live via wallet balance-delta, tx `mMCthtHF12bGA5YHhLmKzufokJdsjK779gk2z7dqdNd35pNvFBsUVLM1kGToAKD1DrmaM8GiaoX4FCWTYc2hB49`) |

---

## 7. Known v1 limitations — intentional, documented, require explicit decisions before changing

**A. Single-admin authorization on `anchor_authorized_contract`**
The spec says "threshold-meeting signatures." The deployed implementation checks `admin.key() == ownership.admin` (one signer). Acceptable for solo-creator case studies. Full threshold requires the custody-model decision (Decision 5, pending legal counsel).

**B. `init_registry_config` is unauthenticated**
The `[b"config"]` PDA can only be initialized once, so the first caller becomes protocol authority. Safe on devnet (controlled deploy). Must be constrained to program upgrade authority before mainnet.

**C. No pause or config-update instruction**
`paused` and `enabled_anchor_modes` in `RegistryConfig` have no setter. Intentionally deferred. Fail-safe: everything keeps working if the kill switch is never needed.

**D. Admin can set `threshold_shares` to any value in `(0, total_shares]`**
A negligent admin could set threshold = 1, nullifying multi-party protection. Acceptable for v1 single-owner case studies.

**E. `add_version` checks claimant signature only, not threshold approval**
White paper sections D.2 and 15.6 describe threshold approval for version advancement. The deployed implementation checks `signer == work_claim.claimant`. Matches v1 single-claimant flows. Full threshold requires the custody-model decision. This is a documented deviation, not a hidden gap.

**Finding 1 (resolved 2026-07-03): `anchor_mode_arg` was caller-controlled with no environment cross-check**
Prior to this fix, `assert_mode_allowed` (`programs/plotarmor/src/helpers.rs`) only rejected `AnchorMode::Simulated` on mainnet-featured builds. A caller could pass `anchor_mode_arg = AttestedMainnet` on a devnet build, or `AttestedDevnet` on a mainnet build, with no on-chain check catching the mismatch. Decided in Claude Chat 2026-07-03 (Option 1): extend the existing feature-gated rejection pattern symmetrically rather than leave it caller-controlled or document it as accepted risk. Mainnet builds now also reject `AttestedDevnet`; non-mainnet builds now reject `AttestedMainnet`. Both paths reuse error code `AnchorModeNotAllowed` (6002) rather than adding a new code, since 6002 already covers "mode not permitted in this context" for both invalid enum values and registry-config-gated modes; error codes 6000-6010 are treated as a fixed range in this project.
Verification status: 4 passes completed — (1) live `cargo test` on the default (devnet) build against a freshly rebuilt `.so`, 45/45 passing including the new `attested_mainnet_rejected_on_non_mainnet_build` test; (2) live `cargo test --features mainnet` against a freshly rebuilt mainnet-featured `.so` (`target/deploy-mainnet/plotarmor.so`, rebuilt via `cargo build-sbf`), 45/45 passing including `attested_devnet_rejected_on_mainnet_build` and the pre-existing `simulated_mode_rejected_on_mainnet_build`; (3) live `anchor test` (TypeScript/Mocha, local validator, a distinct execution harness from LiteSVM), 30/30 passing, confirming no regression to devnet-path behavior; (4) independent re-audit by a separate agent session with no access to this session's reasoning, which read the diff and the modified source files directly and signed off on cfg symmetry, blast radius, test correctness, and error-code reuse.
**Deployed to devnet 2026-07-03**, commit `3bf2ac3`, upgrade tx `4zrHzvCEstu991QtUeLLU9QkZFxX1jHLuKA27KBAHMY5m7qU6sWdoXjPUsgiiTZvvKTVwdPwQ3GqfqYfzi37pExD`. The program account required a one-time `solana program extend` (+10240 bytes) before the upgrade would fit; this is a Solana CLI mechanical requirement (ExtendProgram must be called with a minimum 10240-byte increment), not a program-logic change.
5th verification pass, live against the redeployed devnet program itself (not LiteSVM, not local validator): `scripts/finding1_live_check.ts` submitted two real `register_work_claim` transactions. `anchor_mode_arg = AttestedMainnet (2)` was rejected with `AnchorModeNotAllowed (6002)` as expected; `anchor_mode_arg = AttestedDevnet (1)` succeeded with no regression, confirmed tx `2cDLq1gWsDUMfKCtiHraGo6wCERv5eQ65SvQ5SmdhuJ8ji4MHVxVHBWPjKg5gNpxTMuAA91UUz2WT7wjQRqrCKhg`. Finding 1 is now fully resolved: source-complete, committed, deployed, and live-verified.

**F. `sign_contract` — no on-chain creator/party authorization check (added 2026-07-15, Option 2, locked by Milan)**
`sign_contract` records "this wallet signed this exact content hash at this on-chain time," not "the contract's creator or a listed party signed." `ContractArtifact` carries no creator/authority field (it is content-addressed and shared — any wallet's first call to `anchor_evidence_contract`/`anchor_authorized_contract` may have initialized a given hash), so there is no program-checked identity to restrict `signer` against. Any funded wallet can call `sign_contract` against any existing `ContractArtifact`. Creator/party restriction is enforced OFF-CHAIN only (Supabase/RLS gating which wallet the frontend will prompt to sign). Do not describe a `ContractSignature` as on-chain proof of *who* is a contractual party in UI or docs — only of *which wallet* signed *which content hash* *when*. The account structure (`ContractSignature`, one PDA per contract+signer pair) is intentionally shaped so a future on-chain party check can be added without a PDA redesign. See `sign_contract-spec.md` for the full design brief and locked decisions.

**G. `sign_contract` timestamp is program-captured, not client-supplied**
`signed_at` and `slot` come from `Clock::get()` inside the handler, never from an instruction argument. This is the load-bearing correctness property of the whole feature — a client-supplied timestamp would make "signed at this time" meaningless as evidence. Verified in LiteSVM (`signed_at_and_slot_come_from_onchain_clock_not_a_fixed_value`) and independently on live devnet by decoding raw account bytes rather than trusting the Anchor client's echo (`scripts/devnet_sign_contract_test.ts`).

---

## 8. Implementation detail for auditors

`register_work_claim` sets the initial `OwnerRecord.role = 0` (Unspecified). The white paper does not specify the initial role value for the registering claimant. If Author attribution is contractually required, it must be set via a subsequent `add_owner` call. This is not an error but should be reflected in client-side UX and onboarding documentation.

`ContentArtifact.content_kind` is set once, by whichever caller first initializes a given `raw_hash` (the `is_initialized` guard). A later caller reusing the same hash with a different `content_kind` succeeds without error and does not change the stored value. This is a shared-artifact data integrity quirk, not a security issue: clients must not assume the stored `content_kind` matches their own submission when the artifact already existed. Surfaced by the 2026-07-03 architecture review; behaviorally verified once via LiteSVM on 2026-07-03 (2 verification passes total, provisional until the 4-pass standard is met).

---

## 9. Execution-order observation (non-blocking)

The `Unauthorized` check in `add_version` uses a `has_one = claimant` account constraint (not a `require!()` in the handler body). Anchor's `init` constraints for `ClaimArtifactLink` and `AnchorRecord` execute before the `has_one` constraint, meaning a wrong-claimant call still creates and immediately rolls back those accounts within a single atomic transaction. There is no security impact (Solana's atomicity guarantees complete rollback). The `has_one` placement is the idiomatic Anchor pattern and is confirmed by devnet scenario 23 (3 System Program CPIs observed preceding the `Unauthorized` revert).

---

## 10. What auditors should focus on

Per the white paper, auditor review should cover Appendix C (invariants) and Appendix G (acceptance checklist). Priority areas:

- The `is_initialized` guard implementation in `register_work_claim` and `anchor_evidence_contract` (`init_if_needed` audit surface)
- The `StaleLineageHead` check logic in `add_version` (anti-fork guarantee)
- The `assert_mode_allowed` helper and its relationship to `RegistryConfig.enabled_anchor_modes`
- The mainnet `SimulatedModeRejected` compile-time rejection (`--features mainnet`, not testable on devnet by design)
- The new symmetric `AttestedDevnet`/`AttestedMainnet` environment-mismatch rejection (Finding 1, §7) — same compile-time-gated pattern, same untestable-on-devnet-by-design caveat until redeployed
- Limitations A-E above in the context of the case-study threat model
- `sign_contract`'s no-on-chain-creator-check design (limitation F, §7) in the context of what a `ContractSignature` can and cannot be represented as proving — this is the design decision most likely to be misread by someone skimming only the account struct
- `sign_contract` now has Layer 1 (LiteSVM) and Layer 2 (TypeScript/local-validator) coverage for all three adversarial paths, plus one live-devnet happy-path scenario, but the adversarial paths themselves (double-sign, wrong content_hash, nonexistent contract) have never been run against live devnet — only LiteSVM and a local validator. This is a smaller gap than before but not closed.

---

*Prepared: June 2026; test-count, scenario-count, and build-tooling corrections applied 2026-07-01. Program commit as of that date: `c40f09a`, 74 tests passing. Finding 1 fix deployed to devnet 2026-07-03, commit `3bf2ac3`, 75 tests passing per build, 5 verification passes (see §7). `sign_contract` instruction added 2026-07-15, commit `09c5bfc`. As of 2026-07-22 (docs, Layer 2 tests, and cost measurement added on top of `09c5bfc`, no source change): 86 tests passing per build (52 Rust + 34 TypeScript), sign_contract devnet cost measured at ~$0.1564, 2 of 4 required verification passes complete (see §2 and §7 items F-G) — not yet through the full 4-pass standard. Demo repo commit: `f6f82e0`. IPFS wiring complete.*
