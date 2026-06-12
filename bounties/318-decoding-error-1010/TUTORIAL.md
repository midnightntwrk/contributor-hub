---
title: "Decoding Error 1010: What 'Invalid Transaction' Actually Means on Midnight"
description: "A developer's guide to understanding, diagnosing, and resolving Midnight's most common transaction error — POOL_INVALID_TX and its sub-errors."
tags: [midnight, error-1010, debugging, tutorial, blockchain]
published: false
---

# Decoding Error 1010: What 'Invalid Transaction' Actually Means on Midnight

## Introduction

If you've developed on Midnight for more than a few transactions, you've seen it: `1010: Invalid Transaction`. It's the network's way of saying "something is wrong with this transaction" — but what exactly?

This tutorial breaks down the error code structure, maps every common sub-error code to its root cause, and provides a diagnostic workflow for each one.

## The Error Code Architecture

Midnight uses a hierarchical error code system based on Substrate's framework:

```
POOL_INVALID_TX = AUTHOR(1000) + 10
```

The structure is:

```
[ERROR_CATEGORY] [BASE_CODE] + [SUB_ERROR] = TOTAL
```

| Component | Meaning | Example |
|-----------|---------|---------|
| **ERROR_CATEGORY** | The subsystem that raised the error | `POOL` = transaction pool |
| **BASE_CODE** | The category base offset | `AUTHOR(1000)` = authorship/validation |
| **SUB_ERROR** | The specific error within the category | `10` = invalid transaction |
| **TOTAL** | The full error code you see in logs | `1010` |

For most developers, error 1010 is the entry point — the sub-error code embedded in the transaction or logs tells you what actually went wrong.

## Common Error Codes

### 139 — Transaction Builder Error

**Meaning:** The transaction couldn't be constructed or failed a pre-validation check.

**Root causes:**
- Missing or invalid transaction inputs
- Incorrectly formatted witness data
- Mismatched contract version between the build environment and the network

**Diagnostic steps:**
1. Check your `midnight-node` version — run `midnight-node --version` and compare against the [compatibility matrix](https://docs.midnight.network/relnotes/compatibility-matrix).
2. Verify your Compact compiler version matches the node version.
3. Rebuild your contract artifacts with `compact compile --force`.
4. Check the transaction builder logs for detailed validation messages.

**Resolution:**
- Update your toolchain to match the target network
- Use the `midnight-mcp` tool's compilation endpoint to validate Compact code before building transactions

### 154 — BlockLimitExceeded

**Meaning:** The transaction exceeds one or more block-level limits.

**Root causes:**
- Transaction weight exceeds the block weight limit
- Transaction is too large in bytes
- Too many operations in a single batch transaction

**Diagnostic steps:**
1. Check your transaction weight — use the `midnight-node query-weight` subcommand or the RPC endpoint `transactionPool_tag` to estimate weight.
2. Review the ledger's cost model for your specific operation type.
3. Look at the number of circuit calls and proof verifications.

**Resolution:**
- Split large operations across multiple transactions
- Remove unnecessary operations from batch transactions
- Reduce the number of shielded operations (which are heavier than unshielded ones)

### 168 — Batch Settlement Error

**Meaning:** A multi-party or batch transaction failed to settle atomically.

**Root causes:**
- One or more parties in the batch provided invalid signatures
- A sub-transaction within the batch failed validation
- Nonce conflict between batched operations

**Diagnostic steps:**
1. Inspect each sub-transaction in the batch independently.
2. Verify all participant signatures are valid and for the correct data.
3. Check nonce sequencing across all transactions.

**Resolution:**
- Submit transactions separately to isolate the failing one
- Ensure all batch participants are using the latest network state
- Restart the signing flow to get fresh nonces

### 170 — Merkle Root Pruning Error

**Meaning:** The Merkle tree root used in a shielded transaction has been pruned (old state).

**Root causes:**
- Using a stale nullifier set commitment
- Submitting a shielded transaction based on outdated state
- Full node pruned old states (default: 256 blocks)

**Diagnostic steps:**
1. Check the age of your Merkle root — if your transaction was built more than ~256 blocks ago, the root may have been pruned.
2. Run an archive node to avoid pruning (use `--pruning archive` flag).
3. Rebuild the transaction with fresh state from the current block.

**Resolution:**
- Refresh your state data before building shielded transactions
- For production dApps, maintain an archive node that preserves full Merkle history
- Set your snapshot interval higher if you control the node

### 186 — EffectsCheckFailure

**Meaning:** The transaction's expected effects don't match what the network computed.

**Root causes:**
- State transition mismatch (the contract state changed between building and submitting)
- Incorrect expected output values
- Race condition with another transaction modifying the same state

**Diagnostic steps:**
1. Check if another transaction modified the same contract state between your build and submission.
2. Compare the expected vs actual ledger state after the transaction attempts.
3. Review the contract's `@effect` annotations to understand what state changes are expected.

**Resolution:**
- Re-read the latest state before building the transaction
- Add retry logic with fresh state queries
- Use atomic operations where possible to avoid race conditions

## The Ledger Cost Model (5 Dimensions)

Midnight evaluates each transaction against a five-dimensional cost model. Understanding this model helps diagnose error 1010 before it happens:

| Dimension | Description | Impact on Errors |
|-----------|-------------|-----------------|
| **Weight** | Computational cost — CPU cycles for proof verification and execution | Triggers 154 if exceeded |
| **Length** | Transaction size in bytes | Triggers 154 if exceeded |
| **Proof Size** | Size of attached ZK proofs | Triggers 154 if very large |
| **Storage Read** | Contract state reads | Affects overall cost estimation |
| **Storage Write** | Contract state writes | Can trigger 186 if state changes unexpectedly |

**To estimate cost before submitting:**

```bash
# Query the estimated weight for a transaction
curl -X POST -H "Content-Type: application/json" \
  --data '{
    "jsonrpc": "2.0",
    "method": "transactionPool_tag",
    "params": ["<encoded_tx_hex>"],
    "id": 1
  }' \
  http://localhost:9944
```

## Diagnostic Workflow

When you encounter error 1010, follow this systematic checklist:

```
1. Read the full error message
   ↓
2. Identify the sub-error code (139, 154, 168, 170, or 186)
   ↓
3. Check toolchain versions against compatibility matrix
   ↓
4. Verify you're using the latest state data
   ↓
5. Test with a minimal transaction (single operation)
   ↓
6. Check node logs for detailed diagnostics
   ↓
7. If shielded: check Merkle root age vs --pruning setting
```

To check node logs for detailed error information:

```bash
# If running via systemd
journalctl -u midnight-node -n 100 --no-pager

# If running via docker
docker logs midnight-node --tail 100

# If running directly
tail -100 ~/data/logs/midnight-node.log
```

## Prevention Best Practices

1. **Version lock your dependencies** — pin your Compact compiler, midnight-node, and SDK versions to the same release.
2. **Use fresh state** — always query the latest block before building transactions.
3. **Test on devnet first** — run a local Midnight network with `midnight-local-dev` to catch errors before mainnet.
4. **Monitor pruning settings** — if you're doing shielded operations, consider an archive node for production.
5. **Validate transaction weight** — use the cost estimation RPC before submission.

## Conclusion

Error 1010 is Midnight's catch-all for invalid transactions, but its sub-errors tell a specific story. By mapping the code to its root cause — whether it's a builder error (139), a block limit (154), a batch failure (168), stale Merkle state (170), or an effects mismatch (186) — you can diagnose and resolve the issue systematically.

The most common pitfall for new developers is a toolchain version mismatch (error 139). Always check the compatibility matrix first.
