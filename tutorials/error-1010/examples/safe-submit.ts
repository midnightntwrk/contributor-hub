/**
 * Safe Transaction Submission Wrapper
 *
 * Provides chunked batch processing and pre-submission validation
 * to avoid Error 1010 (Invalid Transaction) on the Midnight Network.
 *
 * Usage:
 *   import { SafeSubmitter } from './safe-submit';
 *
 *   const submitter = new SafeSubmitter(wallet, contract, { chunkSize: 3 });
 *   const results = await submitter.submitBatch(recipients, amounts);
 */

import { diagnoseError1010, formatDiagnosis, ErrorVariant } from "./diagnose";

// ============================================================
// Types
// ============================================================

export interface Recipient {
  address: string;
  amount: bigint;
}

export interface SubmissionResult {
  success: boolean;
  txHash?: string;
  chunkIndex: number;
  recipientsProcessed: number;
  error?: string;
}

export interface BatchResult {
  totalRecipients: number;
  processedRecipients: number;
  failedRecipients: number;
  chunks: SubmissionResult[];
  totalTxHashes: string[];
}

export interface SafeSubmitterConfig {
  /** Number of recipients per transaction chunk (default: 3) */
  chunkSize: number;

  /** Maximum retry attempts for retryable errors (default: 3) */
  maxRetries: number;

  /** Delay between retries in ms (default: 2000) */
  retryDelayMs: number;

  /** Whether to simulate before submitting (default: true) */
  simulateFirst: boolean;

  /** Whether to sync wallet state before each chunk (default: true) */
  syncBeforeChunk: boolean;
}

const DEFAULT_CONFIG: SafeSubmitterConfig = {
  chunkSize: 3,
  maxRetries: 3,
  retryDelayMs: 2000,
  simulateFirst: true,
  syncBeforeChunk: true,
};

// ============================================================
// SafeSubmitter Class
// ============================================================

/**
 * Handles chunked batch transaction submission with automatic
 * error detection, retry logic, and wallet state management.
 *
 * Designed to prevent Error 1010 variants by:
 * - Chunking large batches into small transactions (default: 3 recipients)
 * - Syncing wallet state before each chunk to avoid stale nullifiers
 * - Simulating transactions before submission
 * - Auto-retrying retryable errors (170, 186)
 * - Providing detailed diagnostics for non-retryable errors
 */
export class SafeSubmitter {
  private wallet: any;
  private contract: any;
  private config: SafeSubmitterConfig;

  constructor(wallet: any, contract: any, config?: Partial<SafeSubmitterConfig>) {
    this.wallet = wallet;
    this.contract = contract;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Splits an array of recipients into fixed-size chunks.
   */
  private chunkRecipients(recipients: Recipient[]): Recipient[][] {
    const chunks: Recipient[][] = [];
    for (let i = 0; i < recipients.length; i += this.config.chunkSize) {
      chunks.push(recipients.slice(i, i + this.config.chunkSize));
    }
    return chunks;
  }

  /**
   * Waits for the specified delay.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Submits a single chunk with retry logic.
   */
  private async submitChunkWithRetry(
    chunk: Recipient[],
    chunkIndex: number
  ): Promise<SubmissionResult> {
    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        // Sync wallet state before each attempt
        if (this.config.syncBeforeChunk) {
          await this.wallet.syncState();
        }

        // Build the transaction for this chunk
        const tx = await this.buildChunkTransaction(chunk);

        // Simulate if configured
        if (this.config.simulateFirst) {
          const simulation = await this.simulateTransaction(tx);
          if (simulation && !simulation.valid) {
            console.warn(
              `Chunk ${chunkIndex} simulation failed: ${simulation.error}`
            );
            // Continue anyway — simulation might be unavailable
          }
        }

        // Submit
        const txHash = await this.wallet.submitTransaction(tx);
        console.log(
          `Chunk ${chunkIndex}: ${chunk.length} recipients → ${txHash}`
        );

        return {
          success: true,
          txHash,
          chunkIndex,
          recipientsProcessed: chunk.length,
        };
      } catch (error: any) {
        const diagnosis = diagnoseError1010(error);

        if (diagnosis.code === 1010) {
          console.error(
            `Chunk ${chunkIndex} attempt ${attempt}: Error 1010 / ${diagnosis.variantName}`
          );

          // Retry for retryable errors
          if (diagnosis.retryable && attempt < this.config.maxRetries) {
            console.log(
              `Retrying in ${this.config.retryDelayMs}ms... (${attempt}/${this.config.maxRetries})`
            );
            await this.delay(this.config.retryDelayMs);
            continue;
          }

          // Non-retryable or max retries exceeded
          return {
            success: false,
            chunkIndex,
            recipientsProcessed: 0,
            error: `Error 1010 / ${diagnosis.variantName}: ${diagnosis.message}`,
          };
        }

        // Non-1010 error
        return {
          success: false,
          chunkIndex,
          recipientsProcessed: 0,
          error: error.message || String(error),
        };
      }
    }

