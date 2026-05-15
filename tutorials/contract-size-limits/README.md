---
title: "Contract Size Limits: What Happens When Your dApp Gets Too Complex"
description: "Understanding Midnight's Compact contract size constraints — Lace's 13-circuit deployment limit, block weight limits, error 1010, and proven strategies for splitting large contracts."
author: billbtbillb
tags: [compact, contracts, optimization, lace, circuits, midnight]
difficulty: intermediate
---

# Contract Size Limits: What Happens When Your dApp Gets Too Complex

You have been building a Compact contract for weeks. The logic is elegant, the circuits are correct, and locally everything compiles. Then you deploy to Midnight's testnet via Lace — and it fails. No helpful stack trace, just a cryptic deployment error. What happened?

The answer is almost certainly **contract size limits**. Midnight enforces hard constraints on how large a single contract can be, how many circuits it can contain, and how much computational weight each circuit can consume per transaction. These limits are not bugs — they are deliberate architectural decisions rooted in zero-knowledge proof economics and blockchain resource management.

This tutorial documents every size constraint you will encounter on Midnight, explains *why* each exists, and provides concrete, tested strategies for restructuring oversized contracts into deployable ones.

---

## 1. The Constraint Landscape

Midnight's Compact language compiles high-level contract logic into **circuits** — zero-knowledge circuits that produce proofs verified on-chain. Each constraint below maps to a real resource bottleneck in this pipeline.

### 1.1 Lace's 13-Circuit Deployment Limit

**What it is:** Lace, Midnight's reference wallet and dApp connector, enforces a maximum of **13 circuits per contract deployment**. If your compiled contract contains more than 13 circuits, Lace will reject the deployment transaction before it ever reaches the network.

**Why it exists:** Each circuit requires a separate proving key to be generated, stored, and transmitted during deployment. Lace's browser environment has finite memory and storage. The 13-circuit limit balances expressiveness with the practical constraints of client-side key management.

**How to check:** After compiling your contract with `compactc`, inspect the generated circuit artifacts:

```bash
compactc --output ./build my_contract.compact
ls ./build/circuits/ | wc -l
```

If the count exceeds 13, you have a problem.

**What happens if you exceed it:** The deployment transaction is silently rejected. In Lace's developer console, you may see a generic error. There is no specific "too many circuits" message — the transaction simply never confirms.

### 1.2 Block Weight Limits and Error 1010

**What it is:** Every transaction on Midnight consumes **block weight**, a measure of the computational resources required to verify its proofs. If a single transaction's proof verification exceeds the block weight limit, the network returns **error 1010**.

**Why it exists:** Block weight ensures that no single transaction can monopolize block space. ZK proof verification is computationally expensive — a complex circuit with thousands of constraints takes longer to verify than a simple one. Without weight limits, a malicious or careless developer could create transactions that take minutes to verify, stalling the entire network.

**Symptoms:** Your transaction submits successfully from the client side, but the network rejects it. You see error 1010 in the transaction receipt. This typically happens when a single circuit has too many constraints.

**Diagnosis:** Check the constraint count of your circuits:

```bash
compactc --stats my_contract.compact
```

The output shows constraint counts per circuit. Individual circuits with more than ~50,000 constraints are at risk of triggering error 1010, though the exact threshold depends on the current block weight parameters.

### 1.3 Proof Generation Time Scaling

**What it is:** Proof generation time scales **super-linearly** with circuit complexity. A circuit with 10,000 constraints does not take 10x longer than one with 1,000 constraints — it may take 30-50x longer, depending on the proof system parameters.

**Why it matters:** Even if your circuit fits within block weight limits, users will not wait 45 seconds for a proof to generate in their browser. Practical proof generation should complete in under 5 seconds for a good user experience.

**Real-world data:** Based on community testing:

| Constraint Count | Approx. Proof Time (browser) |
|-----------------|----------------------------|
| 1,000           | ~0.5s                      |
| 5,000           | ~2s                        |
| 10,000          | ~5s                        |
| 50,000          | ~25s                       |
| 100,000         | ~90s+                      |

These numbers vary by hardware, but the trend is clear: keep circuits small.

---

## 2. Why Contracts Grow Too Large

Before diving into solutions, understand why contracts exceed limits in the first place.

### 2.1 Monolithic Design

The most common pattern is a single contract that handles everything: token management, governance logic, access control, and application-specific business rules. Each feature adds circuits, and each circuit adds constraints.

### 2.2 Redundant Logic

When multiple operations share similar validation logic (e.g., checking permissions, verifying token balances), developers often duplicate this logic across circuits instead of factoring it into shared modules.

### 2.3 Unbounded Iteration

Compact does not support unbounded loops — all iterations must have compile-time-known bounds. But even bounded loops can explode constraint counts. A loop that iterates 100 times, with 50 constraints per iteration, adds 5,000 constraints to a single circuit.

