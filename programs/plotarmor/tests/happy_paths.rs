mod common;

use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{instruction::Instruction, system_program},
        InstructionData, ToAccountMetas,
    },
    common::{read_account, send_instruction, setup, ANCHOR_MODE},
    plotarmor::{
        AnchorRecord, AuthorizedContractAnchor, ClaimArtifactLink,
        ContentArtifact, ContractArtifact, EvidenceAnchor, OwnerRecord,
        Ownership, RegistryConfig, WorkClaim,
    },
    solana_keypair::Keypair,
    solana_signer::Signer,
};

struct ClaimFixture {
    content_artifact: Pubkey,
    work_claim: Pubkey,
    ownership: Pubkey,
    owner_record: Pubkey,
    claim_artifact_link: Pubkey,
    anchor_record: Pubkey,
}

fn initialize_registry(
    svm: &mut litesvm::LiteSVM,
    authority: &Keypair,
) -> Pubkey {
    use solana_sdk_ids::bpf_loader_upgradeable;
    let registry_config =
        Pubkey::find_program_address(&[b"config"], &plotarmor::ID).0;
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

fn register_claim(
    svm: &mut litesvm::LiteSVM,
    authority: &Keypair,
    registry_config: Pubkey,
    raw_hash: [u8; 32],
    link_nonce: [u8; 32],
    anchor_nonce: [u8; 32],
) -> ClaimFixture {
    let content_artifact = Pubkey::find_program_address(
        &[b"content", raw_hash.as_ref()],
        &plotarmor::ID,
    )
    .0;
    let work_claim = Pubkey::find_program_address(
        &[
            b"claim",
            content_artifact.as_ref(),
            authority.pubkey().as_ref(),
        ],
        &plotarmor::ID,
    )
    .0;
    let ownership = Pubkey::find_program_address(
        &[b"ownership", work_claim.as_ref()],
        &plotarmor::ID,
    )
    .0;
    let owner_record = Pubkey::find_program_address(
        &[
            b"owner",
            ownership.as_ref(),
            authority.pubkey().as_ref(),
        ],
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
            signer: authority.pubkey(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );

    send_instruction(svm, instruction, authority);

    ClaimFixture {
        content_artifact,
        work_claim,
        ownership,
        owner_record,
        claim_artifact_link,
        anchor_record,
    }
}

#[test]
fn init_registry_config_happy_path() {
    let mut context = setup();
    let registry_config =
        initialize_registry(&mut context.svm, &context.authority);

    let config: RegistryConfig =
        read_account(&context.svm, &registry_config);

    assert_eq!(config.authority, context.authority.pubkey());
    assert_eq!(config.schema_version, 1);
    assert!(!config.paused);
}

#[test]
fn register_work_claim_happy_path() {
    let mut context = setup();
    let registry_config =
        initialize_registry(&mut context.svm, &context.authority);
    let fixture = register_claim(
        &mut context.svm,
        &context.authority,
        registry_config,
        [1; 32],
        [2; 32],
        [3; 32],
    );

    let work_claim: WorkClaim =
        read_account(&context.svm, &fixture.work_claim);
    let _: ContentArtifact =
        read_account(&context.svm, &fixture.content_artifact);
    let _: Ownership =
        read_account(&context.svm, &fixture.ownership);
    let _: OwnerRecord =
        read_account(&context.svm, &fixture.owner_record);
    let _: ClaimArtifactLink =
        read_account(&context.svm, &fixture.claim_artifact_link);
    let _: AnchorRecord =
        read_account(&context.svm, &fixture.anchor_record);

    assert_eq!(work_claim.latest_link, fixture.claim_artifact_link);
    assert_eq!(work_claim.latest_artifact, fixture.content_artifact);
}

#[test]
fn add_version_happy_path() {
    let mut context = setup();
    let registry_config =
        initialize_registry(&mut context.svm, &context.authority);
    let fixture = register_claim(
        &mut context.svm,
        &context.authority,
        registry_config,
        [10; 32],
        [11; 32],
        [12; 32],
    );

    let raw_hash = [13; 32];
    let link_nonce = [14; 32];
    let anchor_nonce = [15; 32];

    let content_artifact = Pubkey::find_program_address(
        &[b"content", raw_hash.as_ref()],
        &plotarmor::ID,
    )
    .0;
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
        &[
            b"anchor",
            content_artifact.as_ref(),
            anchor_nonce.as_ref(),
        ],
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
            signer: context.authority.pubkey(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );

    send_instruction(&mut context.svm, instruction, &context.authority);

    let work_claim: WorkClaim =
        read_account(&context.svm, &fixture.work_claim);

    assert_eq!(work_claim.latest_artifact, content_artifact);
    assert_eq!(work_claim.latest_link, claim_artifact_link);
}

#[test]
fn add_owner_happy_path() {
    let mut context = setup();
    let registry_config =
        initialize_registry(&mut context.svm, &context.authority);
    let fixture = register_claim(
        &mut context.svm,
        &context.authority,
        registry_config,
        [20; 32],
        [21; 32],
        [22; 32],
    );

    let new_owner = Keypair::new();
    context
        .svm
        .airdrop(&new_owner.pubkey(), 10_000_000_000)
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
            admin: context.authority.pubkey(),
            new_owner: new_owner.pubkey(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );

    send_instruction(&mut context.svm, instruction, &context.authority);

    let owner: OwnerRecord =
        read_account(&context.svm, &new_owner_record);
    let ownership: Ownership =
        read_account(&context.svm, &fixture.ownership);

    assert_eq!(owner.owner, new_owner.pubkey());
    assert_eq!(owner.share, 50);
    assert_eq!(ownership.total_shares, 150);
}

#[test]
fn anchor_evidence_contract_happy_path() {
    let mut context = setup();
    let registry_config =
        initialize_registry(&mut context.svm, &context.authority);

    let raw_contract_hash = [30; 32];
    let anchor_nonce = [31; 32];
    let asserted_work_claim = Pubkey::new_unique();

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
        &[
            b"anchor",
            evidence_anchor.as_ref(),
            anchor_nonce.as_ref(),
        ],
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

    send_instruction(&mut context.svm, instruction, &context.authority);

    let _: ContractArtifact =
        read_account(&context.svm, &contract_artifact);
    let evidence: EvidenceAnchor =
        read_account(&context.svm, &evidence_anchor);
    let _: AnchorRecord =
        read_account(&context.svm, &anchor_record);

    assert_eq!(evidence.asserted_work_claim, asserted_work_claim);
}

#[test]
fn anchor_authorized_contract_happy_path() {
    let mut context = setup();
    let registry_config =
        initialize_registry(&mut context.svm, &context.authority);
    let fixture = register_claim(
        &mut context.svm,
        &context.authority,
        registry_config,
        [40; 32],
        [41; 32],
        [42; 32],
    );

    let raw_contract_hash = [43; 32];
    let anchor_nonce = [44; 32];

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
            admin: context.authority.pubkey(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );

    send_instruction(&mut context.svm, instruction, &context.authority);

    let _: ContractArtifact =
        read_account(&context.svm, &contract_artifact);
    let authorized: AuthorizedContractAnchor =
        read_account(&context.svm, &authorized_contract_anchor);
    let _: AnchorRecord =
        read_account(&context.svm, &anchor_record);

    assert_eq!(authorized.work_claim, fixture.work_claim);
    assert_eq!(authorized.contract_artifact, contract_artifact);
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
    let transaction =
        solana_transaction::versioned::VersionedTransaction::try_new(
            solana_message::VersionedMessage::Legacy(message),
            &[signer],
        )
        .unwrap();

    svm.send_transaction(transaction)
}

fn build_register_claim(
    claimant: &Keypair,
    registry_config: Pubkey,
    raw_hash: [u8; 32],
    content_kind: u8,
    link_nonce: [u8; 32],
    anchor_nonce: [u8; 32],
) -> (Instruction, ClaimFixture) {
    let content_artifact = Pubkey::find_program_address(
        &[b"content", raw_hash.as_ref()],
        &plotarmor::ID,
    )
    .0;
    let work_claim = Pubkey::find_program_address(
        &[
            b"claim",
            content_artifact.as_ref(),
            claimant.pubkey().as_ref(),
        ],
        &plotarmor::ID,
    )
    .0;
    let ownership = Pubkey::find_program_address(
        &[b"ownership", work_claim.as_ref()],
        &plotarmor::ID,
    )
    .0;
    let owner_record = Pubkey::find_program_address(
        &[
            b"owner",
            ownership.as_ref(),
            claimant.pubkey().as_ref(),
        ],
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
            claim_kind: 1,
            total_shares: 100,
            threshold_shares: 100,
            link_nonce,
            anchor_nonce,
            anchor_mode_arg: ANCHOR_MODE,
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
            content_artifact,
            work_claim,
            ownership,
            owner_record,
            claim_artifact_link,
            anchor_record,
        },
    )
}

fn build_add_version(
    signer: &Keypair,
    registry_config: Pubkey,
    work_claim: Pubkey,
    raw_hash: [u8; 32],
    content_kind: u8,
    link_nonce: [u8; 32],
    anchor_nonce: [u8; 32],
    expected_previous_link: Pubkey,
) -> (Instruction, Pubkey, Pubkey) {
    let content_artifact = Pubkey::find_program_address(
        &[b"content", raw_hash.as_ref()],
        &plotarmor::ID,
    )
    .0;
    let claim_artifact_link = Pubkey::find_program_address(
        &[b"claim_artifact", work_claim.as_ref(), link_nonce.as_ref()],
        &plotarmor::ID,
    )
    .0;
    let anchor_record = Pubkey::find_program_address(
        &[
            b"anchor",
            content_artifact.as_ref(),
            anchor_nonce.as_ref(),
        ],
        &plotarmor::ID,
    )
    .0;

    let instruction = Instruction::new_with_bytes(
        plotarmor::ID,
        &plotarmor::instruction::AddVersion {
            raw_hash,
            content_kind,
            link_nonce,
            anchor_nonce,
            anchor_mode_arg: ANCHOR_MODE,
            expected_previous_link,
        }
        .data(),
        plotarmor::accounts::AddVersion {
            registry_config,
            work_claim,
            content_artifact,
            claim_artifact_link,
            anchor_record,
            signer: signer.pubkey(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );

    (instruction, content_artifact, claim_artifact_link)
}

fn assert_anchor_error(
    error: &litesvm::types::FailedTransactionMetadata,
    name: &str,
    code: u32,
) {
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
fn anti_fork_revert_on_stale_head() {
    let mut context = setup();
    let registry_config =
        initialize_registry(&mut context.svm, &context.authority);
    let fixture = register_claim(
        &mut context.svm,
        &context.authority,
        registry_config,
        [49; 32],
        [50; 32],
        [51; 32],
    );

    let wrong_head = Pubkey::new_unique();
    assert_ne!(wrong_head, fixture.claim_artifact_link);

    let (instruction, _, _) = build_add_version(
        &context.authority,
        registry_config,
        fixture.work_claim,
        [52; 32],
        2,
        [53; 32],
        [54; 32],
        wrong_head,
    );

    let error = send_instruction_result(
        &mut context.svm,
        instruction,
        &context.authority,
    )
    .unwrap_err();

    assert_anchor_error(&error, "StaleLineageHead", 6001);
}

#[test]
fn add_version_updates_both_heads() {
    let mut context = setup();
    let registry_config =
        initialize_registry(&mut context.svm, &context.authority);
    let fixture = register_claim(
        &mut context.svm,
        &context.authority,
        registry_config,
        [55; 32],
        [56; 32],
        [57; 32],
    );

    let (instruction, content_artifact, claim_artifact_link) =
        build_add_version(
            &context.authority,
            registry_config,
            fixture.work_claim,
            [58; 32],
            2,
            [59; 32],
            [60; 32],
            fixture.claim_artifact_link,
        );

    send_instruction(
        &mut context.svm,
        instruction,
        &context.authority,
    );

    let work_claim: WorkClaim =
        read_account(&context.svm, &fixture.work_claim);

    assert_eq!(work_claim.latest_artifact, content_artifact);
    assert_eq!(work_claim.latest_link, claim_artifact_link);
    assert_ne!(work_claim.latest_artifact, fixture.content_artifact);
    assert_ne!(work_claim.latest_link, fixture.claim_artifact_link);
}

#[test]
fn revert_to_earlier_version_succeeds() {
    let mut context = setup();
    let registry_config =
        initialize_registry(&mut context.svm, &context.authority);
    let fixture = register_claim(
        &mut context.svm,
        &context.authority,
        registry_config,
        [60; 32],
        [61; 32],
        [62; 32],
    );

    let (draft_instruction, _, draft_link) = build_add_version(
        &context.authority,
        registry_config,
        fixture.work_claim,
        [61; 32],
        2,
        [63; 32],
        [64; 32],
        fixture.claim_artifact_link,
    );
    send_instruction(
        &mut context.svm,
        draft_instruction,
        &context.authority,
    );

    let (revert_instruction, original_artifact, revert_link) =
        build_add_version(
            &context.authority,
            registry_config,
            fixture.work_claim,
            [60; 32],
            1,
            [65; 32],
            [66; 32],
            draft_link,
        );

    send_instruction_result(
        &mut context.svm,
        revert_instruction,
        &context.authority,
    )
    .expect("reverting to an earlier ContentArtifact should succeed");

    let work_claim: WorkClaim =
        read_account(&context.svm, &fixture.work_claim);

    assert_eq!(original_artifact, fixture.content_artifact);
    assert_eq!(work_claim.latest_artifact, original_artifact);
    assert_eq!(work_claim.latest_link, revert_link);
}

#[test]
fn is_initialized_guard_blocks_overwrite() {
    let mut context = setup();
    let registry_config =
        initialize_registry(&mut context.svm, &context.authority);

    let first_fixture = register_claim(
        &mut context.svm,
        &context.authority,
        registry_config,
        [70; 32],
        [71; 32],
        [72; 32],
    );

    let second_claimant = Keypair::new();
    context
        .svm
        .airdrop(&second_claimant.pubkey(), 10_000_000_000)
        .unwrap();

    let (instruction, second_fixture) = build_register_claim(
        &second_claimant,
        registry_config,
        [70; 32],
        2,
        [73; 32],
        [74; 32],
    );

    send_instruction_result(
        &mut context.svm,
        instruction,
        &second_claimant,
    )
    .expect("the second claimant should create an independent WorkClaim");

    assert_eq!(
        first_fixture.content_artifact,
        second_fixture.content_artifact
    );

    let _: WorkClaim =
        read_account(&context.svm, &second_fixture.work_claim);
    let content_artifact: ContentArtifact =
        read_account(&context.svm, &first_fixture.content_artifact);

    assert_eq!(content_artifact.content_kind, 1);
}

#[test]
fn paused_registry_rejects_writes() {
    use anchor_lang::AccountSerialize;

    let mut context = setup();
    let registry_config =
        initialize_registry(&mut context.svm, &context.authority);

    let mut config: RegistryConfig =
        read_account(&context.svm, &registry_config);
    config.paused = true;

    let mut config_account =
        context.svm.get_account(&registry_config).unwrap();
    config
        .try_serialize(&mut config_account.data.as_mut_slice())
        .unwrap();
    context
        .svm
        .set_account(registry_config, config_account)
        .unwrap();

    let (instruction, _) = build_register_claim(
        &context.authority,
        registry_config,
        [75; 32],
        1,
        [76; 32],
        [77; 32],
    );

    let error = send_instruction_result(
        &mut context.svm,
        instruction,
        &context.authority,
    )
    .unwrap_err();

    assert_anchor_error(&error, "Paused", 6008);
}
