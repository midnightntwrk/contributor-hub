/**
 * Transaction Batching for Midnight Network
 * 
 * Combines multiple outputs into a single atomic transaction.
 * One set of UTXO inputs, multiple outputs — no race conditions.
 * 
 * Usage:
 *   const result = await new BatchBuilder(wallet)
 *     .addOutput(aliceAddress, 25_000000n)
 *     .addOutput(bobAddress, 50_000000n)
 *     .submit();
 */

// ============================================================================
// Types
// ============================================================================

export interface TransactionResult {
  txHash: string;
  totalAmount: bigint;
  outputCount: number;
  fee: bigint;
}

export interface Wallet {
  getAddress(): string;
  selectUtxos(amount: bigint): Promise<Utxo[]>;
  getChangeAddress(): Promise<string>;
  sign(tx: UnsignedTransaction): Promise<SignedTransaction>;
  submitTransaction(tx: SignedTransaction): Promise<{ txHash: string }>;
}

export interface Utxo {
  txHash: string;
  outputIndex: number;
  amount: bigint;
  address: string;
}

export interface UnsignedTransaction {
  inputs: Utxo[];
  outputs: Array<{ address: string; amount: bigint }>;
  fee: bigint;
}

export interface SignedTransaction extends UnsignedTransaction {
  signatures: string[];
}

// ============================================================================
// Batch Builder Implementation
// ============================================================================

export class BatchBuilder {
  private outputs: Array<{ address: string; amount: bigint; label?: string }> = [];
  private customFee: bigint | null = null;

  constructor(private wallet: Wallet) {}

  /**
   * Add a recipient to the batch.
   */
  addOutput(address: string, amount: bigint, label?: string): this {
    if (amount <= 0n) {
      throw new Error(`Amount must be positive, got ${amount}`);
    }
    this.outputs.push({ address, amount, label });
    return this;
  }

  /**
   * Add multiple recipients at once.
   */
  addOutputs(
    recipients: Array<{ address: string; amount: bigint; label?: string }>
  ): this {
    for (const r of recipients) {
      this.addOutput(r.address, r.amount, r.label);
    }
    return this;
  }

  /**
   * Override the automatic fee calculation.
   */
  setFee(fee: bigint): this {
    this.customFee = fee;
    return this;
  }

  /**
   * Get the total amount (excluding fee).
   */
  getTotal(): bigint {
    return this.outputs.reduce((sum, o) => sum + o.amount, 0n);
  }

  /**
   * Build and submit the batched transaction.
   */
  async submit(): Promise<TransactionResult> {
    if (this.outputs.length === 0) {
      throw new Error("No outputs added. Call addOutput() before submit()");
    }

    const totalAmount = this.getTotal();
    const estimatedFee = this.customFee ?? estimateFee(this.outputs.length);
    const requiredAmount = totalAmount + estimatedFee;

    console.log(`[Batch] Building transaction with ${this.outputs.length} outputs`);
    console.log(`[Batch] Total amount: ${totalAmount} DUST`);
    console.log(`[Batch] Estimated fee: ${estimatedFee} DUST`);
    console.log(`[Batch] Required UTXOs: ${requiredAmount} DUST`);

    // Step 1: Select UTXOs to cover the total
    const utxos = await this.wallet.selectUtxos(requiredAmount);
    const inputTotal = utxos.reduce((sum, u) => sum + u.amount, 0n);

    console.log(`[Batch] Selected ${utxos.length} UTXOs (total: ${inputTotal} DUST)`);

    // Step 2: Build the unsigned transaction
    const tx: UnsignedTransaction = {
      inputs: utxos,
      outputs: this.outputs.map((o) => ({
        address: o.address,
        amount: o.amount,
      })),
      fee: estimatedFee,
    };

    // Step 3: Add change output if needed
    const change = inputTotal - totalAmount - estimatedFee;
    if (change > 0n) {
      const changeAddress = await this.wallet.getChangeAddress();
      tx.outputs.push({ address: changeAddress, amount: change });
      console.log(`[Batch] Change output: ${change} DUST → ${changeAddress}`);
    } else if (change < 0n) {
      throw new Error(
        `Insufficient funds: need ${requiredAmount}, have ${inputTotal}`
      );
    }

    // Step 4: Sign and submit
    console.log("[Batch] Signing transaction...");
    const signed = await this.wallet.sign(tx);

    console.log("[Batch] Submitting to network...");
    const result = await this.wallet.submitTransaction(signed);

    console.log(`[Batch] ✅ Submitted: ${result.txHash}`);

    return {
      txHash: result.txHash,
      totalAmount,
      outputCount: this.outputs.length,
      fee: estimatedFee,
    };
  }

  /**
   * Preview the transaction without submitting.
   * Useful for confirming amounts before sending.
   */
  async preview(): Promise<{
    outputs: Array<{ address: string; amount: bigint; label?: string }>;
    total: bigint;
    estimatedFee: bigint;
    estimatedUtxosNeeded: bigint;
  }> {
    const total = this.getTotal();
    const fee = this.customFee ?? estimateFee(this.outputs.length);

    return {
      outputs: [...this.outputs],
      total,
      estimatedFee: fee,
      estimatedUtxosNeeded: total + fee,
    };
  }
}

// ============================================================================
// Fee Estimation
// ============================================================================

/**
 * Estimate transaction fee based on the number of outputs.
 * This is a simplified model — real fee estimation depends on
 * transaction size in bytes and protocol parameters.
 */
function estimateFee(outputCount: number): bigint {
  const BASE_FEE = 100_000n;      // 0.001 DUST base
  const PER_OUTPUT_FEE = 50_000n;  // 0.0005 DUST per additional output
  return BASE_FEE + PER_OUTPUT_FEE * BigInt(outputCount);
}

// ============================================================================
// Usage Example
// ============================================================================

async function example() {
  // In production, initialize with a real Midnight wallet:
  // const wallet = await Wallet.fromSeed(mnemonic);

  // Demo wallet stub:
  const wallet: Wallet = {
    getAddress: () => "mn_addr_sender123",
    selectUtxos: async (amount) => [
      { txHash: "utxo-001", outputIndex: 0, amount: 500_000000n, address: "mn_addr_sender123" },
    ],
    getChangeAddress: async () => "mn_addr_change456",
    sign: async (tx) => ({ ...tx, signatures: ["sig-001"] }),
    submitTransaction: async (tx) => ({
      txHash: `tx-${Math.random().toString(36).slice(2, 10)}`,
    }),
  };

  // Build a batch transaction
  const batch = new BatchBuilder(wallet)
    .addOutput("mn_addr_alice", 25_000000n, "Alice payment")
    .addOutput("mn_addr_bob", 50_000000n, "Bob payment")
    .addOutput("mn_addr_charlie", 10_000000n, "Charlie payment");

  // Preview before submitting
  const preview = await batch.preview();
  console.log("=== Transaction Preview ===");
  for (const out of preview.outputs) {
    console.log(`  ${out.label ?? "output"}: ${out.amount} → ${out.address}`);
  }
  console.log(`  Total: ${preview.total} DUST`);
  console.log(`  Fee: ${preview.estimatedFee} DUST`);

  // Submit atomically
  const result = await batch.submit();
  console.log(`\n=== Result ===`);
  console.log(`TX Hash: ${result.txHash}`);
  console.log(`Outputs: ${result.outputCount}`);
  console.log(`Total: ${result.totalAmount} DUST`);
  console.log(`Fee: ${result.fee} DUST`);
}

// Uncomment to run:
// example().catch(console.error);
