# Verifying Asset Ownership via Token Gates

## Introduction

Token gates are a powerful primitive in the Web3 ecosystem that allow developers and content creators to restrict access to digital resources based on verifiable on-chain asset ownership. Rather than relying on traditional username/password authentication or centralized access control lists, token gates leverage the transparency and immutability of blockchain networks to determine whether a given wallet address holds the required tokens — fungible or non-fungible — before granting access to protected content, communities, features, or experiences.

This tutorial provides a comprehensive, hands-on guide to implementing token gate verification on the Midnight Network. We will cover the conceptual foundations, walk through the smart contract architecture, build a client-side verification flow, and explore advanced patterns such as multi-token gates, time-locked access, and composability with other privacy-preserving primitives offered by the Midnight ecosystem.

By the end of this tutorial, you will be able to:

- Understand how token gates work at both the protocol and application layers
- Write a Compact smart contract that enforces ownership-based access control
- Build a client-side verifier that checks wallet holdings against gate requirements
- Implement advanced gating patterns including tiered access, snapshot-based verification, and privacy-preserving proofs
- Deploy and test your token gate on the Midnight testnet

---

## Prerequisites

Before proceeding, ensure you have the following:

- **Node.js** v18 or later installed
- **Midnight CLI** installed and configured (`npm install -g @midnight-ntwrk/cli`)
- A funded Midnight testnet wallet (see the [Getting Started](../getting-started.md) guide)
- Basic familiarity with TypeScript and smart contract development
- The Compact compiler (`compactc`) available on your PATH

---

## Part 1: Conceptual Foundations

### What Is a Token Gate?

A token gate is a mechanism that conditionally grants or denies access based on whether a user's blockchain address holds specific tokens. Think of it as a bouncer at a club who checks your membership card — except the membership card is a cryptographic token on a public ledger, and the bouncer is a smart contract or off-chain verification script.

Token gates can require:

- **Fungible tokens (FTs):** Hold at least N tokens of a specific type (e.g., governance tokens, utility tokens)
- **Non-fungible tokens (NFTs):** Hold a specific NFT or any NFT from a particular collection
- **Soulbound tokens (SBTs):** Hold a non-transferable credential or achievement token
- **Combinations:** Hold tokens from multiple collections simultaneously

### Why Use Token Gates?

Token gates solve several real-world problems:

1. **Exclusive Content Access:** Creators can restrict premium content (articles, videos, music) to fans who hold their tokens.
2. **Community Gating:** DAOs and NFT communities can gate Discord channels, forums, or event invitations.
3. **Tiered Experiences:** Different token holdings can unlock different levels of access (bronze, silver, gold).
4. **Sybil Resistance:** Requiring token ownership makes it expensive to create fake identities.
5. **Privacy-Preserving Verification:** On Midnight, you can prove ownership without revealing which specific tokens you hold.

### How Token Gates Work on Midnight

The Midnight Network provides privacy-preserving smart contracts via the Compact language. Unlike traditional blockchains where all state is public, Midnight allows developers to work with both public and private state. This is particularly powerful for token gates because:

- Users can prove they own a qualifying token without revealing their full portfolio
- Gate logic can reference private token balances without exposing them on-chain
- Zero-knowledge proofs enable verification without data leakage

The verification flow typically works as follows:

1. The user connects their Midnight wallet to the dApp
2. The dApp requests a proof of token ownership
3. The user's wallet generates a zero-knowledge proof demonstrating they hold the required tokens
4. The smart contract verifies the proof and grants or denies access
5. The dApp unlocks (or continues to restrict) the protected resource

---

## Part 2: Smart Contract Architecture

### The TokenGate Contract

Our smart contract will implement the following interface:

- `createGate(gateId, requirements)` — Define a new token gate with specific requirements
- `verifyOwnership(gateId, proof)` — Verify a user's ownership proof against gate requirements
- `getGateStatus(gateId, address)` — Check whether an address has passed a specific gate
- `updateGate(gateId, newRequirements)` — Modify gate requirements (gate owner only)
- `revokeAccess(gateId, address)` — Revoke a user's access (gate owner only)

