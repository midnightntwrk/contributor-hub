# Testing Compact Contracts: Unit Tests, Assertions, and Local Environment

## Overview

Midnight Compact contracts look and feel like Rust, but they compile to a circuit and
run on Midnight's L1. This means standard Rust tooling doesn't work end-to-end — you
can't just `cargo test` a Compact contract. Instead, Midnight provides a three-layer
testing model:

```
Layer 1: Unit simulator tests       ← Fast, local, no node
Layer 2: Docker integration tests   ← Local node + wallet
Layer 3: Testnet end-to-end tests   ← Real network
```

This tutorial covers **Layer 1** and **Layer 2**: build a contract simulator using
the real `Contract` class, write vitest tests that assert ledger state changes, and
set up GitHub Actions to run everything on every commit.

## What's Covered

| Skill | Practical Value |
|-------|----------------|
| `Contract` class simulator | Test compact logic without L1 |
| Vitest + compact runtime | Fast unit tests (ms level) |
| Circuit call assertions | Prove state changes, not just values |
| Docker stack integration | Full node + wallet simulation |
| GitHub Actions CI | Auto-test on every PR |

## Prerequisites

- Node.js 18+ and npm
- `midnight-compact` installed
- Docker + Docker Compose (for Layer 2 tests)
- GitHub account (for Actions CI)

## Architecture

```
compact source (.compact)
    │
    ▼ compiler
midnight-compact
    │
    ▼ outputs
TypeScript bindings + WASM circuits
    │
    ├─▶ Layer 1: Contract class simulator (vitest, ms latency)
    │   └─▶ .compact.test.ts files
    │
    ├─▶ Layer 2: Docker stack integration tests
    │   └─▶ docker-compose.yml (node + indexer + wallet)
    │
    └─▶ Layer 3: CI → GitHub Actions workflow
```

## Layer 1 — Contract Simulator

### Step 1.1: Create the Contract

Create a simple escrow contract in `contracts/escrow.compact`:

```compact
use std::collections::HashMap;

record Escrow {
    id: Field,
    buyer: Address,
    seller: Address,
    amount: u64,
    released: bool,
}

struct EscrowState {
    escrows: Map<Field, Escrow>,
    next_id: Field,
}

impl EscrowState {
    pub fn new() -> Self {
        EscrowState {
            escrows: Map::new(),
            next_id: 1,
        }
    }

    pub fn create_escrow(&mut self, buyer: &Address, seller: &Address, amount: u64) -> Field {
        let id = self.next_id;
        self.next_id = self.next_id + 1;

        let escrow = Escrow {
            id,
            buyer: *buyer,
            seller: *seller,
            amount,
            released: false,
        };
        self.escrows.set(id, escrow);
        id
    }

    pub fn release_escrow(&mut self, id: Field) -> bool {
        let escrow = self.escrows.get(&id);
        if escrow.released { return false; }
        let mut updated = escrow;
        updated.released = true;
        self.escrows.set(id, updated);
        true
    }

    pub fn get_escrow(&self, id: Field) -> Escrow {
        self.escrows.get(&id)
    }
}
```

### Step 1.2: Compile the Contract

```bash
midnight compile contracts/escrow.compact --output artifacts/escrow.wasm
```

Midnight outputs TypeScript bindings to `artifacts/escrow.ts` — these include the `Contract` class with a `simulate()` method used in tests.

### Step 1.3: Set Up Vitest

```bash
npm init -y
npm install --save-dev vitest @types/node
```

Create `vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    timeout: 60000,
    globals: true,
  },
});
```

Create `package.json` scripts:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:ci": "vitest run --coverage",
    "compile": "midnight compile contracts/*.compact --output artifacts/"
  }
}
```

### Step 1.4: Write Simulator Tests

Create `tests/escrow.simulator.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { Contract } from '../artifacts/escrow';

