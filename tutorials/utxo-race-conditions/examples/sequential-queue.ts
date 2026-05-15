/**
 * Sequential Transaction Queue for Midnight Network
 * 
 * Ensures transactions from a single wallet execute one at a time,
 * preventing UTXO race conditions by waiting for confirmation before
 * submitting the next transaction.
 * 
 * Usage:
 *   const queue = new TransactionQueue(wallet);
 *   await queue.enqueue(async () => wallet.transfer(addr1, amount1));
 *   await queue.enqueue(async () => wallet.transfer(addr2, amount2));
 */

// ============================================================================
// Types
// ============================================================================

export interface TransactionResult {
  txHash: string;
  blockHeight?: number;
  timestamp?: number;
}

export interface TransactionReceipt {
  status: 'confirmed' | 'pending' | 'failed';
  txHash: string;
  error?: string;
}

export interface QueueOptions {
  /** Time in ms to wait between confirmation checks */
  pollIntervalMs?: number;
  /** Maximum time in ms to wait for a transaction to confirm */
  confirmationTimeoutMs?: number;
  /** Called when a transaction is confirmed */
  onConfirmed?: (txHash: string) => void;
  /** Called when a transaction fails */
  onFailed?: (txHash: string, error: Error) => void;
}

// ============================================================================
// Transaction Queue Implementation
// ============================================================================

type QueuedTransaction = {
  id: number;
  execute: () => Promise<TransactionResult>;
  resolve: (result: TransactionResult) => void;
  reject: (error: Error) => void;
};

export class TransactionQueue {
  private queue: QueuedTransaction[] = [];
  private processing = false;
  private txCounter = 0;
  private options: Required<QueueOptions>;

  constructor(options: QueueOptions = {}) {
    this.options = {
      pollIntervalMs: options.pollIntervalMs ?? 5000,
      confirmationTimeoutMs: options.confirmationTimeoutMs ?? 300_000,
      onConfirmed: options.onConfirmed ?? (() => {}),
      onFailed: options.onFailed ?? (() => {}),
    };
  }

  /**
   * Enqueue a transaction for sequential execution.
   * Returns a promise that resolves when the transaction is confirmed.
   */
  enqueue(execute: () => Promise<TransactionResult>): Promise<TransactionResult> {
    const id = ++this.txCounter;

    return new Promise<TransactionResult>((resolve, reject) => {
      const tx: QueuedTransaction = { id, execute, resolve, reject };
      this.queue.push(tx);

      console.log(`[Queue] Transaction #${id} enqueued (queue size: ${this.queue.length})`);

      // Start processing if not already running
      this.processNext();
    });
  }

  /**
   * Get the current queue length (pending transactions).
   */
  get pending(): number {
    return this.queue.length;
  }

  /**
   * Check if the queue is currently processing a transaction.
   */
  get isProcessing(): boolean {
    return this.processing;
  }

  // ==========================================================================
  // Internal
  // ==========================================================================

  private async processNext(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;
    const tx = this.queue.shift()!;

    console.log(`[Queue] Processing transaction #${tx.id}...`);

    try {
      // Execute the transaction
      const result = await tx.execute();
      console.log(`[Queue] Transaction #${tx.id} submitted: ${result.txHash}`);

      // Wait for confirmation (optional — depends on your wallet SDK)
      await this.waitForConfirmation(result.txHash);

      console.log(`[Queue] Transaction #${tx.id} confirmed`);
      this.options.onConfirmed(result.txHash);
      tx.resolve(result);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error(`[Queue] Transaction #${tx.id} failed:`, err.message);
      this.options.onFailed(`tx-${tx.id}`, err);
      tx.reject(err);
    } finally {
      this.processing = false;

      // Process the next transaction in the queue
      if (this.queue.length > 0) {
        this.processNext();
      }
    }
  }

  private async waitForConfirmation(txHash: string): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < this.options.confirmationTimeoutMs) {
      try {
        // In a real implementation, query the transaction status:
        // const receipt = await wallet.getTransactionStatus(txHash);
        // if (receipt.status === 'confirmed') return;
        // if (receipt.status === 'failed') throw new Error('Transaction failed on-chain');

        // Simulated: just wait the poll interval
        await new Promise((r) => setTimeout(r, this.options.pollIntervalMs));
        return; // Assume confirmed after one poll cycle for demo
      } catch (error) {
        if (Date.now() - startTime >= this.options.confirmationTimeoutMs) {
          throw new Error(
            `Transaction ${txHash} confirmation timed out after ${this.options.confirmationTimeoutMs}ms`
          );
        }
      }
    }

    throw new Error(
      `Transaction ${txHash} confirmation timed out after ${this.options.confirmationTimeoutMs}ms`
    );
  }
}

// ============================================================================
// Usage Example
// ============================================================================

async function example() {
  // In a real app, initialize your Midnight wallet here:
  // const wallet = await Wallet.fromSeed(mnemonic);

  const queue = new TransactionQueue({
    pollIntervalMs: 5000,
    confirmationTimeoutMs: 120_000,
    onConfirmed: (txHash) => console.log(`✅ Confirmed: ${txHash}`),
    onFailed: (txHash, err) => console.error(`❌ Failed: ${txHash} - ${err.message}`),
  });

  // These will execute sequentially — no UTXO conflicts
  const results = await Promise.all([
    // In production, replace these with actual wallet.transfer() calls:
    // queue.enqueue(() => wallet.transfer(aliceAddress, 25_000000n)),
    // queue.enqueue(() => wallet.transfer(bobAddress, 50_000000n)),
    // queue.enqueue(() => wallet.transfer(charlieAddress, 10_000000n)),

    // Demo stubs:
    queue.enqueue(async () => {
      await new Promise((r) => setTimeout(r, 1000));
      return { txHash: "tx-abc-001" };
    }),
    queue.enqueue(async () => {
      await new Promise((r) => setTimeout(r, 1000));
      return { txHash: "tx-abc-002" };
    }),
    queue.enqueue(async () => {
      await new Promise((r) => setTimeout(r, 1000));
      return { txHash: "tx-abc-003" };
    }),
  ]);

  console.log("All transactions completed:", results);
}

// Uncomment to run:
// example().catch(console.error);
