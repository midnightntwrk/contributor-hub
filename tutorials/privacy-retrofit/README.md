# Privacy Retrofit: Adding Shielded Transactions to Existing Midnight dApps

## Overview

You built a Midnight dApp that works — deploys, submits transactions, reads state. But every transaction is transparent. Balances, amounts, participants — all visible on-chain. Now you want to add privacy without rewriting from scratch.

This tutorial explains how to retrofit privacy into an existing Midnight application. It covers the difference between transparent and shielded transactions, how to migrate UTXO selection from public to private, the ZK circuit patterns that enable selective disclosure, and the exact refactoring steps to convert a transparent dApp into a privacy-preserving one — without breaking existing functionality.

## Files

- `privacy-retrofit.md` — Main tutorial (2,000+ words): transparent vs shielded architecture, ZK circuit integration, migration patterns, step-by-step retrofit guide
- `examples/retrofit-privacy.ts` — TypeScript utility: `PrivacyRetrofitter` class that converts transparent transaction flows to shielded flows with minimal code changes
- `examples/retrofit-privacy.test.ts` — Test suite: validates shielded transaction creation, UTXO selection, and balance verification

## Prerequisites

- Midnight toolchain installed ([installation guide](https://docs.midnight.network/getting-started/installation))
- Node.js v22+
- An existing Midnight dApp with transparent transactions
- Familiarity with Compact basics ([hello world tutorial](https://docs.midnight.network/getting-started/hello-world))
- Basic understanding of zero-knowledge proofs

## Topics Covered

1. Why transparent transactions leak information — and what privacy actually means on Midnight
2. The shielded UTXO model: encrypted outputs, nullifiers, and note commitments
3. ZK circuits for selective disclosure: proving properties without revealing values
4. Step-by-step retrofit: migrating `createTransaction()` from transparent to shielded
5. Handling mixed UTXO sets: wallets with both transparent and shielded notes
6. Gas and performance trade-offs: shielded transactions cost more compute
7. Testing privacy: how to verify that your dApp actually hides what it should
