/**
 * Wallet Pool for Parallel Transactions on Midnight Network
 * 
 * Manages multiple wallet instances derived from the same seed phrase,
 * each with non-overlapping UTXOs. This enables true parallel transaction
 * submission without UTXO race conditions.
 * 
 * Usage:
 *   const pool = await WalletPool.fromSeed(mnemonic, { instanceCount: 4 });
 *   const wallet = await pool.acquire();
 *   await wallet.transfer(address, amount);
 *   pool.release(wallet);
 */

// ============================================================================
// Types
// ============================================================================

export interface Wallet {
  getAddress(): string;
  transfer(to: string, amount: bigint): Promise<TransactionResult>;
  getBalance(): Promise<bigint>;
  syncState(): Promise<void>;
}

export interface TransactionResult {
  txHash: string;
  blockHeight?: number;
}

export interface PoolOptions {
  /** Number of wallet instances to create */
  instanceCount: number;
  /** Amount of DUST to fund each wallet instance */
  fundEach: bigint;
  /** Base derivation path index offset */
  baseIndex?: number;
}

export interface PoolStats {
  totalWallets: number;
  availableWallets: number;
  busyWallets: number;
  transactionsSubmitted: number;
}

// ============================================================================
// Wallet Pool Implementation
// ============================================================================

export class WalletPool {
  private wallets: Wallet[] = [];
  private available: Wallet[] = [];
  private busy: Set<Wallet> = new Set();
  private waitQueue: Array<(wallet: Wallet) => void> = [];
  private txCount = 0;
  private initialized = false;

  /**
   * Create a wallet pool from a seed phrase.
   * Each wallet derives a unique address from the same seed.
   */
  static async fromSeed(
    mnemonic: string,
    opts: PoolOptions
  ): Promise<WalletPool> {
    const pool = new WalletPool();

    console.log(`[Pool] Creating ${opts.instanceCount} wallet instances...`);

    for (let i = 0; i < opts.instanceCount; i++) {
      const addressIndex = (opts.baseIndex ?? 0) + i;

      // In production, use the actual Midnight wallet SDK:
      // const wallet = await Wallet.fromSeed(mnemonic, { addressIndex });
      // await fundWallet(wallet, opts.fundEach);

      // Demo stub:
      const wallet: Wallet = {
        getAddress: () => `mn_addr_${addressIndex}_${generateId()}`,
        transfer: async (to: string, amount: bigint) => {
          await simulateNetworkDelay();
          return { txHash: `tx-${generateId()}` };
        },
        getBalance: async () => opts.fundEach,
        syncState: async () => {},
      };

      pool.wallets.push(wallet);
      pool.available.push(wallet);

      console.log(`[Pool] Wallet #${i} created: ${wallet.getAddress()}`);
    }

    pool.initialized = true;
    console.log(`[Pool] Pool ready with ${opts.instanceCount} wallets`);

    return pool;
  }

  /**
   * Create a wallet pool from individual wallet instances.
   */
  static fromWallets(wallets: Wallet[]): WalletPool {
    const pool = new WalletPool();
    pool.wallets = [...wallets];
    pool.available = [...wallets];
    pool.initialized = true;
    return pool;
  }

  /**
   * Acquire a wallet from the pool.
   * Blocks until a wallet becomes available.
   */
  async acquire(): Promise<Wallet> {
    if (!this.initialized) {
      throw new Error("Pool not initialized. Call WalletPool.fromSeed() first.");
    }

    // Return immediately if a wallet is available
    if (this.available.length > 0) {
      const wallet = this.available.pop()!;
      this.busy.add(wallet);
      return wallet;
    }

    // Otherwise, wait for one to be released
    console.log(`[Pool] No wallets available, waiting... (busy: ${this.busy.size})`);

    return new Promise<Wallet>((resolve) => {
      this.waitQueue.push((wallet: Wallet) => {
        this.busy.add(wallet);
        resolve(wallet);
      });
    });
  }

  /**
   * Release a wallet back to the pool.
   * Call this when you're done with the wallet.
   */
  release(wallet: Wallet): void {
    if (!this.busy.has(wallet)) {
      console.warn("[Pool] Attempted to release a wallet that isn't busy");
      return;
    }

    this.busy.delete(wallet);

    // If someone is waiting for a wallet, hand it directly to them
    if (this.waitQueue.length > 0) {
      const waiter = this.waitQueue.shift()!;
      waiter(wallet);
    } else {
      this.available.push(wallet);
    }
  }

  /**
   * Execute a transaction using the next available wallet.
   * Automatically acquires and releases the wallet.
   */
  async execute(
    fn: (wallet: Wallet) => Promise<TransactionResult>
  ): Promise<TransactionResult> {
    const wallet = await this.acquire();
    try {
      const result = await fn(wallet);
      this.txCount++;
      return result;
    } finally {
      this.release(wallet);
    }
  }

  /**
   * Execute multiple transactions in parallel.
   * Each transaction gets its own wallet instance.
   */
  async executeParallel(
    tasks: Array<(wallet: Wallet) => Promise<TransactionResult>>
  ): Promise<TransactionResult[]> {
    return Promise.all(tasks.map((task) => this.execute(task)));
  }

  /**
   * Get current pool statistics.
   */
  stats(): PoolStats {
    return {
      totalWallets: this.wallets.length,
      availableWallets: this.available.length,
      busyWallets: this.busy.size,
      transactionsSubmitted: this.txCount,
    };
  }

  /**
   * Rebalance funds across wallets.
   * Call periodically if some wallets run low.
   */
  async rebalance(targetPerWallet: bigint): Promise<void> {
    console.log("[Pool] Rebalancing wallet funds...");

    for (const wallet of this.wallets) {
      const balance = await wallet.getBalance();
      const diff = targetPerWallet - balance;

      if (diff > 0n) {
        console.log(
          `[Pool] Wallet ${wallet.getAddress()} needs +${diff} DUST`
        );
        // In production: transfer from a treasury wallet
        // await treasuryWallet.transfer(wallet.getAddress(), diff);
      }
    }
  }
}

// ============================================================================
// Usage Example
// ============================================================================

async function example() {
  // Create a pool of 4 wallets
  const pool = await WalletPool.fromSeed(
    "abandon abandon abandon ... about",  // your 24-word seed
    {
      instanceCount: 4,
      fundEach: 200_000000n,  // 200 DUST per wallet
    }
  );

  // Parallel transfers — each uses a different wallet, no UTXO conflicts
  const results = await pool.executeParallel([
    (w) => w.transfer("addr_alice", 50_000000n),
    (w) => w.transfer("addr_bob", 30_000000n),
    (w) => w.transfer("addr_charlie", 75_000000n),
    (w) => w.transfer("addr_dave", 25_000000n),
  ]);

  console.log("Parallel results:", results);
  console.log("Pool stats:", pool.stats());
}

// Uncomment to run:
// example().catch(console.error);

// ============================================================================
// Helpers (stubs for demo — replace with real SDK calls)
// ============================================================================

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

function simulateNetworkDelay(): Promise<void> {
  return new Promise((r) => setTimeout(r, 500 + Math.random() * 1000));
}
