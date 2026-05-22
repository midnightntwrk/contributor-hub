## Adding Privacy to an Existing dApp: A Retrofit Guide

**Difficulty:** Intermediate-Advanced  
**Time:** 30 minutes  
**Bounty:** #307

---

### Overview

You have a working dApp on a public blockchain (Ethereum, Solana, etc.) and want to add privacy without rewriting everything. Midnight's architecture allows you to retrofit privacy by moving sensitive operations to a Midnight compact contract while keeping your existing frontend and user flow.

### What You'll Learn

- Identifying what needs privacy vs what can stay public
- Hybrid architecture: public chain + Midnight
- Building a privacy shim layer
- Migration strategies for existing users

### Architecture: Hybrid Approach

```
                  ┌──────────────┐
                  │  Your dApp   │
                  │  Frontend    │
                  └──────┬───────┘
                         │
              ┌──────────┴──────────┐
              │                     │
     ┌────────▼────────┐   ┌───────▼────────┐
     │  Public Chain   │   │  Midnight      │
     │  (Ethereum/etc) │   │  (Privacy)     │
     │                 │   │                │
     │ - Identity      │   │ - Balances     │
     │ - Non-sensitive │   │ - Transactions │
     │ - Access control│   │ - User data    │
     └─────────────────┘   └────────────────┘
```

### Step 1: Audit What Needs Privacy

| Data | Example | Keep Public? | Move to Midnight? |
|------|---------|-------------|-------------------|
| User wallet address | 0xabc...def | ✅ Identity | |
| Token balance | 1,000 TOKEN | | ✅ Transaction value |
| Transaction history | Sent 100 to 0x... | | ✅ Privacy-sensitive |
| Vote/choice | Yes/No | | ✅ Ballot secrecy |
| Reputation score | 4.2/5 | ✅ Aggregated only | |
| Personal data | Email, KYC | | ✅ Encrypted |

### Step 2: Privacy Shim Contract

```javascript
// contracts/privacy-shim/index.compact

import { LEDGER, SEED, VERIFIER } from "std";

struct PrivacyState {
    shieldedBalances: Map<[u8; 32], u64>;  // userPubKey -> balance
    pendingActions: Map<[u8; 32], Action>;
    userNonces: Map<[u8; 32], u64>;
}

struct Action {
    actionType: u8;  // 1=transfer, 2=vote, 3=update
    data: [u8; 64];
    timestamp: u64;
}

export const PrivacyShim = contract(() => {
    const state: PrivacyState;
    
    // Map public chain address -> Midnight public key
    const linkedAccounts: Map<address, [u8; 32]>;
    
    // Map public chain identity to Midnight identity
    export function linkAccount(
        publicChainAddr: address,
        midnightPubKey: [u8; 32],
        proof: [u8; 128]
    ): void {
        // Verify ownership — user signs with both keys
        require(
            VERIFIER.verifyLinkage(publicChainAddr, midnightPubKey, proof),
            "Invalid ownership proof"
        );
        linkedAccounts.set(publicChainAddr, midnightPubKey);
    }
    
    // Shield tokens from public chain to Midnight
    export function shieldTokens(
        publicChainTxId: [u8; 32],
        amount: u64,
        merkleProof: [u8; 256]
    ): void {
        const userKey = linkedAccounts.get(SEED.publicKey);
        require(userKey !== null, "Link your account first");
        
        // Verify the public chain deposit happened
        require(
            VERIFIER.verifyMerkleProof(publicChainTxId, merkleProof),
            "Invalid deposit proof"
        );
        
        // Credit shielded balance
        const current = state.shieldedBalances.get(userKey) ?? 0;
        state.shieldedBalances.set(userKey, current + amount);
        
        emit("Shielded", userKey, amount);
    }
    
    // Private transfer (visible only to sender & receiver)
    export function privateTransfer(
        to: [u8; 32],
        amount: u64,
        encryptedData: [u8; 128]
    ): void {
        const sender = linkedAccounts.get(SEED.publicKey);
        require(sender !== null, "Link account first");
        
        const senderBal = state.shieldedBalances.get(sender) ?? 0;
        require(senderBal >= amount, "Insufficient shielded balance");
        
        // Deduct from sender
        state.shieldedBalances.set(sender, senderBal - amount);
        
        // Credit receiver (encrypted — only receiver sees new balance)
        const receiverBal = state.shieldedBalances.get(to) ?? 0;
        state.shieldedBalances.set(to, receiverBal + amount);
        
        // Store encrypted memo (visible to both parties)
        state.pendingActions.set(SEED.publicKey, Action(
            1, encryptedData, SEED.timestamp
        ));
        
        emit("PrivateTransfer", sender, to, amount);
    }
});
```

