# Testing Compact Contracts: Unit Tests, Assertions, and Local Simulation

Testing smart contracts is non-negotiable. In the Midnight ecosystem, Compact contracts compile to circuit artifacts that run inside zero-knowledge proofs — which means bugs surface late and are expensive to fix. This tutorial walks you through building a reliable test harness using the `Contract` class from compiled Compact output, writing vitest tests that exercise circuit calls and verify ledger state, and wiring everything into a GitHub Actions CI pipeline.

## Why Test Compact Contracts?

Compact contracts produce two artifacts: a compiled circuit and a TypeScript module. The TypeScript module exposes a `Contract` class with methods that map one-to-one to the circuits defined in your `.compact` file. When you call a method like `counter.increment()`, the runtime constructs a zero-knowledge proof locally. Your tests run this full proof pipeline against a simulated ledger — no network required.

The key insight: **you can test the complete proof cycle without deploying to a network**. The simulator gives you a local ledger, a local proof server, and deterministic results.

## 1. Setting Up the Test Environment

### Project Structure

```
my-contract/
├── contracts/
│   └── counter.compact
├── build/
│   └── counter/          # Compiled output
├── tests/
│   ├── setup.ts
│   └── counter.unit.test.ts
├── vitest.config.ts
└── package.json
```

### Dependencies

```bash
npm install -D vitest @midnight-ntwrk/compact-runtime @midnight-ntwrk/zswap
```

### Compiling the Contract

Before running tests, compile your `.compact` file:

```bash
npx compactc contracts/counter.compact build/counter
```

This produces:
- `build/counter/contract/index.ts` — The `Contract` class
- `build/counter/contract/index.d.ts` — Type definitions
- `build/counter/circuit/` — Compiled circuit artifacts

### Vitest Configuration

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 60_000,       // ZK proofs are slow
    hookTimeout: 60_000,
    pool: 'forks',             // Isolate proof state between tests
    poolOptions: {
      forks: { singleFork: false }
    }
  }
});
```

The long timeout matters. ZK proof generation can take 10-30 seconds per circuit call on consumer hardware. Setting `pool: 'forks'` prevents state leaking between test files.

## 2. Building a Contract Simulator

The simulator is a thin wrapper around the compiled `Contract` class that manages ledger state, wallet contexts, and proof generation.

### The Simulator Helper

```typescript
// tests/setup.ts
import { Contract } from '../build/counter/contract/index.js';
import { createShieldedLedger } from '@midnight-ntwrk/compact-runtime';

export interface TestContext {
  contract: Contract;
  ledger: ReturnType<typeof createShieldedLedger>;
  wallet: any;
  cleanup: () => Promise<void>;
}

export async function createTestContext(): Promise<TestContext> {
  const ledger = await createShieldedLedger();
  const wallet = await ledger.createWallet();

  const contract = new Contract({
    ledger,
    wallet,
  });

  return {
    contract,
    ledger,
    wallet,
    cleanup: async () => {
      await ledger.close();
    },
  };
}
```

The `createShieldedLedger()` function returns an in-memory ledger backed by the compact-runtime. No Docker, no network. It is fully deterministic and starts fresh on every invocation.

### Deploying the Contract in Tests

```typescript
const ctx = await createTestContext();

// Deploy — this runs the constructor circuit
const deployTx = await ctx.contract.deploy();
await ctx.ledger.commitTransaction(deployTx);
```

The `deploy()` method returns a transaction. You must commit it to the ledger explicitly. This pattern — call a circuit method, get a transaction, commit it — is the fundamental cycle for all Compact interactions.

## 3. Writing Vitest Tests for Circuit Calls

### Unit Testing the Counter Contract

```typescript
// tests/counter.unit.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, TestContext } from './setup';

