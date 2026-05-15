# Building Private NFT Marketplaces on Midnight

## Overview

This tutorial walks through creating a fully private NFT marketplace on Midnight, where ownership, bids, and transactions are shielded using zero-knowledge proofs.

## Prerequisites

- Midnight SDK installed (`@midnight-ntwrk/midnight-js`)
- A funded Midnight wallet
- Basic understanding of Compact smart contracts
- Node.js 18+

## Step 1: Define the NFT Contract

Create a new Compact contract file `private-nft.mid`:

```compact
// Private NFT Marketplace Contract
circuit PrivateNFT {
    // Private state: NFT ownership records
    // Each NFT is represented by a commitment (hash of token_id + owner_secret)
    secret nft_registry: Map<Digest, bool>;
    secret listings: Map<Digest, Listing>;
    secret bids: Map<Digest, Bid>;

    struct Listing {
        token_commitment: Digest,
        price: Currency,
        seller: PublicKey,
        active: bool,
    }

    struct Bid {
        listing_id: Digest,
        amount: Currency,
        bidder: PublicKey,
        timestamp: Uint<64>,
    }

    // Mint a new private NFT
    export mint(token_id: Uint<256>, owner_secret: Bytes) -> Digest {
        let commitment = hash(token_id, owner_secret);
        require(!nft_registry[commitment], "NFT already exists");
        nft_registry[commitment] = true;
        commitment
    }

    // List an NFT for sale
    export list_for_sale(
        token_commitment: Digest,
        owner_secret: Bytes,
        price: Currency,
    ) -> Digest {
        let token_id = extract_token_id(token_commitment, owner_secret);
        require(nft_registry[token_commitment], "NFT does not exist");
        
        let listing_id = hash(token_commitment, price);
        listings[listing_id] = Listing {
            token_commitment,
            price,
            seller: ownPublicKey(),
            active: true,
        };
        listing_id
    }

    // Place a bid on a listing
    export place_bid(
        listing_id: Digest,
        amount: Currency,
    ) -> Digest {
        let listing = listings[listing_id];
        require(listing.active, "Listing not active");
        require(amount >= listing.price, "Bid too low");
        
        let bid_id = hash(listing_id, amount, ownPublicKey());
        bids[bid_id] = Bid {
            listing_id,
            amount,
            bidder: ownPublicKey(),
            timestamp: current_time(),
        };
        bid_id
    }

    // Accept a bid and transfer NFT ownership
    export accept_bid(
        bid_id: Digest,
        owner_secret: Bytes,
        new_owner_secret: Bytes,
    ) {
        let bid = bids[bid_id];
        let listing = listings[bid.listing_id];
        
        require(listing.active, "Listing not active");
        require(verify_ownership(listing.token_commitment, owner_secret), "Not owner");
        
        // Transfer: old commitment removed, new one created
        nft_registry[listing.token_commitment] = false;
        let new_commitment = remap_commitment(listing.token_commitment, new_owner_secret);
        nft_registry[new_commitment] = true;
        
        // Deactivate listing
        listings[bid.listing_id].active = false;
    }
}
```

## Step 2: TypeScript API Layer

```typescript
import { initialize } from '@midnight-ntwrk/midnight-js';
import { PrivateNFT } from './contracts/private-nft';

const { wallet, ledger } = await initialize();

// Mint a new NFT
async function mintNFT(tokenId: bigint, ownerSecret: Uint8Array) {
  const result = await wallet.execute(PrivateNFT.mint(tokenId, ownerSecret));
  console.log('NFT minted with commitment:', result);
  return result;
}

// List for sale
async function listNFT(tokenCommitment: string, ownerSecret: Uint8Array, price: number) {
  const listingId = await wallet.execute(
    PrivateNFT.list_for_sale(tokenCommitment, ownerSecret, price)
  );
  console.log('Listed with ID:', listingId);
  return listingId;
}

// Place bid
async function placeBid(listingId: string, amount: number) {
  const bidId = await wallet.execute(
    PrivateNFT.place_bid(listingId, amount)
  );
  console.log('Bid placed:', bidId);
  return bidId;
}
```

## Step 3: React Frontend

```tsx
import { useState } from 'react';
import { useWallet } from './hooks/useWallet';
import { mintNFT, listNFT, placeBid } from './api/nft';

export function NFTMarketplace() {
  const { wallet, connected } = useWallet();
  const [minting, setMinting] = useState(false);
  const [listings, setListings] = useState([]);

  const handleMint = async () => {
    if (!connected) return;
    setMinting(true);
    try {
      const tokenId = BigInt(Date.now());
      const secret = crypto.getRandomValues(new Uint8Array(32));
      const commitment = await mintNFT(tokenId, secret);
      alert('NFT minted! Commitment: ' + commitment);
    } finally {
      setMinting(false);
    }
  };

  return (
    <div className="marketplace">
      <h1>Private NFT Marketplace</h1>
      <button onClick={handleMint} disabled={minting || !connected}>
        {minting ? 'Minting...' : 'Mint Private NFT'}
      </button>
      <div className="listings-grid">
        {listings.map(l => (
          <div key={l.id} className="listing-card">
            <p>Price: {l.price} NIGHT</p>
            <button onClick={() => placeBid(l.id, l.price)}>Bid</button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

## Key Privacy Features

1. **Hidden Ownership**: NFT ownership is stored as a hash commitment, not a public address
2. **Private Listings**: Sale prices are shielded until a bid reveals the minimum
3. **Anonymous Bidding**: Bidders' identities are protected until bid acceptance
4. **Zero-Knowledge Transfers**: Ownership changes are proven without revealing the new owner

## Security Considerations

- Always generate cryptographically secure random secrets for NFT ownership
- Store owner secrets securely (never in localStorage for production)
- Verify commitment integrity before accepting bids
- Use nullifiers to prevent double-spending of the same NFT

## Conclusion

This tutorial demonstrated how to build a fully private NFT marketplace on Midnight. The key advantage over traditional NFT platforms is complete privacy of ownership, bidding, and transfer history.

For the full source code, see the accompanying GitHub repository.
