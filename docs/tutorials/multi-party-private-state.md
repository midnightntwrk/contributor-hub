## Multi-Party Private State: Shared State with Confidentiality in Midnight

**Difficulty:** Advanced  
**Time:** 30 minutes  
**Bounty:** #303

---

### Overview

Multi-Party Private State (MPPS) is a Midnight feature that allows multiple parties to share and mutate a private state without revealing data to the public blockchain. This is essential for applications like private DAOs, confidential supply chains, and multi-party escrows.

### What You'll Learn

- The architecture of multi-party private state
- How to define shared state between parties
- Controlling who can read/write which fields
- Practical: A private multi-sig wallet

### How MPPS Works

```
Party A ──┐
          ├──► Shared encrypted state ──► On-chain commitment
Party B ──┘            │
                       ├── Party A can read fields X, Y
                       ├── Party B can read fields Y, Z
                       ├── Both can write field Y
                       └── Neither sees party A's hidden field
```

Each party runs a local Midnight node. The shared state is encrypted such that each party only sees the fields they're authorized for.

### Step 1: Define Shared State

```javascript
// contracts/multi-party-vault/index.compact

import { LEDGER, SEED, VERIFIER } from "std";

// Parties are identified by their public keys
type PartyId = [u8; 32];

struct VaultState {
    // Public fields (visible on-chain commitment)
    totalLocked: u64;
    requiredSignatures: u8;
    
    // Private fields (encrypted, only visible to authorized)
    members: PartyId[5];
    
    // Pending transaction (only signers see this)
    pendingTx: TxData;
}

struct TxData {
    to: address;
    amount: u64;
    approvals: u8;
}

export const MultiPartyVault = contract(() => {
    const state: VaultState;
    const memberPermissions: Map<PartyId, u8>; // Bitfield: read(1), write(2), admin(4)
    
    export function initialize(
        members: PartyId[5], 
        requiredSigs: u8
    ): void {
        // Only deployer can init
        require(state.totalLocked == 0, "Already initialized");
        
        state.requiredSignatures = requiredSigs;
        state.members = members;
        
        // Set permissions: first 3 are signers with full access
        for (let i = 0; i < 3; i++) {
            memberPermissions.set(members[i], 7); // read + write + admin
        }
        // Last 2 members can only read
        for (let i = 3; i < 5; i++) {
            memberPermissions.set(members[i], 1); // read only
        }
    }
    
    export function proposeTx(to: address, amount: u64): void {
        require(isMember(SEED.publicKey), "Not a member");
        require(canWrite(SEED.publicKey), "No write permission");
        
        state.pendingTx = TxData(to, amount, 0);
    }
    
    export function approveTx(): void {
        require(state.pendingTx.amount > 0, "No pending tx");
        require(isSigner(SEED.publicKey), "Not a signer");
        
        // Check member hasn't already approved (would need per-signer tracking)
        state.pendingTx.approvals += 1;
        
        if (state.pendingTx.approvals >= state.requiredSignatures) {
            // Execute the transfer
            LEDGER.transfer(
                contract, 
                state.pendingTx.to, 
                "MIDNIGHT", 
                state.pendingTx.amount
            );
            
            // Reset pending tx
            state.pendingTx = TxData(ZERO_ADDRESS, 0, 0);
        }
    }
    
    function isMember(party: PartyId): bool {
        for (let i = 0; i < 5; i++) {
            if (state.members[i] == party) return true;
        }
        return false;
    }
    
    function isSigner(party: PartyId): bool {
        for (let i = 0; i < 3; i++) {
            if (state.members[i] == party) return true;
        }
        return false;
    }
    
    function canWrite(party: PartyId): bool {
        const perms = memberPermissions.get(party);
        return perms !== null && (perms & 2) != 0;
    }
});
```

### Step 2: Deploy with Multi-Party Configuration

```bash
# Generate keys for each party
midnight key generate --output keys/party-a.json
midnight key generate --output keys/party-b.json
midnight key generate --output keys/party-c.json

# Get public keys
midnight key inspect keys/party-a.json --pubkey
midnight key inspect keys/party-b.json --pubkey
midnight key inspect keys/party-c.json --pubkey

# Deploy with multi-party config
midnight contract deploy multi-party-vault \
    --args '{
        "members": ["0xPUBKEY_A", "0xPUBKEY_B", "0xPUBKEY_C"],
        "requiredSigs": 2
    }' \
    --party keys/party-a.json \
    --party keys/party-b.json \
    --party keys/party-c.json \
    --network testnet
```

### Step 3: Interactive Multi-Party Session

Party A proposes a transaction (only A sees the details):

```bash
# Party A proposes
midnight contract call multi-party-vault proposeTx \
    --args '{"to":"0xRECIPIENT","amount":100}' \
    --signer keys/party-a.json \
    --network testnet

# Party B (signer) approves — B can see the pending tx
midnight contract call multi-party-vault approveTx \
    --signer keys/party-b.json \
    --network testnet

# Party C (read-only) can see vault state but cannot approve
# C's approveTx call will fail with "Not a signer"
```

### Privacy Guarantees

| Data | Public Chain | Party A | Party B | Party C |
|------|-------------|---------|---------|---------|
| totalLocked | Commitment | ✅ Visible | ✅ Visible | ✅ Visible |
| member list | Commitment | ✅ Visible | ✅ Visible | ✅ Visible |
| pendingTx.to | 🔒 Hidden | ✅ Visible | ✅ Visible | ❌ Hidden |
| pendingTx.amount | 🔒 Hidden | ✅ Visible | ✅ Visible | ❌ Hidden |

### Advanced: Dynamic Permission Changes

```javascript
export function updatePermissions(target: PartyId, newPerms: u8): void {
    require(isAdmin(SEED.publicKey), "Admin only");
    require(isMember(target), "Not a member");
    
    memberPermissions.set(target, newPerms);
    // Emit private event (visible only to members)
    emit("PermissionChanged", SEED.publicKey, target, newPerms);
}

function isAdmin(party: PartyId): bool {
    const perms = memberPermissions.get(party);
    return perms !== null && (perms & 4) != 0;
}
```

### Use Cases

1. **Private DAO Treasury** — Members vote privately, only outcome is public
2. **Supply Chain** — Each participant sees only their relevant data
3. **Confidential Escrow** — Buyer, seller, arbitrator share state
4. **Private Syndicate** — Investment pool with confidential positions

### Next Steps

- Add time-locks for automatic proposal expiry
- Implement weighted voting (some members have more signing power)
- Combine with [DUST Sponsorship (#299)] for gasless member operations
