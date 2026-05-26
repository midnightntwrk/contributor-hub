<!--
This file is part of midnightntwrk/contributor-hub.
Copyright (C) 2026 Midnight Foundation
SPDX-License-Identifier: Apache-2.0
Licensed under the Apache License, Version 2.0 (the "License");
You may not use this file except in compliance with the License.
You may obtain a copy of the License at

	http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
-->

# Thinking in Compact: A Guide for Circom Developers

Circom developers already understand the most important idea behind zero-knowledge applications: write a program that constrains what a prover is allowed to claim, then verify a proof of that constrained computation. Compact keeps that idea, but places it inside Midnight's smart contract model. A Compact program is not only a circuit. It is a contract whose exported circuits can read and update public ledger state while proving statements about private local data.

That shift is the main adjustment. In Circom, you usually design a circuit as a pure verifier: public inputs enter the circuit, private inputs enter the witness, and all correctness rules become constraints. In Compact, you design state transitions. A user calls an exported circuit, the call can use private witness data supplied locally by the user's DApp, and the circuit proves that the transition from the old ledger state to the new ledger state is valid. Validators see the public transition and verify the proof, but they do not learn private witness values unless the circuit explicitly discloses them.

This tutorial maps familiar Circom concepts to Compact equivalents, then rewrites a simple Merkle membership verifier side by side. The example is intentionally small: a depth-3 tree, a private leaf, and a private Merkle path. The Circom version verifies membership against a public root. The Compact version stores the tree on the ledger and verifies that a witness-provided path matches the current ledger root.

## Concept Mapping

| Circom concept | Compact equivalent | What changes |
| --- | --- | --- |
| `signal input` | Circuit parameters, witness return values, or ledger fields | Compact separates public call data, private local data, and public on-chain state. |
| `signal output` | Circuit return values or ledger writes | Exported circuit returns and ledger writes are public unless they remain internal to proof generation. |
| `template` | `circuit`, `struct`, module, or whole contract | Compact circuits are functions. A contract is a state machine with circuits as entry points. |
| `component` | Helper circuit or witness function | Helper circuits are constrained. Witness functions are off-chain inputs and must be checked. |
| `===` constraints | `assert(...)` and typed computations | Compact uses assertions for conditions that must hold. Failed assertions abort the transaction. |
| Public inputs | Exported circuit arguments and ledger state | Ledger fields persist across transactions and are visible. |
| Private inputs | `witness` declarations | Witness values are supplied by TypeScript or JavaScript DApp code, not implemented in Compact. |
| R1CS mindset | State-transition mindset | The proof validates a contract call, not only a standalone calculation. |

The table is useful, but it can hide a key difference: Compact has multiple places where data can live. A Circom signal is a value inside one circuit execution. It may be public or private, but it does not persist after proof generation unless an application stores it somewhere else. Compact has normal circuit-local values too, but it also has a ledger. Ledger declarations are contract state. They survive from one transaction to the next and are publicly readable.

That makes Compact feel closer to a smart contract language than to a circuit DSL. For a Circom developer, the right first question changes from "what are my inputs and constraints?" to "what public state transition am I allowing, and what private facts must be proven before that transition is accepted?"

## Signals Become Data Boundaries

Circom asks you to label values with signal direction. For example, a Merkle verifier normally has:

- a public `root`;
- a private `leaf`;
- private sibling nodes;
- private direction bits;
- an output or constraint that says the computed root equals the public root.

Compact asks you to be more explicit about where each value comes from.

An exported circuit parameter is call data. If it is used directly in a public return value, a ledger write, or a cross-contract call, treat it as public. A `witness` value comes from local DApp code and is private by default. A ledger field is public on-chain state. A local `const` inside a circuit is part of the proof computation. These categories matter because Compact's privacy model is not "everything is private unless declared public" in the same way Circom developers may think about witness signals. Compact programs can update a public ledger, so the boundary between private proof data and public state must be designed.

Compact also forces explicit disclosure when private-derived values are written to public places. The `disclose(...)` wrapper is a deliberate acknowledgement that a value may become visible through a public output, ledger write, or contract call. For Circom developers, this is similar to deciding that a signal belongs in the public input list, but it is more local: the disclosure happens at the point where the value crosses into a public context.

