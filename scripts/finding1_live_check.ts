/**
 * PlotArmor — Finding 1 live devnet verification (one-off, not part of the
 * permanent devnet suite)
 * ============================================================
 * Confirms the just-redeployed devnet program (commit 3bf2ac3) actually
 * rejects anchor_mode_arg = AttestedMainnet (2) with AnchorModeNotAllowed
 * (6002), and that anchor_mode_arg = AttestedDevnet (1) still succeeds
 * normally (no regression to the existing devnet-path behavior).
 *
 * Run from the plotarmor-program repo root:
 *   DEVNET_RPC_URL=<url> node_modules/.bin/ts-node --transpile-only scripts/finding1_live_check.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
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
  const raw = JSON.parse(fs.readFileSync(KEYPAIR_PATH, "utf-8"));
  return Keypair.fromSecretKey(new Uint8Array(raw));
}

async function attemptRegister(
  program: Program<Plotarmor>,
  payer: Keypair,
  registryConfig: PublicKey,
  anchorModeArg: number
): Promise<{ ok: true; sig: string } | { ok: false; error: string }> {
  const rawHash = rh();
  const linkNonce = rh();
  const anchorNonce = rh();
  const externalRefHash = rh();

  const contentArtifact = derive([Buffer.from("content"), rawHash]);
  const workClaim = derive([Buffer.from("claim"), contentArtifact.toBuffer(), payer.publicKey.toBuffer()]);
  const ownership = derive([Buffer.from("ownership"), workClaim.toBuffer()]);
  const ownerRecord = derive([Buffer.from("owner"), ownership.toBuffer(), payer.publicKey.toBuffer()]);
  const claimArtifactLink = derive([Buffer.from("claim_artifact"), workClaim.toBuffer(), linkNonce]);
  const anchorRecord = derive([Buffer.from("anchor"), workClaim.toBuffer(), anchorNonce]);

  try {
    const sig = await program.methods
      .registerWorkClaim(ba(rawHash), 1, 1, 100, 100, ba(linkNonce), ba(anchorNonce), anchorModeArg, ba(externalRefHash))
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
    return { ok: true, sig };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

async function main() {
  console.log("PlotArmor — Finding 1 live devnet verification");
  console.log("================================================\n");

  const connection = new Connection(DEVNET_RPC_URL, "confirmed");
  const payer = loadPayer();
  console.log("Payer:", payer.publicKey.toBase58());
  const balanceSol = (await connection.getBalance(payer.publicKey)) / 1e9;
  console.log("Payer balance:", balanceSol.toFixed(4), "SOL\n");

  const wallet = new Wallet(payer);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);
  const program = new Program(idl as anchor.Idl, provider) as unknown as Program<Plotarmor>;

  const registryConfig = derive([Buffer.from("config")]);

  let pass = 0;
  let fail = 0;

  console.log("Scenario A: anchor_mode_arg = AttestedMainnet (2) on this devnet-built program");
  console.log("  Expect: REJECTED with AnchorModeNotAllowed (6002)");
  const resA = await attemptRegister(program, payer, registryConfig, 2);
  if (resA.ok) {
    console.log("  FAIL — transaction succeeded, expected rejection. Sig:", resA.sig);
    fail++;
  } else if (resA.error.includes("AnchorModeNotAllowed") || resA.error.includes("6002")) {
    console.log("  PASS — rejected with AnchorModeNotAllowed (6002) as expected");
    pass++;
  } else {
    console.log("  FAIL — rejected but NOT with AnchorModeNotAllowed:", resA.error.slice(0, 300));
    fail++;
  }

  console.log("\nScenario B: anchor_mode_arg = AttestedDevnet (1), the existing valid devnet mode");
  console.log("  Expect: SUCCEEDS (no regression)");
  const resB = await attemptRegister(program, payer, registryConfig, 1);
  if (resB.ok) {
    console.log("  PASS — succeeded. Sig:", resB.sig);
    console.log("  Explorer:", `https://explorer.solana.com/tx/${resB.sig}?cluster=devnet`);
    pass++;
  } else {
    console.log("  FAIL — expected success, got error:", resB.error.slice(0, 300));
    fail++;
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
