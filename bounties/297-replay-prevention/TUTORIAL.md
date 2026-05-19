# Replay Attack Prevention in Compact: A Developer's Guide

## Introduction

When you build a decentralized application on Midnight, one of the first and most critical security concerns you'll encounter is the **replay attack**: the risk that a valid transaction gets maliciously or accidentally resubmitted, causing the same action to execute multiple times.

On traditional blockchains like Ethereum, replay attacks are partially mitigated by per-transaction nonces. If you sign a transaction with nonce 5, the network only accepts it once with that nonce — any attempt to replay it fails because nonce 5 is already consumed.

Midnight's **Compact** language powers smart contracts on the Midnight blockchain, and its approach to replay protection is fundamentally different. Compact uses a **nullifier-based system** combined with **domain separation** and **ephemeral nonces** to prevent replay attacks at the contract level.

This guide walks you through the complete replay attack prevention architecture in Compact, from understanding the threat model to implementing a production-ready solution.

## The Threat Model

Before diving into solutions, let's precisely define what we're protecting against:

### Types of Replay Attacks

**1. Transaction Replay (On-Chain)**
The same signed transaction is submitted to the network multiple times. Classic example: Alice transfers 100 tokens to Bob. The transaction is included in block #1000. An attacker watches the mempool and re-submits the same transaction.

Mitigation: Nonce-based ordering (Ethereum model)

**2. Signature Replay (Cross-Chain)**
A valid signature from one chain (e.g., mainnet) is reused on another chain (e.g., testnet or a forked chain).

Mitigation: Domain separation (chain ID, network ID embedded in signed data)

**3. Call Replay (Smart Contract)**
A function call that includes a cryptographic proof (zK proof) is submitted multiple times. The proof is valid, but the state has already changed.

Mitigation: Nullifiers (each action generates a unique nullifier that can only be used once)

**4. Proof Replay (Private Computation)**
A Zero-Knowledge proof that verifies certain private state is replayed. The proof was valid when created but is now invalid due to state changes.

Mitigation: Nullifiers + freshness checks

### Why Midnight/Compact is Different

Midnight uses **selective disclosure** — private data is never fully revealed on-chain. Instead, zero-knowledge proofs (zkSNARKs) demonstrate that a transaction is valid without revealing the underlying data.

This creates a unique replay challenge:
- Traditional nonce-based systems don't work because the proving key / verification key interactions need special handling
- The **nullifier** is the primary mechanism: each valid action emits a unique nullifier that the contract stores
- The contract rejects any subsequent action that would emit the same nullifier

## Architecture Overview

A well-designed replay-resistant Compact contract typically has these components:

```
┌─────────────────────────────────────────────────────────┐
│                    Application Contract                  │
├─────────────────────────────────────────────────────────┤
│  Nullifier Registry (implicit, via contract state)       │
│  ┌──────────────────────────────────────────────────┐  │
│  │ nullifiers: Map<field, bool>                      │  │
│  │ "Has this action already been executed?"          │  │
│  └──────────────────────────────────────────────────┘  │
│                                                          │
│  Action Registry (what specific actions are protected)   │
│  ┌──────────────────────────────────────────────────┐  │
│  │ actions: Map<action_id, field>                   │  │
│  │ "What was the last action state?"                │  │
│  └──────────────────────────────────────────────────┘  │
│                                                          │
│  Domain Registry (cross-domain protection)              │
│  ┌──────────────────────────────────────────────────┐  │
│  │ domains: Set<domain_tag>                         │  │
│  │ "Only accept actions with this domain tag"      │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Component 1: Nullifiers

A **nullifier** is a unique field element derived from private data plus a secret. It's designed so that:
1. Anyone can verify it was correctly computed from known inputs
2. No one can determine the original private data from the nullifier alone
3. The same action always produces the same nullifier (deterministic)
4. Different actions produce different nullifiers (collision-resistant)

### Nullifier Construction

The standard nullifier formula in Compact/Midnight is:

```compact
// In your contract's action function
const nullifier = poseidon_hash(
    secret_key,      // The user's private key (never revealed)
    action_id,       // Unique identifier for this action type
    nonce,           // Ephemeral nonce (changes each time)
    chain_id         // Domain separator (chain identifier)
);
```

Let's break this down:

| Component | Purpose | Example |
|-----------|---------|---------|
| `secret_key` | User's private key | Ensures only the owner can generate valid nullifiers |
| `action_id` | Action type identifier | Prevents cross-action replay (e.g., a "withdraw" nullifier can't be used for "stake") |
| `nonce` | Freshness | Ensures each action is unique even with same parameters |
| `chain_id` | Domain separation | Prevents cross-chain replay |

### Nullifier Storage and Check

In your Compact contract:

```compact
// Pseudocode for a protected action
function protected_action(
    proof: ZKProof,
    action_id: Field,
    nonce: Field,
    expected_nullifier: Field
) {
    // 1. Verify the proof (proves knowledge of secret_key)
    verify_proof(proof, action_id, nonce, expected_nullifier);

    // 2. Check nullifier hasn't been used
    const is_new = !state.nullifiers.contains(expected_nullifier);
    require(is_new, "ACTION_ALREADY_EXECUTED");

    // 3. Record the nullifier (permanent)
    state.nullifiers.insert(expected_nullifier, true);

    // 4. Execute the action
    execute_action();
}
```

### Why Not Just Use Nonces?

Nonces alone aren't sufficient in Midnight because:

1. **Proving context**: The ZK proof must attest to the nonce value. If the nonce is wrong, the proof fails — but this requires careful implementation
2. **Privacy leakage**: Sequential nonces reveal transaction ordering and user activity patterns
3. **Replay in the proving layer**: A ZK proof for action with nonce=5 could potentially be reused

Nullifiers solve all three: they're opaque (privacy-preserving), unique per action, and checked on-chain.

## Component 2: Domain Separation

**Domain separation** ensures that cryptographic material (signatures, hashes, proofs) created in one context cannot be used in another.

### Chain ID Domain Separation

Every Midnight chain has a unique identifier:

```compact
const MAINNET_CHAIN_ID = 0x4d49444e;  // "MIDN" in hex
const TESTNET_CHAIN_ID = 0x4d4e5453;  // "MNTS" in hex

