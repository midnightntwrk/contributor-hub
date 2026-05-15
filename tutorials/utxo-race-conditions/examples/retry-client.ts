/**
 * Optimistic Concurrency with Retry for Midnight Network
 * 
 * Attempts to submit transactions immediately and retries on stale UTXO errors.
 * Refreshes the wallet's UTXO set before each retry attempt.
 * 
 * Usage:
 *   const result = await submitWithRetry(
 *     () => wallet.transfer(address, amount),
 *     { maxRetries: 3 }
 *   );
 */

// ============================================================================
// Types
// ============================================================================

export interface TransactionResult {
  txHash: string;
  blockHeight?: number;
}

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Base delay in ms between retries (default: 5000) */
  retryDelayMs?: number;
  /** Multiplier for exponential backoff (default: 1.5) */
  backoffMultiplier?: number;
  /** Maximum delay in ms between retries (default: 30000) */
  maxRetryDelayMs?: number;
  /** Function to determine if an error is retryable */
  isRetryable?: (error: unknown) => boolean;
  /** Called on each retry attempt */
  onRetry?: (attempt: number, error: Error, nextDelayMs: number) => void;
  /** Called when all retries are exhausted */
  onExhausted?: (error: Error, attempts: number) => void;
}

export interface RetryResult<T> {
  result: T;
  attempts: number;
  totalTimeMs: number;
}

// ============================================================================
// Stale UTXO Error Detection
// ============================================================================

/**
 * Checks if an error is a stale UTXO error.
 * Adapts to different error formats from the Midnight SDK.
 */
export function isStaleUtxoError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  const stalePatterns = [
    "stale_utxo",
    "already been spent",
    "already consumed",
    "utxo not found",
    "input references a consumed output",
    "output already spent",
    "missing input",
  ];

  return stalePatterns.some((pattern) => message.includes(pattern));
}

// ============================================================================
// Retry Client Implementation
// ============================================================================

/**
 * Submit a transaction with automatic retry on stale UTXO errors.
 * 
 * Before each attempt, the callback should refresh wallet state
 * (re-select UTXOs) to ensure it has the latest available set.
 */
export async function submitWithRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<RetryResult<T>> {
  const {
    maxRetries = 3,
    retryDelayMs = 5000,
    backoffMultiplier = 1.5,
    maxRetryDelayMs = 30000,
    isRetryable = isStaleUtxoError,
    onRetry = () => {},
    onExhausted = () => {},
  } = opts;

  const startTime = Date.now();
  let lastError: Error | undefined;
  let currentDelay = retryDelayMs;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      return {
        result,
        attempts: attempt + 1,
        totalTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (!isRetryable(error)) {
        // Non-retryable error — fail immediately
        throw lastError;
      }

      if (attempt < maxRetries) {
        const jitter = Math.random() * 1000; // 0-1s jitter
        const delayWithJitter = Math.min(currentDelay + jitter, maxRetryDelayMs);

        console.warn(
          `[Retry] Attempt ${attempt + 1}/${maxRetries + 1} failed (stale UTXO). ` +
          `Retrying in ${Math.round(delayWithJitter)}ms...`
        );

        onRetry(attempt + 1, lastError, delayWithJitter);

        await new Promise((r) => setTimeout(r, delayWithJitter));
        currentDelay = Math.min(currentDelay * backoffMultiplier, maxRetryDelayMs);
      }
    }
  }

  // All retries exhausted
  onExhausted(lastError!, maxRetries + 1);
  throw new Error(
    `Transaction failed after ${maxRetries + 1} attempts: ${lastError!.message}`
  );
}

// ============================================================================
// Batch Retry: Multiple transactions with individual retry logic
// ============================================================================

export interface BatchRetryResult {
  succeeded: Array<{ index: number; result: TransactionResult }>;
  failed: Array<{ index: number; error: Error; attempts: number }>;
  totalTimeMs: number;
}

/**
 * Submit multiple transactions with retry, in sequence.
 * Each transaction retries independently on stale UTXO errors.
 */
export async function submitBatchWithRetry(
  tasks: Array<() => Promise<TransactionResult>>,
  opts: RetryOptions = {}
): Promise<BatchRetryResult> {
  const startTime = Date.now();
  const succeeded: BatchRetryResult["succeeded"] = [];
  const failed: BatchRetryResult["failed"] = [];

  for (let i = 0; i < tasks.length; i++) {
    try {
      const result = await submitWithRetry(tasks[i], {
        ...opts,
        onRetry: (attempt, error, delay) => {
          console.log(`[Batch] Task ${i}: retry #${attempt} in ${delay}ms`);
          opts.onRetry?.(attempt, error, delay);
        },
      });
      succeeded.push({ index: i, result: result.result });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      failed.push({ index: i, error: err, attempts: (opts.maxRetries ?? 3) + 1 });
    }
  }

  return {
    succeeded,
    failed,
    totalTimeMs: Date.now() - startTime,
  };
}

// ============================================================================
// Usage Example
// ============================================================================

async function example() {
  console.log("=== Single Transaction with Retry ===\n");

  // In production, replace with actual wallet calls:
  // const result = await submitWithRetry(
  //   async () => {
  //     await wallet.syncState();  // refresh UTXOs
  //     return await wallet.transfer(address, amount);
  //   },
  //   { maxRetries: 3, retryDelayMs: 5000 }
  // );

  // Demo with simulated failures:
  let attemptCount = 0;
  const result = await submitWithRetry(
    async () => {
      attemptCount++;
      if (attemptCount <= 2) {
        throw new Error("UTXO has already been spent");
      }
      return { txHash: `tx-${Math.random().toString(36).slice(2, 10)}` };
    },
    {
      maxRetries: 3,
      retryDelayMs: 1000,
      onRetry: (attempt, err, delay) => {
        console.log(`  ↳ Retry #${attempt}, waiting ${delay}ms`);
      },
    }
  );

  console.log(`\n✅ Succeeded after ${result.attempts} attempts`);
  console.log(`   TX Hash: ${result.result.txHash}`);
  console.log(`   Total time: ${result.totalTimeMs}ms`);

  console.log("\n=== Batch Transactions with Retry ===\n");

  // Demo batch:
  const batch = await submitBatchWithRetry(
    [
      async () => {
        await simulateDelay(500);
        return { txHash: "batch-tx-001" };
      },
      async () => {
        await simulateDelay(500);
        throw new Error("UTXO has already been spent");
      },
      async () => {
        await simulateDelay(500);
        return { txHash: "batch-tx-003" };
      },
    ],
    { maxRetries: 2, retryDelayMs: 500 }
  );

  console.log(`\nSucceeded: ${batch.succeeded.length}`);
  console.log(`Failed: ${batch.failed.length}`);
  console.log(`Total time: ${batch.totalTimeMs}ms`);
}

// Uncomment to run:
// example().catch(console.error);

function simulateDelay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
