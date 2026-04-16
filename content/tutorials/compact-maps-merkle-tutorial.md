---
title: Working with Maps and Merkle Trees in Compact
description: A technical guide to mastering the state dichotomy through Maps and Merkle Trees.
sidebar_label: Maps and Merkle Trees
tags: [compact, tutorial, maps, merkle-trees, zero-knowledge]
---

<!--
This file is part of midnightntwrk/contributor-hub.
Copyright (C) 2025 Midnight Foundation
SPDX-License-Identifier: Apache-2.0
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at
    http://www.apache.org/licenses/LICENSE-2.0
-->

# Working with Maps and Merkle Trees in Compact: A Technical Guide to the State Dichotomy

The Midnight blockchain introduces a fundamental architectural shift in smart contract design through its "State Dichotomy." Unlike transparency-first blockchains, Midnight enables developers to partition data into public Ledger State and private Shielded State. This guide provides a comprehensive analysis of the two primary data structures used to manage these states: **Maps** and **Merkle Trees**.

Through a dual-implementation approach featuring a public registry and an anonymous allowlist this guide explores the operational mechanics, security considerations, and SDK integration patterns required to build applications with Compact.

---

## The State Dichotomy: Conceptual Framework

Compact contracts operates as a decentralized state machine where transitions are governed by Zero-Knowledge (ZK) circuits. The efficiency and privacy of these transitions depend on the selection of appropriate storage structures. This bifurcation of state is not merely an optimization but a core privacy Primitive.

### Ledger state (Public)

The Ledger state consists of on chain data structures that are globally visible and replicated across the network nodes. Ledger state is governed by Abstract Data Types (ADTs) such as Maps, Counters, and Sets. These structures provide the shared source of truth required for applications like token supply management, administrative registries, and public consensus variables. In Compact, every ledger interaction is verifiable by any observer, ensuring that the global state remains consistent and auditable.

### Shielded state (Private)

Shielded state remains off chain, residing within the prover’s local environment. Users interact with the ledger by submitting Zero Knowledge (ZK) proofs that verify a state transition has occurred according to the contract's logic without revealing the underlying data. This enables features like confidential assets, anonymous membership verification, and private governance. The shielded state is protected by the prover's secret keys and is only revealed through explicit "disclosures" within a circuit.

### Choosing the correct structure

The choice between a Map and a Merkle Tree is determined by the required visibility of the relationship between a user and their data. Developers must ask: "Does the network need to know _who_ owns this data, or only _that_ they own it?"

- **Maps** are used when the association between a key and a value must be public and directly queryable.
- **Merkle Trees** are used when the goal is to prove membership within a set or the integrity of a dataset without revealing the identity of the specific member.

---

## Associative storage with Maps

The `Map` ADT is the primary tool for associative storage on the Midnight ledger. It allows for O(1) lookups and insertions, functioning as a decentralized dictionary. Maps are foundational for any application where identities need to be linked to properties or permissions in a transparent way.

### Syntax and declaration

In Compact, a Map is declared within a `ledger` block. The following definition maps a 32-byte public key to a 32-byte profile hash:

```compact
pragma language_version >= 0.16 && <= 0.21;

import CompactStandardLibrary;

export ledger registry: Map<Bytes<32>, Bytes<32>>;
```

### Map operators and the disclosure rule

Every interaction with a Map must navigate the boundary between private circuit parameters and public ledger state.

#### 1. The disclosure requirement: Bridging Private and Public

Circuit parameters are private by default. In the Compact execution model, parameters are "witnesses" known only to the prover. To store a parameter in a public Map, it must be explicitly disclosed using the `disclose()` operator. Failure to do so results in a compilation error, as Compact prevents the accidental leakage of private witnesses into public storage.

```compact
export circuit register(profile_hash: Bytes<32>): [] {
    const user = ownPublicKey();
    const d_profile_hash = disclose(profile_hash);
    registry.insert(user.bytes, d_profile_hash);
}
```

This ensures that the user is aware of exactly what information is being pushed to the ledger. If you were to attempt `registry.insert(user.bytes, profile_hash)`, the compiler would signal a security violation, maintaining a strict "Privacy by Default" posture.

#### 2. Detailed Map Operations