## Templates Become Circuits and Contracts

Circom templates are reusable circuit definitions. Instantiating a template with `component` creates another constrained computation inside the same proof. Compact has helper circuits for the constrained-computation part:

```compact
circuit publicKey(round: Field, sk: Bytes<32>): Bytes<32> {
  return persistentHash<Vector<3, Bytes<32>>>(
    [pad(32, "domain"), round as Bytes<32>, sk]
  );
}
```

The helper circuit above is closer to a Circom template than to a smart contract method. It is not exported, so users do not call it directly. Other circuits can call it, and its computation is part of the proof.

An exported Compact circuit is different. It is a contract entry point. It may read ledger fields, assert conditions, and update ledger fields. This is the Compact equivalent of combining a Circom circuit with the application state that would otherwise live outside Circom.

That means you should not translate every Circom template into an exported Compact circuit. Translate reusable gadgets into helper circuits. Translate user actions into exported circuits. Translate application state into ledger declarations.

## Components Become Helper Circuits or Witnesses

Circom components are constrained. If you instantiate `Poseidon(2)` or `LessThan(64)`, its constraints become part of the R1CS. Compact helper circuits work similarly: calls to a helper circuit are proven as part of the exported circuit that uses them.

Witness functions are not the same thing. A Compact `witness` declaration describes data the DApp must provide locally:

```compact
witness privateLeaf(): Bytes<32>;
witness privatePath(leaf: Bytes<32>): MerkleTreePath<3, Bytes<32>>;
```

The Compact source declares the shape of the data, but it does not implement the function. The implementation lives in TypeScript or JavaScript. This is powerful because it keeps private state and lookup logic off-chain, but it creates a security rule that Circom developers should repeat until it becomes automatic: witness data is untrusted until the circuit checks it.

If a witness returns a Merkle path, the contract should recompute the root and compare it with the ledger tree root. If a witness returns a secret key, the contract should hash or commit to it and compare the result with the authorized value. If a witness returns a balance, credential, nullifier, or score, the contract should assert the relationship that makes the value meaningful.

In Circom, private inputs are also supplied by the prover, but the template usually makes it obvious that every private value exists only to satisfy constraints. In Compact, witnesses can feel like ordinary function calls. Do not trust that feeling. A witness is a private input source.

## Constraints Become Assertions

Circom's constraint operator `===` enforces equality. You also use gadgets whose internal constraints enforce range checks, booleanity, hash correctness, and other relationships. Compact expresses most top-level checks with `assert`.

The Circom shape:

```circom
computedRoot === root;
```

becomes the Compact shape:

```compact
assert(allowlist.checkRoot(computedRoot), "Invalid Merkle membership proof");
```

Compact `assert` is not a log message or a test-only check. It is part of the circuit semantics. If the assertion fails, the contract call fails. That makes it the right place to encode the rules that must hold before state changes.

There is one nuance: Compact also has type checking, bounded loops, fixed-size vectors, and standard-library circuits. You do not need to manually express every low-level constraint if a library type or circuit already provides the right operation. In the Merkle example, the Compact standard library provides `MerkleTreePath` and `merkleTreePathRoot`, so the Compact version does not manually rebuild each hash level.

## Side-by-Side: Merkle Membership

The Circom example in this tutorial verifies that a private `leaf` belongs to a tree with a public `root`. It takes private sibling hashes and private direction bits. Each direction bit must be boolean. At each level, it hashes either `(current, sibling)` or `(sibling, current)` depending on the bit. At the end, the computed root must equal the public root.

The Compact example implements the same user-facing proof, but it moves the root into ledger state. The contract owns an `allowlist` Merkle tree. The user supplies a private leaf and a private path through witnesses. The circuit computes the path root and checks it against the ledger tree. If the proof is valid, it increments a public counter recording successful checks.

The important rewrite is not line-for-line syntax. It is the placement of responsibility:

