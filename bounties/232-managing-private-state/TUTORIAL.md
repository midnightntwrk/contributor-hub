# Managing Private State in Midnight Compact

## Building Privacy-First Smart Contracts with Ledger, Transient State, and Selective Disclosure

---

## Introduction

One of Midnight Network's most powerful features is its dual-ledger architecture, which lets smart contracts maintain both **public** and **private** state simultaneously. Unlike traditional blockchains where all state is transparent, Midnight gives developers fine-grained control over what data remains hidden and what gets disclosed on-chain.

This tutorial covers everything you need to know about managing private state in Compact:

- The difference between **ledger state** and **transient state**
- How to **declare**, **read**, and **update** private state variables
- The `disclose()` function and its privacy implications
- **Best practices** for state management across transactions
- Common **design patterns**: state machines, conditional disclosure, minimal disclosure
- **Testing** private state with the Compact simulator

**Prerequisites:** Basic familiarity with TypeScript or JavaScript syntax. No prior Compact experience required. You should understand the concept of hash functions and Merkle trees at a high level—we'll reference them throughout, but deep cryptographic knowledge is not needed.

**What you'll build:** By the end of this tutorial, you'll understand how to design contracts that protect user data while maintaining verifiability, and you'll have two complete contract examples (a private voting system and a private vault) to use as starting points for your own projects.

---

## 1. Understanding State Types in Compact

### 1.1 Ledger State vs. Transient State

Compact distinguishes between two fundamental kinds of state:

**Ledger state** (`ledger`) is persistent state stored on-chain. It survives across transactions and is the canonical source of truth for your contract. Ledger state can be **public** (visible to all network participants) or **private** (hidden, stored as commitments).

**Transient state** (`transient`) exists only within a single transaction's execution context. It is never written to the blockchain. Transient state is useful for intermediate calculations, temporary flags, or caching values during complex multi-step operations.

```compact
contract StateExample {
    // Ledger state: persisted on-chain
    ledger publicValue: Uint<64>;
    ledger secretValue: Uint<64>;

    // Transient state: exists only during transaction execution
    transient tempBuffer: Field;
    transient computedHash: Bytes<32>;
}
```

**Key distinction:** Ledger state requires ZK proofs when modified (because changes are committed on-chain). Transient state does not, making it cheaper to use for intermediate computations. Transient variables are particularly useful for caching derived values that you need multiple times within a transaction, or for holding intermediate results in complex multi-step circuit logic. Since transient state never leaves the client, it carries zero on-chain storage cost.

When to use each type:

| Use Case | State Type | Reason |
|----------|-----------|--------|
| Token balance | `ledger` (private) | Must persist across transactions |
| Vote count | `ledger` (public) | Needs independent verification |
| Temporary hash | `transient` | Only needed during current execution |
| Circuit cache | `transient` | Avoid redundant computation |
| Merkle root | `ledger` (public) | Verifiable by all participants |
| Session token | `transient` | Valid for one transaction only |

### 1.2 Public vs. Private Ledger State

When you declare a `ledger` variable, its visibility is determined by how it's used:

- **Public ledger state:** Values are stored in the clear on the public ledger. Anyone can read them. This is suitable for data that needs to be independently verifiable—vote tallies, token supplies, configuration parameters.

- **Private ledger state:** Values are stored as cryptographic commitments on the private ledger. Only the holder of the corresponding secret can reconstruct the actual value. This is ideal for balances, personal data, credentials, and any information that should remain confidential.

```compact
contract TokenLedger {
    // Public: total supply is visible to everyone
    ledger totalSupply: Uint<64>;

    // Private: individual balances are hidden
    // (stored as commitments on the private ledger)
    ledger balance: Field;

    // MerkleTree for membership proofs—enables proving
    // you hold a balance without revealing which leaf
    ledger commitmentTree: MerkleTree<20>;
}
```

---

## 2. Declaring and Using Private State Variables

### 2.1 Basic Declaration

Private state variables in Compact use the `ledger` keyword. The privacy guarantee comes from how you use the variable—whether you read it with `disclose()` or keep it within ZK circuits.

```compact
contract PrivateVault {
    // Private state: stored as a commitment
    ledger secretAmount: Uint<64>;
    ledger ownerPublicKey: Field;
    ledger nonce: Uint<32>;

    // Accessing private state
    public deposit(amount: Uint<64>): Void {
        let current: Uint<64> = secretAmount.get();
        secretAmount.set(current + amount);
    }
}
```

### 2.2 Reading Private State

Use `.get()` to read the current value of a ledger variable. When you read private state inside a `circuit` function, the value is used within the ZK proof—it never appears on-chain.

