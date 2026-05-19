# Replay Attack Prevention in Compact: A Developer's Guide

## Introduction

When you build a smart contract on Midnight, one of the first security questions you'll face is: "How do I prevent the same transaction from being executed twice?" On traditional blockchains like Ethereum, each transaction carries a unique nonce that the network enforces automatically. But Midnight's zero-knowledge architecture works differently—transactions are submitted as proofs rather than direct signatures, which means replay prevention becomes the contract developer's responsibility.

This tutorial covers three fundamental approaches to replay attack prevention in Midnight's Compact language:

1. **Counter-based nonces** — Sequential ordering for identity-bound operations
2. **Set-based nullifiers** — Privacy-preserving uniqueness via `persistentCommit`
3. **Domain separation tags** — Cross-circuit isolation for hash functions

By the end, you'll understand when to use each approach, how to implement them correctly, and the tradeoffs involved in each design decision.

## Understanding the Replay Attack Problem

A replay attack occurs when an adversary captures a valid transaction and resubmits it to the network. In the context of Midnight, this could mean:

- **Double-spending**: Using the same tokens twice
- **Vote manipulation**: Casting multiple votes in an election
- **Reward gaming**: Claiming the same incentive multiple times
- **State corruption**: Executing unauthorized state transitions repeatedly

The core issue is that in zero-knowledge systems, the proof itself might be mathematically valid—but that doesn't mean the operation should be allowed to execute again. Your contract must actively track what has already happened and reject duplicates.

Consider this simplified example: A token transfer contract that doesn't track nonces. If Alice transfers 100 tokens to Bob, she creates a zero-knowledge proof proving she has sufficient balance and authorizing the transfer. An attacker could intercept this proof and resubmit it. Without replay protection, Bob would receive another 100 tokens, debited from Alice's balance a second time.

## Approach 1: Counter-Based Nonces

### How It Works

Counter-based nonces are the simplest and most intuitive approach. Your contract maintains a global counter, and each transaction must include the expected next value. The contract verifies the nonce matches, executes the operation, and increments the counter.

```
state {
    operationCounter: Counter,
}

init {
    state.operationCounter = 0,
}

method transfer(sender: Address, nonce: U256, recipient: Address, amount: U256) {
    assert(nonce == state.operationCounter, "Invalid nonce: transaction out of order");

    // Execute the transfer
    // ... transfer logic ...

    // Increment counter after successful operation
    state.operationCounter = state.operationCounter + 1;
}
```

### Advantages

- **Simplicity**: Easy to understand, implement, and audit
- **Deterministic ordering**: You always know which transaction should come next
- **Low storage overhead**: Only one counter to maintain
- **Debugging friendly**: Transaction logs clearly show the sequence

### The Concurrency Problem

Global counters work well for single-user scenarios, but they break down rapidly with concurrent operations. Consider this realistic scenario:

A decentralized exchange (DEX) allows users to submit multiple trades in a single block for gas efficiency. User Alice wants to:
1. Swap 10 tokens for ETH
2. Swap the resulting ETH for another token

She prepares both transactions with nonces 0 and 1 respectively. If both are submitted to the mempool simultaneously:
- Trade 1 succeeds, counter becomes 1
- Trade 2 now has the correct nonce and also succeeds

But what happens if Trade 1 fails due to insufficient liquidity? The counter remains at 0, but Trade 2 expects counter to be 1. Trade 2 now fails with "Invalid nonce" even though it's a legitimate operation.

This creates a cascading failure: all subsequent transactions in the sequence fail because their nonces are now misaligned with the counter.

### Per-User Counters: The Solution

The standard solution is to maintain separate counters for each user address:

```
state {
    userNonces: Map<Address, U256>,
}

method transfer(sender: Address, nonce: U256, recipient: Address, amount: U256) {
    expectedNonce: U256 = state.userNonces.get(sender).unwrapOr(0);
    assert(nonce == expectedNonce, "Invalid nonce for this user");

    // Update the user's counter
    state.userNonces = state.userNonces.insert(sender, expectedNonce + 1);

    // Execute transfer
    // ... transfer logic ...
}
```

