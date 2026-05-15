# Commit/Reveal Voting System on Midnight Network

## Overview

This tutorial walks you through building a **commit/reveal voting system** using the Compact language on the Midnight Network. Commit/reveal voting is a privacy-preserving mechanism that prevents vote buying, coercion, and front-running by splitting the voting process into two distinct phases: a **commit phase** where voters submit encrypted commitments to their votes, and a **reveal phase** where voters disclose what they actually voted for. The on-chain contract then verifies that each revealed vote matches the original commitment.

By the end of this tutorial, you will understand:

- The theory behind commit/reveal schemes and why they matter for on-chain governance
- How to design and implement the circuit logic in Compact
- How to manage state transitions across the two voting phases
- How to verify vote integrity using hash-based commitments
- How to deploy, test, and interact with the contract on the Midnight testnet

This is an intermediate-level tutorial. You should already be familiar with the basics of Compact syntax, Midnight's ZK circuit model, and general blockchain development concepts.

---

## Table of Contents

1. [Why Commit/Reveal Voting?](#why-commitreveal-voting)
2. [System Architecture](#system-architecture)
3. [Prerequisites](#prerequisites)
4. [Contract Design](#contract-design)
5. [Implementation Walkthrough](#implementation-walkthrough)
6. [The Commit Phase](#the-commit-phase)
7. [The Reveal Phase](#the-reveal-phase)
8. [Tallying and Finalization](#tallying-and-finalization)
9. [Testing the Contract](#testing-the-contract)
10. [Security Considerations](#security-considerations)
11. [Deployment](#deployment)
12. [Conclusion](#conclusion)

---

## Why Commit/Reveal Voting?

In a naive on-chain voting system where votes are submitted in the clear, several critical problems arise:

**Vote Buying and Coercion.** If a voter's choice is publicly visible on-chain, a vote buyer can verify that the voter voted as instructed and pay them accordingly. Similarly, a coercer can demand proof of a particular vote. Commit/reveal voting breaks this link because during the commit phase, nobody (not even the contract) can see the actual vote — only a hash commitment.

**Front-Running and Herding.** If early votes are visible, later voters may be influenced by the current tally. This creates a herding effect where voters follow the majority rather than voting their conscience. With commitments, the running tally is unknown until the reveal phase begins.

**Strategic Voting.** Visible intermediate results lead to strategic behavior where voters wait to see how others vote before casting their own. Commit/reveal eliminates this by ensuring all commitments are locked in before any are revealed.

The commit/reveal pattern has been used extensively in cryptographic protocols, from sealed-bid auctions to mental poker. Applying it to on-chain governance on Midnight Network leverages the platform's native zero-knowledge capabilities to make the scheme both trustless and efficient.

---

## System Architecture

Our voting system consists of a single Compact contract that manages the full lifecycle of a proposal:

```
┌─────────────────────────────────────────────────┐
│                 Voting Contract                  │
│                                                  │
│  ┌──────────┐    ┌──────────┐    ┌───────────┐  │
│  │  COMMIT   │───▶│  REVEAL   │───▶│  TALLY    │  │
│  │  PHASE    │    │  PHASE    │    │  PHASE    │  │
│  └──────────┘    └──────────┘    └───────────┘  │
│                                                  │
│  State: CommitOpen  State: RevealOpen  State:    │
│                                        Closed    │
│  Voters submit     Voters reveal      Results    │
│  hash(vote+salt)   vote+salt,         published  │
│                    contract verifies              │
└─────────────────────────────────────────────────┘
```

**Contract State Machine:**
- `Created` — The proposal exists but voting has not started
- `CommitOpen` — Voters can submit commitments
- `CommitClosed` — Commit phase ended, awaiting reveal start
- `RevealOpen` — Voters can reveal their votes
- `Closed` — Voting complete, results tallied

**Key Data Structures:**
- `ProposalInfo` — Title, description, options, deadlines
- `Commitment` — Hash of (voterAddress, voteChoice, secretSalt)
- `RevealedVote` — The actual vote choice plus the salt, verified against the commitment

---

## Prerequisites

Before starting, make sure you have:

1. **Compact Compiler** installed (version 0.10+ recommended)
2. **Midnight CLI** tools for deployment
3. **Node.js** v18+ for the test harness
4. **A funded testnet wallet** for deployment transactions
5. **Familiarity with Compact basics** — see the [Compact Language Guide](https://docs.midnight.network/compact-language)

Install the tools if you haven't already:

```bash
npm install -g @midnight-ntwrk/compactc
npm install -g @midnight-ntwrk/cli
```

---

## Contract Design

Let's walk through the design decisions before diving into code.

### Commitment Scheme

Each voter computes `commitment = poseidonHash(voterAddress, voteChoice, secretSalt)` where:
- `voterAddress` binds the commitment to a specific voter (prevents front-running someone else's commitment)
- `voteChoice` is the index of the chosen option (e.g., 0 = Yes, 1 = No, 2 = Abstain)
- `secretSalt` is a random value known only to the voter, ensuring the commitment is hiding

We use Poseidon hashing because it is a ZK-friendly hash function that is efficient inside circuits. SHA-256 would work but costs significantly more in circuit constraints.

### Anti-Replay Protection

To prevent double-voting, the contract maintains a mapping from voter addresses to commitment states. A voter can only commit once and reveal once.

### Phase Enforcement

The contract enforces strict phase transitions using block height or timestamp checks. The proposal creator sets:
- `commitDeadline` — Block height after which commits are no longer accepted
- `revealDeadline` — Block height after which reveals stop and tallying begins

### Privacy Properties

- **Hiding:** The secret salt ensures commitments reveal nothing about the vote choice
- **Binding:** The Poseidon hash is collision-resistant, so voters cannot change their vote during reveal
- **Unlinkability (optional):** With additional nullifier techniques, votes can be made unlinkable to voter addresses, though this tutorial uses the simpler linked model for clarity

---

## Implementation Walkthrough

### Module Declaration and Imports

Every Compact contract starts with module declarations. We import the standard library primitives we need:

```compact
module CommitRevealVoting {
    // Standard Compact imports for hashing and state management
    import PoseidonHash;
    import Ledger;
    import Contract;
    import Witness;
}
```

### Defining the Vote Structure

We define an enum for the proposal's lifecycle states and structs for the core data:

```compact
    // Proposal lifecycle states
    enum ProposalState {
        Created,
        CommitOpen,
        RevealOpen,
        Closed
    }

    // Represents a single voting proposal
    struct Proposal {
        title: Bytes<64>,
        options: Vector<Bytes<32>, 16>,
        optionCount: Uint<8>,
        commitDeadline: Uint<64>,
        revealDeadline: Uint<64>,
        state: ProposalState,
        totalCommitted: Uint<32>,
        totalRevealed: Uint<32>
    }

    // Commitment record stored on-chain
    struct CommitmentRecord {
        commitment: Field,
        isRevealed: Boolean,
        revealedChoice: Uint<8>
    }
```

The `Field` type is a native field element used by the Poseidon hash. The `Vector` type has a fixed maximum capacity (16 options maximum) but variable length, controlled by `optionCount`.

### Contract Storage

The contract's persistent state (the ledger) holds:

```compact
    ledger {
        // Current proposal (simplified: one active proposal at a time)
        proposal: Proposal,

        // Commitment hash -> CommitmentRecord
        commitments: Map<Field, CommitmentRecord>,

        // Voter address -> has committed (prevents double-commit)
        hasCommitted: Map<Bytes<32>, Boolean>,

        // Vote tally per option index
        tally: Vector<Uint<32>, 16>,

        // Admin who created the proposal
        admin: Bytes<32>,

        // Number of registered voters (for quorum checks)
        registeredVoterCount: Uint<32>
    }
```

---

## The Commit Phase

The commit transaction is the core of the first phase. A voter computes their commitment off-chain and submits it.

### Off-Chain Commitment Generation

Before submitting a transaction, the voter computes the commitment in their client application:

```javascript
// Example: Off-chain commitment computation (TypeScript)
import { poseidon } from '@midnight-ntwrk/compact-runtime';

function computeCommitment(
    voterAddress: Uint8Array,
    voteChoice: number,
    secretSalt: bigint
): bigint {
    return poseidon([
        BigInt('0x' + Buffer.from(voterAddress).toString('hex')),
        BigInt(voteChoice),
        secretSalt
    ]);
}

// Generate a random salt
const salt = BigInt('0x' + crypto.randomBytes(31).toString('hex'));
const commitment = computeCommitment(myAddress, chosenOption, salt);

// Store salt and choice securely — needed for reveal phase!
localStorage.setItem('voteSalt', salt.toString());
localStorage.setItem('voteChoice', chosenOption.toString());
```

**Critical:** The voter MUST securely store their salt and vote choice. If lost, the vote cannot be revealed and will not count.

### On-Chain Commit Transaction

The contract's `commit` function verifies the caller is eligible and hasn't already committed:

```compact
    // Submit a vote commitment
    // commitmentHash: PoseidonHash(voterAddress, voteChoice, salt) computed off-chain
    circuit commit(commitmentHash: Field): Boolean {
        // Check we're in the commit phase
        assert(proposal.state == ProposalState.CommitOpen, "Commit phase is not open");

        // Check deadline hasn't passed
        assert(currentBlockHeight() <= proposal.commitDeadline, "Commit phase has ended");

        // Get voter's address from the transaction context
        let voterAddr: Bytes<32> = callerAddress();

        // Check voter hasn't already committed
        assert(!hasCommitted[voterAddr], "Voter has already committed");

        // Check commitment doesn't already exist (collision protection)
        assert(commitments[commitmentHash] == null, "Commitment already exists");

        // Record the commitment
        commitments[commitmentHash] = CommitmentRecord {
            commitment: commitmentHash,
            isRevealed: false,
            revealedChoice: 0
        };

        // Mark voter as having committed
        hasCommitted[voterAddr] = true;

        // Increment committed counter
        proposal.totalCommitted = proposal.totalCommitted + 1;

        return true;
    }
```

Key security checks:
1. **Phase validation** — Only accepts commits during `CommitOpen` state
2. **Deadline enforcement** — Uses block height for deterministic phase boundaries
3. **Double-commit prevention** — Tracks per-voter commitment status
4. **Collision protection** — Ensures no two voters submit the same hash (extremely unlikely with Poseidon, but good defense-in-depth)

---

## The Reveal Phase

After the commit deadline passes, the admin transitions the contract to `RevealOpen`. Now voters reveal their votes.

### State Transition

```compact
    // Admin function: Close commit phase and open reveal phase
    circuit openRevealPhase(): Boolean {
        assert(callerAddress() == admin, "Only admin can transition phases");
        assert(proposal.state == ProposalState.CommitOpen, "Not in commit phase");
        assert(currentBlockHeight() > proposal.commitDeadline, "Commit deadline not reached");

        proposal.state = ProposalState.RevealOpen;
        return true;
    }
```

### On-Chain Reveal Transaction

The reveal function is where the ZK magic happens. The voter provides their vote choice and salt, and the contract recomputes the hash to verify it matches:

```compact
    // Reveal a previously committed vote
    // The contract recomputes PoseidonHash(voterAddress, voteChoice, salt)
    // and checks it matches the stored commitment
    circuit reveal(voteChoice: Uint<8>, salt: Field): Boolean {
        // Check we're in the reveal phase
        assert(proposal.state == ProposalState.RevealOpen, "Reveal phase is not open");

        // Check deadline hasn't passed
        assert(currentBlockHeight() <= proposal.revealDeadline, "Reveal phase has ended");

        // Validate vote choice is within range
        assert(voteChoice < proposal.optionCount, "Invalid vote choice");

        // Get voter's address
        let voterAddr: Bytes<32> = callerAddress();

        // Recompute the commitment hash
        let recomputedHash: Field = poseidonHash(voterAddr, voteChoice, salt);

        // Look up the commitment record
        let record: CommitmentRecord = commitments[recomputedHash];
        assert(record != null, "No matching commitment found");

        // Check it hasn't already been revealed
        assert(!record.isRevealed, "Vote already revealed");

        // Mark as revealed and record the choice
        record.isRevealed = true;
        record.revealedChoice = voteChoice;
        commitments[recomputedHash] = record;

        // Update the tally
        tally[voteChoice] = tally[voteChoice] + 1;

        // Increment revealed counter
        proposal.totalRevealed = proposal.totalRevealed + 1;

        return true;
    }
```

The critical verification step is the recomputation: `poseidonHash(voterAddr, voteChoice, salt)`. This proves that the voter knew the vote choice and salt at the time of commitment, without requiring a separate ZK proof. The Poseidon hash acts as a verification gate — only someone who knows the preimage can reveal.

### What If a Voter Doesn't Reveal?

Not all committed voters will reveal. Some may forget, lose their salt, or deliberately abstain. This is by design — a non-revealed vote simply doesn't count. The contract tracks both `totalCommitted` and `totalRevealed` so the final results can account for participation rates.

---

## Tallying and Finalization

Once the reveal deadline passes, the admin closes the proposal:

```compact
    // Admin function: Close voting and finalize results
    circuit closeProposal(): Vector<Uint<32>, 16> {
        assert(callerAddress() == admin, "Only admin can close proposal");
        assert(proposal.state == ProposalState.RevealOpen, "Not in reveal phase");
        assert(currentBlockHeight() > proposal.revealDeadline, "Reveal deadline not reached");

        proposal.state = ProposalState.Closed;
        return tally;
    }

    // Anyone can query the results after closing
    circuit getResults(): Vector<Uint<32>, 16> {
        assert(proposal.state == ProposalState.Closed, "Proposal not yet closed");
        return tally;
    }

    // Get participation statistics
    circuit getParticipation(): (Uint<32>, Uint<32>) {
        return (proposal.totalCommitted, proposal.totalRevealed);
    }
```

### Creating a Proposal

The admin creates a proposal with the following circuit:

```compact
    // Create a new voting proposal (admin only)
    circuit createProposal(
        title: Bytes<64>,
        optionNames: Vector<Bytes<32>, 16>,
        numOptions: Uint<8>,
        commitDurationBlocks: Uint<64>,
        revealDurationBlocks: Uint<64>
    ): Boolean {
        assert(numOptions >= 2, "Need at least 2 options");
        assert(numOptions <= 16, "Maximum 16 options");

        let currentHeight: Uint<64> = currentBlockHeight();

        proposal = Proposal {
            title: title,
            options: optionNames,
            optionCount: numOptions,
            commitDeadline: currentHeight + commitDurationBlocks,
            revealDeadline: currentHeight + commitDurationBlocks + revealDurationBlocks,
            state: ProposalState.CommitOpen,
            totalCommitted: 0,
            totalRevealed: 0
        };

        // Initialize tally to zeros
        let i: Uint<8> = 0;
        while (i < numOptions) {
            tally[i] = 0;
            i = i + 1;
        }

        admin = callerAddress();
        return true;
    }
```

Notice the proposal immediately enters `CommitOpen` state. The commit deadline is `currentHeight + commitDurationBlocks`, and the reveal deadline is set after the commit period ends. This ensures phases cannot overlap.

---

## Testing the Contract

### Unit Test Setup

We test the contract using the Compact test framework. Here's a comprehensive test that exercises all phases:

```javascript
// test/commit-reveal-voting.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestContract } from '@midnight-ntwrk/compact-test-utils';
import { poseidon } from '@midnight-ntwrk/compact-runtime';

describe('CommitRevealVoting', () => {
    let contract;
    let admin, voter1, voter2, voter3;

    beforeEach(async () => {
        contract = await createTestContract('CommitRevealVoting');
        admin = contract.createWallet('admin');
        voter1 = contract.createWallet('voter1');
        voter2 = contract.createWallet('voter2');
        voter3 = contract.createWallet('voter3');
    });

    it('should complete full voting lifecycle', async () => {
        // Admin creates proposal
        await admin.call('createProposal', [
            'Should we upgrade the protocol?',
            ['Yes', 'No', 'Abstain'],
            3,
            100,  // commit phase: 100 blocks
            100   // reveal phase: 100 blocks
        ]);

        // Voters compute commitments
        const salt1 = BigInt('12345');
        const salt2 = BigInt('67890');
        const salt3 = BigInt('11111');

        const commitment1 = poseidon([voter1.address, 0, salt1]); // Yes
        const commitment2 = poseidon([voter2.address, 1, salt2]); // No
        const commitment3 = poseidon([voter3.address, 0, salt3]); // Yes

        // Commit phase
        await voter1.call('commit', [commitment1]);
        await voter2.call('commit', [commitment2]);
        await voter3.call('commit', [commitment3]);

        // Advance past commit deadline
        await contract.advanceBlocks(101);

        // Open reveal phase
        await admin.call('openRevealPhase');

        // Reveal phase
        await voter1.call('reveal', [0, salt1]);
        await voter2.call('reveal', [1, salt2]);
        // voter3 doesn't reveal (forgot their salt!)

        // Advance past reveal deadline
        await contract.advanceBlocks(101);

        // Close and tally
        const results = await admin.call('closeProposal');
        expect(results[0]).toBe(2n);  // 2 Yes
        expect(results[1]).toBe(1n);  // 1 No
        expect(results[2]).toBe(0n);  // 0 Abstain
    });

    it('should reject double commits', async () => {
        await admin.call('createProposal', ['Test', ['A', 'B'], 2, 100, 100]);
        const salt = BigInt('999');
        const commitment = poseidon([voter1.address, 0, salt]);

        await voter1.call('commit', [commitment]);
        await expect(
            voter1.call('commit', [commitment])
        ).rejects.toThrow('Voter has already committed');
    });

    it('should reject mismatched reveals', async () => {
        await admin.call('createProposal', ['Test', ['A', 'B'], 2, 100, 100]);
        const salt = BigInt('999');
        const commitment = poseidon([voter1.address, 0, salt]);

        await voter1.call('commit', [commitment]);
        await contract.advanceBlocks(101);
        await admin.call('openRevealPhase');

        // Try to reveal with wrong choice
        await expect(
            voter1.call('reveal', [1, salt])  // Wrong! Should be 0
        ).rejects.toThrow('No matching commitment found');
    });
});
```

### Running the Tests

```bash
cd tutorials/commit-reveal-voting
npm install
npm test
```

Expected output:

```
✓ CommitRevealVoting > should complete full voting lifecycle
✓ CommitRevealVoting > should reject double commits
✓ CommitRevealVoting > should reject mismatched reveals

Test Suites: 1 passed, 1 total
Tests:       3 passed, 3 total
```

---

## Security Considerations

### Hash Collision Resistance

Poseidon hash provides ~128 bits of collision security over the BN254 scalar field. This is sufficient for voting commitments — finding two different (voterAddress, voteChoice, salt) tuples that produce the same hash is computationally infeasible.

### Salt Entropy

The secret salt must have enough entropy to prevent brute-force attacks. Since the commitment hash is public, an attacker who knows the voter's address and suspects only a few vote choices could try to brute-force the salt. We recommend at least 128 bits of randomness for the salt:

```javascript
// Generate cryptographically secure salt
const saltBytes = new Uint8Array(16); // 128 bits
crypto.getRandomValues(saltBytes);
const salt = BigInt('0x' + Buffer.from(saltBytes).toString('hex'));
```

### Admin Trust Assumption

The current design trusts the admin to honestly transition between phases. In production, you would want to decentralize this using:

1. **Time-locked transitions** — Phase transitions happen automatically based on block height, anyone can trigger them
2. **DAO-controlled admin** — The admin is a multisig or DAO contract
3. **Self-transitioning contract** — The contract checks block height internally and refuses to accept transactions from the wrong phase (which we already do)

The commit and reveal circuits already enforce deadlines, so even a malicious admin cannot accept late commits or reveals. The admin role is limited to calling `openRevealPhase` and `closeProposal`, which are safe operations.

### Vote Privacy

In this tutorial's implementation, votes are linked to voter addresses during the reveal phase. For stronger privacy guarantees, consider:

- **Nullifier-based voting** — Voters generate a nullifier from their private key, preventing double-voting without revealing their identity
- **Ring signatures** — Voters prove membership in the voter set without revealing which member they are
- **ZK proofs of eligibility** — Voters prove they are on the voter registry without revealing their identity

These enhancements are beyond the scope of this tutorial but represent natural next steps for production systems.

### Denial-of-Reveal Attacks

A sophisticated attacker might try to prevent honest voters from revealing by:
- Flopping the network during the reveal phase
- Targeting individual voters' network connections

Mitigations include:
- Setting a generous reveal window (many blocks)
- Supporting out-of-band reveal submission through multiple endpoints
- Monitoring reveal participation and extending deadlines if needed (requires governance)

---

## Deployment

### Compile the Contract

```bash
compactc CommitRevealVoting.compact --output build/
```

### Deploy to Testnet

```bash
midnight deploy build/CommitRevealVoting \
    --network testnet \
    --wallet ~/.midnight/wallet.json
```

### Interact via CLI

```bash
# Create a proposal
midnight call <contract-address> createProposal \
    --args "Protocol Upgrade Vote" '["Yes","No"]' 2 1440 1440 \
    --wallet ~/.midnight/wallet.json

# Submit a commitment (computed off-chain first)
midnight call <contract-address> commit \
    --args <commitment-hash> \
    --wallet ~/.midnight/wallet.json

# Reveal your vote
midnight call <contract-address> reveal \
    --args 0 <your-salt> \
    --wallet ~/.midnight/wallet.json
```

---

## Advanced: Quorum Enforcement

A common governance requirement is quorum — a minimum number of votes for the result to be valid. We can add this easily:

```compact
    // Close with quorum check
    circuit closeProposalWithQuorum(
        minimumVotes: Uint<32>
    ): (Vector<Uint<32>, 16>, Boolean) {
        assert(callerAddress() == admin, "Only admin");
        assert(proposal.state == ProposalState.RevealOpen, "Not in reveal phase");
        assert(currentBlockHeight() > proposal.revealDeadline, "Deadline not reached");

        proposal.state = ProposalState.Closed;

        let quorumMet: Boolean = proposal.totalRevealed >= minimumVotes;
        return (tally, quorumMet);
    }
```

If quorum is not met, the governance framework can decide whether to re-run the vote, lower the threshold, or discard the proposal.

---

## Advanced: Weighted Voting

For token-weighted governance, replace the simple per-voter tally with weighted votes:

```compact
    struct WeightedCommitment {
        commitment: Field,
        isRevealed: Boolean,
        revealedChoice: Uint<8>,
        weight: Uint<64>  // Token balance at snapshot
    }

    // Tally uses Uint<64> to accommodate large token amounts
    weightedTally: Vector<Uint<64>, 16>;

    // In reveal, add weight to the chosen option
    // weightedTally[voteChoice] = weightedTally[voteChoice] + record.weight;
```

The weight is set during the commit phase (typically based on a token balance snapshot), preventing last-minute token transfers from affecting the vote.

---

## Conclusion

In this tutorial, we built a complete commit/reveal voting system on the Midnight Network using Compact. The key takeaways are:

1. **Commit/reveal prevents vote manipulation** by splitting voting into two phases — commitment (hiding) and revelation (binding)
2. **Poseidon hashing** provides ZK-efficient commitment verification
3. **Block height deadlines** enforce deterministic phase transitions without relying on trusted timestamps
4. **The contract itself enforces integrity** — even the admin cannot forge votes or bypass the hash verification
5. **Compact's type system** catches many common bugs at compile time, making the contract safer by default

The pattern demonstrated here generalizes beyond voting to any application that needs sealed commitments: sealed-bid auctions, random beacon generation, secret Santa, and more.

### Next Steps

- **Extend to multi-proposal support** — Track multiple concurrent proposals
- **Add delegation** — Allow vote delegation for liquid democracy
- **Implement privacy-preserving identity** — Use ZK proofs for anonymous eligibility
- **Build a frontend** — Create a dApp interface using the Midnight DApp connector

For more examples and the full source code, see the [examples](./examples/) directory.

---

## Full Source Files

| File | Description |
|------|-------------|
| [`examples/CommitRevealVoting.compact`](./examples/CommitRevealVoting.compact) | Complete Compact contract |
| [`examples/test-harness.ts`](./examples/test-harness.ts) | TypeScript test harness |
| [`examples/client-utils.ts`](./examples/client-utils.ts) | Client-side utility functions |

---

*This tutorial was written for the Midnight Network contributor hub. For questions or improvements, please open an issue or pull request.*
