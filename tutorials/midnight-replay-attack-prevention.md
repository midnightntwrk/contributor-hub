# Tutorial: Replay Attack Prevention in Compact: Nonces, Nullifiers & Defense Patterns

**Bounty Issue**: #297

## Introduction

Replay attacks are a class of cryptographic attacks where a valid data transmission is maliciously or fraudulently repeated. In blockchain contexts, a replay attack can allow an attacker to rebroadcast a legitimate transaction, causing double-spending or unauthorized state changes.

Midnight's Compact language provides native primitives to defend against replay attacks. This tutorial covers the mechanisms, implementation patterns, and best practices for building replay-safe applications on Midnight.

## Understanding Replay Attacks in Blockchain

A replay attack in blockchain occurs when:

1. A transaction is signed and broadcast with specific parameters
2. An attacker captures this transaction
3. The attacker rebroadcasts it (or a modified version) to the network
4. The rebroadcast succeeds because the network cannot distinguish the original from the replay

Classic examples:
- **Ethereum Classic (ETC)**: After the DAO hack split, ETC transactions could be replayed on Ethereum (ETH) and vice versa
- **Account nonce exhaustion**: A transaction with nonce N can be replayed until nonce N+1 is mined

## Midnight's Defense: Nonces + Nullifiers

Midnight uses a dual-mechanism approach:

### 1. Nonce-Based Ordering

Every transaction in a Compact contract includes a monotonically increasing nonce. The protocol rejects transactions with nonces that have already been processed.

```
// Compact example: nonce-enforced state transition
contract SecureTransfer {
  state {
    field last_nonce: u64;
    field balances: Map<Address, u64>;
  }

  // Increment nonce with each transfer
  transition transfer(recipient: Address, amount: u64, tx_nonce: u64) {
    // Reject if nonce is not strictly greater than last processed
    constrain tx_nonce > self.last_nonce;

    // Process transfer
    constrain self.balances[ctx.sender()] >= amount;
    self.balances[ctx.sender()] -= amount;
    self.balances[recipient] += amount;

    // Update nonce
    self.last_nonce = tx_nonce;
  }
}
```

**Key point**: The nonce must be provided by the transaction sender AND validated on-chain. A replayed transaction with the same nonce will fail because the contract state already reflects the completed transaction.

### 2. Nullifier Pattern: Preventing Double-Spending

For UTXO-style operations (like private transactions), Midnight uses **nullifiers**. A nullifier is a unique hash derived from the transaction details. Once a nullifier is "spent," it cannot be used again.

```
// Nullifier-based commitment scheme
contract NullifiableNote {
  state {
    field spent_nullifiers: Set<Field>;
    field commitments: Map<Field, Field>; // commitment -> hidden_value
  }

  // Spend a note by revealing the preimage and proving it matches a commitment
  transition spend_note(
    preimage: Field,    // The secret that was used to create the commitment
    recipient: Address,
    amount: u64
  ) {
    // Derive the commitment and nullifier from the preimage
    let commitment = pedersen_hash(preimage, amount);
    let nullifier = pedersen_hash(preimage, ctx.tx_hash());

    // Constraints
    constrain self.commitments.contains(commitment);  // Commitment must exist
    constrain !self.spent_nullifiers.contains(nullifier);  // Not already spent

    // Mark as spent
    self.spent_nullifiers.insert(nullifier);

    // Transfer to recipient (simplified)
    constrain recipient == ctx.sender();
  }
}
```

**Why include `ctx.tx_hash()` in the nullifier?** This binds the nullifier to the specific transaction, preventing cross-transaction replays.

## Defense Patterns

### Pattern 1: Simple Nonce (High-Throughput Transfers)

Best for: ERC-20 style fungible tokens where transaction order matters.

```compact
contract Token {
  state {
    field nonce: u64;
    field balances: Map<Address, u64>;
  }

  transition send(to: Address, amount: u64, provided_nonce: u64) {
    // Validate nonce
    constrain provided_nonce == self.nonce;

    // Transfer
    constrain self.balances[ctx.sender()] >= amount;
    self.balances[ctx.sender()] -= amount;
    self.balances[to] += amount;

    // Increment nonce
    self.nonce = self.nonce + 1;
  }
}
```

### Pattern 2: Nullifier Set (Privacy-Preserving)

Best for: Private transactions where you need to prove a note exists without revealing which one.

```compact
// Commitment = Hash(secret, amount)
// Nullifier = Hash(secret, tx_hash)
// Spend = Prove knowledge of secret, prove commitment exists, prove nullifier not used
```

### Pattern 3: Time-Bound Revocation

Best for: Subscriptions, recurring payments where authorization can be revoked.

```compact
contract Subscription {
  state {
    field authorized_until: u64;
    field nonce: u64;
  }

  transition execute(action: Field, current_time: u64, tx_nonce: u64) {
    // Time check
    constrain current_time < self.authorized_until;

    // Nonce check
    constrain tx_nonce > self.nonce;

    // Execute action
    // ...

    self.nonce = tx_nonce;
  }
}
```

## Security Checklist

- [ ] **Always include a nonce or sequence number** in state-changing transitions
- [ ] **Validate nonce strictly**: `next_nonce == current_nonce + 1` or `tx_nonce > last_nonce`
- [ ] **Use nullifiers for UTXO-style operations** where you need privacy
- [ ] **Bind nullifiers to `ctx.tx_hash()`** to prevent cross-transaction replays
- [ ] **Store spent nullifiers on-chain** to enable double-spend detection
- [ ] **Consider time-bound authorizations** for revocable permissions
- [ ] **Never rely on timestamps alone** for ordering — use nonces

## Common Pitfalls

1. **Off-chain nonce management**: If the client tracks the nonce incorrectly, transactions may fail or be unsendable. Implement automatic nonce recovery.

2. **Nullifier collision**: Using an insecure hash function for nullifiers can lead to collisions. Always use Midnight's built-in `pedersen_hash` or equivalent.

3. **Front-running**: While nonces prevent replays, they don't prevent front-running (submitting a competing transaction with a higher nonce). Consider commitment schemes for sensitive operations.

4. **Cross-chain replays**: If your contract interacts with other chains, ensure each chain uses a distinct namespace for nonces/nullifiers.

## Testing Your Implementations

```bash
# Compile and test
compact build SecureTransfer

# Simulate replay attack (should fail)
compact invoke SecureTransfer.transfer --args recipient=0x123 amount=100 nonce=0
compact invoke SecureTransfer.transfer --args recipient=0x123 amount=100 nonce=0  # REPLAY - should be rejected
```

## Conclusion

Midnight provides robust primitives for replay attack prevention. The choice between nonce-based ordering and nullifier patterns depends on your privacy requirements:

- **Need transaction ordering and simplicity?** → Use nonces
- **Need privacy + double-spend prevention?** → Use nullifiers
- **Need revocation + ordering?** → Combine both

For most applications, nonce-based ordering provides sufficient security with lower computational overhead. Reserve nullifier patterns for privacy-critical applications.

---

*Author: 一筒 | GitHub: D2758695161*