```compact
contract BalanceChecker {
    ledger balance: Uint<64>;
    ledger minimumRequired: Uint<64>;

    // Circuit: proves you have enough balance without revealing the amount
    circuit verifySufficientBalance(): Bool {
        let bal: Uint<64> = balance.get();
        let min: Uint<64> = minimumRequired.get();
        return bal >= min;
    }
}
```

### 2.3 Writing Private State

Use `.set()` to write a new value. The write creates a new commitment on the private ledger. Previous values are not accessible (they are nullified).

```compact
contract TransferableVault {
    ledger balance: Uint<64>;

    public transfer(amount: Uint<64>): Void {
        let current: Uint<64> = balance.get();
        assert(current >= amount); // Prevent overdraft
        balance.set(current - amount);
    }

    public receive(amount: Uint<64>): Void {
        let current: Uint<64> = balance.get();
        balance.set(current + amount);
    }
}
```

**Important:** Every `.set()` on a ledger variable changes the on-chain commitment. The ZK circuit proves that the transition was valid (e.g., you didn't create money out of thin air), but the actual values remain hidden.

---

## 3. The `disclose()` Function

### 3.1 What `disclose()` Does

The `disclose()` function is the mechanism for **selective disclosure**—revealing specific private values to the public ledger. This is one of Midnight's most distinctive features.

When you call `disclose(value)`, the specified value becomes publicly visible in the transaction output. The ZK proof still guarantees the value was computed correctly, but now anyone can see it.

```compact
contract SelectiveReveal {
    ledger privateScore: Uint<64>;
    ledger threshold: Uint<64>;

    // Reveal only that the score meets a threshold—not the score itself
    circuit meetsThreshold(): Void {
        let score: Uint<64> = privateScore.get();
        let thresh: Uint<64> = threshold.get();
        assert(score >= thresh);
        // We do NOT disclose the score—just prove the condition
    }

    // Reveal the score to everyone
    public revealScore(): Void {
        let score: Uint<64> = privateScore.get();
        disclose(score);
    }
}
```

### 3.2 Privacy Implications of `disclose()`

**Disclosed data is permanent.** Once you call `disclose()`, the value is recorded on the public ledger and cannot be re-hidden. Consider carefully whether a value truly needs to be revealed.

**Disclosed data is linkable.** If you disclose a balance, observers can correlate that disclosure with your transaction history. This may reveal patterns you intended to keep private.

**Prefer proving over disclosing.** Instead of disclosing your exact balance to prove you have enough funds, use a circuit to prove the condition:

```compact
// BAD: Reveals the exact balance
public badProof(): Void {
    let bal: Uint<64> = balance.get();
    disclose(bal);
    assert(bal >= 100);
}

// GOOD: Proves the condition without revealing the value
circuit goodProof(): Bool {
    let bal: Uint<64> = balance.get();
    return bal >= 100;
}
```

### 3.3 Conditional Disclosure

Sometimes you need to disclose a value only under certain conditions:

```compact
contract ConditionalExposure {
    ledger privateBalance: Uint<64>;
    ledger isPublic: Bool;

    // Only disclose if the user has opted in
    public maybeReveal(): Void {
        let public_flag: Bool = isPublic.get();
        if (public_flag) {
            let bal: Uint<64> = privateBalance.get();
            disclose(bal);
        }
    }
}
```

---

## 4. Best Practices for State Management

### 4.1 Separate Public and Private Concerns

Design your contract so that public and private state serve clearly distinct purposes. Avoid duplicating data across both ledgers.

```compact
contract WellDesignedContract {
    // Public: things that need independent verification
    ledger totalParticipants: Uint<32>;
    ledger registrationDeadline: Uint<64>;

    // Private: personal or sensitive data
    ledger participantCommitment: Field;
    ledger encryptedProfile: Bytes<128>;
}
```

### 4.2 Use Nonces to Prevent Replay

When managing private state across transactions, include a **nonce** (a transaction counter) to prevent replay attacks. Without nonces, an attacker could resubmit a valid proof with outdated state.

```compact
contract NonceProtected {
    ledger balance: Uint<64>;
    ledger nonce: Uint<32>;

    circuit authorizeTransfer(amount: Uint<64>, expectedNonce: Uint<32>): Bool {
        let currentNonce: Uint<32> = nonce.get();
        assert(currentNonce == expectedNonce);
        let bal: Uint<64> = balance.get();
        assert(bal >= amount);
        // The caller must set the new nonce after this circuit succeeds
        return true;
    }

    public executeTransfer(amount: Uint<64>, expectedNonce: Uint<32>): Void {
        // Verify authorization via circuit
        assert(authorizeTransfer(amount, expectedNonce));
        // Update state
        balance.set(balance.get() - amount);
        nonce.set(expectedNonce + 1);
    }
}
```

### 4.3 Minimize Disclosed Data

Follow the principle of **minimal disclosure**: reveal only what is strictly necessary. Use zero-knowledge proofs to demonstrate properties of private data without exposing the data itself.

```compact
contract MinimalDisclosure {
    ledger userAge: Uint<8>;
    ledger userCountry: Field;

    // BAD: Discloses both age and country
    public badVerify(): Void {
        disclose(userAge.get());
        disclose(userCountry.get());
    }

    // GOOD: Proves age >= 18 without disclosing exact age or country
    circuit verifyEligible(): Bool {
        return userAge.get() >= 18;
    }
}
```

### 4.4 Batch State Updates

When updating multiple private state variables in a single transaction, all updates are committed atomically. This prevents partial updates that could leave your contract in an inconsistent state.

```compact
contract AtomicUpdates {
    ledger balance: Uint<64>;
    ledger points: Uint<32>;
    ledger level: Uint<8>;

    public depositAndReward(amount: Uint<64>): Void {
        // All three updates succeed or fail together
        balance.set(balance.get() + amount);
        points.set(points.get() + 10);
        if (points.get() >= 100) {
            level.set(level.get() + 1);
            points.set(0);
        }
    }
}
```

---

## 5. Common Design Patterns

### 5.1 State Machine Pattern

Use private state to implement finite state machines where transitions are hidden:

```compact
contract PrivateOrderBook {
    // States: 0=Pending, 1=Matched, 2=Settled, 3=Cancelled
    ledger orderState: Uint<8>;
    ledger orderAmount: Uint<64>;
    ledger orderPrice: Uint<64>;

    circuit canTransition(fromState: Uint<8>, toState: Uint<8>): Bool {
        let current: Uint<8> = orderState.get();
        if (current != fromState) return false;
        // Valid transitions: Pending->Matched, Pending->Cancelled,
        //                   Matched->Settled, Matched->Cancelled
        if (fromState == 0) return (toState == 1 || toState == 3);
        if (fromState == 1) return (toState == 2 || toState == 3);
        return false;
    }

    public matchOrder(): Void {
        assert(canTransition(0, 1));
        orderState.set(1);
    }

    public settleOrder(): Void {
        assert(canTransition(1, 2));
        orderState.set(2);
    }

    public cancelOrder(): Void {
        let current: Uint<8> = orderState.get();
        assert(current == 0 || current == 1);
        orderState.set(3);
    }

    // Only disclose final state for audit purposes
    circuit isSettled(): Bool {
        return orderState.get() == 2;
    }
}
```

### 5.2 Commitment-Reveal Pattern

Useful for voting, bidding, or any scenario where participants commit to a choice before revealing:

```compact
contract CommitRevealVote {
    ledger proposalId: Uint<32>;
    ledger commitmentTree: MerkleTree<16>;
    ledger voteTallyYes: Uint<32>;
    ledger voteTallyNo: Uint<32>;
    ledger revealedCount: Uint<32>;

    // Phase 1: Commit (hide your vote)
    public commitVote(commitment: Field): Void {
        commitmentTree.insert(commitment);
    }

    // Phase 2: Reveal (prove your vote matches your commitment)
    circuit revealVote(
        vote: Bool,
        secret: Field,
        leafIndex: Field
    ): Bool {
        // Prove that the commitment matches the vote + secret
        let computedCommitment: Field = pedersenHash(vote, secret);
        // Verify membership in the commitment tree
        let proof: MerkleTreePath = commitmentTree.path(leafIndex);
        return proof.root == commitmentTree.root();
    }

    // Phase 3: Tally (public, anyone can verify)
    public tallyVote(vote: Bool, secret: Field, leafIndex: Field): Void {
        assert(revealVote(vote, secret, leafIndex));
        if (vote) {
            voteTallyYes.set(voteTallyYes.get() + 1);
        } else {
            voteTallyNo.set(voteTallyNo.get() + 1);
        }
        revealedCount.set(revealedCount.get() + 1);
    }
}
```

### 5.3 Encrypted Off-Chain Storage Pattern

For large private data, store an encrypted copy off-chain and keep only a commitment on-chain:

```compact
contract OffChainStorage {
    // On-chain: just the commitment (32 bytes)
    ledger dataCommitment: Field;
    ledger version: Uint<32>;

    // Prove you know the data matching the commitment
    circuit verifyData(
        encryptedPayload: Bytes<256>,
        encryptionKey: Field
    ): Bool {
        let computed: Field = pedersenHash(encryptedPayload, encryptionKey);
        return computed == dataCommitment.get();
    }

    // Update with new data
    public updateData(
        newCommitment: Field,
        expectedVersion: Uint<32>
    ): Void {
        assert(version.get() == expectedVersion);
        dataCommitment.set(newCommitment);
        version.set(expectedVersion + 1);
    }
}
```

---

## 6. Working Code Example: Private Voting Contract

Let's build a complete private voting contract that demonstrates all the patterns we've covered.

See [`private-voting.compact`](./private-voting.compact) for the full implementation.

Key features:
- **Private votes**: Individual votes are never revealed
- **Public tallies**: Final vote counts are verifiable by anyone
- **Commitment-reveal**: Prevents vote buying and coercion
- **Nonce protection**: Prevents replay attacks
- **Minimal disclosure**: Only proves eligibility, not identity

---

## 7. Testing Private State with the Simulator

### 7.1 Setting Up the Test Environment

The Compact compiler includes a simulator for testing contracts without deploying to a network. Here's how to test private state:

```typescript
import { describe, it, expect } from 'vitest';
import { Simulator } from '@midnight-ntwrk/compact-simulator';

describe('Private State Management', () => {
    let simulator: Simulator;

    beforeEach(async () => {
        simulator = await Simulator.create();
    });

    it('should persist private state across transactions', async () => {
        const contract = await simulator.deploy('private-voting.compact');

        // Set private state
        await contract.call('deposit', [1000]);

        // Read private state (within ZK proof)
        const result = await contract.call('verifyBalance', [500]);
        expect(result).toBe(true);
    });
});
```

### 7.2 Testing Disclosure Behavior

```typescript
it('should only disclose when explicitly called', async () => {
    const contract = await simulator.deploy('private-voting.compact');

    // Commit a vote
    const commitment = computeCommitment(true, secret);
    await contract.call('commitVote', [commitment]);

    // Verify tally is zero before reveal
    const tallyBefore = await contract.publicState('voteTallyYes');
    expect(tallyBefore).toBe(0n);

    // Reveal and tally
    await contract.call('tallyVote', [true, secret, leafIndex]);

    // Now tally should be 1
    const tallyAfter = await contract.publicState('voteTallyYes');
    expect(tallyAfter).toBe(1n);
});
```

### 7.3 Testing State Transitions

```typescript
it('should enforce valid state transitions', async () => {
    const contract = await simulator.deploy('private-voting.compact');

    // Valid transition: Pending -> Matched
    await contract.call('matchOrder', []);
    const state = await contract.privateState('orderState');
    expect(state).toBe(1n);

    // Invalid transition: Matched -> Pending (should fail)
    await expect(
        contract.call('matchOrder', [])
    ).rejects.toThrow('Assertion failed');
});
```

### 7.4 Debugging Private State

When debugging, use the simulator's trace output to inspect state transitions:

```bash
# Run with verbose state tracing
compactc --simulate --trace-state private-voting.compact

# Output shows:
# [TX 1] commitVote: commitmentTree.root changed -> 0x7a3f...
# [TX 2] tallyVote: voteTallyYes 0 -> 1, revealedCount 0 -> 1
```

---

## 8. Common Pitfalls

| Pitfall | Problem | Solution |
|---------|---------|----------|
| Disclosing too early | Calling `disclose()` before you need to | Use circuits to prove properties instead |
| Missing nonces | Replay attacks on private state | Always include and increment a nonce |
| Inconsistent reads | Reading state at different points in a transaction | Read once, store in a local variable |
| Large Merkle trees | Deep trees slow proof generation | Choose appropriate tree depth for your use case |
| Ignoring nullifiers | Re-spending spent private values | Always nullify consumed state |

---

## Summary

Managing private state in Midnight Compact comes down to a few key principles:

1. **Use `ledger` for persistent state**, `transient` for temporary computations
2. **Keep sensitive data private** by default—only `disclose()` when absolutely necessary
3. **Use circuits** to prove properties of private data without revealing it
4. **Include nonces** to prevent replay attacks across transactions
5. **Design for minimal disclosure**—reveal the minimum information needed
6. **Test with the simulator** to verify privacy guarantees before deploying
7. **Separate public and private concerns**—don't duplicate data across ledgers

Private state management is what makes Midnight unique among blockchain platforms. The dual-ledger architecture gives you a spectrum of privacy options—from fully transparent to fully shielded—with selective disclosure as the bridge between them. By mastering these patterns, you can build applications that protect user privacy while maintaining the verifiability and trustlessness that make blockchains valuable.

The two complete contract examples in this repository—`private-voting.compact` and `private-vault.compact`—are designed to be studied, modified, and extended. Start with the voting contract to understand commitment-reveal patterns, then explore the vault for state machine and authorization patterns. Both contracts demonstrate real-world scenarios you'll encounter when building production Midnight dApps.

---

## Further Reading

- [Midnight Developer Documentation](https://docs.midnight.network/)
- [Compact Language Reference](https://docs.midnight.network/build/reference/compact/)
- [Zero-Knowledge Proof Fundamentals](https://docs.midnight.network/learn/concepts/zero-knowledge-proofs)
- [Midnight Network Architecture](https://docs.midnight.network/learn/concepts/architecture)
