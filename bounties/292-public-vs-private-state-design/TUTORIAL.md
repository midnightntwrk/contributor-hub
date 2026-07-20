# Designing Public vs. Private State: What Goes Where and Why

## A Decision Framework for Midnight Smart Contract Architecture

The single most consequential decision you make when designing a Midnight smart contract is choosing what state goes on the public ledger versus what stays in private witnesses. Get it right, and your contract is efficient, privacy-preserving, and cheap to run. Get it wrong, and you either leak sensitive data or pay unnecessary transaction costs.

This tutorial gives you a concrete framework for making that decision. We'll cover the two state models in Midnight, walk through real patterns with working Compact code, and show you the anti-patterns that catch developers off guard.

---

## The Two State Models

Midnight has two fundamentally different places to store data. Understanding the distinction is the foundation for every architectural decision that follows.

### Public State: The Ledger

Public state lives in the contract's ledger. Anyone running a node can see it. It's stored as part of the blockchain state and is accessible to all circuits in the contract.

```compact
// Public state - visible on-chain
export ledger totalVotes: Uint<64>;
export ledger proposalTitle: Bytes<64>;
export sealed ledger admin: Bytes<32>;
```

The `export` keyword makes a ledger field publicly queryable. The `sealed` modifier restricts write access to the contract itself but the value is still publicly visible. There's a crucial distinction here: **exported doesn't mean writable, it means readable from outside the contract.**

### Private State: Witnesses

Private state exists only in the user's local environment. It never touches the blockchain directly. In Compact, private state flows through circuit parameters — witnesses — that the user provides when calling a circuit.

```compact
// Private state - provided by the user as a witness
export circuit castVote(
    voterSecret: Bytes<32>,    // private: only the voter knows this
    voteChoice: Boolean,        // private: the vote itself
    voterCommitment: Bytes<32>  // public reference without revealing identity
): [] { ... }
```

The key insight: **witnesses are never stored on-chain.** They exist only during proof generation, and the zero-knowledge proof attests to their validity without revealing their contents.

### The Third Option: Derived Public State

There's a subtle third category that trips people up: state that's derived from private inputs but stored publicly. The classic example is a vote tally.

```compact
export ledger votesFor: Uint<64>;
export ledger votesAgainst: Uint<64>;
// The tally is public. Individual votes are not.
```

This is the most common pattern in privacy-preserving dApps: private inputs produce public aggregates. The aggregate is useful and necessary; the individual values are sensitive.

---

## The Decision Framework

When designing your contract, run each piece of state through these questions:

**Question 1: Does the network need to verify this value independently?**

If other circuits or external observers need to read and act on a value, it must be on the ledger. A token balance that other contracts need to check? Public. A user's secret key? Never.

**Question 2: Does revealing this value leak user behavior?**

If the value tells you something about what a specific user did — their vote, their balance, their transaction history — it should stay private. The exception is when aggregation hides individual behavior.

**Question 3: Does the contract need to enforce consistency on this value across transactions?**

If the contract must ensure a value stays consistent (e.g., "only the admin can do this"), it needs to be on the ledger. The contract can't enforce rules on values it can't see.

**Question 4: Can this value be reconstructed from other on-chain data?**

If so, storing it publicly is redundant and wastes DUST. Don't duplicate what's already derivable.

### Quick Decision Matrix

| Characteristic | Public (Ledger) | Private (Witness) |
|---|---|---|
| Other contracts need to read it | ✅ | ❌ |
| Reveals user behavior | ❌ | ✅ |
| Must persist across transactions | ✅ | ❌ |
| Contract enforces rules on it | ✅ | ❌ |
| User-specific secret | ❌ | ✅ |
| Aggregate/summary value | ✅ | ❌ |

---

## Pattern 1: Private Votes, Public Tally

This is the canonical privacy pattern. Individual votes are sensitive; the final count is not.