function verify_domain(proof: ZKProof, expected_chain_id: Field) {
    const actual_chain_id = runtime::chain_id();
    require(actual_chain_id == expected_chain_id, "WRONG_CHAIN");
    verify_proof_with_domain(proof, expected_chain_id);
}
```

### Application-Level Domain Separation

Within your application, use domain tags:

```compact
const DOMAIN_WITHDRAWAL = poseidon_hash("WITHDRAWAL_V1");
const DOMAIN_STAKING    = poseidon_hash("STAKING_V1");
const DOMAIN_TRANSFER   = poseidon_hash("TRANSFER_V1");

function compute_nullifier(
    secret: Field,
    action_id: Field,
    nonce: Field,
    domain: Field
) -> Field {
    return poseidon_hash(secret, action_id, nonce, domain);
}
```

This prevents a nullifier from one domain (e.g., a staking action) from being valid in another domain (e.g., a withdrawal).

## Component 3: Ephemeral Nonces

The **nonce** provides action-level uniqueness. Each time a user performs an action, they generate a fresh nonce.

### Nonce Management

Users must track their own nonce locally. On Midnight, this is typically managed by the wallet SDK:

```typescript
// Wallet SDK example
class Wallet {
    private currentNonce: bigint;

    async signAction(action: Action): Promise<Proof> {
        const nonce = this.currentNonce;
        this.currentNonce += 1n;  // Increment for next action

        const nullifier = await computeNullifier({
            secret: this.privateKey,
            actionId: action.actionId,
            nonce: nonce,
            chainId: await this.getChainId(),
        });

        return this.prover.prove({
            action,
            nullifier,
            nonce,
            // ... other proof inputs
        });
    }
}
```

### Nonce Recovery

If a user loses their nonce state (e.g., wallet backup restore), they need a recovery mechanism:

```compact
// Emergency recovery: allow user to reset nonce with time-lock
function recover_nonce(
    proof: ZKProof,
    new_nonce: Field,
    recovery_timestamp: u64
) {
    require(recovery_timestamp > block.timestamp + 7 days, "TOO_EARLY");

    verify_proof(proof, RECOVERY_ACTION, 0, recovery_proof);

    // Reset the user's nonce counter
    state.user_nonces[proof.signer] = new_nonce;
    emit NonceReset(proof.signer, new_nonce);
}
```

## Complete Implementation Example

Here's a full production-ready example of a token transfer contract with replay protection:

### Contract Definition

```compact
// File: contracts/secure_transfer.compact

// Domain constants
const DOMAIN_TRANSFER = poseidon_hash("TRANSFER_V1");
const ACTION_TRANSFER = 1;

// State
struct State {
    nullifiers: Map<Field, bool>,    // Used nullifiers
    balances: Map<Field, u64>,       // Token balances
    nonces: Map<Field, u64>,        // User nonces
}

// Verify nullifier is unused
function verify_new_nullifier(state: State, nullifier: Field) -> bool {
    return !state.nullifiers.contains(nullifier);
}

// Register a nullifier as used
function use_nullifier(state: State, nullifier: Field) {
    state.nullifiers.insert(nullifier, true);
}

