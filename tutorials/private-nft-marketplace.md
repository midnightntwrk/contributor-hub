# Building Private NFT Marketplaces on Midnight

## Why NFT Privacy Matters

Current NFT marketplaces expose everything. When you own a valuable NFT collection, the entire world can see it. Wash traders and front-runners monitor marketplace activity to snipe underpriced listings. Floor-price manipulation schemes are trivial to execute when your collection holdings are public knowledge.

Midnight enables a new model: **ownership privacy with verifiable trades**. The blockchain can prove that you own an NFT without revealing your identity or your full collection. This creates conditions for fair markets, private collections, and insider-free trading.

## Midnight's Privacy Model for NFTs

Midnight separates state into two categories:

- **Ledger (public) state**: Visible to everyone, cheap to query
- **Shielded (private) state**: Known only to the owner, verifiable through ZK proofs

For NFT marketplaces, the ideal split is:
- Trades and transfers → **public** (verifiable provenance)
- Ownership and listings → **private** (owner identity hidden)

This means anyone can verify that "some address owns this NFT" without knowing *which* address, or see "this NFT was sold for 5 ETH" without revealing the seller's full collection.

## Smart Contract Design

### Core Data Structures

```compact
// Public state - trade history
struct Trade {
    field seller: PublicKey
    field buyer: PublicKey
    field price: u64
    field timestamp: u64
}

// Private state - ownership record (only owner knows this)
struct Ownership {
    field tokenId: u64
    field listingPrice: u64  // 0 = not listed
    field listingActive: bool
}

// Private state - marketplace registry
struct MarketplaceRegistry {
    field isRegistered: bool
    field feeRecipient: PublicKey
    field feeBps: u16  // basis points
}
```

### Marketplace Contract

```compact
// Minimal NFT marketplace on Midnight
contract NFTMarketplace {
    // Public ledger: token ownership
    state listings: Map<u64, Listing>  // tokenId -> listing
    
    // Public ledger: trade history
    state trades: Vec<Trade>
    
    // Verify ownership without revealing owner
    fn verifyOwnership(tokenId: u64, proof: ByteWriter) -> bool {
        // Merkle path verification against published root
        // Zero-knowledge: the verifier learns only "valid/invalid"
        // not the owner's identity
    }
    
    // List an NFT (private → public bridge)
    fn list(tokenId: u64, price: u64, witness: ByteWriter) {
        // Verify caller owns tokenId via ZK proof
        // Publish listing to public state with price
        // Owner identity remains private
        this.listings.set(tokenId, Listing {
            seller: ownPublicKey(),  // revealed on listing
            price,
            active: true
        })
    }
    
    // Execute trade
    fn buy(tokenId: u64, proof: ByteWriter) {
        val listing = this.listings.get(tokenId)
        require(listing.active, "Not listed")
        
        // Verify buyer has sufficient balance via ZK proof
        // Atomic swap: payment → seller, NFT → buyer
        // Both identities revealed at trade execution
        
        this.trades.push(Trade {
            seller: listing.seller,
            buyer: ownPublicKey(),
            price: listing.price,
            timestamp: blockTimestamp()
        })
        
        listing.active = false
    }
}
```

## Implementing with Compact

### Minting a Private NFT

```typescript
// typescript/nft/mint.ts
import { CompactRuntime, Ledger } from '@midnight-ntwrk/compact-runtime';
import { shuffle } from './utils';

interface PrivateNFTState {
  owner: Buffer;        // private, known only to owner
  tokenUri: string;     // private
  mintTimestamp: u64;   // private
  transferCount: u64;   // public counter
}

export async function mintPrivateNFT(
  runtime: CompactRuntime,
  tokenUri: string
): Promise<Buffer> {
  const { witness, publicSignature } = await runtime.prove(
    'mint',
    {
      // Private inputs - only prover knows these
      private: {
        owner: runtime.ownPrivateKey(),
        tokenUri,
        mintTimestamp: Math.floor(Date.now() / 1000),
      },
      // Public inputs - visible on-chain
      public: {
        publicKey: runtime.ownPublicKey(),
      }
    }
  );

  // Submit to network
  await runtime.submitTransaction({
    contract: 'NFTContract',
    method: 'mint',
    args: { witness, publicSignature },
    proof: witness.proof,
  });

  return witness.tokenId;
}
```

### Creating a Private Listing

