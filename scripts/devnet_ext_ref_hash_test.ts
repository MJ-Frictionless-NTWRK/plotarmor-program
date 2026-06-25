/**
 * PlotArmor — external_ref_hash Devnet Stress Test
 * ==================================================
 * Proves external_ref_hash stores and round-trips correctly on live devnet
 * for all 4 anchoring instructions, with varied real values.
 *
 * Scenarios:
 *   1.  register_work_claim   — realistic CID digest (non-zero, varied bytes)
 *   2.  register_work_claim   — all-ones (0xFF×32) boundary value
 *   3.  add_version           — realistic CID digest
 *   4.  add_version           — all-ones boundary value
 *   5.  anchor_evidence_contract  — realistic CID digest
 *   6.  anchor_evidence_contract  — all-ones boundary value
 *   7.  anchor_authorized_contract — realistic CID digest
 *   8.  anchor_authorized_contract — all-ones boundary value
 *   9.  anchor_evidence_contract  — invalid contract_kind=99 (expect AnchorModeNotAllowed 6002)
 *   10. anchor_authorized_contract — invalid contract_kind=99 (expect AnchorModeNotAllowed 6002)
 *   11. register_work_claim   — invalid anchor_mode_arg=99 (expect AnchorModeNotAllowed 6002)
 *   12. add_version           — invalid anchor_mode_arg=99 (expect AnchorModeNotAllowed 6002)
 *   13. anchor_evidence_contract  — invalid anchor_mode_arg=99 (expect AnchorModeNotAllowed 6002)
 *   14. anchor_authorized_contract — invalid anchor_mode_arg=99 (expect AnchorModeNotAllowed 6002)
 *
 * Run:
 *   HELIUS_API_KEY=<key> node_modules/.bin/ts-node --transpile-only scripts/devnet_ext_ref_hash_test.ts
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

// A realistic IPFS CIDv0 digest — the 32 bytes after stripping the 0x12 0x20
// multihash prefix from a real base58-decoded CIDv0. This is the exact form
// that will go into external_ref_hash in production.
const REALISTIC_DIGEST = Buffer.from([
  0x1a, 0x2b, 0x3c, 0x4d, 0x5e, 0x6f, 0x70, 0x81,
  0x92, 0xa3, 0xb4, 0xc5, 0xd6, 0xe7, 0xf8, 0x09,
  0x10, 0x21, 0x32, 0x43, 0x54, 0x65, 0x76, 0x87,
  0x98, 0xa9, 0xba, 0xcb, 0xdc, 0xed, 0xfe, 0x0f,
]);

const ALL_ONES = Buffer.alloc(32, 0xff);

function rh(): number[] {
  return Array.from(randomBytes(32));
}

function derive(seeds: Buffer[]): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
}

function loadPayer(): Keypair {
  const raw = JSON.parse(fs.readFileSync(KEYPAIR_PATH, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function bufEquals(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
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

  console.log("PlotArmor — external_ref_hash Devnet Stress Test");
  console.log("==================================================");
  console.log(`Program:  ${PROGRAM_ID.toBase58()}`);
  console.log(`Payer:    ${payer.publicKey.toBase58()}`);
  console.log(`Balance:  ${(await connection.getBalance(payer.publicKey)) / 1e9} SOL\n`);

  // ── SCENARIO 1: register_work_claim — realistic CID digest ──────────────
  {
    const label = "register_work_claim — realistic CID digest";
    const rawHash = rh(); const linkNonce = rh(); const anchorNonce = rh();
    const extRef = Array.from(REALISTIC_DIGEST);
    const contentArtifact = derive([Buffer.from("content"), Buffer.from(rawHash)]);
    const workClaim = derive([Buffer.from("claim"), contentArtifact.toBuffer(), payer.publicKey.toBuffer()]);
    const ownership = derive([Buffer.from("ownership"), workClaim.toBuffer()]);
    const ownerRecord = derive([Buffer.from("owner"), ownership.toBuffer(), payer.publicKey.toBuffer()]);
    const claimArtifactLink = derive([Buffer.from("claim_artifact"), workClaim.toBuffer(), Buffer.from(linkNonce)]);
    const anchorRecord = derive([Buffer.from("anchor"), workClaim.toBuffer(), Buffer.from(anchorNonce)]);
    try {
      await program.methods
        .registerWorkClaim(rawHash, 1, 1, 100, 100, linkNonce, anchorNonce, 1, extRef)
        .accountsStrict({ registryConfig, contentArtifact, workClaim, ownership, ownerRecord, claimArtifactLink, anchorRecord, signer: payer.publicKey, systemProgram: SystemProgram.programId })
        .rpc();
      const ar = await (program.account as any).anchorRecord.fetch(anchorRecord);
      const stored = Buffer.from(ar.externalRefHash);
      bufEquals(stored, REALISTIC_DIGEST)
        ? pass(label)
        : fail(label, `stored ${stored.toString("hex")} != expected ${REALISTIC_DIGEST.toString("hex")}`);
    } catch (e: any) { fail(label, e.message); }
  }

  // ── SCENARIO 2: register_work_claim — all-ones boundary ─────────────────
  {
    const label = "register_work_claim — all-ones (0xFF×32)";
    const rawHash = rh(); const linkNonce = rh(); const anchorNonce = rh();
    const extRef = Array.from(ALL_ONES);
    const contentArtifact = derive([Buffer.from("content"), Buffer.from(rawHash)]);
    const workClaim = derive([Buffer.from("claim"), contentArtifact.toBuffer(), payer.publicKey.toBuffer()]);
    const ownership = derive([Buffer.from("ownership"), workClaim.toBuffer()]);
    const ownerRecord = derive([Buffer.from("owner"), ownership.toBuffer(), payer.publicKey.toBuffer()]);
    const claimArtifactLink = derive([Buffer.from("claim_artifact"), workClaim.toBuffer(), Buffer.from(linkNonce)]);
    const anchorRecord = derive([Buffer.from("anchor"), workClaim.toBuffer(), Buffer.from(anchorNonce)]);
    try {
      await program.methods
        .registerWorkClaim(rawHash, 1, 1, 100, 100, linkNonce, anchorNonce, 1, extRef)
        .accountsStrict({ registryConfig, contentArtifact, workClaim, ownership, ownerRecord, claimArtifactLink, anchorRecord, signer: payer.publicKey, systemProgram: SystemProgram.programId })
        .rpc();
      const ar = await (program.account as any).anchorRecord.fetch(anchorRecord);
      const stored = Buffer.from(ar.externalRefHash);
      bufEquals(stored, ALL_ONES)
        ? pass(label)
        : fail(label, `stored ${stored.toString("hex")} != expected ${ALL_ONES.toString("hex")}`);
    } catch (e: any) { fail(label, e.message); }
  }

  // ── For add_version we need a base registration first ───────────────────
  const baseRawHash = rh(); const baseLinkNonce = rh(); const baseAnchorNonce = rh();
  const baseContentArtifact = derive([Buffer.from("content"), Buffer.from(baseRawHash)]);
  const baseWorkClaim = derive([Buffer.from("claim"), baseContentArtifact.toBuffer(), payer.publicKey.toBuffer()]);
  const baseOwnership = derive([Buffer.from("ownership"), baseWorkClaim.toBuffer()]);
  const baseOwnerRecord = derive([Buffer.from("owner"), baseOwnership.toBuffer(), payer.publicKey.toBuffer()]);
  const baseClaimArtifactLink = derive([Buffer.from("claim_artifact"), baseWorkClaim.toBuffer(), Buffer.from(baseLinkNonce)]);
  const baseAnchorRecord = derive([Buffer.from("anchor"), baseWorkClaim.toBuffer(), Buffer.from(baseAnchorNonce)]);
  await program.methods
    .registerWorkClaim(baseRawHash, 1, 1, 100, 100, baseLinkNonce, baseAnchorNonce, 1, Array(32).fill(0))
    .accountsStrict({ registryConfig, contentArtifact: baseContentArtifact, workClaim: baseWorkClaim, ownership: baseOwnership, ownerRecord: baseOwnerRecord, claimArtifactLink: baseClaimArtifactLink, anchorRecord: baseAnchorRecord, signer: payer.publicKey, systemProgram: SystemProgram.programId })
    .rpc();
  let currentHead = baseClaimArtifactLink;

  // ── SCENARIO 3: add_version — realistic CID digest ──────────────────────
  {
    const label = "add_version — realistic CID digest";
    const rawHash = rh(); const linkNonce = rh(); const anchorNonce = rh();
    const extRef = Array.from(REALISTIC_DIGEST);
    const contentArtifact = derive([Buffer.from("content"), Buffer.from(rawHash)]);
    const claimArtifactLink = derive([Buffer.from("claim_artifact"), baseWorkClaim.toBuffer(), Buffer.from(linkNonce)]);
    const anchorRecord = derive([Buffer.from("anchor"), contentArtifact.toBuffer(), Buffer.from(anchorNonce)]);
    try {
      await program.methods
        .addVersion(rawHash, 1, linkNonce, anchorNonce, 1, currentHead, extRef)
        .accountsStrict({ registryConfig, workClaim: baseWorkClaim, contentArtifact, claimArtifactLink, anchorRecord, claimant: payer.publicKey, systemProgram: SystemProgram.programId })
        .rpc();
      const ar = await (program.account as any).anchorRecord.fetch(anchorRecord);
      const stored = Buffer.from(ar.externalRefHash);
      bufEquals(stored, REALISTIC_DIGEST)
        ? pass(label)
        : fail(label, `stored ${stored.toString("hex")} != expected ${REALISTIC_DIGEST.toString("hex")}`);
      currentHead = claimArtifactLink;
    } catch (e: any) { fail(label, e.message); }
  }

  // ── SCENARIO 4: add_version — all-ones boundary ─────────────────────────
  {
    const label = "add_version — all-ones (0xFF×32)";
    const rawHash = rh(); const linkNonce = rh(); const anchorNonce = rh();
    const extRef = Array.from(ALL_ONES);
    const contentArtifact = derive([Buffer.from("content"), Buffer.from(rawHash)]);
    const claimArtifactLink = derive([Buffer.from("claim_artifact"), baseWorkClaim.toBuffer(), Buffer.from(linkNonce)]);
    const anchorRecord = derive([Buffer.from("anchor"), contentArtifact.toBuffer(), Buffer.from(anchorNonce)]);
    try {
      await program.methods
        .addVersion(rawHash, 1, linkNonce, anchorNonce, 1, currentHead, extRef)
        .accountsStrict({ registryConfig, workClaim: baseWorkClaim, contentArtifact, claimArtifactLink, anchorRecord, claimant: payer.publicKey, systemProgram: SystemProgram.programId })
        .rpc();
      const ar = await (program.account as any).anchorRecord.fetch(anchorRecord);
      const stored = Buffer.from(ar.externalRefHash);
      bufEquals(stored, ALL_ONES)
        ? pass(label)
        : fail(label, `stored ${stored.toString("hex")} != expected ${ALL_ONES.toString("hex")}`);
      currentHead = claimArtifactLink;
    } catch (e: any) { fail(label, e.message); }
  }

  // ── SCENARIO 5: anchor_evidence_contract — realistic CID digest ──────────
  {
    const label = "anchor_evidence_contract — realistic CID digest";
    const rawContractHash = rh(); const anchorNonce = rh();
    const extRef = Array.from(REALISTIC_DIGEST);
    const contractArtifact = derive([Buffer.from("contract_artifact"), Buffer.from(rawContractHash)]);
    const evidenceAnchor = derive([Buffer.from("evidence"), payer.publicKey.toBuffer(), contractArtifact.toBuffer()]);
    const anchorRecord = derive([Buffer.from("anchor"), evidenceAnchor.toBuffer(), Buffer.from(anchorNonce)]);
    try {
      await program.methods
        .anchorEvidenceContract(rawContractHash, 1, anchorNonce, 1, baseWorkClaim, extRef)
        .accountsStrict({ registryConfig, contractArtifact, evidenceAnchor, anchorRecord, anchorer: payer.publicKey, systemProgram: SystemProgram.programId })
        .rpc();
      const ar = await (program.account as any).anchorRecord.fetch(anchorRecord);
      const stored = Buffer.from(ar.externalRefHash);
      bufEquals(stored, REALISTIC_DIGEST)
        ? pass(label)
        : fail(label, `stored ${stored.toString("hex")} != expected ${REALISTIC_DIGEST.toString("hex")}`);
    } catch (e: any) { fail(label, e.message); }
  }

  // ── SCENARIO 6: anchor_evidence_contract — all-ones boundary ─────────────
  {
    const label = "anchor_evidence_contract — all-ones (0xFF×32)";
    const rawContractHash = rh(); const anchorNonce = rh();
    const extRef = Array.from(ALL_ONES);
    const contractArtifact = derive([Buffer.from("contract_artifact"), Buffer.from(rawContractHash)]);
    const evidenceAnchor = derive([Buffer.from("evidence"), payer.publicKey.toBuffer(), contractArtifact.toBuffer()]);
    const anchorRecord = derive([Buffer.from("anchor"), evidenceAnchor.toBuffer(), Buffer.from(anchorNonce)]);
    try {
      await program.methods
        .anchorEvidenceContract(rawContractHash, 1, anchorNonce, 1, baseWorkClaim, extRef)
        .accountsStrict({ registryConfig, contractArtifact, evidenceAnchor, anchorRecord, anchorer: payer.publicKey, systemProgram: SystemProgram.programId })
        .rpc();
      const ar = await (program.account as any).anchorRecord.fetch(anchorRecord);
      const stored = Buffer.from(ar.externalRefHash);
      bufEquals(stored, ALL_ONES)
        ? pass(label)
        : fail(label, `stored ${stored.toString("hex")} != expected ${ALL_ONES.toString("hex")}`);
    } catch (e: any) { fail(label, e.message); }
  }

  // ── SCENARIO 7: anchor_authorized_contract — realistic CID digest ─────────
  {
    const label = "anchor_authorized_contract — realistic CID digest";
    const rawContractHash = rh(); const anchorNonce = rh();
    const extRef = Array.from(REALISTIC_DIGEST);
    const contractArtifact = derive([Buffer.from("contract_artifact"), Buffer.from(rawContractHash)]);
    const authorizedContractAnchor = derive([Buffer.from("authorized_contract"), baseWorkClaim.toBuffer(), contractArtifact.toBuffer()]);
    const anchorRecord = derive([Buffer.from("anchor"), authorizedContractAnchor.toBuffer(), Buffer.from(anchorNonce)]);
    try {
      await program.methods
        .anchorAuthorizedContract(rawContractHash, 1, anchorNonce, 1, extRef)
        .accountsStrict({ registryConfig, workClaim: baseWorkClaim, ownership: baseOwnership, contractArtifact, authorizedContractAnchor, anchorRecord, admin: payer.publicKey, systemProgram: SystemProgram.programId })
        .rpc();
      const ar = await (program.account as any).anchorRecord.fetch(anchorRecord);
      const stored = Buffer.from(ar.externalRefHash);
      bufEquals(stored, REALISTIC_DIGEST)
        ? pass(label)
        : fail(label, `stored ${stored.toString("hex")} != expected ${REALISTIC_DIGEST.toString("hex")}`);
    } catch (e: any) { fail(label, e.message); }
  }

  // ── SCENARIO 8: anchor_authorized_contract — all-ones boundary ───────────
  {
    const label = "anchor_authorized_contract — all-ones (0xFF×32)";
    const rawContractHash = rh(); const anchorNonce = rh();
    const extRef = Array.from(ALL_ONES);
    const contractArtifact = derive([Buffer.from("contract_artifact"), Buffer.from(rawContractHash)]);
    const authorizedContractAnchor = derive([Buffer.from("authorized_contract"), baseWorkClaim.toBuffer(), contractArtifact.toBuffer()]);
    const anchorRecord = derive([Buffer.from("anchor"), authorizedContractAnchor.toBuffer(), Buffer.from(anchorNonce)]);
    try {
      await program.methods
        .anchorAuthorizedContract(rawContractHash, 1, anchorNonce, 1, extRef)
        .accountsStrict({ registryConfig, workClaim: baseWorkClaim, ownership: baseOwnership, contractArtifact, authorizedContractAnchor, anchorRecord, admin: payer.publicKey, systemProgram: SystemProgram.programId })
        .rpc();
      const ar = await (program.account as any).anchorRecord.fetch(anchorRecord);
      const stored = Buffer.from(ar.externalRefHash);
      bufEquals(stored, ALL_ONES)
        ? pass(label)
        : fail(label, `stored ${stored.toString("hex")} != expected ${ALL_ONES.toString("hex")}`);
    } catch (e: any) { fail(label, e.message); }
  }

  // ── SCENARIO 9: anchor_evidence_contract — invalid contract_kind=99 ──────
  {
    const label = "anchor_evidence_contract — invalid contract_kind=99 (expect 6002)";
    const rawContractHash = rh(); const anchorNonce = rh();
    const contractArtifact = derive([Buffer.from("contract_artifact"), Buffer.from(rawContractHash)]);
    const evidenceAnchor = derive([Buffer.from("evidence"), payer.publicKey.toBuffer(), contractArtifact.toBuffer()]);
    const anchorRecord = derive([Buffer.from("anchor"), evidenceAnchor.toBuffer(), Buffer.from(anchorNonce)]);
    try {
      await program.methods
        .anchorEvidenceContract(rawContractHash, 99, anchorNonce, 1, baseWorkClaim, Array(32).fill(0))
        .accountsStrict({ registryConfig, contractArtifact, evidenceAnchor, anchorRecord, anchorer: payer.publicKey, systemProgram: SystemProgram.programId })
        .rpc();
      fail(label, "transaction succeeded but should have reverted");
    } catch (e: any) {
      const msg = String(e.message);
      (msg.includes("AnchorModeNotAllowed") || msg.includes("6002"))
        ? pass(label)
        : fail(label, `unexpected error: ${msg}`);
    }
  }

  // ── SCENARIO 10: anchor_authorized_contract — invalid contract_kind=99 ───
  {
    const label = "anchor_authorized_contract — invalid contract_kind=99 (expect 6002)";
    const rawContractHash = rh(); const anchorNonce = rh();
    const contractArtifact = derive([Buffer.from("contract_artifact"), Buffer.from(rawContractHash)]);
    const authorizedContractAnchor = derive([Buffer.from("authorized_contract"), baseWorkClaim.toBuffer(), contractArtifact.toBuffer()]);
    const anchorRecord = derive([Buffer.from("anchor"), authorizedContractAnchor.toBuffer(), Buffer.from(anchorNonce)]);
    try {
      await program.methods
        .anchorAuthorizedContract(rawContractHash, 99, anchorNonce, 1, Array(32).fill(0))
        .accountsStrict({ registryConfig, workClaim: baseWorkClaim, ownership: baseOwnership, contractArtifact, authorizedContractAnchor, anchorRecord, admin: payer.publicKey, systemProgram: SystemProgram.programId })
        .rpc();
      fail(label, "transaction succeeded but should have reverted");
    } catch (e: any) {
      const msg = String(e.message);
      (msg.includes("AnchorModeNotAllowed") || msg.includes("6002"))
        ? pass(label)
        : fail(label, `unexpected error: ${msg}`);
    }
  }

  // ── SCENARIO 11: register_work_claim — invalid anchor_mode_arg=99 ────────
  {
    const label = "register_work_claim — invalid anchor_mode_arg=99 (expect 6002)";
    const rawHash = rh(); const linkNonce = rh(); const anchorNonce = rh();
    const contentArtifact = derive([Buffer.from("content"), Buffer.from(rawHash)]);
    const workClaim = derive([Buffer.from("claim"), contentArtifact.toBuffer(), payer.publicKey.toBuffer()]);
    const ownership = derive([Buffer.from("ownership"), workClaim.toBuffer()]);
    const ownerRecord = derive([Buffer.from("owner"), ownership.toBuffer(), payer.publicKey.toBuffer()]);
    const claimArtifactLink = derive([Buffer.from("claim_artifact"), workClaim.toBuffer(), Buffer.from(linkNonce)]);
    const anchorRecord = derive([Buffer.from("anchor"), workClaim.toBuffer(), Buffer.from(anchorNonce)]);
    try {
      await program.methods
        .registerWorkClaim(rawHash, 1, 1, 100, 100, linkNonce, anchorNonce, 99, Array(32).fill(0))
        .accountsStrict({ registryConfig, contentArtifact, workClaim, ownership, ownerRecord, claimArtifactLink, anchorRecord, signer: payer.publicKey, systemProgram: SystemProgram.programId })
        .rpc();
      fail(label, "transaction succeeded but should have reverted");
    } catch (e: any) {
      const msg = String(e.message);
      (msg.includes("AnchorModeNotAllowed") || msg.includes("6002"))
        ? pass(label)
        : fail(label, `unexpected error: ${msg}`);
    }
  }

  // ── SCENARIO 12: add_version — invalid anchor_mode_arg=99 ────────────────
  {
    const label = "add_version — invalid anchor_mode_arg=99 (expect 6002)";
    const rawHash = rh(); const linkNonce = rh(); const anchorNonce = rh();
    const contentArtifact = derive([Buffer.from("content"), Buffer.from(rawHash)]);
    const claimArtifactLink = derive([Buffer.from("claim_artifact"), baseWorkClaim.toBuffer(), Buffer.from(linkNonce)]);
    const anchorRecord = derive([Buffer.from("anchor"), contentArtifact.toBuffer(), Buffer.from(anchorNonce)]);
    try {
      await program.methods
        .addVersion(rawHash, 1, linkNonce, anchorNonce, 99, currentHead, Array(32).fill(0))
        .accountsStrict({ registryConfig, workClaim: baseWorkClaim, contentArtifact, claimArtifactLink, anchorRecord, claimant: payer.publicKey, systemProgram: SystemProgram.programId })
        .rpc();
      fail(label, "transaction succeeded but should have reverted");
    } catch (e: any) {
      const msg = String(e.message);
      (msg.includes("AnchorModeNotAllowed") || msg.includes("6002"))
        ? pass(label)
        : fail(label, `unexpected error: ${msg}`);
    }
  }

  // ── SCENARIO 13: anchor_evidence_contract — invalid anchor_mode_arg=99 ───
  {
    const label = "anchor_evidence_contract — invalid anchor_mode_arg=99 (expect 6002)";
    const rawContractHash = rh(); const anchorNonce = rh();
    const contractArtifact = derive([Buffer.from("contract_artifact"), Buffer.from(rawContractHash)]);
    const evidenceAnchor = derive([Buffer.from("evidence"), payer.publicKey.toBuffer(), contractArtifact.toBuffer()]);
    const anchorRecord = derive([Buffer.from("anchor"), evidenceAnchor.toBuffer(), Buffer.from(anchorNonce)]);
    try {
      await program.methods
        .anchorEvidenceContract(rawContractHash, 1, anchorNonce, 99, baseWorkClaim, Array(32).fill(0))
        .accountsStrict({ registryConfig, contractArtifact, evidenceAnchor, anchorRecord, anchorer: payer.publicKey, systemProgram: SystemProgram.programId })
        .rpc();
      fail(label, "transaction succeeded but should have reverted");
    } catch (e: any) {
      const msg = String(e.message);
      (msg.includes("AnchorModeNotAllowed") || msg.includes("6002"))
        ? pass(label)
        : fail(label, `unexpected error: ${msg}`);
    }
  }

  // ── SCENARIO 14: anchor_authorized_contract — invalid anchor_mode_arg=99 ─
  {
    const label = "anchor_authorized_contract — invalid anchor_mode_arg=99 (expect 6002)";
    const rawContractHash = rh(); const anchorNonce = rh();
    const contractArtifact = derive([Buffer.from("contract_artifact"), Buffer.from(rawContractHash)]);
    const authorizedContractAnchor = derive([Buffer.from("authorized_contract"), baseWorkClaim.toBuffer(), contractArtifact.toBuffer()]);
    const anchorRecord = derive([Buffer.from("anchor"), authorizedContractAnchor.toBuffer(), Buffer.from(anchorNonce)]);
    try {
      await program.methods
        .anchorAuthorizedContract(rawContractHash, 1, anchorNonce, 99, Array(32).fill(0))
        .accountsStrict({ registryConfig, workClaim: baseWorkClaim, ownership: baseOwnership, contractArtifact, authorizedContractAnchor, anchorRecord, admin: payer.publicKey, systemProgram: SystemProgram.programId })
        .rpc();
      fail(label, "transaction succeeded but should have reverted");
    } catch (e: any) {
      const msg = String(e.message);
      (msg.includes("AnchorModeNotAllowed") || msg.includes("6002"))
        ? pass(label)
        : fail(label, `unexpected error: ${msg}`);
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────
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
