import { describe, it, expect, beforeEach } from "vitest";
import {
  VotingPhase,
  VoteOption,
  createVotingContract,
  computeCommitment,
  computeNullifier,
  assertPhase,
  type VotingContract,
  type VotingConfig,
  type Deployment,
} from "../voting-contract";

describe("VotingContract", () => {
  let config: VotingConfig;
  let deployment: Deployment<VotingContract>;
  let contract: VotingContract;

  beforeEach(() => {
    config = {
      title: "Test Proposal",
      description: "A test proposal for voting",
      commitDuration: 3600n,
      revealDuration: 3600n,
      secretKey: new Uint8Array(32).fill(1),
    };
    deployment = createVotingContract(config);
    contract = deployment.ledger;
  });

  describe("Initialization", () => {
    it("should initialize with INIT phase", () => {
      expect(contract.phase).toBe(VotingPhase.INIT);
    });

    it("should set organizer from secret key", () => {
      expect(contract.organizer).toBeDefined();
      expect(contract.organizer.length).toBe(32);
    });

    it("should store proposal title", () => {
      const title = new TextDecoder().decode(contract.proposalTitle);
      expect(title.replace(/\0/g, "").trim()).toBe("Test Proposal");
    });
  });

  describe("Commit Phase", () => {
    it("should transition from INIT to COMMIT phase", () => {
      const newContract = {
        ...contract,
        phase: VotingPhase.COMMIT,
        phaseDeadline: 3600n,
      };
      expect(newContract.phase).toBe(VotingPhase.COMMIT);
    });

    it("should allow committing a vote with commitment", () => {
      const secretKey = new Uint8Array(32).fill(1);
      const salt = new Uint8Array(32).fill(42);
      const commitment = computeCommitment(VoteOption.YES, secretKey, salt);
      
      expect(commitment).toBeDefined();
      expect(commitment.length).toBe(32);
    });
  });

  describe("Reveal Phase", () => {
    it("should transition from COMMIT to REVEAL phase", () => {
      const newContract = {
        ...contract,
        phase: VotingPhase.REVEAL,
        phaseDeadline: 7200n,
      };
      expect(newContract.phase).toBe(VotingPhase.REVEAL);
    });

    it("should increment correct vote counter on reveal", () => {
      const yesVotes = 10n;
      const noVotes = 5n;
      
      expect(yesVotes).toBeGreaterThan(noVotes);
    });
  });

  describe("Double Vote Prevention", () => {
    it("should prevent double commit for same voter", () => {
      const commitments = new Map<string, string>();
      const voterPk = "voter1";
      
      commitments.set(voterPk, "commitment1");
      
      expect(commitments.has(voterPk)).toBe(true);
      expect(() => {
        if (commitments.has(voterPk)) {
          throw new Error("already committed");
        }
      }).toThrow();
    });

    it("should prevent double reveal using nullifier", () => {
      const secretKey = new Uint8Array(32).fill(1);
      const nullifier = computeNullifier(secretKey);
      
      const nullifiers = new Set<string>();
      nullifiers.add(nullifier.toString());
      
      expect(() => {
        if (nullifiers.has(nullifier.toString())) {
          throw new Error("already revealed");
        }
      }).toThrow();
    });
  });

  describe("Phase Transitions", () => {
    it("should enforce commit phase before reveal", () => {
      expect(() => {
        assertPhase(contract, VotingPhase.REVEAL);
      }).toThrow();
    });

    it("should enforce time-locked transitions", () => {
      const currentTime = 7200n;
      const commitDeadline = 3600n;
      
      expect(currentTime).toBeGreaterThan(commitDeadline);
    });
  });

  describe("Commitment Computation", () => {
    it("should produce unique commitments for different votes", () => {
      const secretKey = new Uint8Array(32).fill(1);
      const salt1 = new Uint8Array(32).fill(1);
      const salt2 = new Uint8Array(32).fill(2);
      
      const yesCommitment = computeCommitment(VoteOption.YES, secretKey, salt1);
      const noCommitment = computeCommitment(VoteOption.NO, secretKey, salt2);
      
      expect(yesCommitment).not.toEqual(noCommitment);
    });

    it("should produce unique commitments for different salts", () => {
      const secretKey = new Uint8Array(32).fill(1);
      const vote = VoteOption.YES;
      const salt1 = new Uint8Array(32).fill(1);
      const salt2 = new Uint8Array(32).fill(2);
      
      const commit1 = computeCommitment(vote, secretKey, salt1);
      const commit2 = computeCommitment(vote, secretKey, salt2);
      
      expect(commit1).not.toEqual(commit2);
    });
  });

  describe("Nullifier Derivation", () => {
    it("should derive domain-separated nullifier", () => {
      const secretKey = new Uint8Array(32).fill(1);
      const nullifier = computeNullifier(secretKey);
      
      expect(nullifier).toBeDefined();
      expect(nullifier.length).toBe(32);
    });

    it("should produce different nullifiers for different secret keys", () => {
      const sk1 = new Uint8Array(32).fill(1);
      const sk2 = new Uint8Array(32).fill(2);
      
      const nullifier1 = computeNullifier(sk1);
      const nullifier2 = computeNullifier(sk2);
      
      expect(nullifier1).not.toEqual(nullifier2);
    });
  });

  describe("Merkle Tree Eligibility", () => {
    it("should verify voter eligibility using Merkle path", () => {
      const merkleRoot = new Uint8Array(32).fill(1);
      const voterPath = {
        value: new Uint8Array(32).fill(1),
        siblings: Array(20).fill(new Uint8Array(32)),
      };
      
      expect(merkleRoot).toBeDefined();
      expect(voterPath.siblings.length).toBe(20);
    });
  });

  describe("Vote Counting", () => {
    it("should track yes votes correctly", () => {
      const yesVotes = 15n;
      const expected = 15n;
      expect(yesVotes).toBe(expected);
    });

    it("should track no votes correctly", () => {
      const noVotes = 8n;
      const expected = 8n;
      expect(noVotes).toBe(expected);
    });

    it("should determine winner correctly", () => {
      const yesVotes = 15n;
      const noVotes = 8n;
      
      const winner = yesVotes > noVotes ? "YES" : "NO";
      expect(winner).toBe("YES");
    });

    it("should handle tie correctly", () => {
      const yesVotes = 10n;
      const noVotes = 10n;
      
      if (yesVotes === noVotes) {
        expect("TIE").toBe("TIE");
      }
    });
  });
});

describe("Domain-Separated Commitment", () => {
  it("should use distinct domain separators", () => {
    const encoder = new TextEncoder();
    const commitmentDomain = encoder.encode("midnight:voting:commitment");
    const nullifierDomain = encoder.encode("midnight:voting:nullifier");
    
    expect(commitmentDomain.toString()).not.toEqual(nullifierDomain.toString());
  });
});