describe('Escrow Contract (Simulator)', () => {
  let contract: Contract;

  beforeEach(() => {
    // Fresh contract instance for each test
    contract = new Contract();
    contract.initialize();
  });

  it('should create a new escrow and assign an ID', () => {
    // Arrange
    const buyer  = '0xBuyer';
    const seller = '0xSeller';
    const amount = 1000n;

    // Act
    const id = contract.create_escrow(buyer, seller, Number(amount));

    // Assert
    expect(id).toBeGreaterThan(0n);

    const escrow = contract.get_escrow(id);
    expect(escrow.buyer).toBe(buyer);
    expect(escrow.seller).toBe(seller);
    expect(escrow.amount).toBe(amount);
    expect(escrow.released).toBe(false);
    expect(contract.state.next_id).toBe(id + 1n);
  });

  it('should release an unreleased escrow', () => {
    const id = contract.create_escrow('0xB', '0xS', 500n);

    const result = contract.release_escrow(id);

    expect(result).toBe(true);
    const escrow = contract.get_escrow(id);
    expect(escrow.released).toBe(true);
  });
});
```

### Step 1.5: Running Simulator Tests

```bash
npm test

# ✅ Escrow Contract (Simulator) (2 tests) 2ms
#   ✓ should create a new escrow and assign an ID
#   ✓ should release an unreleased escrow
```

Simulator tests run in milliseconds because there's no network involved. They are
your first line of defense — **every Compact contract must have simulator tests**.

### What the Simulator Actually Runs

The `Contract` class from Midnight's TypeScript bindings provides:

| Method | What it does |
|--------|-------------|
| `contract.initialize()` | Reset to fresh genesis state |
| `contract.state` | Inspect all private/public state |
| `contract.simulate(fn, args)` | Run a circuit call in-process |
| `contract.tx(tx)` | Build a real L1 transaction (for Layer 2) |

## Layer 2 — Docker Integration Tests

Simulator tests verify logic. Integration tests verify the full stack: a local
Docker node, the indexer, and a wallet, all running together and exchanging real
Ledger state updates.

### Step 2.1: Create Docker Stack

`docker-compose.yml`:

```yaml
version: '3.8'
services:
  midnight-node:
    image: midnightlabs/midnight-node:testnet
    ports:
      - "3000:3000"   # RPC
      - "3001:3001"   # Metrics
    environment:
      - RUST_LOG=info
      - MIDNIGHT_NETWORK=testnet
    volumes:
      - node-data:/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 10s
      timeout: 5s
      retries: 5

  midnight-indexer:
    image: midnightlabs/midnight-indexer:testnet
    ports:
      - "8080:8080"
    environment:
      - NODE_URL=http://midnight-node:3000
    depends_on:
      midnight-node:
        condition: service_healthy

  midnight-wallet:
    image: midnightlabs/midnight-wallet:testnet
    ports:
      - "9222:9222"   # CDP debugging
    depends_on:
      midnight-indexer:
        condition: service_started

volumes:
  node-data:
```

### Step 2.2: Integration Test Script

`tests/escrow.integration.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MidnightProvider } from '@midnight-ntwrk/midnight-provider';

const NODE_URL = 'http://localhost:3000';
const INDEXER_URL = 'http://localhost:8080';
const DEPLOYED_CONTRACT = '0xESCROW_CONTRACT_ADDRESS';

describe('Escrow Contract (Integration)', () => {
  let provider: MidnightProvider;

  beforeAll(async () => {
    provider = new MidnightProvider({ nodeUrl: NODE_URL, indexerUrl: INDEXER_URL });
    await provider.connect();
  }, 120_000);

  it('should create escrow and verify on-chain state', async () => {
    const buyer = '0xABC';
    const seller = '0xDEF';
    const amount = 1000n;

    // Deploy the contract
    const deployed = await provider.deploy('artifacts/escrow.wasm');
    expect(deployed).toBeTruthy();

    // Call create_escrow through the real provider
    const tx = await provider.contract(deployed).create_escrow(buyer, seller, amount);
    expect(tx.status).toBe('success');
  });

  it('should confirm escrow exists on L1 after commit', async () => {
    const contract = provider.contract(DEPLOYED_CONTRACT);
    const escrows = await contract.escrows();
    expect(Object.keys(escrows).length).toBeGreaterThanOrEqual(1);
  });

  afterAll(async () => {
    await provider.disconnect();
  });
});
```

### Step 2.3: Running Integration Tests

```bash
# Start the docker stack
docker compose up -d

# Wait for health check
curl -s http://localhost:3000/health
# → {"status":"healthy","chain_id":"testnet","height":1234}

