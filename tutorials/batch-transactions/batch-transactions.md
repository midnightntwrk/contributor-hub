# Building Batch Transactions: Multi-Recipient Settlements & Complex Flows on Midnight

**By billbtbillb | May 2026**

Sending tokens to one person is easy. Sending to fifty people at once—without blowing up your transaction or losing funds halfway through—requires understanding how Midnight actually processes batch operations under the hood.

This tutorial covers composing multi-party transactions, executing multiple operations atomically, handling block weight limits (error 1010), splitting large batches across transactions, and the critical difference between guaranteed and fallible transaction segments.

## Prerequisites

- Midnight toolchain installed ([installation guide](https://docs.midnight.network/getting-started/installation))
- Node.js v22+
- Familiarity with Compact syntax basics ([hello world tutorial](https://docs.midnight.network/getting-started/hello-world))
- A funded wallet on Midnight testnet (or local devnet running)

## 1. Understanding Midnight's Transaction Architecture

Every Midnight transaction has a **two-phase execution model**:

```
┌─────────────────────────────────────────────────┐
│                  Transaction                      │
│  ┌──────────────────┐  ┌──────────────────────┐ │
│  │   Guaranteed      │  │     Fallible          │ │
│  │   Segment         │  │     Segment           │ │
│  │                   │  │                       │ │
│  │ • Fee deduction   │  │ • Contract calls      │ │
│  │ • Critical ops    │  │ • Token sends         │ │
│  │ • MUST succeed    │  │ • Rolls back on fail  │ │
│  └──────────────────┘  └──────────────────────┘ │
└─────────────────────────────────────────────────┘
```

- **Guaranteed segment**: Executes first. Fees are paid here. If this fails, the entire transaction is rejected. Use this for operations that *must* complete—typically fee-related and critical state updates.

- **Fallible segment**: Executes after guaranteed succeeds. If any operation here fails, the entire fallible segment rolls back atomically, but the guaranteed segment (and fee payment) still stands. Use this for business logic that might legitimately fail.

This separation is fundamental to building safe batch operations.

## 2. Composing Multi-Party Transactions

The simplest batch pattern: sending tokens to multiple recipients in a single transaction. In Compact, you chain `sendUnshielded` calls within one circuit.

### Compact Contract: Multi-Recipient Distribution

Create `contracts/distribute.compact`:

```compact
pragma language_version >= 0.23;

import CompactStandardLibrary;

// Domain separator for our token
const DOMAIN: Bytes<32> = pad(32, "distribute:v1");

// Ledger state to track total distributed amount
export ledger totalDistributed: Uint<128>;
export ledger distributionCount: Uint<64>;

// Mint tokens to the contract for later distribution
export circuit mintToContract(amount: Uint<64>): [] {
    const color = mintUnshieldedToken(
        disclose(DOMAIN),
        disclose(amount),
        left<ContractAddress, UserAddress>(kernel.self())
    );
}

// Distribute tokens to up to 5 recipients in a single transaction
// Each recipient gets the same `amountPerRecipient`
export circuit distributeEqual(
    amountPerRecipient: Uint<64>,
    recipient1: UserAddress,
    recipient2: UserAddress,
    recipient3: UserAddress,
    recipient4: UserAddress,
    recipient5: UserAddress
): [] {
    const color = tokenType(disclose(DOMAIN), kernel.self());
    const amount = disclose(amountPerRecipient) as Uint<128>;

    // Send to each recipient — all execute atomically
    sendUnshielded(color, amount, right<ContractAddress, UserAddress>(disclose(recipient1)));
    sendUnshielded(color, amount, right<ContractAddress, UserAddress>(disclose(recipient2)));
    sendUnshielded(color, amount, right<ContractAddress, UserAddress>(disclose(recipient3)));
    sendUnshielded(color, amount, right<ContractAddress, UserAddress>(disclose(recipient4)));
    sendUnshielded(color, amount, right<ContractAddress, UserAddress>(disclose(recipient5)));

    // Update ledger state
    totalDistributed = totalDistributed + (amount * (5 as Uint<128>));
    distributionCount = distributionCount + (1 as Uint<64>);
}

// Distribute different amounts to 3 recipients
export circuit distributeCustom(
    amount1: Uint<64>,
    recipient1: UserAddress,
    amount2: Uint<64>,
    recipient2: UserAddress,
    amount3: Uint<64>,
    recipient3: UserAddress
): [] {
    const color = tokenType(disclose(DOMAIN), kernel.self());

    sendUnshielded(color, disclose(amount1) as Uint<128>, right<ContractAddress, UserAddress>(disclose(recipient1)));
    sendUnshielded(color, disclose(amount2) as Uint<128>, right<ContractAddress, UserAddress>(disclose(recipient2)));
    sendUnshielded(color, disclose(amount3) as Uint<128>, right<ContractAddress, UserAddress>(disclose(recipient3)));

    totalDistributed = totalDistributed
        + (disclose(amount1) as Uint<128>)
        + (disclose(amount2) as Uint<128>)
        + (disclose(amount3) as Uint<128>);
    distributionCount = distributionCount + (3 as Uint<64>);
}
```

**Key points:**
- All `sendUnshielded` calls within a circuit execute atomically—either all succeed or all fail
- The contract holds tokens and redistributes them
- `disclose()` is required for any private data that interacts with public ledger state
- The `as Uint<128>` cast is needed because `sendUnshielded` expects 128-bit amounts

### TypeScript Caller: Invoking the Distribution

```typescript
import { distributeEqual } from './managed/distribute/contract/index.js';
import type { DistributeContract } from './managed/distribute/contract/index.js';

async function batchDistribute(
    contract: DistributeContract,
    wallet: WalletAPI,
    recipients: string[],
    amountPerRecipient: bigint
) {
    // Collect 5 recipients (pad with first recipient if fewer)
    const padded = [...recipients];
    while (padded.length < 5) padded.push(recipients[0]);

    const tx = await contract.callTx.distributeEqual(
        amountPerRecipient,
        padded[0], padded[1], padded[2], padded[3], padded[4]
    );

    const result = await wallet.submitTransaction(tx.prove());
    console.log(`Distributed to ${recipients.length} recipients. TX: ${result}`);
}
```

## 3. Atomic Multi-Operation Execution: Escrow Pattern

Real-world batch operations often need atomic guarantees. Consider an escrow release: the seller gets paid and the platform gets its fee—both must succeed, or neither should.

### Compact Contract: Escrow with Platform Fee

Create `contracts/escrow.compact`:

```compact
pragma language_version >= 0.23;

import CompactStandardLibrary;

const TOKEN_DOMAIN: Bytes<32> = pad(32, "escrow:token");
const FEE_BPS: Uint<16> = 250; // 2.5% fee

export ledger escrowBalance: Uint<128>;
export ledger feeBalance: Uint<128>;
export ledger releasedCount: Uint<64>;

// Deposit tokens into escrow
export circuit deposit(amount: Uint<64>): [] {
    receiveUnshielded(tokenType(disclose(TOKEN_DOMAIN), kernel.self()), disclose(amount));
    escrowBalance = escrowBalance + (disclose(amount) as Uint<128>);
}

// Release escrow: pay seller and platform fee atomically
export circuit releaseEscrow(
    sellerAmount: Uint<64>,
    seller: UserAddress,
    feeRecipient: UserAddress
): [] {
    const color = tokenType(disclose(TOKEN_DOMAIN), kernel.self());
    const sellerAmt = disclose(sellerAmount) as Uint<128>;
    const feeAmt = (sellerAmt * (FEE_BPS as Uint<128>)) / (10000 as Uint<128>);

    // Both sends happen atomically — if either fails, both revert
    sendUnshielded(color, sellerAmt, right<ContractAddress, UserAddress>(disclose(seller)));
    sendUnshielded(color, feeAmt, right<ContractAddress, UserAddress>(disclose(feeRecipient)));

    // Update state only after both sends succeed
    escrowBalance = escrowBalance - sellerAmt - feeAmt;
    feeBalance = feeBalance + feeAmt;
    releasedCount = releasedCount + (1 as Uint<64>);
}

// Batch release: release multiple escrows in one transaction
export circuit batchRelease(
    seller1: UserAddress, amount1: Uint<64>,
    seller2: UserAddress, amount2: Uint<64>,
    seller3: UserAddress, amount3: Uint<64>,
    feeRecipient: UserAddress
): [] {
    const color = tokenType(disclose(TOKEN_DOMAIN), kernel.self());

    const a1 = disclose(amount1) as Uint<128>;
    const a2 = disclose(amount2) as Uint<128>;
    const a3 = disclose(amount3) as Uint<128>;

    const fee1 = (a1 * (FEE_BPS as Uint<128>)) / (10000 as Uint<128>);
    const fee2 = (a2 * (FEE_BPS as Uint<128>)) / (10000 as Uint<128>);
    const fee3 = (a3 * (FEE_BPS as Uint<128>)) / (10000 as Uint<128>);

    const feeAddr = right<ContractAddress, UserAddress>(disclose(feeRecipient));

    // All 6 sends are atomic
    sendUnshielded(color, a1, right<ContractAddress, UserAddress>(disclose(seller1)));
    sendUnshielded(color, fee1, feeAddr);
    sendUnshielded(color, a2, right<ContractAddress, UserAddress>(disclose(seller2)));
    sendUnshielded(color, fee2, feeAddr);
    sendUnshielded(color, a3, right<ContractAddress, UserAddress>(disclose(seller3)));
    sendUnshielded(color, fee3, feeAddr);

    escrowBalance = escrowBalance - a1 - a2 - a3 - fee1 - fee2 - fee3;
    releasedCount = releasedCount + (3 as Uint<64>);
}
```

**Why atomicity matters here:** If the platform fee send fails (e.g., invalid fee recipient address), the seller payment also reverts. You never end up in a state where the seller was paid but the platform didn't get its cut—or vice versa.

## 4. Block Weight Constraints and Error 1010

Midnight uses zero-knowledge proofs, and every circuit compiles into a proving circuit with a fixed number of rows (the "weight"). Each block has a maximum weight budget.

### What Is Error 1010?

Error 1010 occurs when a transaction's total proof weight exceeds the block's weight limit. This happens when you try to do too much in a single transaction—too many `sendUnshielded` calls, too complex a circuit, or too many contract interactions merged into one transaction.

### How Weight Accumulates

Each operation contributes to the transaction weight:

| Operation | Approximate Weight |
|-----------|-------------------|
| `sendUnshielded` | ~2,000–4,000 rows |
| `receiveUnshielded` | ~1,500–3,000 rows |
| `sendShielded` | ~8,000–15,000 rows |
| `mintUnshieldedToken` | ~3,000–5,000 rows |
| Ledger state read/write | ~500–1,000 rows |
| Arithmetic operations | ~100–500 rows |

A typical block can accommodate roughly **50,000–100,000 rows** of circuit weight. This means a single transaction with 20+ `sendUnshielded` calls can easily hit the limit.

### Recognizing the Error

When you hit the block weight limit, you'll see something like:

```
Error: Transaction rejected: block weight limit exceeded (error 1010)
  Transaction weight: 142,000
  Block weight limit: 100,000
```

### Strategies to Avoid Error 1010

**Strategy 1: Reduce per-transaction recipient count.** Instead of sending to 20 recipients in one circuit, send to 3–5 per circuit and use multiple transactions.

**Strategy 2: Use unshielded over shielded when privacy isn't required.** Shielded operations are 3–5x heavier than unshielded ones.

**Strategy 3: Minimize ledger state operations.** Each read/write adds weight. Batch your state updates.

**Strategy 4: Split circuits into focused operations.** A circuit that does 3 things is lighter than one that does 10.

## 5. Splitting Large Operations Across Transactions

When you need to distribute to 50+ recipients, you can't fit them all in one transaction. The solution: **chunked batch processing** with progress tracking.

### Compact Contract: Batch Split with Counter Tracking

Create `contracts/batch_split.compact`:

```compact
pragma language_version >= 0.23;

import CompactStandardLibrary;

const TOKEN_DOMAIN: Bytes<32> = pad(32, "batch:token");

// Track batch progress
export ledger batchId: Counter;
export ledger processedInBatch: Uint<64>;
export ledger totalBatches: Uint<64>;

// Initialize a new batch and return the batch ID
export circuit startBatch(): Uint<64> {
    batchId.increment();
    processedInBatch = (0 as Uint<64>);
    return batchId.value() as Uint<64>;
}

// Process a chunk of up to 3 recipients
export circuit processChunk(
    recipient1: UserAddress, amount1: Uint<64>,
    recipient2: UserAddress, amount2: Uint<64>,
    recipient3: UserAddress, amount3: Uint<64>,
    chunkSize: Uint<8>  // How many of the 3 are actually valid
): [] {
    const color = tokenType(disclose(TOKEN_DOMAIN), kernel.self());

    // Always send to recipient 1 (at least one required)
    sendUnshielded(color, disclose(amount1) as Uint<128>, right<ContractAddress, UserAddress>(disclose(recipient1)));
    processedInBatch = processedInBatch + (1 as Uint<64>);

    // Conditionally send to recipient 2
    if (disclose(chunkSize) >= (2 as Uint<8>)) {
        sendUnshielded(color, disclose(amount2) as Uint<128>, right<ContractAddress, UserAddress>(disclose(recipient2)));
        processedInBatch = processedInBatch + (1 as Uint<64>);
    }

    // Conditionally send to recipient 3
    if (disclose(chunkSize) >= (3 as Uint<8>)) {
        sendUnshielded(color, disclose(amount3) as Uint<128>, right<ContractAddress, UserAddress>(disclose(recipient3)));
        processedInBatch = processedInBatch + (1 as Uint<64>);
    }

    totalBatches = totalBatches + (1 as Uint<64>);
}
```

### TypeScript: Chunked Batch Processor

```typescript
interface Recipient {
    address: string;
    amount: bigint;
}

async function executeChunkedBatch(
    contract: BatchSplitContract,
    wallet: WalletAPI,
    recipients: Recipient[],
    chunkSize: number = 3
) {
    const chunks: Recipient[][] = [];
    for (let i = 0; i < recipients.length; i += chunkSize) {
        chunks.push(recipients.slice(i, i + chunkSize));
    }

    console.log(`Processing ${recipients.length} recipients in ${chunks.length} chunks`);

    // Start a new batch
    const startTx = await contract.callTx.startBatch();
    await wallet.submitTransaction(startTx.prove());
    console.log('Batch started');

    // Process each chunk as a separate transaction
    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        console.log(`Processing chunk ${i + 1}/${chunks.length} (${chunk.length} recipients)`);

        // Pad chunk to 3 entries
        const padded = [...chunk];
        while (padded.length < 3) {
            padded.push({ address: chunk[0].address, amount: 0n });
        }

        const tx = await contract.callTx.processChunk(
            padded[0].address, padded[0].amount,
            padded[1].address, padded[1].amount,
            padded[2].address, padded[2].amount,
            BigInt(chunk.length)
        );

        const result = await wallet.submitTransaction(tx.prove());
        console.log(`Chunk ${i + 1} complete. TX: ${result}`);

        // Optional: wait for confirmation before next chunk
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log('All chunks processed');
}
```

### Why 3 Recipients Per Chunk?

It's a balance. Each `sendUnshielded` adds ~3,000 rows. Three sends plus state updates ≈ 12,000 rows—well within block limits with safety margin. Five recipients would work too, but three gives more headroom for complex circuits with additional logic.

## 6. Guaranteed vs Fallible Segments: Deep Dive

The TypeScript SDK lets you control which segment each operation goes into using `Transaction.addCalls()`.

### When to Use Each Segment

**Guaranteed segment** is for:
- Fee payment (always here)
- Critical state updates that must not roll back
- Operations where partial failure is unacceptable

**Fallible segment** is for:
- Business logic that might legitimately fail
- Operations where rollback is the correct behavior on error
- Token transfers to external addresses (might fail if recipient can't receive)

### TypeScript: Building Multi-Segment Transactions

```typescript
import { Transaction } from '@midnight/ledger';
import { SegmentSpecifier } from '@midnight/ledger';

async function buildMultiSegmentTransaction(
    contractAddress: string,
    wallet: WalletAPI,
    recipients: Recipient[],
    platformFeeRecipient: string,
    platformFeeAmount: bigint
) {
    const ledgerParams = await getLedgerParameters();
    const ttl = new Date(Date.now() + 3600_000); // 1 hour TTL

    // Create a new empty transaction
    let tx = new Transaction();

    // GUARANTEED: Platform fee — must succeed
    tx = tx.addCalls(
        SegmentSpecifier.guaranteed,
        [{
            address: contractAddress,
            circuitName: 'collectFee',
            args: [platformFeeRecipient, platformFeeAmount]
        }],
        ledgerParams,
        ttl
    );

    // FALLIBLE: Distribution to recipients — can roll back
    for (const recipient of recipients) {
        tx = tx.addCalls(
            SegmentSpecifier.fallible,
            [{
                address: contractAddress,
                circuitName: 'sendToRecipient',
                args: [recipient.address, recipient.amount]
            }],
            ledgerParams,
            ttl
        );
    }

    // Bind and prove
    const bound = tx.bind();
    const proven = await proveTransaction(bound);

    return wallet.submitTransaction(proven);
}
```

### What Happens on Failure

If any fallible operation fails:
1. The guaranteed segment (fee collection) **still executes** and fees are consumed
2. The entire fallible segment **rolls back** — no recipients get paid
3. The transaction is recorded on-chain showing the guaranteed portion succeeded but fallible was reverted

This is by design. The fee compensates validators for processing the transaction, even if the business logic failed.

### Merging Transactions

For independent operations, you can create separate transactions and merge them:

```typescript
import { Transaction } from '@midnight/ledger';

async function mergeIndependentBatches(
    tx1: Transaction,
    tx2: Transaction
) {
    // Merge two transactions into one
    // NOTE: Merged transactions cannot both have contract interactions
    // Use this for combining token transfers from different sources
    const merged = tx1.merge(tx2);
    return merged;
}
```

**Important constraint:** `merge()` fails if both transactions have contract interactions (intents). Use it for combining pure token transfers.

## 7. Payroll Distribution: A Complete Example

Let's tie everything together with a payroll contract that pays employees in batches.

### Compact Contract: Payroll

Create `contracts/payroll.compact`:

```compact
pragma language_version >= 0.23;

import CompactStandardLibrary;

const PAY_DOMAIN: Bytes<32> = pad(32, "payroll:token");

export ledger payrollPool: Uint<128>;
export ledger paymentsProcessed: Uint<64>;
export ledger lastPayPeriod: Uint<64>;

// Fund the payroll pool
export circuit fundPayroll(amount: Uint<64>): [] {
    receiveUnshielded(tokenType(disclose(PAY_DOMAIN), kernel.self()), disclose(amount));
    payrollPool = payrollPool + (disclose(amount) as Uint<128>);
}

// Pay a batch of up to 4 employees
export circuit payBatch(
    emp1: UserAddress, salary1: Uint<64>,
    emp2: UserAddress, salary2: Uint<64>,
    emp3: UserAddress, salary3: Uint<64>,
    emp4: UserAddress, salary4: Uint<64>,
    employeeCount: Uint<8>,
    payPeriod: Uint<64>
): [] {
    const color = tokenType(disclose(PAY_DOMAIN), kernel.self());

    // Verify this is a new pay period
    assert(disclose(payPeriod) > lastPayPeriod, "Already processed this pay period");

    let totalPaid: Uint<128> = (0 as Uint<128>);

    // Employee 1 (always required)
    const s1 = disclose(salary1) as Uint<128>;
    sendUnshielded(color, s1, right<ContractAddress, UserAddress>(disclose(emp1)));
    totalPaid = totalPaid + s1;

    // Employee 2
    if (disclose(employeeCount) >= (2 as Uint<8>)) {
        const s2 = disclose(salary2) as Uint<128>;
        sendUnshielded(color, s2, right<ContractAddress, UserAddress>(disclose(emp2)));
        totalPaid = totalPaid + s2;
    }

    // Employee 3
    if (disclose(employeeCount) >= (3 as Uint<8>)) {
        const s3 = disclose(salary3) as Uint<128>;
        sendUnshielded(color, s3, right<ContractAddress, UserAddress>(disclose(emp3)));
        totalPaid = totalPaid + s3;
    }

    // Employee 4
    if (disclose(employeeCount) >= (4 as Uint<8>)) {
        const s4 = disclose(salary4) as Uint<128>;
        sendUnshielded(color, s4, right<ContractAddress, UserAddress>(disclose(emp4)));
        totalPaid = totalPaid + s4;
    }

    payrollPool = payrollPool - totalPaid;
    paymentsProcessed = paymentsProcessed + (disclose(employeeCount) as Uint<64>);
    lastPayPeriod = disclose(payPeriod);
}
```

### TypeScript: Full Payroll Runner

```typescript
interface Employee {
    address: string;
    salary: bigint;
}

async function runPayroll(
    contract: PayrollContract,
    wallet: WalletAPI,
    employees: Employee[],
    payPeriod: number
) {
    const BATCH_SIZE = 4;
    const batches: Employee[][] = [];

    for (let i = 0; i < employees.length; i += BATCH_SIZE) {
        batches.push(employees.slice(i, i + BATCH_SIZE));
    }

    console.log(`Payroll: ${employees.length} employees in ${batches.length} batches`);

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
        const batch = batches[batchIdx];
        const padded = [...batch];
        while (padded.length < 4) {
            padded.push({ address: batch[0].address, salary: 0n });
        }

        console.log(`Batch ${batchIdx + 1}: Paying ${batch.length} employees`);

        const tx = await contract.callTx.payBatch(
            padded[0].address, padded[0].salary,
            padded[1].address, padded[1].salary,
            padded[2].address, padded[2].salary,
            padded[3].address, padded[3].salary,
            BigInt(batch.length),
            BigInt(payPeriod)
        );

        const result = await wallet.submitTransaction(tx.prove());
        console.log(`Batch ${batchIdx + 1} complete: ${result}`);
    }

    console.log('Payroll complete');
}
```

## 8. Error Handling and Best Practices

### Retry Logic for Failed Chunks

```typescript
async function processChunkWithRetry(
    contract: BatchSplitContract,
    wallet: WalletAPI,
    chunk: Recipient[],
    maxRetries: number = 3
) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const padded = [...chunk];
            while (padded.length < 3) padded.push({ address: chunk[0].address, amount: 0n });

            const tx = await contract.callTx.processChunk(
                padded[0].address, padded[0].amount,
                padded[1].address, padded[1].amount,
                padded[2].address, padded[2].amount,
                BigInt(chunk.length)
            );

            return await wallet.submitTransaction(tx.prove());
        } catch (err: any) {
            if (err.message?.includes('1010')) {
                // Block weight exceeded — reduce chunk size
                console.warn(`Weight error on attempt ${attempt}, reducing chunk size`);
                if (chunk.length > 1) {
                    return processChunkWithRetry(contract, wallet, chunk.slice(0, chunk.length - 1), maxRetries - attempt + 1);
                }
            }
            if (attempt === maxRetries) throw err;
            console.warn(`Attempt ${attempt} failed: ${err.message}. Retrying...`);
            await new Promise(r => setTimeout(r, 2000 * attempt));
        }
    }
}
```

### Best Practices Checklist

1. **Keep chunks small** — 3–5 recipients per transaction for safety margin
2. **Use Counter for tracking** — Bounded merkle trees and counters are cheap on weight
3. **Separate guaranteed from fallible** — Put fee collection in guaranteed, business logic in fallible
4. **Test with mockProve()** — Use `tx.mockProve()` during development to estimate fees without real proofs
5. **Set appropriate TTL** — Don't let transactions sit in the mempool forever
6. **Monitor block weight** — Log transaction weights during testing to catch approaching limits early
7. **Use `disclose()` consistently** — Every private value that touches public state must be disclosed
8. **Pad arrays to fixed size** — Compact is bounded; always pad variable-length data to your declared maximum

## Summary

Batch transactions on Midnight require understanding the platform's unique constraints:

- **Atomicity** comes from executing multiple `sendUnshielded` calls within a single circuit
- **Two-phase execution** (guaranteed + fallible) lets you separate critical operations from rollback-safe business logic
- **Block weight limits** (error 1010) require chunking large batches into smaller transactions
- **Counter-based tracking** enables resumable batch operations across multiple transactions
- **3–5 recipients per chunk** is the sweet spot for balancing throughput and safety

The patterns in this tutorial—equal distribution, custom amounts, escrow release, chunked processing, and payroll—are building blocks you can compose for any multi-party settlement flow on Midnight.

## Resources

- [Midnight Documentation](https://docs.midnight.network)
- [Compact Language Reference](https://docs.midnight.network/compact/reference/compact-reference)
- [Token Transfer Examples](https://docs.midnight.network/examples/contracts/token-transfers)
- [Midnight Developer Forum](https://forum.midnight.network)
- [Midnight Discord](https://discord.com/invite/midnightnetwork)

---

*Tags: #MidnightforDevs #MidnightNetwork #Compact #BatchTransactions #SmartContracts*
