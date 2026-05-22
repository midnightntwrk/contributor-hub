## DUST Sponsorship: How One Wallet Pays Fees for Another User

**Difficulty:** Beginner-Intermediate  
**Time:** 20 minutes  
**Bounty:** #299

---

### Overview

In Midnight, every transaction requires DUST tokens to pay for proof generation and verification. DUST sponsorship allows one wallet to cover fees for another user, enabling "gasless" transactions for end users. This is critical for onboarding non-technical users and building consumer-friendly dApps.

### What You'll Learn

- How DUST sponsorship works in Midnight
- Setting up a sponsorship wallet
- Sponsored transaction flow
- Testing sponsorship scenarios

### How DUST Sponsorship Works

```
1. Sponsor deposits DUST into a sponsorship contract
2. User submits a transaction WITHOUT DUST balance
3. Contract validates the sponsor's DUST deposit
4. Proof server deducts DUST from the sponsor's deposit
5. Transaction executes successfully
```

### Step 1: Sponsorship Contract

```javascript
// contracts/dust-sponsor/index.compact

import { LEDGER, SEED } from "std";

export const DustSponsor = contract(() => {
    const allocations: [[u8; 32]; u64; u64][];  
    // [sponsor, maxPerTx, totalAllocated]

    export function allocate(maxPerTx: u64, total: u64): void {
        LEDGER.transferFrom(SEED.publicKey, contract, "DUST", total);
        allocations.push([SEED.publicKey, maxPerTx, total]);
    }

    export function sponsorTx(user: [u8; 32], cost: u64): void {
        require(cost > 0, "Cost must be positive");
        require(user == SEED.publicKey, "Only user can claim");
        
        for (let i = 0; i < allocations.length; i++) {
            if (allocations[i][1] >= cost && allocations[i][2] >= cost) {
                allocations[i][2] -= cost;
                LEDGER.transfer(contract, LEDGER.proofServer(), "DUST", cost);
                return;
            }
        }
        require(false, "No sponsor with sufficient allocation");
    }
});
```

### Step 2: Sponsor CLI

```bash
# Sponsor allocates DUST
midnight contract call dust-sponsor allocate \
  --args '{"maxPerTx":100,"total":10000}' \
  --network testnet

# User submits sponsored tx
midnight contract call dust-sponsor sponsorTx \
  --args '{"user":"0xUSER...","cost":50}' \
  --network testnet

# Check remaining allocation
midnight contract query dust-sponsor
```

### Business Models

| Model | Description | Example |
|-------|-------------|---------|
| Freemium | Free tier sponsored, premium pays own DUST | dApp onboarding |
| Subscription | Monthly DUST allowance for users | SaaS dApps |
| Ad-Sponsored | Ads pay for user transactions | Gaming dApps |
| Delegation | Large holders sponsor community | DAO operations |

### Next Steps

- Add per-user spending limits to prevent abuse
- Implement a DUST faucet for testnet onboarding
- Combine with [Time Locks (#306)] for subscription-based sponsorship
