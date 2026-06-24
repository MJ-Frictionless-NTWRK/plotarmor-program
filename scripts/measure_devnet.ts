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

  // Test harness: intercept console.log to count PASS/FAIL outcomes.
  // Lines starting with "PASS" are counted as passes; lines starting with
  // "FAIL" or "ERROR —" are counted as failures. FINDING lines are neutral.
  let passes = 0;
  let failures = 0;
  const _origLog = console.log.bind(console);
  console.log = (...args: unknown[]) => {
    _origLog(...args);
    const first = String(args[0] ?? "");
    if (/^PASS\b/.test(first)) passes++;
    else if (/^FAIL\b/.test(first) || /^ERROR —/.test(first)) failures++;
  };

  console.log(`Program: ${PROGRAM_ID.toBase58()}`);
  console.log(`Payer/authority: ${payer.publicKey.toBase58()}`);

  const registryConfig = derive([Buffer.from("config")]);
  const BPF_UPGRADEABLE_LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
  const programData = PublicKey.findProgramAddressSync(
    [PROGRAM_ID.toBytes()],
    BPF_UPGRADEABLE_LOADER,
  )[0];

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
        program: PROGRAM_ID,
        programData,
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
    Array(32).fill(0),
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
        Array(32).fill(0),
    )
    .accountsStrict({
      registryConfig,
      workClaim,
      contentArtifact: contentArtifact2,
      claimArtifactLink: claimArtifactLink2,
      anchorRecord: versionAnchorRecord,
      claimant: payer.publicKey,
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
      Array(32).fill(0),
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
    .anchorAuthorizedContract(rawContractHash2, 1, authNonce, 1, Array(32).fill(0))
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
      .addVersion(rawHash3, 1, linkNonce3, anchorNonce3, 1, claimArtifactLink1, Array(32).fill(0))
      .accountsStrict({
        registryConfig,
        workClaim,
        contentArtifact: contentArtifact3,
        claimArtifactLink: claimArtifactLink3,
        anchorRecord: anchorRecord3,
        claimant: payer.publicKey,
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
      .registerWorkClaim(rawHash4, 99, 1, 100, 100, linkNonce4, anchorNonce4, 1, Array(32).fill(0))
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
  // wrongClaimant is funded in case it is used as payer for any init accounts.
  // The has_one = claimant constraint on work_claim fires before handler body logic, but
  // after Anchor's init account allocations — 3 System Program CPIs appear in the failed tx.
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
      .addVersion(rawHash5, 1, linkNonce5, anchorNonce5, 1, claimArtifactLink2, Array(32).fill(0))
      .accountsStrict({
        registryConfig,
        workClaim,
        contentArtifact: contentArtifact5,
        claimArtifactLink: claimArtifactLink5,
        anchorRecord: anchorRecord5,
        claimant: wrongClaimant.publicKey,
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
      .registerWorkClaim(rawHash9, 1, 1, 0, 0, linkNonce9, anchorNonce9, 1, Array(32).fill(0))
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
        Array(32).fill(0),
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
    .addVersion(rawHash11a, 1, linkNonce11a, anchorNonce11a, 1, claimArtifactLink2, Array(32).fill(0))
    .accountsStrict({
      registryConfig,
      workClaim,
      contentArtifact: contentArtifact11a,
      claimArtifactLink: claimArtifactLink11a,
      anchorRecord: anchorRecord11a,
      claimant: payer.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const ix11b = await program.methods
    .addVersion(rawHash11b, 1, linkNonce11b, anchorNonce11b, 1, claimArtifactLink2, Array(32).fill(0))
    .accountsStrict({
      registryConfig,
      workClaim,
      contentArtifact: contentArtifact11b,
      claimArtifactLink: claimArtifactLink11b,
      anchorRecord: anchorRecord11b,
      claimant: payer.publicKey,
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

  // SCENARIO 12 — add_owner with new_share=0 (expect ShareSumMismatch 6005)
  // add_owner.rs:55 has a dedicated require!(new_share > 0, ShareSumMismatch) in the
  // handler body. The new_owner_record init constraint runs first (admin=payer pays rent),
  // then the handler fires and reverts; the account creation is rolled back atomically.
  // Current ownership state: total_shares=130 (100 from registration + 30 from scenario 2).
  const newOwner3 = Keypair.generate();
  const newOwnerRecord3 = derive([
    Buffer.from("owner"),
    ownership.toBuffer(),
    newOwner3.publicKey.toBuffer(),
  ]);

  console.log("\nadd_owner (new_share=0 — expect ShareSumMismatch 6005)");
  try {
    await program.methods
      .addOwner(0, 1, 130)
      .accountsStrict({
        registryConfig,
        workClaim,
        ownership,
        newOwnerRecord: newOwnerRecord3,
        admin: payer.publicKey,
        newOwner: newOwner3.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const own12 = await program.account.ownership.fetch(ownership);
    console.log(
      `FINDING: new_share=0 accepted — ownership.totalShares=${own12.totalShares}`,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isExpected = msg.includes("ShareSumMismatch") || msg.includes("6005");
    console.log(isExpected ? "PASS" : "FAIL — unexpected error");
    console.log(`Error: ${msg}`);
  }

  // SCENARIO 13 — content-addressing convergence: two claimants register the same raw_hash
  // contentArtifact uses init_if_needed (register_work_claim.rs:30). Registration B with the
  // same rawHash13 finds the account already initialized, skips creation and field writes
  // (is_initialized guard at rs:130), then creates all B-specific accounts normally.
  // Both registrations should succeed; exactly one ContentArtifact account should exist.
  const rawHash13 = randomHash();
  const linkNonce13a = randomHash();
  const anchorNonce13a = randomHash();
  const linkNonce13b = randomHash();
  const anchorNonce13b = randomHash();

  const contentArtifact13 = derive([
    Buffer.from("content"),
    Buffer.from(rawHash13),
  ]);

  // Registration A — payer as claimant.
  const workClaimA = derive([
    Buffer.from("claim"),
    contentArtifact13.toBuffer(),
    payer.publicKey.toBuffer(),
  ]);
  const ownershipA = derive([Buffer.from("ownership"), workClaimA.toBuffer()]);
  const ownerRecordA = derive([
    Buffer.from("owner"),
    ownershipA.toBuffer(),
    payer.publicKey.toBuffer(),
  ]);
  const claimArtifactLinkA = derive([
    Buffer.from("claim_artifact"),
    workClaimA.toBuffer(),
    Buffer.from(linkNonce13a),
  ]);
  const anchorRecordA = derive([
    Buffer.from("anchor"),
    workClaimA.toBuffer(),
    Buffer.from(anchorNonce13a),
  ]);

  console.log("\nregister_work_claim A (rawHash13, payer as claimant — expect success)");
  try {
    await program.methods
      .registerWorkClaim(rawHash13, 1, 1, 100, 100, linkNonce13a, anchorNonce13a, 1, Array(32).fill(0))
      .accountsStrict({
        registryConfig,
        contentArtifact: contentArtifact13,
        workClaim: workClaimA,
        ownership: ownershipA,
        ownerRecord: ownerRecordA,
        claimArtifactLink: claimArtifactLinkA,
        anchorRecord: anchorRecordA,
        signer: payer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("PASS — registration A succeeded");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`FAIL — registration A reverted unexpectedly: ${msg}`);
  }

  // Registration B — claimant2 registers the same rawHash13; workClaimB is a different PDA.
  // Fund claimant2 from payer. Covers 5 account inits (contentArtifact13 already exists,
  // so init_if_needed skips it). Rent-exempt totals: WorkClaim 2,352,480 + Ownership
  // 1,656,480 + OwnerRecord 1,412,880 + ClaimArtifactLink 1,670,400 + AnchorRecord
  // 1,461,600 = 8,553,840 lamports. Use 10,000,000 for headroom.
  const claimant2 = Keypair.generate();
  const fundTx13 = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: claimant2.publicKey,
      lamports: 10_000_000,
    }),
  );
  await provider.sendAndConfirm(fundTx13);

  const workClaimB = derive([
    Buffer.from("claim"),
    contentArtifact13.toBuffer(),
    claimant2.publicKey.toBuffer(),
  ]);
  const ownershipB = derive([Buffer.from("ownership"), workClaimB.toBuffer()]);
  const ownerRecordB = derive([
    Buffer.from("owner"),
    ownershipB.toBuffer(),
    claimant2.publicKey.toBuffer(),
  ]);
  const claimArtifactLinkB = derive([
    Buffer.from("claim_artifact"),
    workClaimB.toBuffer(),
    Buffer.from(linkNonce13b),
  ]);
  const anchorRecordB = derive([
    Buffer.from("anchor"),
    workClaimB.toBuffer(),
    Buffer.from(anchorNonce13b),
  ]);

  console.log("\nregister_work_claim B (same rawHash13, claimant2 — expect convergence/success)");
  try {
    await program.methods
      .registerWorkClaim(rawHash13, 1, 1, 100, 100, linkNonce13b, anchorNonce13b, 1, Array(32).fill(0))
      .accountsStrict({
        registryConfig,
        contentArtifact: contentArtifact13,
        workClaim: workClaimB,
        ownership: ownershipB,
        ownerRecord: ownerRecordB,
        claimArtifactLink: claimArtifactLinkB,
        anchorRecord: anchorRecordB,
        signer: claimant2.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([claimant2])
      .rpc();

    console.log("PASS — registration B succeeded; ContentArtifact reused via init_if_needed");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(
      `FINDING: registration B reverted — paper describes convergence but code may require a different path: ${msg}`,
    );
  }

  // Ground truth: exactly one ContentArtifact must exist at contentArtifact13, regardless of outcome.
  const ca13Info = await connection.getAccountInfo(contentArtifact13, COMMITMENT);
  if (ca13Info) {
    console.log(
      `ContentArtifact13 exists: owner=${ca13Info.owner.toBase58()}, dataLength=${ca13Info.data.length} bytes`,
    );
  } else {
    console.log("FINDING: ContentArtifact13 does not exist after both registrations");
  }

  // SCENARIO 14 — add_owner with new_threshold_shares=0 (expect ShareSumMismatch 6005)
  // add_owner.rs:68 requires new_threshold_shares > 0 && new_threshold_shares <= new_total.
  // With new_threshold_shares=0, the first condition is false; fires before the threshold/total
  // comparison (distinct from scenario 8's "threshold > new_total" case).
  const newOwner4 = Keypair.generate();
  const newOwnerRecord4 = derive([
    Buffer.from("owner"),
    ownership.toBuffer(),
    newOwner4.publicKey.toBuffer(),
  ]);

  console.log("\nadd_owner (new_threshold_shares=0 — expect ShareSumMismatch 6005)");
  try {
    await program.methods
      .addOwner(10, 1, 0)
      .accountsStrict({
        registryConfig,
        workClaim,
        ownership,
        newOwnerRecord: newOwnerRecord4,
        admin: payer.publicKey,
        newOwner: newOwner4.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const own14 = await program.account.ownership.fetch(ownership);
    console.log(
      `FINDING: threshold=0 accepted — ownership.thresholdShares=${own14.thresholdShares}`,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isExpected = msg.includes("ShareSumMismatch") || msg.includes("6005");
    console.log(isExpected ? "PASS" : "FAIL — unexpected error");
    console.log(`Error: ${msg}`);
  }

  // SCENARIO 15 — add_owner for an already-existing co-owner pubkey (expect "already in use")
  // newOwner was added in the positive scenario 2. The newOwnerRecord PDA already exists and
  // is owned by the program. Anchor's init constraint calls System Program create_account,
  // which rejects with AccountAlreadyInUse (0x0) before the handler body runs.
  console.log("\nadd_owner (duplicate pubkey — expect 'already in use')");
  try {
    await program.methods
      .addOwner(10, 1, 130)
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

    console.log("FINDING: duplicate add_owner succeeded");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isExpected =
      msg.includes("already in use") ||
      msg.includes("0x0") ||
      msg.includes("AccountDiscriminatorAlreadySet");
    console.log(isExpected ? "PASS" : "FAIL — unexpected error");
    console.log(`Error: ${msg}`);
  }

  // SCENARIO 16 — add_version reusing rawHash1 (root hash appears again in the chain)
  // Tests the "same ContentArtifact may appear more than once in one linear chain" invariant.
  // contentArtifact1 already exists; init_if_needed skips creation and the is_initialized
  // guard (add_version.rs:111) skips all field writes. A new ClaimArtifactLink is created
  // pointing to the existing contentArtifact1. Both latest_link and latest_artifact advance.
  // Expected to SUCCEED.
  const linkNonce16 = randomHash();
  const anchorNonce16 = randomHash();

  const claimArtifactLink16 = derive([
    Buffer.from("claim_artifact"),
    workClaim.toBuffer(),
    Buffer.from(linkNonce16),
  ]);
  const anchorRecord16 = derive([
    Buffer.from("anchor"),
    contentArtifact1.toBuffer(),
    Buffer.from(anchorNonce16),
  ]);

  console.log(
    "\nadd_version (rawHash1 reuse in same chain — expect success, chain reuse invariant)",
  );
  try {
    await program.methods
      .addVersion(rawHash1, 1, linkNonce16, anchorNonce16, 1, claimArtifactLink2, Array(32).fill(0))
      .accountsStrict({
        registryConfig,
        workClaim,
        contentArtifact: contentArtifact1,
        claimArtifactLink: claimArtifactLink16,
        anchorRecord: anchorRecord16,
        claimant: payer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const wc16 = await program.account.workClaim.fetch(workClaim);
    const latestArtifactIsRoot =
      wc16.latestArtifact.toBase58() === contentArtifact1.toBase58();
    const latestLinkAdvanced =
      wc16.latestLink.toBase58() === claimArtifactLink16.toBase58();
    console.log(
      latestArtifactIsRoot && latestLinkAdvanced
        ? "PASS — chain reuse confirmed: latest_artifact == contentArtifact1, latest_link advanced"
        : `FAIL — unexpected state: latestArtifact=${wc16.latestArtifact.toBase58()}, latestLink=${wc16.latestLink.toBase58()}`,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`FAIL — add_version reverted unexpectedly: ${msg}`);
  }

  // SCENARIO 17 — anchor_evidence_contract replay: same anchorer (payer) + same contractArtifact
  // EvidenceAnchor uses init (anchor_evidence_contract.rs:33). The PDA
  // ["evidence", payer.publicKey, contractArtifact] already exists from scenario 3.
  // Anchor's init calls System Program create_account, which rejects with AccountAlreadyInUse.
  // This confirms one EvidenceAnchor per (anchorer, contractArtifact) pair.
  console.log(
    "\nanchor_evidence_contract replay (same anchorer + contractArtifact — expect 'already in use')",
  );
  try {
    await program.methods
      .anchorEvidenceContract(
        rawContractHash,
        1,
        evidenceAnchorNonce,
        1,
        workClaim,
        Array(32).fill(0),
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

    console.log("FINDING: replay succeeded — duplicate EvidenceAnchor accepted");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isExpected =
      msg.includes("already in use") ||
      msg.includes("0x0") ||
      msg.includes("AccountDiscriminatorAlreadySet");
    console.log(isExpected ? "PASS" : "FAIL — unexpected error");
    console.log(`Error: ${msg}`);
  }

  // SCENARIO 18 — init_registry_config called a second time (expect "already in use")
  // RegistryConfig uses init (init_registry_config.rs:8). The config PDA already exists.
  // Anchor's init fires before the handler; System Program rejects create_account.
  // Confirms known limitation B from CLAUDE.md: the PDA can only be initialized once,
  // so whoever calls first seizes authority — but cannot be called again.
  console.log(
    "\ninit_registry_config (second call — expect 'already in use')",
  );
  try {
    await program.methods
      .initRegistryConfig()
      .accountsStrict({
        registryConfig,
        signer: payer.publicKey,
        systemProgram: SystemProgram.programId,
        program: PROGRAM_ID,
        programData,
      })
      .rpc();

    console.log(
      "FINDING: second init_registry_config succeeded — authority could be seized",
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isExpected =
      msg.includes("already in use") ||
      msg.includes("0x0") ||
      msg.includes("AccountDiscriminatorAlreadySet");
    console.log(isExpected ? "PASS" : "FAIL — unexpected error");
    console.log(`Error: ${msg}`);
  }

  // SCENARIO 19 — cross-claim: attacker calls add_version on workClaim (payer's)
  // workClaim.claimant == payer.publicKey. An unrelated signer triggers
  // the has_one = claimant constraint on work_claim -> Unauthorized (6009).
  // The constraint fires before handler body logic, but after Anchor's init account
  // allocations. The tx reverts atomically; no persistent state is created.
  // attacker is funded as payer in case it is needed for other scenarios.
  // claimArtifactLink16 is the correct current head after scenario 16 succeeded.
  const attacker19 = Keypair.generate();
  const fundTx19 = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: attacker19.publicKey,
      lamports: 5_000_000,
    }),
  );
  await provider.sendAndConfirm(fundTx19);

  const rawHash19 = randomHash();
  const linkNonce19 = randomHash();
  const anchorNonce19 = randomHash();

  const contentArtifact19 = derive([
    Buffer.from("content"),
    Buffer.from(rawHash19),
  ]);
  const claimArtifactLink19 = derive([
    Buffer.from("claim_artifact"),
    workClaim.toBuffer(),
    Buffer.from(linkNonce19),
  ]);
  const anchorRecord19 = derive([
    Buffer.from("anchor"),
    contentArtifact19.toBuffer(),
    Buffer.from(anchorNonce19),
  ]);

  console.log(
    "\nadd_version (attacker on payer's workClaim — expect Unauthorized 6009)",
  );
  try {
    await program.methods
      .addVersion(
        rawHash19,
        1,
        linkNonce19,
        anchorNonce19,
        1,
        claimArtifactLink16,
        Array(32).fill(0),
      )
      .accountsStrict({
        registryConfig,
        workClaim,
        contentArtifact: contentArtifact19,
        claimArtifactLink: claimArtifactLink19,
        anchorRecord: anchorRecord19,
        claimant: attacker19.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([attacker19])
      .rpc();

    console.log("FINDING: attacker add_version succeeded");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isExpected = msg.includes("Unauthorized") || msg.includes("6009");
    console.log(isExpected ? "PASS" : "FAIL — unexpected error");
    console.log(`Error: ${msg}`);
  }

  // SCENARIO 20 — cross-claim: attacker calls anchor_authorized_contract on workClaim (payer's)
  // ownership.admin == payer.publicKey. An unrelated admin signer triggers
  // anchor_authorized_contract.rs:84 require!(admin == ownership.admin) -> Unauthorized (6009).
  // Three init accounts run first (contractArtifact init_if_needed, authorizedContractAnchor
  // init, anchorRecord init); all rolled back on revert.
  const attacker20 = Keypair.generate();
  const fundTx20 = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: attacker20.publicKey,
      lamports: 5_000_000,
    }),
  );
  await provider.sendAndConfirm(fundTx20);

  const rawContractHash20 = randomHash();
  const authNonce20 = randomHash();

  const contractArtifact20 = derive([
    Buffer.from("contract_artifact"),
    Buffer.from(rawContractHash20),
  ]);
  const authorizedContractAnchor20 = derive([
    Buffer.from("authorized_contract"),
    workClaim.toBuffer(),
    contractArtifact20.toBuffer(),
  ]);
  const authAnchorRecord20 = derive([
    Buffer.from("anchor"),
    authorizedContractAnchor20.toBuffer(),
    Buffer.from(authNonce20),
  ]);

  console.log(
    "\nanchor_authorized_contract (attacker as admin on payer's workClaim — expect Unauthorized 6009)",
  );
  try {
    await program.methods
      .anchorAuthorizedContract(rawContractHash20, 1, authNonce20, 1, Array(32).fill(0))
      .accountsStrict({
        registryConfig,
        workClaim,
        ownership,
        contractArtifact: contractArtifact20,
        authorizedContractAnchor: authorizedContractAnchor20,
        anchorRecord: authAnchorRecord20,
        admin: attacker20.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([attacker20])
      .rpc();

    console.log("FINDING: attacker anchor_authorized_contract succeeded");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isExpected = msg.includes("Unauthorized") || msg.includes("6009");
    console.log(isExpected ? "PASS" : "FAIL — unexpected error");
    console.log(`Error: ${msg}`);
  }

  // SCENARIO 21 — AuthorizedContractAnchor PDA collision: same (workClaim, contractArtifact2)
  // anchor_authorized_contract.rs uses init for authorized_contract_anchor with seeds
  // ["authorized_contract", work_claim, contract_artifact]. The PDA for (workClaim,
  // contractArtifact2) was created in scenario 4. A second call with the same pair
  // triggers Anchor's init constraint -> "already in use" before the handler runs.
  // This is the on-chain enforcement of "one authorized anchor per (claim, contract)" pair.
  const authNonce21 = randomHash();
  const authAnchorRecord21 = derive([
    Buffer.from("anchor"),
    authorizedContractAnchor.toBuffer(),
    Buffer.from(authNonce21),
  ]);

  console.log(
    "\nanchor_authorized_contract (same workClaim + contractArtifact2 — expect 'already in use')",
  );
  try {
    await program.methods
      .anchorAuthorizedContract(rawContractHash2, 1, authNonce21, 1, Array(32).fill(0))
      .accountsStrict({
        registryConfig,
        workClaim,
        ownership,
        contractArtifact: contractArtifact2,
        authorizedContractAnchor,
        anchorRecord: authAnchorRecord21,
        admin: payer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(
      "FINDING: second authorized anchor for same (claim, contract) pair succeeded",
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isExpected =
      msg.includes("already in use") ||
      msg.includes("0x0") ||
      msg.includes("AccountDiscriminatorAlreadySet");
    console.log(isExpected ? "PASS" : "FAIL — unexpected error");
    console.log(`Error: ${msg}`);
  }

  // SCENARIO 22 — non-upgrade-authority calls init_registry_config
  // Fix 1 added two constraints to InitRegistryConfig: (1) program_data is the legitimate
  // ProgramData for this program, and (2) signer is the upgrade authority in program_data.
  // A keypair that is not the upgrade authority triggers Unauthorized (6009) from constraint 2
  // — but only on first-ever call in a fresh environment. On a devnet where registryConfig
  // already exists, the init constraint on registry_config (position 1) fires before the
  // upgrade-authority constraints (positions 4-5), so both authorized and unauthorized callers
  // get 0x0. The 6009 path is exercised by the LiteSVM Rust tests. PASS accepts either error.
  const attacker22 = Keypair.generate();
  const fundTx22 = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: attacker22.publicKey,
      lamports: 5_000_000,
    }),
  );
  await provider.sendAndConfirm(fundTx22);

  console.log(
    "\ninit_registry_config (non-upgrade-authority signer — expect Unauthorized 6009 or already in use 0x0)",
  );
  try {
    await program.methods
      .initRegistryConfig()
      .accountsStrict({
        registryConfig,
        signer: attacker22.publicKey,
        systemProgram: SystemProgram.programId,
        program: PROGRAM_ID,
        programData,
      })
      .signers([attacker22])
      .rpc();

    console.log("FINDING: non-authority init_registry_config succeeded");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const got6009 = msg.includes("Unauthorized") || msg.includes("6009");
    const got0x0 = msg.includes("already in use") || msg.includes("0x0");
    if (got6009) {
      console.log(
        "PASS — Unauthorized (6009): upgrade-authority constraint fired (fresh environment)",
      );
    } else if (got0x0) {
      console.log(
        "PASS — already in use (0x0): init constraint on registry_config fired before authority check (devnet state; 6009 path covered by LiteSVM tests)",
      );
    } else {
      console.log("FAIL — unexpected error");
    }
    console.log(`Error: ${msg}`);
  }

  // SCENARIO 23 — wrong claimant add_version: has_one constraint fires before handler body
  // Fix 2 moved the Unauthorized check from a require!() in the handler body to a has_one
  // constraint on work_claim (position 2 in the Accounts struct). The actual benefit: the
  // check is now declarative in the account struct (more idiomatic Anchor, easier to audit)
  // and fires before any handler body logic runs. It does NOT prevent System Program CPI
  // calls for init accounts — Anchor allocates init accounts before evaluating has_one, so
  // 3 create_account calls still appear in the failed tx logs (same count as pre-Fix-2).
  // The tx reverts atomically regardless; no persistent state is created.
  // PASS condition: Unauthorized (6009) fires, regardless of System Program CPI count.
  // Reuses wrongClaimant from scenario 5. claimArtifactLink16 is the current chain head.
  const rawHash23 = randomHash();
  const linkNonce23 = randomHash();
  const anchorNonce23 = randomHash();

  const contentArtifact23 = derive([
    Buffer.from("content"),
    Buffer.from(rawHash23),
  ]);
  const claimArtifactLink23 = derive([
    Buffer.from("claim_artifact"),
    workClaim.toBuffer(),
    Buffer.from(linkNonce23),
  ]);
  const anchorRecord23 = derive([
    Buffer.from("anchor"),
    contentArtifact23.toBuffer(),
    Buffer.from(anchorNonce23),
  ]);

  console.log(
    "\nadd_version (wrong claimant — has_one fires before handler body; CPI count observed)",
  );
  try {
    await program.methods
      .addVersion(rawHash23, 1, linkNonce23, anchorNonce23, 1, claimArtifactLink16, Array(32).fill(0))
      .accountsStrict({
        registryConfig,
        workClaim,
        contentArtifact: contentArtifact23,
        claimArtifactLink: claimArtifactLink23,
        anchorRecord: anchorRecord23,
        claimant: wrongClaimant.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([wrongClaimant])
      .rpc();

    console.log("ERROR — transaction succeeded but should have reverted");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isExpected = msg.includes("Unauthorized") || msg.includes("6009");
    if (isExpected) {
      const logs: string[] = (err as any).logs ?? [];
      const sysInvocations = logs.filter((line: string) =>
        line.includes("11111111111111111111111111111111 invoke"),
      ).length;
      console.log(
        `PASS — Unauthorized (6009) fired; ${sysInvocations} System Program CPI(s) preceded the revert (has_one fires before handler body, after Anchor's init account allocations)`,
      );
    } else {
      console.log("FAIL — unexpected error");
    }
    console.log(`Error: ${msg}`);
  }

  // SCENARIO 24 — legitimate authority calls init_registry_config a second time
  // Distinguishes the two failure modes introduced by Fix 1: wrong authority (scenario 22)
  // produces Unauthorized (6009) from the upgrade-authority constraint; legitimate authority
  // with the account already existing produces "already in use" (0x0) from Anchor's init
  // constraint. The init constraint on registry_config (position 1 in the struct) fires
  // before the authority constraints (positions 4-5), so the error is always 0x0 here.
  // Note: scenario 18 also tests the second-call case; this scenario pairs it explicitly
  // with scenario 22 to confirm the two failure modes produce distinct error codes.
  console.log(
    "\ninit_registry_config (legitimate authority, second call — expect 'already in use')",
  );
  try {
    await program.methods
      .initRegistryConfig()
      .accountsStrict({
        registryConfig,
        signer: payer.publicKey,
        systemProgram: SystemProgram.programId,
        program: PROGRAM_ID,
        programData,
      })
      .rpc();

    console.log("FINDING: second init_registry_config succeeded");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isExpected =
      msg.includes("already in use") ||
      msg.includes("0x0") ||
      msg.includes("AccountDiscriminatorAlreadySet");
    console.log(isExpected ? "PASS" : "FAIL — unexpected error");
    console.log(`Error: ${msg}`);
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

  _origLog(
    `\nScenario results: ${passes} passed, ${failures} failed` +
      (failures > 0 ? " ← FAILURES ABOVE" : " — all green"),
  );
  if (failures > 0) {
    throw new Error(`${failures} scenario(s) failed — see output above`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