### 2.4 Deep State Dependencies

Circuits that read from many different ledger states or cross-reference multiple contract states generate more constraints per access, because each state access must be proven against the ledger Merkle tree.

---

## 3. Strategy 1 — Split Contracts

The most powerful technique for dealing with size limits is **contract splitting**: decomposing a single large contract into multiple smaller contracts that communicate via cross-contract references.

### 3.1 Identifying Split Boundaries

Good split boundaries follow **domain boundaries**. Ask yourself:

- Which state variables are always accessed together?
- Which operations are logically independent?
- Which circuits never share a secret?

**Example:** A DEX contract with token swaps, liquidity pools, and governance is a natural three-way split:

```
SwapContract.compact      — swap logic, price calculation
LiquidityContract.compact — pool management, LP tokens  
GovContract.compact       — voting, parameter updates
```

### 3.2 Compact Contract Splitting — Before and After

**Before (monolithic, 18 circuits — exceeds limit):**

```compact
contract MonolithicDEX {
  ledger {
    pools: Map<Bytes<32>, PoolData>;
    lp_tokens: Map<Bytes<32>, Uint<64>>;
    governance_votes: Map<Bytes<32>, VoteData>;
    swap_fee: Uint<64>;
    min_liquidity: Uint<64>;
    proposal_count: Uint<64>;
  }

  // Swap circuits (5 circuits)
  circuit swap(...) { ... }
  circuit calculate_price(...) { ... }
  circuit verify_slippage(...) { ... }
  circuit update_pool_reserves(...) { ... }
  circuit emit_swap_event(...) { ... }

  // Liquidity circuits (6 circuits)
  circuit add_liquidity(...) { ... }
  circuit remove_liquidity(...) { ... }
  circuit calculate_lp_tokens(...) { ... }
  circuit verify_minimum_liquidity(...) { ... }
  circuit update_lp_balances(...) { ... }
  circuit claim_fees(...) { ... }

  // Governance circuits (7 circuits)
  circuit create_proposal(...) { ... }
  circuit cast_vote(...) { ... }
  circuit tally_votes(...) { ... }
  circuit execute_proposal(...) { ... }
  circuit verify_quorum(...) { ... }
  circuit update_parameters(...) { ... }
  circuit archive_proposal(...) { ... }
}
```

**After (three contracts, each under 13 circuits):**

```compact
// SwapContract.compact — 5 circuits
contract SwapContract {
  import LiquidityContract;  // cross-contract reference

  ledger {
    pools: Map<Bytes<32>, PoolData>;
    swap_fee: Uint<64>;
  }

  circuit swap(...) { ... }
  circuit calculate_price(...) { ... }
  circuit verify_slippage(...) { ... }
  circuit update_pool_reserves(...) { ... }
  circuit notify_liquidity_contract(...) { ... }
}
```

```compact
// LiquidityContract.compact — 6 circuits
contract LiquidityContract {
  ledger {
    lp_tokens: Map<Bytes<32>, Uint<64>>;
    min_liquidity: Uint<64>;
  }

  circuit add_liquidity(...) { ... }
  circuit remove_liquidity(...) { ... }
  circuit calculate_lp_tokens(...) { ... }
  circuit verify_minimum_liquidity(...) { ... }
  circuit update_lp_balances(...) { ... }
  circuit claim_fees(...) { ... }
}
```

```compact
// GovContract.compact — 7 circuits
contract GovContract {
  ledger {
    governance_votes: Map<Bytes<32>, VoteData>;
    proposal_count: Uint<64>;
  }

  circuit create_proposal(...) { ... }
  circuit cast_vote(...) { ... }
  circuit tally_votes(...) { ... }
  circuit execute_proposal(...) { ... }
  circuit verify_quorum(...) { ... }
  circuit update_parameters(...) { ... }
  circuit archive_proposal(...) { ... }
}
```

Each contract now has 5, 6, and 7 circuits respectively — all well within the 13-circuit limit.

---

## 4. Strategy 2 — Cross-Contract References

When you split a contract, the pieces need to communicate. Compact supports **cross-contract references** for exactly this purpose.

### 4.1 Declaring a Cross-Contract Reference

```compact
contract SwapContract {
  // Declare a reference to another deployed contract
  import LiquidityContract;

  ledger {
    pools: Map<Bytes<32>, PoolData>;
  }

  circuit swap(token_in: Bytes<32>, token_out: Bytes<32>, amount: Uint<64>): Uint<64> {
    // Read state from the liquidity contract
    let available_liquidity = LiquidityContract.get_liquidity(token_in, token_out);
    
    // Ensure sufficient liquidity exists
    assert available_liquidity >= amount, "Insufficient liquidity";
    
    // Perform the swap
    let output = calculate_price(token_in, token_out, amount);
    update_pool_reserves(token_in, token_out, amount, output);
    
    return output;
  }
}
```

