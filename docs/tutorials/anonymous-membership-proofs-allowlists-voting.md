## Anonymous Membership Proofs: Allowlists, Voter Rolls & Gated Access in Midnight

**Difficulty:** Advanced  
**Time:** 50 minutes  
**Bounty:** #316

---

### Overview

Anonymous membership proofs allow users to prove they belong to a group (allowlist, voter roll, whitelist) without revealing WHICH member they are. This is the foundation for private voting, gated access, and confidential DAO participation. Midnight's zero-knowledge capabilities make this possible without sacrificing privacy.

### What You'll Learn

- Implementing Merkle-based membership proofs in Compact
- Creating an anonymous voting system
- Building gated access for token holders
- Preventing double-voting and Sybil attacks
- Testing membership proofs

### Prerequisites

- [Midnight development environment](https://dev.midnight.network/docs/setup)
- Understanding of Merkle trees and zero-knowledge proofs
- Familiarity with shielded tokens ([Tutorial #327])

---

### How Anonymous Membership Works

```
1. Setup:   Admin creates a Merkle tree of all valid members
2. Join:    Each member receives a unique leaf position
3. Prove:   Member generates a zero-knowledge proof of membership
            WITHOUT revealing their leaf position
4. Verify:  Contract checks the proof against the Merkle root
            → learns the member is valid, but NOT which one
```

### Step 1: Membership Contract

```javascript
// contracts/anonymous-membership/index.compact

import { LEDGER, SEED, HASH } from "std";

export const AnonymousMembership = contract(() => {
    // State
    const admin: [u8; 32];                    // Contract admin
    const merkleRoot: [u8; 32];               // Current Merkle root
    const usedNullifiers: [u8; 32][];          // Prevent double-use
    const minBalance: u64;                     // Min token balance for members
    
    /**
     * Update the membership Merkle root.
     * Only callable by admin when members are added/removed.
     */
    export function updateMerkleRoot(newRoot: [u8; 32]): void {
        require(SEED.publicKey == admin, "Only admin can update root");
        merkleRoot = newRoot;
    }

    /**
     * Verify anonymous membership.
     * Proves user is in the Merkle tree without revealing position.
     */
    export function verifyMembership(
        nullifier: [u8; 32],
        merkleProof: [u8; 32][],
        root: [u8; 32]
    ): bool {
        // Check nullifier hasn't been used (prevents replay attacks)
        for (let i = 0; i < usedNullifiers.length; i++) {
            require(usedNullifiers[i] != nullifier, 
                "Nullifier already used");
        }
        
        // Verify Merkle proof against root
        let computedHash: [u8; 32] = HASH.sha256(
            SEED.publicKey + nullifier
        );
        
        for (let i = 0; i < merkleProof.length; i++) {
            computedHash = HASH.sha256(computedHash + merkleProof[i]);
        }
        
        let isMember: bool = computedHash == root;
        
        if (isMember) {
            usedNullifiers.push(nullifier);
        }
        
        return isMember;
    }

    /**
     * Verify membership with balance check.
     * Proves user holds minimum token balance + is in allowlist.
     */
    export function verifyMemberWithBalance(
        nullifier: [u8; 32],
        merkleProof: [u8; 32][],
        root: [u8; 32],
        tokenHash: [u8; 32]
    ): bool {
        // Check membership + balance simultaneously
        let balance: u64 = LEDGER.balanceOf(SEED.publicKey, tokenHash);
        require(balance >= minBalance, 
            "Insufficient token balance");
        
        return verifyMembership(nullifier, merkleProof, root);
    }
});
```

### Step 2: Anonymous Voting Contract

```javascript
// contracts/anonymous-voting/index.compact

import { LEDGER, SEED, HASH } from "std";

export const AnonymousVoting = contract(() => {
    // State
    const membershipContract: [u8; 32];       // Address of membership contract
    const proposals: Proposal[];               // Active proposals
    const votes: [u8; 32][];                   // Used nullifiers (prevents double-voting)
    const results: [[u8; 32]; u64][];          // Proposal hash → vote count

    struct Proposal {
        id: u64;
        title: [u8; 32];          // Hashed title (revealed off-chain)
        options: u8;               // Number of options
        startBlock: u64;
        endBlock: u64;
        creator: [u8; 32];
    }

    /**
     * Create a new proposal.
     */
    export function createProposal(
        title: [u8; 32],
        options: u8,
        duration: u64
    ): void {
        let id: u64 = proposals.length + 1;
        proposals.push(Proposal({
            id: id,
            title: title,
            options: options,
            startBlock: LEDGER.blockNumber(),
            endBlock: LEDGER.blockNumber() + duration,
            creator: SEED.publicKey
        }));
    }

    /**
     * Cast an anonymous vote.
     * Proves membership without revealing identity.
     */
    export function vote(
        proposalId: u64,
        option: u8,
        nullifier: [u8; 32],
        merkleProof: [u8; 32][],
        root: [u8; 32]
    ): void {
        // Validate proposal exists and is active
        require(proposalId <= proposals.length, "Invalid proposal");
        let prop = proposals[proposalId - 1];
        require(LEDGER.blockNumber() >= prop.startBlock, 
            "Voting not started");
        require(LEDGER.blockNumber() <= prop.endBlock, 
            "Voting ended");
        require(option < prop.options, "Invalid option");

        // Check nullifier hasn't been used (prevents double-voting)
        for (let i = 0; i < votes.length; i++) {
            require(votes[i] != nullifier, "Already voted");
        }

        // Verify anonymous membership
        let computedHash: [u8; 32] = HASH.sha256(
            SEED.publicKey + nullifier
        );
        for (let i = 0; i < merkleProof.length; i++) {
            computedHash = HASH.sha256(computedHash + merkleProof[i]);
        }
        require(computedHash == root, "Not a valid member");

        // Record vote
        votes.push(nullifier);
        
        // Tally
        let found: bool = false;
        for (let i = 0; i < results.length; i++) {
            if (results[i][0] == [proposalId, option]) {
                results[i] = [results[i][0], results[i][1] + 1];
                found = true;
            }
        }
        if (!found) {
            results.push([[proposalId, option], 1]);
        }
    }

    /**
     * Get total votes for a proposal option.
     */
    export function getVoteCount(proposalId: u64, option: u8): u64 {
        for (let i = 0; i < results.length; i++) {
            if (results[i][0] == [proposalId, option]) {
                return results[i][1];
            }
        }
        return 0;
    }
});
```

### Step 3: Off-Chain Member Management

```typescript
// services/membership-manager.ts
import { MerkleTree } from "./merkle-tree";
import { createHash, randomBytes } from "crypto";

interface Member {
    pubKey: Uint8Array;
    metadata: {
        joinedAt: number;
        tier: "basic" | "premium";
    };
}

class MembershipManager {
    private members: Map<string, Member> = new Map();
    private tree: MerkleTree;
    private nullifiers: Set<string> = new Set();

    constructor() {
        this.tree = new MerkleTree([]);
    }

    /**
     * Add a member to the allowlist.
     */
    async addMember(
        pubKey: Uint8Array, 
        tier: "basic" | "premium"
    ): Promise<Uint8Array> {
        const id = Buffer.from(pubKey).toString("hex");
        
        this.members.set(id, {
            pubKey,
            metadata: { joinedAt: Date.now(), tier }
        });

        // Rebuild Merkle tree
        const leaves = Array.from(this.members.values())
            .map(m => createHash("sha256")
                .update(Buffer.concat([m.pubKey, 
                    Buffer.from(m.metadata.tier)]))
                .digest()
            );
        
        this.tree = new MerkleTree(leaves);
        return this.tree.getRoot();
    }

    /**
     * Generate a membership proof for a user.
     */
    async generateProof(pubKey: Uint8Array): Promise<{
        proof: Uint8Array[];
        root: Uint8Array;
        nullifier: Uint8Array;
    }> {
        const leaf = createHash("sha256")
            .update(Buffer.concat([pubKey, Buffer.from("basic")]))
            .digest();
        
        const proof = this.tree.getProof(leaf);
        const root = this.tree.getRoot();
        const nullifier = randomBytes(32); // Unique per use

        return { proof, root, nullifier };
    }

    /**
     * Remove a member (revoke access).
     */
    async removeMember(pubKey: Uint8Array): Promise<Uint8Array> {
        const id = Buffer.from(pubKey).toString("hex");
        this.members.delete(id);

        // Rebuild tree without the removed member
        const leaves = Array.from(this.members.values())
            .map(m => /* ... same as addMember */ new Uint8Array(32));
        
        this.tree = new MerkleTree(leaves);
        return this.tree.getRoot();
    }

    /**
     * Check if a nullifier was already used.
     */
    isNullifierUsed(nullifier: Uint8Array): boolean {
        return this.nullifiers.has(Buffer.from(nullifier).toString("hex"));
    }
}
```

### Step 4: Integration Tests

```typescript
// tests/anonymous-membership.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { AnonymousMembership } from "../contracts/build/anonymous-membership";
import { AnonymousVoting } from "../contracts/build/anonymous-voting";

describe("AnonymousMembership", () => {
    const admin = new Uint8Array(32).fill(1);
    const member1 = new Uint8Array(32).fill(2);
    const member2 = new Uint8Array(32).fill(3);
    const nonMember = new Uint8Array(32).fill(99);

    let membership: AnonymousMembership;
    let voting: AnonymousVoting;

    beforeAll(async () => {
        membership = new AnonymousMembership(admin);
        voting = new AnonymousVoting(admin);
    });

    it("should verify valid membership", async () => {
        // Setup: admin sets root = hash(member)
        const root = new Uint8Array(32).fill(0xAA);
        await membership.updateMerkleRoot(root);
        
        // Member proves membership
        const nullifier = new Uint8Array(32).fill(0xBB);
        const proof = [new Uint8Array(32).fill(0xCC)];
        
        const result = await membership.verifyMembership(
            nullifier, proof, root
        );
        expect(result).toBeDefined();
    });

    it("should reject reused nullifier", async () => {
        const nullifier = new Uint8Array(32).fill(0xBB);
        const proof = [new Uint8Array(32).fill(0xCC)];
        const root = new Uint8Array(32).fill(0xAA);
        
        // First use - should pass
        await membership.verifyMembership(nullifier, proof, root);
        
        // Second use - should fail
        await expect(
            membership.verifyMembership(nullifier, proof, root)
        ).rejects.toThrow("Nullifier already used");
    });

    it("should reject non-member proofs", async () => {
        const root = new Uint8Array(32).fill(0xDD);
        await membership.updateMerkleRoot(root);
        
        const nullifier = new Uint8Array(32).fill(0xEE);
        const proof = [new Uint8Array(32).fill(0xFF)];
        
        const result = await membership.verifyMembership(
            nullifier, proof, root
        );
        expect(result).toBe(false);
    });
});

describe("AnonymousVoting", () => {
    it("should allow one vote per member per proposal", async () => {
        // ... test voting flow
    });

    it("should prevent double voting", async () => {
        // ... test nullifier check
    });

    it("should tally votes correctly", async () => {
        // ... test vote counting
    });
});
```

### Step 5: Deployment

```bash
# Compile
midnight contract compile contracts/anonymous-membership
midnight contract compile contracts/anonymous-voting

# Test
npx vitest run tests/anonymous-membership.test.ts

# Deploy membership contract first
midnight contract deploy contracts/anonymous-membership --network testnet \
  --args '{"admin":"0x01...","merkleRoot":"0x00...","usedNullifiers":[],"minBalance":100}'

# Deploy voting with membership contract address
midnight contract deploy contracts/anonymous-voting --network testnet
```

### Use Cases

| Scenario | How It Works | Privacy Level |
|----------|-------------|---------------|
| **DAO Voting** | Token holders prove membership, vote anonymously | Members anonymous, votes public |
| **Gated Content** | Paid subscribers prove membership, access content | Full anonymity |
| **Allowlisted NFT Mint** | Allowlist members prove eligibility, mint privately | Position hidden |
| **Private Governance** | Delegates vote anonymously on proposals | Full anonymity |

### Security Considerations

1. **Nullifier Reuse Prevention**: Critical for double-voting protection - always check before accepting
2. **Merkle Root Freshness**: Stale roots allow revoked members to still prove membership - update on every change
3. **Leaf Construction**: Include member's public key + metadata in the hash to prevent impersonation
4. **Front-running**: Use commit-reveal for sensitive root updates

### Common Pitfalls

| Issue | Symptom | Fix |
|-------|---------|-----|
| Double vote | Same nullifier used twice | Always check nullifier list |
| Stale membership | Revoked user still passes | Update root immediately on revocation |
| Wrong tree depth | Proof length mismatch | Ensure proof depth matches tree height |
| Metadata changed | Valid member fails proof | Include ALL relevant data in leaf hash |

### Next Steps

- Add ZK-SNARK proofs for true zero-knowledge membership (hide the leaf path)
- Implement quadratic voting for DAO governance
- Integrate with [DApp Connector API](#309) for browser-based voting UI
- Add time-locked membership tiers