// Main transfer function with replay protection
function transfer(
    // ZK proof inputs (proven off-chain)
    proof: ZKProof,
    sender_nullifier: Field,
    recipient: Field,
    amount: u64,
    nonce: u64,
    expected_sender_nullifier: Field,
) {
    // 1. Proof verification (proves sender owns the funds)
    verify_proof(proof, DOMAIN_TRANSFER, nonce, expected_sender_nullifier);

    // 2. Replay check — nullifier must be new
    require(verify_new_nullifier(state, expected_sender_nullifier),
            "REPLAY_DETECTED: NULLIFIER_ALREADY_USED");

    // 3. Nonce check — prevents proof replay
    const expected_nonce = state.nonces[proof.signer];
    require(nonce == expected_nonce,
            "REPLAY_DETECTED: INVALID_NONCE");

    // 4. Balance check
    require(state.balances[proof.signer] >= amount,
            "INSUFFICIENT_BALANCE");

    // 5. Execute transfer
    state.balances[proof.signer] -= amount;
    state.balances[recipient] += amount;

    // 6. Record nullifier (prevents future replays)
    use_nullifier(state, expected_sender_nullifier);

    // 7. Increment nonce (ensures next proof must use nonce+1)
    state.nonces[proof.signer] = nonce + 1;

    emit Transfer(proof.signer, recipient, amount, expected_sender_nullifier);
}
```

### Off-Chain Prover (TypeScript)

```typescript
// File: src/prover/transfer.ts

import { Field, Poseidon } from '@midnight-org/sdk';

interface TransferInputs {
  secret: Field;       // User's private key (never sent)
  actionId: Field;     // DOMAIN_TRANSFER
  nonce: bigint;        // Current nonce
  sender: Field;        // Public sender address
  recipient: Field;    // Recipient address
  amount: bigint;      // Transfer amount
  chainId: Field;      // Chain identifier
  balance: bigint;      // Current balance (proven)
}

async function generateTransferProof(inputs: TransferInputs) {
  const nullifier = Poseidon.hash([
    inputs.secret,
    inputs.actionId,
    Field.from(inputs.nonce),
    inputs.chainId,
  ]);

  const proof = await midnight.prover.prove({
    circuit: 'transfer',
    publicInputs: {
      nullifier,
      sender: inputs.sender,
      recipient: inputs.recipient,
      amount: inputs.amount,
      chainId: inputs.chainId,
    },
    privateInputs: {
      secret: inputs.secret,
      nonce: inputs.nonce,
      balance: inputs.balance,
    },
  });

  return { proof, nullifier };
}
```

## Testing Your Implementation

### Unit Tests for Replay Protection

```typescript
// File: test/replay.test.ts

