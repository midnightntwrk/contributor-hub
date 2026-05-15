# Testing Compact Contracts Tutorial

## Overview

This tutorial shows how to build a contract simulator using the real `Contract` class from compiled Compact output, write vitest tests that exercise circuit calls and verify ledger state changes, and set up a GitHub Actions CI pipeline. It covers both unit-style simulator tests and integration tests against a local Docker stack.

## Files

- `testing-compact.md` — The main tutorial (3,000+ words)
- `contracts/counter.compact` — Simple counter contract for testing examples
- `contracts/vault.compact` — Token vault contract for advanced testing
- `examples/simulator-setup.ts` — Contract simulator initialization helpers
- `examples/circuit-helpers.ts` — Helper functions for calling circuits in tests
- `tests/counter.unit.test.ts` — Unit tests for the counter contract
- `tests/vault.integration.test.ts` — Integration tests for the vault contract
- `tests/setup.ts` — Shared test setup and fixtures
- `.github/workflows/test-compact.yml` — GitHub Actions CI pipeline

## Prerequisites

- Midnight toolchain installed (`npx midnight-mcp`)
- Node.js v22+
- Docker (for integration tests)
- Vitest (`npm install -D vitest`)

## Topics Covered

1. Building a contract simulator from compiled Compact output
2. Writing vitest tests for circuit calls
3. Verifying ledger state changes in tests
4. Unit-style simulator tests vs integration tests
5. Setting up GitHub Actions CI pipeline
6. Testing against a local Docker stack

## Quick Start

```bash
npm install
npx compactc contracts/counter.compact build/counter
npx vitest run tests/counter.unit.test.ts
```

## Related Issue

[#312 — Testing Compact Contracts: Unit Tests, Assertions, and Local Simulation](https://github.com/midnightntwrk/contributor-hub/issues/312)
