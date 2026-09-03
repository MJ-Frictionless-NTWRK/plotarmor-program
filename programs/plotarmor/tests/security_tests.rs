mod common;

use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{instruction::Instruction, system_program},
        AccountSerialize, InstructionData, ToAccountMetas,
    },
    common::{read_account, send_instruction, setup, ANCHOR_MODE},
    plotarmor::{AnchorRecord, WorkClaim},
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
    use solana_sdk_ids::bpf_loader_upgradeable;
    let registry_config = Pubkey::find_program_address(&[b"config"], &plotarmor::ID).0;
    let program_data = Pubkey::find_program_address(
        &[plotarmor::ID.as_ref()],
        &bpf_loader_upgradeable::id(),
    ).0;

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
            external_ref_hash: [66u8; 32],
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

// Variant of build_register_claim that exposes content_kind, claim_kind, and the
// share parameters so individual validation paths can be exercised directly.
fn build_register_claim_custom(
    claimant: &Keypair,
    registry_config: Pubkey,
    raw_hash: [u8; 32],
    link_nonce: [u8; 32],
    anchor_nonce: [u8; 32],
    content_kind: u8,
    claim_kind: u8,
    total_shares: u16,
    threshold_shares: u16,
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
            content_kind,
            claim_kind,
            total_shares,
            threshold_shares,
            link_nonce,
            anchor_nonce,
            anchor_mode_arg: ANCHOR_MODE,
            external_ref_hash: [99u8; 32],
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

// Mirrors the build_add_version helper in happy_paths: derives the version
// accounts and returns the AddVersion instruction ready to send.
fn build_add_version(
    claimant: &Keypair,
    registry_config: Pubkey,
    work_claim: Pubkey,
    raw_hash: [u8; 32],
    content_kind: u8,
    link_nonce: [u8; 32],
    anchor_nonce: [u8; 32],
    expected_previous_link: Pubkey,
) -> Instruction {
    let content_artifact =
        Pubkey::find_program_address(&[b"content", raw_hash.as_ref()], &plotarmor::ID).0;
    let claim_artifact_link = Pubkey::find_program_address(
        &[b"claim_artifact", work_claim.as_ref(), link_nonce.as_ref()],
        &plotarmor::ID,
    )
    .0;
    let anchor_record = Pubkey::find_program_address(
        &[b"anchor", content_artifact.as_ref(), anchor_nonce.as_ref()],
        &plotarmor::ID,
    )
    .0;

    Instruction::new_with_bytes(
        plotarmor::ID,
        &plotarmor::instruction::AddVersion {
            raw_hash,
            content_kind,
            link_nonce,
            anchor_nonce,
            anchor_mode_arg: ANCHOR_MODE,
            expected_previous_link,
            external_ref_hash: [33u8; 32],
        }
        .data(),
        plotarmor::accounts::AddVersion {
            registry_config,
            work_claim,
            content_artifact,
            claim_artifact_link,
            anchor_record,
            claimant: claimant.pubkey(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
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
            external_ref_hash: [22u8; 32],
        }
        .data(),
        plotarmor::accounts::AddVersion {
            registry_config,
            work_claim: fixture.work_claim,
            content_artifact,
            claim_artifact_link,
            anchor_record,
            claimant: attacker.pubkey(),
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
            external_ref_hash: [8u8; 32],
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

// AnchorMode::AttestedMainnet = 2. Non-mainnet (devnet) builds must reject a
// caller-supplied claim of mainnet attestation, symmetric with the existing
// mainnet-build rejection of AnchorMode::Simulated.
#[cfg(not(feature = "mainnet"))]
#[test]
fn attested_mainnet_rejected_on_non_mainnet_build() {
    let mut context = setup();
    let registry_config = initialize_registry(&mut context.svm, &context.authority);

    let (instruction, _) = build_register_claim(
        &context.authority,
        registry_config,
        [130; 32],
        [131; 32],
        [132; 32],
        2,
    );

    let error =
        send_instruction_result(&mut context.svm, instruction, &context.authority).unwrap_err();

    assert_anchor_error(&error, "AnchorModeNotAllowed", 6002);
}

// AnchorMode::AttestedDevnet = 1. Mainnet builds must reject a caller-supplied
// claim of devnet attestation, symmetric with attested_mainnet_rejected_on_non_mainnet_build.
#[cfg(feature = "mainnet")]
#[test]
fn attested_devnet_rejected_on_mainnet_build() {
    let mut context = setup();
    let registry_config = initialize_registry(&mut context.svm, &context.authority);

    let (instruction, _) = build_register_claim(
        &context.authority,
        registry_config,
        [133; 32],
        [134; 32],
        [135; 32],
        1,
    );

    let error =
        send_instruction_result(&mut context.svm, instruction, &context.authority).unwrap_err();

    assert_anchor_error(&error, "AnchorModeNotAllowed", 6002);
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

#[test]
fn superseded_claim_freezes_add_version() {
    let mut context = setup();
    let registry_config = initialize_registry(&mut context.svm, &context.authority);
    let fixture = register_claim(
        &mut context.svm,
        &context.authority,
        registry_config,
        [110; 32],
        [111; 32],
        [112; 32],
    );

    // Directly stamp superseded_by on the WorkClaim, simulating a freeze applied
    // by a later supersession event.
    let mut work_claim: WorkClaim = read_account(&context.svm, &fixture.work_claim);
    work_claim.superseded_by = Pubkey::new_unique();

    let mut work_claim_account = context.svm.get_account(&fixture.work_claim).unwrap();
    work_claim
        .try_serialize(&mut work_claim_account.data.as_mut_slice())
        .unwrap();
    context
        .svm
        .set_account(fixture.work_claim, work_claim_account)
        .unwrap();

    // Correct expected_previous_link, so the only thing that can reject is the
    // superseded freeze.
    let instruction = build_add_version(
        &context.authority,
        registry_config,
        fixture.work_claim,
        [113; 32],
        2,
        [114; 32],
        [115; 32],
        fixture.claim_artifact_link,
    );

    let error =
        send_instruction_result(&mut context.svm, instruction, &context.authority).unwrap_err();

    assert_anchor_error(&error, "SupersededClaim", 6010);
}

#[test]
fn invalid_claim_kind_rejected() {
    let mut context = setup();
    let registry_config = initialize_registry(&mut context.svm, &context.authority);

    let (instruction, _) = build_register_claim_custom(
        &context.authority,
        registry_config,
        [116; 32],
        [117; 32],
        [118; 32],
        1,
        99,
        100,
        100,
    );

    let error =
        send_instruction_result(&mut context.svm, instruction, &context.authority).unwrap_err();

    assert_anchor_error(&error, "AnchorModeNotAllowed", 6002);
}

#[test]
fn invalid_contract_kind_rejected() {
    let mut context = setup();
    let registry_config = initialize_registry(&mut context.svm, &context.authority);

    let raw_contract_hash = [119; 32];
    let anchor_nonce = [120; 32];

    let contract_artifact = Pubkey::find_program_address(
        &[b"contract_artifact", raw_contract_hash.as_ref()],
        &plotarmor::ID,
    )
    .0;
    let evidence_anchor = Pubkey::find_program_address(
        &[
            b"evidence",
            context.authority.pubkey().as_ref(),
            contract_artifact.as_ref(),
        ],
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
            contract_kind: 99,
            anchor_nonce,
            anchor_mode_arg: ANCHOR_MODE,
            asserted_work_claim: Pubkey::default(),
            external_ref_hash: [11u8; 32],
        }
        .data(),
        plotarmor::accounts::AnchorEvidenceContract {
            registry_config,
            contract_artifact,
            evidence_anchor,
            anchor_record,
            anchorer: context.authority.pubkey(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );

    let error =
        send_instruction_result(&mut context.svm, instruction, &context.authority).unwrap_err();

    assert_anchor_error(&error, "AnchorModeNotAllowed", 6002);
}

#[test]
fn threshold_above_total_rejected() {
    let mut context = setup();
    let registry_config = initialize_registry(&mut context.svm, &context.authority);

    let (instruction, _) = build_register_claim_custom(
        &context.authority,
        registry_config,
        [121; 32],
        [122; 32],
        [123; 32],
        1,
        1,
        100,
        101,
    );

    let error =
        send_instruction_result(&mut context.svm, instruction, &context.authority).unwrap_err();

    assert_anchor_error(&error, "ShareSumMismatch", 6005);
}

#[test]
fn zero_share_add_owner_rejected() {
    let mut context = setup();
    let registry_config = initialize_registry(&mut context.svm, &context.authority);
    let fixture = register_claim(
        &mut context.svm,
        &context.authority,
        registry_config,
        [124; 32],
        [125; 32],
        [126; 32],
    );

    let new_owner = Keypair::new();
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
            new_share: 0,
            new_role: 1,
            new_threshold_shares: 100,
        }
        .data(),
        plotarmor::accounts::AddOwner {
            registry_config,
            work_claim: fixture.work_claim,
            ownership: fixture.ownership,
            new_owner_record,
            admin: context.authority.pubkey(),
            new_owner: new_owner.pubkey(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );

    let error =
        send_instruction_result(&mut context.svm, instruction, &context.authority).unwrap_err();

    assert_anchor_error(&error, "ShareSumMismatch", 6005);
}

#[test]
fn share_overflow_rejected() {
    let mut context = setup();
    let registry_config = initialize_registry(&mut context.svm, &context.authority);

    let (register_instruction, fixture) = build_register_claim_custom(
        &context.authority,
        registry_config,
        [127; 32],
        [128; 32],
        [129; 32],
        1,
        1,
        u16::MAX,
        u16::MAX,
    );
    send_instruction(&mut context.svm, register_instruction, &context.authority);

    let new_owner = Keypair::new();
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
            new_share: 1,
            new_role: 1,
            new_threshold_shares: 1,
        }
        .data(),
        plotarmor::accounts::AddOwner {
            registry_config,
            work_claim: fixture.work_claim,
            ownership: fixture.ownership,
            new_owner_record,
            admin: context.authority.pubkey(),
            new_owner: new_owner.pubkey(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );

    let error =
        send_instruction_result(&mut context.svm, instruction, &context.authority).unwrap_err();

    assert_anchor_error(&error, "ShareOverflow", 6004);
}

#[test]
fn anchor_record_fields_locked() {
    let mut context = setup();
    let registry_config = initialize_registry(&mut context.svm, &context.authority);

    let anchor_nonce = [132; 32];
    let fixture = register_claim(
        &mut context.svm,
        &context.authority,
        registry_config,
        [130; 32],
        [131; 32],
        anchor_nonce,
    );

    // Registration anchors the WorkClaim itself: seed is the work_claim PDA.
    let anchor_record_pda = Pubkey::find_program_address(
        &[b"anchor", fixture.work_claim.as_ref(), anchor_nonce.as_ref()],
        &plotarmor::ID,
    )
    .0;

    let anchor_record: AnchorRecord = read_account(&context.svm, &anchor_record_pda);

    assert_eq!(anchor_record.anchored_object, fixture.work_claim);
    assert_eq!(anchor_record.anchored_object_kind, 0);
    assert_eq!(anchor_record.anchor_mode, ANCHOR_MODE);
    assert_eq!(anchor_record.external_ref_hash, [66u8; 32]);
}

#[test]
fn invalid_content_kind_rejected() {
    let mut context = setup();
    let registry_config = initialize_registry(&mut context.svm, &context.authority);

    let (instruction, _) = build_register_claim_custom(
        &context.authority,
        registry_config,
        [140; 32],
        [141; 32],
        [142; 32],
        99,
        1,
        100,
        100,
    );

    let error =
        send_instruction_result(&mut context.svm, instruction, &context.authority).unwrap_err();

    assert_anchor_error(&error, "AnchorModeNotAllowed", 6002);
}

#[test]
fn invalid_content_kind_rejected_on_add_version() {
    let mut context = setup();
    let registry_config = initialize_registry(&mut context.svm, &context.authority);
    let fixture = register_claim(
        &mut context.svm,
        &context.authority,
        registry_config,
        [143; 32],
        [144; 32],
        [145; 32],
    );

    let instruction = build_add_version(
        &context.authority,
        registry_config,
        fixture.work_claim,
        [146; 32],
        99,
        [147; 32],
        [148; 32],
        fixture.claim_artifact_link,
    );

    let error =
        send_instruction_result(&mut context.svm, instruction, &context.authority).unwrap_err();

    assert_anchor_error(&error, "AnchorModeNotAllowed", 6002);
}

#[test]
fn invalid_role_rejected() {
    let mut context = setup();
    let registry_config = initialize_registry(&mut context.svm, &context.authority);
    let fixture = register_claim(
        &mut context.svm,
        &context.authority,
        registry_config,
        [149; 32],
        [150; 32],
        [151; 32],
    );

    let new_owner = solana_keypair::Keypair::new();
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
            new_role: 99,
            new_threshold_shares: 100,
        }
        .data(),
        plotarmor::accounts::AddOwner {
            registry_config,
            work_claim: fixture.work_claim,
            ownership: fixture.ownership,
            new_owner_record,
            admin: context.authority.pubkey(),
            new_owner: new_owner.pubkey(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );

    let error =
        send_instruction_result(&mut context.svm, instruction, &context.authority).unwrap_err();

    assert_anchor_error(&error, "AnchorModeNotAllowed", 6002);
}
// ─────────────────────────────────────────────────────────────────────────────
// external_ref_hash stress tests
// Verifies the IPFS-CID-binding field round-trips correctly across all 4
// anchoring instructions, under adversarial value choices and reuse patterns.
// Appended 2026-06-22.
// ─────────────────────────────────────────────────────────────────────────────

// Helper: register a claim with an explicit external_ref_hash, return the
// AnchorRecord PDA and the work_claim PDA so the test can read both back.
fn register_claim_with_ext_ref(
    svm: &mut litesvm::LiteSVM,
    claimant: &Keypair,
    registry_config: Pubkey,
    raw_hash: [u8; 32],
    link_nonce: [u8; 32],
    anchor_nonce: [u8; 32],
    external_ref_hash: [u8; 32],
) -> (Pubkey, Pubkey) {
    let content_artifact =
        Pubkey::find_program_address(&[b"content", raw_hash.as_ref()], &plotarmor::ID).0;
    let work_claim = Pubkey::find_program_address(
        &[b"claim", content_artifact.as_ref(), claimant.pubkey().as_ref()],
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
            anchor_mode_arg: ANCHOR_MODE,
            external_ref_hash,
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
    send_instruction(svm, instruction, claimant);
    (anchor_record, work_claim)
}

// 1. All-zeros external_ref_hash is accepted and stored verbatim.
#[test]
fn ext_ref_all_zeros_accepted() {
    let mut ctx = setup();
    let registry_config = initialize_registry(&mut ctx.svm, &ctx.authority);
    let (anchor_record, _) = register_claim_with_ext_ref(
        &mut ctx.svm,
        &ctx.authority,
        registry_config,
        [1; 32],
        [2; 32],
        [3; 32],
        [0u8; 32],
    );
    let ar: AnchorRecord = read_account(&ctx.svm, &anchor_record);
    assert_eq!(ar.external_ref_hash, [0u8; 32]);
}

// 2. All-ones external_ref_hash (0xFF * 32) is accepted and stored verbatim.
#[test]
fn ext_ref_all_ones_accepted() {
    let mut ctx = setup();
    let registry_config = initialize_registry(&mut ctx.svm, &ctx.authority);
    let (anchor_record, _) = register_claim_with_ext_ref(
        &mut ctx.svm,
        &ctx.authority,
        registry_config,
        [4; 32],
        [5; 32],
        [6; 32],
        [0xFFu8; 32],
    );
    let ar: AnchorRecord = read_account(&ctx.svm, &anchor_record);
    assert_eq!(ar.external_ref_hash, [0xFFu8; 32]);
}

// 3. A realistic IPFS CIDv0 digest (the 32 bytes after the 0x12 0x20 multihash
//    prefix) round-trips byte-for-byte. This is a sample sha2-256 digest.
#[test]
fn ext_ref_realistic_cid_digest_roundtrips() {
    let mut ctx = setup();
    let registry_config = initialize_registry(&mut ctx.svm, &ctx.authority);
    // Arbitrary but realistic 32-byte digest (not all same byte).
    let digest: [u8; 32] = [
        0x1a, 0x2b, 0x3c, 0x4d, 0x5e, 0x6f, 0x70, 0x81,
        0x92, 0xa3, 0xb4, 0xc5, 0xd6, 0xe7, 0xf8, 0x09,
        0x10, 0x21, 0x32, 0x43, 0x54, 0x65, 0x76, 0x87,
        0x98, 0xa9, 0xba, 0xcb, 0xdc, 0xed, 0xfe, 0x0f,
    ];
    let (anchor_record, _) = register_claim_with_ext_ref(
        &mut ctx.svm,
        &ctx.authority,
        registry_config,
        [7; 32],
        [8; 32],
        [9; 32],
        digest,
    );
    let ar: AnchorRecord = read_account(&ctx.svm, &anchor_record);
    assert_eq!(ar.external_ref_hash, digest);
}

// 4. Two different claimants can register WorkClaims for DIFFERENT content that
//    happen to share the same external_ref_hash. No uniqueness constraint on the
//    field — both succeed and both store the same hash.
#[test]
fn ext_ref_shared_across_two_claimants() {
    let mut ctx = setup();
    let registry_config = initialize_registry(&mut ctx.svm, &ctx.authority);
    let shared_ext: [u8; 32] = [0x42; 32];

    let claimant_a = Keypair::new();
    let claimant_b = Keypair::new();
    ctx.svm.airdrop(&claimant_a.pubkey(), TEST_KEYPAIR_LAMPORTS).unwrap();
    ctx.svm.airdrop(&claimant_b.pubkey(), TEST_KEYPAIR_LAMPORTS).unwrap();

    let (ar_a, _) = register_claim_with_ext_ref(
        &mut ctx.svm,
        &claimant_a,
        registry_config,
        [10; 32],
        [11; 32],
        [12; 32],
        shared_ext,
    );
    let (ar_b, _) = register_claim_with_ext_ref(
        &mut ctx.svm,
        &claimant_b,
        registry_config,
        [20; 32], // different content
        [21; 32],
        [22; 32],
        shared_ext, // same external ref
    );

    let a: AnchorRecord = read_account(&ctx.svm, &ar_a);
    let b: AnchorRecord = read_account(&ctx.svm, &ar_b);
    assert_eq!(a.external_ref_hash, shared_ext);
    assert_eq!(b.external_ref_hash, shared_ext);
    // Distinct anchor records for distinct content.
    assert_ne!(ar_a, ar_b);
}

// 5. add_version stores a DIFFERENT external_ref_hash than the original
//    registration — each version carries its own IPFS binding.
#[test]
fn ext_ref_add_version_distinct_from_root() {
    let mut ctx = setup();
    let registry_config = initialize_registry(&mut ctx.svm, &ctx.authority);

    let root_ext: [u8; 32] = [0x11; 32];
    let (root_anchor, work_claim) = register_claim_with_ext_ref(
        &mut ctx.svm,
        &ctx.authority,
        registry_config,
        [30; 32],
        [31; 32],
        [32; 32],
        root_ext,
    );

    // Read the root link to use as expected_previous_link.
    let root: AnchorRecord = read_account(&ctx.svm, &root_anchor);
    assert_eq!(root.external_ref_hash, root_ext);

    // Derive the root claim_artifact_link (link_nonce [31;32]).
    let root_link = Pubkey::find_program_address(
        &[b"claim_artifact", work_claim.as_ref(), [31u8; 32].as_ref()],
        &plotarmor::ID,
    )
    .0;

    // add_version with a NEW external_ref_hash.
    let version_ext: [u8; 32] = [0x22; 32];
    let version_raw_hash = [33; 32];
    let version_link_nonce = [34; 32];
    let version_anchor_nonce = [35; 32];

    let content_artifact = Pubkey::find_program_address(
        &[b"content", version_raw_hash.as_ref()],
        &plotarmor::ID,
    )
    .0;
    let version_anchor_record = Pubkey::find_program_address(
        &[b"anchor", content_artifact.as_ref(), version_anchor_nonce.as_ref()],
        &plotarmor::ID,
    )
    .0;
    let version_claim_link = Pubkey::find_program_address(
        &[b"claim_artifact", work_claim.as_ref(), version_link_nonce.as_ref()],
        &plotarmor::ID,
    )
    .0;

    let instruction = Instruction::new_with_bytes(
        plotarmor::ID,
        &plotarmor::instruction::AddVersion {
            raw_hash: version_raw_hash,
            content_kind: 2,
            link_nonce: version_link_nonce,
            anchor_nonce: version_anchor_nonce,
            anchor_mode_arg: ANCHOR_MODE,
            expected_previous_link: root_link,
            external_ref_hash: version_ext,
        }
        .data(),
        plotarmor::accounts::AddVersion {
            registry_config,
            work_claim,
            content_artifact,
            claim_artifact_link: version_claim_link,
            anchor_record: version_anchor_record,
            claimant: ctx.authority.pubkey(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send_instruction(&mut ctx.svm, instruction, &ctx.authority);

    let version_ar: AnchorRecord = read_account(&ctx.svm, &version_anchor_record);
    assert_eq!(version_ar.external_ref_hash, version_ext);
    // Confirm the version hash differs from the root hash.
    assert_ne!(version_ar.external_ref_hash, root_ext);
}

// 6. Re-registering the SAME content (same raw_hash, same claimant) fails on the
//    WorkClaim PDA collision regardless of external_ref_hash — the second call
//    cannot overwrite the first's binding.
#[test]
fn ext_ref_cannot_overwrite_via_reregister() {
    let mut ctx = setup();
    let registry_config = initialize_registry(&mut ctx.svm, &ctx.authority);

    let raw_hash = [40; 32];
    let _ = register_claim_with_ext_ref(
        &mut ctx.svm,
        &ctx.authority,
        registry_config,
        raw_hash,
        [41; 32],
        [42; 32],
        [0xAA; 32],
    );

    // Second registration: same raw_hash + same claimant => same WorkClaim PDA.
    // Different external_ref_hash attempt must fail (account already in use).
    let content_artifact =
        Pubkey::find_program_address(&[b"content", raw_hash.as_ref()], &plotarmor::ID).0;
    let work_claim = Pubkey::find_program_address(
        &[b"claim", content_artifact.as_ref(), ctx.authority.pubkey().as_ref()],
        &plotarmor::ID,
    )
    .0;
    let ownership =
        Pubkey::find_program_address(&[b"ownership", work_claim.as_ref()], &plotarmor::ID).0;
    let owner_record = Pubkey::find_program_address(
        &[b"owner", ownership.as_ref(), ctx.authority.pubkey().as_ref()],
        &plotarmor::ID,
    )
    .0;
    let link_nonce = [43; 32];
    let anchor_nonce = [44; 32];
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
            anchor_mode_arg: ANCHOR_MODE,
            external_ref_hash: [0xBB; 32], // attempt to overwrite
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
            signer: ctx.authority.pubkey(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    let error = send_instruction_result(&mut ctx.svm, instruction, &ctx.authority).unwrap_err();
    // Anchor's init constraint fails with a custom program error / already in use.
    // We assert the tx failed; the original binding remains [0xAA; 32].
    let _ = error;

    // Confirm the ORIGINAL anchor record still holds the first hash, unchanged.
    let original_anchor = Pubkey::find_program_address(
        &[b"anchor", work_claim.as_ref(), [42u8; 32].as_ref()],
        &plotarmor::ID,
    )
    .0;
    let ar: AnchorRecord = read_account(&ctx.svm, &original_anchor);
    assert_eq!(ar.external_ref_hash, [0xAA; 32]);
}

// ─────────────────────────────────────────────────────────────────────────────
// external_ref_hash stress tests — add_version, anchor_evidence_contract,
// anchor_authorized_contract
// Mirrors the register_work_claim stress tests above, one block per instruction.
// Appended 2026-06-23.
// ─────────────────────────────────────────────────────────────────────────────

// Helper: add a version with an explicit external_ref_hash.
// Returns the AnchorRecord PDA.
fn add_version_with_ext_ref(
    svm: &mut litesvm::LiteSVM,
    claimant: &Keypair,
    registry_config: Pubkey,
    work_claim: Pubkey,
    raw_hash: [u8; 32],
    link_nonce: [u8; 32],
    anchor_nonce: [u8; 32],
    expected_previous_link: Pubkey,
    external_ref_hash: [u8; 32],
) -> Pubkey {
    let content_artifact =
        Pubkey::find_program_address(&[b"content", raw_hash.as_ref()], &plotarmor::ID).0;
    let claim_artifact_link = Pubkey::find_program_address(
        &[b"claim_artifact", work_claim.as_ref(), link_nonce.as_ref()],
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
            content_kind: 1,
            link_nonce,
            anchor_nonce,
            anchor_mode_arg: ANCHOR_MODE,
            expected_previous_link,
            external_ref_hash,
        }
        .data(),
        plotarmor::accounts::AddVersion {
            registry_config,
            work_claim,
            content_artifact,
            claim_artifact_link,
            anchor_record,
            claimant: claimant.pubkey(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send_instruction(svm, instruction, claimant);
    anchor_record
}

// Helper: anchor an evidence contract with an explicit external_ref_hash.
// Returns the AnchorRecord PDA.
fn anchor_evidence_with_ext_ref(
    svm: &mut litesvm::LiteSVM,
    anchorer: &Keypair,
    registry_config: Pubkey,
    raw_contract_hash: [u8; 32],
    anchor_nonce: [u8; 32],
    asserted_work_claim: Pubkey,
    external_ref_hash: [u8; 32],
) -> Pubkey {
    let contract_artifact =
        Pubkey::find_program_address(&[b"contract_artifact", raw_contract_hash.as_ref()], &plotarmor::ID).0;
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
            asserted_work_claim,
            external_ref_hash,
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
    anchor_record
}

// Helper: anchor an authorized contract with an explicit external_ref_hash.
// Returns the AnchorRecord PDA.
fn anchor_authorized_with_ext_ref(
    svm: &mut litesvm::LiteSVM,
    admin: &Keypair,
    registry_config: Pubkey,
    work_claim: Pubkey,
    ownership: Pubkey,
    raw_contract_hash: [u8; 32],
    anchor_nonce: [u8; 32],
    external_ref_hash: [u8; 32],
) -> Pubkey {
    let contract_artifact =
        Pubkey::find_program_address(&[b"contract_artifact", raw_contract_hash.as_ref()], &plotarmor::ID).0;
    let authorized_contract_anchor = Pubkey::find_program_address(
        &[b"authorized_contract", work_claim.as_ref(), contract_artifact.as_ref()],
        &plotarmor::ID,
    )
    .0;
    let anchor_record = Pubkey::find_program_address(
        &[b"anchor", authorized_contract_anchor.as_ref(), anchor_nonce.as_ref()],
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
            external_ref_hash,
        }
        .data(),
        plotarmor::accounts::AnchorAuthorizedContract {
            registry_config,
            work_claim,
            ownership,
            contract_artifact,
            authorized_contract_anchor,
            anchor_record,
            admin: admin.pubkey(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send_instruction(svm, instruction, admin);
    anchor_record
}

// ── add_version stress tests ──────────────────────────────────────────────────

#[test]
fn add_version_ext_ref_all_zeros_accepted() {
    let mut ctx = setup();
    let registry_config = initialize_registry(&mut ctx.svm, &ctx.authority);
    let (_, work_claim) = register_claim_with_ext_ref(
        &mut ctx.svm, &ctx.authority, registry_config,
        [50; 32], [51; 32], [52; 32], [0u8; 32],
    );
    let root_link = Pubkey::find_program_address(
        &[b"claim_artifact", work_claim.as_ref(), [51u8; 32].as_ref()],
        &plotarmor::ID,
    ).0;
    let ar_pda = add_version_with_ext_ref(
        &mut ctx.svm, &ctx.authority, registry_config, work_claim,
        [53; 32], [54; 32], [55; 32], root_link, [0u8; 32],
    );
    let ar: AnchorRecord = read_account(&ctx.svm, &ar_pda);
    assert_eq!(ar.external_ref_hash, [0u8; 32]);
}

#[test]
fn add_version_ext_ref_all_ones_accepted() {
    let mut ctx = setup();
    let registry_config = initialize_registry(&mut ctx.svm, &ctx.authority);
    let (_, work_claim) = register_claim_with_ext_ref(
        &mut ctx.svm, &ctx.authority, registry_config,
        [60; 32], [61; 32], [62; 32], [0u8; 32],
    );
    let root_link = Pubkey::find_program_address(
        &[b"claim_artifact", work_claim.as_ref(), [61u8; 32].as_ref()],
        &plotarmor::ID,
    ).0;
    let ar_pda = add_version_with_ext_ref(
        &mut ctx.svm, &ctx.authority, registry_config, work_claim,
        [63; 32], [64; 32], [65; 32], root_link, [0xFFu8; 32],
    );
    let ar: AnchorRecord = read_account(&ctx.svm, &ar_pda);
    assert_eq!(ar.external_ref_hash, [0xFFu8; 32]);
}

#[test]
fn add_version_ext_ref_realistic_cid_digest_roundtrips() {
    let mut ctx = setup();
    let registry_config = initialize_registry(&mut ctx.svm, &ctx.authority);
    let digest: [u8; 32] = [
        0x1a, 0x2b, 0x3c, 0x4d, 0x5e, 0x6f, 0x70, 0x81,
        0x92, 0xa3, 0xb4, 0xc5, 0xd6, 0xe7, 0xf8, 0x09,
        0x10, 0x21, 0x32, 0x43, 0x54, 0x65, 0x76, 0x87,
        0x98, 0xa9, 0xba, 0xcb, 0xdc, 0xed, 0xfe, 0x0f,
    ];
    let (_, work_claim) = register_claim_with_ext_ref(
        &mut ctx.svm, &ctx.authority, registry_config,
        [70; 32], [71; 32], [72; 32], [0u8; 32],
    );
    let root_link = Pubkey::find_program_address(
        &[b"claim_artifact", work_claim.as_ref(), [71u8; 32].as_ref()],
        &plotarmor::ID,
    ).0;
    let ar_pda = add_version_with_ext_ref(
        &mut ctx.svm, &ctx.authority, registry_config, work_claim,
        [73; 32], [74; 32], [75; 32], root_link, digest,
    );
    let ar: AnchorRecord = read_account(&ctx.svm, &ar_pda);
    assert_eq!(ar.external_ref_hash, digest);
}

#[test]
fn add_version_ext_ref_distinct_from_root() {
    let mut ctx = setup();
    let registry_config = initialize_registry(&mut ctx.svm, &ctx.authority);
    let root_ext: [u8; 32] = [0x11; 32];
    let version_ext: [u8; 32] = [0x22; 32];
    let (root_ar_pda, work_claim) = register_claim_with_ext_ref(
        &mut ctx.svm, &ctx.authority, registry_config,
        [80; 32], [81; 32], [82; 32], root_ext,
    );
    let root_link = Pubkey::find_program_address(
        &[b"claim_artifact", work_claim.as_ref(), [81u8; 32].as_ref()],
        &plotarmor::ID,
    ).0;
    let ver_ar_pda = add_version_with_ext_ref(
        &mut ctx.svm, &ctx.authority, registry_config, work_claim,
        [83; 32], [84; 32], [85; 32], root_link, version_ext,
    );
    let root_ar: AnchorRecord = read_account(&ctx.svm, &root_ar_pda);
    let ver_ar: AnchorRecord = read_account(&ctx.svm, &ver_ar_pda);
    assert_eq!(root_ar.external_ref_hash, root_ext);
    assert_eq!(ver_ar.external_ref_hash, version_ext);
    assert_ne!(root_ar.external_ref_hash, ver_ar.external_ref_hash);
}

// ── anchor_evidence_contract stress tests ─────────────────────────────────────

#[test]
fn evidence_ext_ref_all_zeros_accepted() {
    let mut ctx = setup();
    let registry_config = initialize_registry(&mut ctx.svm, &ctx.authority);
    let ar_pda = anchor_evidence_with_ext_ref(
        &mut ctx.svm, &ctx.authority, registry_config,
        [90; 32], [91; 32], Pubkey::default(), [0u8; 32],
    );
    let ar: AnchorRecord = read_account(&ctx.svm, &ar_pda);
    assert_eq!(ar.external_ref_hash, [0u8; 32]);
}

#[test]
fn evidence_ext_ref_all_ones_accepted() {
    let mut ctx = setup();
    let registry_config = initialize_registry(&mut ctx.svm, &ctx.authority);
    let ar_pda = anchor_evidence_with_ext_ref(
        &mut ctx.svm, &ctx.authority, registry_config,
        [92; 32], [93; 32], Pubkey::default(), [0xFFu8; 32],
    );
    let ar: AnchorRecord = read_account(&ctx.svm, &ar_pda);
    assert_eq!(ar.external_ref_hash, [0xFFu8; 32]);
}

#[test]
fn evidence_ext_ref_realistic_cid_digest_roundtrips() {
    let mut ctx = setup();
    let registry_config = initialize_registry(&mut ctx.svm, &ctx.authority);
    let digest: [u8; 32] = [
        0x1a, 0x2b, 0x3c, 0x4d, 0x5e, 0x6f, 0x70, 0x81,
        0x92, 0xa3, 0xb4, 0xc5, 0xd6, 0xe7, 0xf8, 0x09,
        0x10, 0x21, 0x32, 0x43, 0x54, 0x65, 0x76, 0x87,
        0x98, 0xa9, 0xba, 0xcb, 0xdc, 0xed, 0xfe, 0x0f,
    ];
    let ar_pda = anchor_evidence_with_ext_ref(
        &mut ctx.svm, &ctx.authority, registry_config,
        [94; 32], [95; 32], Pubkey::default(), digest,
    );
    let ar: AnchorRecord = read_account(&ctx.svm, &ar_pda);
    assert_eq!(ar.external_ref_hash, digest);
}

// ── anchor_authorized_contract stress tests ───────────────────────────────────

#[test]
fn authorized_ext_ref_all_zeros_accepted() {
    let mut ctx = setup();
    let registry_config = initialize_registry(&mut ctx.svm, &ctx.authority);
    let (_, work_claim) = register_claim_with_ext_ref(
        &mut ctx.svm, &ctx.authority, registry_config,
        [100; 32], [101; 32], [102; 32], [0u8; 32],
    );
    let ownership = Pubkey::find_program_address(
        &[b"ownership", work_claim.as_ref()], &plotarmor::ID,
    ).0;
    let ar_pda = anchor_authorized_with_ext_ref(
        &mut ctx.svm, &ctx.authority, registry_config, work_claim, ownership,
        [103; 32], [104; 32], [0u8; 32],
    );
    let ar: AnchorRecord = read_account(&ctx.svm, &ar_pda);
    assert_eq!(ar.external_ref_hash, [0u8; 32]);
}

#[test]
fn authorized_ext_ref_all_ones_accepted() {
    let mut ctx = setup();
    let registry_config = initialize_registry(&mut ctx.svm, &ctx.authority);
    let (_, work_claim) = register_claim_with_ext_ref(
        &mut ctx.svm, &ctx.authority, registry_config,
        [105; 32], [106; 32], [107; 32], [0u8; 32],
    );
    let ownership = Pubkey::find_program_address(
        &[b"ownership", work_claim.as_ref()], &plotarmor::ID,
    ).0;
    let ar_pda = anchor_authorized_with_ext_ref(
        &mut ctx.svm, &ctx.authority, registry_config, work_claim, ownership,
        [108; 32], [109; 32], [0xFFu8; 32],
    );
    let ar: AnchorRecord = read_account(&ctx.svm, &ar_pda);
    assert_eq!(ar.external_ref_hash, [0xFFu8; 32]);
}

#[test]
fn authorized_ext_ref_realistic_cid_digest_roundtrips() {
    let mut ctx = setup();
    let registry_config = initialize_registry(&mut ctx.svm, &ctx.authority);
    let digest: [u8; 32] = [
        0x1a, 0x2b, 0x3c, 0x4d, 0x5e, 0x6f, 0x70, 0x81,
        0x92, 0xa3, 0xb4, 0xc5, 0xd6, 0xe7, 0xf8, 0x09,
        0x10, 0x21, 0x32, 0x43, 0x54, 0x65, 0x76, 0x87,
        0x98, 0xa9, 0xba, 0xcb, 0xdc, 0xed, 0xfe, 0x0f,
    ];
    let (_, work_claim) = register_claim_with_ext_ref(
        &mut ctx.svm, &ctx.authority, registry_config,
        [110; 32], [111; 32], [112; 32], [0u8; 32],
    );
    let ownership = Pubkey::find_program_address(
        &[b"ownership", work_claim.as_ref()], &plotarmor::ID,
    ).0;
    let ar_pda = anchor_authorized_with_ext_ref(
        &mut ctx.svm, &ctx.authority, registry_config, work_claim, ownership,
        [113; 32], [114; 32], digest,
    );
    let ar: AnchorRecord = read_account(&ctx.svm, &ar_pda);
    assert_eq!(ar.external_ref_hash, digest);
}

// Negative counterpart to init_registry_config_happy_path.
//
// Every other test in this repo (via common::setup) patches ProgramData so
// upgrade_authority_address matches the caller, which exercises only the PASSING
// side of init_registry_config's upgrade-authority constraint. Until this test,
// nothing anywhere confirmed a non-authority signer is actually rejected, even
// though that constraint is the only thing standing between an arbitrary wallet
// and the protocol's RegistryConfig singleton (Known v1 limitations, item B).
//
// Patches ProgramData to name a DIFFERENT pubkey as upgrade authority, then has
// context.authority (a legitimately funded wallet that is now NOT the upgrade
// authority) call init_registry_config. Expect Unauthorized (6009).
//
// Note this isolates the SECOND constraint on init_registry_config. The
// program_data address passed is the canonical one, so the first constraint
// (program.programdata_address()? == program_data.key()) passes and the failure
// can only come from the upgrade-authority comparison.
fn patch_upgrade_authority(svm: &mut litesvm::LiteSVM, new_authority: Pubkey) {
    use solana_loader_v3_interface::state::UpgradeableLoaderState;
    use solana_sdk_ids::bpf_loader_upgradeable;

    // Same shape as common/mod.rs setup(), which is the established pattern for
    // rewriting the ProgramData header under LiteSVM.
    let programdata_address = Pubkey::find_program_address(
        &[plotarmor::ID.as_ref()],
        &bpf_loader_upgradeable::id(),
    ).0;
    let mut pd_account = svm.get_account(&programdata_address).unwrap();
    let metadata_len = UpgradeableLoaderState::size_of_programdata_metadata();
    let existing: UpgradeableLoaderState =
        bincode::deserialize(&pd_account.data[..metadata_len]).unwrap();
    let slot = match existing {
        UpgradeableLoaderState::ProgramData { slot, .. } => slot,
        _ => 0,
    };
    let new_header = UpgradeableLoaderState::ProgramData {
        slot,
        upgrade_authority_address: Some(new_authority),
    };
    let header_bytes = bincode::serialize(&new_header).unwrap();
    pd_account.data[..metadata_len].copy_from_slice(&header_bytes);
    svm.set_account(programdata_address, pd_account).unwrap();
}

#[test]
fn non_upgrade_authority_cannot_init_registry_config() {
    use solana_sdk_ids::bpf_loader_upgradeable;

    let mut context = setup();

    // The real upgrade authority is somebody else entirely.
    let real_upgrade_authority = Keypair::new();
    patch_upgrade_authority(&mut context.svm, real_upgrade_authority.pubkey());

    // Sanity: the impostor is funded and is NOT the recorded upgrade authority,
    // so a rejection cannot be mistaken for insufficient lamports.
    assert_ne!(
        context.authority.pubkey(),
        real_upgrade_authority.pubkey(),
        "impostor must differ from the recorded upgrade authority"
    );

    let registry_config = Pubkey::find_program_address(&[b"config"], &plotarmor::ID).0;
    let program_data = Pubkey::find_program_address(
        &[plotarmor::ID.as_ref()],
        &bpf_loader_upgradeable::id(),
    ).0;

    let instruction = Instruction::new_with_bytes(
        plotarmor::ID,
        &plotarmor::instruction::InitRegistryConfig {}.data(),
        plotarmor::accounts::InitRegistryConfig {
            registry_config,
            signer: context.authority.pubkey(),
            system_program: system_program::ID,
            program: plotarmor::ID,
            program_data,
        }
        .to_account_metas(None),
    );

    let error = send_instruction_result(&mut context.svm, instruction, &context.authority)
        .expect_err("init_registry_config must reject a signer that is not the upgrade authority");
    assert_anchor_error(&error, "Unauthorized", 6009);

    // The singleton must not exist afterwards; a rejected init must leave no state.
    assert!(
        context.svm.get_account(&registry_config).is_none()
            || context
                .svm
                .get_account(&registry_config)
                .map(|a| a.owner != plotarmor::ID)
                .unwrap_or(true),
        "RegistryConfig must not have been created by a rejected init"
    );
}

// REGRESSION PIN, added 2026-09-04. DO NOT "FIX" THE BEHAVIOR THIS TEST ASSERTS.
//
// add_version's AnchorRecord is seeded ["anchor", content_artifact, anchor_nonce].
// That is CORRECT per the PDA canon, which specifies
// ["anchor", anchored_object_pda, anchor_nonce], and add_version's anchored object
// IS the ContentArtifact (anchored_object_kind = ContentArtifact = 1). All four
// anchoring instructions satisfy seed_base == anchored_object.
//
// Because ContentArtifact is content-addressed and therefore SHARED across every
// claimant who registers the same bytes, the resulting AnchorRecord PDA carries no
// principal. Two claimants adding the same version content with the same
// anchor_nonce derive the SAME address, and the second one loses the race with
// account-already-in-use. A party observing a pending add_version can exploit this
// deliberately to grief a specific creator.
//
// This was raised as finding M1 in the 2026-09-03 audit and DELIBERATELY NOT FIXED
// by a seed change, for reasons recorded in CLAUDE.md under the PDA canon:
// seeds are permanent, the change would orphan live devnet AnchorRecords, it would
// make add_version the only instruction whose seed base is not its anchored object,
// and recovery is a one-line client action. Recovery is to generate a FRESH
// anchor_nonce and resubmit; the link_nonce is reused unchanged, because a failed
// transaction reverts atomically and creates no ClaimArtifactLink.
//
// This test pins all of that so a future reader who has not seen the history cannot
// quietly "fix" the seed without a loud, explanatory failure here.
#[test]
fn add_version_anchor_record_is_content_scoped_not_claimant_scoped() {
    let mut ctx = setup();
    let registry_config = initialize_registry(&mut ctx.svm, &ctx.authority);

    let alice = Keypair::new();
    let bob = Keypair::new();
    ctx.svm.airdrop(&alice.pubkey(), TEST_KEYPAIR_LAMPORTS).unwrap();
    ctx.svm.airdrop(&bob.pubkey(), TEST_KEYPAIR_LAMPORTS).unwrap();

    // Content-addressing convergence: one root ContentArtifact, two WorkClaims.
    let root_hash = [200u8; 32];
    let alice_claim = register_claim(
        &mut ctx.svm, &alice, registry_config, root_hash, [201; 32], [202; 32],
    );
    let bob_claim = register_claim(
        &mut ctx.svm, &bob, registry_config, root_hash, [203; 32], [204; 32],
    );
    assert_ne!(
        alice_claim.work_claim, bob_claim.work_claim,
        "two claimants over the same content must get distinct WorkClaims"
    );

    // Both now add the SAME new version content with the SAME anchor_nonce.
    let version_hash = [210u8; 32];
    let shared_nonce = [211u8; 32];
    let version_content = Pubkey::find_program_address(
        &[b"content", version_hash.as_ref()], &plotarmor::ID,
    ).0;

    // The seed shape under test. If someone adds a principal to the seed, the
    // account asserted below will not exist and this test fails loudly.
    let shared_anchor_record = Pubkey::find_program_address(
        &[b"anchor", version_content.as_ref(), shared_nonce.as_ref()],
        &plotarmor::ID,
    ).0;

    // Alice goes first and takes the PDA.
    send_instruction(
        &mut ctx.svm,
        build_add_version(
            &alice, registry_config, alice_claim.work_claim, version_hash, 1,
            [212; 32], shared_nonce, alice_claim.claim_artifact_link,
        ),
        &alice,
    );

    let record: AnchorRecord = read_account(&ctx.svm, &shared_anchor_record);
    assert_eq!(
        record.anchored_object, version_content,
        "canon: the AnchorRecord seed base must equal its anchored_object"
    );
    assert_eq!(record.anchored_object_kind, 1, "add_version anchors the ContentArtifact");

    // Bob, on his own unrelated WorkClaim, collides on the identical PDA.
    let error = send_instruction_result(
        &mut ctx.svm,
        build_add_version(
            &bob, registry_config, bob_claim.work_claim, version_hash, 1,
            [213; 32], shared_nonce, bob_claim.claim_artifact_link,
        ),
        &bob,
    )
    .unwrap_err();
    let diagnostic = format!("{error:?}");
    assert!(
        diagnostic.contains("already in use") || diagnostic.contains("AccountAlreadyInUse"),
        "expected the shared AnchorRecord PDA to already be taken, got {error:?}"
    );

    // RECOVERY, the documented mitigation: rotate only the anchor_nonce. The
    // link_nonce is reused unchanged, since Bob's failed transaction reverted
    // atomically and created no ClaimArtifactLink.
    let fresh_nonce = [214u8; 32];
    send_instruction(
        &mut ctx.svm,
        build_add_version(
            &bob, registry_config, bob_claim.work_claim, version_hash, 1,
            [213; 32], fresh_nonce, bob_claim.claim_artifact_link,
        ),
        &bob,
    );

    let bob_anchor_record = Pubkey::find_program_address(
        &[b"anchor", version_content.as_ref(), fresh_nonce.as_ref()],
        &plotarmor::ID,
    ).0;
    assert_ne!(
        shared_anchor_record, bob_anchor_record,
        "a fresh anchor_nonce must yield a different AnchorRecord address"
    );
    assert!(
        ctx.svm.get_account(&bob_anchor_record).is_some(),
        "recovery with a fresh nonce must succeed"
    );

    // Both records survive, and both heads advanced independently.
    let alice_wc: WorkClaim = read_account(&ctx.svm, &alice_claim.work_claim);
    let bob_wc: WorkClaim = read_account(&ctx.svm, &bob_claim.work_claim);
    assert_eq!(alice_wc.latest_artifact, version_content);
    assert_eq!(bob_wc.latest_artifact, version_content);
    assert_ne!(
        alice_wc.latest_link, bob_wc.latest_link,
        "each claimant keeps an independent lineage head"
    );
}
