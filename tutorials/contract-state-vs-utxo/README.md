# Contract-State Accounting vs UTXO Tokens: Two Models for On-Chain Value

## Overview

On Midnight, there are two fundamentally different ways to represent and track value inside a smart contract:

1. **UTXO-layer tokens** — real token transfers via `receiveShielded`/`sendShielded` (and their unshielded variants). Tokens live as encrypted outputs on the ledger; the wallet manages them independently of any contract.

2. **Ledger-state accounting** — `Counter`, `Map`, or other `ledger` fields inside a Compact contract that track balances internally. No actual tokens move; the contract just records numbers.

This tutorial walks through both approaches with working Compact contracts and TypeScript integration code, then explains when to use each.

## Files

- `contract-state-vs-utxo.md` — Main tutorial (3,000+ words): the two models, when each is appropriate, pitfalls, and decision framework
- `examples/token-vault.compact` — Compact contract using UTXO-layer shielded tokens via `receiveShielded`/`sendShielded`
- `examples/credit-ledger.compact` — Compact contract using ledger-state `Counter`/`Map` fields for internal bookkeeping
- `examples/token-vault.test.ts` — TypeScript test harness for the UTXO token vault
- `examples/credit-ledger.test.ts` — TypeScript test harness for the ledger-state credit system

## Prerequisites

- Midnight toolchain installed ([installation guide](https://docs.midnight.network/getting-started/installation))
- Node.js v22+
- Familiarity with Compact basics ([hello world tutorial](https://docs.midnight.network/getting-started/hello-world))
- A funded wallet on Midnight testnet (or local devnet running)

## Topics Covered

1. How UTXO-layer tokens work on Midnight — shielded vs unshielded
2. How Compact `ledger` state variables work — `Counter`, `Map`, `Opaque`
3. Building a token vault that holds real shielded tokens
4. Building a credit ledger that tracks balances in contract state
5. Privacy guarantees of each approach
6. When UTXO tokens are the right choice
7. When ledger-state accounting is the right choice
8. Combining both in a single contract
9. Common pitfalls and debugging tips

## Related Issue

[#302 — [Tutorial] Contract-State Accounting vs UTXO Tokens: Two Models for On-Chain Value](https://github.com/midnightntwrk/contributor-hub/issues/302)
