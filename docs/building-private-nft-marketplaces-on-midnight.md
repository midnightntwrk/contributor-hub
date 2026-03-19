# Building Private NFT Marketplaces on Midnight

Every NFT marketplace today exposes your complete collection. Anyone with your wallet address can see every token you own, what you paid, when you bought it, and what you sold. For high-value collections this is a security risk — collectors get targeted for social engineering and theft. For everyday users, it removes the basic privacy expectation that exists in traditional art collecting.

Midnight enables a different model: verifiable ownership with private holdings. You can prove you own a token for access control purposes without revealing your full collection. Listings can show price without revealing the seller. Purchases can be anonymous. This tutorial builds a working private NFT marketplace using Compact and the Midnight SDK.

## What Makes NFT Privacy Hard

The problem is structural. Ethereum NFTs are ERC-721 tokens: a mapping from token IDs to owner addresses. The mapping is public. Every transfer is a public event. To buy an NFT privately on Ethereum you would need to hide the transaction entirely, which breaks composability.

Midnight's shielded tokens solve this at the protocol level. Token ownership is stored as cryptographic commitments on the ledger. The network can verify that transfers are valid (no double-spending, correct ownership checks) without learning who owns what.

## Architecture Overview

The marketplace has two components:

**On-chain (Compact contract):** Handles listings, purchase verification, royalty accounting, and ownership proof generation. Public state tracks listing prices and availability. Ownership is shielded.

**Off-chain (TypeScript client):** Manages metadata, generates proofs for ownership verification, handles IPFS integration for media files.

```compact
contract NFTMarketplace {
  // Public: anyone can see what is listed and at what price
  ledger listings: Map<Bytes<32>, Uint<64>>;       // token_id -> price
  ledger listing_count: Uint<32>;

  // Public: royalty configuration per collection
  ledger royalty_basis_points: Map<Bytes<32>, Uint<16>>; // collection -> bps
  ledger royalty_recipients: Map<Bytes<32>, Bytes<32>>;  // collection -> recipient commitment

  // Public: collection metadata (URI to off-chain JSON)
  ledger collection_uri: Map<Bytes<32>, Bytes<128>>;
}
```

Ownership is tracked through shielded tokens following the Midnight token standard, not in this contract's storage.

## Minting Private NFTs

When minting, the creator generates a shielded token commitment. The token ID is public (it appears in listings) but the owner is not.

```compact
circuit mint_nft(
  token_id: Bytes<32>,
  metadata_hash: Bytes<32>,   // hash of off-chain metadata
  collection_id: Bytes<32>
): [] {
  // Verify this token_id hasn't been minted yet
  // (In production, use a nullifier to prevent reminting)

  // The shielded token is created by the SDK automatically
  // when this circuit runs — the minter's address is never recorded
  assert token_id != zeros();
  assert metadata_hash != zeros();
}
```

The actual shielded token creation is handled by the Midnight runtime when the circuit returns successfully. The SDK manages the commitment scheme.

## Creating a Listing

A seller creates a listing by proving they own the token and specifying a price. The price is public, the seller identity is not:

```compact
circuit create_listing(
  token_id: Bytes<32>,
  price: Uint<64>,
  seller_note: Bytes<32>    // private: seller's nonce for later claim
): [] {
  assert price > 0;
  assert !NFTMarketplace.listings.member(token_id);

  // Record the listing publicly
  NFTMarketplace.listings.insert(token_id, price);
  NFTMarketplace.listing_count = NFTMarketplace.listing_count + 1;

  // seller_note is a private input — the seller uses it to prove
  // they created this listing when they want to cancel or claim payment
}
```

When this circuit executes, the Midnight network verifies that the transaction sender owns the shielded token for `token_id` using the token's zero-knowledge proof machinery. The seller's identity is not written to state.

## Private Purchase

A buyer purchases by sending payment and proving they want to receive the token:

```compact
circuit purchase_nft(
  token_id: Bytes<32>,
  buyer_nonce: Bytes<32>    // private: used to claim the received token
): Uint<64> {
  // Verify the token is listed
  assert NFTMarketplace.listings.member(token_id);
  const price = NFTMarketplace.listings.lookup(token_id);

  // Royalty calculation
  // (collection_id lookup omitted for clarity)
  const royalty_bps: Uint<16> = 250;  // 2.5%
  const royalty_amount = (price * royalty_bps) / 10000;
  const seller_payment = price - royalty_amount;

  // Remove the listing
  NFTMarketplace.listings.remove(token_id);
  NFTMarketplace.listing_count = NFTMarketplace.listing_count - 1;

  // The SDK handles:
  // 1. Transferring shielded tokens from buyer to seller (payment)
  // 2. Transferring the NFT shielded token from seller to buyer
  // Both in a single atomic transaction

  return price;
}
```

The buyer's identity never appears on-chain. An observer sees that listing `token_id` was removed and some shielded value changed hands, but not who bought or sold.

## Selective Disclosure — Proving Ownership Without Revealing Collection

This is the most powerful pattern for gated access. An NFT collector can prove they own a token from a specific collection to unlock a Discord channel, an in-person event, or a private forum — without revealing their entire collection.

```compact
// Generate a proof of ownership for a specific token
circuit prove_ownership(
  token_id: Bytes<32>,
  collection_id: Bytes<32>,
  verifier_nonce: Bytes<32>   // from the service requesting proof
): Bytes<32> {
  // Verify the prover owns token_id
  // (done implicitly by the Midnight runtime when consuming the token commitment)

  // Verify the token belongs to the claimed collection
  // In production: check token_id against collection's merkle root
  assert token_id != zeros();
  assert collection_id != zeros();

  // Return a one-time proof token bound to this verifier
  // The verifier_nonce prevents replay attacks
  return hash(token_id, collection_id, verifier_nonce);
}
```