Let's define the data structures first:

```compact
// Token types that can be gated
enum TokenType {
  Fungible,
  NonFungible,
  Soulbound
}

// Requirements for a single token gate
struct TokenRequirement {
  tokenType: TokenType;
  contractAddress: Bytes<32>;  // Token contract on-chain
  minimumBalance: Uint<128>;   // Minimum tokens required (1 for NFTs)
  tokenIds: Vector<Uint<128>>; // Specific token IDs (empty = any)
}

// A complete gate configuration
struct GateConfig {
  owner: Bytes<32>;
  requirements: Vector<TokenRequirement>;
  active: Boolean;
  createdAt: Uint<64>;
  expiresAt: Uint<64>;  // 0 = never expires
}

// Proof of ownership submitted by a user
struct OwnershipProof {
  gateId: Bytes<32>;
  holder: Bytes<32>;
  tokenBalances: Vector<Uint<128>>;
  signature: Bytes<64>;
  timestamp: Uint<64>;
}
```

### Contract State

```compact
// Public state: gate configurations and verification results
ledger gates: Map<Bytes<32>, GateConfig>;
ledger verified: Map<Bytes<32>, Map<Bytes<32>, Boolean>>; // gateId -> address -> verified
ledger verificationCount: Map<Bytes<32>, Uint<64>>;

// Private state: used for zero-knowledge proof generation
secret witness userHoldings: Map<Bytes<32>, Uint<128>>; // tokenContract -> balance
secret witness userTokenIds: Vector<Uint<128>>;         // owned token IDs
```

### Core Verification Logic

The heart of the contract is the verification function. It checks whether a submitted ownership proof satisfies all requirements defined in the gate configuration:

```compact
export circuit verifyOwnership(gateId: Bytes<32>, proof: OwnershipProof): Boolean {
  // 1. Retrieve the gate configuration
  const gate = gates[gateId];
  assert(gate.active, "Gate is not active");
  assert(gate.expiresAt == 0 || currentTimestamp() < gate.expiresAt, "Gate has expired");

  // 2. Verify the proof signature matches the holder
  assert(verifySignature(proof.holder, proof.signature, proof.gateId), "Invalid signature");

  // 3. Check each requirement against the proof
  const reqs = gate.requirements;
  assert(proof.tokenBalances.length == reqs.length, "Proof mismatch: wrong number of token balances");

  for (let i = 0; i < reqs.length; i++) {
    const req = reqs[i];
    const balance = proof.tokenBalances[i];

    if (req.tokenType == TokenType.Fungible) {
      assert(balance >= req.minimumBalance, "Insufficient fungible token balance");
    } else if (req.tokenType == TokenType.NonFungible) {
      if (req.tokenIds.length > 0) {
        // Must hold one of the specific token IDs
        assert(hasMatchingTokenId(proof, req.tokenIds), "Required NFT not found");
      } else {
        assert(balance >= req.minimumBalance, "Insufficient NFT holdings");
      }
    } else if (req.tokenType == TokenType.Soulbound) {
      assert(balance >= 1, "Soulbound token not found");
    }
  }

  // 4. Record the verification
  verified[gateId][proof.holder] = true;
  verificationCount[gateId] = verificationCount[gateId] + 1;

  return true;
}
```

---

## Part 3: Client-Side Verification

### Setting Up the Verifier

On the client side, we need a TypeScript module that interacts with the deployed contract and handles the user-facing verification flow:

```typescript
import {
  MidnightProvider,
  WalletProvider,
  ContractAddress,
  Proof,
} from '@midnight-ntwrk/midnight-js-sdk';
import { TokenGateContract } from './generated/TokenGateContract';

export interface GateRequirement {
  tokenType: 'fungible' | 'nft' | 'soulbound';
  contractAddress: string;
  minimumBalance: bigint;
  tokenIds?: bigint[];
}

export interface VerificationResult {
  passed: boolean;
  gateId: string;
  holder: string;
  timestamp: number;
  details: string[];
}

export class TokenGateVerifier {
  private contract: TokenGateContract;
  private provider: MidnightProvider;
  private wallet: WalletProvider;

  constructor(
    contractAddress: ContractAddress,
    provider: MidnightProvider,
    wallet: WalletProvider
  ) {
    this.contract = new TokenGateContract(contractAddress);
    this.provider = provider;
    this.wallet = wallet;
  }

  /**
   * Create a new token gate with the given requirements.
   * Only the gate creator can update or revoke access later.
   */
  async createGate(
    gateId: string,
    requirements: GateRequirement[],
    expiresAt?: Date
  ): Promise<string> {
    const encodedReqs = requirements.map((r) => ({
      tokenType: this.encodeTokenType(r.tokenType),
      contractAddress: this.hexToBytes32(r.contractAddress),
      minimumBalance: r.minimumBalance,
      tokenIds: r.tokenIds ?? [],
    }));

    const tx = await this.contract.createGate(
      this.hexToBytes32(gateId),
      encodedReqs,
      expiresAt ? Math.floor(expiresAt.getTime() / 1000) : 0n
    );

    const receipt = await this.provider.submitTransaction(tx);
    return receipt.transactionHash;
  }

  /**
   * Generate and submit an ownership proof for the connected wallet.
   * This is the main entry point for users trying to pass a gate.
   */
  async verifyOwnership(gateId: string): Promise<VerificationResult> {
    const address = await this.wallet.getAddress();

    // Fetch gate requirements from the contract
    const gate = await this.contract.getGate(this.hexToBytes32(gateId));
    if (!gate || !gate.active) {
      return {
        passed: false,
        gateId,
        holder: address,
        timestamp: Date.now(),
        details: ['Gate not found or inactive'],
      };
    }

    // Build the ownership proof by querying token balances
    const tokenBalances: bigint[] = [];
    const details: string[] = [];

    for (const req of gate.requirements) {
      const balance = await this.queryTokenBalance(
        this.bytes32ToHex(req.contractAddress),
        address
      );
      tokenBalances.push(balance);

      const met = balance >= req.minimumBalance;
      details.push(
        `Token ${this.bytes32ToHex(req.contractAddress).slice(0, 10)}...: ` +
        `held=${balance}, required=${req.minimumBalance}, satisfied=${met}`
      );
    }

    // Generate the cryptographic proof
    const proof = await this.generateOwnershipProof(gateId, tokenBalances);

    // Submit proof to the contract
    const tx = await this.contract.verifyOwnership(
      this.hexToBytes32(gateId),
      proof
    );
    const receipt = await this.provider.submitTransaction(tx);

    return {
      passed: true,
      gateId,
      holder: address,
      timestamp: Date.now(),
      details,
    };
  }

  /**
   * Check verification status without submitting a new proof.
   * Useful for displaying access status in the UI.
   */
  async checkStatus(gateId: string, address?: string): Promise<boolean> {
    const addr = address ?? (await this.wallet.getAddress());
    return this.contract.getGateStatus(
      this.hexToBytes32(gateId),
      addr
    );
  }

  // --- Internal helpers ---

  private async queryTokenBalance(
    contractAddress: string,
    holderAddress: string
  ): Promise<bigint> {
    // Query the token contract for the holder's balance
    const tokenContract = await this.provider.getContract(contractAddress);
    return tokenContract.balanceOf(holderAddress);
  }

  private async generateOwnershipProof(
    gateId: string,
    balances: bigint[]
  ): Promise<Proof> {
    const address = await this.wallet.getAddress();
    const message = this.buildProofMessage(gateId, address, balances);
    const signature = await this.wallet.signMessage(message);

    return {
      gateId: this.hexToBytes32(gateId),
      holder: this.hexToBytes32(address),
      tokenBalances: balances,
      signature: this.hexToBytes64(signature),
      timestamp: BigInt(Math.floor(Date.now() / 1000)),
    };
  }

  private buildProofMessage(
    gateId: string,
    address: string,
    balances: bigint[]
  ): Uint8Array {
    const encoder = new TextEncoder();
    const parts = [gateId, address, ...balances.map((b) => b.toString())];
    return encoder.encode(parts.join('|'));
  }

  private encodeTokenType(type: string): number {
    const map: Record<string, number> = {
      fungible: 0,
      nft: 1,
      soulbound: 2,
    };
    return map[type] ?? 0;
  }

  private hexToBytes32(hex: string): Uint8Array {
    const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
    return Uint8Array.from(Buffer.from(clean.padStart(64, '0'), 'hex'));
  }

  private bytes32ToHex(bytes: Uint8Array): string {
    return '0x' + Buffer.from(bytes).toString('hex');
  }

  private hexToBytes64(hex: string): Uint8Array {
    const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
    return Uint8Array.from(Buffer.from(clean.padStart(128, '0'), 'hex'));
  }
}
```

