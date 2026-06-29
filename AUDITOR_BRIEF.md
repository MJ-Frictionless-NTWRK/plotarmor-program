# PlotArmor v1 Program — Auditor Brief

**Date:** June 2026
**Program ID:** `3h9CzV9MJDeD5yjhVhdE6cupuXVRnLW1Cu6P14EJBKv2`
**Network:** Solana devnet
**Framework:** Anchor 1.0.1, Rust 1.96.0, Solana CLI 4.0.1 (Agave)
**Spec reference:** PlotArmor White Paper v2.83

---

## 1. Scope

This brief covers the PlotArmor Anchor program implementing the v1 instruction set: `register_work_claim`, `add_version`, `add_owner`, `anchor_evidence_contract`, `anchor_authorized_contract`, and `init_registry_config`. Year-two instructions (WorkMetadata, WorkRelation) are reserved PDA seeds, not implemented.

---

## 2. Program verification

**Mechanical review:** Solana MCP `program_autofixer` — zero issues found.

**Manual review:** Conducted against the white paper spec, Appendix C invariants, and Appendix G acceptance checklist.

**Test coverage — 57 tests total, all passing as of commit `cb61f79`:**

Layer 1 (Rust/LiteSVM, 44 tests, `programs/plotarmor/tests/`):
- `happy_paths.rs`: 11 tests — all instructions, content-addressing convergence, chained versions, chain reuse, reserved-field enforcement
- `security_tests.rs`: 32 tests — all error codes, atomicity, PDA collision, cross-claim rejections, enum boundary values

Layer 2 (TypeScript/Mocha, 30 tests, `tests/plotarmor.ts`, local validator):
- 13 happy-path tests with on-chain state assertions across all six instructions
- 17 rejection tests confirming every error code path

**Devnet scenario suite** (`scripts/measure_devnet.ts`): 21 scenarios — positive measurements and adversarial edge cases. All pass. Script exits non-zero on any failure.

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
| `AnchorRecord.external_ref_hash: [u8; 32]` — all 4 anchoring instructions now accept and store this field instead of hardcoding zero. Intended to carry the 32-byte sha2-256 digest extracted from an IPFS CIDv0 (bytes 3–34 of the base58-decoded CID). Zero is a valid value (no IPFS binding). No uniqueness constraint — two records may share the same hash. Field is written unconditionally in all 4 handlers regardless of content_kind or contract_kind. Round-trip verified on devnet at slot 471473176. Adversarial stress tests: zeros, all-ones (0xFF×32), and realistic CIDv0 digest proven for all 4 instructions in Rust LiteSVM (security_tests.rs) and on live devnet (scripts/devnet_ext_ref_hash_test.ts, 14 scenarios). | CONFIRMED |
| `ContentArtifact.is_initialized` guard prevents field overwrite on `init_if_needed` second call | CONFIRMED |
| `ContractArtifact.is_initialized` guard prevents field overwrite on `init_if_needed` second call | CONFIRMED |

---

## 4. Error codes — confirmed rejecting correctly

| Code | Name | Verified by |
|---|---|---|
| 6000 | `AlreadyInitialized` | Reserved; not emitted by v1 handlers (`is_initialized` guard used instead) |
| 6001 | `StaleLineageHead` | TypeScript: stale link; two-instruction atomic revert confirmed via on-chain fetch |
| 6002 | `AnchorModeNotAllowed` | TypeScript: `content_kind=99`, `content_kind=255`, `claim_kind=99` |
| 6003 | `SimulatedModeRejected` | Mainnet-feature-gated; not testable on devnet by design |
| 6004 | `ShareOverflow` | LiteSVM Rust tests |
| 6005 | `ShareSumMismatch` | TypeScript: `total=0`, `threshold>total`, `add_owner share=0`, `threshold=0`, `threshold>new_total` |
| 6006 | `ReservedFieldNonZero` | Reserved slot; not emitted in v1 |
| 6007 | `ThresholdNotMet` | Reserved slot; not emitted in v1 |
| 6008 | `Paused` | LiteSVM Rust tests |
| 6009 | `Unauthorized` | TypeScript: wrong claimant on `add_version`; wrong admin on `anchor_authorized_contract` |
| 6010 | `SupersededClaim` | LiteSVM Rust tests |

System Program `0x0` ("already in use") confirmed on: duplicate `OwnerRecord`, evidence replay, authorized contract PDA collision, `init_registry_config` second call.

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

---

## 8. Implementation detail for auditors

`register_work_claim` sets the initial `OwnerRecord.role = 0` (Unspecified). The white paper does not specify the initial role value for the registering claimant. If Author attribution is contractually required, it must be set via a subsequent `add_owner` call. This is not an error but should be reflected in client-side UX and onboarding documentation.

---

## 9. Execution-order observation (non-blocking)

The `Unauthorized` check in `add_version` (checking `signer == work_claim.claimant`) is a `require!()` in the handler body, not an Anchor account constraint. Anchor's `init` constraints for `ClaimArtifactLink` and `AnchorRecord` execute before the handler body, meaning a wrong-claimant call creates and immediately rolls back those accounts within a single atomic transaction. There is no security impact (Solana's atomicity guarantees complete rollback), but this is a code-style observation: converting to a `has_one = claimant` account constraint would run the check before any account initialization, which is more conventional. Noted for Ackee's discretion.

---

## 10. What auditors should focus on

Per the white paper, auditor review should cover Appendix C (invariants) and Appendix G (acceptance checklist). Priority areas:

- The `is_initialized` guard implementation in `register_work_claim` and `anchor_evidence_contract` (`init_if_needed` audit surface)
- The `StaleLineageHead` check logic in `add_version` (anti-fork guarantee)
- The `assert_mode_allowed` helper and its relationship to `RegistryConfig.enabled_anchor_modes`
- The mainnet `SimulatedModeRejected` compile-time rejection (`--features mainnet`, not testable on devnet by design)
- Limitations A-E above in the context of the case-study threat model

---

*Prepared: June 2026. Program commit: `cb61f79`. All 57 tests passing.*