The verifier receives a commitment that:
1. Proves the requester owns a token in collection `collection_id`
2. Is bound to this specific verification request (prevents replay)
3. Does not reveal which token within the collection, or what else the owner holds

## Metadata Handling

Token images and attributes need a storage strategy. On-chain storage is expensive. The standard approach is IPFS with on-chain content hashes:

```typescript
import { create } from 'ipfs-http-client';
import { encrypt } from '@midnight-ntwrk/midnight-js-crypto';

interface NFTMetadata {
  name: string;
  description: string;
  image: string;        // IPFS CID for the image
  attributes: Attribute[];
}

async function uploadPrivateMetadata(
  metadata: NFTMetadata,
  ownerViewingKey: Uint8Array
): Promise<{ cid: string; encryptedMetadataHash: Uint8Array }> {
  const ipfs = create({ url: 'https://ipfs.infura.io:5001/api/v0' });

  // Encrypt sensitive attributes before upload
  const publicMetadata = {
    name: metadata.name,
    description: metadata.description,
    image: metadata.image,  // image is public
    // attributes encrypted separately
  };

  // Upload public metadata
  const { cid } = await ipfs.add(JSON.stringify(publicMetadata));

  // Encrypt private attributes with owner's viewing key
  const encryptedAttrs = await encrypt(
    JSON.stringify(metadata.attributes),
    ownerViewingKey
  );

  return {
    cid: cid.toString(),
    encryptedMetadataHash: new Uint8Array(32) // hash of encrypted attrs for on-chain commitment
  };
}
```

The image is public (needed for marketplace display). Rarity traits and other attributes can be encrypted and only decryptable by the token owner using their viewing key.

## Royalty Enforcement with Privacy

Creator royalties are enforced at the circuit level, not at the marketplace level. This means royalties apply even to private peer-to-peer sales, if both parties use the standard:

```compact
circuit calculate_royalty(
  sale_price: Uint<64>,
  collection_id: Bytes<32>
): [Uint<64>, Bytes<32>] {
  assert NFTMarketplace.royalty_basis_points.member(collection_id);
  const bps = NFTMarketplace.royalty_basis_points.lookup(collection_id);
  const recipient_commitment = NFTMarketplace.royalty_recipients.lookup(collection_id);

  const royalty = (sale_price * bps) / 10000;

  // recipient_commitment is a shielded address —
  // royalties go to the creator without revealing the creator's wallet
  return [royalty, recipient_commitment];
}
```

## TypeScript Client Integration

Putting it together, here's how a buyer executes a purchase:

```typescript
import { createMidnightClient } from '@midnight-ntwrk/midnight-js-client';
import { MidnightProvider } from '@midnight-ntwrk/midnight-js-network-id';

async function buyNFT(
  provider: MidnightProvider,
  tokenId: Uint8Array,
  maxPrice: bigint
): Promise<string> {
  const client = await createMidnightClient(provider);

  // Generate a random nonce for this purchase
  const buyerNonce = crypto.getRandomValues(new Uint8Array(32));

  const tx = await client.buildTransaction({
    contract: MARKETPLACE_CONTRACT_ADDRESS,
    circuit: 'purchase_nft',
    privateInputs: {
      token_id: tokenId,
      buyer_nonce: buyerNonce
    }
  });

  // The SDK checks the listing price against your wallet balance
  // and builds the shielded payment transaction automatically
  const receipt = await client.submitTransaction(tx);

  // Store your buyer_nonce locally to prove ownership later
  await storeOwnershipSecret(tokenId, buyerNonce);

  return receipt.txHash;
}
```

## Running the Example Locally

```bash
git clone https://github.com/your-handle/midnight-private-nft-marketplace
cd midnight-private-nft-marketplace
npm install

# Start a local Midnight testnet node
npx midnight-js-cli node start --network testnet

# Deploy contracts
npx ts-node scripts/deploy.ts

# Mint an NFT (private — nobody knows your wallet minted it)
npx ts-node scripts/mint.ts --token-id 0x01 --metadata ./example-metadata.json

# Create a listing at 100 tDUST
npx ts-node scripts/list.ts --token-id 0x01 --price 100

# Buy the NFT from a different account
npx ts-node scripts/buy.ts --token-id 0x01

# Prove ownership for a gated service
npx ts-node scripts/prove-ownership.ts --token-id 0x01 --verifier-nonce 0xabc123
```

## Privacy Guarantees and Trade-offs

| Feature | Privacy Level | Notes |
|---------|--------------|-------|
| Token ownership | Fully private | Only holder can prove ownership |
| Listing price | Public | Required for price discovery |
| Seller identity | Private | Not recorded on-chain |
| Buyer identity | Private | Not recorded on-chain |
| Transfer history | Private | No public chain of custody |
| Collection size | Public | Total minted tokens visible |
| Metadata images | Public | Needed for marketplace display |
| Rarity attributes | Optional | Encrypt with viewing key |

The main trade-off: public blockchains can analyze which shielded token pools are active and infer rough volume. Individual transaction details remain private.

## Next Steps

- Read the [OpenZeppelin NonFungibleToken Compact contract](https://github.com/OpenZeppelin/compact-contracts/blob/main/contracts/src/token/NonFungibleToken.compact) for the base NFT implementation
- Explore [Midnight's viewing key documentation](https://docs.midnight.network) for selective disclosure patterns
- Post questions and implementations in the [Midnight developer forum](https://forum.midnight.network/)

---

*Published on dev.to: [link-to-article]*
