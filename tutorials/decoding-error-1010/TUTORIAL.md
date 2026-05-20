# Decoding Error 1010: What "Invalid Transaction" Actually Means on Midnight

> **Audience:** Developers building on Midnight Network  
> **Prerequisites:** Basic understanding of Substrate-based blockchains and the Midnight stack  
> **Reading time:** 15 minutes

---

## Table of Contents

1. [The 1010 Wall](#the-1010-wall)
2. [How Error Codes Work in Midnight](#how-error-codes-work-in-midnight)
3. [The 5-Dimension Cost Model](#the-5-dimension-cost-model)
4. [Error Code Catalog](#error-code-catalog)
5. [Building a Diagnostic Toolkit](#building-a-diagnostic-toolkit)
6. [Summary: Error → Cause → Fix Quick Reference](#summary-error--cause--fix-quick-reference)

---

## The 1010 Wall

Every Midnight developer hits it eventually. You're testing a transaction, everything looks right, and then:

```
1010: Invalid Transaction
```

That's it. No line number. No helpful message. Just an opaque wall between you and a working dApp.

Error 1010 is the Midnight node's way of saying "something is wrong with this transaction, but I'm not going to tell you what in a single line." Behind that code is a layered diagnostic system that maps specific error numbers to specific problems — transaction builder limits, block capacity, stale wallet state, and version mismatches.

This tutorial decodes that system. By the end, you'll know exactly what each error number means and how to fix it.

---

## How Error Codes Work in Midnight

Midnight runs on [Substrate](https://substrate.io/), the same framework that powers Polkadot. Substrate uses a transaction-pool validation system with four built-in error variants:

| Variant | Code Range | Meaning |
|---------|-----------|---------|
| `InvalidTransaction::Custom(n)` | 1000 + n | **1010 = 1000 + 10** |
| `InvalidTransaction::Stale` | — | Nonce or timestamp too old |
| `InvalidTransaction::Future` | — | Nonce or timestamp from the future |
| `InvalidTransaction::BadProof` | — | Signature or proof verification failed |

Error **1010** specifically means `InvalidTransaction::Custom(10)`. Here's how that reaches you:

```
Your Transaction
        ↓
  midnight-node (Substrate)
        ↓
  validate_unsigned() / pre_dispatch()     ← pool & block validation
        ↓
  midnight-pallet → ledger API              ← actual logic checks
        ↓
  LedgerApiError → u8                       ← error code mapping
        ↓
  InvalidTransaction::Custom(code)          ← Substrate wrapping
        ↓
  1010 = 1000 + 10                          ← what you see
```

The key insight: the `10` in the custom code is **not** the actual error. It wraps a deeper ledger error. The mapping logic (from the `midnight-ledger` crate's `types.rs`) converts `LedgerApiError` variants into `u8` codes:

```rust
// Simplified from midnight-ledger source
impl From<LedgerApiError> for u8 {
    fn from(err: LedgerApiError) -> u8 {
        match err {
            LedgerApiError::Deserialization(e) => e.into(),    // codes 0-11
            LedgerApiError::Serialization(e) => e.into(),      // codes 50-63
            LedgerApiError::Transaction(e) => e.into(),        // codes 100-250
            LedgerApiError::BlockLimitExceededError => 154,
            LedgerApiError::FeeCalculationError => 155,
            LedgerApiError::ContractNotPresent => 156,
            LedgerApiError::NoLedgerState => 151,
            // ... more variants
        }
    }
}
```

So when you see 1010, the node is saying: *"I've rejected this transaction via the Custom(10) wrapper, and the underlying ledger error code is stored in the node logs."*

**Pro tip:** The first place to look is **not** the error code — it's the node's structured logs. Run with `RUST_LOG=info` or check your indexer's output. The ledger layer logs the specific `LedgerApiError` variant before it's compressed into 1010.

---

## The 5-Dimension Cost Model

Before we dive into specific error codes, you need to understand Midnight's cost model. Many errors (especially 154) originate here.

Every Midnight transaction has a **synthetic cost** with five independent dimensions:

```rust
pub struct SyntheticCost {
    pub read_time: u64,         // IO read time (picoseconds)
    pub compute_time: u64,      // CPU compute time (picoseconds)
    pub block_usage: u64,       // bytes used in the block
    pub bytes_written: u64,     // net persistent bytes written
    pub bytes_churned: u64,     // temporary/overwritten bytes
}
```

**Block limits** (initial values on testnet/mainnet):

| Dimension | Limit | Equivalent |
|-----------|-------|------------|
| `read_time` | 1,000,000,000,000 ps | 1 second |
| `compute_time` | 1,000,000,000,000 ps | 1 second |
| `block_usage` | 200,000 bytes | ~200 KB |
| `bytes_written` | 50,000 bytes | ~50 KB |
| `bytes_churned` | 1,000,000 bytes | ~1 MB |

**Normalization:** The node divides each dimension of your transaction's cost by the corresponding block limit. If **any** dimension exceeds 1.0, your transaction is rejected with `BlockLimitExceeded`.

**Fee pricing** also uses five factors:

```rust
pub struct FeePrices {
    pub overall_price: FixedPoint,      // base price per full block
    pub read_factor: FixedPoint,        // price factor for read time
    pub compute_factor: FixedPoint,     // price factor for compute time
    pub block_usage_factor: FixedPoint, // price factor for block size
    pub write_factor: FixedPoint,       // price factor for writes
    pub churn_factor: FixedPoint,       // price factor for churn
}
```

This means a transaction's fee depends on **how much of each resource it consumes**, not just byte size. A compute-heavy ZK proof submission could cost more than a simple balance transfer, even if both are the same byte size.

**What this means for developers:**

- Adding more contract calls increases all five dimensions
- Large state writes push you toward the `bytes_written` limit (50 KB is tighter than you think)
- Complex ZK circuits increase `compute_time`

---

## Error Code Catalog

### 139 — Transaction Builder UnknownError

**Quick diagnosis:** SDK version mismatch between your transaction builder library and the node.

**What happens:** The Rust `midnight-ledger` library has a `MalformedError` enum. When a **new** variant is added that the node's version doesn't recognize, it falls through to the catch-all `MalformedError::UnknownError`.

```rust
// From types.rs — the catch-all
pub enum MalformedError {
    UnknownError(Box<dyn Error>),  // code 139 = catch-all
    VerifierKeyNotSet,             // code 110
    TransactionTooLarge,           // code 111
    // ... 30+ more variants
}
```

**Diagnostic steps:**
1. Check your `midnight-ledger` version against the node's version
2. If they differ, the transaction builder may be producing data the node can't parse
3. Look for recent API changes between versions

**Fix:**
```bash
# Align your SDK with the testnet node version
npm install @midnight-ntwrk/midnight-js-ledger@<node-version>
```

---

### 154 — BlockLimitExceededError

**Quick diagnosis:** Your transaction exceeds one of the five cost dimensions.

**What happens:** The ledger normalizes your transaction's synthetic cost against block limits. If any dimension exceeds the limit, normalization returns `None`:

```rust
// From ledger/src/structure.rs
.normalize(params.limits.block_limits)
.ok_or(FeeCalculationError::BlockLimitExceeded)?;
```

**Diagnostic steps:**
1. Check which dimension(s) you're exceeding by enabling debug logging
2. Use the `TransactionCostModel` from `LedgerParameters` to compute your tx cost:

```typescript
// Using midnight-js SDK
const params = await ledger.getLedgerParameters();
const costModel = params.transactionCostModel;
// costModel has: runtimeCostModel, parallelismFactor, baselineCost
```

3. Compare each dimension against the block limits above

**Common causes and fixes:**

| Cause | Fix |
|-------|-----|
| Too many contract calls in one tx | Split into multiple transactions |
| Large contract deployment (~200KB+) | Minimize your Compact contract size |
| Heavy ZK proof computation | Optimize circuits, reduce witness size |
| Bulk operations (batch transfers) | Reduce batch size, or submit sequentially |

---

### 168 — BatchSettlement (RETIRED)

**Quick diagnosis:** You shouldn't see this on modern nodes.

**What happened:** This was a `MalformedError` variant related to batch settlement validation in early versions of Midnight. It has been **retired** and marked with a sentinel in the source code:

```rust
// From types.rs — retired codes can never be reused
const RETIRED_U8_ERROR_CODES: &[u8] = &[168, 182, 186, 187, 188, 193, 205];
```

If you see 168, you're running an old node. Upgrade.

---

### 170 — InvalidDustSpendProof

**Quick diagnosis:** Your wallet's DUST spend references a Merkle root that the node has already pruned.

**What happens:** Midnight uses Merkle trees to track DUST (the native token for gas/mining). When you spend DUST, your wallet generates a proof referencing a specific Merkle root. If the node has advanced past that root (pruned it from state), your proof becomes invalid.

```rust
// From types.rs — the error includes diagnostic fields
pub struct InvalidDustSpendProof {
    pub declared_time: Timestamp,
    pub dust_spend: Box<DustSpend<(), D>>,
}
```

**Diagnostic steps:**
1. Check if your indexer is synced with the chain tip
2. This error typically appears after the indexer has been offline
3. Your wallet's `ctime` (current time) is stale, so generated DUST spends reference an old state

**Fix:**
```bash
# Reset your wallet state and let it re-sync
midnight-wallet reset --network=testnet
# Or wait for the indexer to catch up
midnight-indexer status  # check sync progress
```

**Related error — 171 (OutOfDustValidityWindow):** If your DUST spend's `dust_ctime < validity_start`, you get 171 instead. The diagnostic and fix are the same: your indexer is behind.

---

### 186 — EffectsCheckFailure (RETIRED — replaced by 212-218)

**Quick diagnosis:** Your contract's `effectsCircuit` is producing outputs that don't match what the ledger computed.

**What happened:** Error 186 was the original catch-all for effects check violations. It has been **retired** and replaced by seven more specific sub-codes:

| Code | Name | Meaning |
|------|------|---------|
| 212 | `RealCallsSubsetCheckFailure` | Claimed calls not in `real_calls` |
| 213 | `AllCommitmentsSubsetCheckFailure` | Claimed spends not in commitments |
| 214 | `RealUnshieldedSpendsSubsetCheckFailure` | Claimed unshielded spends mismatch |
| 215 | `ClaimedUnshieldedSpendsUniquenessFailure` | Duplicate unshielded spend |
| 216 | `ClaimedCallsUniquenessFailure` | Duplicate claimed call |
| 217 | `NullifiersNeqClaimedNullifiers` | Contract nullifiers not properly claimed |
| 218 | `CommitmentsNeqClaimedShieldedReceives` | Contract commitments not claimed |

**Diagnostic steps:**
1. Check which sub-code (212-218) you received — each points to a specific mismatch
2. Audit your Compact contract's `effectsCircuit` implementation
3. The error means your contract claimed a state effect that doesn't match what the ledger actually computed

**Fix:**
```compact
// In your Compact effectsCircuit, ensure every claimed output
// exactly matches what real_calls produces
circuit effectsCircuit(myInput: Private) {
  // ... your circuit logic
  
  // Every claimed spend must have a corresponding
  // real commitment in the transaction
  claim myOutput as ShieldedReceive;  // must match a real commitment
}
```

For each error:

- **212 (RealCallsSubsetCheck):** Your `claimedCalls` contains entries not present in `realCalls`. Typically a bug where the contract claims more transactions than were actually executed.

- **213 (AllCommitmentsSubsetCheck):** Your `claimedSpends` include commitments that don't exist in the ledger's state. The nullifier was already spent, or the commitment was never created.

- **217/218 (Nullifiers/Commitments mismatch):** Your contract's `nullifier` output doesn't match what the ledger computed. Usually caused by inconsistent state derivation in the circuit.

---

## Building a Diagnostic Toolkit

### 1. Enable Node Logging

The fastest way to find the underlying error:

```bash
# Start or restart your node with verbose logging
midnight-node --log=info,midnight=debug,txpool=debug
```

When you submit a transaction that returns 1010, the node log will show something like:

```
[midnight::ledger] ERROR: BlockLimitExceededError: normalize failed for tx 0xabcd...
```

That's your real error before it gets compressed into 1010.

### 2. Check SDK Version Alignment

```bash
# Check your package versions
npm list @midnight-ntwrk/midnight-js-ledger
npm list @midnight-ntwrk/midnight-js-types

# Compare with testnet node version
curl -s https://testnet.midnight.network/api/version
```

### 3. Monitor Indexer Sync Status

```typescript
// Using midnight-js SDK
const status = await indexer.status();
console.log({
  synced: status.synced,
  currentBlock: status.currentBlock,
  chainTip: status.chainTip,
  behind: status.chainTip - status.currentBlock,
});

// If behind > 0, DUST operations (errors 170/171) are likely
```

### 4. Estimate Transaction Cost Before Submission

```typescript
// Estimate cost before submitting
const txCost = await ledger.estimateCost(myTransaction);
const blockLimits = params.limits.blockLimits;

console.log('Read time:', txCost.readTime / blockLimits.readTime * 100, '%');
console.log('Compute time:', txCost.computeTime / blockLimits.computeTime * 100, '%');
console.log('Block usage:', txCost.blockUsage / blockLimits.blockUsage * 100, '%');
console.log('Bytes written:', txCost.bytesWritten / blockLimits.bytesWritten * 100, '%');
console.log('Bytes churned:', txCost.bytesChurned / blockLimits.bytesChurned * 100, '%');
```

Any value > 100% will cause error 154. Use this to optimize before submitting.

---

## Summary: Error → Cause → Fix Quick Reference

| Code | Name | Cause | First Thing to Check |
|------|------|-------|---------------------|
| **1010** | Pool Invalid TX | Generic wrapper — check node logs for the real error | `midnight-node --log=info,midnight=debug` |
| **139** | Builder Unknown | SDK version mismatch | `npm list @midnight-ntwrk/midnight-js*` |
| **154** | Block Limit Exceeded | Transaction exceeds 5D cost model | `estimateCost()` and compare against block limits |
| **168** | (RETIRED) | Old node version | Upgrade node |
| **170** | Invalid DUST Proof | Stale wallet state, indexer behind | `midnight-indexer status` |
| **186** | (RETIRED) | Replaced by 212-218 | See sub-codes |
| **212-218** | Effects Check | Contract circuit outputs mismatch ledger | Audit `effectsCircuit` |

### Quick Fix Flowchart

```
See 1010
  ↓
Check node logs (--log=debug)
  ↓
Find underlying error code
  ↓
├── 139 → Align SDK versions
├── 154 → Estimate tx cost, reduce complexity
├── 170 → Check indexer sync, reset wallet
├── 212-218 → Fix effectsCircuit in Compact contract
└── Other → Check forum.midnight.network for known issues
```

---

## Further Resources

- [Midnight Documentation](https://docs.midnight.network/getting-started)
- [Midnight Developer Forum](https://forum.midnight.network/) — search "1010" for real developer experiences
- [midnight-mcp](https://www.npmjs.com/package/midnight-mcp) — AI-assisted contract development
- [Midnight Discord](https://discord.com/invite/midnightnetwork) — active developer community

---

*Published for the Midnight Network developer community. Tested against midnight-ledger v3.x and testnet node v0.8+. Found an error? Submit a PR to keep this guide current.*
