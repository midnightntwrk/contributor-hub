## Concurrent Transactions on Midnight: UTXO Race Conditions and How to Avoid Them

**Difficulty:** Intermediate  
**Time:** 20 minutes  
**Bounty:** #301

---

### Overview

Midnight uses a UTXO-based model for transactions. Unlike account-based blockchains (Ethereum) where nonces serialize transactions, UTXO naturally supports concurrency — but this introduces race conditions. Two users spending the same UTXO cause one to fail. This tutorial covers how to design contracts that handle concurrency gracefully.

### What You'll Learn

- How UTXO concurrency differs from account-based models
- Common race condition patterns
- Designing nonce-like serialization for Midnight
- Handling failed transactions gracefully

### UTXO vs Account Model

| Feature | Ethereum (Account) | Midnight (UTXO) |
|---------|-------------------|-----------------|
| State model | Global account state | Unspent transaction outputs |
| Concurrency | Serial (nonce) | Parallel (by UTXO) |
| Race condition | Same nonce → tx rejected | Same UTXO → tx rejected |
| Max throughput | ~15-30 tps (serial) | Higher (parallel by design) |
| Beneficial for | Simple transfers | Multi-user dApps |

### How a Race Condition Happens

```
User A creates UTXO1 (100 tokens)
          │
     ┌────┴────┐
     │         │
User B       User C
spends       spends
UTXO1        UTXO1
  │            │
  ▼            ▼
Tx B        Tx C
submitted   submitted
(same UTXO) (same UTXO)
  │            │
  ▼            ▼
Miners include Tx B ✅
Miners reject Tx C ❌ (UTXO already spent)
```

### Step 1: Simple UTXO Contract

```javascript
// contracts/token-utxo/index.compact

import { LEDGER, SEED, VERIFIER } from "std";

export const TokenUTXO = contract(() => {
    // Each UTXO is a unique identifier
    const utxos: Map<[u8; 32], UTXOData>;
    
    struct UTXOData {
        owner: [u8; 32];
        amount: u64;
        nonce: u64;  // For ordering
    }
    
    // Create a new UTXO
    export function mint(amount: u64): void {
        const utxoId = hash(SEED.publicKey, SEED.height, amount);
        utxos.set(utxoId, UTXOData(SEED.publicKey, amount, 0));
        emit("Minted", utxoId, SEED.publicKey, amount);
    }
    
    // Spend one UTXO to create another (simple transfer)
    export function transfer(
        fromUtxo: [u8; 32],
        toUser: [u8; 32],
        amount: u64
    ): void {
        const utxo = utxos.get(fromUtxo);
        require(utxo !== null, "UTXO not found");
        require(utxo.owner == SEED.publicKey, "Not your UTXO");
        require(utxo.amount >= amount, "Insufficient");
        
        // Remove old UTXO
        utxos.delete(fromUtxo);
        
        // Create new UTXO for recipient
        const newUtxoId = hash(toUser, SEED.height, amount);
        utxos.set(newUtxoId, UTXOData(toUser, amount, 0));
        
        // Create change UTXO for sender (if any)
        const change = utxo.amount - amount;
        if (change > 0) {
            const changeId = hash(SEED.publicKey, SEED.height, change);
            utxos.set(changeId, UTXOData(SEED.publicKey, change, 0));
        }
    }
});
```

### Step 2: Race Condition Demo

```typescript
// race-condition-demo.ts

async function demonstrateRaceCondition() {
    const provider = await setupProvider();
    const contract = await deployContract(provider);
    
    // Mint a UTXO with 100 tokens
    await contract.call('mint', [100n]);
    
    // Both users try to spend the same UTXO simultaneously
    // This simulates a race condition
    const results = await Promise.allSettled([
        contract.call('transfer', [utxoId, bobAddress, 30n]),
        contract.call('transfer', [utxoId, charlieAddress, 40n]),
    ]);
    
    results.forEach((result, i) => {
        if (result.status === 'fulfilled') {
            console.log(`User ${i + 1}: Transaction succeeded ✅`);
        } else {
            console.log(`User ${i + 1}: Transaction failed ❌ - ${result.reason}`);
        }
    });
    // Output:
    // User 1: Transaction succeeded ✅
    // User 2: Transaction failed ❌ - UTXO already spent
}
```

### Step 3: Nonce-Based Serialization

Add a nonce system to serialize transactions for the same user:

```javascript
// contracts/nonce-utxo/index.compact

export const NonceUTXO = contract(() => {
    const userNonces: Map<[u8; 32], u64>;  // user -> next expected nonce
    const utxos: Map<[u8; 32], UTXOData>;
    
    struct UTXOData {
        owner: [u8; 32];
        amount: u64;
        nonce: u64;
    }
    
    // Transfer with nonce for ordering
    export function transferWithNonce(
        fromUtxo: [u8; 32],
        toUser: [u8; 32],
        amount: u64,
        expectedNonce: u64
    ): void {
        const utxo = utxos.get(fromUtxo);
        require(utxo !== null, "UTXO not found");
        require(utxo.owner == SEED.publicKey, "Not your UTXO");
        require(utxo.amount >= amount, "Insufficient");
        
        // Check nonce — prevents out-of-order execution
        const currentNonce = userNonces.get(SEED.publicKey) ?? 0;
        require(expectedNonce == currentNonce, 
            "Invalid nonce: expected " + currentNonce);
        
        // Increment nonce
        userNonces.set(SEED.publicKey, currentNonce + 1);
        
        // Remove old UTXO
        utxos.delete(fromUtxo);
        
        // Create new UTXO with nonce for traceability
        const newUtxoId = hash(toUser, SEED.height, amount, currentNonce);
        utxos.set(newUtxoId, UTXOData(toUser, amount, currentNonce));
        
        // Change UTXO
        const change = utxo.amount - amount;
        if (change > 0) {
            const changeId = hash(
                SEED.publicKey, SEED.height, change, currentNonce
            );
            utxos.set(changeId, UTXOData(
                SEED.publicKey, change, currentNonce
            ));
        }
        
        emit("TransferWithNonce", fromUtxo, toUser, amount, currentNonce);
    }
});
```

### Step 4: Client-Side Queue

```typescript
// transaction-queue.ts

interface QueuedTx {
    id: string;
    fn: () => Promise<any>;
    priority: number;
    nonce: number;
}

export class TransactionQueue {
    private queue: QueuedTx[] = [];
    private processing = false;
    private currentNonce = 0;
    private maxRetries = 3;
    
    async enqueue(fn: () => Promise<any>, priority = 0): Promise<any> {
        const nonce = this.currentNonce++;
        
        return new Promise((resolve, reject) => {
            this.queue.push({
                id: crypto.randomUUID(),
                fn,
                priority,
                nonce,
            });
            
            // Sort by priority (higher first) then by nonce
            this.queue.sort((a, b) => 
                b.priority - a.priority || a.nonce - b.nonce
            );
            
            this.processQueue().then(resolve, reject);
        });
    }
    
    private async processQueue(): Promise<any> {
        if (this.processing) return;
        this.processing = true;
        
        while (this.queue.length > 0) {
            const tx = this.queue.shift()!;
            
            for (let attempt = 0; attempt < this.maxRetries; attempt++) {
                try {
                    const result = await tx.fn();
                    console.log(`✅ Tx ${tx.id.slice(0, 8)} succeeded`);
                    return result;
                } catch (error: any) {
                    if (error.message?.includes('UTXO already spent')) {
                        // Race condition! Retry with backoff
                        console.log(`⚠️  Race on ${tx.id.slice(0, 8)}, retrying...`);
                        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
                        continue;
                    }
                    throw error;  // Non-retryable error
                }
            }
            
            throw new Error(`Tx ${tx.id.slice(0, 8)} failed after ${this.maxRetries} retries`);
        }
        
        this.processing = false;
    }
}

// Usage
const queue = new TransactionQueue();

async function safeTransfer(amount: bigint, to: string) {
    return await queue.enqueue(async () => {
        return await contract.call('transferWithNonce', [
            currentUtxo, to, amount, queue.currentNonce
        ]);
    });
}
```

### Step 5: Split Large UTXOs

Prevent "all eggs in one basket" by splitting large UTXOs:

```javascript
export function splitUtxo(
    sourceUtxo: [u8; 32],
    parts: u64[]
): void {
    const utxo = utxos.get(sourceUtxo);
    require(utxo !== null, "UTXO not found");
    require(utxo.owner == SEED.publicKey, "Not your UTXO");
    
    const total: u64 = parts.reduce((a, b) => a + b, 0);
    require(total == utxo.amount, "Parts must sum to UTXO amount");
    
    // Remove source
    utxos.delete(sourceUtxo);
    
    // Create multiple smaller UTXOs
    for (let i = 0; i < parts.length; i++) {
        const id = hash(
            SEED.publicKey, SEED.height, parts[i], i
        );
        utxos.set(id, UTXOData(SEED.publicKey, parts[i], i));
    }
    
    emit("UtxoSplit", sourceUtxo, parts.length);
}
```

### Best Practices

| Pattern | Description |
|---------|-------------|
| **Nonce ordering** | Serialize transactions per user |
| **UTXO splitting** | Create multiple small UTXOs for concurrency |
| **Client-side queue** | Serialize requests from each client |
| **Retry with backoff** | Catch race conditions, retry with delay |
| **Event watching** | Wait for confirmation before submitting next tx |
| **Batch operations** | Combine multiple operations in one call |

### Summary

- UTXO model enables concurrent transactions but introduces race conditions
- Use nonces to serialize transactions per user
- Split large UTXOs to enable parallel spending
- Implement client-side queues with retry logic
- Watch for UTXO-spent events before submitting dependent transactions