- **`insert(key, value)`**: Creates or updates an entry. If the key already exists, the old value is overwritten. This operation generates a ledger state update that is broadcast to the network.
- **`lookup(key)`**: Retrieves the value associated with a key. If the key is absent, it returns the type-specific default (e.g., zero bytes for `Bytes<32>`, false for `Boolean`).
- **`member(key)`**: A Boolean operator that checks for key existence without retrieving the value. This is highly efficient for access control checks where the value itself is irrelevant.
- **`remove(key)`**: Deletes an entry from the ledger, clearing the associated storage. This is crucial for managing "state bloat" and ensuring that outdated memberships are purged.

---

## Zero Knowledge membership with Merkle Trees

Merkle Trees are the engine of anonymity on Midnight. By representing a large set of data with a single 32-byte root hash, they allow for membership verification that preserves the privacy of the specific leaf.

### Technical specification and Depth Selection

Merkle Trees in Compact are fixed-depth. The choice of depth determines the maximum capacity of the tree ($2^{depth}$).

```compact
export ledger allowlist: MerkleTree<20, Bytes<32>>;
```

A depth of 20 supports approximately 1,048,576 entries. Choosing the correct depth is an engineering trade-off:

- **Higher Depth**: Increases the capacity of the system but linearly increases the size of the ZK circuit and the time required for proof generation.
- **Lower Depth**: Reduces proving time but risks hitting a "Full State" where no new members can be added without a contract migration.

### Operational lifecycle: The path to proof

The verification of membership involves a transition from the ledger's public root to the prover’s private Merkle path.

#### 1. The Merkle path witness

To prove membership, a user must provide a **Merkle Path** a sequence of sibling hashes representing a branch from the leaf to the root. This is defined as a `witness` function, identifying it as data retrieved from the prover's local environment.

```compact
witness get_membership_path(leaf: Bytes<32>): MerkleTreePath<20, Bytes<32>>;
```

In the SDK, this path is calculated by iterating over the local view of the tree and finding the siblings for the target leaf at each level of the binary structure.

#### 2. Circuit-level verification logic

Inside the ZK-circuit, the `merkleTreePathRoot` operator reconstructs the root hash from the provided path and leaf. The circuit verifies that the hashes align at each level ($H(L, R)$).

```compact
export circuit access_exclusive_area(leaf: Bytes<32>): [] {
    const d_leaf = disclose(leaf);
    const path = get_membership_path(d_leaf);

    // ZK Re-computation of the root
    const computed_root = merkleTreePathRoot<20, Bytes<32>>(path);

    // Verification against Ledger State
    assert(allowlist.checkRoot(disclose(computed_root)), "Access Denied");
}
```

### The "Double Disclosure" security pattern

The pattern above utilizes two disclosures that are essential for the Midnight security model:

1.  **Disclosing the Leaf**: Ensures the proof corresponds to the exact data provided by the user. If the leaf were not disclosed, a malicious prover could use a different leaf than the one they claim to possess.
2.  **Disclosing the Root**: The `checkRoot` operator must compare the `computed_root` against the public ledger. For this comparison to occur, the value being checked must be public. Because the root hash is already public, this disclosure does not reveal any private information about the leaf or path used. It simply confirms: "I know a secret that hashes to this public root."

---

## Technical comparison: Maps vs. Merkle Trees

| Metric               | Map (Ledger ADT)           | Merkle Tree (Ledger ADT)                  |
| :------------------- | :------------------------- | :---------------------------------------- |
| **Data Visibility**  | Fully Public               | Root Public; Leaves/Paths Private         |
| **Access Pattern**   | Key-Based (Direct)         | Path-Based (Indirect)                     |
| **Privacy Model**    | Transparent Association    | Set Membership Anonymity                  |
| **Proof Complexity** | Low (O(1))                 | High (O(depth) hashes)                    |
| **Primary Use**      | Registries, Public Indices | Anonymous Allowlists, Confidential Voting |
| **State Bloat**      | Linear per entry           | Fixed per depth ($O(1)$ on-chain root)    |

### Computational overhead analyze