```compact
pragma language_version >= 0.16.0;

import CompactStandardLibrary;

contract PrivateVoting {

    // PUBLIC: The results anyone can verify
    export ledger votesFor: Uint<64>;
    export ledger votesAgainst: Uint<64>;
    export ledger votingOpen: Boolean;

    // PUBLIC: Tracks who voted (as commitments, not identities)
    export ledger voterCommitments: MerkleTree<32, Bytes<32>>;

    // PRIVATE: The voter proves they know the secret without revealing it
    export circuit castVote(
        voterSecret: Bytes<32>,
        voteChoice: Boolean,
        voterCommitment: Bytes<32>
    ): [] {
        assert(votingOpen, "Voting is closed");

        // Verify the voter knows the secret behind their commitment
        // by checking the commitment exists in the tree
        assert(
            contains(voterCommitments, voterCommitment),
            "Not a registered voter"
        );

        // Tally the vote — only the aggregate is public
        if (voteChoice) {
            votesFor = votesFor + 1;
        } else {
            votesAgainst = votesAgainst + 1;
        }

        // Remove the commitment to prevent double-voting
        voterCommitments = remove(voterCommitments, voterCommitment);

        return [];
    }

    export circuit closeVoting(): [] {
        votingOpen = false;
        return [];
    }
}
```

**What's public:** The vote counts and whether voting is open.  
**What's private:** Who voted and how they voted.  
**The privacy guarantee:** The ZK proof proves "I know a secret that was registered" without revealing which secret or who the voter is.

### The Anti-Pattern Here

A common mistake is storing the voter's identity on the ledger to prevent double-voting:

```compact
// BAD: Links identity to vote
export ledger hasVoted: MerkleTree<32, Bytes<32>>;
// Now anyone can see WHO voted, even if they can't see WHAT they voted
```

The correct approach uses commitments that can be removed after use, as shown above.

---

## Pattern 2: Private Balances with Public Token Metadata

Token contracts need to track ownership privately while maintaining public metadata about the token itself.

```compact
pragma language_version >= 0.16.0;

import CompactStandardLibrary;

contract PrivateToken {

    // PUBLIC: Token metadata
    export ledger tokenName: Bytes<32>;
    export ledger totalSupply: Uint<128>;
    export ledger mintingAuthority: Bytes<32>;

    // PUBLIC: The coin registry (necessary for the UTXO model)
    export sealed ledger activeCoins: MerkleTree<32, QualifiedShieldedCoinInfo>;

    constructor(
        name: Bytes<32>,
        supply: Uint<128>,
        authority: Bytes<32>
    ) {
        tokenName = name;
        totalSupply = supply;
        mintingAuthority = authority;
        activeCoins = emptyMerkleTree();
    }

    export circuit mint(
        recipient: ZswapCoinPublicKey,
        amount: Uint<128>
    ): [] {
        assert(kernel.minter() == some(mintingAuthority), "Not authorized");

        const newCoin: ShieldedCoinInfo = {
            nonce: generateNonce(),
            color: some(selfColor()),
            value: amount
        };

        // The recipient receives the coin privately
        sendShielded(recipient, newCoin);
        activeCoins = insert(activeCoins, writeCoin(newCoin, right(kernel.self())));

        return [];
    }
}
```

**What's public:** Token name, total supply, minting authority, and the Merkle tree of active coins.  
**What's private:** Who owns which coin, and the amounts in individual coins.  
**Why the Merkle tree is public:** The UTXO model requires the tree to exist on-chain so spenders can prove a coin exists without revealing which one.

---

## Pattern 3: Access Control with Private Credentials

Access control requires a public gatekeeper (the admin address) but should preserve user privacy during authorization checks.