---

## Part 4: Advanced Patterns

### Pattern 1: Tiered Access

Tiered access allows different levels of access based on token holdings. For example, a community might have three tiers:

- **Bronze:** Holds at least 1 NFT from the collection
- **Silver:** Holds at least 5 NFTs or 1000 governance tokens
- **Gold:** Holds at least 10 NFTs AND 5000 governance tokens

Implement this by creating multiple gates with overlapping but progressively stricter requirements, then checking them in order from highest to lowest tier:

```typescript
export type AccessTier = 'none' | 'bronze' | 'silver' | 'gold';

export async function determineAccessTier(
  verifier: TokenGateVerifier,
  address: string
): Promise<AccessTier> {
  const gates = {
    gold: 'gate_gold_001',
    silver: 'gate_silver_001',
    bronze: 'gate_bronze_001',
  };

  // Check from highest to lowest tier
  for (const [tier, gateId] of Object.entries(gates)) {
    const hasAccess = await verifier.checkStatus(gateId, address);
    if (hasAccess) return tier as AccessTier;
  }

  return 'none';
}
```

### Pattern 2: Time-Locked Access

Time-locked gates restrict access to specific time windows. This is useful for events, limited-time drops, or seasonal content. The gate's `expiresAt` field handles expiration, but you can also implement start times:

```typescript
export interface TimeLockedGate {
  gateId: string;
  startsAt: Date;
  expiresAt: Date;
}

export function isGateActive(gate: TimeLockedGate): boolean {
  const now = Date.now();
  return now >= gate.startsAt.getTime() && now < gate.expiresAt.getTime();
}

export function getTimeRemaining(gate: TimeLockedGate): {
  active: boolean;
  startsIn?: number;
  expiresIn?: number;
} {
  const now = Date.now();
  if (now < gate.startsAt.getTime()) {
    return { active: false, startsIn: gate.startsAt.getTime() - now };
  }
  if (now < gate.expiresAt.getTime()) {
    return { active: true, expiresIn: gate.expiresAt.getTime() - now };
  }
  return { active: false };
}
```

### Pattern 3: Privacy-Preserving Verification

Midnight's zero-knowledge capabilities allow users to prove ownership without revealing which specific tokens they hold. This is critical for:

- Preventing targeted phishing based on known holdings
- Maintaining financial privacy while still proving eligibility
- Complying with privacy regulations

To implement privacy-preserving verification, use Midnight's secret witness mechanism:

```compact
// The user's holdings remain private
secret witness privateHoldings: Map<Bytes<32>, Uint<128>>;

// The circuit proves ownership without revealing exact balances
export circuit privateVerify(
  gateId: Bytes<32>,
  minimumRequired: Uint<128>,
  tokenContract: Bytes<32>
): Boolean {
  // This proof demonstrates the user holds >= minimumRequired
  // without revealing the exact balance
  const balance = privateHoldings[tokenContract];
  return balance >= minimumRequired;
}
```

### Pattern 4: Multi-Gate Composition

Complex access scenarios may require satisfying multiple independent gates simultaneously. For example, a premium feature might require both an NFT membership AND a governance token stake:

