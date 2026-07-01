use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::instruction::Instruction,
        AccountDeserialize,
    },
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_loader_v3_interface::state::UpgradeableLoaderState,
    solana_message::{Message, VersionedMessage},
    solana_sdk_ids::bpf_loader_upgradeable,
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

const TEST_KEYPAIR_LAMPORTS: u64 = 10_000_000_000;
pub const ANCHOR_MODE: u8 = 1;

pub struct TestContext {
    pub svm: LiteSVM,
    pub payer: Keypair,
    pub authority: Keypair,
}

pub fn setup() -> TestContext {
    let payer = Keypair::new();
    let authority = Keypair::new();
    let mut svm = LiteSVM::new();

    // The mainnet feature gates SimulatedModeRejected inside the on-chain program
    // itself (see helpers.rs). cargo test --features mainnet only recompiles this
    // native test crate; it does NOT rebuild the separate BPF/SBF .so that LiteSVM
    // actually executes. Each feature set needs its own prebuilt artifact at a
    // distinct path, or the mainnet-gated tests silently run against a stale
    // non-mainnet binary. Build with:
    //   default:  anchor build
    //   mainnet:  cargo build-sbf --manifest-path programs/plotarmor/Cargo.toml \
    //               --features mainnet --sbf-out-dir target/deploy-mainnet
    #[cfg(feature = "mainnet")]
    let program_bytes: &[u8] =
        include_bytes!("../../../../target/deploy-mainnet/plotarmor.so");
    #[cfg(not(feature = "mainnet"))]
    let program_bytes: &[u8] =
        include_bytes!("../../../../target/deploy/plotarmor.so");

    svm.add_program(plotarmor::ID, program_bytes).unwrap();

    // LiteSVM sets upgrade_authority_address = None by default.
    // Patch it so init_registry_config's upgrade-authority constraint passes.
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
        upgrade_authority_address: Some(authority.pubkey()),
    };
    let header_bytes = bincode::serialize(&new_header).unwrap();
    pd_account.data[..metadata_len].copy_from_slice(&header_bytes);
    svm.set_account(programdata_address, pd_account).unwrap();

    svm.airdrop(&payer.pubkey(), TEST_KEYPAIR_LAMPORTS).unwrap();
    svm.airdrop(&authority.pubkey(), TEST_KEYPAIR_LAMPORTS)
        .unwrap();

    TestContext {
        svm,
        payer,
        authority,
    }
}

pub fn send_instruction(
    svm: &mut LiteSVM,
    instruction: Instruction,
    signer: &Keypair,
) {
    let message = Message::new_with_blockhash(
        &[instruction],
        Some(&signer.pubkey()),
        &svm.latest_blockhash(),
    );
    let transaction = VersionedTransaction::try_new(
        VersionedMessage::Legacy(message),
        &[signer],
    )
    .unwrap();

    svm.send_transaction(transaction).unwrap();
}

pub fn read_account<T: AccountDeserialize>(
    svm: &LiteSVM,
    address: &Pubkey,
) -> T {
    let account = svm.get_account(address).unwrap();
    T::try_deserialize(&mut account.data.as_slice()).unwrap()
}