```compact
pragma language_version >= 0.16.0;

import CompactStandardLibrary;

contract AccessControl {

    // PUBLIC: Who manages access
    export sealed ledger admin: Bytes<32>;

    // PUBLIC: Credential registry (commitments only)
    export sealed ledger credentialTree: MerkleTree<32, Bytes<32>>;

    constructor(adminKey: Bytes<32>) {
        admin = adminKey;
        credentialTree = emptyMerkleTree();
    }

    export circuit grantAccess(credentialCommitment: Bytes<32>): [] {
        assert(kernel.origin() == admin, "Admin only");
        credentialTree = insert(credentialTree, credentialCommitment);
        return [];
    }

    // PRIVATE: Prove access without revealing identity
    export circuit accessResource(
        credentialSecret: Bytes<32>,
        credentialCommitment: Bytes<32>
    ): [] {
        assert(
            contains(credentialTree, credentialCommitment),
            "Access denied"
        );
        // The ZK proof proves membership without revealing which credential
        // Resource access logic goes here
        return [];
    }
}
```

**What's public:** The admin address and the credential registry (as commitments).  
**What's private:** The user's actual credential and which credential they used.  
**The tradeoff:** The credential tree is public, but it only contains commitments — cryptographic hashes that don't reveal the underlying credentials.

---

## Anti-Patterns to Avoid

### 1. Accidentally Disclosing Merkle Paths

When you pass a Merkle tree membership proof as a witness, the path reveals the *position* of the leaf. If positions correlate with user behavior (e.g., "the 5th voter"), you've leaked information.

**Fix:** Use nullifier-based approaches where the proof doesn't depend on position.

### 2. Over-Exposing Ledger State

Every `export` field is queryable by anyone. Developers sometimes export fields for debugging convenience that shouldn't be public.

```compact
// BAD: Exposing internal state for debuggability
export ledger internalCounter: Uint<64>;  // Only used internally

// GOOD: Keep it sealed or non-exported
sealed ledger internalCounter: Uint<64>;  // Not externally visible
```

### 3. Using `disclose()` Without Considering the Consequences

The `disclose()` function explicitly makes a private value public. It's intentional — and that's the point. Before using it, ask: "Does this value need to be public? Does revealing it leak user behavior?"

```compact
// Intentional disclosure — aggregate value, not individual
export circuit getAverageBalance(): Uint<128> {
    const avg = totalBalance / numUsers;
    return disclose(avg);  // Average reveals nothing about individuals
}
```

### 4. Storing Redundant Public State

If a value can be derived from existing on-chain data, storing it separately wastes DUST and creates consistency risks.

---

## Cost and Performance Considerations

Public state costs DUST to write and read on every transaction. Private state costs compute time for proof generation but no on-chain storage.

| Factor | Public State | Private State |
|---|---|---|
| On-chain storage | Yes (DUST cost) | No |
| Proof generation | Minimal | Significant (larger proofs) |
| Transaction size | Smaller | Larger (includes proofs) |
| Queryability | Instant (on-chain) | Requires user cooperation |

**Rule of thumb:** Minimize public state to what's strictly necessary. Every public field is a permanent, immutable part of the blockchain. Private witnesses are ephemeral and cost nothing after the transaction confirms.

---

## Putting It All Together

When you sit down to design a Midnight contract, follow this process:

1. **List every piece of data** your contract needs.
2. **Run each item through the decision matrix** above.
3. **Default to private.** Only make something public if there's a concrete reason.
4. **Check for information leaks** — does any public value, combined with other public values, reveal private behavior?
5. **Verify the contract can enforce its rules** with only the public state available.

The pattern that emerges in most privacy-preserving dApps is: **private inputs, public aggregates, sealed administrative state.** Individual actions stay hidden; the contract's public state reflects only what the network needs to verify.

---

## Further Reading

- [Midnight Developer Documentation](https://docs.midnight.network/)
- [Compact Language Reference](https://docs.midnight.network/build/reference/compact/)
- [Midnight Network Litepaper](https://docs.midnight.network/getting-started)
- [Developer Forum](https://forum.midnight.network/)
- [Discord Community](https://discord.com/invite/midnightnetwork)