This design allows each user to have independent transaction sequences, solving the cross-user interference problem. Alice can have nonce 0, 1, 2 while Bob simultaneously uses 0, 1, 2 without any conflicts.

### When to Use Counters

Use counter-based nonces when:
- Users perform sequential operations (standard wallet transactions, DEX trades)
- You control the client application and can track nonces
- Simplicity and auditability are primary concerns
- Transaction ordering matters for your application logic

Avoid counters when:
- Operations need to be concurrent or unordered
- You're building privacy-preserving applications where identity linking is a concern
- Client-side nonce management would be too complex for your users
- You expect high-frequency trading or batch operations

## Approach 2: Set-Based Nullifiers

### The Cryptographic Foundation

Nullifiers provide a powerful cryptographic mechanism to mark something as "used" without revealing what it was. In Midnight, the `persistentCommit(secret, context)` function generates a unique identifier with these properties:

1. **Deterministic**: The same inputs always produce the same output
2. **Non-reversible**: You cannot derive the secret from the output
3. **Collision-resistant**: Different inputs produce different outputs with overwhelming probability
4. **Context-binding**: The nullifier is cryptographically tied to both the secret and the context

This makes nullifiers ideal for privacy-preserving replay protection.

### Implementation Pattern

```
state {
    usedNullifiers: Set<Bytes>,
}

init {
    state.usedNullifiers = Set.empty<Bytes>(),
}

method privateOperation(
    userSecret: Bytes,
    operationContext: Bytes,
    operationData: Bytes
) {
    // Generate nullifier from secret and context
    nullifier: Bytes = persistentCommit(userSecret, operationContext);

    // Check if this nullifier has been used before
    assert(!state.usedNullifiers.contains(nullifier), "Operation already executed: replay detected");

    // Process the operation
    // ... operation logic ...

    // Mark nullifier as used
    state.usedNullifiers = state.usedNullifiers.add(nullifier);
}
```

### Why Nullifiers Are Powerful

**Privacy**: The nullifier doesn't reveal the user's identity. Two nullifiers generated from different secrets look completely unrelated, even if the contexts are identical. This is crucial for privacy-preserving applications like voting, anonymous payments, or confidential credentials.

**Flexibility**: Unlike counters, nullifiers don't require ordering. Operations can be submitted and processed in any sequence. This enables parallel execution and batch processing without nonce management overhead.

**Concurrency**: Multiple users can submit operations simultaneously without conflicts. Each nullifier is unique to the user's secret, so there's no contention or race conditions.

### Practical Example: Private Voting System

Let's build a realistic voting contract that uses nullifiers for replay protection:

```
state {
    usedNullifiers: Set<Bytes>,
    votes: Map<Bytes, U256>,  // candidateId -> vote count
    electionContext: Bytes,
}

init {
    state.usedNullifiers = Set.empty<Bytes>();
    state.votes = Map.empty<Bytes, U256>();
    state.electionContext = b"COUNCIL_ELECTION_2026";
}

method castVote(
    voterSecret: Bytes,      // Private key known only to voter
    candidateId: Bytes,       // Who they're voting for
    eligibilityProof: Bytes   // ZK proof of voting rights
) {
    // Create nullifier from voter's secret and election context
    nullifier: Bytes = persistentCommit(voterSecret, state.electionContext);

    // Prevent double-voting
    assert(!state.usedNullifiers.contains(nullifier), "You have already voted in this election");

    // Verify the voter is eligible (via ZK proof)
    assert(verifyVotingEligibility(eligibilityProof, nullifier), "Invalid eligibility proof");

    // Record the vote
    currentVotes: U256 = state.votes.get(candidateId).unwrapOr(0);
    state.votes = state.votes.insert(candidateId, currentVotes + 1);

    // Mark this voter as having voted
    state.usedNullifiers = state.usedNullifiers.add(nullifier);
}
```

Notice how the nullifier prevents double-voting while keeping votes completely private. The election authority can't determine who voted for whom—only that each voter used their secret once.

