# Security Checklist for Midnight dApps Before Deployment

> **Audience:** Developers building and deploying dApps on Midnight Network  
> **Prerequisites:** Basic knowledge of Compact smart contract language and the Midnight development stack  
> **Reading time:** 20 minutes  
> **Associated code:** [vulnerable-patterns.compact](./contracts/vulnerable-patterns.compact) · [secure-patterns.compact](./contracts/secure-patterns.compact) · [witnesses.ts](./src/witnesses.ts)

---

## Table of Contents

1. [Why a Security Checklist?](#why-a-security-checklist)
2. [Check 1: `disclose()` Audit — No Secret Leaks](#check-1-disclose-audit--no-secret-leaks)
3. [Check 2: `ownPublicKey()` Usage Review](#check-2-ownpublickey-usage-review)
4. [Check 3: Replay Protection — Nonces or Nullifiers](#check-3-replay-protection--nonces-or-nullifiers)
5. [Check 4: Exported Ledger Field Review](#check-4-exported-ledger-field-review)
6. [Check 5: Witness Implementation Correctness](#check-5-witness-implementation-correctness)
7. [Check 6: Version Compatibility Confirmation](#check-6-version-compatibility-confirmation)
8. [Check 7: Proof Generation Testing on Testnet](#check-7-proof-generation-testing-on-testnet)
9. [Complete Pre-Deployment Runbook](#complete-pre-deployment-runbook)

---

## Why a Security Checklist?

Midnight's privacy model is fundamentally different from public blockchains. On Ethereum, everything is visible by default — you have to actively hide data. On Midnight, everything is private by default — you have to **deliberately disclose** what you want public.

This inversion of the security model creates a new class of vulnerabilities:

- **Accidental disclosure:** Using `disclose()` where a private value should remain hidden
- **Authentication bypass:** Trusting `ownPublicKey()` as an access control mechanism
- **Replay attacks:** Missing nullifier or nonce checks on spend operations
- **State leaks:** Exporting ledger fields that reveal private information

Each bug in this category can be catastrophic. A leaked secret key means total loss of control. A missing nullifier check means funds can be drained via replay. A misused `ownPublicKey()` means anyone can impersonate any user.

This checklist gives you seven concrete checks to run before deployment. Run them in order. Each check has a code example, a test scenario, and a fix.

The accompanying [vulnerable-patterns.compact](./contracts/vulnerable-patterns.compact) contract shows all the anti-patterns in one file — use it as a training tool. The [secure-patterns.compact](./contracts/secure-patterns.compact) contract shows the fixed versions.

---

## Check 1: `disclose()` Audit — No Secret Leaks

### Why It Matters

The `disclose()` function in Compact puts a value on the public ledger. Once disclosed, it's visible to everyone, forever. Unlike a local variable that disappears after the transaction, a disclosed value is permanently recorded.

### Anti-Pattern: Early Disclosure

Consider this vulnerable pattern:

```compact
witness secretKey(): Bytes<32>;

export circuit vulnerableStore(flag: Boolean): [] {
    const secret = disclose(getSecret());
    // If flag is false, secret is still visible on ledger
    storedValue = disclose(flag) ? secret : disclose(pad(32, "default"));
}
```

The problem: `secret` is **always disclosed**, even when `flag` is false. The subsequent conditional only changes what gets stored in `storedValue` — but the secret is already on the ledger from the first `disclose()` call. There's no "undo" for a disclose.

### Audit Checklist

Ask these questions for every `disclose()` call in your contract:

| Question | Why |
|----------|-----|
| Does this value need to be public? | If it's private data (wallet address, balance, secret), it shouldn't be disclosed |
| Is the disclosure conditional? | If disclosed inside a branch, verify the branch condition is correct |
| Is the disclosure before any validation? | If disclosed before an `assert()`, the data is already leaked even if the tx reverts |
| Could this be a witness instead? | Witness data stays private — use witnesses for values only the circuit needs |

### Fix Pattern

Restructure the code so disclosure only happens after all validation and only for values that genuinely need to be public:

```compact
export circuit secureStore(flag: Boolean): [] {
    const _secret = getSecret();
    // Only disclose if needed, and only after validation
    storedValue = flag ? disclose(pad(32, "default")) : pad(32, "");
}
```

---

## Check 2: `ownPublicKey()` Usage Review

### Why It Matters

This is the most common vulnerability in Midnight dApps. `ownPublicKey()` is a **witness function**. It returns whatever the user's frontend provides — it is NOT a cryptographic primitive that verifies the caller's identity.

### The Vulnerability

```compact
// ❌ VULNERABLE: Using ownPublicKey() for authentication
export circuit vulnerableWithdraw(amount: Uint<64>): [] {
    const caller = ownPublicKey();
    assert(caller == authority, "Unauthorized");
    balance = disclose(balance - amount);
}
```

An attacker can call `vulnerableWithdraw` from their own frontend and pass ANY value as `ownPublicKey()`. The `assert()` passes because the attacker's witness returns the `authority` value. The result: funds are drained.

### Why Developers Make This Mistake

In public blockchains, `msg.sender` is a reliable source of truth provided by the protocol. Midnight's `ownPublicKey()` looks similar but is fundamentally different — it's a **user-provided** value, not a protocol-enforced one. A developer migrating from Solidity will naturally reach for `ownPublicKey()` as the equivalent of `msg.sender`, which is exactly the wrong thing to do.

### Secure Alternative: Hash-Based Authentication

Instead of trusting `ownPublicKey()`, derive the public key from the user's actual private key using a hash-based circuit:

```compact
circuit publicKey(_sk: Bytes<32>): Bytes<32> {
    return persistentHash<Vector<2, Bytes<32>>>([
        pad(32, "midnight:auth:pk"),
        _sk
    ]);
}

export circuit authenticate(): [] {
    const _sk = secretKey();
    const pk = publicKey(_sk);
    authority = disclose(pk);
}
```

The user must know their `secretKey` (a private value) to derive the matching `publicKey`. A witness provides the secret key, the circuit derives the public key and compares it against the stored authority. Since the secret key is never disclosed, only someone who actually knows it can produce a valid authentication.

### Authentication Checklist

| Pattern | Security Level | Notes |
|---------|---------------|-------|
| `ownPublicKey()` | ❌ Unsafe | User-provided witness value, can be forged |
| `publicKey(_sk)` derived from private key | ✅ Secure | Cryptographic derivation, secret never leaves witness |
| `persistentHash()` of a shared secret | ⚠️ Moderate | Only if the shared secret is properly established |
| No authentication | ❌ Unsafe | Anyone can call the circuit |

---

## Check 3: Replay Protection — Nonces or Nullifiers

### Why It Matters

On a public blockchain like Ethereum, the protocol tracks each account's nonce, preventing transaction replay. On Midnight, because privacy hides the caller's identity, the ledger cannot maintain per-account nonces. Instead, your **contract must implement its own replay protection**.

### Anti-Pattern: Missing Replay Protection

```compact
export circuit vulnerableSpend(amount: Uint<64>): [] {
    // ❌ No nullifier or nonce check!
    // An attacker can replay this transaction multiple times
    balance = disclose(balance - amount);
}
```

This circuit spends from the contract's balance with no tracking of whether the spend has already been processed. An observer who sees a valid transaction on-chain can extract the proof and resubmit it, draining the contract.

### Solution 1: Nullifier-Based Protection

Nullifiers are the standard approach for zero-knowledge systems. Each spend operation produces a unique nullifier derived from the user's private key. Once a nullifier is recorded on the ledger, it can never be used again:

```compact
export ledger usedNullifiers: Set<Bytes<32>>;

circuit nullifier(sk: Bytes<32>): Bytes<32> {
    return persistentHash<Vector<2, Bytes<32>>>([
        pad(32, "nullifier-domain"),
        sk
    ]);
}

export circuit spend(amount: Uint<64>): [] {
    const _sk = secretKey();
    const pk = publicKey(_sk);
    assert(disclose(pk) == authority, "Authorization failed");

    const balance = getBalance();
    assert(balance >= amount, "Insufficient balance");

    const nul = nullifier(_sk);
    assert(!usedNullifiers.member(nul), "Already spent");
    usedNullifiers.insert(disclose(nul));

    const rand = getCommitmentRand();
    balanceCommitment = persistentCommit(balance - amount, rand);
}
```

Key points:
- The nullifier is derived from the private key, which only the legitimate user knows
- `usedNullifiers` is a public ledger set — entries are visible but cannot be removed
- Each private key can only produce one nullifier per domain prefix
- The domain prefix (`"nullifier-domain"`) prevents cross-protocol replay

### Solution 2: Nonce-Based Protection

Nonces are simpler but require the caller to maintain and track a counter:

```compact
export ledger nonce: Uint<64>;

export circuit incrementNonce(): [] {
    const _sk = secretKey();
    const pk = publicKey(_sk);
    assert(disclose(pk) == authority, "Authorization failed");
    nonce = disclose(nonce + 1);
}
```

Nonces are monotonically increasing — each transaction must use a higher nonce than the previous one. This is simpler to implement but requires the caller to track their current nonce, which adds complexity for multi-device or multi-wallet setups.

### Which One to Use

| Approach | Pros | Cons | Best For |
|----------|------|------|----------|
| Nullifier | Privacy-preserving, no state tracking needed | Slightly more complex circuit | Spend/transfer operations |
| Nonce | Simple circuit, lower gas | Caller must track nonce | Admin operations, one-per-user actions |
| Both | Defense in depth | More ledger state | High-value contracts |

---

## Check 4: Exported Ledger Field Review

### Why It Matters

Every `export ledger` field in your Compact contract becomes a permanent, publicly readable value on the Midnight blockchain. Even if the data appears to be "just a hash" or "just a commitment," it can still leak information.

### Data You Should Never Export

```compact
// ❌ DANGEROUS: Exporting raw values
export ledger rawBalance: Uint<64>;           // Reveals exact balance
export ledger userAddress: Bytes<32>;          // Links identity to contract
export ledger lastActivity: Uint<64>;          // Reveals user behavior patterns
export ledger secretHash: Bytes<32>;           // Hash of secret (vulnerable to rainbow tables)
```

### Safe Export Patterns

```compact
// ✅ SAFE: Commitment-based balance
export ledger balanceCommitment: Bytes<32>;

// The balance is only revealed via the commitment + randomness.
// An observer cannot determine the actual balance from the commitment alone.

// ✅ SAFE: Set of spent nullifiers (required for protocol operation)
export ledger usedNullifiers: Set<Bytes<32>>;

// Nullifiers are inherently one-way — knowing a nullifier doesn't reveal
// who spent it or what they spent.

// ✅ SAFE: Sealed immutable fields
sealed export ledger contractVersion: Uint<32>;

// Sealed fields are set in the constructor and never change.
```

### Field Review Checklist

For each `export ledger` field, ask:

1. **Does this field need to be public?** If only the contract needs it internally, consider a private variable (no `export`).
2. **Could this field be a commitment?** Commitments hide the actual value while still allowing verification.
3. **Does this field enable front-running?** If the field reveals pending actions, an attacker could front-run.
4. **Does this field create a linkability vector?** If the field can be correlated with off-chain data, it weakens privacy.

---

## Check 5: Witness Implementation Correctness

### Why It Matters

Witnesses are the bridge between your TypeScript frontend and your Compact contract. They provide the private inputs that the circuit needs. A bug in witness code can:
- Return incorrect data without the circuit detecting it
- Leak private data through side channels
- Break the contract's security guarantees

### Witness Architecture

```typescript
interface PrivateState {
    secretKey: Uint8Array;
    balance: bigint;
    commitmentRand: Uint8Array;
}

export const witnesses = {
    secretKey: ({ privateState }: WitnessContext<Ledger, PrivateState>) => {
        return [privateState, privateState.secretKey];
    },

    getBalance: ({ privateState }: WitnessContext<Ledger, PrivateState>) => {
        return [privateState, privateState.balance];
    },

    getCommitmentRand: ({ privateState }: WitnessContext<Ledger, PrivateState>) => {
        return [privateState, privateState.commitmentRand];
    },
};
```

Each witness function receives the current `privateState` and `ledger` and returns `[newPrivateState, value]`. The first element is the updated private state (can be the same if no mutation is needed).

### Common Witness Bugs

| Bug | Symptom | Fix |
|-----|---------|-----|
| Returning wrong public key | Authorization fails for legitimate user | Verify public key derivation matches the contract |
| Not validating witness bounds | Underflow/overflow in contract | Add `assert()` checks in the contract |
| Returning stale state (replay) | Same witness value used across txs | Include nonce/nullifier in witness derivation |
| Missing `newPrivateState` return | State updates lost | Always return `[newPrivateState, value]` |
| Hardcoded values in witness | Contract behaves unexpectedly for different users | Use actual private state data |

### Witness Testing Strategy

```typescript
// Test that witnesses return correct values
describe('witnesses', () => {
    it('returns the correct secret key', () => {
        const sk = new Uint8Array(32).fill(42);
        const result = witnesses.secretKey({
            privateState: { secretKey: sk, balance: 100n, commitmentRand: new Uint8Array(32) },
            ledger: { /* mock ledger state */ }
        });
        expect(result[1]).toEqual(sk);
    });

    it('validates balance bounds', () => {
        // This should fail in the contract, but the witness
        // should still return the raw value for the circuit to check
        const result = witnesses.getBalance({
            privateState: { secretKey: new Uint8Array(32), balance: 0n, commitmentRand: new Uint8Array(32) },
            ledger: { /* mock */ }
        });
        expect(result[1]).toBe(0n);
    });
});
```

---

## Check 6: Version Compatibility Confirmation

### Why It Matters

Midnight is an active development ecosystem. SDK versions, node versions, and protocol parameters change frequently. Deploying a contract compiled with an older SDK against a newer node — or vice versa — can cause subtle bugs, transaction rejections (error 1010/139), or even security issues.

### Version Check Matrix

Check these three versions **before every deployment**:

| Component | How to Check | Why It Matters |
|-----------|-------------|----------------|
| `@midnight-ntwrk/compact` | `npm list @midnight-ntwrk/compact` | Compiler version affects contract bytecode |
| `@midnight-ntwrk/midnight-js-ledger` | `npm list @midnight-ntwrk/midnight-js-ledger` | Transaction builder API changes |
| Target node | `curl <node-url>/api/version` | Node protocol version |

### Automated Version Check

```bash
#!/bin/bash
# pre-deploy-check.sh — Run before every deployment

echo "=== SDK Versions ==="
npm list @midnight-ntwrk/compact --depth=0 2>/dev/null | tail -1
npm list @midnight-ntwrk/midnight-js-ledger --depth=0 2>/dev/null | tail -1

echo ""
echo "=== Testnet Node Version ==="
curl -s https://testnet.midnight.network/api/version 2>/dev/null || echo "Cannot reach testnet"

echo ""
echo "=== Local Node Version (if running) ==="
curl -s http://localhost:9944/api/version 2>/dev/null || echo "Local node not detected"
```

### Contract-Level Version Check

Your contract can enforce version compatibility at the protocol level using sealed fields:

```compact
sealed export ledger contractVersion: Uint<32>;

constructor(version: Uint<32>) {
    contractVersion = version;
}

export circuit checkVersion(expected: Uint<32>): [] {
    assert(contractVersion == expected, "Version mismatch");
}
```

This ensures that frontend code must know the correct contract version to interact with it. Version bumps invalidate all previous frontends, forcing users to upgrade.

---

## Check 7: Proof Generation Testing on Testnet

### Why It Matters

The final check before mainnet deployment is a complete end-to-end proof generation and submission flow on testnet. Unit tests and local simulation catch most bugs, but they don't test against the actual proof server, indexer, and node.

### Testnet Test Plan

#### Phase 1: Local Proof Generation

```bash
# Start local services
midnight-node --dev &
midnight-indexer --node-url http://localhost:9944 &

# Deploy contract
npm run deploy:local

# Run all contract operations
npm run test:e2e

# Check for errors in node logs
tail -f /tmp/midnight-node.log | grep ERROR
```

Verify:
- [ ] Contract deploys successfully with correct constructor
- [ ] Each contract circuit produces a valid proof
- [ ] No `disclose()` audit failures
- [ ] Authentication circuits work for legitimate users
- [ ] Authentication circuits reject unauthorized users

#### Phase 2: Testnet Deployment

```bash
# Switch to testnet config
export MIDNIGHT_NETWORK=testnet

# Deploy
npm run deploy:testnet

# Wait for confirmation (testnet blocks every ~6 seconds)
sleep 30

# Verify deployment on explorer
echo "Check: https://explorer.midnight.network/contracts/<your-contract-address>"
```

Verify:
- [ ] Contract appears on the testnet explorer
- [ ] Transaction history shows accurate state transitions
- [ ] Query functions return expected values
- [ ] Error recovery works (re-submit after temporary failure)

#### Phase 3: Wallet Integration

```typescript
// Test wallet connection and transaction signing
const wallet = await connectWallet();
const contract = await midnight.contract(deployedAddress);

// Test a complete flow: deploy → fund → spend → verify
const tx = await contract.spend(100n, wallet);
const receipt = await tx.wait();

console.log('Spend completed:', {
    txId: receipt.transactionId,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
});
```

Verify:
- [ ] Wallet correctly signs transactions
- [ ] DUST balance is sufficient for gas
- [ ] Transaction appears in wallet history
- [ ] Reverted transactions return meaningful errors

### Proof Server-Specific Checks

| Check | Test | Expected |
|-------|------|----------|
| Proof generation time | `time midnight proof generate` | < 30 seconds for typical contract |
| Proof size | `ls -lh proof.bin` | < 100 KB |
| Proof verification | `midnight proof verify proof.bin` | `Verified: true` |
| Offline proof generation | Disconnect network, run circuit | Succeeds (no network dependency) |

---

## Complete Pre-Deployment Runbook

Run these checks in order before every mainnet deployment:

```
□ 1. disclose() Audit
   - Search for every disclose() call in your contract
   - Verify each disclosed value should be public
   - Check no disclose happens before validation

□ 2. ownPublicKey() Review
   - Locate every ownPublicKey() call
   - Replace with hash-based authentication (publicKey from secretKey)
   - Test with a forked frontend to confirm bypass is impossible

□ 3. Replay Protection
   - Add nullifiers for all spend operations
   - Verify nullifier derivation uses domain prefix
   - Test double-spend is rejected

□ 4. Ledger Field Review
   - Review every export ledger field
   - Replace raw values with commitments where possible
   - Verify no linkability vectors exist

□ 5. Witness Correctness
   - Review all witness implementations
   - Verify return values match contract expectations
   - Test with edge cases (zero values, max values)

□ 6. Version Compatibility
   - Check SDK versions against testnet node
   - Verify contract sealed version matches frontend
   - Run pre-deploy-check.sh

□ 7. Testnet Proof Testing
   - Phase 1: Local proof generation
   - Phase 2: Testnet deployment
   - Phase 3: Wallet integration
   - Verify proof generation time and size
```

### Emergency Kit

Before deployment, prepare a `CANCEL.md` in your repository with:

```bash
# Emergency contract freeze (if supported)
midnight contract freeze <contract-address>

# Emergency key rotation
midnight wallet rotate-keys

# Contact Midnight team
echo "Email: security@midnight.network"
echo "Discord: #security channel on Midnight Discord"
```

---

## Further Resources

- [Midnight Documentation — Security Best Practices](https://docs.midnight.network/security)
- [Compact Language Reference](https://docs.midnight.network/compact/language-reference)
- [Midnight Developer Forum — Security Tag](https://forum.midnight.network/tag/security)
- [midnight-mcp](https://www.npmjs.com/package/midnight-mcp) — AI-assisted contract security auditing
- [Midnight Discord #security Channel](https://discord.com/invite/midnightnetwork)

---

*Published for the Midnight Network developer community. Tested against midnight-ledger v3.x and testnet node v0.8+. Accompanying code samples in this tutorial's repo directory. Found an error? Submit a PR to keep this guide current.*