### Step 3: Frontend Integration

```typescript
// privacy-shim-client.ts

import { MidnightProvider } from '@midnight-ntwrk/midnight-js';

class PrivacyShimClient {
  private provider: MidnightProvider;
  
  constructor() {
    this.provider = new MidnightProvider({
      network: 'testnet',
      seed: localStorage.getItem('midnight_seed')
    });
  }
  
  // Step 1: Link existing wallet
  async linkExistingWallet(ethereumAddress: string, signature: string) {
    return await this.provider.call('privacy-shim', 'linkAccount', [
      ethereumAddress,
      await this.provider.getPublicKey(),
      signature
    ]);
  }
  
  // Step 2: Shield tokens
  async shieldTokens(amount: bigint, depositTxHash: string) {
    // Verify deposit on Ethereum
    const merkleProof = await this.getMerkleProof(depositTxHash);
    
    return await this.provider.call('privacy-shim', 'shieldTokens', [
      depositTxHash,
      amount,
      merkleProof
    ]);
  }
  
  // Step 3: Transfer privately
  async privateTransfer(toPubKey: string, amount: bigint) {
    const encrypted = await this.encryptData(
      JSON.stringify({ amount, timestamp: Date.now() }),
      toPubKey
    );
    
    return await this.provider.call('privacy-shim', 'privateTransfer', [
      toPubKey,
      amount,
      encrypted
    ]);
  }
  
  private async getMerkleProof(txHash: string): Promise<string> {
    // Query public chain for proof
    const response = await fetch(`https://api.etherscan.io/api?module=proxy&action=eth_getTransactionReceipt&txhash=${txHash}`);
    const receipt = await response.json();
    // Convert to Merkle proof format
    return this.buildMerkleProof(receipt.result);
  }
  
  private async encryptData(data: string, pubKey: string): Promise<Uint8Array> {
    // Use Midnight's encryption for end-to-end privacy
    return await this.provider.encrypt(data, pubKey);
  }
}
```

### Step 4: Migration Strategy

```bash
# Phase 1: Deploy privacy shim alongside existing contract
midnight contract deploy privacy-shim ... --network testnet

# Phase 2: Existing users link accounts
# (One-time action in dApp UI)

# Phase 3: New users get privacy by default
# Update deploy script to require privacy shim link

# Phase 4: (Optional) Deprecate public chain storage
# Move all sensitive state to Midnight
```

### Step 5: UI Integration

```typescript
// React component example
function PrivacySettings({ userAddress }: { userAddress: string }) {
  const [shieldedBalance, setShieldedBalance] = useState(0n);
  const [isLinked, setIsLinked] = useState(false);
  
  useEffect(() => {
    checkLinkStatus(userAddress).then(setIsLinked);
    getShieldedBalance().then(setShieldedBalance);
  }, [userAddress]);
  
  return (
    <div className="privacy-settings">
      <h3>🔒 Privacy Shield</h3>
      
      {!isLinked ? (
        <button onClick={linkAccount}>
          Link Account for Privacy
        </button>
      ) : (
        <>
          <p>Shielded Balance: {shieldedBalance.toString()} sNIGHT</p>
          <button onClick={() => shieldTokens(1000n)}>
            Shield 1000 Tokens
          </button>
          <button onClick={privateTransfer}>
            Send Private Transaction
          </button>
        </>
      )}
    </div>
  );
}
```

### Summary

| Phase | Action | Timeline |
|-------|--------|----------|
| 1 | Audit & identify private data | Day 1 |
| 2 | Deploy PrivacyShim contract | Day 2-3 |
| 3 | Add link-account flow to UI | Day 3-5 |
| 4 | Let users shield existing balances | Day 5-7 |
| 5 | Deprecate public sensitive state | Week 2+ |

Retrofitting privacy doesn't require a full rewrite. A shim contract between your public chain logic and Midnight gives users choice about which data stays private.