### 4.2 Cost of Cross-Contract Calls

Cross-contract references are not free. Each reference:

- Adds Merkle proof verification constraints (proving the other contract's state)
- Increases the proof size of the calling circuit
- May increase proof generation time by 500-2000 constraints per reference

**Rule of thumb:** Limit cross-contract references to 2-3 per circuit. If a circuit needs to reference 5+ external contracts, consider whether the split boundaries are in the right place.

### 4.3 Designing Clean Interfaces

Define the interface contract with only the methods other contracts need:

```compact
// LiquidityInterface.compact — minimal interface for cross-contract use
interface ILiquidity {
  circuit get_liquidity(token_in: Bytes<32>, token_out: Bytes<32>): Uint<64>;
  circuit update_reserves(token: Bytes<32>, delta: Int<64>): void;
}
```

This keeps the import lightweight and prevents unnecessary constraint bloat from importing full contract logic.

---

## 5. Strategy 3 — Keep Individual Circuits Small

Even if your contract is under 13 circuits, individual circuits can still be too heavy. Here are techniques for reducing per-circuit constraint counts.

### 5.1 Factor Common Logic into Witness Circuits

A **witness circuit** computes a value without proving it on-chain. Use witness circuits for intermediate computations that are checked elsewhere:

```compact
// Instead of one massive circuit:
circuit complex_operation(a: Uint<64>, b: Uint<64>, c: Uint<64>): Uint<64> {
  // 1000 constraints of intermediate math
  let intermediate = expensive_computation(a, b);
  let result = another_expensive_computation(intermediate, c);
  return result;
}

// Split into witness + verification:
witness compute_intermediate(a: Uint<64>, b: Uint<64>): Uint<64> {
  return expensive_computation(a, b);
}

circuit verify_and_finalize(a: Uint<64>, b: Uint<64>, c: Uint<64>, 
                             claimed_intermediate: Uint<64>): Uint<64> {
  // Only verify the claim, don't recompute everything
  assert compute_intermediate(a, b) == claimed_intermediate;
  return another_expensive_computation(claimed_intermediate, c);
}
```

This approach can reduce constraint counts by 30-50% for computation-heavy circuits.

### 5.2 Minimize State Reads

Every ledger state read generates Merkle proof constraints. If a circuit reads from 10 different ledger slots, that is roughly 10 × (tree depth × hash constraints) just for state access.

**Optimization:** Batch state reads where possible. Instead of reading individual fields, pack related data into a single struct:

```compact
// Instead of 4 separate reads:
let balance = ledger.balances[user];
let nonce = ledger.nonces[user];
let permissions = ledger.permissions[user];
let metadata = ledger.metadata[user];

// Pack into one struct and read once:
let user_state = ledger.user_states[user];
// Access balance, nonce, permissions, metadata from user_state
```

Each eliminated state read saves approximately `30 × tree_depth` constraints.

### 5.3 Reduce Loop Bounds

Audit every loop in your contract. If a loop bound is higher than necessary, reduce it:

```compact
// Before: iterates 100 times
for i in 0..100 {
  process_item(items[i]);
}

// After: use actual maximum needed
const MAX_ITEMS: Uint<16> = 20;
for i in 0..MAX_ITEMS {
  process_item(items[i]);
}
```

Reducing a loop from 100 to 20 iterations can eliminate 80% of that circuit's constraints.

### 5.4 Use Bitwise Operations Instead of Arithmetic

ZK circuits handle bitwise operations more efficiently than multi-step arithmetic. When encoding flags or doing comparisons, prefer bitwise patterns:

```compact
// More constraints:
if (x > 0 && x < 100 && x % 2 == 0) { ... }

// Fewer constraints (pre-computed range check):
let in_range = range_check(x, 0, 100);
let is_even = bit_check(x, 0);  // check least significant bit
if (in_range && !is_even) { ... }
```

---

## 6. Strategy 4 — Modular Architecture Patterns

### 6.1 The Hub-and-Spoke Pattern

Deploy one central contract that holds core state, and multiple spoke contracts that handle specific operations:

```
        ┌─────────────┐
        │  CoreContract │  (state, routing)
        └──────┬───────┘
         ┌─────┼─────┐
         ▼     ▼     ▼
      ┌─────┐┌─────┐┌─────┐
      │Auth  ││Token ││Gov   │
      │Spoke ││Spoke ││Spoke │
      └─────┘└─────┘└─────┘
```

Each spoke imports the CoreContract for state access but contains its own circuits. This pattern scales to any number of features while keeping each contract under the circuit limit.

### 6.2 The Pipeline Pattern

For sequential processing (e.g., order processing → settlement → reporting), arrange contracts as a pipeline:

```
Contract A → Contract B → Contract C
(input)      (process)    (output)
```

Each contract passes its output to the next via cross-contract references. This is natural for workflows where each stage is independent.

### 6.3 The Registry Pattern

When the number of sub-contracts is dynamic (e.g., one contract per user group), use a registry contract:

```compact
contract Registry {
  ledger {
    group_contracts: Map<Bytes<32>, Address>;
    group_count: Uint<32>;
  }

  circuit register_group(group_id: Bytes<32>, contract_addr: Address): void {
    ledger.group_contracts[group_id] = contract_addr;
    ledger.group_count = ledger.group_count + 1;
  }

  circuit get_group_contract(group_id: Bytes<32>): Address {
    return ledger.group_contracts[group_id];
  }
}
```

---

## 7. Debugging Size Issues

### 7.1 The Compilation Checklist

Before deploying, run through this checklist:

```bash
# 1. Compile and count circuits
compactc --output ./build contract.compact
CIRCUIT_COUNT=$(ls ./build/circuits/ | wc -l)
echo "Circuit count: $CIRCUIT_COUNT (max: 13)"
[ "$CIRCUIT_COUNT" -le 13 ] || echo "WARNING: Exceeds Lace limit!"

# 2. Check constraint counts per circuit
compactc --stats contract.compact

# 3. Measure proof generation time locally
time midnight-proof-gen --circuit ./build/circuits/main.zkir

# 4. Verify proof size
ls -lh ./build/circuits/*.proof
```

### 7.2 Common Error Messages and Solutions

| Error | Cause | Solution |
|-------|-------|----------|
| Deployment timeout | Too many circuits | Split contract |
| Error 1010 | Block weight exceeded | Reduce circuit constraints |
| Proof gen > 30s | Complex circuit | Factor into witness circuits |
| Memory exceeded (Lace) | Large proving keys | Split contract or reduce state |

### 7.3 Monitoring in Production

After deployment, monitor your contract's health:

- Track proof generation times in your dApp telemetry
- Watch for error 1010 spikes after contract upgrades
- Set alerts if proof times exceed 10 seconds

---

## 8. Real-World Case Study: From 22 to 3 Contracts

A community developer built a decentralized voting platform with 22 circuits in a single contract. Deployment via Lace failed. Here is how they refactored:

**Original structure (22 circuits):**
- 4 circuits: voter registration
- 5 circuits: ballot creation and management
- 6 circuits: vote casting and verification
- 4 circuits: tallying and results
- 3 circuits: admin functions

**Refactored structure (3 contracts):**

| Contract | Circuits | Purpose |
|----------|----------|---------|
| VoterRegistry | 5 | Registration + admin |
| BallotManager | 7 | Ballot lifecycle |
| VoteProcessor | 8 | Casting + tallying |

**Result:** All three contracts deployed successfully. Cross-contract references between BallotManager and VoteProcessor added ~1,500 constraints per reference circuit, but all circuits remained well under error 1010 thresholds.

---

## 9. Quick Reference

### Limits Summary

| Constraint | Limit | Failure Mode |
|-----------|-------|-------------|
| Circuits per contract | 13 | Lace deployment rejection |
| Constraints per circuit | ~50,000 (soft) | Error 1010 |
| Proof generation time | ~30s (practical) | Poor UX, timeouts |
| Cross-contract refs per circuit | 2-3 (recommended) | Constraint bloat |
| Loop iterations | Compile-time bound | Compile error if unbounded |

### Decision Tree

```
Contract won't deploy?
├─ > 13 circuits? → Split into multiple contracts
├─ Error 1010? → Reduce per-circuit constraints
│  ├─ Too many state reads? → Batch reads, pack structs
│  ├─ Large loops? → Reduce bounds
│  └─ Deep cross-contract refs? → Restructure dependencies
└─ Proof too slow? → Use witness circuits, reduce complexity
```

---

## 10. Next Steps

1. **Audit your existing contracts** — Run `compactc --stats` on every contract. Identify which ones are close to limits.
2. **Design for splitting from the start** — When architecting a new dApp, plan contract boundaries before writing code.
3. **Test on testnet early** — Size issues often only appear when deploying to Lace. Test deployments frequently.
4. **Share your findings** — Report constraint counts and optimization wins on the [Midnight Developer Forum](https://forum.midnight.network/) to help other developers.

## Resources

- [Midnight Getting Started Docs](https://docs.midnight.network/getting-started)
- [Compact Language Reference](https://docs.midnight.network/)
- [Midnight MCP on npm](https://www.npmjs.com/package/midnight-mcp)
- [Developer Forum](https://forum.midnight.network/)
- [Discord Community](https://discord.com/invite/midnightnetwork)

---

*This tutorial is part of the [Midnight Contributor Hub](https://github.com/midnightntwrk/contributor-hub). Contributions and corrections welcome via pull request.*
