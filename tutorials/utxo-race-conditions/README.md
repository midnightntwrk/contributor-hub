# Concurrent Transactions on Midnight: UTXO Race Conditions & Workarounds

## Table of Contents

- [Introduction](#introduction)
- [The UTXO Model: A Quick Refresher](#the-utxo-model-a-quick-refresher)
- [Why Concurrent Transactions Fail](#why-concurrent-transactions-fail)
- [The "Stale UTXO" Error Explained](#the-stale-utxo-error-explained)
- [UTXO vs Account Model: The Key Difference](#utxo-vs-account-model-the-key-difference)
- [Workaround 1: Sequential Transaction Queuing](#workaround-1-sequential-transaction-queuing)
- [Workaround 2: UTXO Partitioning with Multiple Wallet Instances](#workaround-2-utxo-partitioning-with-multiple-wallet-instances)
- [Workaround 3: Optimistic Concurrency with Retry](#workaround-3-optimistic-concurrency-with-retry)
- [Workaround 4: Transaction Batching](#workaround-4-transaction-batching)
- [Choosing the Right Strategy](#choosing-the-right-strategy)
- [Conclusion](#conclusion)

---

## Introduction

If you've built applications on Ethereum or Solana, you're used to the **account model**: your wallet has a balance, and you can fire off as many transactions as you want concurrently. The node figures out the ordering.

Midnight is different. Midnight uses a **UTXO (Unspent Transaction Output) model**, inherited from its Cardano foundations. In this model, your balance isn't stored as a single number — it's spread across discrete "coins" (UTXOs) sitting on the ledger. Every transaction **consumes** existing UTXOs and **creates** new ones.

This design gives Midnight powerful privacy guarantees and parallelism at the protocol level. But it introduces a challenge that trips up nearly every new developer: **UTXO race conditions**.

If two transactions from the same wallet try to spend the same UTXO, one of them will fail. This isn't a bug — it's a fundamental property of how UTXO blockchains work. But it means you need to design your application logic carefully.

This tutorial explains exactly why this happens, shows you the error in practice, and gives you four concrete, tested patterns to handle it.

---

## The UTXO Model: A Quick Refresher

In a UTXO blockchain, there are no "accounts" with "balances." Instead, the ledger tracks individual unspent outputs. Each UTXO is like a banknote — it has a specific denomination and can only be spent once, in its entirety.

Here's a simplified view of how it works:

```
Ledger State:
  UTXO-A: 50 DUST  (owned by Alice)
  UTXO-B: 30 DUST  (owned by Alice)
  UTXO-C: 20 DUST  (owned by Bob)

Alice's "balance" = UTXO-A + UTXO-B = 80 DUST
```

When Alice sends 40 DUST to Bob, the transaction must:
1. **Consume** one or more of Alice's UTXOs (say, UTXO-A worth 50 DUST)
2. **Create** new UTXOs:
   - 40 DUST → Bob
   - 10 DUST → Alice (change)

After the transaction:
```
Ledger State:
  UTXO-A: [SPENT — consumed by transaction]
  UTXO-B: 30 DUST  (owned by Alice)
  UTXO-C: 20 DUST  (owned by Bob)
  UTXO-D: 40 DUST  (owned by Bob)      ← new
  UTXO-E: 10 DUST  (owned by Alice)    ← new (change)
```

The critical point: **UTXO-A is now spent.** Any future transaction that tries to reference UTXO-A as an input will be rejected by the network.

---

## Why Concurrent Transactions Fail

Now imagine Alice wants to send two transactions at roughly the same time:

- **Transaction 1:** Send 25 DUST to Charlie (using UTXO-A)
- **Transaction 2:** Send 35 DUST to Dave (using UTXO-A)

Both transactions reference UTXO-A as their input. When submitted concurrently:

1. Transaction 1 is accepted into the mempool and later confirmed.
2. Transaction 2 arrives at the node. The node checks: "Is UTXO-A still unspent?" — **No, it was consumed by Transaction 1.** Transaction 2 is rejected with a **stale UTXO error**.

This is a race condition. The second transaction "loses the race" because the UTXO it depends on was already spent.

### The Timing Problem

The race condition is most painful in the window between:
- **Transaction submission** (when you construct and sign the transaction)
- **Transaction confirmation** (when the UTXO is actually consumed on-chain)

During this window, your local wallet state is **stale** — it still thinks the UTXO is available, but it's already been committed by another transaction.

---

## The "Stale UTXO" Error Explained

When you encounter a stale UTXO error on Midnight, the error typically looks like this:

```
Error: Transaction validation failed
  Caused by:
    - UTXO <output-reference> has already been spent
    - Input references a consumed output
```

Or, in the Midnight MCP / wallet API layer:

```typescript
{
  "error": "stale_utxo",
  "message": "The UTXO referenced by the transaction input has already been consumed",
  "utxoRef": "tx_hash#index"
}
```

### What triggers this error?

1. **Concurrent transactions from the same wallet** — the most common cause
2. **Front-running** — another transaction (possibly from a different wallet) consumed the UTXO before yours
3. **Wallet sync issues** — your wallet's local state is out of date with the chain

In practice, **case 1 is the problem developers hit most often.** You fire off a transaction, then immediately try to send another, and the second one fails because it's trying to spend the same UTXO that the first transaction already consumed.

---

## UTXO vs Account Model: The Key Difference

Understanding why this doesn't happen on Ethereum helps clarify the mental model shift needed for Midnight.

### Account Model (Ethereum, Solana)

```
Alice's account: { balance: 80 ETH, nonce: 5 }

Transaction 1: Send 25 ETH → Charlie  (nonce: 6)
Transaction 2: Send 35 ETH → Dave    (nonce: 7)
```

The node processes transactions sequentially by nonce. Both succeed because the balance is a single pool — the node debits from the same account twice. There's no "consumed output" concept.

### UTXO Model (Midnight, Cardano)

```
Alice's UTXOs: { UTXO-A: 50, UTXO-B: 30 }

Transaction 1: Spend UTXO-A (50) → 25 to Charlie, 25 change
Transaction 2: Spend UTXO-A (50) → 35 to Dave, 15 change  ← FAILS
```

Transaction 2 fails because UTXO-A no longer exists after Transaction 1. Alice still has UTXO-B, but Transaction 2 didn't reference it.

### Why this matters

| Aspect | Account Model | UTXO Model |
|--------|--------------|------------|
| Concurrent sends | ✅ Just works | ❌ Race conditions |
| Privacy | ❌ All activity visible | ✅ Each UTXO is isolated |
| Parallel validation | ❌ Sequential nonce | ✅ Independent UTXOs |
| Application design | Simple | Requires careful UTXO management |

---

## Workaround 1: Sequential Transaction Queuing

The simplest and most reliable pattern: **never send a new transaction until the previous one is confirmed.**

### The Pattern

```typescript
import { TransactionQueue } from './transaction-queue';

// Transaction queue ensures strict ordering
const queue = new TransactionQueue();

// Queue transactions — they execute one at a time
queue.enqueue(async () => {
  return await wallet.transfer(charlieAddress, 25n * DUST_UNIT);
});

queue.enqueue(async () => {
  return await wallet.transfer(daveAddress, 35n * DUST_UNIT);
});

// Both succeed: the second waits for the first to confirm
```

### Implementation

See [`examples/sequential-queue.ts`](./examples/sequential-queue.ts) for the full implementation.

The key insight is a promise-based queue with a mutex:

```typescript
class TransactionQueue {
  private queue: Array<() => Promise<TransactionResult>> = [];
  private processing = false;

  enqueue(tx: () => Promise<TransactionResult>): Promise<TransactionResult> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await tx();
          resolve(result);
          return result;
        } catch (err) {
          reject(err);
          throw err;
        }
      });
      this.processNext();
    });
  }

  private async processNext() {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;
    const tx = this.queue.shift()!;
    try {
      await tx();
    } finally {
      this.processing = false;
      this.processNext();
    }
  }
}
```

### When to use this

- Payment processors that send sequential payouts
- Any application where transaction ordering matters
- When you need **guaranteed delivery** without retries

### Trade-offs

- ✅ Simple, reliable, no wasted transactions
- ❌ Throughput is limited by block confirmation time (~20-60 seconds on Midnight)
- ❌ Latency stacks up: N transactions take N × confirmation time

---

## Workaround 2: UTXO Partitioning with Multiple Wallet Instances

For true parallelism, you can split your funds across **multiple wallet instances**, each owning non-overlapping UTXOs. Transactions from different wallets don't conflict because they spend different UTXOs.

### The Pattern

```typescript
import { WalletPool } from './wallet-pool';

// Create a pool of 4 wallet instances from the same seed
const pool = await WalletPool.fromSeed(mnemonic, {
  instanceCount: 4,
  fundEach: 200n * DUST_UNIT,  // distribute funds evenly
});

// Submit transactions in parallel — each uses a different wallet
const results = await Promise.all([
  pool.acquire().then(w => w.transfer(aliceAddr, 50n * DUST_UNIT)),
  pool.acquire().then(w => w.transfer(bobAddr, 30n * DUST_UNIT)),
  pool.acquire().then(w => w.transfer(charlieAddr, 75n * DUST_UNIT)),
]);

console.log('All succeeded:', results);
```

### Implementation

See [`examples/wallet-pool.ts`](./examples/wallet-pool.ts) for the full implementation.

The core idea:

```typescript
class WalletPool {
  private wallets: Wallet[] = [];
  private available: Wallet[] = [];

  static async fromSeed(mnemonic: string, opts: PoolOptions): Promise<WalletPool> {
    const pool = new WalletPool();
    for (let i = 0; i < opts.instanceCount; i++) {
      // Each instance derives a different address index
      const wallet = await Wallet.fromSeed(mnemonic, { addressIndex: i });
      // Fund each wallet from the primary account
      await fundWallet(wallet, opts.fundEach);
      pool.wallets.push(wallet);
      pool.available.push(wallet);
    }
    return pool;
  }

  async acquire(): Promise<Wallet> {
    // Wait for a wallet to become available
    while (this.available.length === 0) {
      await new Promise(r => setTimeout(r, 100));
    }
    return this.available.pop()!;
  }

  release(wallet: Wallet): void {
    this.available.push(wallet);
  }
}
```

### When to use this

- High-throughput applications (DEX, gaming, batch processing)
- When you need true parallelism (multiple transactions in the same block)
- When funding overhead is acceptable

### Trade-offs

- ✅ True parallelism — N wallets can submit N transactions simultaneously
- ✅ No stale UTXO errors (each wallet has its own UTXO set)
- ❌ Requires upfront funding distribution (on-chain transactions to split funds)
- ❌ More complex wallet management
- ❌ Rebalancing needed if one wallet runs low

---

## Workaround 3: Optimistic Concurrency with Retry

This pattern **attempts** parallel submission and **retries on failure**. It's optimistic because it assumes success and handles the failure gracefully.

### The Pattern

```typescript
import { submitWithRetry } from './retry-client';

// Submit a transaction with automatic retry on stale UTXO
const result = await submitWithRetry(
  async () => {
    // Refresh UTXO set before each attempt
    await wallet.syncState();
    return await wallet.transfer(daveAddress, 35n * DUST_UNIT);
  },
  {
    maxRetries: 3,
    retryDelay: 5000,  // wait 5s between retries
    isRetryable: (err) => err.code === 'stale_utxo',
  }
);
```

### Implementation

See [`examples/retry-client.ts`](./examples/retry-client.ts) for the full implementation.

```typescript
async function submitWithRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;

      if (!opts.isRetryable(err)) {
        throw err;  // non-retryable error, fail immediately
      }

      if (attempt < opts.maxRetries) {
        console.log(
          `Attempt ${attempt + 1} failed (stale UTXO), retrying in ${opts.retryDelay}ms...`
        );
        await new Promise(r => setTimeout(r, opts.retryDelay));
      }
    }
  }

  throw lastError!;
}
```

### When to use this

- When you can tolerate occasional retries
- When UTXO contention is **intermittent** (not constant)
- When simplicity matters more than maximum throughput

### Trade-offs

- ✅ Simple to implement
- ✅ Works with a single wallet
- ✅ Self-healing — automatically recovers from stale UTXO errors
- ❌ Wasted work on failed attempts (fee overhead if partial signing happened)
- ❌ Doesn't help if contention is constant
- ❌ Retry storms under high load

---

## Workaround 4: Transaction Batching

Instead of sending multiple transactions, **combine multiple operations into a single transaction.** One transaction, one set of UTXO inputs, multiple outputs.

### The Pattern

```typescript
import { BatchBuilder } from './batch-builder';

// Build a single transaction with multiple recipients
const batch = new BatchBuilder(wallet)
  .addOutput(aliceAddress, 25n * DUST_UNIT)
  .addOutput(bobAddress, 50n * DUST_UNIT)
  .addOutput(charlieAddress, 10n * DUST_UNIT);

const txResult = await batch.submit();

// All three transfers happen atomically in one transaction
console.log('Batch TX hash:', txResult.txHash);
```

### Implementation

See [`examples/batch-builder.ts`](./examples/batch-builder.ts) for the full implementation.

```typescript
class BatchBuilder {
  private outputs: Array<{ address: string; amount: bigint }> = [];

  constructor(private wallet: Wallet) {}

  addOutput(address: string, amount: bigint): this {
    this.outputs.push({ address, amount });
    return this;
  }

  async submit(): Promise<TransactionResult> {
    // Select UTXOs to cover total amount
    const totalAmount = this.outputs.reduce((sum, o) => sum + o.amount, 0n);
    const utxos = await this.wallet.selectUtxos(totalAmount);

    // Build transaction with multiple outputs
    const tx = new TransactionBuilder();
    for (const utxo of utxos) {
      tx.addInput(utxo);
    }
    for (const output of this.outputs) {
      tx.addOutput(output.address, output.amount);
    }

    // Add change output if needed
    const inputTotal = utxos.reduce((sum, u) => sum + u.amount, 0n);
    const change = inputTotal - totalAmount - estimateFee(tx);
    if (change > 0n) {
      tx.addOutput(await this.wallet.getChangeAddress(), change);
    }

    const signed = await this.wallet.sign(tx);
    return await this.wallet.submitTransaction(signed);
  }
}
```

### When to use this

- Multiple payouts to different recipients
- Airdrops or batch distributions
- Any scenario where you control the timing of multiple transfers

### Trade-offs

- ✅ Atomic — all outputs succeed or all fail (no partial state)
- ✅ Only one transaction fee instead of N
- ✅ No race conditions — single transaction, single UTXO set
- ❌ Transaction size limits (too many outputs can exceed max tx size)
- ❌ Less flexible — all recipients must be known upfront
- ❌ Not suitable for independent operations triggered at different times

---

## Choosing the Right Strategy

| Strategy | Throughput | Complexity | Best For |
|----------|-----------|------------|----------|
| Sequential Queue | Low | Simple | Reliable sequential payments |
| Wallet Pool | High | Medium | High-throughput parallel workloads |
| Retry | Medium | Simple | Intermittent contention |
| Batching | Medium | Simple | Known upfront multi-recipient transfers |

### Decision Flowchart

```
Do you need multiple transactions at the same time?
├── No → Sequential Queue (simplest)
└── Yes
    ├── Are all recipients known upfront? 
    │   └── Yes → Batching (atomic + cheap)
    └── No
        ├── Can you fund multiple wallets?
        │   └── Yes → Wallet Pool (best throughput)
        └── No → Retry (works with one wallet, handles contention)
```

---

## Conclusion

UTXO race conditions are a fundamental challenge when building on Midnight — not a bug, but a consequence of the UTXO model's privacy and parallelism benefits. The key takeaway is:

1. **Understand the model.** Your balance is a set of discrete UTXOs, not a single pool.
2. **Never assume concurrent spending works.** Two transactions consuming the same UTXO will always fail.
3. **Pick the right strategy.** For most applications, sequential queuing or batching is sufficient. High-throughput apps need wallet pools.

The patterns in this tutorial are battle-tested approaches used in production UTXO applications. Start with the simplest approach (sequential queue) and graduate to more complex patterns only when you have a measurable throughput bottleneck.

---

## Additional Resources

- [Midnight Network Documentation](https://docs.midnight.network/)
- [Midnight MCP (Model Context Protocol)](https://www.npmjs.com/package/midnight-mcp)
- [Midnight Developer Forum](https://forum.midnight.network/)
- [Midnight Discord](https://discord.com/invite/midnightnetwork)
