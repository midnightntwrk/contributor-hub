# Multi-Party Private State on Midnight Network: Patterns and Implementation

## Introduction

In decentralized applications, managing private state across multiple parties is one of the most challenging problems in blockchain engineering. Traditional blockchains expose all state transitions publicly, making it impossible to build applications where different participants hold secrets that must remain hidden from each other and from the network at large.

Midnight Network solves this through its **multi-party private state** model — a paradigm where contract state is partitioned among participants, with each party holding only their own private segment while still being able to collaboratively execute smart contract logic that touches all segments atomically.

This tutorial provides a comprehensive deep-dive into the patterns, architecture, and implementation strategies for multi-party private state on Midnight, targeting developers who want to build privacy-preserving decentralized applications.

---

## Understanding Private State on Midnight

### The Core Abstraction

On Midnight, smart contracts can declare **private state** — data that is never published to the blockchain in plaintext. Instead, private state is:

- **Encrypted** using each participant's keys
- **Stored locally** on the participant's device (or in their encrypted on-chain ledger)
- **Proven zero-knowledge** when contract functions execute, without revealing the actual values

Unlike fully homomorphic or MPC-based systems, Midnight uses a **proof-carrying data** model. Each participant generates a zero-knowledge proof attesting to the validity of their state transition, and the contract verifies these proofs on-chain.

### State Partitioning Model

Multi-party private state on Midnight is structured as:

```
ContractState = {
    public_state:  Map<Key, Value>,           // visible to all
    private_states: Map<PartyId, PrivateState> // visible only to the party
}
```

Each `PartyId` corresponds to a distinct participant (identified by their cryptographic key or a derived alias). The contract logic can reference *any* party's private state during execution, but the actual values are only available to the owning party. This creates a **split-knowledge** architecture where:

1. Party A can read and modify `private_states["A"]`
2. Party B can read and modify `private_states["B"]`
3. The contract can enforce constraints across *all* private states using ZK proofs
4. No party ever sees another party's raw private data

---

## Pattern 1: Bilateral Private Agreement

The simplest multi-party pattern involves exactly two parties negotiating over a shared piece of state, where each party holds a private view.

### Use Case: Private Escrow

Consider an escrow contract where:
- The buyer has a private maximum price they're willing to pay
- The seller has a private minimum price they'll accept
- The contract must ensure the agreed price falls within both bounds without revealing either bound

### Implementation Sketch

```compact
// Conceptual Compact pseudocode for bilateral escrow

contract PrivateEscrow {
    // Public state: the escrow status
    public status: EscrowStatus;
    public escrowAmount: Coin<0>;

    // Private state: each party's secret constraint
    private buyerState: {
        maxPrice: Field,
        nonce: Field
    };

    private sellerState: {
        minPrice: Field,
        nonce: Field
    };

    // The buyer initiates by committing to their max price
    transition initiate(
        buyerPubKey: OVK, 
        maxPriceCommitment: Hash,
        deposit: Coin<0>
    ) {
        assert(status == EscrowStatus.Open);
        escrowAmount += deposit;
        // Store the commitment hash, not the value
        status = EscrowStatus.Initiated;
    }

    // The seller accepts if the price is within their bounds
    transition accept(
        sellerKey: OVK,
        agreedPrice: Field,
        buyerProof: Proof,  // proves agreedPrice <= maxPrice
        sellerProof: Proof  // proves agreedPrice >= minPrice
    ) {
        assert(status == EscrowStatus.Initiated);
        assert(verify(buyerProof, buyerState.maxPrice, agreedPrice, "<="));
        assert(verify(sellerProof, sellerState.minPrice, agreedPrice, ">="));
        // Release funds at agreedPrice
        status = EscrowStatus.Completed;
    }
}
```

### Key Insights

- The `buyerProof` is generated *off-chain* by the buyer using their private `maxPrice`
- The `sellerProof` is generated *off-chain* by the seller using their private `minPrice`
- The contract only sees the proofs, never the actual bounds
- Both proofs are verified against the *same* `agreedPrice`, creating an atomic link

