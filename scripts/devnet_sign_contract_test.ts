/**
 * PlotArmor — Standalone Devnet Proof Script for sign_contract
 * ================================================================
 * Live behavioral check (spec §5.5): create a ContractArtifact via
 * anchor_evidence_contract, then call the new sign_contract instruction,
 * then independently verify the resulting ContractSignature account
 * via raw connection.getAccountInfo (not just the Anchor client's
 * program.account.fetch echo).
 *
 * Run from the plotarmor-program repo root:
 *   HELIUS_API_KEY=<key> node_modules/.bin/ts-node --transpile-only scripts/devnet_sign_contract_test.ts
 *
 * Requires a funded devnet keypair at ~/.config/solana/id.json.
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import { Plotarmor } from "../target/types/plotarmor";
import idl from "../target/idl/plotarmor.json";

const PROGRAM_ID = new PublicKey("3h9CzV9MJDeD5yjhVhdE6cupuXVRnLW1Cu6P14EJBKv2");

const DEVNET_RPC_URL =
  process.env.DEVNET_RPC_URL ||
  "https://devnet.helius-rpc.com/?api-key=" + (process.env.HELIUS_API_KEY || "");

const KEYPAIR_PATH = path.join(os.homedir(), ".config/solana/id.json");

function derive(seeds: (Buffer | Uint8Array)[]): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
}

function rh(): Buffer {
  return crypto.randomBytes(32);
}

function ba(b: Buffer): number[] {
  return Array.from(b);
}

function loadPayer(): Keypair {
  if (!fs.existsSync(KEYPAIR_PATH)) {
    throw new Error(`No keypair found at ${KEYPAIR_PATH}`);
  }
  const raw = JSON.parse(fs.readFileSync(KEYPAIR_PATH, "utf-8"));
  return Keypair.fromSecretKey(new Uint8Array(raw));
}

async function main() {
  console.log("PlotArmor — Devnet sign_contract Proof");
  console.log("================================================\n");

  if (!process.env.HELIUS_API_KEY && !process.env.DEVNET_RPC_URL) {
    console.error("Set HELIUS_API_KEY or DEVNET_RPC_URL env var before running.");
    process.exit(1);
  }

  const connection = new Connection(DEVNET_RPC_URL, "confirmed");
  const payer = loadPayer();
  console.log("Signer:", payer.publicKey.toBase58());

  const balanceLamports = await connection.getBalance(payer.publicKey);
  const balanceSol = balanceLamports / 1e9;
  console.log("Signer balance:", balanceSol.toFixed(4), "SOL");
  if (balanceSol < 0.05) {
    console.error("Insufficient balance. Need at least 0.05 SOL for this test.");
    process.exit(1);
  }

  const wallet = new Wallet(payer);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);
  const program = new Program(idl as anchor.Idl, provider) as unknown as Program<Plotarmor>;

  const registryConfig = derive([Buffer.from("config")]);
  const existingConfig = await connection.getAccountInfo(registryConfig);
  if (!existingConfig) {
    console.error("RegistryConfig not found at", registryConfig.toBase58());
    console.error("Expected it to already exist on this deployment (see program repo CLAUDE.md history).");
    process.exit(1);
  }
  console.log("RegistryConfig confirmed present:", registryConfig.toBase58());

  // 1. Create a fresh ContractArtifact via anchor_evidence_contract
  //    (the unilateral path -- no WorkClaim/Ownership fixture required).
  const rawContractHash = rh();
  const anchorNonce = rh();
  const externalRefHash = rh();

  const contractArtifact = derive([Buffer.from("contract_artifact"), rawContractHash]);
  const evidenceAnchor = derive([
    Buffer.from("evidence"),
    payer.publicKey.toBuffer(),
    contractArtifact.toBuffer(),
  ]);
  const evidenceAnchorRecord = derive([
    Buffer.from("anchor"),
    evidenceAnchor.toBuffer(),
    anchorNonce,
  ]);

  console.log("\nDerived PDAs:");
  console.log("  ContractArtifact:", contractArtifact.toBase58());
  console.log("  raw_contract_hash (hex):", rawContractHash.toString("hex"));

  console.log("\nStep 1: anchor_evidence_contract (create ContractArtifact)...");
  const evidenceSig = await program.methods
    .anchorEvidenceContract(
      ba(rawContractHash),
      1, // contract_kind: Nda
      ba(anchorNonce),
      1, // anchor_mode_arg: attested_devnet
      PublicKey.default,
      ba(externalRefHash)
    )
    .accountsStrict({
      registryConfig,
      contractArtifact,
      evidenceAnchor,
      anchorRecord: evidenceAnchorRecord,
      anchorer: payer.publicKey,
      systemProgram: SystemProgram.programId,
    } as any)
    .rpc({ commitment: "confirmed" });
  console.log("✓ Signature:", evidenceSig);
  console.log("✓ Explorer:", `https://explorer.solana.com/tx/${evidenceSig}?cluster=devnet`);

  // 2. sign_contract
  const contractSignature = derive([
    Buffer.from("signature"),
    contractArtifact.toBuffer(),
    payer.publicKey.toBuffer(),
  ]);
  console.log("\nStep 2: sign_contract...");
  console.log("  ContractSignature PDA:", contractSignature.toBase58());

  const t0 = Date.now();
  const signSig = await program.methods
    .signContract(ba(rawContractHash))
    .accountsStrict({
      contractArtifact,
      contractSignature,
      signer: payer.publicKey,
      systemProgram: SystemProgram.programId,
    } as any)
    .rpc({ commitment: "confirmed" });
  const elapsed = Date.now() - t0;

  console.log("✓ Transaction confirmed in", elapsed, "ms");
  console.log("✓ Signature:", signSig);
  console.log("✓ Explorer:", `https://explorer.solana.com/tx/${signSig}?cluster=devnet`);

  // 3. Independent verification via raw getAccountInfo (not the Anchor
  //    client's fetch echo) -- decode the account bytes ourselves.
  console.log("\nVerifying on-chain state via raw getAccountInfo...");
  const rawAccountInfo = await connection.getAccountInfo(contractSignature, "confirmed");
  if (!rawAccountInfo) {
    console.error("✗ getAccountInfo returned null for ContractSignature PDA");
    process.exit(1);
  }
  console.log("✓ Account exists on-chain");
  console.log("  owner:", rawAccountInfo.owner.toBase58());
  console.log("  lamports:", rawAccountInfo.lamports);
  console.log("  data length:", rawAccountInfo.data.length, "(expect 121)");

  const data = rawAccountInfo.data;
  // Layout: 8 discriminator, 32 contract_artifact, 32 signer, 32 content_hash, 8 signed_at (i64 LE), 8 slot (u64 LE), 1 bump
  const decodedContractArtifact = new PublicKey(data.subarray(8, 40));
  const decodedSigner = new PublicKey(data.subarray(40, 72));
  const decodedContentHash = data.subarray(72, 104);
  const decodedSignedAt = data.readBigInt64LE(104);
  const decodedSlot = data.readBigUInt64LE(112);
  const decodedBump = data.readUInt8(120);

  console.log("\nDecoded fields (raw bytes, independent of Anchor client):");
  console.log("  contract_artifact:", decodedContractArtifact.toBase58());
  console.log("  signer:           ", decodedSigner.toBase58());
  console.log("  content_hash:     ", decodedContentHash.toString("hex"));
  console.log("  signed_at:        ", decodedSignedAt.toString(), new Date(Number(decodedSignedAt) * 1000).toISOString());
  console.log("  slot:             ", decodedSlot.toString());
  console.log("  bump:             ", decodedBump);

  const ownerCorrect = rawAccountInfo.owner.equals(PROGRAM_ID);
  const contractArtifactMatches = decodedContractArtifact.equals(contractArtifact);
  const signerMatches = decodedSigner.equals(payer.publicKey);
  const contentHashMatches = decodedContentHash.toString("hex") === rawContractHash.toString("hex");
  const signedAtPlausible = decodedSignedAt > 0n;
  const slotPlausible = decodedSlot > 0n;

  console.log("\nChecks:");
  console.log("  owner == program ID:            ", ownerCorrect ? "✓ YES" : "✗ NO");
  console.log("  contract_artifact matches:      ", contractArtifactMatches ? "✓ YES" : "✗ NO");
  console.log("  signer matches:                 ", signerMatches ? "✓ YES" : "✗ NO");
  console.log("  content_hash matches submitted: ", contentHashMatches ? "✓ YES" : "✗ NO");
  console.log("  signed_at is plausible (>0):    ", signedAtPlausible ? "✓ YES" : "✗ NO");
  console.log("  slot is plausible (>0):         ", slotPlausible ? "✓ YES" : "✗ NO");

  const allPass =
    ownerCorrect && contractArtifactMatches && signerMatches && contentHashMatches && signedAtPlausible && slotPlausible;

  console.log("\n================================================");
  console.log(allPass ? "RESULT: Devnet sign_contract proof SUCCESSFUL" : "RESULT: FAILED — see checks above");
  console.log("================================================");

  if (!allPass) {
    process.exit(1);
  }

  console.log("\nReal data for reference:");
  console.log(JSON.stringify({
    upgrade_note: "verified against program 3h9CzV9MJDeD5yjhVhdE6cupuXVRnLW1Cu6P14EJBKv2 after devnet upgrade",
    evidence_tx: evidenceSig,
    sign_tx: signSig,
    contract_artifact_pda: contractArtifact.toBase58(),
    contract_signature_pda: contractSignature.toBase58(),
    raw_contract_hash: rawContractHash.toString("hex"),
    signed_at: decodedSignedAt.toString(),
    slot: decodedSlot.toString(),
  }, null, 2));
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