```typescript
// typescript/nft/marketplace.ts
export async function listNFT(
  runtime: CompactRuntime,
  tokenId: Buffer,
  price: bigint
): Promise<void> {
  // Verify we own the NFT without revealing the ownership
  const ownershipProof = await runtime.prove('verifyOwnership', {
    private: { tokenId, owner: runtime.ownPrivateKey() },
    public: { tokenUri: '' }  // placeholder
  });

  // List with price - our public key becomes visible as seller
  await runtime.submitTransaction({
    contract: 'NFTMarketplace',
    method: 'list',
    args: { tokenId, price },
    proof: ownershipProof.proof,
    // public signature reveals our key as the seller
    publicSignature: await runtime.signPublic()
  });
}
```

### Anonymous Purchase

```typescript
export async function buyNFT(
  runtime: CompactRuntime,
  tokenId: Buffer,
  price: bigint
): Promise<void> {
  // Verify buyer has balance without revealing their total holdings
  const balanceProof = await runtime.prove('verifyBalance', {
    private: { amount: price },
    public: {}
  });

  // Execute atomic swap - both parties' public keys revealed at this point
  await runtime.submitTransaction({
    contract: 'NFTMarketplace',
    method: 'buy',
    args: { tokenId },
    proof: balanceProof.proof,
    publicSignature: await runtime.signPublic(),
    payment: { amount: price, recipient: 'marketplace' }
  });
}
```

## Verification Without Revelation

The key innovation is that Midnight can verify ownership without revealing the owner:

```typescript
// Off-chain verification anyone can perform
async function verifyTokenOwner(
  tokenId: Buffer,
  claimedOwner: PublicKey,
  proof: ZKProof
): Promise<boolean> {
  // The ZK circuit verifies:
  // 1. The prover knows the private key for claimedOwner
  // 2. The tokenId is registered to that private key
  // 3. The proof is valid for the current blockchain state
  
  // Importantly: the verifier learns ONLY that the proof is valid
  // They do NOT learn the private key, the full ownership record,
  // or any other information about the owner's portfolio
  
  return await midnight.verifyProof('ownership', proof, {
    publicSignals: [tokenId, claimedOwner]
  });
}
```

## Royalty Enforcement in Private Trades

Royalty enforcement on private NFT marketplaces requires a different approach:

```typescript
// Private royalty tracking
interface RoyaltyRecord {
  creator: PublicKey;     // public (creator address)
  royaltyBps: u16;       // public (e.g., 750 = 7.5%)
  totalEarned: u64;      // private to creator
}

export async function enforceRoyalty(
  tokenId: Buffer,
  salePrice: bigint,
  creator: PublicKey
): Promise<void> {
  // Calculate royalty
  const royaltyBps = await getRoyaltyBps(tokenId);
  const royaltyAmount = (salePrice * BigInt(royaltyBps)) / 10000n;
  
  // Transfer royalty to creator
  // Creator's total earnings remain private
  await runtime.submitTransaction({
    contract: 'NFTMarketplace',
    method: 'payRoyalty',
    args: { tokenId, royaltyAmount },
    proof: await proveBalance(royaltyAmount),
    publicSignature: await runtime.signPublic()
  });
}
```

## Deployment Considerations

### Local Development

```bash
# Start Midnight dev environment
docker compose up -d

# Deploy contracts
cd contracts
compact build --network local

# Run tests
compact test --network local
```

### Testnet Deployment

```typescript
const deployment = await midnight.deploy('NFTMarketplace', {
  network: 'testnet',
  initialFeeRecipient: process.env.FEE_WALLET,
  initialFeeBps: 250  // 2.5% platform fee
});

console.log('Marketplace deployed at:', deployment.address);
```

## Security Checklist

- [ ] **Private inputs never leak**: Verify that `ownPrivateKey()` is never serialized or logged
- [ ] **Proof verification required**: All state-changing operations must have valid ZK proofs
- [ ] **Atomic swaps**: Trades must be atomic to prevent payment without transfer
- [ ] **Front-running prevention**: Use commit-reveal schemes for listings when necessary
- [ ] **Royalty enforcement**: Verify royalty payments on every secondary sale
- [ ] **Replay prevention**: Each proof must use unique nullifiers

## Summary

Building private NFT marketplaces on Midnight requires rethinking the ownership/transfer split. By keeping ownership private and trades public, you get:

- **Privacy for collectors**: Nobody can see your full collection
- **Verifiable provenance**: Anyone can verify trade history
- **Anti-front-running**: MEV bots can't see your listings until execution
- **Royalty enforcement**: Creators get paid on every resale

The key primitives are ZK proofs for ownership verification, Merkle trees for efficient state proofs, and the public/private state dichotomy that lets you choose exactly what to reveal.

---

**Bounty:** Issue [#229](https://github.com/midnightntwrk/contributor-hub/issues/229)  
**Bounty Wallet:** `63Ar4MqMrYwj294ERD7ygT7xrZefAzzd6GqdGEMNX4JW`