---

## Pattern 2: Multi-Party State Channels

For applications involving more than two parties, state channel patterns extend naturally to Midnight's private state model.

### Use Case: Private Multi-Player Game

Imagine a card game where:
- Each player has private cards (their hand)
- The game has shared public state (pot size, turn order)
- Game actions require proofs about private cards without revealing them

### Architecture

```
┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│   Player A   │   │   Player B   │   │   Player C   │
│  Private:    │   │  Private:    │   │  Private:    │
│  - hand[]    │   │  - hand[]    │   │  - hand[]    │
│  - balance   │   │  - balance   │   │  - balance   │
└──────┬───────┘   └──────┬───────┘   └──────┬───────┘
       │                  │                  │
       └──────────┬───────┘──────────────────┘
                  │
          ┌───────▼────────┐
          │  Game Contract  │
          │  Public State:  │
          │  - pot          │
          │  - turn         │
          │  - round        │
          └────────────────┘
```

### Implementation Approach

Each player maintains a local copy of the full game state, but only *their hand* is stored as private state. When a player takes an action (e.g., plays a card), they:

1. Generate a ZK proof that the card they're playing is in their hand
2. Generate a proof that the card satisfies any game rules (e.g., it's a valid play)
3. Submit the proof and the public card value to the contract
4. Other players update their local state to reflect the played card

```compact
// Conceptual pseudocode for private card game

contract PrivateCardGame {
    public pot: Coin<0>;
    public currentPlayer: uint<8>;
    public playedCards: Array<Card, MAX_PLAYERS>;
    
    // Each player's private hand
    private hands: Map<PlayerId, {
        cards: Array<Card, MAX_HAND_SIZE>,
        secretSeed: Field
    }>;

    transition playCard(
        player: PlayerId,
        card: Card,
        handProof: Proof,       // proves card is in player's hand
        validityProof: Proof    // proves card satisfies game rules
    ) {
        assert(currentPlayer == player);
        assert(verify(handProof, hands[player].cards, card, "contains"));
        assert(verify(validityProof, card, gameRules, "satisfies"));
        playedCards[player] = card;
        currentPlayer = nextPlayer(currentPlayer);
    }
}
```

---

## Pattern 3: Threshold-Private State

Some applications require that private state can only be modified when a *threshold* of parties agree. This is distinct from multi-sig patterns because the state itself remains private even from the signers who aren't the owner.

### Use Case: Private DAO Voting

A DAO where:
- Each member has private voting power
- Votes are cast privately (no one sees how others voted)
- The outcome is computed via ZK proofs
- A threshold of members must attest to the final tally

### Implementation Strategy

```compact
contract PrivateVotingDAO {
    public proposalId: Field;
    public yesCount: EncryptedTally;  // homomorphically encrypted
    public noCount: EncryptedTally;
    public finalized: bool;
    
    private memberState: Map<MemberId, {
        votingPower: Field,
        hasVoted: bool,
        secretVote: Field  // 0 or 1 (encrypted)
    }>;

    transition castVote(
        member: MemberId,
        encryptedVote: EncryptedField,
        powerProof: Proof,      // proves voting power > 0
        voteProof: Proof        // proves vote is 0 or 1
    ) {
        assert(!memberState[member].hasVoted);
        assert(verify(powerProof, memberState[member].votingPower, 0, ">"));
        assert(verify(voteProof, memberState[member].secretVote, {0,1}, "in"));
        
        // Homomorphically add to tally
        yesCount += encryptedVote * memberState[member].votingPower;
        noCount += (1 - encryptedVote) * memberState[member].votingPower;
        memberState[member].hasVoted = true;
    }

    transition finalize(tallyProof: Proof, decryptionShare: Field) {
        assert(!finalized);
        // Requires threshold number of decryption shares
        // to decrypt the final tally
        assert(verifyThreshold(decryptionShares));
        finalized = true;
    }
}
```

---

## Pattern 4: Private Cross-Contract State

Advanced applications may need to reference private state from *another* contract. This creates a **composability** challenge: how can Contract B verify a claim about Contract A's private state without exposing it?

### Solution: State Attestation Proofs

The pattern works as follows:

1. Contract A's owner generates a proof about their private state
2. This proof is structured to be *portable* — it doesn't reveal the state but can be verified by any contract
3. Contract B verifies the attestation proof before proceeding

```
┌──────────────────────────────────────────────────┐
│  User generates proof about Contract A's state   │
│  "I have balance >= 100 in Contract A"           │
│  ZK proof: ∃ s.t. balance(s) >= 100             │
│  Without revealing: balance(s)                   │
└───────────────────┬──────────────────────────────┘
                    │ attestation proof
                    ▼
┌──────────────────────────────────────────────────┐
│  Contract B verifies the attestation proof       │
│  Against Contract A's verification key           │
│  Grants access/permission based on proof         │
└──────────────────────────────────────────────────┘
```

---

## Implementation Best Practices

### 1. Minimize Private State Size

ZK proof generation time scales with circuit size, and circuit size scales with private state complexity. Keep private state structures flat and minimal:

```compact
// ✅ Good: flat, minimal
private state: {
    balance: Field,
    nonce: Field
};

// ❌ Bad: deeply nested, large
private state: {
    accounts: Map<Address, {
        balance: Field,
        history: Array<Transaction, 1000>,
        metadata: { ... }
    }>
};
```

### 2. Use Nonces to Prevent Replay

Every private state transition should include a nonce that increments. This prevents an attacker from replaying a valid proof from a previous state:

```compact
transition transfer(amount: Field, proof: Proof) {
    assert(verify(proof, state.balance, amount, state.nonce));
    state.balance -= amount;
    state.nonce += 1;  // critical!
}
```

### 3. Design for Offline-First

Multi-party interactions on Midnight often involve asynchronous communication. Design your contract assuming parties may not be online simultaneously:

- Use **commit-reveal** patterns instead of real-time interaction
- Allow **timeout** states so funds aren't locked forever
- Support **state channels** for high-frequency interactions

### 4. Partition State by Access Pattern

If a piece of state is only ever read by one party, make it private to that party. If it's read by all parties, make it public. The boundary between public and private state is a critical design decision:

| State Type | Visibility | Use When |
|---|---|---|
| Fully Public | All parties + network | Must be agreed upon by all |
| Party-Private | Single party | Only owner needs to see |
| Encrypted Shared | All parties (encrypted) | All need access but not public |
| Threshold | K-of-N parties | Requires quorum to act |

---

## Security Considerations

### Proof Soundness
Always verify proofs against the contract's *current* public state roots. A common mistake is verifying against stale roots, which allows proofs from previous state transitions to be reused.

### Timing Attacks
Even though state values are private, the *timing* of state transitions can leak information. Use constant-time proof generation where possible and avoid branching on private values.

### State Consistency
When multiple parties modify private state concurrently, ensure your contract handles conflicts gracefully. Use sequence numbers or versioned state to detect and reject stale updates.

---

## Conclusion

Multi-party private state on Midnight Network enables a new class of decentralized applications where privacy isn't an afterthought — it's a first-class primitive. By partitioning state among participants and using zero-knowledge proofs to enforce correctness across partitions, developers can build applications that were previously impossible on transparent blockchains.

The patterns covered in this tutorial — bilateral agreements, state channels, threshold-private state, and cross-contract attestation — form the building blocks for complex private applications. Combined with Midnight's Compact language and proof system, these patterns provide a robust foundation for privacy-preserving decentralized application development.

For more advanced patterns and working examples, explore the companion code samples in the `examples/` directory alongside this tutorial.

---

*This tutorial is part of the Midnight Network contributor hub. For questions, join the [Midnight Discord](https://discord.com/invite/midnightnetwork) or visit the [developer docs](https://docs.midnight.network/).*