describe('Counter Contract', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
    const deployTx = await ctx.contract.deploy();
    await ctx.ledger.commitTransaction(deployTx);
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it('should start at zero', async () => {
    const value = await ctx.contract.queryValue();
    expect(value).toBe(0n);
  });

  it('should increment the counter', async () => {
    const tx = await ctx.contract.increment();
    await ctx.ledger.commitTransaction(tx);

    const value = await ctx.contract.queryValue();
    expect(value).toBe(1n);
  });

  it('should increment multiple times', async () => {
    for (let i = 0; i < 5; i++) {
      const tx = await ctx.contract.increment();
      await ctx.ledger.commitTransaction(tx);
    }

    const value = await ctx.contract.queryValue();
    expect(value).toBe(5n);
  });

  it('should decrement the counter', async () => {
    // Increment first
    const incTx = await ctx.contract.increment();
    await ctx.ledger.commitTransaction(incTx);

    // Then decrement
    const decTx = await ctx.contract.decrement();
    await ctx.ledger.commitTransaction(decTx);

    const value = await ctx.contract.queryValue();
    expect(value).toBe(0n);
  });
});
```

### Key Testing Patterns

**Pattern 1: Query after every mutation.** Always verify the ledger state after committing a transaction. Do not assume success.

**Pattern 2: Clean up resources.** The ledger holds file handles and memory. Always close it in `afterEach`.

**Pattern 3: Test the happy path first, then edge cases.** Counter at zero, increment, decrement — get these right before testing overflows or access control.

## 4. Verifying Ledger State Changes

The ledger is the source of truth. After each transaction, query the contract's public state and assert the values.

### Inspecting Raw Ledger State

```typescript
it('should update the ledger timestamp', async () => {
  const blockBefore = await ctx.ledger.getBlockHeight();

  const tx = await ctx.contract.increment();
  await ctx.ledger.commitTransaction(tx);

  const blockAfter = await ctx.ledger.getBlockHeight();
  expect(blockAfter).toBeGreaterThan(blockBefore);
});
```

### Testing Event Emissions

If your contract emits events (via `emit` in Compact), you can capture them:

```typescript
it('should emit an Incremented event', async () => {
  const events: any[] = [];
  ctx.contract.on('Incremented', (e) => events.push(e));

  const tx = await ctx.contract.increment();
  await ctx.ledger.commitTransaction(tx);

  expect(events).toHaveLength(1);
  expect(events[0].newValue).toBe(1n);
});
```

### Testing Failure Cases

Compact circuits fail by returning an error proof. In the simulator, this surfaces as a thrown exception:

```typescript
it('should reject decrement below zero', async () => {
  await expect(async () => {
    const tx = await ctx.contract.decrement();
    await ctx.ledger.commitTransaction(tx);
  }).rejects.toThrow();
});
```

## 5. Integration Tests Against a Local Docker Stack

Unit tests run against the in-memory simulator. Integration tests run against a real Midnight node in Docker. This catches issues that only appear with real network timing, transaction ordering, and proof server interaction.

### Docker Compose Setup

```yaml
# docker-compose.test.yml
services:
  midnight-node:
    image: midnightntwrk/midnight-node:latest
    ports:
      - "9944:9944"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9944/health"]
      interval: 5s
      timeout: 3s
      retries: 10

  proof-server:
    image: midnightntwrk/midnight-proof-server:latest
    ports:
      - "6300:6300"
    depends_on:
      midnight-node:
        condition: service_healthy
```

### Integration Test Setup

```typescript
// tests/vault.integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { dockerCompose } from './docker-utils';

