# Security Checklist for Midnight dApps Before Deployment

## Overview

Before deploying any Midnight smart contract to testnet or mainnet, run through this
security checklist. Most of the bugs below have caused real contract failures or
exploitable conditions in deployed dApps. Use it as the final gate before every
release.

## What's Covered

| Check | Risk if Missed |
|-------|---------------|
| Ownership verification | Anyone becomes owner on init |
| Arithmetic overflow | Under/overflow steals funds |
| Reentrancy | External call before state update → re-drain |
| Nullifier reuse | Spend fresh coins → proof fails or double-spend |
| Access control gaps | Public fn allows unauthorized state change |
| Initializer reentrancy | Proxy upgrade vulnerability |
| Pedersen commitment binding | Malicious proof uses wrong commitment |

## Prerequisites

- Compact smart contract written and compiling
- Midnight testnet running locally
- Understanding of `#[private]` and `#[public]` attributes

## Architecture Note

Midnight's L1 contract state is partially public. The ZK proof layer is **built by
the client**, not the contract. This means the security model differs from EVM Solidity:

```
┌─────────────────────────────────────────────────────────┐
│        EVM Solidity                   Midnight Compact   │
│  - Contract on-chain stores all      - L1 stores only   │
│    state deterministically           public commitment │
│  - All logic enforced by EVM         + private state    │
│  - Reentrancy guards on-chain        encrypted locally │
│  - Access control = the gatekeeper   → ZK proof must   │
│                                       be valid / valid  │
└─────────────────────────────────────────────────────────┘
```

## Pre-Deployment Checklist

Run ALL checks before deploying. Each failed item = block deployment.

### 1. Ownership Verification

```
CLI: grep -n 'pub.*new()\|pub.*__init__\|owner' contracts/*.compact
```

**Pass criteria**: `owner` field exists and `#[private]`. Default `new()` sets it only once.

```compact
struct MyContract {
    #[private]
    owner: Address,               // ✅ Private — only the initializer knows it
}

impl MyContract {
    pub fn new(initial_owner: &Address) -> Self {
        MyContract { owner: *initial_owner }    // ✅ Set once, never changeable
    }
}
```

**Failure mode**: No owner check, or `owner` is `pub`:
```compact
// ❌ ANY ADDRESS CAN SET THEMSELVES AS OWNER
struct BadContract {
    owner: Address,  // pub — anyone can see and override
}
```

### 2. Arithmetic Bounds

```
CLI: grep -n '+\|-\|\*' contracts/*.compact | grep -v '//' | head -30
```

**Pass criteria**: All arithmetic has explicit bounds check or `checked_add/sub`.

```compact
// ✅ Safe subtraction with bounds
pub fn safe_transfer(&self, recipient: &Address, amount: u64) -> bool {
    let balance = self.balances.get(recipient);
    if balance < amount { return false; }           // Isolate failure
    self.balances.set(recipient, balance - amount);
    true
}
```

**Failure mode**: Direct subtract before check:
```compact
// ❌ Underflow wraps silently
let new_balance = old_balance - amount;
```

### 3. Reentrancy Guarding

**Pass criteria**: All balance updates happen BEFORE any external L1 call
(emit, transfer, or note commitment).

```compact
// ✅ SECURE — state update before external effects
pub fn withdraw(&mut self, amount: u64) -> bool {
    let caller = self.caller();
    let balance = self.balances.get(&caller);
    self.balances.set(&caller, balance - amount);    // STATE FIRST
    emit Withdrawn(caller, amount);                  // THEN external
    true
}
```

**Failure mode** (reentrancy window):
```compact
// ❌ DANGEROUS — emit/transfer before state update
pub fn withdraw(&mut self, amount: u64) -> bool {
    emit Withdrawn(caller, amount);
    self.balances.set(&caller, balance - amount);    // ← Reentrancy window open here
}
```

### 4. Nullifier and Commitment Hygiene

```
CLI: grep -n 'nullifier\|Nullifier\|commitment\|commit' contracts/*.compact
```

**Pass criteria**:
- No note is spent twice (nullifier uniqueness)
- Every `NullifierSpent` event has a corresponding valid `sendShielded` call
- Freshly committed notes cannot be spent in the same block

```compact
// ✅ Nullifier tracked uniquely
let nullifier_field = some_blinding_field as Field;
self.spent_nullifiers.set(nullifier_field, true);
emit NullifierSpent(nullifier_field);   // Emit BEFORE spending
```

### 5. #[private] Field Coverage

```
CLI: grep -n '^ *#\[private\]\|^ *#\[public\]' contracts/*.compact | grep -v 'tests/'
```

**Pass criteria**: All state fields that should be private are explicitly `#[private]`.
Default is public for struct fields — be explicit.