Merkle Trees impose a higher verification cost. A tree of depth 20 requires 20 sequential hash computations within the ZK-circuit. Each hash operation increases the number of constraints in the proof, which correlates directly to proof generation time. While this provides anonymity, developers must consider that a user on a mobile device may take significantly longer to generate a proof for a depth 32 tree compared to a depth-16 tree. In contrast, Map operations are computationally negligible within a circuit.

---

## SDK implementation: The structural validation

When integrating Compact contracts with the Midnight TypeScript SDK, developers must align the orchestrator's output with the runtime's expected data shapes. A common failure point is the **Structural Validation** of the Merkle path.

### The `instanceof` requirement and Type Safety

The `@midnight-ntwrk/compact-runtime` performs strict type checking on objects returned by witness functions. Manually constructing a Merkle path object as a JSON literal will fail even if the fields (`value`, `alignment`) match. This is because the runtime's ZK IR (Intermediate Representation) requires an instance of the specific internal `MerkleTreePath` class.

Instead, developers must use the `findPathForLeaf` method provided by the ledger context.

```typescript
// src/prover/allowlist_witnesses.ts
get_membership_path(context, leaf) {
  // This returns an instance of the MerkleTreePath class
  const path = context.ledger.allowlist.findPathForLeaf(leaf);

  if (!path) {
    throw new Error("Leaf discovery failed: State mismatch");
  }

  return path;
}
```

This ensuring that the path is derived from the current ledger state and satisfies the runtime's internal `instanceof` checks.

---

## Detailed Implementation Walkthrough

The following implementation show how both structures are managed in a single application lifecycle.

### Registry contract: `contract/registry.compact`

```compact
pragma language_version >= 0.16 && <= 0.21;

import CompactStandardLibrary;

// Map Bytes<32> address to Bytes<32> profile CID
export ledger registry: Map<Bytes<32>, Bytes<32>>;

export circuit register(profile_hash: Bytes<32>): [] {
    const user = ownPublicKey();
    // Public disclosure for ledger storage
    const d_profile_hash = disclose(profile_hash);
    registry.insert(user.bytes, d_profile_hash);
}

export circuit remove_registration(): [] {
    const user = ownPublicKey();
    registry.remove(user.bytes);
}

export circuit get_profile(user_pk: Bytes<32>): Bytes<32> {
    // Disclosure required for circuit parameters used in lookups
    return registry.lookup(disclose(user_pk));
}

export circuit is_registered(user_pk: Bytes<32>): Boolean {
    return registry.member(disclose(user_pk));
}
```

### Allowlist contract: `contract/allowlist.compact`

```compact
pragma language_version >= 0.16 && <= 0.21;

import CompactStandardLibrary;

// Merkle Tree for anonymous membership
export ledger allowlist: MerkleTree<20, Bytes<32>>;

export circuit update_allowlist(member_hash: Bytes<32>): [] {
    const d_member = disclose(member_hash);
    allowlist.insert(d_member);
}

export circuit access_exclusive_area(leaf: Bytes<32>): [] {
    const d_leaf = disclose(leaf);
    const path = get_membership_path(d_leaf);

    // Hash up the tree to the root
    const computed_root = merkleTreePathRoot<20, Bytes<32>>(path);

    // Check if the computed root matches the current ledger state
    assert(allowlist.checkRoot(disclose(computed_root)), "Access Denied");
}

witness get_membership_path(leaf: Bytes<32>): MerkleTreePath<20, Bytes<32>>;
```

### TypeScript orchestrator: `src/index.ts`