### Storage Considerations

Nullifiers accumulate in contract state. For long-running contracts, consider these strategies:

**Time-based expiration**: Remove nullifiers after a certain block height or timestamp. This works well for time-bounded operations like votes or claims.

```
method cleanupExpiredNullifiers(currentBlock: U256) {
    // Remove nullifiers older than 1000 blocks
    // (Implementation depends on your state structure)
}
```

**Separate storage contract**: Move nullifier storage to a dedicated contract that can be rotated or upgraded.

**Merkle tree accumulation**: For very large nullifier sets, use a Merkle tree to reduce on-chain storage while maintaining verification capability.

## Approach 3: Domain Separation Tags

### The Cross-Circuit Replay Problem

Imagine you have two different contracts that both use `hashBlake2b(operationData)` to generate operation identifiers:

- **Contract A**: Token transfers
- **Contract B**: NFT mints

If a user performs a token transfer in Contract A with specific parameters, the operation hash might accidentally match a valid NFT mint in Contract B. This creates a cross-circuit replay vulnerability: a valid proof from one context could be replayed in another.

### The Solution: Domain Separation

Domain separation adds a unique prefix (the "domain tag") to each hash input, ensuring that hashes in one context can never match hashes in another context—even with identical data.

```
state {
    domainTag: Bytes,
    processedHashes: Set<Bytes>,
}

init {
    state.domainTag = b"TOKEN_TRANSFER_MAINNET_V1";
    state.processedHashes = Set.empty<Bytes>();
}

method transfer(
    sender: Address,
    recipient: Address,
    amount: U256,
    timestamp: U256
) {
    // Combine domain tag with operation data
    operationData: Bytes = state.domainTag
        .concat(encodeAddress(sender))
        .concat(encodeAddress(recipient))
        .concat(encodeU256(amount))
        .concat(encodeU256(timestamp));

    // Hash with domain separation built in
    operationHash: Bytes = hashBlake2b(operationData);

    // Check for replay within this domain
    assert(!state.processedHashes.contains(operationHash), "Operation already processed");

    // Execute transfer
    // ... transfer logic ...

    state.processedHashes = state.processedHashes.add(operationHash);
}
```

### Why Domain Tags Are Essential

**Cross-circuit isolation**: The same parameters won't produce the same hash in different contracts. This prevents accidental replay across contracts.

**Version control**: Updating the domain tag (e.g., `V1` → `V2`) effectively invalidates all old transactions. This is useful for contract upgrades or emergency responses.

**Context binding**: Prevents accidental collisions between similar operations within the same contract. Transfer operations won't collide with approval operations.

### Best Practices for Domain Tags

Choose domain tags that are:

1. **Descriptive**: Clearly indicate what operation this domain represents
2. **Versioned**: Include a version number for contract upgrades
3. **Network-specific**: Include the network (mainnet/testnet) to prevent testnet replays on mainnet
4. **Unique**: Never reuse domain tags across different contracts or operations

```
// Good examples
state.domainTag = b"DEX_SWAP_MAINNET_V2";
state.domainTag = b"NFT_MINT_GOERLI_V1";
state.domainTag = b"GOVERNANCE_VOTE_MAINNET_V1";

// Avoid these patterns
state.domainTag = b"test";     // Too generic
state.domainTag = b"";         // Empty tag defeats the purpose
state.domainTag = b"V1";       // Missing context
```

## Combining Multiple Approaches

In production contracts, you often combine multiple mechanisms for defense-in-depth security:

```
method secureTransfer(
    sender: Address,
    nonce: U256,
    recipient: Address,
    amount: U256,
    userSecret: Bytes
) {
    // Layer 1: Counter-based nonce for ordering
    expectedNonce: U256 = state.userNonces.get(sender).unwrapOr(0);
    assert(nonce == expectedNonce, "Invalid nonce");
    state.userNonces = state.userNonces.insert(sender, expectedNonce + 1);

    // Layer 2: Nullifier for cryptographic uniqueness
    nullifier: Bytes = persistentCommit(userSecret, encodeU256(nonce));
    assert(!state.usedNullifiers.contains(nullifier), "Replay detected via nullifier");
    state.usedNullifiers = state.usedNullifiers.add(nullifier);

    // Layer 3: Domain-separated hash for cross-circuit protection
    operationHash: Bytes = hashBlake2b(
        state.domainTag.concat(encodeAddress(sender)).concat(encodeU256(nonce))
    );
    assert(!state.processedHashes.contains(operationHash), "Duplicate operation hash");

    // Execute the transfer
    // ... transfer logic ...

    state.processedHashes = state.processedHashes.add(operationHash);
}
```

This triple-layer approach provides comprehensive protection:
- **Sequential ordering** via counters prevents out-of-order execution
- **Cryptographic uniqueness** via nullifiers provides privacy-preserving replay protection
- **Cross-circuit isolation** via domain tags prevents replay across different contexts

## Decision Matrix: Choosing the Right Approach

| Approach | Ordering Required? | Privacy Preserving? | Concurrency Support | Storage Growth | Best Use Case |
|----------|-------------------|--------------------|--------------------|----------------|---------------|
| Counter | Yes | No | Poor | Constant | Wallets, sequential operations |
| Nullifier | No | Yes | Excellent | Linear | Voting, private transactions, claims |
| Domain Tag | No | Partial | Good | Linear | Multi-circuit apps, upgradable contracts |

## Common Implementation Pitfalls

### Pitfall 1: Checking After State Update

Always check for replay before updating state, not after:

```
// Wrong: Update before check - the check always fails!
state.usedNullifiers = state.usedNullifiers.add(nullifier);
assert(!state.usedNullifiers.contains(nullifier), "Already used");  // Always false!

// Correct: Check before update
assert(!state.usedNullifiers.contains(nullifier), "Already used");
state.usedNullifiers = state.usedNullifiers.add(nullifier);
```

### Pitfall 2: Predictable Nullifier Inputs

If nullifier inputs are public or predictable, users can be identified or tracked:

```
// Bad: Public inputs make nullifier predictable
nullifier = persistentCommit(publicUserId, publicContext);
// Attacker can precompute all possible nullifiers

// Better: Include a private secret component
nullifier = persistentCommit(userPrivateKey, publicContext);
// Nullifier is now unpredictable without the secret
```

### Pitfall 3: Reusing Domain Tags

Never reuse domain tags across different contracts or versions:

```
// Dangerous: Both contracts use the same domain tag
// Contract A
state.domainTag = b"TRANSFER_V1";
// Contract B (completely different contract)
state.domainTag = b"TRANSFER_V1";  // Collision risk!

// Safe: Unique domain tags per contract
state.domainTag = b"TOKEN_TRANSFER_V1";
state.domainTag = b"NFT_TRANSFER_V1";
```

## Conclusion

Replay attack prevention is a fundamental security requirement for Midnight smart contracts. The three approaches covered in this tutorial offer different tradeoffs:

- **Counter-based nonces** are simple and efficient but sacrifice concurrency and privacy
- **Set-based nullifiers** provide excellent privacy and concurrency but require storage management
- **Domain separation tags** prevent cross-circuit replay and support contract versioning

For most applications, nullifiers provide the best balance of security, privacy, and flexibility. Use counters when ordering matters or simplicity is paramount. Use domain tags as a foundational layer for all hash-based operations.

Most production contracts benefit from combining multiple approaches, creating defense-in-depth that protects against various attack vectors.

## Further Reading

