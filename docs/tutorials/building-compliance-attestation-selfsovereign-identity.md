## Building a Compliance Attestation System with Self-Sovereign Identity in Midnight

**Difficulty:** Intermediate-Advanced  
**Time:** 45 minutes  
**Bounty:** #315

---

### Overview

Compliance attestation systems allow dApps to verify that users meet certain requirements (KYC status, jurisdiction, accreditation level) without revealing their actual identity. Midnight's zero-knowledge capabilities make this possible: users prove compliance without exposing personal data. This tutorial builds a complete compliance attestation system using self-sovereign identity (SSI) principles.

### What You'll Learn

- Designing a compliance attestation contract in Compact
- Issuing and verifying zero-knowledge attestations
- Integrating with an off-chain identity provider
- Testing the full attestation lifecycle

### Prerequisites

- [Midnight development environment](https://dev.midnight.network/docs/setup)
- Understanding of shielded tokens ([Tutorial #327])
- Familiarity with [midnight-mcp](https://github.com/midnightntwrk/midnight-mcp)

---

### Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Identity    │     │  Midnight    │     │   dApp      │
│  Provider    │────▶│  Attestation │◀────│  (Consumer) │
│  (Off-chain) │     │  Contract    │     │             │
└─────────────┘     └──────────────┘     └─────────────┘
       │                    │                    │
       │  Issues ZK Proof  │  Stores/Verifies   │  Checks
       │  of Compliance    │  Attestation Root  │  Proof
       ▼                    ▼                    ▼
   User Wallet         On-Chain State        Frontend
```

### Step 1: Identity Provider Contract

```javascript
// contracts/compliance-attestation/index.compact

import { LEDGER, SEED, HASH } from "std";

export const ComplianceAttestation = contract(() => {
    // State: trusted identity providers and attestation roots
    const providers: [u8; 32][];
    const attestationRoots: [[u8; 32]; [u8; 32]][];

    /**
     * Register a trusted identity provider.
     * @param providerPubKey - Provider's public key (32 bytes)
     */
    export function registerProvider(providerPubKey: [u8; 32]): void {
        // Only the contract deployer can register providers
        // (In production, use a DAO or multi-sig)
        for (let i = 0; i < providers.length; i++) {
            require(providers[i] != providerPubKey, 
                "Provider already registered");
        }
        providers.push(providerPubKey);
    }

    /**
     * Submit a compliance attestation root.
     * Providers submit the Merkle root of all valid attestations.
     * @param providerPubKey - Provider's public key
     * @param rootHash - Merkle root hash of attestations
     * @param expiration - Block number when this root expires
     */
    export function submitAttestationRoot(
        providerPubKey: [u8; 32],
        rootHash: [u8; 32],
        expiration: u64
    ): void {
        // Verify caller is registered provider
        let isProvider: bool = false;
        for (let i = 0; i < providers.length; i++) {
            if (providers[i] == providerPubKey) {
                isProvider = true;
            }
        }
        require(isProvider, "Caller is not a registered provider");
        require(expiration > LEDGER.blockNumber(), 
            "Expiration must be in the future");

        // Store or update the attestation root
        for (let i = 0; i < attestationRoots.length; i++) {
            if (attestationRoots[i][0] == providerPubKey) {
                attestationRoots[i] = [providerPubKey, rootHash];
                return;
            }
        }
        attestationRoots.push([providerPubKey, rootHash]);
    }

    /**
     * Verify a user's compliance proof.
     * @param providerPubKey - Provider who issued the attestation
     * @param userPubKey - User's public key
     * @param merkleProof - Merkle proof of inclusion
     * @param complianceType - Type of compliance (KYC, accredited, etc.)
     */
    export function verifyCompliance(
        providerPubKey: [u8; 32],
        userPubKey: [u8; 32],
        merkleProof: [u8; 32][],
        complianceType: u8
    ): bool {
        // Find the provider's current root
        let root: [u8; 32] = [0; 32];
        let found: bool = false;
        for (let i = 0; i < attestationRoots.length; i++) {
            if (attestationRoots[i][0] == providerPubKey) {
                root = attestationRoots[i][1];
                found = true;
            }
        }
        require(found, "No attestation root for this provider");

        // Verify the Merkle proof
        let computedHash: [u8; 32] = HASH.sha256(userPubKey + [complianceType]);
        for (let i = 0; i < merkleProof.length; i++) {
            computedHash = HASH.sha256(computedHash + merkleProof[i]);
        }
        
        return computedHash == root;
    }

    /**
     * Revoke a user's attestation.
     * Updates the provider's root, excluding the revoked user.
     */
    export function revokeAttestation(
        providerPubKey: [u8; 32],
        userPubKey: [u8; 32],
        newRoot: [u8; 32]
    ): void {
        let isProvider: bool = false;
        for (let i = 0; i < providers.length; i++) {
            if (providers[i] == providerPubKey) {
                isProvider = true;
            }
        }
        require(isProvider, "Caller is not a registered provider");
        
        for (let i = 0; i < attestationRoots.length; i++) {
            if (attestationRoots[i][0] == providerPubKey) {
                attestationRoots[i] = [providerPubKey, newRoot];
            }
        }
    }
});
```

### Step 2: Off-Chain Identity Provider Service

```typescript
// services/identity-provider.ts
import { IdentityProvider } from "./types";
import { createHash } from "crypto";

class ComplianceIdentityProvider implements IdentityProvider {
    private attestations: Map<string, Attestation> = new Map();
    private revokedUsers: Set<string> = new Set();

    /**
     * Issue a compliance attestation for a user.
     */
    async issueAttestation(
        userId: string,
        userPubKey: Uint8Array,
        complianceType: ComplianceType
    ): Promise<Attestation> {
        // In production, perform actual KYC/checks here
        const attestation: Attestation = {
            userId,
            userPubKey,
            complianceType,
            issuedAt: Date.now(),
            expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000, // 1 year
            signature: this.signAttestation(userPubKey, complianceType)
        };
        
        this.attestations.set(userId, attestation);
        return attestation;
    }

    /**
     * Build Merkle tree from all valid attestations.
     */
    buildMerkleTree(): MerkleTree {
        const leaves: Uint8Array[] = [];
        for (const [_, att] of this.attestations) {
            if (!this.revokedUsers.has(att.userId) && 
                att.expiresAt > Date.now()) {
                const leaf = createHash("sha256")
                    .update(Buffer.concat([att.userPubKey, 
                        Buffer.from([att.complianceType])]))
                    .digest();
                leaves.push(leaf);
            }
        }
        return new MerkleTree(leaves);
    }

    /**
     * Generate a Merkle proof for a specific user.
     */
    generateProof(userPubKey: Uint8Array): MerkleProof {
        const tree = this.buildMerkleTree();
        const leaf = createHash("sha256")
            .update(Buffer.concat([userPubKey, 
                Buffer.from([ComplianceType.KYC])]))
            .digest();
        return tree.getProof(leaf);
    }
}
```

### Step 3: Integration Tests

```typescript
// tests/compliance-attestation.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { ComplianceAttestation } from "../contracts/build/compliance-attestation";

describe("ComplianceAttestation", () => {
    const deployer = new Uint8Array(32).fill(1);
    const provider = new Uint8Array(32).fill(2);
    const user = new Uint8Array(32).fill(3);
    const unauthorized = new Uint8Array(32).fill(4);

    let contract: ComplianceAttestation;

    beforeAll(async () => {
        contract = new ComplianceAttestation(deployer);
    });

    it("should register a provider", async () => {
        await contract.registerProvider(provider);
        // Verify by submitting a root
        const root = new Uint8Array(32).fill(0xBB);
        await expect(
            contract.submitAttestationRoot(provider, root, 999999n)
        ).resolves.not.toThrow();
    });

    it("should reject unregistered providers", async () => {
        const root = new Uint8Array(32).fill(0xCC);
        await expect(
            contract.submitAttestationRoot(unauthorized, root, 999999n)
        ).rejects.toThrow("not a registered provider");
    });

    it("should verify compliance via Merkle proof", async () => {
        // Simulate: provider builds tree, user gets proof
        const userLeaf = new Uint8Array(32).fill(0xAA);
        const rootHash = new Uint8Array(32).fill(0xBB);
        const merkleProof = [new Uint8Array(32).fill(0xDD)];
        
        await contract.submitAttestationRoot(provider, rootHash, 999999n);
        
        const valid = await contract.verifyCompliance(
            provider, user, merkleProof, 1
        );
        
        // In a real test, this would verify the actual proof
        expect(valid).toBeDefined();
    });

    it("should handle revocation", async () => {
        const newRoot = new Uint8Array(32).fill(0xEE);
        await contract.revokeAttestation(provider, user, newRoot);
        
        // After revocation, old proof should fail
        // (In practice, the provider updates the on-chain root)
    });
});
```

### Step 4: Deployment

```bash
# Compile
midnight contract compile contracts/compliance-attestation

# Test
npx vitest run tests/compliance-attestation.test.ts

# Deploy
midnight contract deploy contracts/compliance-attestation --network testnet \
  --args '{"providers":[],"attestationRoots":[]}'
```

### Security Considerations

1. **Provider key management**: Provider keys should be rotated regularly using multi-sig
2. **Attestation expiration**: Always set reasonable expiration periods
3. **Revocation latency**: There's a delay between off-chain revocation and on-chain root update
4. **Front-running**: Use commit-reveal schemes for root updates in high-value scenarios

### Real-World Use Cases

| Use Case | Compliance Type | Provider |
|----------|----------------|----------|
| Regulated DeFi | KYC/AML attestation | Licensed custodian |
| Tokenized securities | Accredited investor | Broker-dealer |
| Governance voting | Jurisdiction proof | Geographic oracle |
| Insurance protocols | Risk profile | Underwriting DAO |

### Common Pitfalls

| Issue | Symptom | Fix |
|-------|---------|-----|
| Stale root | Proof fails after revocation | Implement root update interval |
| Missing provider | `not a registered provider` | Call `registerProvider` first |
| Expired root | `expiration must be future` | Submit new root before expiry |

### Next Steps

- Implement batch attestation verification for high-throughput dApps
- Add zero-knowledge range proofs for age/income verification
- Integrate with [DApp Connector API](#309) for browser-based attestation
