import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  clusterApiUrl,
} from "@solana/web3.js";
import { randomBytes } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

const PROGRAM_ID = new PublicKey(
  "3h9CzV9MJDeD5yjhVhdE6cupuXVRnLW1Cu6P14EJBKv2",
);
const COMMITMENT = "confirmed";

type AccountMeasurement = {
  instruction: string;
  accountName: string;
  pubkey: string;
  dataLength: number;
  computeUnits: number;
  feeLamports: number;
  signature: string;
};

type MeasuredAccount = {
  name: string;
  pubkey: PublicKey;
};

function randomHash(): number[] {
  return Array.from(randomBytes(32));
}

function derive(seeds: Buffer[]): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
}

function loadPayer(): Keypair {
  const keypairPath = path.join(
    os.homedir(),
    ".config",
    "solana",
    "id.json",
  );
  const secretKey = JSON.parse(
    fs.readFileSync(keypairPath, "utf8"),
  ) as number[];

  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

async function getConfirmedTransaction(
  connection: Connection,
  signature: string,
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const transaction = await connection.getTransaction(signature, {
      commitment: COMMITMENT,
      maxSupportedTransactionVersion: 0,
    });

    if (transaction?.meta) {
      return transaction;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Transaction metadata unavailable for ${signature}`);
}

async function recordMeasurements(
  connection: Connection,
  instruction: string,
  signature: string,
  accounts: MeasuredAccount[],
  measurements: AccountMeasurement[],
): Promise<void> {
  await connection.confirmTransaction(signature, COMMITMENT);

  const transaction = await getConfirmedTransaction(connection, signature);
  const computeUnits = transaction.meta?.computeUnitsConsumed;

  if (computeUnits === undefined) {
    throw new Error(
      `Compute units were not reported for transaction ${signature}`,
    );
  }

  const feeLamports = transaction.meta.fee;
  const accountInfos = await connection.getMultipleAccountsInfo(
    accounts.map(({ pubkey }) => pubkey),
    COMMITMENT,
  );

  console.log(`\n${instruction}`);
  console.log(`Signature: ${signature}`);

  accounts.forEach((account, index) => {
    const accountInfo = accountInfos[index];

    if (!accountInfo) {
      throw new Error(
        `${account.name} account ${account.pubkey.toBase58()} was not found`,
      );
    }

    const measurement: AccountMeasurement = {
      instruction,
      accountName: account.name,
      pubkey: account.pubkey.toBase58(),
      dataLength: accountInfo.data.length,
      computeUnits,
      feeLamports,
      signature,
    };

    measurements.push(measurement);

    console.log(`Account: ${measurement.accountName}`);
    console.log(`Pubkey: ${measurement.pubkey}`);
    console.log(`Data length: ${measurement.dataLength} bytes`);
    console.log(`Compute units: ${measurement.computeUnits}`);
    console.log(`Fee: ${measurement.feeLamports} lamports`);
  });
}

async function main(): Promise<void> {
  const rpcUrl = process.env.SOLANA_RPC_URL ?? clusterApiUrl("devnet");
  const connection = new Connection(rpcUrl, COMMITMENT);
  const payer = loadPayer();
  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: COMMITMENT,
    preflightCommitment: COMMITMENT,
  });

  anchor.setProvider(provider);

  const idlPath = path.resolve(
    __dirname,
    "..",
    "target",
    "idl",
    "plotarmor.json",
  );
  const loadedIdl = JSON.parse(
    fs.readFileSync(idlPath, "utf8"),
  ) as anchor.Idl;

  // The local IDL currently contains the build-time program address.
  // Override only its address so the IDL coder targets the devnet deployment.
  const idl = {
    ...loadedIdl,
    address: PROGRAM_ID.toBase58(),
  } as anchor.Idl;

  const program = new anchor.Program(idl, provider) as any;
  const measurements: AccountMeasurement[] = [];

  console.log(`Program: ${PROGRAM_ID.toBase58()}`);
  console.log(`Payer/authority: ${payer.publicKey.toBase58()}`);

  const registryConfig = derive([Buffer.from("config")]);

  const rawHash1 = randomHash();
  const linkNonce1 = randomHash();
  const anchorNonce1 = randomHash();

  const contentArtifact1 = derive([
    Buffer.from("content"),
    Buffer.from(rawHash1),
  ]);
  const workClaim = derive([
    Buffer.from("claim"),
    contentArtifact1.toBuffer(),
    payer.publicKey.toBuffer(),
  ]);
  const ownership = derive([
    Buffer.from("ownership"),
    workClaim.toBuffer(),
  ]);
  const ownerRecord = derive([
    Buffer.from("owner"),
    ownership.toBuffer(),
    payer.publicKey.toBuffer(),
  ]);
  const claimArtifactLink1 = derive([
    Buffer.from("claim_artifact"),
    workClaim.toBuffer(),
    Buffer.from(linkNonce1),
  ]);
  const registrationAnchorRecord = derive([
    Buffer.from("anchor"),
    workClaim.toBuffer(),
    Buffer.from(anchorNonce1),
  ]);

  try {
    const initSignature = await program.methods
      .initRegistryConfig()
      .accountsStrict({
        registryConfig,
        signer: payer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await recordMeasurements(
      connection,
      "init_registry_config",
      initSignature,
      [{ name: "RegistryConfig", pubkey: registryConfig }],
      measurements,
    );
  } catch (err: unknown) {
    const info = await connection.getAccountInfo(registryConfig, COMMITMENT);

    if (!info) {
      throw err;
    }

    console.log(
      `\ninit_registry_config skipped — RegistryConfig already exists at ${registryConfig.toBase58()} (${info.data.length} bytes)`,
    );
  }

  const registerSignature = await program.methods
    .registerWorkClaim(
      rawHash1,
      1,
      1,
      100,
      100,
      linkNonce1,
      anchorNonce1,
      1,
    )
    .accountsStrict({
      registryConfig,
      contentArtifact: contentArtifact1,
      workClaim,
      ownership,
      ownerRecord,
      claimArtifactLink: claimArtifactLink1,
      anchorRecord: registrationAnchorRecord,
      signer: payer.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  await recordMeasurements(
    connection,
    "register_work_claim",
    registerSignature,
    [
      { name: "ContentArtifact", pubkey: contentArtifact1 },
      { name: "WorkClaim", pubkey: workClaim },
      { name: "Ownership", pubkey: ownership },
      { name: "OwnerRecord", pubkey: ownerRecord },
      { name: "ClaimArtifactLink", pubkey: claimArtifactLink1 },
      { name: "AnchorRecord", pubkey: registrationAnchorRecord },
    ],
    measurements,
  );

  const rawHash2 = randomHash();
  const linkNonce2 = randomHash();
  const anchorNonce2 = randomHash();

  const contentArtifact2 = derive([
    Buffer.from("content"),
    Buffer.from(rawHash2),
  ]);
  const claimArtifactLink2 = derive([
    Buffer.from("claim_artifact"),
    workClaim.toBuffer(),
    Buffer.from(linkNonce2),
  ]);
  const versionAnchorRecord = derive([
    Buffer.from("anchor"),
    contentArtifact2.toBuffer(),
    Buffer.from(anchorNonce2),
  ]);

  const addVersionSignature = await program.methods
    .addVersion(
      rawHash2,
      1,
      linkNonce2,
      anchorNonce2,
      1,
      claimArtifactLink1,
    )
    .accountsStrict({
      registryConfig,
      workClaim,
      contentArtifact: contentArtifact2,
      claimArtifactLink: claimArtifactLink2,
      anchorRecord: versionAnchorRecord,
      signer: payer.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  await recordMeasurements(
    connection,
    "add_version",
    addVersionSignature,
    [
      { name: "ContentArtifact", pubkey: contentArtifact2 },
      { name: "ClaimArtifactLink", pubkey: claimArtifactLink2 },
      { name: "AnchorRecord", pubkey: versionAnchorRecord },
    ],
    measurements,
  );

  const rawContractHash = randomHash();
  const evidenceAnchorNonce = randomHash();

  const contractArtifact = derive([
    Buffer.from("contract_artifact"),
    Buffer.from(rawContractHash),
  ]);
  const evidenceAnchor = derive([
    Buffer.from("evidence"),
    payer.publicKey.toBuffer(),
    contractArtifact.toBuffer(),
  ]);
  const evidenceAnchorRecord = derive([
    Buffer.from("anchor"),
    evidenceAnchor.toBuffer(),
    Buffer.from(evidenceAnchorNonce),
  ]);

  const evidenceSignature = await program.methods
    .anchorEvidenceContract(
      rawContractHash,
      1,
      evidenceAnchorNonce,
      1,
      workClaim,
    )
    .accountsStrict({
      registryConfig,
      contractArtifact,
      evidenceAnchor,
      anchorRecord: evidenceAnchorRecord,
      anchorer: payer.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  await recordMeasurements(
    connection,
    "anchor_evidence_contract",
    evidenceSignature,
    [
      { name: "ContractArtifact", pubkey: contractArtifact },
      { name: "EvidenceAnchor", pubkey: evidenceAnchor },
      { name: "AnchorRecord", pubkey: evidenceAnchorRecord },
    ],
    measurements,
  );

  // SCENARIO 1 — anchor_authorized_contract (positive)
  const rawContractHash2 = randomHash();
  const authNonce = randomHash();

  const contractArtifact2 = derive([
    Buffer.from("contract_artifact"),
    Buffer.from(rawContractHash2),
  ]);
  const authorizedContractAnchor = derive([
    Buffer.from("authorized_contract"),
    workClaim.toBuffer(),
    contractArtifact2.toBuffer(),
  ]);
  const authAnchorRecord = derive([
    Buffer.from("anchor"),
    authorizedContractAnchor.toBuffer(),
    Buffer.from(authNonce),
  ]);

  const authorizedSignature = await program.methods
    .anchorAuthorizedContract(rawContractHash2, 1, authNonce, 1)
    .accountsStrict({
      registryConfig,
      workClaim,
      ownership,
      contractArtifact: contractArtifact2,
      authorizedContractAnchor,
      anchorRecord: authAnchorRecord,
      admin: payer.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  await recordMeasurements(
    connection,
    "anchor_authorized_contract",
    authorizedSignature,
    [
      { name: "ContractArtifact", pubkey: contractArtifact2 },
      { name: "AuthorizedContractAnchor", pubkey: authorizedContractAnchor },
      { name: "AnchorRecord", pubkey: authAnchorRecord },
    ],
    measurements,
  );

  // SCENARIO 2 — add_owner (positive)
  const newOwner = Keypair.generate();
  const newOwnerRecord = derive([
    Buffer.from("owner"),
    ownership.toBuffer(),
    newOwner.publicKey.toBuffer(),
  ]);

  const addOwnerSignature = await program.methods
    .addOwner(30, 1, 100)
    .accountsStrict({
      registryConfig,
      workClaim,
      ownership,
      newOwnerRecord,
      admin: payer.publicKey,
      newOwner: newOwner.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  await recordMeasurements(
    connection,
    "add_owner",
    addOwnerSignature,
    [{ name: "OwnerRecord", pubkey: newOwnerRecord }],
    measurements,
  );

  // SCENARIO 3 — add_version with stale expected_previous_link (negative)
  const rawHash3 = randomHash();
  const linkNonce3 = randomHash();
  const anchorNonce3 = randomHash();

  const contentArtifact3 = derive([
    Buffer.from("content"),
    Buffer.from(rawHash3),
  ]);
  const claimArtifactLink3 = derive([
    Buffer.from("claim_artifact"),
    workClaim.toBuffer(),
    Buffer.from(linkNonce3),
  ]);
  const anchorRecord3 = derive([
    Buffer.from("anchor"),
    contentArtifact3.toBuffer(),
    Buffer.from(anchorNonce3),
  ]);

  console.log("\nadd_version (stale head — expect StaleLineageHead 6001)");
  try {
    await program.methods
      .addVersion(rawHash3, 1, linkNonce3, anchorNonce3, 1, claimArtifactLink1)
      .accountsStrict({
        registryConfig,
        workClaim,
        contentArtifact: contentArtifact3,
        claimArtifactLink: claimArtifactLink3,
        anchorRecord: anchorRecord3,
        signer: payer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("ERROR — transaction succeeded but should have reverted");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isExpected =
      msg.includes("StaleLineageHead") || msg.includes("6001");

    console.log(isExpected ? "PASS" : "FAIL — unexpected error");
    console.log(`Error: ${msg}`);
  }

  // SCENARIO 4 — register_work_claim with invalid claim_kind=99 (negative)
  const rawHash4 = randomHash();
  const linkNonce4 = randomHash();
  const anchorNonce4 = randomHash();

  const contentArtifact4 = derive([
    Buffer.from("content"),
    Buffer.from(rawHash4),
  ]);
  const workClaim4 = derive([
    Buffer.from("claim"),
    contentArtifact4.toBuffer(),
    payer.publicKey.toBuffer(),
  ]);
  const ownership4 = derive([
    Buffer.from("ownership"),
    workClaim4.toBuffer(),
  ]);
  const ownerRecord4 = derive([
    Buffer.from("owner"),
    ownership4.toBuffer(),
    payer.publicKey.toBuffer(),
  ]);
  const claimArtifactLink4 = derive([
    Buffer.from("claim_artifact"),
    workClaim4.toBuffer(),
    Buffer.from(linkNonce4),
  ]);
  const anchorRecord4 = derive([
    Buffer.from("anchor"),
    workClaim4.toBuffer(),
    Buffer.from(anchorNonce4),
  ]);

  console.log(
    "\nregister_work_claim (claim_kind=99 — expect AnchorModeNotAllowed 6002)",
  );
  try {
    await program.methods
      .registerWorkClaim(rawHash4, 99, 1, 100, 100, linkNonce4, anchorNonce4, 1)
      .accountsStrict({
        registryConfig,
        contentArtifact: contentArtifact4,
        workClaim: workClaim4,
        ownership: ownership4,
        ownerRecord: ownerRecord4,
        claimArtifactLink: claimArtifactLink4,
        anchorRecord: anchorRecord4,
        signer: payer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("ERROR — transaction succeeded but should have reverted");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isExpected =
      msg.includes("AnchorModeNotAllowed") || msg.includes("6002");

    console.log(isExpected ? "PASS" : "FAIL — unexpected error");
    console.log(`Error: ${msg}`);
  }

  // SCENARIO 5 — wrong claimant cannot add_version (expect Unauthorized 6009)
  // Fund wrongClaimant from payer instead of airdrop; Helius devnet RPC does not proxy the faucet.
  // wrongClaimant needs lamports for the init accounts (claim_artifact_link, anchor_record) because
  // Anchor's init constraints run before the handler body Unauthorized check. The lamports are
  // returned when the transaction reverts atomically on Unauthorized.
  const wrongClaimant = Keypair.generate();
  const fundTx5 = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: wrongClaimant.publicKey,
      lamports: 5_000_000,
    }),
  );
  await provider.sendAndConfirm(fundTx5);

  const rawHash5 = randomHash();
  const linkNonce5 = randomHash();
  const anchorNonce5 = randomHash();

  const contentArtifact5 = derive([
    Buffer.from("content"),
    Buffer.from(rawHash5),
  ]);
  const claimArtifactLink5 = derive([
    Buffer.from("claim_artifact"),
    workClaim.toBuffer(),
    Buffer.from(linkNonce5),
  ]);
  const anchorRecord5 = derive([
    Buffer.from("anchor"),
    contentArtifact5.toBuffer(),
    Buffer.from(anchorNonce5),
  ]);

  console.log("\nadd_version (wrong claimant — expect Unauthorized 6009)");
  try {
    await program.methods
      .addVersion(rawHash5, 1, linkNonce5, anchorNonce5, 1, claimArtifactLink2)
      .accountsStrict({
        registryConfig,
        workClaim,
        contentArtifact: contentArtifact5,
        claimArtifactLink: claimArtifactLink5,
        anchorRecord: anchorRecord5,
        signer: wrongClaimant.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([wrongClaimant])
      .rpc();

    console.log("ERROR — transaction succeeded but should have reverted");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isExpected = msg.includes("Unauthorized") || msg.includes("6009");

    console.log(isExpected ? "PASS" : "FAIL — unexpected error");
    console.log(`Error: ${msg}`);
  }

  // SCENARIO 6 — add_owner threshold > new_total (expect ShareSumMismatch 6005)
  // State after scenario 2: total_shares = 130. new_share = 10 → new_total = 140.
  // new_threshold_shares = 141 violates the require!(new_threshold_shares <= new_total) check.
  const newOwner2 = Keypair.generate();
  const newOwnerRecord2 = derive([
    Buffer.from("owner"),
    ownership.toBuffer(),
    newOwner2.publicKey.toBuffer(),
  ]);

  console.log(
    "\nadd_owner (threshold > new total — expect ShareSumMismatch 6005)",
  );
  try {
    await program.methods
      .addOwner(10, 1, 141)
      .accountsStrict({
        registryConfig,
        workClaim,
        ownership,
        newOwnerRecord: newOwnerRecord2,
        admin: payer.publicKey,
        newOwner: newOwner2.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("ERROR — transaction succeeded but should have reverted");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isExpected =
      msg.includes("ShareSumMismatch") || msg.includes("6005");

    console.log(isExpected ? "PASS" : "FAIL — unexpected error");
    console.log(`Error: ${msg}`);
  }

  // SCENARIO 7 — SupersededClaim (6010) cannot be constructed in a single script run.
  // add_version checks work_claim.superseded_by == Pubkey::default() and reverts with
  // SupersededClaim if the field is non-zero. However, no v1 instruction sets that field;
  // WorkClaim closure is unsupported in v1. Triggering this path requires a program
  // upgrade or a test-only backdoor, neither of which belongs in this devnet script.

  // SCENARIO 9 — register_work_claim with total_shares=0 (expect ShareSumMismatch 6005)
  // register_work_claim.rs:107 requires total_shares > 0 && threshold_shares > 0.
  // The check is in the handler body; init accounts are attempted first then rolled back
  // atomically on revert. Success is logged as a finding rather than a hard FAIL.
  const rawHash9 = randomHash();
  const linkNonce9 = randomHash();
  const anchorNonce9 = randomHash();

  const contentArtifact9 = derive([
    Buffer.from("content"),
    Buffer.from(rawHash9),
  ]);
  const workClaim9 = derive([
    Buffer.from("claim"),
    contentArtifact9.toBuffer(),
    payer.publicKey.toBuffer(),
  ]);
  const ownership9 = derive([Buffer.from("ownership"), workClaim9.toBuffer()]);
  const ownerRecord9 = derive([
    Buffer.from("owner"),
    ownership9.toBuffer(),
    payer.publicKey.toBuffer(),
  ]);
  const claimArtifactLink9 = derive([
    Buffer.from("claim_artifact"),
    workClaim9.toBuffer(),
    Buffer.from(linkNonce9),
  ]);
  const registrationAnchorRecord9 = derive([
    Buffer.from("anchor"),
    workClaim9.toBuffer(),
    Buffer.from(anchorNonce9),
  ]);

  console.log(
    "\nregister_work_claim (total_shares=0 — expect ShareSumMismatch 6005)",
  );
  try {
    await program.methods
      .registerWorkClaim(rawHash9, 1, 1, 0, 0, linkNonce9, anchorNonce9, 1)
      .accountsStrict({
        registryConfig,
        contentArtifact: contentArtifact9,
        workClaim: workClaim9,
        ownership: ownership9,
        ownerRecord: ownerRecord9,
        claimArtifactLink: claimArtifactLink9,
        anchorRecord: registrationAnchorRecord9,
        signer: payer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const wc9 = await program.account.workClaim.fetch(workClaim9);
    const own9 = await program.account.ownership.fetch(ownership9);
    console.log(
      `FINDING: total_shares=0 accepted — workClaim9.latestLink=${wc9.latestLink.toBase58()}, ownership9.totalShares=${own9.totalShares}`,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isExpected = msg.includes("ShareSumMismatch") || msg.includes("6005");
    console.log(isExpected ? "PASS" : "FAIL — unexpected error");
    console.log(`Error: ${msg}`);
  }

  // SCENARIO 10 — register_work_claim with claim_kind=255 (expect AnchorModeNotAllowed 6002)
  // Confirms ClaimKind::from_u8 rejects the u8 max boundary identically to an arbitrary
  // out-of-range value (99 in scenario 6). Fresh PDAs are needed because scenario 9 rolled back.
  const rawHash10 = randomHash();
  const linkNonce10 = randomHash();
  const anchorNonce10 = randomHash();

  const contentArtifact10 = derive([
    Buffer.from("content"),
    Buffer.from(rawHash10),
  ]);
  const workClaim10 = derive([
    Buffer.from("claim"),
    contentArtifact10.toBuffer(),
    payer.publicKey.toBuffer(),
  ]);
  const ownership10 = derive([
    Buffer.from("ownership"),
    workClaim10.toBuffer(),
  ]);
  const ownerRecord10 = derive([
    Buffer.from("owner"),
    ownership10.toBuffer(),
    payer.publicKey.toBuffer(),
  ]);
  const claimArtifactLink10 = derive([
    Buffer.from("claim_artifact"),
    workClaim10.toBuffer(),
    Buffer.from(linkNonce10),
  ]);
  const registrationAnchorRecord10 = derive([
    Buffer.from("anchor"),
    workClaim10.toBuffer(),
    Buffer.from(anchorNonce10),
  ]);

  console.log(
    "\nregister_work_claim (claim_kind=255 — expect AnchorModeNotAllowed 6002)",
  );
  try {
    await program.methods
      .registerWorkClaim(
        rawHash10,
        255,
        1,
        100,
        100,
        linkNonce10,
        anchorNonce10,
        1,
      )
      .accountsStrict({
        registryConfig,
        contentArtifact: contentArtifact10,
        workClaim: workClaim10,
        ownership: ownership10,
        ownerRecord: ownerRecord10,
        claimArtifactLink: claimArtifactLink10,
        anchorRecord: registrationAnchorRecord10,
        signer: payer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("ERROR — transaction succeeded but should have reverted");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isExpected =
      msg.includes("AnchorModeNotAllowed") || msg.includes("6002");
    console.log(isExpected ? "PASS" : "FAIL — unexpected error");
    console.log(`Error: ${msg}`);
  }

  // SCENARIO 11 — two add_version instructions in one transaction (expect atomic revert)
  // Both instructions pass claimArtifactLink2 as expected_previous_link (the current head).
  // Instruction A advances latest_link to claimArtifactLink11a inside the same tx; when
  // instruction B runs, its expected_previous_link no longer matches, triggering
  // StaleLineageHead. Solana transactions are all-or-nothing: the whole tx must revert and
  // latest_link must remain claimArtifactLink2. A partial state change would be a serious
  // atomicity violation.
  const rawHash11a = randomHash();
  const linkNonce11a = randomHash();
  const anchorNonce11a = randomHash();
  const rawHash11b = randomHash();
  const linkNonce11b = randomHash();
  const anchorNonce11b = randomHash();

  const contentArtifact11a = derive([
    Buffer.from("content"),
    Buffer.from(rawHash11a),
  ]);
  const claimArtifactLink11a = derive([
    Buffer.from("claim_artifact"),
    workClaim.toBuffer(),
    Buffer.from(linkNonce11a),
  ]);
  const anchorRecord11a = derive([
    Buffer.from("anchor"),
    contentArtifact11a.toBuffer(),
    Buffer.from(anchorNonce11a),
  ]);

  const contentArtifact11b = derive([
    Buffer.from("content"),
    Buffer.from(rawHash11b),
  ]);
  const claimArtifactLink11b = derive([
    Buffer.from("claim_artifact"),
    workClaim.toBuffer(),
    Buffer.from(linkNonce11b),
  ]);
  const anchorRecord11b = derive([
    Buffer.from("anchor"),
    contentArtifact11b.toBuffer(),
    Buffer.from(anchorNonce11b),
  ]);

  const ix11a = await program.methods
    .addVersion(rawHash11a, 1, linkNonce11a, anchorNonce11a, 1, claimArtifactLink2)
    .accountsStrict({
      registryConfig,
      workClaim,
      contentArtifact: contentArtifact11a,
      claimArtifactLink: claimArtifactLink11a,
      anchorRecord: anchorRecord11a,
      signer: payer.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const ix11b = await program.methods
    .addVersion(rawHash11b, 1, linkNonce11b, anchorNonce11b, 1, claimArtifactLink2)
    .accountsStrict({
      registryConfig,
      workClaim,
      contentArtifact: contentArtifact11b,
      claimArtifactLink: claimArtifactLink11b,
      anchorRecord: anchorRecord11b,
      signer: payer.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  console.log(
    "\nadd_version x2 in one tx, same expected_previous_link (expect atomic revert — StaleLineageHead 6001)",
  );
  try {
    const tx11 = new Transaction().add(ix11a, ix11b);
    await provider.sendAndConfirm(tx11);
    console.log(
      "FINDING: both add_version instructions succeeded in one tx — latest_link may have advanced",
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isExpected = msg.includes("StaleLineageHead") || msg.includes("6001");
    console.log(isExpected ? "PASS" : "FAIL — unexpected error");
    console.log(`Error: ${msg}`);
  }

  // Ground-truth atomicity check: latest_link must still equal claimArtifactLink2.
  const wcAfter11 = await program.account.workClaim.fetch(workClaim);
  const latestLinkAfter11 = wcAfter11.latestLink.toBase58();
  const latestLinkExpected11 = claimArtifactLink2.toBase58();
  if (latestLinkAfter11 === latestLinkExpected11) {
    console.log("ATOMICITY CONFIRMED: latest_link unchanged from claimArtifactLink2");
  } else {
    console.log(
      `FINDING: latest_link changed to ${latestLinkAfter11} (expected ${latestLinkExpected11}) — partial state change persisted`,
    );
  }

  console.log("\nMeasurement summary");
  console.table(
    measurements.map(
      ({
        instruction,
        accountName,
        pubkey,
        dataLength,
        computeUnits,
        feeLamports,
      }) => ({
        instruction,
        account: accountName,
        pubkey,
        bytes: dataLength,
        computeUnits,
        feeLamports,
      }),
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