```typescript
export async function checkCompositeAccess(
  verifier: TokenGateVerifier,
  address: string,
  gateIds: string[],
  mode: 'all' | 'any' = 'all'
): Promise<{ hasAccess: boolean; results: Record<string, boolean> }> {
  const results: Record<string, boolean> = {};

  for (const gateId of gateIds) {
    results[gateId] = await verifier.checkStatus(gateId, address);
  }

  const values = Object.values(results);
  const hasAccess = mode === 'all'
    ? values.every(Boolean)
    : values.some(Boolean);

  return { hasAccess, results };
}
```

### Pattern 5: Snapshot-Based Verification

Snapshot-based verification checks whether a user held the required tokens at a specific point in time, rather than at the current moment. This prevents users from buying tokens temporarily to pass a gate, then immediately selling them:

```typescript
export interface SnapshotGate {
  gateId: string;
  snapshotBlock: bigint;  // Block number to check against
  requirements: GateRequirement[];
}

export async function verifyAtSnapshot(
  provider: MidnightProvider,
  snapshot: SnapshotGate,
  address: string
): Promise<boolean> {
  for (const req of snapshot.requirements) {
    const balance = await provider.getHistoricalBalance(
      req.contractAddress,
      address,
      snapshot.snapshotBlock
    );
    if (balance < req.minimumBalance) return false;
  }
  return true;
}
```

---

## Part 5: Frontend Integration

### Building the Gate Component

Here's a React component that wraps content in a token gate:

```tsx
import React, { useEffect, useState } from 'react';
import { TokenGateVerifier, VerificationResult } from './TokenGateVerifier';

interface TokenGateProps {
  gateId: string;
  verifier: TokenGateVerifier;
  children: React.ReactNode;
  fallback?: React.ReactNode;
  loadingComponent?: React.ReactNode;
}

export const TokenGate: React.FC<TokenGateProps> = ({
  gateId,
  verifier,
  children,
  fallback = <div className="gate-denied">
    <h3>Access Denied</h3>
    <p>You need the required tokens to access this content.</p>
  </div>,
  loadingComponent = <div className="gate-loading">Verifying ownership...</div>,
}) => {
  const [status, setStatus] = useState<'loading' | 'granted' | 'denied'>('loading');
  const [result, setResult] = useState<VerificationResult | null>(null);

  useEffect(() => {
    const verify = async () => {
      try {
        // First check if already verified
        const alreadyVerified = await verifier.checkStatus(gateId);
        if (alreadyVerified) {
          setStatus('granted');
          return;
        }

        // Attempt verification
        const verificationResult = await verifier.verifyOwnership(gateId);
        setResult(verificationResult);
        setStatus(verificationResult.passed ? 'granted' : 'denied');
      } catch (error) {
        console.error('Token gate verification failed:', error);
        setStatus('denied');
      }
    };

    verify();
  }, [gateId, verifier]);

  if (status === 'loading') return <>{loadingComponent}</>;
  if (status === 'denied') return <>{fallback}</>;
  return <>{children}</>;
};
```

### Usage Example

```tsx
function ExclusiveContent() {
  const verifier = useTokenGateVerifier();

  return (
    <div>
      <h1>Welcome to the Community</h1>

      <TokenGate
        gateId="community_access_001"
        verifier={verifier}
        fallback={<JoinPrompt />}
      >
        <ExclusiveForum />

        <TokenGate
          gateId="premium_content_001"
          verifier={verifier}
          fallback={<UpgradePrompt />}
        >
          <PremiumArticles />
        </TokenGate>
      </TokenGate>
    </div>
  );
}
```

---

## Part 6: Testing and Deployment

### Local Testing

Use the Midnight testnet simulator to test your token gate contract:

```bash
# Compile the contract
compactc --target testnet contracts/TokenGate.compact build/

# Deploy to local testnet
midnight deploy build/TokenGate --network local

# Run the test suite
npm test -- --grep "TokenGate"
```

