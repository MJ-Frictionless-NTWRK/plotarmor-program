use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::instruction::Instruction,
        AccountDeserialize,
    },
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
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

    let program_bytes =
        include_bytes!("../../../../target/deploy/plotarmor.so");

    svm.add_program(plotarmor::ID, program_bytes).unwrap();
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
