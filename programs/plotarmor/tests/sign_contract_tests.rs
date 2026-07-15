mod common;

use {
    anchor_lang::{
        prelude::{Clock, Pubkey},
        solana_program::{instruction::Instruction, system_program},
        InstructionData, ToAccountMetas,
    },
    common::{read_account, send_instruction, setup, ANCHOR_MODE},
    plotarmor::{ContractArtifact, ContractSignature, RegistryConfig},
    solana_keypair::Keypair,
    solana_signer::Signer,
};

fn initialize_registry(svm: &mut litesvm::LiteSVM, authority: &Keypair) -> Pubkey {
    use solana_sdk_ids::bpf_loader_upgradeable;
    let registry_config = Pubkey::find_program_address(&[b"config"], &plotarmor::ID).0;
    let program_data = Pubkey::find_program_address(
        &[plotarmor::ID.as_ref()],
        &bpf_loader_upgradeable::id(),
    )
    .0;

    let instruction = Instruction::new_with_bytes(
        plotarmor::ID,
        &plotarmor::instruction::InitRegistryConfig {}.data(),
        plotarmor::accounts::InitRegistryConfig {
            registry_config,
            signer: authority.pubkey(),
            system_program: system_program::ID,
            program: plotarmor::ID,
            program_data,
        }
        .to_account_metas(None),
    );

    send_instruction(svm, instruction, authority);
    registry_config
}