### Integration Tests

Write comprehensive tests covering edge cases:

```typescript
describe('TokenGate', () => {
  it('should grant access when user holds required NFT', async () => {
    await mintNFT(testContract, testUser, tokenId = 42);
    const gateId = await createNFTGate(testContract, testContract, [42]);
    const result = await verifier.verifyOwnership(gateId);
    expect(result.passed).to.be.true;
  });

  it('should deny access when user lacks required tokens', async () => {
    const gateId = await createFungibleGate(testContract, 1000n);
    // testUser has 0 tokens
    const result = await verifier.verifyOwnership(gateId);
    expect(result.passed).to.be.false;
  });

  it('should deny access after gate expiration', async () => {
    const gateId = await createGateWithExpiry(testContract, pastDate);
    const result = await verifier.verifyOwnership(gateId);
    expect(result.passed).to.be.false;
  });

  it('should support multiple requirements (AND logic)', async () => {
    const gateId = await createMultiRequirementGate(testContract, [
      { token: nftContract, minBalance: 1n },
      { token: govTokenContract, minBalance: 100n },
    ]);
    // User has NFT but only 50 governance tokens
    const result = await verifier.verifyOwnership(gateId);
    expect(result.passed).to.be.false;
  });
});
```

### Deployment to Testnet

```bash
# Build for testnet
compactc --target testnet contracts/TokenGate.compact build/token-gate-testnet/

# Deploy
midnight deploy build/token-gate-testnet/ --network testnet --wallet ./testnet-wallet.json

# Verify deployment
midnight contract info <DEPLOYED_ADDRESS> --network testnet
```

---

## Part 7: Security Considerations

When implementing token gates, keep these security best practices in mind:

1. **Signature Verification:** Always verify that the ownership proof is signed by the wallet claiming ownership. Never trust client-provided balance data without cryptographic verification.

2. **Replay Protection:** Include timestamps and nonces in proofs to prevent replay attacks where a valid proof is resubmitted later.

3. **Front-Running Resistance:** On public blockchains, gate creation transactions can be front-run. Use commit-reveal schemes if gate parameters are sensitive.

4. **Contract Upgradability:** Design your gate contract to support upgrades without breaking existing gates. Use proxy patterns or versioned gate configurations.

5. **Rate Limiting:** Implement rate limits on verification attempts to prevent denial-of-service attacks against the verification circuit.

6. **Balance Snapshot Freshness:** Decide how recent a balance must be. Stale snapshots may allow users to pass gates after selling tokens, while requiring real-time balances may create poor UX during network congestion.

7. **Privacy Leakage:** Be careful about what information is revealed during verification. On Midnight, prefer zero-knowledge proofs over direct balance checks whenever possible.

---

## Conclusion

Token gates are a foundational building block for ownership-based access control in decentralized applications. By leveraging the Midnight Network's privacy-preserving capabilities, you can build token gates that protect both the resource owner's access requirements and the user's financial privacy.

In this tutorial, we covered:

- The conceptual model behind token gates and why they matter
- A complete smart contract architecture using Compact
- Client-side verification with TypeScript
- Five advanced patterns: tiered access, time-locked gates, privacy-preserving verification, multi-gate composition, and snapshot-based verification
- Frontend integration with React components
- Testing, deployment, and security best practices

### Next Steps

- Explore the [Multi-Party Token Gate](./multi-party-gates.md) tutorial for gates that require approval from multiple parties
- Read about [Zero-Knowledge Access Proofs](./zk-access-proofs.md) for deeper privacy guarantees
- Check the [Examples](./examples/) directory for complete working code

### Resources

- [Midnight Network Documentation](https://midnightntwrk.com/docs)
- [Compact Language Reference](https://midnightntwrk.com/docs/compact)
- [Token Standards on Midnight](https://midnightntwrk.com/docs/tokens)
- [Community Discord](https://discord.gg/midnight)

---

*This tutorial is part of the Midnight Network Contributor Hub. For questions or contributions, please open an issue or submit a pull request.*
