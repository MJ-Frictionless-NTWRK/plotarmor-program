import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Plotarmor } from "../target/types/plotarmor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import * as crypto from "crypto";
import { expect } from "chai";

const PROGRAM_ID = new PublicKey("3h9CzV9MJDeD5yjhVhdE6cupuXVRnLW1Cu6P14EJBKv2");

function derive(seeds: Buffer[]): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
}

// Returns a random 32-byte Buffer usable as a PDA seed.
function rh(): Buffer {
  return crypto.randomBytes(32);
}

// Converts a Buffer to number[] as required by Anchor's strict TypeScript types.
function ba(b: Buffer): number[] {
  return Array.from(b);
}

function expectErr(err: unknown, ...tokens: string[]): void {
  const msg = err instanceof Error ? err.message : String(err);
  const ok = tokens.some((t) => msg.includes(t));
  expect(ok, `Expected one of [${tokens.join(" | ")}] in:\n${msg}`).to.be.true;
}

// ─── Fixture types ────────────────────────────────────────────────────────────

interface ClaimFixture {
  rawHash: Buffer;
  contentArtifact: PublicKey;
  workClaim: PublicKey;
  ownership: PublicKey;
  ownerRecord: PublicKey;
  claimArtifactLink: PublicKey;
  anchorRecord: PublicKey;
  linkNonce: Buffer;
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("PlotArmor", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Plotarmor as Program<Plotarmor>;
  const payer = (provider.wallet as anchor.Wallet).payer;
  const registryConfig = derive([Buffer.from("config")]);
  const BPF_UPGRADEABLE_LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
  const programData = PublicKey.findProgramAddressSync(
    [PROGRAM_ID.toBytes()],
    BPF_UPGRADEABLE_LOADER
  )[0];

  // Fund an ephemeral keypair from the payer.
  async function fund(kp: Keypair, lamports = 10_000_000): Promise<void> {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: kp.publicKey,
        lamports,
      })
    );
    await provider.sendAndConfirm(tx);
  }

  // Register a fresh work claim and return all derived PDAs.
  // args order: rawHash, contentKind, claimKind, totalShares, thresholdShares, linkNonce, anchorNonce, anchorModeArg
  async function registerClaim(opts: {
    rawHash?: Buffer;
    claimant?: Keypair;
  } = {}): Promise<ClaimFixture> {
    const signer = opts.claimant ?? payer;
    const rawHash = opts.rawHash ?? rh();
    const linkNonce = rh();
    const anchorNonce = rh();
    const contentArtifact = derive([Buffer.from("content"), rawHash]);
    const workClaim = derive([
      Buffer.from("claim"),
      contentArtifact.toBuffer(),
      signer.publicKey.toBuffer(),
    ]);
    const ownership = derive([Buffer.from("ownership"), workClaim.toBuffer()]);
    const ownerRecord = derive([
      Buffer.from("owner"),
      ownership.toBuffer(),
      signer.publicKey.toBuffer(),
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

    await program.methods
      .registerWorkClaim(ba(rawHash), 1, 1, 100, 100, ba(linkNonce), ba(anchorNonce), 1)
      .accountsStrict({
        registryConfig,
        contentArtifact,
        workClaim,
        ownership,
        ownerRecord,
        claimArtifactLink,
        anchorRecord,
        signer: signer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers(opts.claimant ? [opts.claimant] : [])
      .rpc();

    return {
      rawHash,
      contentArtifact,
      workClaim,
      ownership,
      ownerRecord,
      claimArtifactLink,
      anchorRecord,
      linkNonce,
    };
  }

  // Add a version to an existing work claim. Returns the new PDAs.
  // args order: rawHash, contentKind, linkNonce, anchorNonce, anchorModeArg, expectedPreviousLink
  async function addVer(
    workClaim: PublicKey,
    expectedPreviousLink: PublicKey,
    opts: {
      rawHash?: Buffer;
      contentArtifactPda?: PublicKey;
      signer?: Keypair;
    } = {}
  ): Promise<{
    rawHash: Buffer;
    contentArtifact: PublicKey;
    claimArtifactLink: PublicKey;
    anchorRecord: PublicKey;
    linkNonce: Buffer;
  }> {
    const signer = opts.signer ?? payer;
    const rawHash = opts.rawHash ?? rh();
    const linkNonce = rh();
    const anchorNonce = rh();
    const contentArtifact =
      opts.contentArtifactPda ?? derive([Buffer.from("content"), rawHash]);
    const claimArtifactLink = derive([
      Buffer.from("claim_artifact"),
      workClaim.toBuffer(),
      linkNonce,
    ]);
    const anchorRecord = derive([
      Buffer.from("anchor"),
      contentArtifact.toBuffer(),
      anchorNonce,
    ]);

    await program.methods
      .addVersion(ba(rawHash), 1, ba(linkNonce), ba(anchorNonce), 1, expectedPreviousLink)
      .accountsStrict({
        registryConfig,
        workClaim,
        contentArtifact,
        claimArtifactLink,
        anchorRecord,
        signer: signer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers(opts.signer ? [opts.signer] : [])
      .rpc();

    return { rawHash, contentArtifact, claimArtifactLink, anchorRecord, linkNonce };
  }

  // Initialize the registry config once for the whole suite.
  before(async () => {
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
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HAPPY PATHS
  // ═══════════════════════════════════════════════════════════════════════════

  describe("init_registry_config", () => {
    it("sets authority, schema_version=1, enabled_anchor_modes=0, paused=false", async () => {
      const cfg = await program.account.registryConfig.fetch(registryConfig);
      expect(cfg.authority.toBase58()).to.equal(payer.publicKey.toBase58());
      expect(cfg.schemaVersion).to.equal(1);
      expect(cfg.enabledAnchorModes).to.equal(0);
      expect(cfg.paused).to.be.false;
    });
  });

  describe("register_work_claim", () => {
    it("creates six accounts with correct state and heads", async () => {
      const f = await registerClaim();

      const wc   = await program.account.workClaim.fetch(f.workClaim);
      const ca   = await program.account.contentArtifact.fetch(f.contentArtifact);
      const own  = await program.account.ownership.fetch(f.ownership);
      const or   = await program.account.ownerRecord.fetch(f.ownerRecord);
      const link = await program.account.claimArtifactLink.fetch(f.claimArtifactLink);
      const ar   = await program.account.anchorRecord.fetch(f.anchorRecord);

      // WorkClaim
      expect(wc.rootArtifact.toBase58()).to.equal(f.contentArtifact.toBase58());
      expect(wc.latestArtifact.toBase58()).to.equal(f.contentArtifact.toBase58());
      expect(wc.latestLink.toBase58()).to.equal(f.claimArtifactLink.toBase58());
      expect(wc.claimant.toBase58()).to.equal(payer.publicKey.toBase58());
      expect(wc.ownership.toBase58()).to.equal(f.ownership.toBase58());
      expect(wc.discoverability).to.equal(0);
      expect(wc.supersededBy.toBase58()).to.equal(PublicKey.default.toBase58());

      // ContentArtifact
      expect(ca.isInitialized).to.be.true;
      expect(Buffer.from(ca.rawHash)).to.deep.equal(f.rawHash);
      expect(ca.contentKind).to.equal(1);

      // Ownership — reserved fields must be zero
      expect(own.workClaim.toBase58()).to.equal(f.workClaim.toBase58());
      expect(own.totalShares).to.equal(100);
      expect(own.thresholdShares).to.equal(100);
      expect(own.admin.toBase58()).to.equal(payer.publicKey.toBase58());
      expect(own.privacyMode).to.equal(0);
      expect(Buffer.from(own.commitmentRoot)).to.deep.equal(Buffer.alloc(32));

      // OwnerRecord
      expect(or.ownership.toBase58()).to.equal(f.ownership.toBase58());
      expect(or.owner.toBase58()).to.equal(payer.publicKey.toBase58());
      expect(or.share).to.equal(100);
      expect(or.role).to.equal(0); // Unspecified; register_work_claim sets 0 by design

      // Root ClaimArtifactLink — previous_link is zero for the root
      expect(link.previousLink.toBase58()).to.equal(PublicKey.default.toBase58());
      expect(link.contentArtifact.toBase58()).to.equal(f.contentArtifact.toBase58());
      expect(link.workClaim.toBase58()).to.equal(f.workClaim.toBase58());

      // AnchorRecord anchors the WorkClaim registration
      expect(ar.anchoredObject.toBase58()).to.equal(f.workClaim.toBase58());
      expect(ar.anchoredObjectKind).to.equal(0); // WorkClaim
      expect(ar.anchorMode).to.equal(1);
      expect(Buffer.from(ar.externalRefHash)).to.deep.equal(Buffer.alloc(32));
    });

    it("latest_link.content_artifact == latest_artifact invariant holds at registration", async () => {
      const f = await registerClaim();
      const wc = await program.account.workClaim.fetch(f.workClaim);
      const link = await program.account.claimArtifactLink.fetch(wc.latestLink);
      expect(link.contentArtifact.toBase58()).to.equal(wc.latestArtifact.toBase58());
    });
  });

  describe("add_version", () => {
    it("advances both heads and sets previous_link to old head", async () => {
      const f = await registerClaim();
      const v = await addVer(f.workClaim, f.claimArtifactLink);

      const wc      = await program.account.workClaim.fetch(f.workClaim);
      const newLink = await program.account.claimArtifactLink.fetch(v.claimArtifactLink);

      expect(wc.latestLink.toBase58()).to.equal(v.claimArtifactLink.toBase58());
      expect(wc.latestArtifact.toBase58()).to.equal(v.contentArtifact.toBase58());
      expect(newLink.previousLink.toBase58()).to.equal(f.claimArtifactLink.toBase58());
    });

    it("latest_link.content_artifact == latest_artifact invariant holds after add_version", async () => {
      const f = await registerClaim();
      await addVer(f.workClaim, f.claimArtifactLink);
      const wc   = await program.account.workClaim.fetch(f.workClaim);
      const link = await program.account.claimArtifactLink.fetch(wc.latestLink);
      expect(link.contentArtifact.toBase58()).to.equal(wc.latestArtifact.toBase58());
    });

    it("chained versions produce a linked list and advance the head twice", async () => {
      const f  = await registerClaim();
      const v1 = await addVer(f.workClaim, f.claimArtifactLink);
      const v2 = await addVer(f.workClaim, v1.claimArtifactLink);

      const wc    = await program.account.workClaim.fetch(f.workClaim);
      const link2 = await program.account.claimArtifactLink.fetch(v2.claimArtifactLink);

      expect(wc.latestLink.toBase58()).to.equal(v2.claimArtifactLink.toBase58());
      expect(wc.latestArtifact.toBase58()).to.equal(v2.contentArtifact.toBase58());
      expect(link2.previousLink.toBase58()).to.equal(v1.claimArtifactLink.toBase58());
    });

    it("reusing the same content hash in a chain succeeds (chain reuse invariant)", async () => {
      const f = await registerClaim();
      // Pass the existing contentArtifact PDA so init_if_needed hits the existing account.
      const v = await addVer(f.workClaim, f.claimArtifactLink, {
        rawHash: f.rawHash,
        contentArtifactPda: f.contentArtifact,
      });
      const wc = await program.account.workClaim.fetch(f.workClaim);
      // latest_artifact still points to the original (shared) contentArtifact
      expect(wc.latestArtifact.toBase58()).to.equal(f.contentArtifact.toBase58());
      expect(wc.latestLink.toBase58()).to.equal(v.claimArtifactLink.toBase58());
    });

    it("AnchorRecord anchors contentArtifact (kind=1), not workClaim", async () => {
      const f  = await registerClaim();
      const v  = await addVer(f.workClaim, f.claimArtifactLink);
      const ar = await program.account.anchorRecord.fetch(v.anchorRecord);
      expect(ar.anchoredObject.toBase58()).to.equal(v.contentArtifact.toBase58());
      expect(ar.anchoredObjectKind).to.equal(1); // ContentArtifact
    });
  });

  describe("content-addressing convergence", () => {
    it("two claimants share one ContentArtifact and get independent WorkClaims", async () => {
      const sharedHash = rh();
      const claimant2  = Keypair.generate();
      await fund(claimant2);

      const fA = await registerClaim({ rawHash: sharedHash });
      const fB = await registerClaim({ rawHash: sharedHash, claimant: claimant2 });

      const ca  = await program.account.contentArtifact.fetch(fA.contentArtifact);
      const wcA = await program.account.workClaim.fetch(fA.workClaim);
      const wcB = await program.account.workClaim.fetch(fB.workClaim);

      // One shared ContentArtifact
      expect(ca.isInitialized).to.be.true;
      expect(Buffer.from(ca.rawHash)).to.deep.equal(sharedHash);

      // Both WorkClaims point at the same rootArtifact
      expect(wcA.rootArtifact.toBase58()).to.equal(fA.contentArtifact.toBase58());
      expect(wcB.rootArtifact.toBase58()).to.equal(fA.contentArtifact.toBase58());

      // Different claimants
      expect(wcA.claimant.toBase58()).to.equal(payer.publicKey.toBase58());
      expect(wcB.claimant.toBase58()).to.equal(claimant2.publicKey.toBase58());

      // Independent latest_link values (different link_nonces)
      expect(wcA.latestLink.toBase58()).to.not.equal(wcB.latestLink.toBase58());
    });
  });

  describe("anchor_evidence_contract", () => {
    it("creates ContractArtifact + EvidenceAnchor + AnchorRecord with correct fields", async () => {
      const f = await registerClaim();
      const rawContractHash = rh();
      const anchorNonce     = rh();
      const contractArtifact = derive([Buffer.from("contract_artifact"), rawContractHash]);
      const evidenceAnchor   = derive([
        Buffer.from("evidence"),
        payer.publicKey.toBuffer(),
        contractArtifact.toBuffer(),
      ]);
      const anchorRecord = derive([
        Buffer.from("anchor"),
        evidenceAnchor.toBuffer(),
        anchorNonce,
      ]);

      // args: rawContractHash, contractKind, anchorNonce, anchorModeArg, assertedWorkClaim
      await program.methods
        .anchorEvidenceContract(ba(rawContractHash), 1, ba(anchorNonce), 1, f.workClaim)
        .accountsStrict({
          registryConfig,
          contractArtifact,
          evidenceAnchor,
          anchorRecord,
          anchorer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const ea = await program.account.evidenceAnchor.fetch(evidenceAnchor);
      const ca = await program.account.contractArtifact.fetch(contractArtifact);
      const ar = await program.account.anchorRecord.fetch(anchorRecord);

      expect(ea.anchorer.toBase58()).to.equal(payer.publicKey.toBase58());
      expect(ea.contractArtifact.toBase58()).to.equal(contractArtifact.toBase58());
      expect(ea.assertedWorkClaim.toBase58()).to.equal(f.workClaim.toBase58());
      expect(ca.isInitialized).to.be.true;
      expect(ar.anchoredObject.toBase58()).to.equal(evidenceAnchor.toBase58());
      expect(ar.anchoredObjectKind).to.equal(2); // EvidenceAnchor
      expect(ar.anchorMode).to.equal(1);
    });

    it("zero pubkey as assertedWorkClaim is accepted (unilateral anchor)", async () => {
      const rawContractHash = rh();
      const anchorNonce     = rh();
      const contractArtifact = derive([Buffer.from("contract_artifact"), rawContractHash]);
      const evidenceAnchor   = derive([
        Buffer.from("evidence"),
        payer.publicKey.toBuffer(),
        contractArtifact.toBuffer(),
      ]);
      const anchorRecord = derive([
        Buffer.from("anchor"),
        evidenceAnchor.toBuffer(),
        anchorNonce,
      ]);

      await program.methods
        .anchorEvidenceContract(ba(rawContractHash), 1, ba(anchorNonce), 1, PublicKey.default)
        .accountsStrict({
          registryConfig,
          contractArtifact,
          evidenceAnchor,
          anchorRecord,
          anchorer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const ea = await program.account.evidenceAnchor.fetch(evidenceAnchor);
      expect(ea.assertedWorkClaim.toBase58()).to.equal(PublicKey.default.toBase58());
    });
  });

  describe("anchor_authorized_contract", () => {
    it("creates AuthorizedContractAnchor + AnchorRecord with correct fields", async () => {
      const f = await registerClaim();
      const rawContractHash = rh();
      const anchorNonce     = rh();
      const contractArtifact = derive([Buffer.from("contract_artifact"), rawContractHash]);
      const authorizedContractAnchor = derive([
        Buffer.from("authorized_contract"),
        f.workClaim.toBuffer(),
        contractArtifact.toBuffer(),
      ]);
      const anchorRecord = derive([
        Buffer.from("anchor"),
        authorizedContractAnchor.toBuffer(),
        anchorNonce,
      ]);

      // args: rawContractHash, contractKind, anchorNonce, anchorModeArg
      await program.methods
        .anchorAuthorizedContract(ba(rawContractHash), 1, ba(anchorNonce), 1)
        .accountsStrict({
          registryConfig,
          workClaim: f.workClaim,
          ownership: f.ownership,
          contractArtifact,
          authorizedContractAnchor,
          anchorRecord,
          admin: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const aca = await program.account.authorizedContractAnchor.fetch(authorizedContractAnchor);
      const ar  = await program.account.anchorRecord.fetch(anchorRecord);

      expect(aca.workClaim.toBase58()).to.equal(f.workClaim.toBase58());
      expect(aca.contractArtifact.toBase58()).to.equal(contractArtifact.toBase58());
      expect(ar.anchoredObject.toBase58()).to.equal(authorizedContractAnchor.toBase58());
      expect(ar.anchoredObjectKind).to.equal(3); // AuthorizedContractAnchor
      expect(ar.anchorMode).to.equal(1);
    });
  });

  describe("add_owner", () => {
    it("creates OwnerRecord and updates Ownership totals", async () => {
      const f        = await registerClaim();
      const newOwner = Keypair.generate();
      const newOwnerRecord = derive([
        Buffer.from("owner"),
        f.ownership.toBuffer(),
        newOwner.publicKey.toBuffer(),
      ]);

      // args: newShare, newRole, newThresholdShares
      await program.methods
        .addOwner(30, 2, 110)
        .accountsStrict({
          registryConfig,
          workClaim: f.workClaim,
          ownership: f.ownership,
          newOwnerRecord,
          admin: payer.publicKey,
          newOwner: newOwner.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const or  = await program.account.ownerRecord.fetch(newOwnerRecord);
      const own = await program.account.ownership.fetch(f.ownership);

      expect(or.owner.toBase58()).to.equal(newOwner.publicKey.toBase58());
      expect(or.share).to.equal(30);
      expect(or.role).to.equal(2);
      expect(own.totalShares).to.equal(130);
      expect(own.thresholdShares).to.equal(110);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ERROR PATHS
  // ═══════════════════════════════════════════════════════════════════════════

  describe("error paths", () => {
    // One shared work claim for tests that only read it (not modify heads or ownership).
    let f: ClaimFixture;
    before(async () => {
      f = await registerClaim();
    });

    // --- anti-fork ────────────────────────────────────────────────────────────

    it("add_version stale expected_previous_link -> StaleLineageHead 6001", async () => {
      const staleLink     = Keypair.generate().publicKey;
      const hash          = rh();
      const linkNonce     = rh();
      const anchorNonce   = rh();
      const contentArtifact   = derive([Buffer.from("content"), hash]);
      const claimArtifactLink = derive([Buffer.from("claim_artifact"), f.workClaim.toBuffer(), linkNonce]);
      const anchorRecord      = derive([Buffer.from("anchor"), contentArtifact.toBuffer(), anchorNonce]);
      try {
        await program.methods
          .addVersion(ba(hash), 1, ba(linkNonce), ba(anchorNonce), 1, staleLink)
          .accountsStrict({
            registryConfig,
            workClaim: f.workClaim,
            contentArtifact,
            claimArtifactLink,
            anchorRecord,
            signer: payer.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("should have thrown");
      } catch (err) {
        expectErr(err, "StaleLineageHead", "6001");
      }
    });

    it("two add_version in one tx with same expected head -> second fails, tx reverts atomically", async () => {
      const f2 = await registerClaim();

      const makeIx = async (expectedPrev: PublicKey) => {
        const hash          = rh();
        const linkNonce     = rh();
        const anchorNonce   = rh();
        const contentArtifact   = derive([Buffer.from("content"), hash]);
        const claimArtifactLink = derive([Buffer.from("claim_artifact"), f2.workClaim.toBuffer(), linkNonce]);
        const anchorRecord      = derive([Buffer.from("anchor"), contentArtifact.toBuffer(), anchorNonce]);
        return program.methods
          .addVersion(ba(hash), 1, ba(linkNonce), ba(anchorNonce), 1, expectedPrev)
          .accountsStrict({
            registryConfig,
            workClaim: f2.workClaim,
            contentArtifact,
            claimArtifactLink,
            anchorRecord,
            signer: payer.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .instruction();
      };

      const [ixA, ixB] = await Promise.all([
        makeIx(f2.claimArtifactLink),
        makeIx(f2.claimArtifactLink), // same expected head -- second instruction stales
      ]);

      try {
        await provider.sendAndConfirm(new Transaction().add(ixA, ixB));
        expect.fail("should have thrown");
      } catch (err) {
        expectErr(err, "StaleLineageHead", "6001", "0x1771");
      }

      // Atomicity: latest_link must be unchanged.
      const wc = await program.account.workClaim.fetch(f2.workClaim);
      expect(wc.latestLink.toBase58()).to.equal(f2.claimArtifactLink.toBase58());
    });

    // --- authorization ────────────────────────────────────────────────────────

    it("wrong claimant calls add_version -> Unauthorized 6009", async () => {
      const attacker      = Keypair.generate();
      await fund(attacker);
      const hash          = rh();
      const linkNonce     = rh();
      const anchorNonce   = rh();
      const contentArtifact   = derive([Buffer.from("content"), hash]);
      const claimArtifactLink = derive([Buffer.from("claim_artifact"), f.workClaim.toBuffer(), linkNonce]);
      const anchorRecord      = derive([Buffer.from("anchor"), contentArtifact.toBuffer(), anchorNonce]);
      try {
        await program.methods
          .addVersion(ba(hash), 1, ba(linkNonce), ba(anchorNonce), 1, f.claimArtifactLink)
          .accountsStrict({
            registryConfig,
            workClaim: f.workClaim,
            contentArtifact,
            claimArtifactLink,
            anchorRecord,
            signer: attacker.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([attacker])
          .rpc();
        expect.fail("should have thrown");
      } catch (err) {
        expectErr(err, "Unauthorized", "6009");
      }
    });

    it("wrong admin calls anchor_authorized_contract -> Unauthorized 6009", async () => {
      const attacker        = Keypair.generate();
      await fund(attacker);
      const rawContractHash = rh();
      const anchorNonce     = rh();
      const contractArtifact = derive([Buffer.from("contract_artifact"), rawContractHash]);
      const authorizedContractAnchor = derive([
        Buffer.from("authorized_contract"),
        f.workClaim.toBuffer(),
        contractArtifact.toBuffer(),
      ]);
      const anchorRecord = derive([
        Buffer.from("anchor"),
        authorizedContractAnchor.toBuffer(),
        anchorNonce,
      ]);
      try {
        await program.methods
          .anchorAuthorizedContract(ba(rawContractHash), 1, ba(anchorNonce), 1)
          .accountsStrict({
            registryConfig,
            workClaim: f.workClaim,
            ownership: f.ownership,
            contractArtifact,
            authorizedContractAnchor,
            anchorRecord,
            admin: attacker.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([attacker])
          .rpc();
        expect.fail("should have thrown");
      } catch (err) {
        expectErr(err, "Unauthorized", "6009");
      }
    });

    // --- enum validation ──────────────────────────────────────────────────────

    it("register_work_claim content_kind=99 -> AnchorModeNotAllowed 6002", async () => {
      const rawHash = rh(); const linkNonce = rh(); const anchorNonce = rh();
      const contentArtifact   = derive([Buffer.from("content"), rawHash]);
      const workClaim         = derive([Buffer.from("claim"), contentArtifact.toBuffer(), payer.publicKey.toBuffer()]);
      const ownership         = derive([Buffer.from("ownership"), workClaim.toBuffer()]);
      const ownerRecord       = derive([Buffer.from("owner"), ownership.toBuffer(), payer.publicKey.toBuffer()]);
      const claimArtifactLink = derive([Buffer.from("claim_artifact"), workClaim.toBuffer(), linkNonce]);
      const anchorRecord      = derive([Buffer.from("anchor"), workClaim.toBuffer(), anchorNonce]);
      try {
        await program.methods
          .registerWorkClaim(ba(rawHash), 99, 1, 100, 100, ba(linkNonce), ba(anchorNonce), 1)
          .accountsStrict({ registryConfig, contentArtifact, workClaim, ownership, ownerRecord, claimArtifactLink, anchorRecord, signer: payer.publicKey, systemProgram: SystemProgram.programId })
          .rpc();
        expect.fail("should have thrown");
      } catch (err) {
        expectErr(err, "AnchorModeNotAllowed", "6002");
      }
    });

    it("register_work_claim claim_kind=99 -> AnchorModeNotAllowed 6002", async () => {
      const rawHash = rh(); const linkNonce = rh(); const anchorNonce = rh();
      const contentArtifact   = derive([Buffer.from("content"), rawHash]);
      const workClaim         = derive([Buffer.from("claim"), contentArtifact.toBuffer(), payer.publicKey.toBuffer()]);
      const ownership         = derive([Buffer.from("ownership"), workClaim.toBuffer()]);
      const ownerRecord       = derive([Buffer.from("owner"), ownership.toBuffer(), payer.publicKey.toBuffer()]);
      const claimArtifactLink = derive([Buffer.from("claim_artifact"), workClaim.toBuffer(), linkNonce]);
      const anchorRecord      = derive([Buffer.from("anchor"), workClaim.toBuffer(), anchorNonce]);
      try {
        await program.methods
          .registerWorkClaim(ba(rawHash), 1, 99, 100, 100, ba(linkNonce), ba(anchorNonce), 1)
          .accountsStrict({ registryConfig, contentArtifact, workClaim, ownership, ownerRecord, claimArtifactLink, anchorRecord, signer: payer.publicKey, systemProgram: SystemProgram.programId })
          .rpc();
        expect.fail("should have thrown");
      } catch (err) {
        expectErr(err, "AnchorModeNotAllowed", "6002");
      }
    });

    it("register_work_claim content_kind=255 (u8 max) -> AnchorModeNotAllowed 6002", async () => {
      const rawHash = rh(); const linkNonce = rh(); const anchorNonce = rh();
      const contentArtifact   = derive([Buffer.from("content"), rawHash]);
      const workClaim         = derive([Buffer.from("claim"), contentArtifact.toBuffer(), payer.publicKey.toBuffer()]);
      const ownership         = derive([Buffer.from("ownership"), workClaim.toBuffer()]);
      const ownerRecord       = derive([Buffer.from("owner"), ownership.toBuffer(), payer.publicKey.toBuffer()]);
      const claimArtifactLink = derive([Buffer.from("claim_artifact"), workClaim.toBuffer(), linkNonce]);
      const anchorRecord      = derive([Buffer.from("anchor"), workClaim.toBuffer(), anchorNonce]);
      try {
        await program.methods
          .registerWorkClaim(ba(rawHash), 255, 1, 100, 100, ba(linkNonce), ba(anchorNonce), 1)
          .accountsStrict({ registryConfig, contentArtifact, workClaim, ownership, ownerRecord, claimArtifactLink, anchorRecord, signer: payer.publicKey, systemProgram: SystemProgram.programId })
          .rpc();
        expect.fail("should have thrown");
      } catch (err) {
        expectErr(err, "AnchorModeNotAllowed", "6002");
      }
    });

    // --- share invariants ─────────────────────────────────────────────────────

    it("register_work_claim total_shares=0 -> ShareSumMismatch 6005", async () => {
      const rawHash = rh(); const linkNonce = rh(); const anchorNonce = rh();
      const contentArtifact   = derive([Buffer.from("content"), rawHash]);
      const workClaim         = derive([Buffer.from("claim"), contentArtifact.toBuffer(), payer.publicKey.toBuffer()]);
      const ownership         = derive([Buffer.from("ownership"), workClaim.toBuffer()]);
      const ownerRecord       = derive([Buffer.from("owner"), ownership.toBuffer(), payer.publicKey.toBuffer()]);
      const claimArtifactLink = derive([Buffer.from("claim_artifact"), workClaim.toBuffer(), linkNonce]);
      const anchorRecord      = derive([Buffer.from("anchor"), workClaim.toBuffer(), anchorNonce]);
      try {
        await program.methods
          .registerWorkClaim(ba(rawHash), 1, 1, 0, 0, ba(linkNonce), ba(anchorNonce), 1)
          .accountsStrict({ registryConfig, contentArtifact, workClaim, ownership, ownerRecord, claimArtifactLink, anchorRecord, signer: payer.publicKey, systemProgram: SystemProgram.programId })
          .rpc();
        expect.fail("should have thrown");
      } catch (err) {
        expectErr(err, "ShareSumMismatch", "6005");
      }
    });

    it("register_work_claim threshold_shares > total_shares -> ShareSumMismatch 6005", async () => {
      const rawHash = rh(); const linkNonce = rh(); const anchorNonce = rh();
      const contentArtifact   = derive([Buffer.from("content"), rawHash]);
      const workClaim         = derive([Buffer.from("claim"), contentArtifact.toBuffer(), payer.publicKey.toBuffer()]);
      const ownership         = derive([Buffer.from("ownership"), workClaim.toBuffer()]);
      const ownerRecord       = derive([Buffer.from("owner"), ownership.toBuffer(), payer.publicKey.toBuffer()]);
      const claimArtifactLink = derive([Buffer.from("claim_artifact"), workClaim.toBuffer(), linkNonce]);
      const anchorRecord      = derive([Buffer.from("anchor"), workClaim.toBuffer(), anchorNonce]);
      try {
        // total=50, threshold=100: threshold > total
        await program.methods
          .registerWorkClaim(ba(rawHash), 1, 1, 50, 100, ba(linkNonce), ba(anchorNonce), 1)
          .accountsStrict({ registryConfig, contentArtifact, workClaim, ownership, ownerRecord, claimArtifactLink, anchorRecord, signer: payer.publicKey, systemProgram: SystemProgram.programId })
          .rpc();
        expect.fail("should have thrown");
      } catch (err) {
        expectErr(err, "ShareSumMismatch", "6005");
      }
    });

    it("add_owner new_share=0 -> ShareSumMismatch 6005", async () => {
      const newOwner       = Keypair.generate();
      const newOwnerRecord = derive([Buffer.from("owner"), f.ownership.toBuffer(), newOwner.publicKey.toBuffer()]);
      try {
        await program.methods
          .addOwner(0, 1, 100)
          .accountsStrict({
            registryConfig,
            workClaim: f.workClaim,
            ownership: f.ownership,
            newOwnerRecord,
            admin: payer.publicKey,
            newOwner: newOwner.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("should have thrown");
      } catch (err) {
        expectErr(err, "ShareSumMismatch", "6005");
      }
    });

    it("add_owner new_threshold_shares=0 -> ShareSumMismatch 6005", async () => {
      const newOwner       = Keypair.generate();
      const newOwnerRecord = derive([Buffer.from("owner"), f.ownership.toBuffer(), newOwner.publicKey.toBuffer()]);
      try {
        await program.methods
          .addOwner(10, 1, 0)
          .accountsStrict({
            registryConfig,
            workClaim: f.workClaim,
            ownership: f.ownership,
            newOwnerRecord,
            admin: payer.publicKey,
            newOwner: newOwner.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("should have thrown");
      } catch (err) {
        expectErr(err, "ShareSumMismatch", "6005");
      }
    });

    it("add_owner new_threshold_shares > new_total -> ShareSumMismatch 6005", async () => {
      const newOwner       = Keypair.generate();
      const newOwnerRecord = derive([Buffer.from("owner"), f.ownership.toBuffer(), newOwner.publicKey.toBuffer()]);
      try {
        // existing total=100, new_share=10, new_total=110, threshold=200 > 110
        await program.methods
          .addOwner(10, 1, 200)
          .accountsStrict({
            registryConfig,
            workClaim: f.workClaim,
            ownership: f.ownership,
            newOwnerRecord,
            admin: payer.publicKey,
            newOwner: newOwner.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("should have thrown");
      } catch (err) {
        expectErr(err, "ShareSumMismatch", "6005");
      }
    });

    // --- PDA collision / already-initialized ──────────────────────────────────

    it("add_owner duplicate pubkey -> account already in use", async () => {
      const f2             = await registerClaim();
      const newOwner       = Keypair.generate();
      const newOwnerRecord = derive([Buffer.from("owner"), f2.ownership.toBuffer(), newOwner.publicKey.toBuffer()]);

      // First add succeeds.
      await program.methods
        .addOwner(10, 1, 100)
        .accountsStrict({
          registryConfig,
          workClaim: f2.workClaim,
          ownership: f2.ownership,
          newOwnerRecord,
          admin: payer.publicKey,
          newOwner: newOwner.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Second add with same pubkey fails at Anchor init.
      try {
        await program.methods
          .addOwner(10, 1, 110)
          .accountsStrict({
            registryConfig,
            workClaim: f2.workClaim,
            ownership: f2.ownership,
            newOwnerRecord,
            admin: payer.publicKey,
            newOwner: newOwner.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("should have thrown");
      } catch (err) {
        expectErr(err, "already in use", "0x0");
      }
    });

    it("anchor_evidence_contract replay (same anchorer + contract) -> already in use", async () => {
      const rawContractHash = rh();
      const anchorNonce     = rh();
      const contractArtifact = derive([Buffer.from("contract_artifact"), rawContractHash]);
      const evidenceAnchor   = derive([
        Buffer.from("evidence"),
        payer.publicKey.toBuffer(),
        contractArtifact.toBuffer(),
      ]);
      const anchorRecord = derive([
        Buffer.from("anchor"),
        evidenceAnchor.toBuffer(),
        anchorNonce,
      ]);

      await program.methods
        .anchorEvidenceContract(ba(rawContractHash), 1, ba(anchorNonce), 1, f.workClaim)
        .accountsStrict({
          registryConfig,
          contractArtifact,
          evidenceAnchor,
          anchorRecord,
          anchorer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      try {
        await program.methods
          .anchorEvidenceContract(ba(rawContractHash), 1, ba(anchorNonce), 1, f.workClaim)
          .accountsStrict({
            registryConfig,
            contractArtifact,
            evidenceAnchor,
            anchorRecord,
            anchorer: payer.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("should have thrown");
      } catch (err) {
        expectErr(err, "already in use", "0x0");
      }
    });

    it("anchor_authorized_contract PDA collision (same workClaim + contract) -> already in use", async () => {
      const f2              = await registerClaim();
      const rawContractHash = rh();
      const anchorNonce     = rh();
      const contractArtifact = derive([Buffer.from("contract_artifact"), rawContractHash]);
      const authorizedContractAnchor = derive([
        Buffer.from("authorized_contract"),
        f2.workClaim.toBuffer(),
        contractArtifact.toBuffer(),
      ]);
      const anchorRecord1 = derive([
        Buffer.from("anchor"),
        authorizedContractAnchor.toBuffer(),
        anchorNonce,
      ]);

      await program.methods
        .anchorAuthorizedContract(ba(rawContractHash), 1, ba(anchorNonce), 1)
        .accountsStrict({
          registryConfig,
          workClaim: f2.workClaim,
          ownership: f2.ownership,
          contractArtifact,
          authorizedContractAnchor,
          anchorRecord: anchorRecord1,
          admin: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      try {
        const anchorNonce2  = rh();
        const anchorRecord2 = derive([
          Buffer.from("anchor"),
          authorizedContractAnchor.toBuffer(),
          anchorNonce2,
        ]);
        await program.methods
          .anchorAuthorizedContract(ba(rawContractHash), 1, ba(anchorNonce2), 1)
          .accountsStrict({
            registryConfig,
            workClaim: f2.workClaim,
            ownership: f2.ownership,
            contractArtifact,
            authorizedContractAnchor,
            anchorRecord: anchorRecord2,
            admin: payer.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("should have thrown");
      } catch (err) {
        expectErr(err, "already in use", "0x0");
      }
    });

    it("init_registry_config second call -> already in use", async () => {
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
        expect.fail("should have thrown");
      } catch (err) {
        expectErr(err, "already in use", "0x0");
      }
    });
  });
});