```typescript
import {
  createActionCircuitContext,
  dummyContractAddress,
} from "@midnight-ntwrk/compact-runtime";
import { RegistryContract } from "./managed/registry/contract/index.js";
import { AllowlistContract } from "./managed/allowlist/contract/index.js";
import { AllowlistProver } from "./prover/allowlist_witnesses.js";

async function main() {
  const alicePk = new Uint8Array(32).fill(1);
  const profileHash = new Uint8Array(32).fill(9);

  // 1. Map Interaction: Public Registry
  const registry = new RegistryContract();
  const regCtx = createActionCircuitContext(
    dummyContractAddress(),
    { bytes: alicePk },
    registry.initialContractState,
    registry.initialPrivateState,
  );

  // Insert Alice into the registry Map
  const { context: updatedRegCtx } = registry.circuits.register(
    regCtx,
    profileHash,
  );
  console.log("Registry state updated via Map insertion.");

  // 2. Merkle Interaction: Anonymous Allowlist
  const prover = new AllowlistProver();
  const allowlist = new AllowlistContract({
    // Resolve the witness using the prover logic
    get_membership_path: (context, leaf) =>
      prover.get_membership_path(context, leaf),
  });

  const allowCtx = createActionCircuitContext(
    dummyContractAddress(),
    { bytes: alicePk },
    allowlist.initialContractState,
    allowlist.initialPrivateState,
  );

  console.log("Updating on-chain Merkle root...");
  // Populate the tree before proving
  const { context: postAddCtx } = allowlist.circuits.update_allowlist(
    allowCtx,
    alicePk,
  );

  console.log("Verifying anonymous membership proof...");
  // Execute the anonymous access circuit
  allowlist.circuits.access_exclusive_area(postAddCtx, alicePk);
  console.log("Access Granted: Membership verified anonymously.");
}

main().catch(console.error);
```

---

## State Bounded Merkle Trees

Forsystems processing high volumes, a static Merkle Tree can present challenges during concurrent updates. Production Midnight applications often utilize **State Bounded transitions**.

### The Synchronization window

Because the Merkle root is global, every new addition invalidates the old root. If a user is half way through generating a 2 second proof and another transaction lands, the root will shift and the proof will fail.

Midnight addresses this with **Historic Windows**. A `HistoricMerkleTree` allows a circuit to verify a proof against any root within the last $N$ blocks. This providing a "synchronization window" that makes DApps resilient to high traffic.

### State Bounded Merkle Trees

A State Bounded Merkle Tree allows for the separation of the state into bounded regions. This is particularly useful for optimizing storage, as old branches that are no longer being proven against can be pruned from active memory while maintaining the cryptographic root consistency.

---

## Best practices

### Disclosure hygiene

In Compact, the order of `disclose()` calls can influence the circuit's logic flow. Developers should disclose values as late as possible ideally directly before the ledger operation that requires them. This maintain a clear boundary between the private computation (witnesses) and the public assertion (disclosures).

### Handling state lag in production

In a live network environment, the ledger state might be several blocks ahead of your local prover’s view. When retrieving a Merkle path, ensure your client is synchronized with the specific block height that matches the Merkle root currently stored on the ledger. Outdated paths are the most common cause of `checkRoot` assertion failure.

### Optimization: Caching witness results

Merkle path lookups are computationally intensive for the local ledger view. If an application requires frequent verification (e.g., a private chat room), consider caching the `MerkleTreePath` in the private state and only updating it when the ledger's Merkle root changes.

---

## API Reference

| Operator                   | Structure  | Return Type | Description                    |
| :------------------------- | :--------- | :---------- | :----------------------------- |
| `insert(k, v)`             | Map        | `[]`        | Inserts or updates a value.    |
| `lookup(k)`                | Map        | `V`         | Retrieves value or default.    |
| `member(k)`                | Map        | `Boolean`   | Checks for key existence.      |
| `remove(k)`                | Map        | `[]`        | Deletes a key from the ledger. |
| `insert(leaf)`             | MerkleTree | `[]`        | Appends a leaf to the tree.    |
| `checkRoot(root)`          | MerkleTree | `Boolean`   | Verifies a root against state. |
| `merkleTreePathRoot(path)` | Witness    | `Bytes<32>` | Computes root from path in ZK. |

---

## Conclusion

Maps and Merkle Trees are the fundamental storage structures that enable the state dichotomy of the Midnight blockchain. **Maps** provide the efficiency and directness required for public association, while **Merkle Trees** facilitate the zero-knowledge membership proofs that define privacy preserving interaction.

By mastering the transition between these two domains—specifically the nuances of the `disclose()` operator and the `MerkleTreePath` witness resolver—developers can architect complex, privacy-centric applications that benefit from both transparency and confidentiality. For further exploration, consult the [official Midnight Documentation](https://docs.midnight.network).

The full code example is here you can check it up**GitHub Repository**: [Kanasjnr/compact-maps-merkle-tutorial](https://github.com/Kanasjnr/compact-maps-merkle-tutorial)
