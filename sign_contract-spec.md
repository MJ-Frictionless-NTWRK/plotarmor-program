# PlotArmor — `sign_contract` Instruction Implementation Brief

**For:** Claude Code (on-chain lane)
**Scope:** Add a dedicated `sign_contract` instruction to the `plotarmor-program` Anchor program. Creator-only MVP, designed to generalize to multi-signer later.
**Verification standard:** 4-pass independent verification before any correctness claim is "done." This is deployed on-chain code — a wrong account structure produces permanently malformed anchored data, not a redeployable frontend bug. Treat accordingly.

> This is a design brief, not verified code. Every account constraint, seed, and error path below must be independently confirmed against the actual deployed program's existing account definitions before implementation, and the compiled/tested behavior must be verified on a local validator (and devnet) before it is considered working. The author of this brief cannot compile Rust or observe on-chain behavior; nothing here is pre-verified.

---

## Design decisions (locked, per Milan)

These were decided deliberately. Do not silently change them; if implementation reveals one is unworkable, stop and flag it rather than substituting.

1. **Records:** signer pubkey, contract content hash, on-chain timestamp captured by the program itself.
2. **PDA structure:** one PDA per signature, so multiple signatures per contract are possible later without a breaking redesign.
3. **Dependency:** the contract must already exist on-chain as a `ContractArtifact` before it can be signed. `sign_contract` does not stand alone.
4. **Authorization:** MVP requires the signer to be the contract creator, but the account structure should be written so this generalizes to "signer is a listed party" without a PDA redesign.
5. **Events:** stay consistent with the program's existing no-event, pull-based (`getProgramAccounts`) pattern. Do NOT add an event emission. Ingestion for the Rights Index will be pull-based like everything else.

---

## 1. Timestamp — the critical correctness point

The timestamp MUST be captured on-chain by the program using Solana's clock sysvar:

```rust
let clock = Clock::get()?;
let signed_at = clock.unix_timestamp; // i64
```

**Do not accept a timestamp as a client-supplied instruction argument.** The entire evidentiary value of "signed at this time" collapses if the client can pass an arbitrary timestamp. The program capturing it via `Clock::get()` is what makes it trustworthy — it is the blockchain's own notion of time (the slot's block time), not the signer's claim about time. This is the single most important line in the instruction; if it is wrong, the feature is worthless.

Record both the `unix_timestamp` and, if cheap, the `slot` (`clock.slot`) for cross-referencing against block explorers.

---

## 2. New account: `ContractSignature`

A new PDA account, one per (contract, signer) pair.

**Suggested fields** — confirm sizing against the existing account definitions' conventions in the program:

```rust
#[account]
pub struct ContractSignature {
    pub contract_artifact: Pubkey,   // 32 — the ContractArtifact PDA this signs
    pub signer: Pubkey,              // 32 — the signing wallet
    pub content_hash: [u8; 32],      // 32 — contract content hash, must match the ContractArtifact's stored hash
    pub signed_at: i64,              //  8 — Clock::get().unix_timestamp, program-captured
    pub slot: u64,                   //  8 — Clock::get().slot, for explorer cross-reference
    pub bump: u8,                    //  1
}
```

**Space:** `8 (discriminator) + 32 + 32 + 32 + 8 + 8 + 1 = 121 bytes`. Confirm this against how existing accounts compute space in the program (some use `InitSpace`, some hardcode — match the existing convention, do not introduce a new one).

### PDA seeds

```
[b"signature", contract_artifact.key().as_ref(), signer.key().as_ref()]
```

This makes each (contract, signer) signature unique and deterministic. A given signer can sign a given contract exactly once — a second attempt hits the "account already initialized" path, which is the correct behavior (idempotent, no double-signing). Confirm the seed prefix `b"signature"` does not collide with any existing PDA seed prefix in the program (the handoff notes existing prefixes like `config`, `ownership`, `contract_artifact`, `authorized_contract`, `anchor` — `signature` appears distinct, but verify).

---

## 3. Instruction: `sign_contract`

### Arguments

```rust
pub fn sign_contract(
    ctx: Context<SignContract>,
    content_hash: [u8; 32],   // must equal the referenced ContractArtifact's stored hash
) -> Result<()>
```

Note: `content_hash` is passed in ONLY so it can be validated against the on-chain `ContractArtifact` — it is not trusted as the source of truth. The timestamp is NOT an argument (see §1).

### Accounts (`SignContract` context)

```rust
#[derive(Accounts)]
#[instruction(content_hash: [u8; 32])]
pub struct SignContract<'info> {
    // The contract being signed — must already exist on-chain.
    pub contract_artifact: Account<'info, ContractArtifact>,

    // The new signature PDA, initialized here.
    #[account(
        init,
        payer = signer,
        space = /* 121, or via InitSpace — match existing convention */,
        seeds = [b"signature", contract_artifact.key().as_ref(), signer.key().as_ref()],
        bump
    )]
    pub contract_signature: Account<'info, ContractSignature>,

    #[account(mut)]
    pub signer: Signer<'info>,

    pub system_program: Program<'info, System>,
}
```

