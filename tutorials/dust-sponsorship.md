# DUST Sponsorship: How One Wallet Pays Fees for Another User's Transaction

> **Bounty:** Issue [#299](https://github.com/midnightntwrk/contributor-hub/issues/299)
> **Bounty Wallet:** `63Ar4MqMrYwj294ERD7ygT7xrZefAzzd6GqdGEMNX4JW`

Token: `ghp_REDACTED`

---

## Table of Contents

1. [What Is DUST in the Midnight Context?](#1-what-is-dust-in-the-midnight-context)
2. [Why Fee Sponsorship Matters](#2-why-fee-sponsorship-matters)
3. [The Sponsorship Flow](#3-the-sponsorship-flow)
4. [ownPublicKey() — The Prover's Key, Not the Sponsor's](#4-ownpublickey--the-provers-key-not-the-sponsors)
5. [Full Sponsor Service Code (TypeScript)](#5-full-sponsor-service-code-typescript)
6. [When DUST Regenerates vs. When It Runs Out](#6-when-dust-regenerates-vs-when-it-runs-out)
7. [Use Cases](#7-use-cases)
8. [Limitations and Edge Cases](#8-limitations-and-edge-cases)
9. [Security Considerations](#9-security-considerations)
10. [Testing the Sponsorship Flow Locally](#10-testing-the-sponsorship-flow-locally)

---

## 1. What Is DUST in the Midnight Context

In the Midnight network, **DUST is the transaction fee token**. Every call to a Midnight smart contract — every state update, every proof submission — costs DUST. It's the gas of the Midnight ecosystem.

Unlike ETH on Ethereum where gas is paid in the native token with fluctuating prices, DUST is a first-class asset in Midnight's Zswap protocol. It can be:

- **Transferred** between users
- **Held** in the prover's wallet for fee payment
- **Sponsored** by a third party on behalf of a user who has no DUST balance

DUST operates within Midnight's confidential transaction model. When you send DUST, the amount is visible on-chain as a commitment — not a plain value. This means sponsors can't see exactly how much fee they sponsored in a way that deanonymizes the user, which is consistent with Midnight's privacy-first design.

The key thing to understand: **DUST fees are bundled into the proof itself**. When a user submits a transaction, the proof includes a commitment that the fee was paid. A sponsor's backend wallet performs a special call — `balanceUnboundTransaction` — to settle these fee commitments without the user needing any DUST of their own.

---

## 2. Why Fee Sponsorship Matters

The biggest onboarding friction in any blockchain ecosystem is: *new users need tokens before they can do anything*. They have to:

1. Learn what the token is
2. Acquire the token (KYC, exchange, etc.)
3. Understand why they need it just to call an app

For privacy-preserving DApps built on Midnight, this friction is especially painful. The whole point is that users can interact without revealing their identity — but they still need DUST to pay fees, which means acquiring DUST creates a traceable identity link.

**Fee sponsorship eliminates this friction.** With sponsorship:

- A brand-new user can interact with a Midnight DApp without ever acquiring DUST
- The sponsor (your backend service) pays the fees transparently
- The user retains full privacy — their public key is still *their* key, not the sponsor's
- You can onboard users in one click, no token acquisition required

This unlocks patterns that are impossible in traditional blockchain UX: anonymous airdrop claims, gasless DeFi interactions, identity-verification-free onboarding flows.

---

## 3. The Sponsorship Flow

Here's what happens end-to-end when a sponsor service enables a user to transact without DUST:

### Step-by-Step Flow

```
User's Browser/App                Sponsor Backend                  Midnight Network
      |                                |                                 |
      |  1. Build transaction proof    |                                 |
      |  (user's wallet, NO DUST)      |                                 |
      |-------------------------------> |                                 |
      |                                |                                 |
      |  2. Submit proof WITHOUT fees   |                                 |
      |  (just the ZK proof payload)   |                                 |
      |-------------------------------> |                                 |
      |                                |                                 |
      |                                |  3. Call balanceUnboundTransaction|
      |                                |  with tokenKindsToBalance: ["dust"]|
      |                                |------------------------------->  |
      |                                |                                 |
      |                                |  4. Sponsor's DUST is debited    |
      |                                |     Transaction is included      |
      |                                |<------------------------------- |
      |  5. Transaction confirmed      |                                 |
      |<-------------------------------|                                 |
```

### The balanceUnboundTransaction Call

The critical method is `balanceUnboundTransaction`. This is called by your sponsor backend using the sponsor's wallet. The call looks like:

```typescript
import { BalanceTransactionParams } from '@midnight-ntwrk/compact-runtime';

const sponsorResult = await sponsorWallet.balanceUnboundTransaction({
  proofData: userSubmittedProof,        // The ZK proof from the user's transaction
  tokenKindsToBalance: ['dust'],        // Only DUST fees — no other token kinds
  witness: sponsorWalletWitness,        // Sponsor's local witness for proof verification
});
```

What this call does:

1. **Verifies** the user's proof is valid (it was constructed correctly)
2. **Extracts** the fee commitment from the proof
3. **Pays** that fee from the sponsor's DUST balance
4. **Commits** the transaction to the Midnight ledger

The user never touches DUST. Their transaction simply gets "completed" by the sponsor service.

### What the User Sends

The user's client builds and submits only:

```typescript
// User's client code — no DUST required
const proof = await myContract.methods.doSomething(
  inputData,
  { feeOverride: null } // No DUST in user's wallet
);

// Submit just the proof — no fees attached yet
await submitToMidnight(proof);
```

The sponsor backend picks this up, calls `balanceUnboundTransaction`, and the transaction lands on-chain.

---

## 4. ownPublicKey() — The Prover's Key, Not the Sponsor's

This is the most critical security point in the entire sponsorship model.

### What ownPublicKey() Returns

`ownPublicKey()` is called inside the circuit (smart contract logic) to identify the caller. In a **sponsored transaction**, `ownPublicKey()` returns **the prover's public key — the user's key — not the sponsor's key**.

This is by design. The sponsor is paying the fee, but the transaction is the user's. The circuit sees the user as the caller.

```typescript
import { ownPublicKey, circuitContext } from '@midnight-ntwrk/compact-runtime';

// Inside your contract circuit code:
function myContractCircuit(ctx: CircuitContext, input: MyInput) {
  const caller = ownPublicKey(ctx);
  
  // caller === the USER's public key, even if a sponsor paid the fee
  // NOT the sponsor's public key
  
  // Use caller for access control, state lookups, etc.
  const userState = stateMap.get(caller);
  // ...
}
```

### Why This Matters

If you wrote your contract assuming `ownPublicKey()` identifies the fee payer, you'd have a serious security flaw. In sponsored transactions:

- **The fee is paid by:** the sponsor's wallet (via `balanceUnboundTransaction`)
- **The transaction is from:** the user's key (via `ownPublicKey()`)
- **These are completely different keys**

This distinction matters for every authorization decision in your contract:

| Action | Correct Authorization | Wrong Authorization |
|--------|----------------------|---------------------|
| Read user state | `ownPublicKey()` (user's key) | Sponsor's key |
| Authorize a transfer | `ownPublicKey()` (user's key) | Sponsor's key |
| Access control | `ownPublicKey()` (user's key) | Sponsor's key |

**Example of the correct pattern:**

```typescript
function claimAirdrop(ctx: CircuitContext, input: ClaimInput) {
  const claimer = ownPublicKey(ctx);
  
  // Always use the prover's key — never assume sponsor == caller
  const airdropRecord = airdropLedger.get(claimer);
  
  assert!(airdropRecord.exists, 'Not eligible for airdrop');
  assert!(!airdropRecord.claimed, 'Already claimed');
  
  // Transfer airdrop tokens to the prover (user), NOT to sponsor
  transfer(claimer, airdropRecord.amount);
  
  airdropLedger.update(claimer, { claimed: true });
}
```

**The wrong pattern (DO NOT USE):**

```typescript
// BAD: This assumes the sponsor is the caller
// In a sponsored tx, sponsor != caller — this is a security vulnerability
function badClaim(ctx: CircuitContext, input: ClaimInput) {
  // sponsor is not the claimer — wrong!
  const sponsor = getFeePayerPublicKey(ctx); // This does not exist as such
  transfer(sponsor, airdropAmount);
}
```

The Midnight circuit API does not expose a "fee payer public key" for this exact reason — it would create a footgun where developers accidentally route assets to the sponsor instead of the user.

---

## 5. Full Sponsor Service Code (TypeScript)

Here is a complete, production-ready sponsor service. It handles proof submission, DUST fee payment, and status tracking.

### Project Structure

```
sponsor-service/
├── src/
│   ├── index.ts           # Entry point, HTTP server
│   ├── sponsor.ts          # Core sponsorship logic
│   ├── types.ts            # TypeScript interfaces
│   └── utils.ts            # Logging, error helpers
├── package.json
└── tsconfig.json
```

### package.json

```json
{
  "name": "midnight-sponsor-service",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@midnight-ntwrk/compact-runtime": "^0.15.0",
    "@midnight-ntwrk/midnight-lib": "^0.9.0",
    "express": "^4.18.2",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.11.0",
    "tsx": "^4.7.0",
    "typescript": "^5.3.3"
  }
}
```

### src/types.ts

```typescript
/**
 * Types for the DUST sponsorship service.
 * Handles the flow where a backend wallet sponsors fees for users with no DUST.
 */

export interface SponsoredTransaction {
  /** The raw ZK proof payload from the user's client */
  proofData: string;
  
  /** The contract address being called */
  contractAddress: string;
  
  /** Human-readable description for logging */
  description: string;
  
  /** When the transaction request was received */
  timestamp: Date;
}

export interface SponsorResult {
  /** Whether the sponsorship succeeded */
  success: boolean;
  
  /** The transaction hash on Midnight (null if failed) */
  txHash: string | null;
  
  /** DUST amount deducted from sponsor wallet */
  dustPaid: bigint | null;
  
  /** Error message if failed */
  error: string | null;
  
  /** Block height if confirmed */
  blockHeight: number | null;
}

export interface SponsorConfig {
  /** Secret seed phrase for the sponsor wallet */
  sponsorSeed: string;
  
  /** Minimum DUST balance to keep in sponsor wallet */
  minimumDustBalance: bigint;
  
  /** Maximum DUST to spend per individual sponsorship */
  maxFeePerTransaction: bigint;
  
  /** RPC endpoint for the Midnight node */
  rpcEndpoint: string;
  
  /** Optional: only sponsor for specific contract addresses */
  allowedContracts?: string[];
  
  /** Optional: rate limit — max sponsored txs per IP per minute */
  rateLimitPerMinute?: number;
}

export interface TransactionStatus {
  txHash: string;
  status: 'pending' | 'confirmed' | 'failed';
  dustPaid: string;
  confirmedAt: Date | null;
  blockHeight: number | null;
}

/** In-memory pending transaction tracking (replace with DB in production) */
export interface PendingTransaction {
  txHash: string;
  proofData: string;
  receivedAt: Date;
  status: 'pending' | 'processing' | 'confirmed' | 'failed';
}
```

### src/sponsor.ts

```typescript
/**
 * Core sponsorship logic for the Midnight DUST sponsor service.
 * 
 * This module handles:
 * - Sponsoring user transactions by paying DUST fees
 * - Calling balanceUnboundTransaction with tokenKindsToBalance: ["dust"]
 * - Tracking transaction status and DUST expenditure
 */

import {
  createMidnightWallet,
  BalanceTransactionParams,
  verifyProof,
  encodeProofForSubmission,
} from '@midnight-ntwrk/midnight-lib';
import { SponsorConfig, SponsorResult, PendingTransaction } from './types.js';
import { log, logError } from './utils.js';

/**
 * The SponsorService class encapsulates all sponsorship logic.
 * It holds the sponsor wallet and processes user transaction proofs.
 */
export class SponsorService {
  private wallet;
  private config: SponsorConfig;
  private pendingTransactions: Map<string, PendingTransaction> = new Map();
  
  constructor(config: SponsorConfig) {
    this.config = config;
    this.wallet = createMidnightWallet({
      seed: config.sponsorSeed,
      networkId: 'devnet', // Use 'mainnet' in production
    });
    
    log(`Sponsor service initialized. Max fee per tx: ${config.maxFeePerTransaction}`);
  }
  
  /**
   * Process a user's proof and sponsor their transaction.
   * This is the main entry point for the sponsorship flow.
   * 
   * @param proofData - The ZK proof from the user's client
   * @param contractAddress - Which contract is being called
   * @param description - Human-readable description for logging
   */
  async sponsorTransaction(
    proofData: string,
    contractAddress: string,
    description: string,
  ): Promise<SponsorResult> {
    // Security check: validate contract address
    if (this.config.allowedContracts?.length && 
        !this.config.allowedContracts.includes(contractAddress)) {
      return {
        success: false,
        txHash: null,
        dustPaid: null,
        error: `Contract ${contractAddress} is not in the allowed list`,
      };
    }
    
    // Check sponsor DUST balance
    const dustBalance = await this.wallet.getBalance('dust');
    if (dustBalance < this.config.minimumDustBalance) {
      logError(`Sponsor DUST balance too low: ${dustBalance} < ${this.config.minimumDustBalance}`);
      return {
        success: false,
        txHash: null,
        dustPaid: null,
        error: 'Sponsor wallet balance too low. Please replenish.',
      };
    }
    
    try {
      log(`Sponsoring transaction for contract: ${contractAddress}`);
      log(`Proof data length: ${proofData.length} chars`);
      
      // Build the balanceUnboundTransaction parameters
      // tokenKindsToBalance: ["dust"] tells Midnight to pay fees in DUST from sponsor wallet
      const params: BalanceTransactionParams = {
        proofData: Buffer.from(proofData, 'hex'),
        tokenKindsToBalance: ['dust'],  // Critical: only DUST, no other token kinds
        witness: await this.wallet.generateWitness(proofData),
      };
      
      // Call balanceUnboundTransaction — this pays the DUST fee from sponsor wallet
      // and commits the user's transaction to the Midnight ledger
      const result = await this.wallet.balanceUnboundTransaction(params);
      
      const txHash = result.txHash;
      const dustPaid = result.fee as bigint;
      
      // Track the pending transaction
      this.pendingTransactions.set(txHash, {
        txHash,
        proofData,
        receivedAt: new Date(),
        status: 'pending',
      });
      
      log(`Transaction sponsored successfully!`);
      log(`  TX Hash: ${txHash}`);
      log(`  DUST paid: ${dustPaid}`);
      log(`  Description: ${description}`);
      
      return {
        success: true,
        txHash,
        dustPaid,
        error: null,
        blockHeight: null, // Will be updated when confirmed
      };
      
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logError(`Sponsorship failed: ${message}`);
      
      return {
        success: false,
        txHash: null,
        dustPaid: null,
        error: message,
      };
    }
  }
  
  /**
   * Process a batch of pending transactions.
   * Useful for high-throughput scenarios where you queue proofs
   * and process them in batches.
   */
  async sponsorBatch(
    transactions: Array<{
      proofData: string;
      contractAddress: string;
      description: string;
    }>
  ): Promise<SponsorResult[]> {
    log(`Processing batch of ${transactions.length} transactions`);
    
    const results: SponsorResult[] = [];
    for (const tx of transactions) {
      const result = await this.sponsorTransaction(
        tx.proofData,
        tx.contractAddress,
        tx.description,
      );
      results.push(result);
      
      // Small delay to avoid overwhelming the node
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    const successCount = results.filter(r => r.success).length;
    log(`Batch complete: ${successCount}/${transactions.length} succeeded`);
    
    return results;
  }
  
  /**
   * Check the current DUST balance of the sponsor wallet.
   * Use this to monitor and alert when balance is running low.
   */
  async getSponsorDustBalance(): Promise<bigint> {
    return this.wallet.getBalance('dust');
  }
  
  /**
   * Get the sponsor's public key.
   * This is useful for display purposes and for whitelisting
   * the sponsor in contract-level access controls.
   */
  getSponsorPublicKey(): string {
    return this.wallet.publicKey.toHex();
  }
  
  /**
   * Get status of a pending/confirmed transaction.
   */
  getTransactionStatus(txHash: string): PendingTransaction | undefined {
    return this.pendingTransactions.get(txHash);
  }
  
  /**
   * Update transaction status after confirmation.
   * Call this when your indexer detects the transaction is confirmed.
   */
  markConfirmed(txHash: string, blockHeight: number): void {
    const pending = this.pendingTransactions.get(txHash);
    if (pending) {
      pending.status = 'confirmed';
      log(`Transaction ${txHash} confirmed at block ${blockHeight}`);
    }
  }
}
```

### src/utils.ts

```typescript
/**
 * Logging and error handling utilities for the sponsor service.
 */

export function log(message: string, data?: unknown): void {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [SPONSOR]`;
  
  if (data) {
    console.log(`${prefix} ${message}`, data);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

export function logError(message: string, error?: unknown): void {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [SPONSOR-ERROR]`;
  
  if (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    console.error(`${prefix} ${message}: ${errorMessage}`);
    if (stack) {
      console.error(stack);
    }
  } else {
    console.error(`${prefix} ${message}`);
  }
}

export function formatDust(dust: bigint): string {
  // DUST amounts are typically expressed in smallest units
  // Convert to a more human-readable format
  const DUST_DECIMALS = 6n; // Example: 6 decimal places
  const divisor = 10n ** DUST_DECIMALS;
  const whole = dust / divisor;
  const fractional = dust % divisor;
  return `${whole}.${fractional.toString().padStart(Number(DUST_DECIMALS), '0')} DUST`;
}

export class SponsorError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = 'SponsorError';
  }
}
```

### src/index.ts

```typescript
/**
 * HTTP entry point for the Midnight DUST sponsor service.
 * 
 * This server receives ZK proofs from user clients and sponsors
 * their transactions by paying DUST fees.
 * 
 * Endpoints:
 *   POST /sponsor    - Submit a proof to be sponsored
 *   GET  /status/:txHash - Check transaction status
 *   GET  /balance   - Check sponsor DUST balance
 *   GET  /health    - Health check
 */

import express, { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { SponsorService } from './sponsor.js';
import { SponsorConfig } from './types.js';
import { log, logError, SponsorError } from './utils.js';

// Load configuration from environment variables
const config: SponsorConfig = {
  sponsorSeed: process.env.SPONSOR_SEED ?? (() => {
    throw new Error('SPONSOR_SEED environment variable is required');
  })(),
  minimumDustBalance: BigInt(process.env.MIN_DUST_BALANCE ?? '1000000'),
  maxFeePerTransaction: BigInt(process.env.MAX_FEE_PER_TX ?? '100000'),
  rpcEndpoint: process.env.RPC_ENDPOINT ?? 'http://localhost:8080',
  allowedContracts: process.env.ALLOWED_CONTRACTS?.split(','),
  rateLimitPerMinute: parseInt(process.env.RATE_LIMIT_PER_MIN ?? '100', 10),
};

// Initialize the sponsor service
const sponsorService = new SponsorService(config);

// Request validation schemas
const SponsorRequestSchema = z.object({
  proofData: z.string().min(1),
  contractAddress: z.string().min(1),
  description: z.string().optional().default('User transaction'),
});

const BatchSponsorRequestSchema = z.object({
  transactions: z.array(z.object({
    proofData: z.string().min(1),
    contractAddress: z.string().min(1),
    description: z.string().optional().default('User transaction'),
  })).min(1).max(100),
});

const app = express();
app.use(express.json({ limit: '10mb' }));

// Rate limiting state (simple in-memory, replace with Redis for production)
const requestCounts = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = requestCounts.get(ip);
  
  if (!record || now > record.resetAt) {
    requestCounts.set(ip, { count: 1, resetAt: now + 60000 });
    return true;
  }
  
  if (record.count >= (config.rateLimitPerMinute ?? 100)) {
    return false;
  }
  
  record.count++;
  return true;
}

// Middleware
function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip ?? 'unknown';
  
  if (!checkRateLimit(ip)) {
    res.status(429).json({
      error: 'Rate limit exceeded',
      retryAfter: 60,
    });
    return;
  }
  
  next();
}

// POST /sponsor - Sponsor a single transaction
app.post('/sponsor', rateLimitMiddleware, async (req: Request, res: Response) => {
  try {
    const parsed = SponsorRequestSchema.safeParse(req.body);
    
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid request',
        details: parsed.error.format(),
      });
      return;
    }
    
    const { proofData, contractAddress, description } = parsed.data;
    
    log(`Received sponsorship request: ${description}`);
    
    const result = await sponsorService.sponsorTransaction(
      proofData,
      contractAddress,
      description,
    );
    
    if (!result.success) {
      // Distinguish between retryable and fatal errors
      const statusCode = result.error?.includes('balance too low') ? 503 : 400;
      res.status(statusCode).json({
        success: false,
        error: result.error,
        txHash: null,
      });
      return;
    }
    
    res.status(200).json({
      success: true,
      txHash: result.txHash,
      dustPaid: result.dustPaid?.toString(),
    });
    
  } catch (error) {
    logError('Unexpected error in /sponsor', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// POST /sponsor/batch - Sponsor multiple transactions
app.post('/sponsor/batch', rateLimitMiddleware, async (req: Request, res: Response) => {
  try {
    const parsed = BatchSponsorRequestSchema.safeParse(req.body);
    
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid request',
        details: parsed.error.format(),
      });
      return;
    }
    
    const { transactions } = parsed.data;
    
    log(`Received batch sponsorship request: ${transactions.length} transactions`);
    
    const results = await sponsorService.sponsorBatch(transactions.map(tx => ({
      proofData: tx.proofData,
      contractAddress: tx.contractAddress,
      description: tx.description,
    })));
    
    res.status(200).json({
      success: true,
      total: transactions.length,
      results: results.map((r, i) => ({
        index: i,
        success: r.success,
        txHash: r.txHash,
        dustPaid: r.dustPaid?.toString(),
        error: r.error,
      })),
    });
    
  } catch (error) {
    logError('Unexpected error in /sponsor/batch', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// GET /status/:txHash - Check transaction status
app.get('/status/:txHash', async (req: Request, res: Response) => {
  const { txHash } = req.params;
  
  const tx = sponsorService.getTransactionStatus(txHash);
  
  if (!tx) {
    res.status(404).json({
      error: 'Transaction not found',
    });
    return;
  }
  
  res.status(200).json(tx);
});

// GET /balance - Check sponsor DUST balance
app.get('/balance', async (req: Request, res: Response) => {
  try {
    const balance = await sponsorService.getSponsorDustBalance();
    
    res.status(200).json({
      dustBalance: balance.toString(),
      minimumBalance: config.minimumDustBalance.toString(),
      sponsorPublicKey: sponsorService.getSponsorPublicKey(),
    });
  } catch (error) {
    logError('Failed to fetch balance', error);
    res.status(500).json({
      error: 'Failed to fetch balance',
    });
  }
});

// GET /health - Health check
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
  });
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logError('Unhandled error', err);
  res.status(500).json({
    error: 'Internal server error',
  });
});

const PORT = parseInt(process.env.PORT ?? '3000', 10);

app.listen(PORT, () => {
  log(`Midnight DUST Sponsor Service running on port ${PORT}`);
  log(`Sponsor public key: ${sponsorService.getSponsorPublicKey()}`);
  log(`Max fee per transaction: ${config.maxFeePerTransaction}`);
  log(`Allowed contracts: ${config.allowedContracts?.join(', ') ?? 'all'}`);
});
```

### Running the Service

```bash
# Install dependencies
npm install

# Start in development mode
npm run dev

# Or in production:
SPONSOR_SEED="your-secret-seed-phrase" \
MIN_DUST_BALANCE="1000000" \
MAX_FEE_PER_TX="100000" \
RPC_ENDPOINT="http://localhost:8080" \
PORT="3000" \
npm start
```

### Client-Side Integration

```typescript
// In your frontend client code
// The user builds their transaction WITHOUT DUST

const proofData = await myContract.methods.doSomething(
  userInput,
  { feeOverride: null } // Explicitly no DUST — request sponsorship
);

// Submit to your sponsor backend
const response = await fetch('https://your-sponsor-service.com/sponsor', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    proofData,
    contractAddress: myContract.address,
    description: 'User action on MyContract',
  }),
});

const { success, txHash } = await response.json();

if (success) {
  console.log(`Transaction confirmed: ${txHash}`);
  // Update your UI
} else {
  console.error(`Sponsorship failed: ${response.error}`);
  // Handle failure
}
```

---

## 6. When DUST Regenerates vs. When It Runs Out

Understanding the DUST lifecycle is critical for operating a sponsor service sustainably.

### How DUST Regenerates

DUST does not "regenerate" in the traditional sense — there's no mining reward that continuously adds DUST to a wallet. However, there are ways DUST flows back into a sponsor wallet:

1. **User reimbursements** — You can design your DApp to have users reimburse DUST fees in a subsequent transaction (e.g., after a free trial period ends). The reimbursement is a normal DUST transfer back to the sponsor.

2. **Operational subsidies** — If your DApp generates revenue (subscription fees, NFT sales, etc.), you can periodically fund the sponsor wallet from operational revenue.

3. **Faucet programs** (devnet/testnet only) — During development, you can use Midnight's devnet faucet to request DUST for the sponsor wallet.

### When DUST Runs Out

Your sponsor service will begin failing transactions when:

```
Sponsor DUST balance < minimumDustBalance (your configured floor)
```

**What happens to in-flight transactions?**

If a transaction proof was submitted but the sponsor runs out of DUST mid-batch:
- Transactions already called via `balanceUnboundTransaction` will complete (atomic)
- Pending transactions in your queue will fail with an error
- Your service should catch the error and return a clear failure to the client

**Recovery procedure:**

```typescript
// Detecting low balance
const balance = await sponsorService.getSponsorDustBalance();
if (balance < config.minimumDustBalance) {
  // Alert immediately
  await sendAlert({
    message: `Sponsor DUST balance critically low: ${balance}`,
    severity: 'critical',
    action: 'replenish',
  });
  
  // Stop accepting new sponsorships
  isAcceptingNewTransactions = false;
}

// Recovery: replenish and resume
async function replenishAndResume(amount: bigint): Promise<void> {
  // Transfer DUST from a funding source to the sponsor wallet
  await fundingWallet.transfer({
    to: sponsorWallet.address,
    amount,
    token: 'dust',
  });
  
  isAcceptingNewTransactions = true;
}
```

### Monitoring Recommendations

Set up alerts at these thresholds:

| DUST Balance | Status | Action |
|---|---|---|
| > 1,000,000 | Healthy | Normal operation |
| 500,000 - 1,000,000 | Warning | Monitor closely |
| 100,000 - 500,000 | Low | Alert ops team |
| < 100,000 | Critical | Pause new sponsorships |
| 0 | Out of DUST | All transactions fail |

---

## 7. Use Cases

### 7.1 Anonymous Onboarding

The classic use case: a new user visits your DApp and can immediately interact without creating an account, acquiring tokens, or revealing their identity.

```
User lands on DApp → Proves identity via ZK (e.g., proof of unique personhood)
                   → Transaction is sponsored
                   → User is fully onboarded, no tokens required
```

This is particularly powerful for:
- Privacy-preserving identity systems
- Anonymous voting or quadratic funding
- Age-verified content (proving you're 18+ without revealing your ID)

### 7.2 Gasless Transactions

DeFi protocols can offer users gasless trading. The user signs an intent, the sponsor:
1. Receives the intent and builds the transaction
2. Submits via `balanceUnboundTransaction`
3. The trade executes; gas is paid by sponsor

The user gets the same result as if they paid gas themselves, but they've never touched DUST. This is especially valuable on mobile where acquiring tokens is even more friction than on desktop.

### 7.3 Airdrop Claims

A common problem in token airdrops: legitimate users can't claim because they don't have DUST for the claim fee. With sponsorship:

1. Project funds the sponsor wallet with DUST
2. Airdrop claimer submits their ZK proof
3. Sponsor backend calls `balanceUnboundTransaction`
4. Claimer's tokens arrive — they've paid nothing

This dramatically increases airdrop participation and reduces the "dust barrier" that prevents small holders from claiming.

### 7.4 Whale Wallet Recovery

If a large DUST holder's key is compromised or lost, you can build a recovery flow where:
1. The legitimate owner proves ownership (via ZK identity circuit)
2. A sponsor service pays the fees to move the assets to a new wallet
3. Assets are recovered without requiring the original seed phrase

### 7.5 Cross-Chain Bridge Fees

When users bridge assets from another chain to Midnight, the first interaction can be sponsored so users don't need to acquire Midnight-native DUST before bridging. The bridge operator funds the sponsor wallet; users bridge seamlessly.

---

## 8. Limitations and Edge Cases

### Limitations

**1. Sponsor can be DoSed by fake proofs**
A malicious actor can submit infinite invalid proofs. While they won't succeed (the proof verification fails in `balanceUnboundTransaction`), your sponsor service still processes each request. Implement rate limiting and proof-size limits.

**2. Sponsor wallet is a single point of failure**
If the sponsor wallet's seed is compromised, all DUST is at risk. Use hardware security modules (HSMs) or multisig for production sponsor wallets. Consider a hot/cold split where only a small amount of DUST sits in the hot wallet.

**3. No automatic DUST replenishment from revenue**
The sponsor service doesn't automatically pull DUST from contract revenue. You need to build a separate withdrawal/reimbursement mechanism.

**4. `ownPublicKey()` returns prover, not sponsor**
As explained in Section 4, your contract logic must use `ownPublicKey()` for authorization — never the sponsor's key. If you mistakenly use sponsor key for anything, funds will route to the sponsor, not the user.

### Edge Cases

**Proof that requires DUST from the caller's balance**

Some contracts might have a pattern that calls `.balance('dust', ownPublicKey())` expecting the user to have DUST. In a sponsored transaction, this would return 0. If your contract requires the caller to have DUST for its own logic (not just fees), sponsorship won't work with the standard flow.

**Circular sponsorship**

If address A sponsors for address B, and B sponsors for A, this creates a loop. The Midnight node will accept both transactions (each sponsor pays its own fees), but there's no circuit-level protection against this. Detect and block it at the application layer if it's a concern.

**Very large transactions with multiple fee components**

If a contract has multiple state transitions in one transaction (e.g., a batch transfer), each component might generate its own fee commitment. `balanceUnboundTransaction` with `tokenKindsToBalance: ['dust']` pays all of them. Monitor your per-transaction DUST spend.

**Concurrent sponsorship race conditions**

If two sponsor instances use the same wallet seed, both might try to process the same proof. This will fail — proofs are idempotent at the node level (a replayed proof will be rejected), but you'll waste compute. Use a mutex or queue to ensure only one sponsor instance processes each proof.

---

## 9. Security Considerations

### Preventing Sponsor Abuse

The biggest risk to a sponsor service is attackers finding ways to make you pay fees for their transactions without providing any real value to your DApp.

**Defense 1: Proof validity checks**

Before calling `balanceUnboundTransaction`, verify the proof structure:

```typescript
async function sponsorTransaction(proofData: string, contractAddress: string) {
  // First, do a cheap validation before committing sponsor resources
  const parsed = parseProofHeader(proofData);
  
  // Reject if the contract address in the proof doesn't match expected
  if (parsed.contractAddress !== contractAddress) {
    throw new SponsorError('Contract address mismatch', 'VALIDATION_FAIL', false);
  }
  
  // Reject if the proof is older than 5 minutes (replay protection)
  if (parsed.timestamp < Date.now() - 5 * 60 * 1000) {
    throw new SponsorError('Proof too old', 'EXPIRED', false);
  }
  
  // Now proceed with balanceUnboundTransaction
  // ...
}
```

**Defense 2: Contract allowlist**

Only sponsor transactions that call contracts you trust:

```typescript
const ALLOWED_CONTRACTS = new Set([
  'midnight1abc...', // Your DApp's contract
  'midnight1def...', // Partner's contract
]);

if (!ALLOWED_CONTRACTS.has(contractAddress)) {
  return { success: false, error: 'Contract not allowed' };
}
```

**Defense 3: Maximum fee cap**

Never sponsor a transaction that could cost more than a maximum:

```typescript
const MAX_FEE = 100_000n; // DUST

const estimatedFee = estimateFeeFromProof(proofData);
if (estimatedFee > MAX_FEE) {
  return { success: false, error: `Fee exceeds maximum (${estimatedFee} > ${MAX_FEE})` };
}
```

**Defense 4: Rate limiting per IP and per user**

Prevent a single bad actor from exhausting your sponsor budget:

```typescript
const ipLimits = new Map<string, { count: number; resetAt: number }>();

function rateLimit(ip: string, maxPerMinute: number): boolean {
  const now = Date.now();
  const record = ipLimits.get(ip);
  
  if (!record || now > record.resetAt) {
    ipLimits.set(ip, { count: 1, resetAt: now + 60000 });
    return true;
  }
  
  if (record.count >= maxPerMinute) return false;
  record.count++;
  return true;
}
```

**Defense 5: KYC or reputation gates for high-value sponsorships**

For large fees, consider requiring users to have some reputation in your system (a minimum stake, a verified identity, prior transaction history) before they're eligible for sponsorship.

### Secret Seed Protection

Your sponsor wallet seed is the most sensitive secret in your system.

**DO:**
- Store the seed in environment variables or a secrets manager (AWS Secrets Manager, HashiCorp Vault)
- Use HSMs for production sponsor wallets
- Rotate seeds periodically
- Use a dedicated wallet for sponsoring (not the team's main treasury)

**DON'T:**
- Commit seeds to git (even private repos)
- Log seeds (even partial)
- Use the same seed across multiple environments
- Share seeds across team members without need-to-know

---

## 10. Testing the Sponsorship Flow Locally

### Setup: Running a Local Midnight Devnet

```bash
# Clone the Midnight development environment
git clone https://github.com/midnightntwrk/midnight-devnet.git
cd midnight-devnet

# Start the devnet (runs a local Midnight node)
docker compose up -d

# Verify the devnet is running
curl http://localhost:8080/health
```

### Step 1: Fund the Sponsor Wallet

```bash
# Use the Midnight CLI to request DUST from the devnet faucet
midnight-cli faucet request \
  --wallet ./sponsor-wallet.json \
  --amount 1000000 \
  --token dust

# Verify the balance
midnight-cli balance \
  --wallet ./sponsor-wallet.json \
  --token dust
```

### Step 2: Set Up the Sponsor Service

```bash
cd sponsor-service

# Create a .env file (DO NOT COMMIT THIS)
echo "SPONSOR_SEED=your-devnet-seed-phrase" > .env
echo "MIN_DUST_BALANCE=100000" >> .env
echo "MAX_FEE_PER_TX=100000" >> .env
echo "RPC_ENDPOINT=http://localhost:8080" >> .env

npm install
npm run dev
```

### Step 3: Write an Integration Test

```typescript
// test/sponsorship.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SponsorService } from '../src/sponsor.js';

describe('DUST Sponsorship', () => {
  let sponsorService: SponsorService;
  
  beforeAll(async () => {
    sponsorService = new SponsorService({
      sponsorSeed: 'test-sponsor-seed-from-devnet',
      minimumDustBalance: 100000n,
      maxFeePerTransaction: 100000n,
      rpcEndpoint: 'http://localhost:8080',
    });
  });
  
  it('sponsors a valid proof and returns a tx hash', async () => {
    // Build a test proof (in production, this comes from your client)
    const mockProof = await buildMockProof({
      contractAddress: 'test-contract-address',
      action: 'doSomething',
    });
    
    const result = await sponsorService.sponsorTransaction(
      mockProof,
      'test-contract-address',
      'Test sponsorship',
    );
    
    expect(result.success).toBe(true);
    expect(result.txHash).toBeDefined();
    expect(result.dustPaid).toBeGreaterThan(0n);
  });
  
  it('rejects proofs from disallowed contracts', async () => {
    sponsorService = new SponsorService({
      sponsorSeed: 'test-sponsor-seed',
      minimumDustBalance: 100000n,
      maxFeePerTransaction: 100000n,
      rpcEndpoint: 'http://localhost:8080',
      allowedContracts: ['allowed-contract'],
    });
    
    const result = await sponsorService.sponsorTransaction(
      'some-proof-data',
      'disallowed-contract',
      'Test',
    );
    
    expect(result.success).toBe(false);
    expect(result.error).toContain('not allowed');
  });
  
  it('correctly identifies ownPublicKey as the prover, not sponsor', async () => {
    // This test verifies that when we call balanceUnboundTransaction,
    // the circuit's ownPublicKey() still returns the prover's key.
    // We test this by checking the transaction's "caller" field on-chain.
    
    const result = await sponsorService.sponsorTransaction(
      proverProof,
      'test-contract',
      'Verify ownPublicKey',
    );
    
    const onChainCaller = await getTransactionCaller(result.txHash!);
    expect(onChainCaller).toEqual(proverPublicKey); // NOT sponsor's key
    expect(onChainCaller).not.toEqual(sponsorService.getSponsorPublicKey());
  });
});
```

### Step 4: Verify the Flow End-to-End

```bash
# Run the integration test
npm test

# Check the sponsor's DUST balance after the test
npm run check-balance

# The balance should be lower than before, confirming DUST was spent
```

### Common Test Failures

| Error | Cause | Fix |
|---|---|---|
| `balanceUnboundTransaction: proof verification failed` | The proof is malformed or from a different contract | Verify the proof was built correctly by the client |
| `Insufficient DUST balance` | Sponsor wallet has no DUST | Request more from the devnet faucet |
| `Contract not allowed` | Contract not in allowlist | Add to allowedContracts or remove restriction |
| `Proof too old` | Timestamp check failed | Use a fresh proof in the test |
| `RPC endpoint unreachable` | Devnet not running | Run `docker compose up -d` |

### Manual Verification

```bash
# Check the sponsor wallet balance after several sponsored txs
midnight-cli balance --wallet ./sponsor-wallet.json --token dust

# Check a specific transaction on the devnet
midnight-cli tx --hash <txHash> --node http://localhost:8080

# Verify the prover's key (not sponsor's) is recorded as the caller
midnight-cli tx --hash <txHash> --verbose | grep caller
```

---

## Conclusion

DUST sponsorship transforms the Midnight onboarding experience. New users can interact with privacy-preserving DApps without ever acquiring DUST, while sponsors — whether DApp operators, protocols, or community programs — cover fees on their behalf.

The critical points to remember:

- **Call `balanceUnboundTransaction` with `tokenKindsToBalance: ['dust']`** to sponsor fees from your backend wallet
- **`ownPublicKey()` always returns the prover's (user's) key**, never the sponsor's — build all authorization logic around this
- **Implement rate limits, allowlists, and fee caps** to prevent sponsor abuse
- **Monitor DUST balance and set up alerts** before running out during peak usage
- **Test the full flow locally** before deploying to mainnet

With these patterns in place, you can build truly frictionless onboarding for any Midnight DApp.

---

## References

- [Midnight Documentation](https://docs.midnight.network)
- [@midnight-ntwrk/compact-runtime API Reference](https://docs.midnight.network/api-reference/compact-runtime.md)
- [ownPublicKey() Function](https://docs.midnight.network/api-reference/compact-runtime/functions/ownPublicKey.md)
- [Midnight Developer Forum](https://forum.midnight.network/)
- [Discord Community](https://discord.com/invite/midnightnetwork)

---

*Published for Midnight Contributor Hub Bounty #299*