describe('Vault Contract (Integration)', () => {
  let compose: any;

  beforeAll(async () => {
    compose = await dockerCompose.up('docker-compose.test.yml');
    await compose.waitForHealthy();
  }, 120_000);

  afterAll(async () => {
    await compose.down();
  });

  it('should deposit and withdraw tokens', async () => {
    // Connect to real node
    const nodeUrl = 'ws://localhost:9944';
    const proofServerUrl = 'http://localhost:6300';

    // Deploy contract to the real chain
    // ... (full integration flow)
  }, 120_000);
});
```

### When to Use Integration Tests

- **Unit tests** for logic correctness, edge cases, fast feedback
- **Integration tests** for network behavior, proof server interaction, multi-transaction flows

Run unit tests on every commit. Run integration tests on PRs and releases.

## 6. Setting Up GitHub Actions CI

### Workflow Configuration

```yaml
# .github/workflows/test-compact.yml
name: Test Compact Contracts

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - run: npm ci

      - name: Install Compact compiler
        run: npm install -g @midnight-ntwrk/compactc

      - name: Compile contracts
        run: |
          mkdir -p build
          compactc contracts/counter.compact build/counter
          compactc contracts/vault.compact build/vault

      - name: Run unit tests
        run: npx vitest run tests/*.unit.test.ts --reporter=junit --outputFile=results.xml

      - uses: dorny/test-reporter@v1
        if: always()
        with:
          name: Unit Tests
          path: results.xml
          reporter: vitest-junit

  integration-tests:
    runs-on: ubuntu-latest
    needs: unit-tests
    services:
      midnight-node:
        image: midnightntwrk/midnight-node:latest
        ports:
          - 9944:9944
        options: >-
          --health-cmd "curl -f http://localhost:9944/health || exit 1"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 10

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - run: npm ci

      - name: Install Compact compiler
        run: npm install -g @midnight-ntwrk/compactc

      - name: Compile contracts
        run: compactc contracts/vault.compact build/vault

      - name: Run integration tests
        run: npx vitest run tests/*.integration.test.ts
        env:
          NODE_URL: ws://localhost:9944
          PROOF_SERVER_URL: http://localhost:6300
```

### CI Pipeline Breakdown

The pipeline has two stages:

1. **Unit tests** run on every push and PR. They use the in-memory simulator, take 2-5 minutes, and catch 90% of bugs.

2. **Integration tests** run only after unit tests pass. They spin up a Midnight node as a service container, deploy real contracts, and test multi-transaction flows.

The `dorny/test-reporter` action renders test results directly in the PR, so reviewers can see exactly what passed and failed.

## 7. Debugging Failed Tests

### Common Failure Modes

**"Proof generation failed"** — Your circuit has a constraint violation. Check that input types match the circuit signature. Compact is strict about types.

**"Ledger state mismatch"** — You committed a transaction but the ledger did not update. Check that you called `commitTransaction()` after every circuit call.

**"Timeout"** — ZK proofs are slow. Increase the test timeout or reduce the number of iterations in parameterized tests.

**"Wallet context not found"** — You forgot to pass the wallet to the `Contract` constructor, or the wallet was closed.

### Debug Logging

Enable verbose logging to trace proof generation:

```typescript
process.env.COMPACT_LOG_LEVEL = 'debug';
```

This prints the circuit input, constraint count, and proof generation time for each call.

## 8. Best Practices

1. **Test one circuit per test case.** Do not chain multiple mutations in a single `it()` block unless you are testing the chain specifically.

2. **Use `beforeEach` for setup, not `beforeAll`.** Each test gets a fresh contract instance. Shared state between tests is the number one source of flaky tests.

3. **Assert on the ledger, not the return value.** Circuit return values are transient. The ledger is the source of truth.

4. **Keep tests deterministic.** Do not use `Date.now()` or `Math.random()` in test inputs. Use fixed values.

5. **Run tests in parallel where possible.** Vitest's `pool: 'forks'` mode runs test files in separate processes. This is safe because each test creates its own ledger.

6. **Mock the proof server for unit tests.** Integration tests should use the real proof server. Unit tests should mock it for speed.

## Summary

Testing Compact contracts follows a predictable cycle: compile the contract, create a simulator context, call circuit methods, commit transactions, and assert on ledger state. The vitest framework provides the test runner, and GitHub Actions provides the CI backbone. Unit tests catch logic errors in seconds; integration tests catch network issues in minutes.

Start with the counter contract. Get one test passing. Then expand.

## Further Reading

- [Midnight Docs — Getting Started](https://docs.midnight.network/getting-started)
- [Midnight MCP — NPM Package](https://www.npmjs.com/package/midnight-mcp)
- [example-battleship — Test Scaffolding Reference](https://github.com/midnightntwrk/example-battleship)
- [Midnight Developer Forum](https://forum.midnight.network/)
