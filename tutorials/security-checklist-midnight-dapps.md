# Security Checklist for Midnight dApps Before Deployment

A comprehensive pre-deployment security review guide for developers building privacy-preserving dApps on the Midnight network. This checklist covers the critical audit points, common vulnerabilities, and testing strategies that every team should run through before pushing to mainnet.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Pre-Deployment Security Review Checklist](#pre-deployment-security-review-checklist)
3. [disclose() Audit: Preventing Secret Leaks](#disclose-audit-preventing-secret-leaks)
4. [ownPublicKey() Usage Review](#ownpublickey-usage-review)
5. [Replay Protection Verification](#replay-protection-verification)
6. [Exported Ledger Field Review](#exported-ledger-field-review)
7. [Witness Implementation Correctness](#witness-implementation-correctness)
8. [Version Compatibility Confirmation](#version-compatibility-confirmation)
9. [Private Key Management](#private-key-management)
10. [Proof Verification Edge Cases](#proof-verification-edge-cases)
11. [Network Security and Node Configuration](#network-security-and-node-configuration)
12. [Common Vulnerabilities in Privacy dApps](#common-vulnerabilities-in-privacy-dapps)
13. [Testing Strategies for Shielded Operations](#testing-strategies-for-shielded-operations)
14. [Proof Generation Testing on Testnet](#proof-generation-testing-on-testnet)
15. [Conclusion](#conclusion)

---

## Introduction

Midnight enables developers to build dApps where sensitive data remains private by default, using zero-knowledge proofs (ZKPs) to verify state transitions without revealing underlying information. This privacy-first architecture introduces a distinct threat surface that traditional smart contract audits may not fully address.

A typical Midnight dApp involves Compact contracts that define private state transitions, witness functions that generate proofs, and ledger operations that interact with the public blockchain layer. A security failure at any of these layers can leak user secrets, enable unauthorized state changes, or allow double-spending of shielded assets.

This tutorial provides a structured, item-by-item checklist that you can work through before deploying. Each section includes specific code patterns to look for, anti-patterns to avoid, and concrete tests to write.

---

## Pre-Deployment Security Review Checklist

Run through every item on this list before mainnet deployment. Document your findings for each.

| # | Check | Category | Criticality |
|---|-------|----------|-------------|
| 1 | All `disclose()` calls reviewed for secret leakage | Circuit Audit | Critical |
| 2 | `ownPublicKey()` not used in publicly observable contexts | Key Management | Critical |
| 3 | Replay protection via nonces or nullifiers enforced | Transaction Integrity | Critical |
| 4 | Exported ledger fields contain no sensitive data | Data Exposure | High |
| 5 | Witness functions produce deterministic outputs | Proof Generation | High |
| 6 | Compact compiler and runtime versions pinned and verified | Supply Chain | High |
| 7 | Private keys never logged, stored in plaintext, or transmitted insecurely | Key Management | Critical |
| 8 | Edge-case proof generation tested on testnet | Integration | Medium |
| 9 | Node configuration hardened against surveillance | Network | Medium |
| 10 | Shielded operation test coverage ≥ 90% | Testing | High |

---

## disclose() Audit: Preventing Secret Leaks

The `disclose()` function in a Compact contract determines which values become visible on the public ledger after a state transition. This is the single most critical audit point in any Midnight dApp, because an incorrect disclosure can permanently expose user secrets on-chain.

### What to Look For

Every `disclose()` call in your contract should be examined for two properties:

1. **Completeness**: Does it disclose everything that *should* be public?
2. **Minimality**: Does it disclose *only* what should be public?

### Anti-Pattern: Accidental Secret Disclosure

```compact
// DANGEROUS: Disclosure includes a secret value
disclose!(
  ledger,
  new_balance,    // intended public field
  secret_seed     // ACCIDENTAL: this is a private input
);
```

The above pattern leaks `secret_seed` to the public ledger, where it is visible forever. Always cross-reference every field passed to `disclose()` against your data classification.

### Correct Pattern

```compact
// SAFE: Only public-facing fields are disclosed
disclose!(
  ledger,
  new_balance,
  commitment_root
);
```

### Audit Steps

1. List every `disclose()` call in your contract.
2. For each call, enumerate every parameter.
3. For each parameter, verify it is intentionally public by checking your data flow diagram.
4. Confirm that no private input (secret keys, seeds, personal data) appears in any disclosure.

---

## ownPublicKey() Usage Review

The `ownPublicKey()` function retrieves the public key associated with the current transaction's author. It has a known vulnerability pattern: if the result is used in a way that is observable by other parties, it can enable targeted privacy attacks.

### Vulnerable Pattern

```compact
// VULNERABLE: Public key used in a publicly observable comparison
fn transfer(amount: Value, recipient: PublicKey) {
  let sender = ownPublicKey();
  // If this comparison result is disclosed, observers can link
  // transactions to the same sender across contexts
  if sender == known_address {
    // privileged action
  }
}
```

### Safe Pattern

```compact
// SAFE: Public key used only within the proof circuit
fn transfer(amount: Value, recipient: PublicKey) {
  let sender = ownPublicKey();
  // The sender is used internally to verify authorization
  // without the comparison result being disclosed
  assert(sender != null);
}
```

### Audit Steps

1. Search for all calls to `ownPublicKey()` across your contract.
2. Trace how the returned value is used downstream.
3. Ensure the value or any derivative of it is never passed to `disclose()`.
4. Verify that branching on `ownPublicKey()` does not create observable side effects in the disclosed output.

---

## Replay Protection Verification

Without proper replay protection, an attacker who observes a valid transaction can resubmit it, causing unintended state changes. Midnight provides two primary mechanisms for replay protection: **nonces** and **nullifiers**.

### Nonce-Based Protection

Nonces ensure that each transaction from a given account can only be processed once in a specific order.

```compact
fn shielded_transfer(
  sender: PublicKey,
  recipient: PublicKey,
  amount: Value,
  nonce: u64
) {
  // Verify the nonce matches expected sequence
  assert(nonce == expected_nonce(sender));
  // Consume the nonce to prevent replay
  consume_nonce(sender, nonce);
  // ... rest of transfer logic
}
```

### Nullifier-Based Protection

Nullifiers are hash-based one-time-use tags derived from private state. Once a nullifier appears on-chain, the corresponding state is consumed and cannot be reused.

```compact
fn spend_note(nullifier: Nullifier, proof: Proof) {
  // Check that this nullifier has not been used before
  assert(!is_nullifier_spent(nullifier));
  // Mark it as spent
  mark_nullifier_spent(nullifier);
  // ... continue with spend logic
}
```

### Audit Steps

1. Identify every state-transition function in your contract.
2. For each function, verify that either a nonce or nullifier mechanism prevents replay.
3. Test replay protection by attempting to submit the same transaction twice in your test suite.
4. Verify nullifier uniqueness across all contract paths, including error paths.

---

## Exported Ledger Field Review

Exported ledger fields are the persistent on-chain state of your contract. Any data stored here is publicly readable by anyone, even if it was not explicitly disclosed through `disclose()`.

### What to Audit

```compact
ledger {
  // These fields are PUBLIC - anyone can read them
  public_balance: map<Address, Value>,
  commitment_root: Hash,
  // DANGEROUS if this stores private data
  user_data: map<Address, UserData>,
}
```

For each field in your ledger:

1. **Classify the data**: Is it inherently public, or does it contain derived private information?
2. **Check for inference attacks**: Can an observer combine multiple public fields to reconstruct private data?
3. **Verify access patterns**: Ensure read access to ledger fields does not leak timing information.

### Anti-Pattern: Inference Vulnerability

```compact
// DANGEROUS: Sequential balances reveal transaction amounts
ledger {
  balance_history: map<Address, Vec<Value>>,
}
```

Even though individual values might seem innocuous, the sequence of balance changes can reveal transaction amounts, timing, and relationships between parties.

---

## Witness Implementation Correctness

Witness functions generate the inputs to zero-knowledge proofs. If a witness function is incorrect, the proof may pass verification but represent a logically invalid state transition.

### Key Properties to Verify

1. **Determinism**: Given the same inputs, the witness must always produce the same outputs.
2. **Completeness**: The witness must provide all values the circuit expects.
3. **Soundness**: The witness must not provide values that satisfy the circuit but represent impossible states.

### Example: Merkle Tree Witness

```typescript
async function buildMerkleWitness(
  tree: MerkleTree,
  leafIndex: number,
  leafValue: Field
): Promise<MerkleProof> {
  // The witness must prove that leafValue exists at leafIndex
  // in the tree with the known root
  const path = tree.getPath(leafIndex);
  
  // CRITICAL: Verify the witness is consistent
  const computedRoot = computeRoot(path, leafValue);
  assert(computedRoot === tree.root, "Witness does not match tree root");
  
  return {
    leaf: leafValue,
    path: path,
    index: leafIndex,
    root: tree.root
  };
}
```

### Audit Steps

1. Review each witness function for determinism (no randomness, no external state dependencies beyond explicit inputs).
2. Verify that witness outputs are validated against known state before being submitted.
3. Test that manipulated witness inputs (swapped paths, wrong indices) are rejected by the circuit.

---

## Version Compatibility Confirmation

Midnight's toolchain is evolving rapidly. Incompatible versions of the Compact compiler, the proof system, and the runtime can produce proofs that fail verification on-chain, or worse, proofs that pass verification but are unsound.

### What to Pin

```json
{
  "dependencies": {
    "@midnight-ntwrk/compact": "0.7.2",
    "@midnight-ntwrk/midnight-js": "0.2.15",
    "@midnight-ntwrk/zswap": "0.1.8"
  }
}
```

### Audit Steps

1. Record the exact version of every Midnight dependency in your lockfile.
2. Check the Midnight changelog for any breaking changes between your version and the latest stable release.
3. Verify that the Compact compiler version used to compile your contracts matches the version expected by the on-chain verifier.
4. Run your full test suite against the exact versions you plan to deploy with.
5. If upgrading, re-run the complete security checklist after the upgrade.

```bash
# Verify installed versions match your deployment spec
npx midnight-compact --version
cat package.json | jq '.dependencies | to_entries[] | select(.key | startswith("@midnight-ntwrk"))'
```

---

## Private Key Management

Private keys in a Midnight dApp control access to shielded assets and private state. Compromised keys cannot be rotated without migrating all associated state, making prevention paramount.

### Storage Best Practices

```typescript
// NEVER: Store keys in localStorage or plain config files
localStorage.setItem('privateKey', key); // INSECURE

// CORRECT: Use the browser's Web Crypto API for key storage
async function storeKeySecurely(key: CryptoKey): Promise<void> {
  await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'AES-GCM' },
    false,  // not extractable
    ['wrapKey', 'unwrapKey']
  );
}
```

For server-side key management:

```typescript
// Use environment-injected secrets with a hardware security module (HSM)
// or a managed key service, never hardcode
import { SecretManager } from '@google-cloud/secret-manager';

async function getSigningKey(): Promise<Buffer> {
  const client = new SecretManager();
  const [version] = await client.accessSecretVersion({
    name: 'projects/my-project/secrets/midnight-signing-key/versions/latest'
  });
  return version.payload.data;
}
```

### Key Management Checklist

- [ ] Private keys are never logged or included in error messages
- [ ] Keys are not stored in source code, environment files committed to git, or configuration files
- [ ] Key material is cleared from memory after use (zeroize buffers)
- [ ] Server-side keys are stored in an HSM or managed secret service
- [ ] Client-side keys use the platform's secure key storage (Web Crypto API, iOS Keychain, Android Keystore)
- [ ] Key derivation uses a strong KDF (Argon2id, PBKDF2 with ≥600,000 iterations) when deriving from user input

```typescript
// Zeroize sensitive buffers after use
function zeroize(buffer: Buffer): void {
  buffer.fill(0);
}

let signingKey = deriveKey(password);
// ... use signingKey for transaction ...
zeroize(signingKey); // Clear from memory
```

---

## Proof Verification Edge Cases

Zero-knowledge proof systems have edge cases where seemingly valid proofs can be crafted to pass verification while representing invalid state transitions. Testing these edge cases is essential before mainnet.

### Edge Case 1: Zero-Value Transfers

```typescript
// Test that zero-value transfers are handled correctly
it('should reject zero-value shielded transfers', async () => {
  const result = await submitTransfer({
    amount: 0,
    sender: alice,
    recipient: bob,
    nonce: 1n
  });
  expect(result.status).toBe('rejected');
});
```

### Edge Case 2: Overflow in Circuit Arithmetic

```typescript
// Test that arithmetic overflow is caught
it('should reject overflow amounts in merge operation', async () => {
  const maxPlusOne = BigInt('0xFFFFFFFFFFFFFFFF') + 1n;
  const result = await submitMerge({
    amount1: maxPlusOne,
    amount2: 1n
  });
  expect(result.status).toBe('rejected');
});
```

### Edge Case 3: Stale Merkle Proofs

```typescript
// Test that stale tree references are rejected
it('should reject proofs against outdated tree state', async () => {
  const oldWitness = await buildWitness(tree, leafIndex, leafValue);
  // Mutate the tree
  await tree.insert(randomLeaf());
  // Attempt to use old witness
  const result = await submitWithWitness(oldWitness);
  expect(result.status).toBe('rejected');
});
```

### Edge Case 4: Duplicate Nullifiers Across Contract Paths

```typescript
// Ensure nullifiers are globally unique, not just per-path
it('should reject nullifier reuse across different contract functions', async () => {
  const nullifier = deriveNullifier(note1);
  await spendWithNullifier(nullifier); // First spend succeeds
  const result = await mergeWithNullifier(nullifier); // Reuse should fail
  expect(result.status).toBe('rejected');
});
```

---

## Network Security and Node Configuration

Midnight nodes participate in the network and can be configured to expose varying amounts of information. A misconfigured node can leak transaction data, reveal IP addresses of transaction submitters, or expose internal APIs.

### Node Hardening Checklist

- [ ] Disable unnecessary API endpoints (only expose what your dApp needs)
- [ ] Enable TLS for all node communications
- [ ] Restrict RPC access to trusted IPs or require authentication
- [ ] Disable transaction broadcast logging or ensure logs do not contain transaction contents
- [ ] Use a reverse proxy (nginx, caddy) with rate limiting to protect against DoS
- [ ] Keep node software updated to the latest stable version
- [ ] Monitor node logs for unusual patterns (repeated failed proof verifications, unusual query volumes)

### Configuration Example

```toml
# midnight-node.conf
[rpc]
enabled = true
bind = "127.0.0.1"        # Only listen on localhost
port = 9奕0
cors_origins = ["https://your-dapp.com"]  # Restrict CORS

[p2p]
enabled = true
bind = "0.0.0.0"
port = 30333
max_peers = 50

[logging]
level = "warn"             # Reduce log verbosity in production
redact_transactions = true # Never log transaction details

[metrics]
enabled = true
bind = "127.0.0.1"        # Metrics should not be publicly accessible
port = 9615
```

### DApp-to-Node Communication

Your frontend should never communicate directly with an arbitrary public node for sensitive operations. Consider:

1. **Running your own node**: Ensures you control the data pipeline and logging.
2. **Using encrypted channels**: All communication between your dApp and node should use TLS.
3. **Minimizing data in requests**: Send only the minimum required data to the node.

---

## Common Vulnerabilities in Privacy dApps

### 1. Timing Attacks on Shielded Balances

Even if balance amounts are shielded, the timing of transactions can leak information. If a dApp always processes user actions immediately, an observer can correlate the timing of on-chain events with off-chain user actions.

**Mitigation**: Batch transactions with random delays, or use a mixer/tumbler pattern for high-value operations.

### 2. Linkage via Commitment Patterns

If a dApp creates commitments with predictable patterns (sequential nonces, fixed commitment values), an observer can link commitments to specific users or transactions.

**Mitigation**: Use randomized salts in commitment generation and ensure commitment structures are uniform across all users.

```typescript
// Generate commitments with unique randomness
function createCommitment(value: bigint, blinding: bigint): bigint {
  const salt = crypto.getRandomValues(new BigUint64Array(1))[0];
  return poseidonHash([value, blinding, BigInt(salt)]);
}
```

### 3. Metadata Leakage in Transaction Size

Different transaction types may have different sizes. An observer can distinguish between a simple transfer and a complex swap based on the transaction's byte size.

**Mitigation**: Pad transactions to uniform sizes, or standardize the number of inputs/outputs across all transaction types.

### 4. Front-Running on Public Inputs

Even in a privacy-focused dApp, some inputs may be public (e.g., the target of a swap). Front-running attacks can exploit these public inputs to profit at the user's expense.

**Mitigation**: Use commit-reveal schemes for any public-facing operations, or leverage Midnight's shielded state to keep the operation details private until finalization.

### 5. Incorrect State Serialization

If shielded state is serialized or deserialized incorrectly, private data may be included in public transaction payloads.

**Mitigation**: Use the Compact compiler's built-in serialization, which respects the privacy annotations. Never manually serialize shielded state.

---

## Testing Strategies for Shielded Operations

Testing privacy dApps requires specialized approaches beyond standard integration testing.

### Unit Testing Individual Circuit Components

```typescript
describe('Shielded Transfer Circuit', () => {
  it('should prove valid transfer between two parties', async () => {
    const circuit = loadCircuit('shielded_transfer');
    const witness = await buildTransferWitness({
      sender: alicePrivateKey,
      recipient: bobPublicKey,
      amount: 100n,
      nonce: 1n
    });
    const proof = await circuit.prove(witness);
    const verified = await circuit.verify(proof);
    expect(verified).toBe(true);
  });

  it('should reject proof with insufficient balance', async () => {
    const witness = await buildTransferWitness({
      sender: alicePrivateKey,
      recipient: bobPublicKey,
      amount: 999999n, // More than Alice has
      nonce: 2n
    });
    await expect(circuit.prove(witness)).rejects.toThrow('insufficient balance');
  });
});
```

### Property-Based Testing for Privacy Guarantees

```typescript
import * as fc from 'fast-check';

describe('Privacy Properties', () => {
  it('should produce indistinguishable proofs for equal-size transactions', () => {
    fc.assert(
      fc.property(
        fc.bigInt(1n, 1000000n),
        fc.bigInt(1n, 1000000n),
        (amountA, amountB) => {
          const proofA = generateProof(amountA, senderA, recipientA);
          const proofB = generateProof(amountB, senderB, recipientB);
          // Proof sizes should be identical regardless of amount
          expect(proofA.length).toBe(proofB.length);
          // Proof structure should not leak value information
          expect(proofA.publicInputs.length).toBe(proofB.publicInputs.length);
        }
      )
    );
  });
});
```

### Cross-Scenario Integration Testing

Test that transactions generated in one context cannot be replayed or correlated in another:

```typescript
describe('Cross-Scenario Privacy', () => {
  it('should prevent cross-contract nullifier collisions', async () => {
    const note = createNote(500n, alicePrivateKey);
    const nullifierA = deriveNullifier(note, contractA);
    const nullifierB = deriveNullifier(note, contractB);
    // Same note should produce different nullifiers for different contracts
    expect(nullifierA).not.toBe(nullifierB);
  });

  it('should not leak sender identity through gas patterns', async () => {
    const tx1 = await buildShieldedTx(alice, 100n);
    const tx2 = await buildShieldedTx(bob, 100n);
    // Gas costs should be identical for same-size operations
    expect(tx1.gasEstimate).toBe(tx2.gasEstimate);
  });
});
```

---

## Proof Generation Testing on Testnet

Before mainnet deployment, every proof generation path in your dApp must be tested against a live testnet. Local simulations do not catch issues that arise from network latency, node version differences, or testnet-specific constraints.

### Testnet Testing Checklist

- [ ] Submit proofs for every transaction type your dApp supports
- [ ] Verify proof acceptance rate is 100% for valid inputs
- [ ] Verify proof rejection rate is 100% for all known invalid inputs
- [ ] Measure proof generation time under realistic network conditions
- [ ] Test concurrent proof submissions to identify race conditions
- [ ] Verify that testnet state correctly reflects all post-transaction states
- [ ] Test failure recovery: what happens when a proof is rejected mid-flow?

### Automated Testnet Testing Script

```typescript
async function runTestnetSuite(): Promise<TestResults> {
  const results: TestResults = { passed: 0, failed: 0, errors: [] };

  const testCases = [
    { name: 'basic_transfer', fn: testBasicTransfer },
    { name: 'shielded_merge', fn: testShieldedMerge },
    { name: 'multi_party_swap', fn: testMultiPartySwap },
    { name: 'max_value_transfer', fn: testMaxValueTransfer },
    { name: 'concurrent_submissions', fn: testConcurrentSubmissions },
    { name: 'stale_proof_rejection', fn: testStaleProofRejection },
  ];

  for (const testCase of testCases) {
    try {
      console.log(`Running: ${testCase.name}`);
      await testCase.fn();
      results.passed++;
    } catch (error) {
      results.failed++;
      results.errors.push({
        test: testCase.name,
        error: (error as Error).message
      });
    }
  }

  console.log(`Results: ${results.passed} passed, ${results.failed} failed`);
  if (results.errors.length > 0) {
    console.error('Failures:', JSON.stringify(results.errors, null, 2));
  }

  return results;
}
```

---

## Conclusion

Deploying a privacy-preserving dApp on Midnight requires a security review that goes well beyond traditional smart contract audits. The zero-knowledge proof layer introduces unique risks around secret disclosure, proof soundness, and metadata leakage that must be explicitly addressed.

The checklist in this tutorial covers the seven critical areas identified by the Midnight team:

1. **`disclose()` audit** — ensuring no secrets leak to the public ledger
2. **`ownPublicKey()` review** — preventing linkage attacks through observable key usage
3. **Replay protection** — verifying nonces and nullifiers prevent transaction replay
4. **Ledger field review** — confirming exported state contains no sensitive or inferable data
5. **Witness correctness** — validating that proof inputs are deterministic and sound
6. **Version compatibility** — pinning and verifying all Midnight dependency versions
7. **Testnet proof testing** — exercising every proof path against live infrastructure

Treat this checklist as a minimum bar. For high-value dApps handling significant user funds, consider engaging a specialized ZK audit firm for an independent review. Security is not a one-time event—it is a continuous process that should be repeated with every contract update and Midnight toolchain upgrade.

---

*Built for the Midnight network. For questions and discussion, visit the [Midnight Developer Forum](https://forum.midnight.network/) or join the [Midnight Discord](https://discord.com/invite/midnightnetwork).*