```compact
record Note {
    #[private]                   // ✅ Owner is encrypted on-chain
    owner: Address,
    #[private]                   // ✅ Value hidden in proof
    value: u64,
    #[public]                     // ✅ Commitment visible for Merkle
    commitment: Field,
}
```

### 6. Initializer Idempotency

```
CLI: grep -n 'pub.*new\|pub.*__init__' contracts/*.compact
```

**Pass criteria**: Initializer can only be called once. Re-calling must panic.

```compact
impl MyContract {
    pub fn new(owner: &Address) -> Self {
        assert(!is_initialized(), "Already initialized");  // ✅ Idempotent guard
        MyContract { owner: *owner, initialized: true }
    }
}
```

### 7. Pedersen Commitment Binding

**Pass criteria**: Commitment input binds `owner + value + nonce` uniquely.
No malleable or predictable commitment.

```compact
// ✅ Three inputs make commitment non-trivial to forge
let commitment = PedersenHasher::hash(vec![
    owner.to_field(),
    value as Field,
    nonce as Field,
]);
```

**Failure mode**: Commitment uses only 1 input (truncated):
```compact
// ❌ Predictable commitment structure
let commitment = PedersenHasher::hash(vec![value as Field]);  // owner missing!
```

### 8. External Call Safety

**Pass criteria**: No external calls (emit, transfer, callback) appear before state update.

```compact
// ✅ SAFE ORDER — state mutates first, external events second
pub fn safe_fn(&mut self) {
    self.balances.set(...);    // 1. State
    emit Event(...);            // 2. External
}
```

### 9. Access Control Coverage

```
CLI: grep -n 'pub fn\|pub.*fn\|assert.*caller\|self.caller' contracts/*.compact
```

**Pass criteria**: State-changing functions check `self.caller()` is authorized.

```compact
pub fn mint(&mut self, amount: u64) {
    let caller = self.caller();
    assert(caller == self.owner, "Only owner can mint");  // ✅
    ...
}
```

### 10. Merkle Tree Finality

**Pass criteria**: Contract does not assume Merkle root is final in the same block
as a commitment emission. Wait ≥1 L1 confirmation before spending newly minted coins.

## Automated Check Script

Save as `scripts/security-check.sh`:

```bash
#!/usr/bin/env bash
set -e
CONTRACT=${1:-contracts/main.compact}

echo "=== Midnight dApp Security Check ==="
echo ""

# 1. Owner check
echo "1. Ownership field:"
grep -n 'owner' "$CONTRACT" | grep -v '^Binary' | head -5

# 2. #[private] coverage
echo "2. Private field coverage:"
grep -E '#\[(private|public)\]' "$CONTRACT"

# 3. Arithmetic safety
echo "3. Arithmetic operations:"
grep -E '\+|\-|\*' "$CONTRACT" | grep -v '^Binary' | head -10

# 4. Reentrancy check
echo "4. External call ordering:"
grep -n 'emit\|send\|transfer\|commit' "$CONTRACT" | head -10

# 5. Nullifier hygiene
echo "5. Nullifier/commitment events:"
grep -n 'Nullifier\|nul\|commit' "$CONTRACT" | head -10

# 6. Initializer guard
echo "6. Initializer signature:"
grep -n 'pub fn new\|pub fn __init__' "$CONTRACT"

echo ""
echo "Review completed. Verify each item above meets pass criteria."
```

Run before every deployment:
```bash
bash scripts/security-check.sh contracts/my_contract.compact
```

## Summary Checklist

```
CLI Checks:
[ ] grep -n 'pub.*new()' → Owner set deterministically
[ ] grep -E '^ *#\[private\]' → Sensitive fields explicit
[ ] grep -n 'Nullifier\|commit' → Nullifier events present
[ ] grep -n 'emit\|send' → External calls only after state

Manual Checks:
[ ] Owner = #[private] field, initialized once
[ ] All arithmetic = checked_add/sub or explicit bounds check
[ ] Balance updates BEFORE emit/transfer calls
[ ] No note can be spent twice (nullifier tracking)
[ ] Every shielded spend has NullifierSpent event
[ ] Fresh notes = wait 1 L1 confirmation before spend
[ ] Assertions guard every state-changing fn
[ ] Merkle root race condition documented / handled

Result:
□ PASS → Deploy
□ FAIL → Fix item, re-run script, return here
```

## Common Issues: Quick Reference

| Symptom | Diagnosis | Fix |
|---------|-----------|-----|
| "Double spend" reorg | Nullifier already spent | Check NullifierSpent events; never reuse |
| Deploy fails with owner = null | `new()` not setting field | Add `owner: initial_owner` in struct init |
| Silent arithmetic bug | Subtraction wraps silently | Use `checked_sub` or `if balance < amount { return false }` |
| Frontend calls private fn | Contract exposes pub fn no guard | Add `assert(caller == owner)` |
| Merkle root mismatch at spend | Indexer not updated yet | Wait 1 confirmation or use `mint_and_send` |
