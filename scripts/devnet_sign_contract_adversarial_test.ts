/**
 * PlotArmor — sign_contract Adversarial Devnet Test
 * ====================================================
 * devnet_sign_contract_test.ts (2026-07-15) proved only the happy path live
 * on devnet. Per CLAUDE.md, the adversarial rejection paths (wrong
 * content_hash, double-sign, signing a nonexistent ContractArtifact) had
 * only ever been run against LiteSVM (sign_contract_tests.rs) and a local
 * validator (tests/plotarmor.ts) -- never against a real live devnet RPC.
 * This script closes that gap.
 *
 * Scenarios:
 *   1. sign_contract — wrong content_hash -> ContentHashMismatch (6011)
 *   2. sign_contract — double-sign by same signer -> already in use
 *   3. sign_contract — nonexistent ContractArtifact -> account-validation failure
 *
 * Run:
 *   DEVNET_RPC_URL=<url> node_modules/.bin/ts-node --transpile-only scripts/devnet_sign_contract_adversarial_test.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { randomBytes } from "crypto";

const PROGRAM_ID = new PublicKey("3h9CzV9MJDeD5yjhVhdE6cupuXVRnLW1Cu6P14EJBKv2");
const DEVNET_RPC_URL =
  process.env.DEVNET_RPC_URL ||
  "https://devnet.helius-rpc.com/?api-key=" + (process.env.HELIUS_API_KEY || "");
const KEYPAIR_PATH = path.join(os.homedir(), ".config/solana/id.json");
const COMMITMENT = "confirmed" as const;

function rh(): number[] {
  return Array.from(randomBytes(32));
}

function derive(seeds: (Buffer | Uint8Array)[]): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
}

function loadPayer(): Keypair {
  const raw = JSON.parse(fs.readFileSync(KEYPAIR_PATH, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

let passes = 0;
let failures = 0;

function pass(label: string) {
  console.log(`PASS  ${label}`);
  passes++;
}

function fail(label: string, detail: string) {
  console.log(`FAIL  ${label}: ${detail}`);
  failures++;
}

async function main() {
  const connection = new Connection(DEVNET_RPC_URL, COMMITMENT);
  const payer = loadPayer();
  const wallet = new Wallet(payer);
  const provider = new AnchorProvider(connection, wallet, { commitment: COMMITMENT });
  anchor.setProvider(provider);

  const idlPath = path.resolve(__dirname, "..", "target", "idl", "plotarmor.json");
  const loadedIdl = JSON.parse(fs.readFileSync(idlPath, "utf8")) as anchor.Idl;
  const idl = { ...loadedIdl, address: PROGRAM_ID.toBase58() } as anchor.Idl;
  const program = new anchor.Program(idl, provider) as any;

  const registryConfig = derive([Buffer.from("config")]);
  const existingConfig = await connection.getAccountInfo(registryConfig);
  if (!existingConfig) {
    console.error("RegistryConfig not found at", registryConfig.toBase58());
    process.exit(1);
  }

  const balanceLamports = await connection.getBalance(payer.publicKey);
  console.log("Signer:", payer.publicKey.toBase58());
  console.log("Signer balance:", (balanceLamports / 1e9).toFixed(4), "SOL");
  if (balanceLamports / 1e9 < 0.05) {
    console.error("Insufficient balance. Need at least 0.05 SOL for this test.");
    process.exit(1);
  }

  // Shared fixture: one real ContractArtifact, created once via
  // anchor_evidence_contract, reused across scenarios 1 and 2.
  const rawContractHash = rh();
  const anchorNonce = rh();
  const externalRefHash = rh();
  const contractArtifact = derive([Buffer.from("contract_artifact"), Buffer.from(rawContractHash)]);
  const evidenceAnchor = derive([Buffer.from("evidence"), payer.publicKey.toBuffer(), contractArtifact.toBuffer()]);
  const evidenceAnchorRecord = derive([Buffer.from("anchor"), evidenceAnchor.toBuffer(), Buffer.from(anchorNonce)]);

  console.log("\nFixture setup: anchor_evidence_contract (create ContractArtifact)...");
  const evidenceSig = await program.methods
    .anchorEvidenceContract(rawContractHash, 1, anchorNonce, 1, PublicKey.default, externalRefHash)
    .accountsStrict({
      registryConfig,
      contractArtifact,
      evidenceAnchor,
      anchorRecord: evidenceAnchorRecord,
      anchorer: payer.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc({ commitment: COMMITMENT });
  console.log("  ContractArtifact:", contractArtifact.toBase58());
  console.log("  tx:", evidenceSig);

  // ── SCENARIO 1: wrong content_hash -> ContentHashMismatch (6011) ────────
  {
    const label = "sign_contract — wrong content_hash (expect ContentHashMismatch 6011)";
    const wrongHash = rh();
    const contractSignature = derive([
      Buffer.from("signature"),
      contractArtifact.toBuffer(),
      payer.publicKey.toBuffer(),
    ]);
    try {
      await program.methods
        .signContract(wrongHash)
        .accountsStrict({
          registryConfig,
          contractArtifact,
          contractSignature,
          signer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: COMMITMENT });
      fail(label, "transaction succeeded but should have reverted");
    } catch (e: any) {
      const msg = String(e.message);
      (msg.includes("ContentHashMismatch") || msg.includes("6011"))
        ? pass(label)
        : fail(label, `unexpected error: ${msg}`);
    }
  }

  // ── SCENARIO 2: double-sign by same signer -> already in use ───────────
  {
    const label = "sign_contract — double-sign by same signer (expect already-in-use)";
    const contractSignature = derive([
      Buffer.from("signature"),
      contractArtifact.toBuffer(),
      payer.publicKey.toBuffer(),
    ]);

    const firstSig = await program.methods
      .signContract(rawContractHash)
      .accountsStrict({
        registryConfig,
        contractArtifact,
        contractSignature,
        signer: payer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: COMMITMENT });
    console.log("  first sign tx:", firstSig);

    try {
      await program.methods
        .signContract(rawContractHash)
        .accountsStrict({
          registryConfig,
          contractArtifact,
          contractSignature,
          signer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: COMMITMENT });
      fail(label, "second signature transaction succeeded but should have failed");
    } catch (e: any) {
      const msg = String(e.message);
      (msg.includes("already in use") || msg.includes("0x0") || msg.includes("AccountAlreadyInUse") || msg.includes("custom program error"))
        ? pass(label)
        : fail(label, `unexpected error: ${msg}`);
    }
  }

  // ── SCENARIO 3: signing a nonexistent ContractArtifact -> account-validation failure ─
  {
    const label = "sign_contract — nonexistent ContractArtifact (expect account-validation failure)";
    const phantomHash = rh();
    const phantomContractArtifact = derive([Buffer.from("contract_artifact"), Buffer.from(phantomHash)]);
    const contractSignature = derive([
      Buffer.from("signature"),
      phantomContractArtifact.toBuffer(),
      payer.publicKey.toBuffer(),
    ]);
    try {
      await program.methods
        .signContract(phantomHash)
        .accountsStrict({
          registryConfig,
          contractArtifact: phantomContractArtifact,
          contractSignature,
          signer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: COMMITMENT });
      fail(label, "transaction succeeded but should have failed against a nonexistent account");
    } catch (e: any) {
      const msg = String(e.message);
      (msg.includes("AccountNotInitialized") ||
        msg.includes("AccountOwnedByWrongProgram") ||
        msg.includes("AccountDiscriminatorMismatch") ||
        msg.includes("AccountDiscriminatorNotFound") ||
        msg.includes("could not find account") ||
        msg.includes("3012"))
        ? pass(label)
        : fail(label, `unexpected error: ${msg}`);
    }
  }

  console.log("\n==================================================");
  console.log(`Results: ${passes} passed, ${failures} failed`);
  if (failures > 0) {
    console.log("FAILURES ABOVE — see details");
    process.exitCode = 1;
  } else {
    console.log("ALL GREEN");
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
