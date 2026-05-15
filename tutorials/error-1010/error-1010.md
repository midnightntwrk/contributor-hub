# Decoding Error 1010: What "Invalid Transaction" Actually Means

**By billbtbillb | May 2026**

You submit a transaction to the Midnight Network. It fails. The error message says **Error 1010: Invalid Transaction**. That is all you get — no hint about *what* was invalid, no pointer to the failing component, no suggested fix. You stare at the screen, rerun the same code, and get the same opaque rejection.

This tutorial eliminates that frustration. By the end, you will read Error 1010 like a diagnostic report: you will know the error's internal anatomy, map each variant to its specific failure mode, understand the ledger cost model that drives block-level rejections, and follow a repeatable workflow that isolates the root cause in minutes.

## Prerequisites

- Midnight toolchain installed ([installation guide](https://docs.midnight.network/getting-started/installation))
- Node.js v22+
- Familiarity with Compact syntax basics ([hello world tutorial](https://docs.midnight.network/getting-started/hello-world))
- A funded wallet on Midnight testnet (or local devnet running)

---

## 1. The Anatomy of a Midnight Transaction Error Code

Midnight is built on the **Polkadot SDK**, and it inherits the transaction pool's error numbering convention. Every transaction that fails pool validation returns an error code constructed from two parts:

```
Error Code = AUTHOR_BASE + VARIANT_INDEX
```

- **AUTHOR_BASE** identifies the *subsystem* that rejected the transaction. For pool-level rejections, this is `1000` (denoted `AUTHOR(1000)` in source code).
- **VARIANT_INDEX** is the specific error variant within that subsystem.

So **Error 1010** means:

```
1010 = AUTHOR(1000) + 10 → InvalidTransaction
```

The `InvalidTransaction` enum in the Polkadot SDK defines roughly a dozen distinct rejection reasons, each with its own variant index. The raw error code `1010` is the top-level category. The *actual cause* lives in the inner variant — accessible through detailed logs, node output, or the transaction builder's error chain.

### Where Error 1010 Lives in the Pipeline

A Midnight transaction passes through these stages before landing in a block:

```
Construction → Balancing → Signing → Submission → Pool Validation → Block Execution
                                                                 ↑
                                                          Error 1010 fires here
```

**Error 1010 occurs at Pool Validation.** The transaction pool (`txpool`) checks every incoming transaction for well-formedness *before* it is considered for block inclusion. If any check fails, the transaction is rejected with `InvalidTransaction` and a specific variant. The transaction never reaches the block executor — it is dropped at the gate.

This distinction matters: Error 1010 is a *validation-time* rejection, not an *execution-time* rejection. Your transaction was structurally valid enough to submit, but it violated one of the pool's acceptance criteria.

---

## 2. The Five Common Variants

Below we map the five most frequently encountered variant codes to their meanings, root causes, and fixes. Each section includes the error code, what triggers it, how to diagnose it, and a code pattern that avoids it.

### 2.1 Error Code 139: `MalformedTransaction` (Client-Side)

**Decomposition:** `AUTHOR(1000) + 139` — but note: 139 is a *custom* variant, not a standard Polkadot one. In Midnight's fork, this surfaces from the **transaction builder** before the transaction ever reaches the node.

**What it means:** The transaction builder could not construct a valid transaction. This is a **client-side** error.

**Common causes:**

- Missing or incorrectly structured ZK proof data.
- A contract call with arguments that do not match the circuit's compiled ABI.
- Unbalanced token amounts — inputs do not equal outputs for one or more segments.
- Invalid nonce or TTL values.
- Incorrectly encoded `disclose()` calls — passing raw bytes where the circuit expects a typed value.

**Diagnostic steps:**

1. Check the transaction builder's error output. The error chain includes the specific field that failed.
2. Verify your circuit arguments match the compiled ABI. Run `compactc` with the `--check` flag:
   ```bash
   compactc --check my_contract.compact
   ```
3. Log every step of transaction construction. The builder fails at the first malformed component.

**TypeScript diagnostic example:**

```typescript
import { TransactionBuilder } from "@midnight-ntwrk/midnight-js-types";

async function diagnoseMalformed(builder: TransactionBuilder) {
  try {
    const tx = await builder.build();
    console.log("Transaction built successfully:", tx.hash);
    return tx;
  } catch (error: any) {
    // Error 139 surfaces here with details
    console.error("=== MalformedTransaction Diagnostic ===");
    console.error("Error message:", error.message);

    if (error.message.includes("unbalanced")) {
      console.error("CAUSE: Token inputs ≠ outputs. Check your send/receive calls.");
    } else if (error.message.includes("proof")) {
      console.error("CAUSE: ZK proof generation failed. Check witness data.");
    } else if (error.message.includes("argument")) {
      console.error("CAUSE: Circuit argument mismatch. Verify ABI types.");
    } else if (error.message.includes("nonce")) {
      console.error("CAUSE: Invalid nonce. Resync wallet state.");
    }

    throw error;
  }
}
```

**Quick fix:** Rebuild the transaction from scratch, logging each step. The builder will fail at the first malformed component — that log line is your starting point.

---

### 2.2 Error Code 154: `BlockLimitExceeded`

**Decomposition:** `AUTHOR(1000) + 154`

**What it means:** The transaction's resource consumption exceeds the **block-level limits** set by the ledger's cost model. This is not about fees — it is about hard execution boundaries.

Midnight does not optimize for gas cost; it enforces hard limits. If your transaction needs more compute time, I/O, or storage than a single block allows, it is rejected outright.

**The 5-dimensional cost model:**

Midnight's ledger evaluates every transaction against **five resource dimensions** simultaneously. Exceeding *any single dimension* triggers `BlockLimitExceeded`:

- **Compute Time** — Single-threaded CPU execution time. Typical limit: ~1 second per block.
- **I/O Read Time** — Storage read operations (random access). Typical limit: ~1 second per block.
- **Consensus Throughput** — Transaction data size (block payload). Typical limit: ~200 KB per block.
- **Persistent Storage** — Net new bytes written to state. Typical limit: ~20 KB per block.
- **Churn** — Temporary storage (written then deleted during execution). Typical limit: ~1 MB per block.

The key insight: these are *block-level* limits, not *transaction-level* limits. A single large transaction can consume an entire block's budget, leaving no room for other transactions. The pool rejects such transactions to protect block production.

**Common causes:**

- A contract that performs heavy computation on-chain — iterating over a large dataset, computing complex arithmetic in-circuit.
- Reading or writing large structs from the ledger — each `lookup()` pulls the *entire* struct into the circuit.
- Too many state mutations in a single transaction.
- Deep Merkle tree operations that exceed compute time.

**Diagnostic steps:**

1. Profile your contract's resource usage with the ledger's cost model utility:
   ```bash
   midnight-ledger generate-cost-model my_contract.compact
   ```
2. Check which dimension you are hitting. Node logs indicate the limiting resource:
   ```bash
   RUST_LOG=midnight_ledger=debug cargo run -- run-node 2>&1 | grep "limit"
   ```
3. If compute time is the bottleneck, move computation off-chain and submit only the proof + result.

**Compact example — problematic pattern (too many on-chain writes):**

```compact
// ❌ BAD: Writing 20 state variables in one transaction
// This will hit Persistent Storage and Churn limits
export circuit batchUpdate20(
    v1: Uint<64>, v2: Uint<64>, v3: Uint<64>, v4: Uint<64>, v5: Uint<64>,
    v6: Uint<64>, v7: Uint<64>, v8: Uint<64>, v9: Uint<64>, v10: Uint<64>,
    v11: Uint<64>, v12: Uint<64>, v13: Uint<64>, v14: Uint<64>, v15: Uint<64>,
    v16: Uint<64>, v17: Uint<64>, v18: Uint<64>, v19: Uint<64>, v20: Uint<64>
): [] {
    slot1 = disclose(v1); slot2 = disclose(v2); /* ... 18 more ... */
    slot20 = disclose(v20);
}
```

**Compact example — safe pattern (chunked updates):**

```compact
// ✅ GOOD: Chunk updates into smaller transactions
export circuit updateChunk1(
    v1: Uint<64>, v2: Uint<64>, v3: Uint<64>, v4: Uint<64>, v5: Uint<64>
): [] {
    slot1 = disclose(v1); slot2 = disclose(v2); slot3 = disclose(v3);
    slot4 = disclose(v4); slot5 = disclose(v5);
}
```

See `contracts/block_limit_demo.compact` for the full example with both patterns.

---

### 2.3 Error Code 168: Batch Settlement Failure

**Decomposition:** `AUTHOR(1000) + 168`

**What it means:** A transaction involving **batch operations** — multiple contract calls across segments, or batched ZSwap offers — failed during the settlement phase. The ledger enforces a strict **causal precedence order** between segments.

Midnight transactions can contain multiple **segments** (identified by `segment_id`), each with guaranteed and fallible parts. If segment `a` and segment `b` call the same contract and `a < b`, then either `a` must have no fallible transcript, or `b` must have no guaranteed transcript. Violating this ordering triggers Error 168.

**Common causes:**

- Two segments modifying the same contract state in an order that creates a cycle.
- A fallible segment depending on the outcome of a later guaranteed segment.
- Batch ZSwap offers with overlapping inputs across segments.
- A contract call in the guaranteed segment that reads state written by a fallible segment in the same transaction.

**Diagnostic steps:**

1. Review your segment ordering. Ensure guaranteed sections (`segment_id = 0`) do not conflict with fallible sections.
2. Check for overlapping nullifiers or inputs across ZSwap offers in different segments.
3. Use the transaction builder's validation output to identify which segment pair is in conflict.

**Compact example — problematic pattern (conflicting segments):**

```compact
// ❌ BAD: Guaranteed and fallible segments modify the same state
export circuit conflictingUpdate(newBalance: Uint<64>): [] {
    // This runs in the guaranteed segment
    escrowBalance = disclose(newBalance);

    // This sends tokens (fallible) — conflicts with the state write above
    sendUnshielded(color, disclose(newBalance), right<ContractAddress, UserAddress>(disclose(recipient)));
}
```

**Compact example — safe pattern (separate concerns):**

```compact
// ✅ GOOD: Separate guaranteed and fallible operations
export circuit safeUpdate(
    newBalance: Uint<64>,
    recipient: UserAddress,
    sendAmount: Uint<64>
): [] {
    // Send tokens first (fallible — can roll back)
    sendUnshielded(color, disclose(sendAmount), right<ContractAddress, UserAddress>(disclose(recipient)));
    // Update state after (no conflict)
    escrowBalance = disclose(newBalance);
}
```

**Quick fix:** Simplify your transaction to a single segment if possible. If you need multiple segments, ensure each operates on independent contract state.

---

### 2.4 Error Code 170: Merkle Root Pruning

**Decomposition:** `AUTHOR(1000) + 170`

**What it means:** The transaction references a **Merkle root** that the ledger can no longer resolve. The root corresponds to a state that has been pruned from the node's storage.

Midnight nodes maintain a finite window of historical state. When a Merkle root falls outside this window (determined by the `BlockHashCount` parameter, typically 2400 blocks), the node can no longer verify proofs anchored to that root.

**Common causes:**

- Using a stale Merkle root generated many blocks ago.
- A ZK proof generated against an old snapshot of the shielded pool state.
- Submitting a transaction long after the referenced state was created (e.g., a pre-signed transaction that sat in a queue).

**Diagnostic steps:**

1. Check the age of the Merkle root your transaction references:
   ```typescript
   const currentHeight = await node.getBlockHeight();
   const rootHeight = await node.getBlockHeightOfRoot(merkleRoot);
   const age = currentHeight - rootHeight;

   if (age > 2400) {
     console.error(`Merkle root is ${age} blocks old — beyond pruning window`);
   }
   ```
2. If `current_block - root_block > BlockHashCount`, the root has been pruned.
3. Regenerate your proof against the current state.

**Quick fix:** Always generate ZK proofs immediately before submission. Never cache proofs for extended periods. If your workflow requires pre-generated proofs, implement a TTL check:

```typescript
const PROOF_MAX_AGE_BLOCKS = 1200; // Half the pruning window
const proofAge = currentHeight - proof.blockHeight;

if (proofAge > PROOF_MAX_AGE_BLOCKS) {
  console.warn("Proof approaching pruning window — regenerating...");
  proof = await regenerateProof(currentState);
}
```

---

### 2.5 Error Code 186: `EffectsCheckFailure`

**Decomposition:** `AUTHOR(1000) + 186`

**What it means:** The transaction's **effects mapping** failed validation. This is the most subtle and hardest-to-diagnose variant — it occurs during the ledger's holistic consistency check.

When a transaction is applied, the ledger verifies that every action produces a well-defined, non-conflicting effect on state. Specifically, it checks:

- **Disjoint inputs/outputs:** No overlap between shielded and unshielded inputs/outputs across all offers.
- **Sequencing:** The causal precedence partial order is satisfied.
- **Balancing:** Per-segment token balances are non-negative.
- **Pedersen commitments:** All commitments open correctly to the declared balances.
- **Effect mapping:** Bidirectional 1:1 mapping between contract calls, nullifiers, shielded spends/receives, and unshielded spends.

**Common causes:**

- A contract call consuming a nullifier already consumed by a ZSwap offer in the same transaction.
- Mismatched Pedersen commitments — binding randomness does not correctly commit to actual token flows.
- An unbalanced segment — outputs exceed inputs for a token type.
- A nullifier collision (double-spend attempt, even if accidental).

**Diagnostic steps:**

1. Enable verbose logging:
   ```bash
   RUST_LOG=midnight_ledger=debug
   ```
   The effects check logs which specific validation failed.
2. Run the transaction through the ledger's `well_formed` check locally:
   ```rust
   let result = tx.well_formed(tblock, ref_state);
   // Returns the specific check that failed
   ```
3. If using the Midnight MCP, the simulation response includes the effects validation result.

**Compact example — effects-safe pattern (independent operations):**

```compact
// ✅ GOOD: Each operation uses independent nullifiers
export circuit safeEffects(
    amount1: Uint<64>, recipient1: UserAddress,
    amount2: Uint<64>, recipient2: UserAddress
): [] {
    const color = tokenType(disclose(DOMAIN), kernel.self());

    // Two independent sends — no nullifier overlap
    sendUnshielded(color, disclose(amount1) as Uint<128>,
        right<ContractAddress, UserAddress>(disclose(recipient1)));
    sendUnshielded(color, disclose(amount2) as Uint<128>,
        right<ContractAddress, UserAddress>(disclose(recipient2)));
}
```

See `contracts/effects_debug.compact` for a complete contract demonstrating effects-safe patterns.

**Quick fix:** Isolate the failing check by removing components one at a time. Start with a minimal valid transaction (e.g., a simple ZSwap) and add components back until the error reappears. The last component added is your culprit.

---

## 3. The Systematic Diagnostic Workflow

When you encounter Error 1010, follow this workflow. Do not skip steps.

### Step 1: Extract the Inner Variant

The raw error code `1010` tells you "something is wrong." You need the **inner variant** to know what.

**In the dApp connector:**

```typescript
try {
  const tx = await wallet.submitTransaction(signedTx);
} catch (error: any) {
  if (error.code === 1010) {
    // Extract inner variant
    const variant = error.innerCode || error.variant;
    console.log(`Error 1010 variant: ${variant}`);

    // Map to known variants
    const variantMap: Record<number, string> = {
      139: "MalformedTransaction (client-side builder error)",
      154: "BlockLimitExceeded (transaction too large for one block)",
      168: "BatchSettlementFailure (segment ordering conflict)",
      170: "MerkleRootPruning (stale proof — root too old)",
      186: "EffectsCheckFailure (state consistency violation)",
    };

    console.log(`Meaning: ${variantMap[variant] || "Unknown variant"}`);
  }
}
```

**In node logs:**

```bash
RUST_LOG=midnight_txpool=debug cargo run -- run-node 2>&1 | grep "InvalidTransaction"
# Look for: InvalidTransaction(VariantName)
```

### Step 2: Map to the Validation Stage

| Variant | Name | Stage | Client or Server? |
|---------|------|-------|-------------------|
| 139 | MalformedTransaction | Construction | Client |
| 154 | BlockLimitExceeded | Pool Validation | Server |
| 168 | BatchSettlement | Pool Validation | Server |
| 170 | MerklePruning | Pool Validation | Server |
| 186 | EffectsCheck | Pool Validation | Server |

Client-side errors (139) mean your code built an invalid transaction. Server-side errors (154, 168, 170, 186) mean the transaction was well-formed but violated a network constraint.

### Step 3: Apply the Variant-Specific Fix

- **139:** Rebuild the transaction. Log each construction step. Verify ABI types.
- **154:** Reduce transaction size. Chunk into smaller operations. Move computation off-chain.
- **168:** Simplify segment structure. Ensure no causal ordering conflicts.
- **170:** Regenerate proofs against current state. Check proof age.
- **186:** Isolate the conflicting component. Remove operations one at a time.

### Step 4: Verify the Fix

```typescript
// Always simulate before submitting
const simulation = await midnightMcp.simulateTransaction(tx);

if (simulation.status === "valid") {
  const txHash = await wallet.submitTransaction(signedTx);
  console.log("Transaction accepted:", txHash);
} else {
  console.error("Simulation failed:", simulation.error);
  // Do NOT submit — fix the issue first
}
```

---

## 4. The Ledger Cost Model Deep Dive

Understanding Midnight's cost model is essential for avoiding Error 154 (`BlockLimitExceeded`). Unlike Ethereum's single-dimensional gas model, Midnight uses **five independent resource dimensions**.

### How the Dimensions Work

Each transaction consumes resources in all five dimensions simultaneously:

```
Transaction Cost = {
  compute_time:     0.3s,    // CPU execution
  io_read_time:     0.2s,    // Storage reads
  consensus_bytes:  45_000,  // Transaction payload size (bytes)
  persistent_bytes: 2_400,   // Net new state writes (bytes)
  churn_bytes:      180_000, // Temporary storage used then freed (bytes)
}
```

A transaction is rejected if *any single dimension* exceeds the block's remaining budget. The pool tracks per-block resource consumption and rejects transactions that would overflow any dimension.

### Practical Implications

**Compute Time** is the most common bottleneck for ZK-heavy contracts. Each `assert()`, arithmetic operation, and proof verification consumes compute time. A circuit with 100 arithmetic operations might be fine; one with 10,000 will likely exceed the limit.

**I/O Read Time** is hit when your contract reads many ledger entries. Each `lookup()` on a map or struct pulls the entire value into the circuit. Reading a map with 1,000 entries is 1,000 I/O operations.

**Consensus Throughput** is about transaction size. A transaction with many contract calls, large proof data, or many segments can exceed the ~200 KB payload limit.

**Persistent Storage** is about state growth. Writing 20 new ledger entries of 1 KB each = 20 KB — right at the limit.

**Churn** is the sneakiest dimension. It measures temporary storage: data written during execution that is freed before the transaction completes. Large intermediate computations can consume significant churn without any visible state changes.

### Cost Model in Practice

Here is how to estimate whether your transaction will fit:

```typescript
function estimateTransactionCost(operations: Operation[]): CostEstimate {
  let compute = 0, ioRead = 0, consensusBytes = 0;
  let persistentBytes = 0, churnBytes = 0;

  for (const op of operations) {
    switch (op.type) {
      case "circuit_call":
        // Each circuit call: ~50ms compute, ~20ms I/O per argument
        compute += 50 + op.args.length * 20;
        ioRead += 20 + op.args.length * 10;
        consensusBytes += 200 + op.proofSize;
        break;
      case "state_write":
        // Each write: ~100 bytes persistent, ~500 bytes churn
        persistentBytes += 100 + op.dataSize;
        churnBytes += 500;
        break;
      case "state_read":
        // Each read: ~30ms I/O, ~500 bytes churn (struct loaded into circuit)
        ioRead += 30;
        churnBytes += 500 + op.structSize;
        break;
      case "merkle_operation":
        // Merkle proof verification: ~200ms compute per level
        compute += 200 * op.treeDepth;
        break;
    }
  }

  return { compute, ioRead, consensusBytes, persistentBytes, churnBytes };
}
```

See `examples/safe-submit.ts` for a complete implementation that checks estimated costs against block limits before submission.

---

## 5. Building Error-Resistant Contracts

The best way to handle Error 1010 is to avoid it entirely. Here are patterns for building contracts that stay within block limits.

### Pattern 1: Chunked Batch Processing

Instead of processing all recipients in one transaction, process them in fixed-size chunks:

```compact
// contracts/safe_batch.compact
export circuit processChunk(
    recipient1: UserAddress, amount1: Uint<64>,
    recipient2: UserAddress, amount2: Uint<64>,
    recipient3: UserAddress, amount3: Uint<64>,
    chunkSize: Uint<8>
): [] {
    const color = tokenType(disclose(TOKEN_DOMAIN), kernel.self());

    sendUnshielded(color, disclose(amount1) as Uint<128>,
        right<ContractAddress, UserAddress>(disclose(recipient1)));

    if (disclose(chunkSize) >= (2 as Uint<8>)) {
        sendUnshielded(color, disclose(amount2) as Uint<128>,
            right<ContractAddress, UserAddress>(disclose(recipient2)));
    }

    if (disclose(chunkSize) >= (3 as Uint<8>)) {
        sendUnshielded(color, disclose(amount3) as Uint<128>,
            right<ContractAddress, UserAddress>(disclose(recipient3)));
    }
}
```

### Pattern 2: Off-Chain Computation, On-Chain Verification

Move expensive computation off-chain and verify the result on-chain:

```compact
// On-chain: only verify a precomputed result
export circuit verifyAndApply(
    resultHash: Bytes<32>,
    amount: Uint<64>,
    recipient: UserAddress
): [] {
    // Verify the result matches expected hash (cheap)
    assert(computeHash(amount, recipient) == disclose(resultHash), "Invalid result");

    // Apply the result (minimal on-chain work)
    const color = tokenType(disclose(DOMAIN), kernel.self());
    sendUnshielded(color, disclose(amount) as Uint<128>,
        right<ContractAddress, UserAddress>(disclose(recipient)));
}
```

### Pattern 3: Progressive State Updates

Instead of updating all state in one transaction, update incrementally:

```compact
// ✅ GOOD: Update 5 fields per transaction, track progress
export circuit updateProgress(
    v1: Uint<64>, v2: Uint<64>, v3: Uint<64>, v4: Uint<64>, v5: Uint<64>,
    batchId: Uint<64>
): [] {
    assert(disclose(batchId) == currentBatch, "Wrong batch");
    slot1 = disclose(v1); slot2 = disclose(v2); slot3 = disclose(v3);
    slot4 = disclose(v4); slot5 = disclose(v5);
    updateProgress = updateProgress + (5 as Uint<64>);
}
```

---

## 6. Real-World Debugging Scenarios

### Scenario 1: "My airdrop transaction fails every time"

**Symptom:** Sending tokens to 50 recipients in one transaction returns Error 1010.

**Diagnosis:** This is Error 154 (`BlockLimitExceeded`). Fifty `sendUnshielded` calls consume too much compute time and consensus throughput.

**Fix:** Chunk the airdrop into batches of 3-5 recipients per transaction. See `contracts/safe_batch.compact` for the pattern.

### Scenario 2: "My shielded transfer works once, then fails"

**Symptom:** First shielded transfer succeeds. Second transfer with the same contract returns Error 1010.

**Diagnosis:** This is Error 186 (`EffectsCheckFailure`). The second transfer is trying to consume a nullifier that was already consumed by the first transfer. You are likely caching the nullifier set and not refreshing it between transactions.

**Fix:** Refresh the nullifier set before each transaction:
```typescript
await wallet.syncState(); // Refresh nullifiers
const tx = await buildTransfer(...);
```

### Scenario 3: "My transaction worked yesterday, fails today"

**Symptom:** A transaction that succeeded yesterday returns Error 1010 today without any code changes.

**Diagnosis:** This is Error 170 (`MerkleRootPruning`). The ZK proof was generated against a Merkle root that has since been pruned.

**Fix:** Regenerate proofs immediately before submission. Never cache proofs for more than a few hundred blocks.

### Scenario 4: "My contract call fails but the simple transfer works"

**Symptom:** A simple token transfer succeeds, but calling your contract's circuit returns Error 1010.

**Diagnosis:** This could be Error 139 (`MalformedTransaction`). Your circuit arguments might not match the compiled ABI after a contract recompilation.

**Fix:** Recompile your contract and regenerate the TypeScript bindings:
```bash
compactc my_contract.compact --output-dir ./generated
```

---

## 7. Best Practices Summary

1. **Always simulate before submitting.** Use the Midnight MCP's `simulateTransaction` to catch errors before they hit the network.

2. **Chunk large operations.** Never process more than 3-5 recipients per transaction. Use the chunked batch pattern.

3. **Generate proofs fresh.** Never cache ZK proofs for more than 1000 blocks. Regenerate before each submission.

4. **Sync wallet state.** Always call `wallet.syncState()` before building a transaction. Stale state is the #1 cause of mysterious failures.

5. **Log everything.** When debugging Error 1010, log the full transaction construction pipeline: arguments, proof data, segment structure, and cost estimates.

6. **Use the 5-dimensional cost model.** Before submitting, estimate your transaction's cost in all five dimensions. If any dimension exceeds 80% of the block limit, chunk the operation.

7. **Test with the local devnet first.** The local devnet has the same validation rules as testnet. Catch errors locally before they cost you testnet tokens.

8. **Handle errors gracefully.** Map Error 1010 variants to user-friendly messages:
   ```typescript
   const userMessages: Record<number, string> = {
     139: "Transaction could not be built. Please check your inputs.",
     154: "Transaction is too large. Please reduce the number of operations.",
     168: "Transaction ordering conflict. Please simplify your operation.",
     170: "Transaction data is outdated. Please try again.",
     186: "Transaction state conflict. Please refresh and try again.",
   };
   ```

---

## 8. Quick Reference Card

| Code | Name | Cause | Fix |
|------|------|-------|-----|
| 139 | MalformedTransaction | Client-side construction error | Rebuild transaction, verify ABI |
| 154 | BlockLimitExceeded | Transaction exceeds block resource limits | Chunk into smaller operations |
| 168 | BatchSettlementFailure | Segment ordering conflict | Simplify segment structure |
| 170 | MerkleRootPruning | Stale proof / pruned Merkle root | Regenerate proof against current state |
| 186 | EffectsCheckFailure | State consistency violation | Isolate conflicting component |

---

## Further Reading

- [Midnight Documentation](https://docs.midnight.network/getting-started)
- [Midnight MCP (npm)](https://www.npmjs.com/package/midnight-mcp)
- [Midnight Developer Forum](https://forum.midnight.network/)
- [Midnight Discord](https://discord.com/invite/midnightnetwork)
- [Batch Transactions Tutorial](../batch-transactions/) — Complementary tutorial covering multi-recipient settlements and chunked processing