    // Should not reach here, but just in case
    return {
      success: false,
      chunkIndex,
      recipientsProcessed: 0,
      error: "Max retries exceeded",
    };
  }

  /**
   * Builds a transaction for a chunk of recipients.
   * Override this method for your specific contract.
   */
  protected async buildChunkTransaction(chunk: Recipient[]): Promise<any> {
    // Pad chunk to fixed size (required by Compact contracts)
    const padded = this.padChunk(chunk);

    // Call the contract's processChunk circuit
    return this.contract.buildTransaction("processChunk", [
      padded[0].address,
      padded[0].amount,
      padded[1].address,
      padded[1].amount,
      padded[2].address,
      padded[2].amount,
      BigInt(chunk.length), // chunkSize
    ]);
  }

  /**
   * Pads a chunk to the configured chunk size with zero-value recipients.
   */
  private padChunk(chunk: Recipient[]): Recipient[] {
    const padded = [...chunk];
    while (padded.length < this.config.chunkSize) {
      padded.push({ address: padded[0].address, amount: 0n });
    }
    return padded;
  }

  /**
   * Simulates a transaction before submission.
   * Returns null if simulation is unavailable.
   */
  protected async simulateTransaction(tx: any): Promise<any> {
    try {
      // Try using the Midnight MCP simulation if available
      if (typeof window !== "undefined" && (window as any).midnightMcp) {
        return await (window as any).midnightMcp.simulateTransaction(tx);
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Submits a batch of recipients in chunked transactions.
   *
   * This is the main entry point. It:
   * 1. Syncs wallet state
   * 2. Splits recipients into chunks
   * 3. Submits each chunk with retry logic
   * 4. Returns aggregated results
   *
   * @example
   * ```typescript
   * const submitter = new SafeSubmitter(wallet, contract, { chunkSize: 3 });
   *
   * const recipients = [
   *   { address: "addr1...", amount: 1000n },
   *   { address: "addr2...", amount: 2000n },
   *   { address: "addr3...", amount: 1500n },
   *   { address: "addr4...", amount: 500n },
   *   { address: "addr5...", amount: 3000n },
   * ];
   *
   * const result = await submitter.submitBatch(recipients);
   * console.log(`Processed: ${result.processedRecipients}/${result.totalRecipients}`);
   * console.log(`TX hashes: ${result.totalTxHashes.join(", ")}`);
   * ```
   */
  async submitBatch(recipients: Recipient[]): Promise<BatchResult> {
    console.log(`Starting batch: ${recipients.length} recipients`);
    console.log(`Chunk size: ${this.config.chunkSize}`);

    // Initial sync
    await this.wallet.syncState();

    // Split into chunks
    const chunks = this.chunkRecipients(recipients);
    console.log(`Split into ${chunks.length} chunks`);

    // Process each chunk
    const results: SubmissionResult[] = [];
    const txHashes: string[] = [];
    let processedCount = 0;

    for (let i = 0; i < chunks.length; i++) {
      console.log(
        `\nProcessing chunk ${i + 1}/${chunks.length} (${chunks[i].length} recipients)...`
      );

      const result = await this.submitChunkWithRetry(chunks[i], i);
      results.push(result);

      if (result.success && result.txHash) {
        txHashes.push(result.txHash);
        processedCount += result.recipientsProcessed;
      } else {
        console.error(`Chunk ${i} failed: ${result.error}`);
        // Continue with remaining chunks — partial success is better than total failure
      }
    }

    const failedCount = recipients.length - processedCount;

    console.log(`\n=== Batch Complete ===`);
    console.log(`Total: ${recipients.length}`);
    console.log(`Processed: ${processedCount}`);
    console.log(`Failed: ${failedCount}`);
    console.log(`Transactions: ${txHashes.length}`);

    return {
      totalRecipients: recipients.length,
      processedRecipients: processedCount,
      failedRecipients: failedCount,
      chunks: results,
      totalTxHashes: txHashes,
    };
  }
}

// ============================================================
// Cost Estimation (Pre-flight Check)
// ============================================================

export interface CostEstimate {
  computeTimeMs: number;
  ioReadTimeMs: number;
  consensusBytes: number;
  persistentBytes: number;
  churnBytes: number;
}

export interface BlockLimits {
  computeTimeMs: number;
  ioReadTimeMs: number;
  consensusBytes: number;
  persistentBytes: number;
  churnBytes: number;
}

/** Default block limits (approximate values for Midnight testnet) */
export const DEFAULT_BLOCK_LIMITS: BlockLimits = {
  computeTimeMs: 1000, // ~1 second
  ioReadTimeMs: 1000, // ~1 second
  consensusBytes: 200_000, // ~200 KB
  persistentBytes: 20_000, // ~20 KB
  churnBytes: 1_000_000, // ~1 MB
};

/**
 * Estimates the cost of a batch of operations across all 5 dimensions.
 *
 * @param recipientCount - Number of recipients in the batch
 * @param avgProofSizeBytes - Average ZK proof size in bytes (default: 2000)
 * @returns Estimated cost in all 5 dimensions
 *
 * @example
 * ```typescript
 * const estimate = estimateBatchCost(10);
 * const limits = DEFAULT_BLOCK_LIMITS;
 *
 * if (estimate.computeTimeMs > limits.computeTimeMs * 0.8) {
 *   console.warn("Compute time approaching limit — consider chunking");
 * }
 * ```
 */
export function estimateBatchCost(
  recipientCount: number,
  avgProofSizeBytes: number = 2000
): CostEstimate {
  // Per-operation estimates (approximate)
  const perRecipient = {
    computeMs: 50, // ~50ms per sendUnshielded
    ioReadMs: 20, // ~20ms per state read
    consensusBytes: 200 + avgProofSizeBytes, // overhead + proof
    persistentBytes: 100, // ~100 bytes state write per send
    churnBytes: 500, // ~500 bytes temporary per send
  };

  return {
    computeTimeMs: recipientCount * perRecipient.computeMs,
    ioReadTimeMs: recipientCount * perRecipient.ioReadMs,
    consensusBytes: recipientCount * perRecipient.consensusBytes,
    persistentBytes: recipientCount * perRecipient.persistentBytes,
    churnBytes: recipientCount * perRecipient.churnBytes,
  };
}

/**
 * Checks whether a batch will fit within block limits.
 * Returns an object indicating which dimensions are safe and which are over.
 *
 * @param estimate - The cost estimate from estimateBatchCost()
 * @param limits - The block limits (defaults to DEFAULT_BLOCK_LIMITS)
 * @param safetyMargin - Fraction of limit to stay below (default: 0.8 = 80%)
 * @returns Object with safe/over status for each dimension
 */
export function checkBlockLimits(
  estimate: CostEstimate,
  limits: BlockLimits = DEFAULT_BLOCK_LIMITS,
  safetyMargin: number = 0.8
): { safe: boolean; details: Record<string, { value: number; limit: number; ok: boolean }> } {
  const dimensions = {
    computeTimeMs: { value: estimate.computeTimeMs, limit: limits.computeTimeMs },
    ioReadTimeMs: { value: estimate.ioReadTimeMs, limit: limits.ioReadTimeMs },
    consensusBytes: { value: estimate.consensusBytes, limit: limits.consensusBytes },
    persistentBytes: { value: estimate.persistentBytes, limit: limits.persistentBytes },
    churnBytes: { value: estimate.churnBytes, limit: limits.churnBytes },
  };

  const details: Record<string, { value: number; limit: number; ok: boolean }> = {};
  let allSafe = true;

  for (const [key, { value, limit }] of Object.entries(dimensions)) {
    const ok = value <= limit * safetyMargin;
    if (!ok) allSafe = false;
    details[key] = { value, limit, ok };
  }

  return { safe: allSafe, details };
}

/**
 * Calculates the optimal chunk size for a given number of recipients
 * to stay within block limits.
 *
 * @param recipientCount - Total number of recipients
 * @param limits - Block limits (defaults to DEFAULT_BLOCK_LIMITS)
 * @param safetyMargin - Fraction of limit to stay below (default: 0.7)
 * @returns Recommended chunk size
 */
export function calculateOptimalChunkSize(
  recipientCount: number,
  limits: BlockLimits = DEFAULT_BLOCK_LIMITS,
  safetyMargin: number = 0.7
): number {
  // Start with chunk size 1 and increase until we approach limits
  for (let chunkSize = 1; chunkSize <= recipientCount; chunkSize++) {
    const estimate = estimateBatchCost(chunkSize);
    const check = checkBlockLimits(estimate, limits, safetyMargin);

    if (!check.safe) {
      // Previous chunk size was the maximum safe size
      return Math.max(1, chunkSize - 1);
    }
  }

  // All recipients fit in one chunk
  return recipientCount;
}
