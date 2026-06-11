import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
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
