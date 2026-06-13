# Concurrent Transactions on Midnight: UTXO Race Conditions & Workarounds

## Introduction

When developing on Midnight, you may encounter a frustrating issue: two transactions from the same wallet fail when sent concurrently, throwing a "stale UTXO" error. This happens because Midnight uses the UTXO (Unspent Transaction Output) model, which differs significantly from the account-based model used by chains like Ethereum. In this tutorial, we’ll explore why this error occurs and provide two practical workarounds: sequential transaction queuing and using multiple wallet instances.

## UTXO Model vs Account Model

### Account Model

In Ethereum, each account has a balance and a nonce. A transaction increments the nonce, preventing replay attacks. Multiple transactions can be sent concurrently as long as they have the correct nonce; the next block will include them in order. This model simplifies concurrent transactions.

### UTXO Model

In Midnight, value is stored as unspent transaction outputs (UTXOs). Each UTXO is an indivisible chunk of value with an owner. A transaction consumes one or more UTXOs as inputs and creates new UTXOs as outputs. Once a UTXO is spent, it cannot be reused. 

When you send two transactions from the same wallet concurrently, both transactions attempt to spend the same DUST UTXOs (small UTXOs used for fees). The first transaction succeeds, consuming those UTXOs. The second transaction, built with the same UTXOs, fails because they are no longer unspent—hence the "stale UTXO" error.

## The Stale UTXO Error

Here’s a code snippet that triggers the error:

```typescript
const wallet = await createWallet({ seed: 'myseed' });
const tx1 = wallet.createTransaction({ outputs: [/* ... */] });
const tx2 = wallet.createTransaction({ outputs: [/* ... */] });
const [result1, result2] = await Promise.all([tx1, tx2]);
```

This will likely throw an error similar to:

```
Error: Stale UTXO: One or more inputs have already been spent
```

## Workaround 1: Sequential Transaction Queuing

The simplest fix is to ensure transactions are sent one after another. Use an async queue to serialize execution.

```typescript
class SequentialQueue {
  private queue: Array<() => Promise<void>> = [];
  private processing = false;

  async enqueue(task: () => Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          await task();
          resolve();
        } catch (e) {
          reject(e);
        }
      });
      if (!this.processing) this.process();
    });
  }

  private async process() {
    this.processing = true;
    while (this.queue.length) {
      const task = this.queue.shift()!;
      await task();
    }
    this.processing = false;
  }
}

// Usage
const queue = new SequentialQueue();
queue.enqueue(() => sendTx(wallet, tx1));
queue.enqueue(() => sendTx(wallet, tx2));
```

## Workaround 2: Multiple Wallet Instances

For higher throughput, use separate wallets, each with their own UTXOs. This allows true parallel execution.

```typescript
const wallet1 = await createWallet({ seed: 'seed1' });
const wallet2 = await createWallet({ seed: 'seed2' });

// Fund both wallets from a master wallet or faucet
// Then send concurrently
const [tx1, tx2] = await Promise.all([
  wallet1.sendTransaction(tx1),
  wallet2.sendTransaction(tx2)
]);
```

## Conclusion

The UTXO model requires careful handling of concurrent transactions. Sequential queuing is simple and safe, while multiple wallets offer parallelism at the cost of managing multiple seeds. Choose the approach that fits your application’s needs.

Now you can avoid "stale UTXO" errors and build robust Midnight applications!