### Constraints / validation (in the handler or as account constraints)

1. **Content hash match:** the passed `content_hash` MUST equal the `content_hash`/hash field stored on the referenced `ContractArtifact`. If the program's `ContractArtifact` stores its hash under a differently-named field (the handoff flags a `content_kind` vs `contract_kind` naming inconsistency — check the actual field name for the hash too), match against the real field. Reject with a custom error if mismatched. This binds the signature to the exact contract content.

2. **Creator-only (MVP authorization):** the `signer` must be the contract's creator. Determine how the program currently establishes the creator/owner of a `ContractArtifact` — via the linked `WorkClaim`/`Ownership` account, or a creator field on the artifact itself. Enforce that `signer.key()` matches that authority. **Write this as a single, clearly-commented constraint** so that generalizing later to "signer is any listed party" is a localized change, not a structural one. If the program has no on-chain notion of the contract's creator that can be checked here, STOP and flag it — that's a design gap that changes the approach, and it should not be worked around silently.

3. `init` (not `init_if_needed`) — a second signature attempt by the same signer on the same contract should fail, not silently succeed or overwrite. This is the correct anti-double-sign behavior.

### Custom errors

Add to the program's error enum:

```rust
#[msg("Provided content hash does not match the on-chain contract artifact.")]
ContentHashMismatch,

#[msg("Signer is not authorized to sign this contract.")]
UnauthorizedSigner,
```

---

## 4. What this instruction does NOT do

State these explicitly so scope doesn't creep during implementation:

- It does NOT handle external/non-creator signers. Creator-only for MVP.
- It does NOT send any notification or email.
- It does NOT emit an event.
- It does NOT modify the `ContractArtifact` or any contract status on-chain — the Supabase `contracts.status` remains the source of truth for workflow state; this instruction only records the immutable signature fact.
- It does NOT replace the existing `anchor_evidence_contract` / `anchor_authorized_contract` instructions. It is a distinct, additional record with distinct semantics (a *signature*, not an evidence or authorization anchor).

---

## 5. Verification checklist (4-pass standard — all must pass before "done")

1. **Compiles** — `anchor build` succeeds with no warnings introduced by this code.
2. **Local validator, happy path** — creator signs an existing contract; a `ContractSignature` PDA is created; `signed_at` is a plausible on-chain timestamp (matches the validator's block time, NOT a client value); `content_hash` matches the artifact.
3. **Local validator, rejection paths** — (a) signing with a wrong `content_hash` hits `ContentHashMismatch`; (b) signing by a non-creator wallet hits `UnauthorizedSigner`; (c) signing the same contract twice by the same signer fails on the `init` collision; (d) signing a contract whose `ContractArtifact` does not exist fails cleanly.
4. **Timestamp integrity** — confirm by test that a client attempting to influence the timestamp cannot (there is no timestamp argument; the recorded value comes from `Clock`). Cross-check the recorded `slot`/`unix_timestamp` against the validator's actual block time.
5. **Devnet deploy + one real signature** — after local passes, deploy to devnet, execute one real `sign_contract` from the frontend wallet path, and confirm the on-chain `ContractSignature` account via a block explorer / `getAccountInfo`. "Passes on local validator" is not "works on devnet."
6. **IDL regenerated** — the frontend needs the updated IDL to call the new instruction. Confirm the IDL includes `sign_contract` and the `ContractSignature` account, and that the regenerated IDL is copied to wherever the frontend imports it.

---

## 6. Frontend integration (AFTER on-chain is verified — separate lane, Codex)

Do not start this until §5 fully passes. Noted here only so the on-chain work accounts for it:

- The frontend `handleSign` in `ContractsApp.tsx` currently inserts a Supabase signature row and (conditionally) calls `anchorAuthorizedContract`. The new flow: the creator's signature should call `sign_contract` via the connected wallet, capturing the returned transaction signature and storing it on the Supabase `contract_signatures` row (there are already `tx_id` / `anchor_state` columns).
- The E-SIGN consent gate just implemented sits IN FRONT of this — consent modal first, then wallet signature. The two must compose cleanly.
- This requires the regenerated IDL from §5.6.

---

## Open question to resolve during pass 2, not now

Does the program have an on-chain, checkable notion of "who created this contract"? Constraint #2 depends entirely on this. If the creator is only known in Supabase and not represented on-chain in a way `sign_contract` can verify, then creator-only authorization cannot be enforced at the program level — and you must decide whether to (a) enforce it only in the frontend/RLS (weaker, but acceptable for MVP if documented as such), or (b) add the creator to the on-chain contract representation first. Flag this the moment it's known; it's the most likely thing to change the shape of the work.