describe('Replay Attack Prevention', () => {
  let state: ContractState;
  let prover: MockProver;

  beforeEach(() => {
    state = new ContractState();
    prover = new MockProver();
  });

  test('same nullifier is rejected on second call', async () => {
    const { proof, nullifier } = await prover.generateTransferProof({
      sender: alice,
      recipient: bob,
      amount: 100,
      nonce: 0,
    });

    // First call succeeds
    await state.transfer(proof, nullifier, bob, 100, 0);
    expect(state.balances[alice]).toBe(900);

    // Second call with same nullifier fails
    await expect(state.transfer(proof, nullifier, bob, 100, 0))
      .rejects.toThrow('REPLAY_DETECTED: NULLIFIER_ALREADY_USED');
  });

  test('wrong nonce is rejected', async () => {
    // User's current nonce is 5, but proof uses nonce 3
    const { proof, nullifier } = await prover.generateTransferProof({
      sender: alice,
      recipient: bob,
      amount: 100,
      nonce: 3,  // Wrong nonce
    });

    await expect(state.transfer(proof, nullifier, bob, 100, 3))
      .rejects.toThrow('REPLAY_DETECTED: INVALID_NONCE');
  });

  test('cross-chain replay is prevented by chain_id', async () => {
    const { proof, nullifier } = await prover.generateTransferProof({
      sender: alice,
      recipient: bob,
      amount: 100,
      nonce: 0,
      chainId: MAINNET_CHAIN_ID,
    });

    // Submit on testnet (different chain_id)
    await expect(testnetContract.transfer(
      proof, nullifier, bob, 100, 0
    )).rejects.toThrow('WRONG_CHAIN');
  });

  test('same proof cannot be submitted twice', async () => {
    const { proof, nullifier } = await prover.generateTransferProof({
      sender: alice,
      recipient: bob,
      amount: 100,
      nonce: 0,
    });

    // Submit first time
    await state.transfer(proof, nullifier, bob, 100, 0);

    // Try to submit the exact same proof again
    await expect(state.transfer(proof, nullifier, bob, 100, 0))
      .rejects.toThrow('REPLAY_DETECTED: NULLIFIER_ALREADY_USED');
  });
});
```

### Integration Test: Full Flow

```typescript
test('complete transfer flow with replay protection', async () => {
  // Setup
  const alice = walletWithBalance(1000);
  const bob = emptyWallet();

  // Action 1: Alice transfers 100 to Bob (nonce = 0)
  const proof1 = await alice.proveTransfer({
    recipient: bob.address,
    amount: 100,
    nonce: 0,
  });
  await contract.transfer(proof1, proof1.nullifier, bob.address, 100, 0);
  expect(alice.balance).toBe(900);
  expect(bob.balance).toBe(100);

  // Action 2: Alice transfers 50 to Bob (nonce = 1)
  const proof2 = await alice.proveTransfer({
    recipient: bob.address,
    amount: 50,
    nonce: 1,  // nonce incremented
  });
  await contract.transfer(proof2, proof2.nullifier, bob.address, 50, 1);
  expect(alice.balance).toBe(850);
  expect(bob.balance).toBe(150);

  // Attack: Try to replay Action 1
  await expect(contract.transfer(proof1, proof1.nullifier, bob.address, 100, 0))
    .rejects.toThrow('REPLAY_DETECTED');

  // Attack: Try to use nonce 0 again (even with different params)
  const tamperedProof = await alice.proveTransfer({
    recipient: carol.address,  // different recipient
    amount: 500,              // different amount
    nonce: 0,                 // but same nonce — will fail
  });
  await expect(contract.transfer(tamperedProof, tamperedProof.nullifier, carol.address, 500, 0))
    .rejects.toThrow('REPLAY_DETECTED: INVALID_NONCE');
});
```

## Security Checklist

Before deploying a contract with replay protection:

- [ ] **Nullifier uniqueness**: Test that the same nullifier can never be used twice
- [ ] **Nonce tracking**: Verify nonce increments correctly after each action
- [ ] **Domain separation**: Ensure different action types produce different nullifiers
- [ ] **Chain ID binding**: Verify proofs only work on the intended chain
- [ ] **Proof freshness**: Consider adding a timestamp or block-height check
- [ ] **Overflow protection**: Verify arithmetic operations don't overflow in nullifier computation
- [ ] **Secret key hygiene**: Ensure private keys never leave the user's wallet
- [ ] **Gas DoS protection**: Nullifier lookup should be O(1), not O(n)

## Common Pitfalls

### Pitfall 1: Insecure Nullifier Construction

```compact
// BAD: Nullifier based only on public data (revealable)
const nullifier = poseidon_hash(action_id, public_nonce);
// Anyone can compute this nullifier and try to front-run

// GOOD: Include secret key
const nullifier = poseidon_hash(secret, action_id, nonce, chain_id);
// Only the owner can produce valid nullifiers
```

### Pitfall 2: Nonce Without Nullifier

```compact
// BAD: Only nonce protection (proof can still be replayed if intercepted)
function bad_action(proof, nonce) {
    require(nonce == state.nonces[msg.sender]);
    state.nonces[msg.sender]++;
    execute();
}

// GOOD: Both nonce AND nullifier
function good_action(proof, nullifier, nonce) {
    require(!state.nullifiers.contains(nullifier));
    require(nonce == state.nonces[msg.sender]);
    state.nullifiers.insert(nullifier);
    state.nonces[msg.sender]++;
    execute();
}
```

### Pitfall 3: No Domain Separation

```compact
// BAD: Same nullifier can be used across different actions
const nullifier = poseidon_hash(secret, nonce);
// Withdrawing 100 tokens and staking 100 tokens could conflict

// GOOD: Action-specific domain tags
const nullifier = poseidon_hash(secret, action_id, nonce, domain);
// Each action type has its own nullifier space
```

## Version Audit Checklist

When debugging dependency mismatches in Midnight development:

```
[ ] Compact compiler version matches contract target
    npm list @midnight-org/compact-compiler
[ ] compact-runtime version matches chain
    docker images | grep compact-runtime
[ ] ledger protocol version
    midnight-cli status
[ ] proof server version
    midnight-prover --version
[ ] wallet SDK version
    npm list @midnight-org/sdk
[ ] Verify all versions in package.json match deployed versions
```

## Conclusion

Replay attack prevention in Compact relies on three pillars working together:

1. **Nullifiers** — Unique per-action identifiers that are checked and recorded on-chain
2. **Domain separation** — Prevents cross-context misuse of cryptographic material
3. **Ephemeral nonces** — Provides action-level uniqueness even with the same parameters

The key insight is that ZK proofs add a layer of complexity: you must protect against replay at both the proof level (nullifiers) and the protocol level (nonces). Neither alone is sufficient.

For production deployments, always conduct a security audit focused specifically on your replay protection mechanism, including formal verification of the nullifier construction.

---

*Written for the Midnight Developer Community. Built and tested with Midnight SDK v2.4.1 and Compact Compiler v1.8.2.*
