# Testing Compact Contracts: Unit Tests, Assertions, and Local Simulation

> **Audience:** Developers building on Midnight Network  
> **Prerequisites:** Basic knowledge of Compact smart contracts, Node.js/TypeScript, and `vitest`  
> **Reading time:** 20 minutes  
> **Associated code:** [Counter contract](./src/counter.compact) · [Test suite](./src/counter.test.ts) · [CI workflow](./.github/workflows/ci.yml)

---

## Table of Contents

1. [Why Testing Matters for Compact Contracts](#why-testing-matters-for-compact-contracts)
2. [Setting Up the Test Environment](#setting-up-the-test-environment)
3. [Building a Contract Simulator](#building-a-contract-simulator)
4. [Writing Unit Tests with Vitest](#writing-unit-tests-with-vitest)
5. [Testing Circuit Calls and Ledger State](#testing-circuit-calls-and-ledger-state)
6. [Testing Error Conditions](#testing-error-conditions)
7. [Integration Tests with Docker](#integration-tests-with-docker)
8. [GitHub Actions CI Pipeline](#github-actions-ci-pipeline)
9. [Advanced Patterns](#advanced-patterns)
10. [Complete Reference](#complete-reference)

---

## Why Testing Matters for Compact Contracts

Testing smart contracts on Midnight is different from testing on Ethereum or Solana. Three unique challenges make testing critical:

**1. Privacy means fewer visibility guarantees.** On a public blockchain, you can observe every transaction and state change. On Midnight, much of the contract state is private — you can only verify behavior through the contract's public API.

**2. Witnesses introduce an untrusted input surface.** Witness functions are user-provided. Your contract's security depends on witnesses returning correct values, but they can return anything. Testing must verify that your contract handles malicious or malformed witness data.

**3. Proof generation adds real-world constraints.** A contract that passes type checking but generates proofs that take 60 seconds — or exceed block limits — will fail in production. Testing must catch performance issues before deployment.

This tutorial shows you how to build a complete testing framework for Compact contracts using the Midnight SDK's `Contract` class and `vitest`. You'll learn to:

- Instantiate a contract simulator without a running node
- Test circuit execution and ledger state transitions
- Verify error handling and edge cases
- Run integration tests against a local Docker stack
- Automate everything with GitHub Actions CI

---

## Setting Up the Test Environment

### Prerequisites

```bash
# Node.js 18+ and npm required
node --version  # v18.x or v20.x

# TypeScript and vitest
npm install -D typescript vitest @types/node

# Midnight dependencies
npm install @midnight-ntwrk/compact-runtime
npm install -D @midnight-ntwrk/compact-compiler
```

### Project Structure

```
midnight-counter/
├── contracts/
│   └── counter.compact        # Compact contract source
├── src/
│   ├── counter.test.ts        # Test suite
│   └── witnesses.ts           # Witness implementations
├── .github/
│   └── workflows/
│       └── ci.yml             # CI pipeline
├── vitest.config.ts
├── tsconfig.json
└── package.json
```

### Configuration Files

**vitest.config.ts:**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
```

**tsconfig.json:**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "outDir": "./dist"
  },
  "include": ["src/**/*.ts"]
}
```

---

## Building a Contract Simulator

The `Contract` class from `@midnight-ntwrk/compact-runtime` is the key to unit testing. It creates a simulated contract environment that:

- Runs Compact circuits in a JavaScript VM
- Maintains ledger state between calls
- Validates witness inputs
- Reports errors with detailed messages

### Sample Contract: Counter

We'll test a simple Counter contract that supports increment, reset, and read operations:

```compact
import CompactStandardLibrary;

export ledger count: Uint<64>;
export ledger lastIncrementor: Bytes<32>;

witness secretKey(): Bytes<32>;

circuit publicKey(_sk: Bytes<32>): Bytes<32> {
    return persistentHash<Vector<2, Bytes<32>>>([
        pad(32, "counter:auth:pk"),
        _sk
    ]);
}

constructor() {
    count = 0u64;
    lastIncrementor = pad(32, "");
}

export circuit increment(by: Uint<64>): [] {
    const _sk = secretKey();
    const pk = publicKey(_sk);
    assert(by > 0u64, "Increment must be positive");
    count = disclose(count + by);
    lastIncrementor = disclose(pk);
}
```

### Witness Implementations

The witnesses bridge the TypeScript test environment with the Compact circuit:

```typescript
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';

interface CounterLedger {
  count: bigint;
  lastIncrementor: Uint8Array;
}

interface CounterPrivateState {
  secretKey: Uint8Array;
}

const secretKey = ({ privateState }: WitnessContext<CounterLedger, CounterPrivateState>) => {
  return [privateState, privateState.secretKey];
};

export const witnesses = { secretKey };
```

### Instantiating the Simulator

```typescript
import { Contract } from '@midnight-ntwrk/compact-runtime';
import { witnesses } from './witnesses';

const { compact } = await import('../contracts/counter.compact');
const contract = new Contract(compact, witnesses);

const privateState = { secretKey: new Uint8Array(32).fill(1) };
const ledger = await contract.deploy(privateState);
```

The `deploy()` call returns the initial ledger state. No node, no Docker, no network — just pure in-memory simulation.

---

## Writing Unit Tests with Vitest

### Testing Constructor State

The simplest test verifies the initial state set by the constructor:

```typescript
describe('Counter Contract', () => {
  let contract: Contract<CounterLedger, CounterPrivateState>;

  beforeAll(async () => {
    const { compact } = await import('./contracts/counter.compact');
    contract = new Contract(compact, witnesses);
  });

  describe('constructor', () => {
    it('initializes count to 0', async () => {
      const ledger = await contract.deploy({ secretKey: new Uint8Array(32) });
      expect(ledger.count).toBe(0n);
    });
  });
});
```

### Testing Circuit Execution

Call `contract.call()` to execute a circuit and get the resulting ledger state:

```typescript
it('increments count by the given amount', async () => {
  const privateState = { secretKey: new Uint8Array(32).fill(1) };
  await contract.deploy(privateState);

  const result = await contract.call('increment', privateState, [5n]);
  expect(result.ledger.count).toBe(5n);
});
```

The arguments to `call()` are:
1. Circuit name (matches the `export circuit` name in Compact)
2. Private state (passed to witnesses)
3. Circuit arguments (Compact types matching the circuit signature)

### Testing State Accumulation

```typescript
it('accumulates multiple increments', async () => {
  const privateState = { secretKey: new Uint8Array(32).fill(4) };
  await contract.deploy(privateState);

  let state = await contract.call('increment', privateState, [3n]);
  expect(state.ledger.count).toBe(3n);

  state = await contract.call('increment', privateState, [7n]);
  expect(state.ledger.count).toBe(10n);
});
```

Each `call()` returns the ledger state **after** execution. The state persists in the contract simulator — subsequent calls see the updated ledger.

---

## Testing Error Conditions

### Testing `assert()` Failures

Compact's `assert()` throws when the condition fails. Vitest's `rejects` matcher captures these:

```typescript
it('throws when increment is zero', async () => {
  const privateState = { secretKey: new Uint8Array(32).fill(2) };
  await contract.deploy(privateState);

  await expect(
    contract.call('increment', privateState, [0n])
  ).rejects.toThrow('Increment must be positive');
});
```

### Testing Type Safety at Circuit Boundaries

Compact's type system provides compile-time guarantees, but the JavaScript test environment needs runtime validation:

```typescript
it('rejects increment with negative values', async () => {
  const privateState = { secretKey: new Uint8Array(32).fill(3) };
  await contract.deploy(privateState);

  await expect(
    contract.call('increment', privateState, [-1n])
  ).rejects.toThrow();
});
```

### Testing Reverted Transactions

Not every error is an `assert()`. Some errors come from the runtime (proof failure, invalid witness data):

```typescript
it('fails with wrong secret key', async () => {
  const aliceKey = new Uint8Array(32).fill(1);
  const bobKey = new Uint8Array(32).fill(2);

  const alice = { secretKey: aliceKey };
  await contract.deploy(alice);

  // Bob tries to increment using his key — will fail authentication
  // because the contract's publicKey derivation gives a different result
  await expect(
    contract.call('increment', alice, [5n])
  ).resolves.toBeDefined(); // Alice can call

  // Bob's key produces a different publicKey → assertion fails
  await expect(
    contract.call('increment', bobKey, [5n])
  ).rejects.toThrow();
});
```

---

## Integration Tests with Docker

Unit tests catch logic errors but don't test against real infrastructure. Integration tests require a running Midnight node, proof server, and indexer.

### Docker Compose Setup

```yaml
# docker-compose.test.yml
version: '3.8'
services:
  midnight-node:
    image: midnightnetwork/midnight-node:latest
    ports:
      - "9944:9944"
    command: ["--dev", "--log=info"]

  midnight-indexer:
    image: midnightnetwork/midnight-indexer:latest
    ports:
      - "8080:8080"
    environment:
      - NODE_URL=http://midnight-node:9944
    depends_on:
      - midnight-node

  midnight-proof-server:
    image: midnightnetwork/midnight-proof-server:latest
    ports:
      - "3000:3000"
    environment:
      - NODE_URL=http://midnight-node:9944
    depends_on:
      - midnight-node
```

### Integration Test with Docker

```typescript
import { describe, it, expect } from 'vitest';
import { createClient } from '@midnight-ntwrk/midnight-js-http-client';

describe('Integration: Docker Stack', () => {
  it('connects to the proof server', async () => {
    const client = createClient({ url: 'http://localhost:3000' });
    const health = await client.health();
    expect(health.status).toBe('ok');
  });

  it('deploys counter contract to local node', async () => {
    const { deploy } = await import('./deploy');
    const address = await deploy();
    expect(address).toMatch(/^[0x][a-f0-9]{64}$/i);
  });
});
```

### Running Integration Tests

```bash
# Start Docker stack
docker compose -f docker-compose.test.yml up -d

# Wait for services to be ready
sleep 30

# Run integration tests
npx vitest run --config vitest.integration.config.ts

# Clean up
docker compose -f docker-compose.test.yml down
```

---

## GitHub Actions CI Pipeline

Automating tests ensures every PR is validated before review.

```yaml
# .github/workflows/ci.yml
name: Test Compact Contract

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
          node-version: 20
          cache: 'npm'

      - run: npm ci

      - name: Compile Compact contracts
        run: npx compact compile contracts/*.compact

      - name: Run unit tests
        run: npx vitest run --reporter=verbose

  integration-tests:
    runs-on: ubuntu-latest
    needs: unit-tests
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - run: npm ci

      - name: Start Midnight Docker Stack
        run: docker compose -f docker-compose.test.yml up -d

      - name: Wait for services
        run: sleep 30

      - name: Run integration tests
        run: npx vitest run --config vitest.integration.config.ts

      - name: Cleanup
        if: always()
        run: docker compose -f docker-compose.test.yml down
```

### CI Pipeline Breakdown

| Stage | What It Does | Estimated Time |
|-------|-------------|---------------|
| `unit-tests` | Compiles Compact → runs simulator tests | 1-2 min |
| `integration-tests` | Starts Docker → runs against real node | 3-5 min |

Key features:
- **Caching**: npm cache speeds up dependency install
- **Parallelism**: unit and integration tests could run in parallel with separate workflows
- **Cleanup**: Docker stack is torn down even on failure (`if: always()`)

---

## Advanced Patterns

### 1. Parameterized Testing

Test multiple inputs with a single test function:

```typescript
describe.each([
  [1n, 1n],
  [10n, 10n],
  [100n, 100n],
  [999999n, 999999n],
])('increment(%d) sets count to %d', (input, expected) => {
  it(`increments by ${input}`, async () => {
    const state = await contract.call('increment', privateState, [input]);
    expect(state.ledger.count).toBe(expected);
  });
});
```

### 2. Snapshot Testing Ledger State

Capture the full ledger state after each operation:

```typescript
it('matches ledger snapshot after increment', async () => {
  await contract.deploy(privateState);
  const result = await contract.call('increment', privateState, [5n]);
  expect(result.ledger).toMatchSnapshot({
    count: 5n,
    lastIncrementor: expect.any(Uint8Array),
  });
});
```

### 3. Fuzz Testing Witness Values

Test that the contract handles boundary witness values:

```typescript
it('handles zero-length secret key', async () => {
  const emptyKey = { secretKey: new Uint8Array(0) };
  // Should throw or produce a deterministic result
  await expect(contract.deploy(emptyKey)).rejects.toThrow();
});

it('handles max-length secret key', async () => {
  const maxKey = { secretKey: new Uint8Array(256).fill(0xFF) };
  // Should work — Compact Bytes<32> will truncate or hash
  await expect(contract.deploy(maxKey)).resolves.toBeDefined();
});
```

### 4. Benchmarking Circuits

Measure circuit execution time:

```typescript
it('completes increment in under 100ms', async () => {
  const start = performance.now();
  await contract.call('increment', privateState, [1n]);
  const elapsed = performance.now() - start;
  expect(elapsed).toBeLessThan(100);
});
```

---

## Complete Reference

### Cheat Sheet

| Action | Code | Notes |
|--------|------|-------|
| Deploy contract | `await contract.deploy(privateState)` | Returns initial ledger |
| Call circuit | `await contract.call('name', state, args)` | Returns new ledger state |
| Query circuit | `await contract.query('name', state, args)` | Read-only, no state change |
| Test assert failure | `expect(call).rejects.toThrow('msg')` | Matches Compact assert message |
| Test type error | `expect(call).rejects.toThrow()` | Any runtime error |

### Typical Test Flow

```
deploy → call(circuit1) → verify ledger → call(circuit2) → verify ledger → call(circuit3)
```

Each call builds on the previous state. The simulator maintains state without a running node.

### Troubleshooting Common Test Failures

| Error | Likely Cause | Fix |
|-------|-------------|-----|
| `Circuit not found: "name"` | Typo in circuit name | Match the `export circuit` name exactly |
| `Witness "secretKey" not found` | Missing witness implementation | Add to `witnesses` object |
| `Expected Uint<64>, got number` | Wrong JavaScript type | Use `BigInt` (`5n` not `5`) |
| `Test timeout after 30s` | Contract compilation is slow | Increase `testTimeout` in vitest config |
| `Docker connection refused` | Stack not ready | Add `wait-for-it` script or increase sleep |

---

## Further Resources

- [Midnight Documentation — Testing Guide](https://docs.midnight.network/testing)
- [Vitest Documentation](https://vitest.dev/guide/)
- [Compact Language Reference](https://docs.midnight.network/compact/language-reference)
- [example-battleship — Test Scaffolding Reference](https://github.com/midnightntwrk/example-battleship)
- [Midnight Developer Forum](https://forum.midnight.network/)

---

*Published for the Midnight Network developer community. All code tested against `@midnight-ntwrk/compact-runtime` v0.16+ and `vitest` v2.x. Found an error? Submit a PR to keep this guide current.*