| Responsibility | Circom verifier | Compact verifier |
| --- | --- | --- |
| Tree root | Public input `root` | Public ledger state `allowlist` |
| Leaf | Private signal input `leaf` | Private witness `privateLeaf()` |
| Merkle path | Private signal arrays | Private witness `privatePath(leaf)` |
| Hashing | Explicit hash components | Standard-library path root circuit |
| Success | Output signal or satisfied constraints | Accepted state transition and counter update |

### Circom version

```circom
pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";

template MerkleProofVerifier(depth) {
    signal input root;
    signal input leaf;
    signal input pathElements[depth];
    signal input pathIndices[depth];
    signal output isValid;

    signal current[depth + 1];
    current[0] <== leaf;

    component hashers[depth];

    for (var i = 0; i < depth; i++) {
        pathIndices[i] * (pathIndices[i] - 1) === 0;

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== current[i] * (1 - pathIndices[i]) + pathElements[i] * pathIndices[i];
        hashers[i].inputs[1] <== pathElements[i] * (1 - pathIndices[i]) + current[i] * pathIndices[i];
        current[i + 1] <== hashers[i].out;
    }

    current[depth] === root;
    isValid <== 1;
}

component main { public [root] } = MerkleProofVerifier(3);
```

This is a pure verifier. It does not know who owns the tree, whether the tree root is current, whether roots can expire, or what should happen after a proof succeeds. Those responsibilities belong to the application around the circuit.

### Compact version

```compact
pragma language_version >= 0.20;

import CompactStandardLibrary;

export ledger allowlist: MerkleTree<3, Bytes<32>>;
export ledger successfulChecks: Counter;

witness privateLeaf(): Bytes<32>;
witness privatePath(leaf: Bytes<32>): MerkleTreePath<3, Bytes<32>>;

export circuit insertPublicLeaf(leaf: Bytes<32>): [] {
  assert(!allowlist.isFull(), "Allowlist tree is full");
  allowlist.insert(leaf);
}

export circuit proveMember(): [] {
  const leaf = privateLeaf();
  const path = privatePath(leaf);
  const computedRoot = merkleTreePathRoot<3, Bytes<32>>(path);

  assert(path.leaf == leaf, "Witness path is for a different leaf");
  assert(allowlist.checkRoot(computedRoot), "Invalid Merkle membership proof");

  successfulChecks.increment(1);
}
```

This contract is a state machine. `insertPublicLeaf` updates the public tree. `proveMember` proves knowledge of a private leaf and path for the current tree, then updates public state by incrementing `successfulChecks`. The leaf and path remain private. The counter update is public.

The Compact version also removes an entire class of application mistakes. In the Circom version, a caller can provide any public root. If your DApp forgets to bind that root to the current application state, the proof can be correct but irrelevant. In the Compact version, the proof is checked against the contract's own ledger tree. The state binding is part of the contract call.

## Working With the Witness Model

When moving from Circom to Compact, the witness model is usually the hardest habit to rebuild. In Circom, the witness generator is a build artifact or an application-side process that computes values for private signals. The circuit never "calls" the witness generator. In Compact, witness declarations look like functions, and exported circuits can call them.

Treat those calls as requests for private inputs. The user controls the local DApp environment, so a malicious user can return any value of the declared type. Compact protects you when you assert the relationship that must hold. It does not protect you if you simply accept witness output and write it to ledger state.

A safe witness pattern has three parts:

1. Load private data from a witness.
2. Recompute a public commitment, root, nullifier, or authorization value inside the circuit.
3. Assert that the recomputed value matches trusted public state or trusted public call data.

The Merkle verifier follows that pattern. It loads `leaf` and `path`, recomputes `computedRoot`, and checks the root against `allowlist`. A credential check would load a credential and nonce, recompute a commitment, and compare it with a registry. An authorization check would load a secret key, derive a public key or commitment, and compare it with the ledger's authorized value.

## State Machine Design

Circom developers often build one circuit per claim: "I know a preimage," "this Merkle path is valid," or "this transfer balances." Compact developers build contract transitions: "a registered user may cast one vote," "the owner may clear this post," or "a member may claim once without revealing which member they are."

That means you should design the ledger first. Ask:

- What public facts must persist?
- Which facts should remain private on the user's machine?
- Which commitments or roots connect private facts to public state?
- Which transitions are allowed?
- What public data is intentionally disclosed by each transition?

For the Merkle verifier, the public persistent fact is the tree. The private fact is membership of a specific leaf. The connecting value is the Merkle root. The transition is "accept one valid membership proof and increment the counter." The disclosed data is only that some valid member proved membership, plus the updated counter.

This design approach is different from Circom, but it is not foreign. It is the same discipline you already use when deciding which Circom inputs are public and which are private, extended across multiple transactions.

## Common Pitfalls

The first pitfall is treating witnesses as trusted helpers. A witness is not a backend oracle and not a privileged component. It is user-side input. Always assert the relationship you need.

The second pitfall is writing private-derived values to the ledger without understanding disclosure. Ledger state is public. If a value derived from a witness is assigned to a ledger field, the program must use `disclose(...)`, and the developer should be comfortable with the value becoming visible through public state.

The third pitfall is translating components too literally. A Circom component that exists only to compute a hash may become a helper circuit or a standard-library call. A component that exists to fetch off-circuit data may become a witness declaration. A component that represents an application action may become an exported circuit.

The fourth pitfall is forgetting that Compact circuits are bounded. Circom developers already understand fixed circuit sizes, so this is familiar. The difference is that Compact looks like TypeScript, which can tempt developers into thinking dynamically sized data structures and unbounded loops are available in circuit code. Use fixed-size vectors, fixed-depth trees, and ledger ADTs with clear limits.

The fifth pitfall is failing to bind proofs to current state. A standalone Circom proof can be valid for an old root. In Compact, prefer checking against ledger state when the proof is about contract-owned state. If old roots should remain valid, model that explicitly with a history structure or a ledger set of accepted roots.

The sixth pitfall is over-disclosing. Circom developers sometimes expose public signals for debugging or convenience. In Compact, every exported return value and ledger write has privacy consequences. Keep private values inside witnesses and local circuit computations unless the product requirement calls for disclosure.

## Testing the Examples

The files in `examples/` include:

- `examples/circom/merkle-proof.circom`, a Circom depth-3 Merkle membership verifier;
- `examples/compact/merkle-proof.compact`, a Compact contract using a ledger Merkle tree;
- `examples/test/merkle-proof.test.js`, a small Node.js test for the proof path used by the tutorial.

The JavaScript test does not replace `circom_tester` or the Compact compiler. It exists to make the example data executable without requiring a full proving toolchain in this repository. To compile the Circom circuit, install Circom 2 and `circomlib`, then compile `merkle-proof.circom` with `root` as the public input. To compile the Compact contract, use the current Compact compiler and run it against `merkle-proof.compact`.

The test vectors use a deterministic SHA-256 pair hash so the path direction logic can be checked quickly. The Circom circuit uses Poseidon because that is the common Circom-friendly hash. The Compact contract delegates hashing to Midnight's Merkle tree standard library. In production, use one tree format consistently across the contract, witness implementation, and any client-side indexing code.

## Transition Checklist

When porting a Circom design to Compact, use this checklist:

- Replace public signal inputs that represent application state with ledger fields where the contract should own that state.
- Replace private signal inputs with witness declarations when the data lives locally with the user.
- Replace reusable templates with helper circuits unless they are user-callable state transitions.
- Replace equality constraints and validity checks with `assert`.
- Keep witness outputs private unless you intentionally disclose them.
- Use standard-library types such as `MerkleTree`, `MerkleTreePath`, `Maybe`, `Either`, `persistentHash`, and `persistentCommit` instead of rebuilding common primitives.
- Model replay, root freshness, nullifiers, and authorization as ledger state, not as assumptions in the DApp.
- Test the witness implementation and the Compact contract together.

Compact is easiest to learn when you stop searching for a one-to-one syntax translation. Circom gives you circuits. Compact gives you private-data-aware state transitions. The circuit discipline still matters: every claim must be constrained, every untrusted private input must be checked, and every public output must be intentional. The new skill is deciding which parts of the application belong in the public ledger, which parts belong in private local state, and which assertions connect the two.