// Creates a ContractArtifact via anchor_evidence_contract (the unilateral path --
// no WorkClaim/Ownership fixture required), returning its PDA.
fn create_contract_artifact(
    svm: &mut litesvm::LiteSVM,
    registry_config: Pubkey,
    anchorer: &Keypair,
    raw_contract_hash: [u8; 32],
    anchor_nonce: [u8; 32],
) -> Pubkey {
    let contract_artifact = Pubkey::find_program_address(
        &[b"contract_artifact", raw_contract_hash.as_ref()],
        &plotarmor::ID,
    )
    .0;
    let evidence_anchor = Pubkey::find_program_address(
        &[b"evidence", anchorer.pubkey().as_ref(), contract_artifact.as_ref()],
        &plotarmor::ID,
    )
    .0;
    let anchor_record = Pubkey::find_program_address(
        &[b"anchor", evidence_anchor.as_ref(), anchor_nonce.as_ref()],
        &plotarmor::ID,
    )
    .0;

    let instruction = Instruction::new_with_bytes(
        plotarmor::ID,
        &plotarmor::instruction::AnchorEvidenceContract {
            raw_contract_hash,
            contract_kind: 1,
            anchor_nonce,
            anchor_mode_arg: ANCHOR_MODE,
            asserted_work_claim: Pubkey::default(),
            external_ref_hash: [7u8; 32],
        }
        .data(),
        plotarmor::accounts::AnchorEvidenceContract {
            registry_config,
            contract_artifact,
            evidence_anchor,
            anchor_record,
            anchorer: anchorer.pubkey(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );

    send_instruction(svm, instruction, anchorer);
    contract_artifact
}

fn sign_contract_instruction(
    contract_artifact: Pubkey,
    signer: &Keypair,
    content_hash: [u8; 32],
) -> (Instruction, Pubkey) {
    let contract_signature = Pubkey::find_program_address(
        &[b"signature", contract_artifact.as_ref(), signer.pubkey().as_ref()],
        &plotarmor::ID,
    )
    .0;

    let instruction = Instruction::new_with_bytes(
        plotarmor::ID,
        &plotarmor::instruction::SignContract { content_hash }.data(),
        plotarmor::accounts::SignContract {
            contract_artifact,
            contract_signature,
            signer: signer.pubkey(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );

    (instruction, contract_signature)
}

fn send_instruction_result(
    svm: &mut litesvm::LiteSVM,
    instruction: Instruction,
    signer: &Keypair,
) -> litesvm::types::TransactionResult {
    let message = solana_message::Message::new_with_blockhash(
        &[instruction],
        Some(&signer.pubkey()),
        &svm.latest_blockhash(),
    );
    let transaction = solana_transaction::versioned::VersionedTransaction::try_new(
        solana_message::VersionedMessage::Legacy(message),
        &[signer],
    )
    .unwrap();

    svm.send_transaction(transaction)
}

fn assert_anchor_error(error: &litesvm::types::FailedTransactionMetadata, name: &str, code: u32) {
    assert!(
        error
            .meta
            .logs
            .iter()
            .any(|log| log.contains(&format!("Error Code: {name}"))),
        "expected Anchor error {name}, got {error:?}"
    );
    assert!(
        format!("{:?}", error.err).contains(&format!("Custom({code})")),
        "expected custom error {code}, got {:?}",
        error.err
    );
}

// --- 5.2 Happy path -----------------------------------------------------

#[test]
fn sign_contract_happy_path() {
    let mut context = setup();
    let registry_config = initialize_registry(&mut context.svm, &context.authority);

    let raw_contract_hash = [61; 32];
    let contract_artifact = create_contract_artifact(
        &mut context.svm,
        registry_config,
        &context.authority,
        raw_contract_hash,
        [62; 32],
    );

    let artifact: ContractArtifact = read_account(&context.svm, &contract_artifact);
    assert_eq!(artifact.raw_hash, raw_contract_hash);

    let (instruction, contract_signature) =
        sign_contract_instruction(contract_artifact, &context.authority, raw_contract_hash);

    send_instruction(&mut context.svm, instruction, &context.authority);

    // Read the clock immediately after the transaction. LiteSVM does not
    // auto-advance slot/time between calls absent an explicit warp, so the
    // signature's program-captured values must match exactly.
    let clock: Clock = context.svm.get_sysvar();

    let signature: ContractSignature = read_account(&context.svm, &contract_signature);
    assert_eq!(signature.contract_artifact, contract_artifact);
    assert_eq!(signature.signer, context.authority.pubkey());
    assert_eq!(signature.content_hash, raw_contract_hash);
    assert_eq!(signature.signed_at, clock.unix_timestamp);
    assert_eq!(signature.slot, clock.slot);
}

// --- 5.3(a) wrong content_hash -> ContentHashMismatch --------------------

#[test]
fn wrong_content_hash_rejected() {
    let mut context = setup();
    let registry_config = initialize_registry(&mut context.svm, &context.authority);

    let raw_contract_hash = [63; 32];
    let contract_artifact = create_contract_artifact(
        &mut context.svm,
        registry_config,
        &context.authority,
        raw_contract_hash,
        [64; 32],
    );

    let wrong_hash = [64; 32];
    assert_ne!(wrong_hash, raw_contract_hash);

    let (instruction, _) =
        sign_contract_instruction(contract_artifact, &context.authority, wrong_hash);

    let error = send_instruction_result(&mut context.svm, instruction, &context.authority)
        .unwrap_err();

    assert_anchor_error(&error, "ContentHashMismatch", 6011);
}

// --- 5.3(b) creator-only authorization is NOT enforced on-chain (Option 2) ---
//
// Design decision, locked by Milan (sign_contract-spec.md, "Open question"):
// ContractArtifact has no on-chain creator/party field, so signer-must-be-creator
// cannot be checked at the program level without adding that representation
// first (deferred, out of scope for this MVP). This test documents -- rather
// than silently skips -- that consequence: an unrelated wallet with no claim
// to the contract can successfully create a ContractSignature. Creator/party
// restriction is enforced off-chain only (Supabase/RLS gating which wallet the
// frontend prompts). This must not be described anywhere as on-chain proof of
// *who* signed as creator -- only that a given wallet signed a given content
// hash at a given on-chain time.

#[test]
fn unrelated_wallet_can_sign_no_onchain_creator_check() {
    let mut context = setup();
    let registry_config = initialize_registry(&mut context.svm, &context.authority);

    let raw_contract_hash = [65; 32];
    let contract_artifact = create_contract_artifact(
        &mut context.svm,
        registry_config,
        &context.authority,
        raw_contract_hash,
        [66; 32],
    );

    let stranger = Keypair::new();
    context.svm.airdrop(&stranger.pubkey(), 10_000_000_000).unwrap();
    assert_ne!(stranger.pubkey(), context.authority.pubkey());

    let (instruction, contract_signature) =
        sign_contract_instruction(contract_artifact, &stranger, raw_contract_hash);

    send_instruction(&mut context.svm, instruction, &stranger);

    let signature: ContractSignature = read_account(&context.svm, &contract_signature);
    assert_eq!(signature.signer, stranger.pubkey());
    assert_eq!(signature.content_hash, raw_contract_hash);
}

// --- 5.3(c) double-sign by the same signer is rejected -------------------

#[test]
fn double_sign_by_same_signer_rejected() {
    let mut context = setup();
    let registry_config = initialize_registry(&mut context.svm, &context.authority);

    let raw_contract_hash = [67; 32];
    let contract_artifact = create_contract_artifact(
        &mut context.svm,
        registry_config,
        &context.authority,
        raw_contract_hash,
        [68; 32],
    );

    let (first, _) =
        sign_contract_instruction(contract_artifact, &context.authority, raw_contract_hash);
    send_instruction(&mut context.svm, first, &context.authority);

    // Same PDA, same signer, same content_hash -> byte-identical instruction
    // to the first. Expire the blockhash so the second transaction gets a
    // distinct signature and actually reaches the runtime's account-init
    // collision check, instead of being deduped as AlreadyProcessed before
    // that check ever runs.
    context.svm.expire_blockhash();

    let (second, _) =
        sign_contract_instruction(contract_artifact, &context.authority, raw_contract_hash);
    let error = send_instruction_result(&mut context.svm, second, &context.authority)
        .unwrap_err();
    let diagnostic = format!("{error:?}");

    assert!(
        diagnostic.contains("already in use") || diagnostic.contains("AccountAlreadyInUse"),
        "expected duplicate ContractSignature allocation failure, got {error:?}"
    );
}

// --- 5.3(d) signing a contract whose ContractArtifact does not exist -----

#[test]
fn signing_nonexistent_contract_rejected() {
    let mut context = setup();
    initialize_registry(&mut context.svm, &context.authority);

    // No create_contract_artifact call -- this PDA was never initialized.
    let phantom_hash = [69; 32];
    let phantom_contract_artifact = Pubkey::find_program_address(
        &[b"contract_artifact", phantom_hash.as_ref()],
        &plotarmor::ID,
    )
    .0;

    let (instruction, _) =
        sign_contract_instruction(phantom_contract_artifact, &context.authority, phantom_hash);

    let error = send_instruction_result(&mut context.svm, instruction, &context.authority)
        .unwrap_err();
    let diagnostic = format!("{error:?}");

    assert!(
        diagnostic.contains("AccountNotInitialized")
            || diagnostic.contains("AccountOwnedByWrongProgram")
            || diagnostic.contains("AccountDiscriminatorMismatch")
            || diagnostic.contains("AccountDiscriminatorNotFound"),
        "expected a clean account-validation failure for a nonexistent ContractArtifact, got {error:?}"
    );
}

// --- 5.4 Timestamp integrity ---------------------------------------------
//
// Structural guarantee: plotarmor::instruction::SignContract only carries
// `content_hash`. There is no timestamp field in the instruction data at all,
// so a client cannot pass one -- this is enforced by the generated struct's
// shape, not by runtime validation. The two checks below confirm the value
// that *is* recorded is the program's own Clock, not something else, and that
// it moves when the on-chain clock moves (proving it is read live per-call,
// not a fixed/default value).

#[test]
fn signed_at_and_slot_come_from_onchain_clock_not_a_fixed_value() {
    let mut context = setup();
    let registry_config = initialize_registry(&mut context.svm, &context.authority);

    let raw_contract_hash = [70; 32];
    let contract_artifact = create_contract_artifact(
        &mut context.svm,
        registry_config,
        &context.authority,
        raw_contract_hash,
        [71; 32],
    );

    let clock_before: Clock = context.svm.get_sysvar();
    context.svm.warp_to_slot(clock_before.slot + 1000);
    let clock_after: Clock = context.svm.get_sysvar();
    assert_ne!(clock_after.slot, clock_before.slot);

    let (instruction, contract_signature) =
        sign_contract_instruction(contract_artifact, &context.authority, raw_contract_hash);
    send_instruction(&mut context.svm, instruction, &context.authority);

    let signature: ContractSignature = read_account(&context.svm, &contract_signature);
    assert_eq!(signature.slot, clock_after.slot);
    assert_ne!(signature.slot, clock_before.slot);
}

// Registry sanity check reused from other suites: confirms initialize_registry
// wiring in this file is correct before it's trusted by the tests above.
#[test]
fn registry_wiring_sanity_check() {
    let mut context = setup();
    let registry_config = initialize_registry(&mut context.svm, &context.authority);
    let config: RegistryConfig = read_account(&context.svm, &registry_config);
    assert_eq!(config.authority, context.authority.pubkey());
}
