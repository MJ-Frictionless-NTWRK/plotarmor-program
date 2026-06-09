mod common;

use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{instruction::Instruction, system_program},
        InstructionData, ToAccountMetas,
    },
    common::{send_instruction, setup, ANCHOR_MODE},
    solana_keypair::Keypair,
    solana_signer::Signer,
};

const TEST_KEYPAIR_LAMPORTS: u64 = 10_000_000_000;

struct ClaimFixture {
    work_claim: Pubkey,
    ownership: Pubkey,
    claim_artifact_link: Pubkey,
}

fn initialize_registry(svm: &mut litesvm::LiteSVM, authority: &Keypair) -> Pubkey {
    let registry_config = Pubkey::find_program_address(&[b"config"], &plotarmor::ID).0;

    let instruction = Instruction::new_with_bytes(
        plotarmor::ID,
        &plotarmor::instruction::InitRegistryConfig {}.data(),
        plotarmor::accounts::InitRegistryConfig {
            registry_config,
            signer: authority.pubkey(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );

    send_instruction(svm, instruction, authority);
    registry_config
}

fn build_register_claim(
    claimant: &Keypair,
    registry_config: Pubkey,
    raw_hash: [u8; 32],
    link_nonce: [u8; 32],
    anchor_nonce: [u8; 32],
    anchor_mode_arg: u8,
) -> (Instruction, ClaimFixture) {
    let content_artifact =
        Pubkey::find_program_address(&[b"content", raw_hash.as_ref()], &plotarmor::ID).0;
    let work_claim = Pubkey::find_program_address(
        &[
            b"claim",
            content_artifact.as_ref(),
            claimant.pubkey().as_ref(),
        ],
        &plotarmor::ID,
    )
    .0;
    let ownership =
        Pubkey::find_program_address(&[b"ownership", work_claim.as_ref()], &plotarmor::ID).0;
    let owner_record = Pubkey::find_program_address(
        &[b"owner", ownership.as_ref(), claimant.pubkey().as_ref()],
        &plotarmor::ID,
    )
    .0;
    let claim_artifact_link = Pubkey::find_program_address(
        &[b"claim_artifact", work_claim.as_ref(), link_nonce.as_ref()],
        &plotarmor::ID,
    )
    .0;
    let anchor_record = Pubkey::find_program_address(
        &[b"anchor", work_claim.as_ref(), anchor_nonce.as_ref()],
        &plotarmor::ID,
    )
    .0;

    let instruction = Instruction::new_with_bytes(
        plotarmor::ID,
        &plotarmor::instruction::RegisterWorkClaim {
            raw_hash,
            content_kind: 1,
            claim_kind: 1,
            total_shares: 100,
            threshold_shares: 100,
            link_nonce,
            anchor_nonce,
            anchor_mode_arg,
        }
        .data(),
        plotarmor::accounts::RegisterWorkClaim {
            registry_config,
            content_artifact,
            work_claim,
            ownership,
            owner_record,
            claim_artifact_link,
            anchor_record,
            signer: claimant.pubkey(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );

    (
        instruction,
        ClaimFixture {
            work_claim,
            ownership,
            claim_artifact_link,
        },
    )
}

fn register_claim(
    svm: &mut litesvm::LiteSVM,
    claimant: &Keypair,
    registry_config: Pubkey,
    raw_hash: [u8; 32],
    link_nonce: [u8; 32],
    anchor_nonce: [u8; 32],
) -> ClaimFixture {
    let (instruction, fixture) = build_register_claim(
        claimant,
        registry_config,
        raw_hash,
        link_nonce,
        anchor_nonce,
        ANCHOR_MODE,
    );

    send_instruction(svm, instruction, claimant);
    fixture
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

#[test]
fn wrong_claimant_cannot_add_version() {
    let mut context = setup();
    let registry_config = initialize_registry(&mut context.svm, &context.authority);
    let fixture = register_claim(
        &mut context.svm,
        &context.authority,
        registry_config,
        [85; 32],
        [86; 32],
        [87; 32],
    );

    let attacker = Keypair::new();
    context
        .svm
        .airdrop(&attacker.pubkey(), TEST_KEYPAIR_LAMPORTS)
        .unwrap();

    let raw_hash = [88; 32];
    let link_nonce = [89; 32];
    let anchor_nonce = [90; 32];

    let content_artifact =
        Pubkey::find_program_address(&[b"content", raw_hash.as_ref()], &plotarmor::ID).0;
    let claim_artifact_link = Pubkey::find_program_address(
        &[
            b"claim_artifact",
            fixture.work_claim.as_ref(),
            link_nonce.as_ref(),
        ],
        &plotarmor::ID,
    )
    .0;
    let anchor_record = Pubkey::find_program_address(
        &[b"anchor", content_artifact.as_ref(), anchor_nonce.as_ref()],
        &plotarmor::ID,
    )
    .0;

    let instruction = Instruction::new_with_bytes(
        plotarmor::ID,
        &plotarmor::instruction::AddVersion {
            raw_hash,
            content_kind: 2,
            link_nonce,
            anchor_nonce,
            anchor_mode_arg: ANCHOR_MODE,
            expected_previous_link: fixture.claim_artifact_link,
        }
        .data(),
        plotarmor::accounts::AddVersion {
            registry_config,
            work_claim: fixture.work_claim,
            content_artifact,
            claim_artifact_link,
            anchor_record,
            signer: attacker.pubkey(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );

    let error = send_instruction_result(&mut context.svm, instruction, &attacker).unwrap_err();

    assert_anchor_error(&error, "Unauthorized", 6009);
}

#[test]
fn duplicate_work_claim_rejected() {
    let mut context = setup();
    let registry_config = initialize_registry(&mut context.svm, &context.authority);

    register_claim(
        &mut context.svm,
        &context.authority,
        registry_config,
        [80; 32],
        [81; 32],
        [82; 32],
    );

    let (instruction, _) = build_register_claim(
        &context.authority,
        registry_config,
        [80; 32],
        [83; 32],
        [84; 32],
        ANCHOR_MODE,
    );

    let error =
        send_instruction_result(&mut context.svm, instruction, &context.authority).unwrap_err();
    let diagnostic = format!("{error:?}");

    assert!(
        diagnostic.contains("already in use") || diagnostic.contains("AccountAlreadyInUse"),
        "expected duplicate WorkClaim allocation failure, got {error:?}"
    );
}

#[test]
fn non_admin_cannot_add_owner() {
    let mut context = setup();
    let registry_config = initialize_registry(&mut context.svm, &context.authority);
    let fixture = register_claim(
        &mut context.svm,
        &context.authority,
        registry_config,
        [91; 32],
        [92; 32],
        [93; 32],
    );

    let attacker = Keypair::new();
    let new_owner = Keypair::new();
    context
        .svm
        .airdrop(&attacker.pubkey(), TEST_KEYPAIR_LAMPORTS)
        .unwrap();
    context
        .svm
        .airdrop(&new_owner.pubkey(), TEST_KEYPAIR_LAMPORTS)
        .unwrap();

    let new_owner_record = Pubkey::find_program_address(
        &[
            b"owner",
            fixture.ownership.as_ref(),
            new_owner.pubkey().as_ref(),
        ],
        &plotarmor::ID,
    )
    .0;

    let instruction = Instruction::new_with_bytes(
        plotarmor::ID,
        &plotarmor::instruction::AddOwner {
            new_share: 50,
            new_role: 1,
            new_threshold_shares: 100,
        }
        .data(),
        plotarmor::accounts::AddOwner {
            registry_config,
            work_claim: fixture.work_claim,
            ownership: fixture.ownership,
            new_owner_record,
            admin: attacker.pubkey(),
            new_owner: new_owner.pubkey(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );

    // Code 6009 depends on AddOwner's has_one constraint retaining its
    // explicit `@ PlotArmorError::Unauthorized` mapping.
    let error = send_instruction_result(&mut context.svm, instruction, &attacker).unwrap_err();

    assert_anchor_error(&error, "Unauthorized", 6009);
}

#[test]
fn non_admin_cannot_anchor_authorized_contract() {
    let mut context = setup();
    let registry_config = initialize_registry(&mut context.svm, &context.authority);
    let fixture = register_claim(
        &mut context.svm,
        &context.authority,
        registry_config,
        [94; 32],
        [95; 32],
        [96; 32],
    );

    let attacker = Keypair::new();
    context
        .svm
        .airdrop(&attacker.pubkey(), TEST_KEYPAIR_LAMPORTS)
        .unwrap();

    let raw_contract_hash = [97; 32];
    let anchor_nonce = [98; 32];

    let contract_artifact = Pubkey::find_program_address(
        &[b"contract_artifact", raw_contract_hash.as_ref()],
        &plotarmor::ID,
    )
    .0;
    let authorized_contract_anchor = Pubkey::find_program_address(
        &[
            b"authorized_contract",
            fixture.work_claim.as_ref(),
            contract_artifact.as_ref(),
        ],
        &plotarmor::ID,
    )
    .0;
    let anchor_record = Pubkey::find_program_address(
        &[
            b"anchor",
            authorized_contract_anchor.as_ref(),
            anchor_nonce.as_ref(),
        ],
        &plotarmor::ID,
    )
    .0;

    let instruction = Instruction::new_with_bytes(
        plotarmor::ID,
        &plotarmor::instruction::AnchorAuthorizedContract {
            raw_contract_hash,
            contract_kind: 1,
            anchor_nonce,
            anchor_mode_arg: ANCHOR_MODE,
        }
        .data(),
        plotarmor::accounts::AnchorAuthorizedContract {
            registry_config,
            work_claim: fixture.work_claim,
            ownership: fixture.ownership,
            contract_artifact,
            authorized_contract_anchor,
            anchor_record,
            admin: attacker.pubkey(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );

    // Code 6009 comes from the handler's explicit admin require check. A
    // future plain has_one constraint would instead return Anchor code 2001.
    let error = send_instruction_result(&mut context.svm, instruction, &attacker).unwrap_err();

    assert_anchor_error(&error, "Unauthorized", 6009);
}

#[cfg(feature = "mainnet")]
#[test]
fn simulated_mode_rejected_on_mainnet_build() {
    let mut context = setup();
    let registry_config = initialize_registry(&mut context.svm, &context.authority);

    let (instruction, _) = build_register_claim(
        &context.authority,
        registry_config,
        [99; 32],
        [100; 32],
        [101; 32],
        0,
    );

    let error =
        send_instruction_result(&mut context.svm, instruction, &context.authority).unwrap_err();

    assert_anchor_error(&error, "SimulatedModeRejected", 6003);
}

#[cfg(not(feature = "mainnet"))]
#[test]
fn simulated_mode_allowed_on_non_mainnet_build() {
    let mut context = setup();
    let registry_config = initialize_registry(&mut context.svm, &context.authority);

    let (instruction, _) = build_register_claim(
        &context.authority,
        registry_config,
        [99; 32],
        [100; 32],
        [101; 32],
        0,
    );

    send_instruction_result(&mut context.svm, instruction, &context.authority)
        .expect("simulated mode should be allowed on non-mainnet builds");
}

#[test]
fn unknown_anchor_mode_rejected() {
    let mut context = setup();
    let registry_config = initialize_registry(&mut context.svm, &context.authority);

    let (instruction, _) = build_register_claim(
        &context.authority,
        registry_config,
        [102; 32],
        [103; 32],
        [104; 32],
        99,
    );

    let error =
        send_instruction_result(&mut context.svm, instruction, &context.authority).unwrap_err();

    assert_anchor_error(&error, "AnchorModeNotAllowed", 6002);
}
