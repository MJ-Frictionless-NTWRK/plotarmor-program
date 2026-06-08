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
    let registry_config =
        Pubkey::find_program_address(&[b"config"], &plotarmor::ID).0;

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
