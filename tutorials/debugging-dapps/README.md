# Debugging Midnight dApps: A Complete Guide

**Difficulty:** Intermediate  
**Estimated Reading Time:** 15 minutes  
**Prerequisites:** Basic familiarity with TypeScript, Midnight Network architecture, and Compact smart contract language  

---

## Table of Contents

1. [Introduction](#introduction)
2. [Understanding the Midnight dApp Architecture](#understanding-the-midnight-dapp-architecture)
3. [Setting Up Your Debug Environment](#setting-up-your-debug-environment)
4. [Debugging Compact Smart Contracts](#debugging-compact-smart-contracts)
5. [Debugging the TypeScript Middleware Layer](#debugging-the-typescript-middleware-layer)
6. [Transaction Debugging](#transaction-debugging)
7. [Common Error Patterns and Solutions](#common-error-patterns-and-solutions)
8. [Testing Strategies for Midnight dApps](#testing-strategies-for-midnight-dapps)
9. [Advanced Debugging Techniques](#advanced-debugging-techniques)
10. [Best Practices and Tips](#best-practices-and-tips)
11. [Conclusion](#conclusion)

---

## Introduction

Debugging decentralized applications (dApps) on the Midnight Network presents unique challenges compared to traditional web development. Midnight's privacy-preserving architecture, built on zero-knowledge proofs and the Compact smart contract language, introduces layers of complexity that require specialized debugging approaches.

This tutorial provides a comprehensive, hands-on guide to identifying, isolating, and resolving bugs in Midnight dApps. Whether you are dealing with smart contract logic errors, transaction failures, middleware integration issues, or front-end connectivity problems, this guide will equip you with the tools and techniques needed to debug effectively.

By the end of this tutorial, you will understand how to:
- Set up a complete local debugging environment for Midnight dApps
- Debug Compact smart contracts using logging and assertion patterns
- Trace transactions through the Midnight proof server and node infrastructure
- Identify and resolve common error patterns in the middleware layer
- Implement robust testing strategies to prevent regressions

---

## Understanding the Midnight dApp Architecture

Before diving into debugging, it is essential to understand the layered architecture of a typical Midnight dApp. This knowledge will help you pinpoint which layer a bug originates from.

### The Four Layers

**1. Compact Smart Contract Layer**
The on-chain logic is written in Compact, Midnight's domain-specific language for privacy-preserving smart contracts. Contracts define state transitions, ZK circuits, and ledger structures. Bugs here are the hardest to fix after deployment, making thorough testing critical.

**2. Proof Server**
The proof server is a local service that generates zero-knowledge proofs for transactions. It acts as the bridge between your application logic and the on-chain verification. Issues at this layer often manifest as proof generation failures or unexpected cryptographic errors.

**3. TypeScript Middleware (DApp Backend)**
The middleware layer, typically written in TypeScript using the Midnight.js SDK, manages wallet interactions, transaction construction, and communication with the proof server and Midnight node. This is where most integration bugs occur.

**4. Frontend (UI Layer)**
The user interface interacts with the middleware layer to submit transactions and display state. Frontend bugs are usually standard web development issues but can be complicated by the asynchronous nature of blockchain interactions.

### Data Flow

Understanding data flow helps you trace bugs across layers:

```
User Action → Frontend → Middleware (TypeScript) → Proof Server → Midnight Node → Ledger
                ↑                                                        ↓
                └──────────── Transaction Result / State Update ─────────┘
```

When a bug occurs, start by identifying which segment of this flow is broken, then narrow down from there.

---

## Setting Up Your Debug Environment

A proper debug environment is the foundation of effective debugging. Here is how to set one up for Midnight dApp development.

### Prerequisites

Ensure you have the following installed:
- **Node.js** (v18 or later) and **npm** or **yarn**
- **Docker** (for running the proof server and testnet node)
- **Midnight CLI tools** (installed via npm)
- **A code editor** with TypeScript support (VS Code recommended)

### Setting Up the Local Testnet

The Midnight testnet-in-a-box provides a fully local environment for development and debugging:

```bash
# Clone the testnet-in-a-box repository
git clone https://github.com/midnightntwrk/testnet-in-a-box.git
cd testnet-in-a-box

# Start the local testnet
docker-compose up -d

# Verify services are running
docker-compose ps
```

You should see containers for:
- `midnight-node` — the blockchain node
- `proof-server` — the ZK proof generation service
- `indexer` — the blockchain indexer

### Configuring Environment Variables

Create a `.env` file in your dApp project root:

```env
# Node connection
MIDNIGHT_NODE_URL=ws://localhost:9944
MIDNIGHT_INDEXER_URL=http://localhost:8088

# Proof server
PROOF_SERVER_URL=http://localhost:6300

# Wallet seed for testing (NEVER use in production)
WALLET_SEED=your-test-seed-phrase-here

# Debug flags
DEBUG=midnight:*
LOG_LEVEL=debug
```

The `DEBUG=midnight:*` environment variable enables verbose logging across the Midnight.js libraries, which is invaluable for tracing issues.

### VS Code Debug Configuration

Add the following to your `.vscode/launch.json` for integrated debugging:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug Midnight dApp",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/src/index.ts",
      "runtimeArgs": ["-r", "ts-node/register"],
      "env": {
        "DEBUG": "midnight:*",
        "LOG_LEVEL": "debug"
      },
      "console": "integratedTerminal",
      "sourceMaps": true,
      "skipFiles": ["<node_modules>/**"]
    }
  ]
}
```

This configuration lets you set breakpoints directly in your TypeScript source code and inspect variables at runtime.

---

## Debugging Compact Smart Contracts

Compact contracts are the heart of your dApp. Bugs in contract logic can lead to incorrect state transitions, failed proofs, or security vulnerabilities.

### Using Assert Statements

Compact supports `assert` statements that can be used as guard clauses and debugging aids:

```compact
contract DebugExample {
  ledger counter: Counter;

  transition increment(amount: Unsigned<64>): [] {
    // Debug assertion: ensure amount is reasonable
    assert amount > 0 "Amount must be positive";
    assert amount < 1000 "Amount seems unreasonably large, possible bug";

    counter.increment(amount);
  }
}
```

When an assertion fails, the transaction is rejected with a descriptive error message. Use assertions liberally during development, and consider keeping critical ones in production code.

### Inspecting ZK Circuit Constraints

When a proof generation fails, the issue is often in the ZK circuit constraints defined by your Compact contract. Common causes include:

- **Constraint unsatisfiability:** Two constraints contradict each other. For example, asserting `x > 10` and `x < 5` simultaneously.
- **Missing witness generation:** A private input is referenced but never provided.
- **Type mismatches:** Using a `Signed<32>` value where `Unsigned<64>` is expected.

To debug constraint issues:

1. **Simplify the contract:** Comment out transitions or constraints one by one to isolate the problematic section.
2. **Check witness values:** Log the witness values being passed to the proof server and verify they satisfy all constraints.
3. **Use the Compact compiler warnings:** The Compact compiler emits warnings for common issues. Pay attention to these.

### Contract State Inspection

You can query the ledger state to verify your contract behaves as expected:

```typescript
import { connect } from '@midnight-ntwrk/midnight-js-network';

async function inspectState(contractAddress: string) {
  const connection = await connect(nodeUrl);
  const state = await connection.getContractState(contractAddress);
  
  console.log('Contract State:', JSON.stringify(state, null, 2));
  
  // Inspect specific ledger values
  if (state.ledger.counter) {
    console.log('Counter value:', state.ledger.counter);
  }
  
  return state;
}
```

Run this function after each transaction to verify state transitions are correct.

---

## Debugging the TypeScript Middleware Layer

The middleware layer is where most integration bugs occur. Here are systematic approaches to debugging it.

### Structured Logging

Implement structured logging throughout your middleware:

```typescript
import debug from 'debug';

const log = debug('midnight:dapp');
const logTx = debug('midnight:dapp:transaction');
const logProof = debug('midnight:dapp:proof');

async function submitTransaction(tx: Transaction) {
  logTx('Preparing transaction', { 
    type: tx.type, 
    timestamp: Date.now() 
  });

  try {
    logProof('Requesting proof generation...');
    const startTime = Date.now();
    
    const proof = await proofServer.generateProof(tx);
    
    logProof('Proof generated successfully', { 
      durationMs: Date.now() - startTime,
      proofSize: proof.length 
    });

    logTx('Submitting transaction to network...');
    const result = await network.submitTransaction(proof);
    
    logTx('Transaction confirmed', { 
      txHash: result.txHash,
      blockHeight: result.blockHeight 
    });

    return result;
  } catch (error) {
    log('Transaction failed', { 
      error: error.message, 
      stack: error.stack,
      txType: tx.type 
    });
    throw error;
  }
}
```

The `debug` module outputs to stderr and can be controlled via the `DEBUG` environment variable, making it safe to leave in production code.

### Error Boundary Pattern

Wrap each major subsystem in error boundaries to prevent cascading failures:

```typescript
class MidnightDApp {
  private proofServer: ProofServerConnection;
  private network: NetworkConnection;
  private wallet: WalletManager;

  async initialize(): Promise<void> {
    try {
      this.proofServer = await this.connectProofServer();
      log('Proof server connected');
    } catch (error) {
      console.error('Failed to connect to proof server:', error.message);
      console.error('Ensure the proof server is running at', PROOF_SERVER_URL);
      throw error;
    }

    try {
      this.network = await this.connectNetwork();
      log('Network connected');
    } catch (error) {
      console.error('Failed to connect to Midnight node:', error.message);
      console.error('Ensure the node is running at', NODE_URL);
      throw error;
    }

    try {
      this.wallet = await this.initializeWallet();
      log('Wallet initialized');
    } catch (error) {
      console.error('Failed to initialize wallet:', error.message);
      throw error;
    }
  }
}
```

This pattern tells you exactly which subsystem failed, saving significant debugging time.

### Wallet and Key Management Debugging

Wallet-related issues are common. Debug them systematically:

```typescript
async function debugWallet(wallet: WalletManager) {
  // Check wallet connectivity
  const isConnected = await wallet.isConnected();
  console.log('Wallet connected:', isConnected);

  // Verify balance
  const balance = await wallet.getBalance();
  console.log('Wallet balance:', balance);

  // Check coin status
  const coins = await wallet.getCoins();
  console.log('Number of coins:', coins.length);
  coins.forEach((coin, i) => {
    console.log(`  Coin ${i}:`, {
      type: coin.type,
      value: coin.value,
      spent: coin.spent
    });
  });

  // Verify key derivation
  const address = await wallet.getAddress();
  console.log('Wallet address:', address);
}
```

Common wallet issues include:
- Insufficient balance for transaction fees
- Spent coins being referenced (double-spend detection)
- Key derivation path mismatches between wallet and dApp

---

## Transaction Debugging

Transactions are the critical operations in any dApp. Here is how to debug them effectively.

### Transaction Lifecycle Tracing

Every Midnight transaction goes through these stages:

1. **Construction** — Building the transaction object
2. **Proof Generation** — Creating ZK proofs via the proof server
3. **Submission** — Sending to the network
4. **Mempool** — Waiting to be included in a block
5. **Inclusion** — Included in a block
6. **Finality** — Confirmed and irreversible

Create a tracer that logs each stage:

```typescript
enum TxStage {
  CONSTRUCTED = 'constructed',
  PROOF_GENERATED = 'proof_generated',
  SUBMITTED = 'submitted',
  IN_MEMPOOL = 'in_mempool',
  INCLUDED = 'included',
  FINALIZED = 'finalized',
  FAILED = 'failed'
}

class TransactionTracer {
  private stages: Map<string, { stage: TxStage; timestamp: number; data?: any }[]> = new Map();

  trace(txId: string, stage: TxStage, data?: any): void {
    if (!this.stages.has(txId)) {
      this.stages.set(txId, []);
    }
    
    const entry = { stage, timestamp: Date.now(), data };
    this.stages.get(txId)!.push(entry);
    
    console.log(`[TX:${txId.slice(0, 8)}] ${stage}`, data || '');
  }

  getTimeline(txId: string): void {
    const entries = this.stages.get(txId) || [];
    console.log(`\nTransaction ${txId} Timeline:`);
    entries.forEach((entry, i) => {
      const duration = i > 0 
        ? ` (+${entry.timestamp - entries[i-1].timestamp}ms)` 
        : '';
      console.log(`  ${entry.stage}${duration}`, entry.data || '');
    });
  }
}
```

### Proof Server Debugging

The proof server is often the source of mysterious failures. Debug it with these techniques:

```typescript
async function debugProofGeneration(tx: Transaction): Promise<Proof> {
  console.log('--- Proof Generation Debug ---');
  console.log('Transaction type:', tx.type);
  console.log('Inputs:', JSON.stringify(tx.inputs, null, 2));
  console.log('Outputs:', JSON.stringify(tx.outputs, null, 2));

  // Check proof server health
  const health = await fetch(`${PROOF_SERVER_URL}/health`);
  console.log('Proof server status:', health.status);

  // Measure proof generation time
  const start = performance.now();
  
  try {
    const proof = await proofServer.generateProof(tx);
    const duration = performance.now() - start;
    
    console.log('Proof generated successfully');
    console.log('Duration:', `${duration.toFixed(2)}ms`);
    console.log('Proof size:', proof.length, 'bytes');
    
    return proof;
  } catch (error) {
    console.error('Proof generation FAILED');
    console.error('Error:', error.message);
    console.error('This usually means:');
    console.error('  1. Invalid witness values (check your inputs)');
    console.error('  2. Constraint unsatisfiability (check contract logic)');
    console.error('  3. Proof server out of memory or crashed');
    throw error;
  }
}
```

---

## Common Error Patterns and Solutions

Here are the most frequently encountered errors in Midnight dApp development and their solutions.

### Error: "Proof generation failed: constraint not satisfied"

**Cause:** The inputs to your ZK circuit do not satisfy all defined constraints.

**Solution:**
1. Check that all witness values are within valid ranges.
2. Verify that private inputs match the expected types (e.g., `Unsigned<64>` vs `Signed<32>`).
3. Ensure that nullifier computations are correct and consistent.
4. Add logging before proof generation to inspect all input values.

### Error: "Transaction rejected by node"

**Cause:** The transaction is structurally valid but fails on-chain validation.

**Solution:**
1. Check for double-spend attempts (referencing already-spent coins).
2. Verify the transaction fee is sufficient.
3. Ensure the contract state matches your expected state (another transaction may have changed it).
4. Check that the proof attached to the transaction is for the correct circuit.

### Error: "Connection refused to proof server"

**Cause:** The proof server is not running or is unreachable.

**Solution:**
1. Verify the proof server container is running: `docker ps | grep proof-server`
2. Check the proof server logs: `docker logs proof-server`
3. Ensure the URL in your configuration matches the actual server address.
4. Restart the proof server if it has crashed due to memory issues.

### Error: "Insufficient balance for transaction"

**Cause:** The wallet does not have enough tokens to cover the transaction amount plus fees.

**Solution:**
1. Query the wallet balance and list unspent coins.
2. Check if coins are stuck in a pending state.
3. Request additional testnet tokens from the faucet.
4. Verify that coin selection logic handles fragmented UTXOs correctly.

### Error: "State deserialization failed"

**Cause:** The on-chain contract state does not match the expected TypeScript type.

**Solution:**
1. Ensure your TypeScript types are in sync with the latest Compact contract.
2. Regenerate type bindings after contract changes.
3. Check for Compact compiler version mismatches.
4. Verify the contract address is correct (you might be reading from a different contract).

---

## Testing Strategies for Midnight dApps

Prevention is better than debugging. Implement these testing strategies to catch bugs early.

### Unit Testing Compact Contracts

Test individual transitions in isolation:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { deployContract, createTestContext } from '@midnight-ntwrk/compact-testing';

describe('Counter Contract', () => {
  let contract: ContractHandle;
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestContext();
    contract = await deployContract(context, 'counter.compact');
  });

  it('should increment counter', async () => {
    await contract.submit('increment', [10n]);
    const state = await contract.getLedgerState();
    expect(state.counter).toEqual(10n);
  });

  it('should reject zero increment', async () => {
    await expect(
      contract.submit('increment', [0n])
    ).rejects.toThrow('Amount must be positive');
  });

  it('should handle multiple increments', async () => {
    await contract.submit('increment', [5n]);
    await contract.submit('increment', [3n]);
    const state = await contract.getLedgerState();
    expect(state.counter).toEqual(8n);
  });
});
```

### Integration Testing

Test the full stack with a local testnet:

```typescript
describe('Integration: Full Transaction Flow', () => {
  let dapp: MidnightDApp;

  beforeAll(async () => {
    dapp = new MidnightDApp(testConfig);
    await dapp.initialize();
    await dapp.wallet.fundFromFaucet();
  });

  it('should complete a full transaction lifecycle', async () => {
    const initialBalance = await dapp.wallet.getBalance();
    
    const result = await dapp.submitTransaction({
      type: 'increment',
      amount: 42n
    });

    expect(result.txHash).toBeDefined();
    expect(result.blockHeight).toBeGreaterThan(0);

    const finalBalance = await dapp.wallet.getBalance();
    expect(finalBalance).toBeLessThan(initialBalance); // Fee deducted
  });

  afterAll(async () => {
    await dapp.shutdown();
  });
});
```

### Property-Based Testing

Use property-based testing to find edge cases:

```typescript
import fc from 'fast-check';

describe('Property: Counter invariants', () => {
  it('counter should always equal sum of increments', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.bigUint({ max: 1000n }), { minLength: 1, maxLength: 20 }),
        async (amounts) => {
          // Reset contract state
          const contract = await deployFreshContract();
          
          let expectedSum = 0n;
          for (const amount of amounts) {
            await contract.submit('increment', [amount]);
            expectedSum += amount;
          }

          const state = await contract.getLedgerState();
          expect(state.counter).toEqual(expectedSum);
        }
      ),
      { numRuns: 50 }
    );
  });
});
```

---

## Advanced Debugging Techniques

### Network Traffic Inspection

Monitor all communication between your dApp and the Midnight infrastructure:

```typescript
import { createProxyMiddleware } from 'http-proxy-middleware';

// Create a logging proxy for the proof server
const loggingProxy = createProxyMiddleware({
  target: PROOF_SERVER_URL,
  changeOrigin: true,
  onProxyReq: (proxyReq, req) => {
    console.log(`[→ ${req.method}] ${req.url}`);
    console.log('  Headers:', req.headers);
  },
  onProxyRes: (proxyRes, req) => {
    console.log(`[← ${proxyRes.statusCode}] ${req.url}`);
    console.log('  Duration:', Date.now() - req.startTime, 'ms');
  }
});
```

### State Snapshot Comparison

Take snapshots of contract state before and after transactions to verify correctness:

```typescript
async function compareStates(
  contractAddress: string,
  transaction: () => Promise<void>
): Promise<void> {
  const before = await getContractState(contractAddress);
  
  await transaction();
  
  const after = await getContractState(contractAddress);
  
  console.log('\n--- State Diff ---');
  for (const key of Object.keys(before.ledger)) {
    const bVal = JSON.stringify(before.ledger[key]);
    const aVal = JSON.stringify(after.ledger[key]);
    
    if (bVal !== aVal) {
      console.log(`  ${key}: ${bVal} → ${aVal}`);
    }
  }
}
```

### Memory and Performance Profiling

For long-running dApps, monitor memory usage and performance:

```typescript
function logMemoryUsage(context: string): void {
  const usage = process.memoryUsage();
  console.log(`[${context}] Memory:`, {
    rss: `${(usage.rss / 1024 / 1024).toFixed(2)} MB`,
    heapUsed: `${(usage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
    heapTotal: `${(usage.heapTotal / 1024 / 1024).toFixed(2)} MB`,
    external: `${(usage.external / 1024 / 1024).toFixed(2)} MB`
  });
}
```

---

## Best Practices and Tips

1. **Always start debugging at the boundary.** When a bug occurs, first determine which layer (contract, proof server, middleware, frontend) is responsible before diving deep.

2. **Use deterministic test seeds.** When debugging intermittent failures, fix your random seeds so you can reproduce the exact conditions.

3. **Keep a debug journal.** Document unusual errors and their solutions. Midnight is a young ecosystem, and you will encounter novel issues.

4. **Read the proof server logs.** The proof server often provides the most useful error messages for contract-level issues. Check `docker logs proof-server` frequently.

5. **Test with minimal state.** When debugging complex scenarios, start with the simplest possible contract state and gradually add complexity until the bug appears.

6. **Version everything.** Pin your Compact compiler version, Midnight.js SDK version, and proof server version. Version mismatches are a common source of cryptic errors.

7. **Use the testnet faucet generously.** Do not debug with scarce resources. Fund your test wallet generously and reset it when state becomes confusing.

8. **Join the Midnight Discord.** The community is active and helpful. Search the Discord for your error message before spending hours debugging alone.

9. **Implement circuit breakers.** In production dApps, implement circuit breakers that halt operations when the proof server or node becomes unresponsive, rather than queuing up failing transactions.

10. **Profile proof generation.** ZK proof generation is computationally expensive. If your dApp feels slow, profile which proofs are taking the longest and consider optimizing the circuit or batching operations.

---

## Conclusion

Debugging Midnight dApps requires a systematic approach that spans the entire technology stack — from Compact smart contracts and ZK proof generation to TypeScript middleware and frontend integration. The key principles are:

- **Layer isolation:** Identify which layer contains the bug before diving into details.
- **Structured logging:** Use the `debug` module and structured logs to trace execution flow.
- **Systematic testing:** Implement unit tests, integration tests, and property-based tests.
- **Environment control:** Use local testnets with deterministic configurations.
- **Community resources:** Leverage the Midnight community and documentation.

With the techniques and patterns described in this guide, you should be well-equipped to debug even the most challenging issues in your Midnight dApps. Remember that debugging privacy-preserving applications is inherently more complex than traditional development, so patience and systematic thinking are your greatest assets.

---

## Additional Resources

- [Midnight Developer Documentation](https://docs.midnight.network/)
- [Compact Language Reference](https://docs.midnight.network/compact/)
- [Midnight.js SDK Documentation](https://docs.midnight.network/midnight-js/)
- [Midnight Discord Community](https://discord.gg/midnightnetwork)
- [GitHub: Midnight Network](https://github.com/midnightntwrk)

---

*This tutorial was created as part of the Midnight Network Contributor Hub bounty program. For questions or feedback, please open an issue in the contributor-hub repository.*
