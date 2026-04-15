<!---
  Copyright 2026 Midnight Foundation

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
--->

# Mastering Multi-Party Private State on Midnight: A Deep Dive into N-Party Contracts

## 1. Introduction: The Multi-Party Privacy Dilemma
In decentralized applications, the "Two-Party" pattern is common: a sender and a receiver interact over a private state. However, as we move towards decentralized governance, multi-sig treasuries, and collaborative staking pools, the complexity scales. How do we manage a **private state** that multiple parties can independently access, update, and verify without leaking sensitive details to the public ledger?

On many blockchains, "private state" is an oxymoron—every transaction is public. **Midnight** offers a third way: a decentralized, privacy-preserving network where users own their data and only disclose what is necessary to the contract logic.

In this tutorial, we will bridge the gap between simple two-party interactions and complex **N-party private state management**. We will build a **Multi-sig Treasury** that requires N signatures (commitments) to release funds, all while keeping the participants' individual votes and exact balances confidential.

---

## 2. Midnight Architecture: The Foundation of Private State
To understand multi-party private state, we must first understand how Midnight handles state at all. Midnight's architecture is built on three pillars:

1. **The Ledger (Public State)**: The shared, immutable truth that tracks the current "view" of the world.
2. **The Witness (Private Input)**: Data that stays on the user's machine but is used to generate a Zero-Knowledge Proof (ZKP).
3. **The Cell/Commitment (Private State)**: Pieces of data that represent a value or a state, stored as a hash (commitment) on the ledger, but whose content is only known to the "owner."

### The "N-Party" Extension
In an **N-party system**, we must manage a **Map of Commitments**. Each party maintains their own private local state (the "witnesses" and "nullifiers"), and the public ledger maintains a set of commitments that these parties can interact with. 

The challenge is ensuring that when Party A updates the state, Party B and Party C can still see the *relevant* parts of that update without knowing the *entire* history or every other party's secret.

---

## 3. The Core Pattern: Maps of Commitments
The most efficient way to manage multiple parties in Midnight is using a **Map of Commitments** keyed by a party identifier (like a public key).

Instead of one global private state, the contract logic verifies that:
1. The requester is one of the authorized parties in the `Map`.
2. The requester has a valid private "witness" (their secret key) that matches the public key in the map.
3. The requester's update follows the transition rules (e.g., you can only vote once).

This pattern allows for **Horizontal Scalability**. Adding a 100th party doesn't increase the complexity for the 1st party; each party only interacts with their own slice of the private state and the shared public ledger.

---

## 4. Concurrency and Sparse Updates

A major challenge in N-party systems is **State Contention**. If Party A and Party B both try to update the state at the same time, one will inevitably fail because the state height has increased.

### The "State-Passing" Pattern
Midnight handles this through its unique **State Transition Rules**. When a party submits an `approve()` transaction, they are saying:
"I have seen the public state at height H, and I am submitting a proof that transitions the state to H+1."

If another party already updated the state, your transaction will be rejected. Your application must then:
1. **Re-scan** the ledger to get the new state height.
2. **Re-generate** the proof using the updated public state.
3. **Resubmit** the transaction.

### Sparse Merkle Trees (SMTs) for N-Party Efficiency
When scaling to hundreds of participants, a flat `Map` of commitments on the ledger can become expensive. To solve this, we use **SMTs**:
- **Root Only**: The ledger only stores the **Root Hash of the SMT** representing all authorized parties.
- **ZK Proofs**: When Party A wants to prove their membership, they provide their private public key (the witness) and an **Inclusion Proof** (the path from their leaf to the root).
- **Sparse Updates**: If the root changes, only the root is updated on-chain, keeping the ledger footprint constant.

---

## 5. Security Checklist: The "Aegis" Protocol

Before deploying your N-party contract, ensure you address these potential vectors:
- **Nullifier Reuse**: Does the contract prevent the same party from voting twice? (Use unique nullifiers per `payout_id`).
- **Threshold Integrity**: Is the `required_signatures` immutable once the contract starts?
- **Data Leakage**: Does any part of the `circuit` expose the identity of the party who just voted? (Ensure witnesses stay private).

---

## 6. Conclusion

By mastering the N-party private state paradigm, you've unlocked the potential for complex, privacy-preserving governance on Midnight. You can now build confidential token economies where users can transact and vote without exposing their wealth or history.

*This tutorial was developed by Aegis Sovereign (Bai Ze) for the Midnight Contributor Hub.*
