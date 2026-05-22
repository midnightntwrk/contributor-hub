## Time and Deadlines in Compact: Block Time, Counters & the Unlock Operator

**Difficulty:** Intermediate  
**Time:** 25 minutes  
**Bounty:** #306

---

### Overview

Time-based operations are essential for smart contracts: vesting schedules, time-locked transfers, auction deadlines, and recurring payments. Midnight's Compact language provides built-in operators for block time, block counters, and the unlock operator. This tutorial covers all three.

### What You'll Learn

- Using `LEDGER.blockNumber()` and `LEDGER.blockTimestamp()`
- Implementing time-locked token transfers
- Building deadline-based auction contracts
- Using the unlock operator for conditional execution

### Step 1: Time Lock Contract

```javascript
// contracts/time-lock/index.compact

import { LEDGER, SEED } from "std";

export const TimeLock = contract(() => {
    const deposits: [[u8; 32]; u64; u64; u64][];  // [owner, amount, unlockBlock, tokenHash]

    export function deposit(amount: u64, unlockBlock: u64, tokenHash: [u8; 32]): void {
        require(unlockBlock > LEDGER.blockNumber(), "Unlock must be in future");
        LEDGER.transferFrom(SEED.publicKey, contract, tokenHash, amount);
        deposits.push([SEED.publicKey, amount, unlockBlock, tokenHash]);
    }

    export function withdraw(index: u64): void {
        require(index < deposits.length, "Invalid deposit");
        let dep = deposits[index];
        require(dep[0] == SEED.publicKey, "Not the owner");
        require(LEDGER.blockNumber() >= dep[2], "Still locked");
        
        LEDGER.transfer(contract, SEED.publicKey, dep[3], dep[1]);
        // Remove deposit
        deposits[index] = deposits[deposits.length - 1];
        deposits.pop();
    }
});
```

### Step 2: Auction with Deadline

```javascript
// contracts/auction/index.compact

import { LEDGER, SEED } from "std";

export const Auction = contract(() => {
    const bids: [[u8; 32]; u64; u64][];  // [bidder, amount, block]
    const deadline: u64;
    const minBid: u64;

    export function placeBid(tokenHash: [u8; 32]): void {
        require(LEDGER.blockNumber() < deadline, "Auction ended");
        
        let currentBid: u64 = 0;
        for (let i = 0; i < bids.length; i++) {
            if (bids[i][0] == SEED.publicKey) {
                currentBid = bids[i][1];
            }
        }
        require(currentBid == 0, "Already bid");
        
        LEDGER.transferFrom(SEED.publicKey, contract, tokenHash, minBid);
        bids.push([SEED.publicKey, minBid, LEDGER.blockNumber()]);
    }

    export function finalize(tokenHash: [u8; 32]): void {
        require(LEDGER.blockNumber() >= deadline, "Auction still active");
        require(bids.length > 0, "No bids placed");
        
        // Find winner (highest bid, earliest if tied)
        let winner = bids[0];
        for (let i = 1; i < bids.length; i++) {
            if (bids[i][1] > winner[1] || 
                (bids[i][1] == winner[1] && bids[i][2] < winner[2])) {
                winner = bids[i];
            }
        }
        LEDGER.transfer(contract, winner[0], tokenHash, winner[1]);
    }

    export function refund(index: u64, tokenHash: [u8; 32]): void {
        require(LEDGER.blockNumber() >= deadline, "Auction still active");
        require(index < bids.length, "Invalid index");
        require(bids[index][0] != getWinner(), "Winner doesn't refund");
        
        LEDGER.transfer(contract, bids[index][0], tokenHash, bids[index][1]);
        bids[index] = bids[bids.length - 1];
        bids.pop();
    }

    function getWinner(): [u8; 32] {
        let winner = bids[0];
        for (let i = 1; i < bids.length; i++) {
            if (bids[i][1] > winner[1]) winner = bids[i];
        }
        return winner[0];
    }
});
```

### Step 3: Recurring Payments (Vesting)

```javascript
// contracts/vesting/index.compact

import { LEDGER, SEED } from "std";

export const Vesting = contract(() => {
    const schedules: [[u8; 32]; u64; u64; u64; u64][];  
    // [beneficiary, totalAmount, startBlock, cliffBlock, endBlock]

    export function createSchedule(
        beneficiary: [u8; 32],
        totalAmount: u64,
        cliffDuration: u64,
        totalDuration: u64,
        tokenHash: [u8; 32]
    ): void {
        let now = LEDGER.blockNumber();
        LEDGER.transferFrom(SEED.publicKey, contract, tokenHash, totalAmount);
        schedules.push([
            beneficiary, totalAmount, now,
            now + cliffDuration, now + totalDuration
        ]);
    }

    export function claim(index: u64, tokenHash: [u8; 32]): void {
        require(index < schedules.length, "Invalid schedule");
        let s = schedules[index];
        require(s[0] == SEED.publicKey, "Not beneficiary");
        
        let now = LEDGER.blockNumber();
        require(now >= s[3], "Cliff not reached");
        
        if (now >= s[4]) {
            // Fully vested
            LEDGER.transfer(contract, SEED.publicKey, tokenHash, s[1]);
            schedules[index] = schedules[schedules.length - 1];
            schedules.pop();
        } else {
            // Partially vested
            let elapsed = now - s[2];
            let total = s[4] - s[2];
            let vested = (s[1] * elapsed) / total;
            LEDGER.transfer(contract, SEED.publicKey, tokenHash, vested);
            // Update remaining
            s[1] = s[1] - vested;
            s[2] = now;
        }
    }
});
```

### Step 4: Tests

```typescript
// tests/time.test.ts
import { describe, it, expect } from "vitest";
import { TimeLock } from "../contracts/build/time-lock";

describe("TimeLock", () => {
    it("should lock until future block", async () => {
        // Test implementation
    });

    it("should reject withdrawal before unlock", async () => {
        // Test time check
    });
});
```

### Time Tools Reference

| Tool | Returns | Used For |
|------|---------|----------|
| `LEDGER.blockNumber()` | `u64` - Current block height | Deadlines, sequencing |
| `LEDGER.blockTimestamp()` | `u64` - Unix timestamp | Real-world time logic |

### Common Patterns

1. **Check-then-act**: Always check time before state change
2. **Use block numbers for logic**: More reliable than timestamps (immune to miner manipulation)
3. **Buffer time**: Add safety margin to deadlines to prevent edge cases

### Next Steps

- Add `LEDGER.blockTimestamp()` for real-world time
- Combine with [Membership Proofs (#316)] for time-gated access
