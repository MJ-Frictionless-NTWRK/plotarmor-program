/**
 * PlotArmor — Standalone Devnet Proof Script
 * ============================================
 * Step A of the MVP build sequence: prove that register_work_claim
 * works end-to-end against real Solana devnet, in complete isolation
 * from Supabase and the frontend.
 *
 * This script does NOT touch Anchor.toml (which stays pointed at
 * localnet for the existing 57-test suite). It builds its own
 * devnet Connection directly.
 *
 * Run from the plotarmor-program repo root:
 *   yarn ts-node scripts/devnet_register_test.ts
 *
 * Requires:
 *   - target/types/plotarmor.ts and target/idl/plotarmor.json
 *     (run `anchor build --ignore-keys` first if missing)
 *   - A funded devnet keypair at ~/.config/solana/id.json
 *   - DEVNET_RPC_URL env var (Helius devnet endpoint)
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

// ── Config ───────────────────────────────────────────────────
const PROGRAM_ID = new PublicKey("3h9CzV9MJDeD5yjhVhdE6cupuXVRnLW1Cu6P14EJBKv2");

const DEVNET_RPC_URL =
  process.env.DEVNET_RPC_URL ||
  "https://devnet.helius-rpc.com/?api-key=" + (process.env.HELIUS_API_KEY || "");

const KEYPAIR_PATH = path.join(os.homedir(), ".config/solana/id.json");

// ── Helpers (mirroring tests/plotarmor.ts patterns) ─────────
function derive(seeds: Buffer[]): PublicKey {
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

// ── Main ─────────────────────────────────────────────────────
async function main() {
  console.log("PlotArmor — Devnet register_work_claim Proof");
  console.log("================================================\n");

  if (!process.env.HELIUS_API_KEY && !process.env.DEVNET_RPC_URL) {
    console.error("Set HELIUS_API_KEY or DEVNET_RPC_URL env var before running.");
    process.exit(1);
  }

  // 1. Connection + payer
  const connection = new Connection(DEVNET_RPC_URL, "confirmed");
  const payer = loadPayer();
  console.log("Payer:", payer.publicKey.toBase58());

  const balanceLamports = await connection.getBalance(payer.publicKey);
  const balanceSol = balanceLamports / 1e9;
  console.log("Payer balance:", balanceSol.toFixed(4), "SOL");
  if (balanceSol < 0.05) {
    console.error("Insufficient balance. Need at least 0.05 SOL for this test.");
    process.exit(1);
  }

  // 2. Provider + program client
  const wallet = new Wallet(payer);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);
  const program = new Program(idl as anchor.Idl, provider) as unknown as Program<Plotarmor>;

  // 3. Check / init RegistryConfig (one-time singleton per deployment)
  const registryConfig = derive([Buffer.from("config")]);
  console.log("RegistryConfig PDA:", registryConfig.toBase58());

  const existingConfig = await connection.getAccountInfo(registryConfig);
  if (existingConfig) {
    console.log("RegistryConfig already initialized on this deployment. Skipping init.\n");
  } else {
    console.log("RegistryConfig not found. Initializing...");
    try {
      const sig = await program.methods
        .initRegistryConfig()
        .accountsStrict({
          registryConfig,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();
      console.log("RegistryConfig initialized. Tx:", sig, "\n");
    } catch (e) {
      console.error("RegistryConfig init failed:", e);
      console.log("Continuing anyway — may already exist under different account shape.\n");
    }
  }

  // 4. Build register_work_claim call
  const rawHash = rh();
  const linkNonce = rh();
  const anchorNonce = rh();

  const contentArtifact = derive([Buffer.from("content"), rawHash]);
  const workClaim = derive([
    Buffer.from("claim"),
    contentArtifact.toBuffer(),
    payer.publicKey.toBuffer(),
  ]);
  const ownership = derive([Buffer.from("ownership"), workClaim.toBuffer()]);
  const ownerRecord = derive([
    Buffer.from("owner"),
    ownership.toBuffer(),
    payer.publicKey.toBuffer(),
  ]);
  const claimArtifactLink = derive([
    Buffer.from("claim_artifact"),
    workClaim.toBuffer(),
    linkNonce,
  ]);
  const anchorRecord = derive([
    Buffer.from("anchor"),
    workClaim.toBuffer(),
    anchorNonce,
  ]);

  console.log("Derived PDAs:");
  console.log("  ContentArtifact: ", contentArtifact.toBase58());
  console.log("  WorkClaim:       ", workClaim.toBase58());
  console.log("  Ownership:       ", ownership.toBase58());
  console.log("  OwnerRecord:     ", ownerRecord.toBase58());
  console.log("  ClaimArtifactLink:", claimArtifactLink.toBase58());
  console.log("  AnchorRecord:    ", anchorRecord.toBase58());
  console.log("  raw_hash (hex):  ", rawHash.toString("hex"));
  console.log();

  // content_kind=1 (screenplay), claim_kind=1 (original),
  // total_shares=100, threshold_shares=100,
  // anchor_mode_arg=1 (attested_devnet)
  console.log("Submitting register_work_claim transaction to devnet...");
  const t0 = Date.now();

  try {
    const sig = await program.methods
      .registerWorkClaim(
        ba(rawHash),
        1,   // content_kind: screenplay
        1,   // claim_kind: original
        100, // total_shares
        100, // threshold_shares
        ba(linkNonce),
        ba(anchorNonce),
        1    // anchor_mode_arg: attested_devnet
      )
      .accountsStrict({
        registryConfig,
        contentArtifact,
        workClaim,
        ownership,
        ownerRecord,
        claimArtifactLink,
        anchorRecord,
        signer: payer.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc({ commitment: "confirmed" });

    const elapsed = Date.now() - t0;
    console.log("\n✓ Transaction confirmed in", elapsed, "ms");
    console.log("✓ Signature:", sig);
    console.log("✓ Explorer:", `https://explorer.solana.com/tx/${sig}?cluster=devnet`);

    // 5. Verify on-chain state by reading the account back
    console.log("\nVerifying on-chain state...");
    const workClaimAccount = await (program.account as any).workClaim.fetch(workClaim);
    console.log("✓ WorkClaim fetched from chain:");
    console.log("    root_artifact:", workClaimAccount.rootArtifact.toBase58());
    console.log("    claimant:     ", workClaimAccount.claimant.toBase58());
    console.log("    claim_kind:   ", workClaimAccount.claimKind);

    const anchorRecordAccount = await (program.account as any).anchorRecord.fetch(anchorRecord);
    console.log("✓ AnchorRecord fetched from chain:");
    console.log("    anchor_mode:  ", anchorRecordAccount.anchorMode);
    console.log("    anchored_object_kind:", anchorRecordAccount.anchoredObjectKind);

    console.log("\n================================================");
    console.log("RESULT: Step A proof SUCCESSFUL");
    console.log("================================================");
    console.log("\nReal data for reference:");
    console.log(JSON.stringify({
      tx_signature: sig,
      tx_signature_length: sig.length,
      content_artifact_pda: contentArtifact.toBase58(),
      work_claim_pda: workClaim.toBase58(),
      anchor_record_pda: anchorRecord.toBase58(),
      anchor_mode: 1,
      raw_hash: rawHash.toString("hex"),
    }, null, 2));

  } catch (e) {
    console.error("\n✗ Transaction FAILED");
    console.error(e);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