- [Midnight Documentation](https://docs.midnight.network/)
- [Compact Language Reference](https://docs.midnight.network/compact)
- [Zero-Knowledge Proof Fundamentals](https://docs.midnight.network/zkp-basics)
- [Midnight Developer Forum](https://forum.midnight.network/)


---

## Real-World Case Study: Building a Privacy-Preserving Token Mixer

To illustrate how these replay prevention mechanisms work together in practice, let's walk through designing a simple token mixer contract on Midnight.

### Requirements

The mixer should:
1. Accept deposits of fixed amounts (e.g., 1 ETH)
2. Allow anonymous withdrawals later
3. Prevent double-spending (the same deposit can't be withdrawn twice)
4. Not link deposits to withdrawals (privacy)

### Design

We'll use **nullifiers** as the primary replay prevention mechanism:

```
state {
    // Store commitment to each deposit
    deposits: Set<Bytes>,

    // Track which nullifiers have been used for withdrawal
    spentNullifiers: Set<Bytes>,

    // Merkle root of all deposits for efficient proof verification
    currentRoot: Bytes,
}

init {
    state.deposits = Set.empty<Bytes>();
    state.spentNullifiers = Set.empty<Bytes>();
    state.currentRoot = emptyMerkleRoot();
}
```

### Deposit Flow

When a user deposits 1 ETH, they generate a random secret and compute a commitment:

```
method deposit(
    commitment: Bytes,    // hashBlake2b(secret, nullifier)
    amount: U256
) {
    assert(amount == DEPOSIT_AMOUNT, "Must deposit exactly 1 ETH");

    // Add commitment to the deposit set
    state.deposits = state.deposits.add(commitment);

    // Update Merkle root
    state.currentRoot = updateMerkleRoot(state.currentRoot, commitment);
}
```

The user keeps their `secret` and `nullifier` private—they'll need them for withdrawal.

### Withdrawal Flow

When withdrawing, the user provides a zero-knowledge proof that:
1. They know a secret/nullifier pair whose commitment is in the deposit tree
2. The nullifier hasn't been spent before

```
method withdraw(
    nullifier: Bytes,
    proof: Bytes,         // ZK proof of membership and validity
    recipient: Address
) {
    // Check nullifier hasn't been used (replay prevention!)
    assert(!state.spentNullifiers.contains(nullifier), "This note has already been spent");

    // Verify the ZK proof
    assert(verifyWithdrawalProof(
        proof,
        nullifier,
        state.currentRoot,
        recipient
    ), "Invalid withdrawal proof");

    // Mark nullifier as spent
    state.spentNullifiers = state.spentNullifiers.add(nullifier);

    // Send funds to recipient
    // ... transfer logic ...
}
```

### Why This Works

The nullifier provides perfect replay prevention:
- Each deposit generates a unique nullifier
- The nullifier can only be computed with the secret (which only the depositor knows)
- Once a nullifier is used, it can never be used again
- The connection between deposit and withdrawal is hidden by the ZK proof

This demonstrates why nullifiers are the preferred mechanism for privacy-preserving applications—they provide strong replay protection without compromising anonymity.

---

## Performance Considerations

When choosing a replay prevention strategy, consider the performance implications:

### Counter-Based Nonces

- **Gas cost**: Minimal (single state read/write)
- **Proof generation**: No additional constraints
- **Scalability**: Excellent for high-frequency operations

### Set-Based Nullifiers

- **Gas cost**: Moderate (set membership check + insertion)
- **Proof generation**: Requires `persistentCommit` circuit constraints
- **Scalability**: Set grows linearly with unique operations; consider cleanup strategies

### Domain Separation Tags

- **Gas cost**: Minimal (just hashing with a prefix)
- **Proof generation**: No additional constraints beyond hashing
- **Scalability**: Excellent, but hash set can grow large

For high-throughput applications, consider hybrid approaches:
- Use counters for high-frequency operations
- Use nullifiers for privacy-sensitive operations
- Use domain tags across all operations for isolation

---

## Summary Checklist

Before deploying a Midnight contract, verify your replay protection:

- [ ] **Counter-based nonces**: Is the counter check before state update?
- [ ] **Nullifiers**: Does the nullifier include a secret component?
- [ ] **Domain tags**: Is the tag unique per contract/version/network?
- [ ] **Combined approach**: Are multiple layers used for critical operations?
- [ ] **Testing**: Have you tested replay attacks in your test suite?
- [ ] **Auditing**: Has a security auditor reviewed your replay prevention logic?

Replay attacks are one of the most common smart contract vulnerabilities. By implementing proper protection from the start, you protect your users and your reputation.