# Run integration tests (takes ~10-30s)
npm run test:integration

# Tear down
docker compose down -v
```

## GitHub Actions CI Pipeline

Automatically run both Layers on every PR push.

### Step 3.1: Create Workflow

`.github/workflows/compact-ci.yml`:

```yaml
name: Compact Contract CI

on:
  push:
    paths: ['contracts/**', 'tests/**']
  pull_request:

jobs:
  simulator-tests:
    name: Simulator Tests (Layer 1)
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install midnight-compact
        run: |
          curl -fsSL https://get.midnight.network | sh
          echo "$HOME/.midnight/bin" >> $GITHUB_PATH

      - run: npm ci
      - run: npm run compile
      - run: npm test

      - uses: actions/upload-artifact@v4
        with:
          name: vitest-report
          path: coverage/

  integration-tests:
    name: Integration Tests (Layer 2)
    runs-on: ubuntu-latest
    timeout-minutes: 30
    needs: simulator-tests
    if: github.ref == 'refs/heads/main'

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install midnight-compact
        run: |
          curl -fsSL https://get.midnight.network | sh
          echo "$HOME/.midnight/bin" >> $GITHUB_PATH

      - run: npm ci
      - run: npm run compile

      - name: Start Docker stack
        run: docker compose up -d --wait

      - name: Wait for node health
        run: |
          for i in $(seq 1 30); do
            if curl -sf http://localhost:3000/health; then break; fi
            sleep 2
          done

      - name: Run integration tests
        run: npm run test:integration

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: integration-logs
          path: node-data/

      - name: Teardown
        if: always()
        run: docker compose down -v
```

Push this workflow and every `git push` to `contracts/` or `tests/` triggers a full
two-layer test suite automatically.

## Complete Test Suite

Combine both layers in your `package.json`:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:ci": "vitest run --coverage",
    "test:integration": "vitest run tests/integration",
    "compile": "midnight compile contracts/*.compact --output artifacts/",
    "verify": "npm run compile && npm test"
  }
}
```

Now `npm run verify` compiles, simulates, and runs integration tests in sequence.

## Assertion Patterns

Use these patterns to write meaningful assertions, not just "it doesn't crash".

| Pattern | Example | Tests |
|---------|---------|-------|
| State equality | `expect(escrow.amount).toBe(1000n)` | Sim + Integration |
| Side effect | `expect(called).toBe(true)` | Simulator only |
| Negative | `expect(state.next_id).not.toBe(0n)` | Simulator only |
| Ledger change | `expect(ledger.balance).toBe(updated)` | Sim + Integration |

## Summary Checklist

```
Project Setup:
[ ] npm init with vitest
[ ] middleman-compile compiles .compact → .ts + .wasm
[ ] artifacts/escrow.ts generated successfully
[ ] vitest.config.ts created

Simulator Tests (Layer 1):
[ ] beforeEach() fresh state
[ ] escrow creation test + assert id = 1
[ ] escrow release test + assert released = true
[ ] All tests green locally

Docker Integration (Layer 2):
[ ] docker-compose.yml created with node + indexer + wallet
[ ] Integration test deploys contract and calls create_escrow
[ ] Ledger state assertion in test
[ ] tests green in Docker

GitHub Actions (CI):
[ ] .github/workflows/compact-ci.yml created
[ ] simulator-tests job runs on every push
[ ] integration-tests job runs on main push
[ ] Coverage uploads as artifact
[ ] All checks passing on GitHub

After Merge:
[ ] npm run verify = compile → simulate → integrate (all green)
[ ] GitHub PR checks show ✅ on all 3 jobs
```

## Common Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Cannot find module 'artifacts/escrow'` | `npm run compile` not yet run | `npm run compile` first |
| Simulator tests all pass but integration fails | Simulator state ≠ Docker state | Check `Contract.initialize()` resets all state |
| Docker stack won't start | Port 3000/8080 in use | `docker compose down -v` / change ports |
| Indexer never syncs | Wrong indexer URL | `http://midnight-indexer:8080` (Docker service name) |
| GitHub Actions timeout | Docker startup >10 min | Use `--wait` flag, increase runner timeout |
| Test order dependency | Shared mutable state | Always `beforeEach(() => contract.initialize())` |
