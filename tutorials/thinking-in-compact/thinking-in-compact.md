# Thinking in Compact: A Guide for Circom Developers

**Author:** billbtbillb  
**Difficulty:** Intermediate  
**Estimated Reading Time:** 15 minutes  
**Prerequisites:** Experience with Circom 2.x, basic understanding of zero-knowledge proofs

---

## Introduction

If you have been building zero-knowledge circuits with Circom, you already understand the fundamentals of constraint systems, witness generation, and proof construction. Compact — the smart contract language for the Midnight Network — builds on these same foundations but introduces a fundamentally different programming model. Where Circom gives you raw arithmetic circuits, Compact gives you a stateful, privacy-preserving smart contract environment.

This tutorial maps every Circom concept you know to its Compact equivalent, highlights the critical differences you need to internalize, and walks you through rewriting a real Merkle proof verifier from Circom to Compact. By the end, you will think in Compact.

---

## Part 1: Concept Mapping — From Circom to Compact

### Signals → Variables and Ledger State

In Circom, `signal` is your primary data type. Signals represent values in the finite field that participate in constraints:

```circom
signal input leaf;
signal input root;
signal output verified;
```

In Compact, you have two distinct concepts that replace signals:

- **`Variable`**: Local, private values used during computation within a circuit or witness function. These are analogous to Circom's intermediate signals.
- **`Ledger`**: On-chain, publicly verifiable state. This has no Circom equivalent — it is a first-class citizen of the Compact runtime that persists across transactions.

```compact
// Compact variables (local, private)
var leaf: Field;
var root: Field;

// Ledger state (public, persistent, on-chain)
ledger {
  committedRoot: Counter<Bytes<32>>;
  verificationCount: Counter<UInt<64>>;
}
```

**Key insight:** In Circom, all signals exist only within a single proof generation. In Compact, ledger values persist on the blockchain between transactions. You must decide what is private (variables) and what is public (ledger) — this privacy boundary is the most important conceptual shift.

### Templates → Circuits

Circom uses `template` as its primary compositional unit:

```circom
template MerkleVerifier(depth) {
    signal input leaf;
    signal input pathElements[depth];
    signal input pathIndices[depth];
    signal input root;
    // ... constraints ...
}

component main = MerkleVerifier(20);
```

Compact uses `circuit` for the same purpose, but with a critical difference: circuits in Compact can read and write ledger state, making them inherently stateful:

```compact
circuit verifyMerkleProof(
    leaf: Field,
    pathElements: Vector<20, Field>,
    pathIndices: Vector<20, Field>
): Field {
    // This circuit can reference ledger state
    // and produce proofs that update it
    var currentHash = leaf;
    for (var i = 0; i < 20; i++) {
        currentHash = pathIndices[i] == 0
            ? poseidon([currentHash, pathElements[i]])
            : poseidon([pathElements[i], currentHash]);
    }
    return currentHash;
}
```

### Components → Witness Functions

In Circom, you instantiate templates as components and wire them together:

```circom
component hasher = Poseidon(2);
hasher.inputs[0] <== left;
hasher.inputs[1] <== right;
hasher.out ==> result;
```

In Compact, the equivalent is a **witness function** — a function that runs off-chain to compute private data needed by on-chain circuits:

```compact
witness function computeMerkleProof(
    leaf: Bytes<32>,
    siblings: Vector<20, Bytes<32>>,
    indices: Vector<20, Bool>
): { proofElements: Vector<20, Field>, proofIndices: Vector<20, Field> } {
    // Off-chain computation
    var elements: Vector<20, Field> = [];
    for (var i = 0; i < 20; i++) {
        elements[i] = fieldFromBytes(siblings[i]);
    }
    var pathIndices: Vector<20, Field> = [];
    for (var i = 0; i < 20; i++) {
        pathIndices[i] = indices[i] ? field(1) : field(0);
    }
    return { proofElements: elements, proofIndices: pathIndices };
}
```

**Key insight:** Witness functions execute off-chain. They compute the private inputs that will be fed into circuits. In Circom, witness generation and circuit definition are loosely coupled. In Compact, witness functions are declared as part of the contract and have a clear on-chain/off-chain boundary enforced by the type system.

### Constraints → Assert Statements

Circom constraints use `<==` to enforce equality between signal expressions:

```circom
hasher.out === expectedRoot;
verified <== isEqual(hasher.out, expectedRoot);
```

Compact uses `assert` for constraint enforcement within circuits:

```compact
assert computedRoot == storedRoot;
```

The syntax is simpler, but the semantics are identical: both produce R1CS constraints that the proof system must satisfy. If the assertion fails, no valid proof can be generated.

---

## Part 2: The Mental Model Shifts

### Shift 1: From Stateless to Stateful

Circom circuits are stateless. Each proof is a standalone object — there is no concept of state persisting between proofs. If you want to track something across proofs (like a Merkle root that changes over time), you manage that entirely in your application layer.

Compact contracts have **ledger state** that persists on-chain. This means:

```compact
contract MerkleRegistry {
    ledger {
        currentRoot: Counter<Bytes<32>>;
        totalVerifications: Counter<UInt<64>>;
    }

    circuit registerRoot(newRoot: Bytes<32>): [] {
        this.currentRoot.set(newRoot);
    }

    circuit verifyAndUpdate(leaf: Field, proof: MerkleProof): Bool {
        var computedRoot = verifyMerkleProof(leaf, proof.elements, proof.indices);
        var storedRoot = this.currentRoot.value();
        assert computedRoot == fieldFromBytes(storedRoot);
        this.totalVerifications.increment();
        return true;
    }
}
```

In Circom, you would need a separate application to manage the stored root and verification count. In Compact, this is all inside the contract.

### Shift 2: From Single Proof to Transaction Lifecycle

A Circom proof is a one-shot operation: you provide inputs, generate a witness, compute the proof, and verify it. The proof lifecycle ends there.

A Compact contract operation is a **transaction** with a defined lifecycle:

1. **Witness phase**: Off-chain witness functions compute private data
2. **Circuit phase**: On-chain circuits execute with constraints
3. **Ledger update phase**: If all assertions pass, ledger state is updated atomically

This means you need to think about Compact operations less like "prove a fact" and more like "execute a state transition that happens to be zero-knowledge."

### Shift 3: From Manual Wiring to Declarative Contracts

In Circom, you manually connect component outputs to other component inputs. This is error-prone and verbose:

```circom
component hasher[depth];
for (var i = 0; i < depth; i++) {
    hasher[i] = Poseidon(2);
    // Manual wiring...
    hasher[i].inputs[0] <== mux[i].out[0];
    hasher[i].inputs[1] <== mux[i].out[1];
}
```

Compact uses a more declarative style where the circuit logic reads like normal code, and the compiler handles constraint generation:

```compact
circuit computeRoot(
    leaf: Field,
    pathElements: Vector<20, Field>,
    pathIndices: Vector<20, Field>
): Field {
    var current = leaf;
    for (var i = 0; i < 20; i++) {
        var left = pathIndices[i] == field(0) ? current : pathElements[i];
        var right = pathIndices[i] == field(0) ? pathElements[i] : current;
        current = poseidon([left, right]);
    }
    return current;
}
```

### Shift 4: The Privacy Boundary Is Explicit

In Circom, all signals are part of the circuit — the distinction between public and private is made at the application level (what you reveal vs. what you keep as the witness). The circuit itself does not enforce privacy boundaries.

In Compact, privacy is baked into the language:

- **`secret`** inputs are never revealed on-chain
- **Ledger** values are always public
- **Witness functions** compute off-chain and return secret values to circuits
- The compiler enforces that secret data cannot leak to public ledger values

This means you do not need to manually manage what is revealed. The type system does it for you.

---

## Part 3: Side-by-Side — Merkle Proof Verifier

Let us rewrite a complete Merkle proof verifier from Circom to Compact.

### The Circom Version

```circom
pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/mux1.circom";

template MerkleProofVerifier(depth) {
    signal input leaf;
    signal input pathElements[depth];
    signal input pathIndices[depth];
    signal input root;

    component hashers[depth];
    component mux[depth];

    signal hashes[depth + 1];
    hashes[0] <== leaf;

    for (var i = 0; i < depth; i++) {
        pathIndices[i] * (1 - pathIndices[i]) === 0;

        mux[i] = MultiMux1(2);
        mux[i].c[0][0] <== hashes[i];
        mux[i].c[0][1] <== pathElements[i];
        mux[i].c[1][0] <== pathElements[i];
        mux[i].c[1][1] <== hashes[i];
        mux[i].s <== pathIndices[i];

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== mux[i].out[0];
        hashers[i].inputs[1] <== mux[i].out[1];

        hashes[i + 1] <== hashers[i].out;
    }

    root === hashes[depth];
}

component main { public [root] } = MerkleProofVerifier(20);
```

### The Compact Version

```compact
// MerkleProofVerifier.compact
// Copyright (C) 2025 Midnight Foundation
// SPDX-License-Identifier: Apache-2.0

pragma language_version 0.16.0;
import CompactStandardLibrary;

contract MerkleVerifier {
    ledger {
        verifiedRoots: Counter<Bytes<32>>;
        verificationCount: Counter<UInt<64>>;
    }

    circuit verifyProof(
        leaf: Field,
        pathElements: Vector<20, Field>,
        pathIndices: Vector<20, Field>,
        expectedRoot: Field
    ): Bool {
        // Verify the binary constraint: each index is 0 or 1
        for (var i = 0; i < 20; i++) {
            assert pathIndices[i] == field(0) || pathIndices[i] == field(1);
        }

        // Compute the Merkle root
        var currentHash = leaf;
        for (var i = 0; i < 20; i++) {
            var left = pathIndices[i] == field(0) ? currentHash : pathElements[i];
            var right = pathIndices[i] == field(0) ? pathElements[i] : currentHash;
            currentHash = poseidon([left, right]);
        }

        // Assert the computed root matches the expected root
        assert currentHash == expectedRoot;

        // Update ledger state
        this.verificationCount.increment();

        return true;
    }

    circuit registerRoot(root: Bytes<32>): [] {
        this.verifiedRoots.increment();
    }
}

// Witness function for off-chain Merkle proof computation
witness function buildMerkleProof(
    leafBytes: Bytes<32>,
    siblings: Vector<20, Bytes<32>>,
    pathBits: Vector<20, Bool>
): { leaf: Field, pathElements: Vector<20, Field>, pathIndices: Vector<20, Field> } {
    var leafField = fieldFromBytes(leafBytes);
    var elements: Vector<20, Field> = [];
    var indices: Vector<20, Field> = [];
    for (var i = 0; i < 20; i++) {
        elements[i] = fieldFromBytes(siblings[i]);
        indices[i] = pathBits[i] ? field(1) : field(0);
    }
    return {
        leaf: leafField,
        pathElements: elements,
        pathIndices: indices
    };
}
```

### What Changed and Why

| Aspect | Circom | Compact |
|--------|--------|---------|
| State | Stateless — each proof is independent | Stateful — ledger persists between transactions |
| Mux logic | Manual Mux1 components for ordering | Native ternary operator with `if/else` |
| Binary check | `pathIndices[i] * (1 - pathIndices[i]) === 0` | `assert pathIndices[i] == field(0) \|\| pathIndices[i] == field(1)` |
| Root comparison | `root === hashes[depth]` (at end) | `assert currentHash == expectedRoot` |
| Verification tracking | Not included — must be done externally | Built into the contract via `verificationCount` |
| Witness generation | Separate JavaScript/WASM code | Declared `witness function` in the same contract |

---

## Part 4: Common Pitfalls

### Pitfall 1: Treating Compact Like Circom

The biggest mistake is writing Compact as if it were Circom. Circom is a circuit description language — you describe constraints. Compact is a contract language — you describe state transitions that happen to use zero-knowledge proofs.

**Wrong approach (Circom thinking):**
```compact
// This is just a constraint system, not a contract
circuit hashPair(a: Field, b: Field): Field {
    return poseidon([a, b]);
}
```

**Right approach (Compact thinking):**
```compact
// This is a contract that uses ZK for privacy
contract HashCommitment {
    ledger {
        commitments: Counter<Bytes<32>>;
    }

    circuit commit(secret: Field, salt: Field): [] {
        var hash = poseidon([secret, salt]);
        // Store commitment on-chain — the secret never leaves the witness
        this.commitments.increment();
    }
}
```

### Pitfall 2: Ignoring the Off-Chain/On-Chain Boundary

In Circom, all computation happens in-circuit. In Compact, witness functions run off-chain and circuits run on-chain (as constraints). Sending large data through the circuit boundary is expensive. Keep heavy computation in witness functions.

### Pitfall 3: Forgetting Ledger Costs

Every ledger write is an on-chain operation with real cost. In Circom, you never think about storage costs. In Compact, you must design your ledger usage carefully:

```compact
// Expensive: updating a full vector on every verification
ledger {
    allProofs: Vector<1000, Bytes<32>>; // Don't do this
}

// Better: track only what you need
ledger {
    proofCount: Counter<UInt<64>>;
    latestRoot: Counter<Bytes<32>>;
}
```

### Pitfall 4: Assuming Circom Library Compatibility

Compact does not use Circom's `circomlib`. The standard library is `CompactStandardLibrary`. Hash functions, range checks, and other primitives have different APIs:

```circom
// Circom
component hasher = Poseidon(2);
hasher.inputs[0] <== a;
hasher.inputs[1] <== b;
```

```compact
// Compact
var hash = poseidon([a, b]);
```

### Pitfall 5: Not Leveraging Type Safety

Compact has a rich type system that Circom lacks. Use it:

```compact
// Compact types catch errors at compile time
type MerklePath = {
    elements: Vector<20, Field>,
    indices: Vector<20, Field>
};

circuit verify(leaf: Field, path: MerklePath, root: Field): Bool {
    // Structured inputs are clearer and safer
    ...
}
```

---

## Part 5: Migration Checklist

When porting a Circom project to Compact:

1. **Identify your state**: What data needs to persist between proofs? This becomes your `ledger` block.
2. **Separate witness from circuit**: Move computation that does not need constraints into `witness` functions.
3. **Replace manual wiring**: Use Compact's native control flow instead of component instantiation.
4. **Add the privacy boundary**: Mark secret inputs explicitly. Let the compiler enforce privacy.
5. **Design your contract interface**: What circuits does the contract expose? What ledger state do they modify?
6. **Test the full lifecycle**: Test not just constraint satisfaction, but state transitions and ledger updates.

---

## Summary

Moving from Circom to Compact is not just a syntax change — it is a paradigm shift from circuit description to contract programming. The key mappings are:

- **Signals** → Variables (private) + Ledger (public)
- **Templates** → Circuits (stateful)
- **Components** → Witness functions (off-chain)
- **Constraints** → Assert statements

The most important new concepts are the **ledger** (persistent on-chain state), the **witness/circuit boundary** (off-chain vs. on-chain execution), and **explicit privacy** (the type system enforces what is secret).

Once you internalize these shifts, you will find that Compact is not harder than Circom — it is Circom with superpowers. You get the same ZK primitives you know, plus state management, privacy guarantees, and a contract deployment model built in from the start.

---

## Resources

- [Midnight Developer Documentation](https://docs.midnight.network/getting-started)
- [Compact Language Reference](https://docs.midnight.network/compact)
- [Midnight MCP](https://www.npmjs.com/package/midnight-mcp)
- [Midnight Developer Forum](https://forum.midnight.network/)
- [Midnight Discord](https://discord.com/invite/midnightnetwork)

---

*Tags: #MidnightforDevs #Compact #ZeroKnowledge #Circom #Tutorial*

---

## Part 6: Deep Dive — Understanding the Poseidon Hash in Both Systems

One of the most common operations in ZK circuits is hashing. Both Circom and Compact support the Poseidon hash function, but the integration model differs significantly.

### Poseidon in Circom

In Circom, using Poseidon requires explicit component instantiation and manual signal wiring:

```circom
include "circomlib/circuits/poseidon.circom";

template HashPair() {
    signal input left;
    signal input right;
    signal output hash;

    component hasher = Poseidon(2);
    hasher.inputs[0] <== left;
    hasher.inputs[1] <== right;
    hash <== hasher.out;
}
```

Each Poseidon instance creates a sub-circuit with its own constraints. When you need multiple hashes (as in a Merkle tree), you instantiate multiple components in a loop, and each one generates its own set of R1CS constraints. The constraint count grows linearly with tree depth.

### Poseidon in Compact

Compact provides Poseidon as a built-in function within circuits. No component instantiation needed:

```compact
var hash = poseidon([left, right]);
```

This is not syntactic sugar over component instantiation — the Compact compiler handles the constraint generation internally. The result is cleaner code with the same underlying R1CS constraints.

### Constraint Count Implications

For a 20-level Merkle tree, both Circom and Compact generate approximately 20 × (number of Poseidon rounds) constraints per proof. The total constraint count is similar, but Compact's compiler can apply optimizations that manual wiring in Circom might miss.

**Practical tip:** If you are porting a Circom circuit and notice different constraint counts, check whether Compact is applying constant folding or dead code elimination to your circuit.

---

## Part 7: Event-Driven Patterns in Compact

Compact introduces **events** — a concept that has no Circom equivalent. Events allow contracts to emit signals that external systems can listen for:

```compact
contract MerkleVerifier {
    event RootUpdated(Bytes<32> newRoot);
    event ProofVerified(Bytes<32> leaf, UInt<64> timestamp);

    circuit registerRoot(root: Bytes<32>): [] {
        this.latestRoot.set(root);
        emit RootUpdated(root);
    }

    circuit verifyProof(leaf: Field, proof: MerkleProof): Bool {
        // ... verification logic ...
        emit ProofVerified(fieldToBytes(leaf), this.currentTimestamp());
        return true;
    }
}
```

In Circom, if you wanted to track proof events, you would need to build an entire off-chain indexing system. In Compact, events are part of the contract definition and are automatically indexed by the Midnight Network.

### When to Use Events

Events are useful for:

- **Audit trails**: Recording every verification for compliance
- **Frontend notifications**: Alerting a UI when state changes
- **Cross-contract triggers**: One contract reacting to another's state changes
- **Analytics**: Tracking contract usage patterns

---

## Part 8: Testing Your Compact Contract

Circom testing typically involves writing JavaScript that generates witnesses and checks constraints. Compact has a more integrated testing model:

```typescript
// test-harness.ts
import { MerkleVerifier } from './MerkleVerifierCompact';

async function testMerkleVerification() {
    const contract = await MerkleVerifier.deploy();

    // Register a known root
    await contract.registerRoot(knownRoot);

    // Build a witness off-chain
    const proof = await buildMerkleProof(leaf, siblings, pathBits);

    // Verify the proof — this generates a ZK proof and submits it
    const result = await contract.verifyProof(
        proof.leaf,
        proof.pathElements,
        proof.pathIndices
    );

    assert(result === true);
    assert(await contract.verificationCount() === 1n);
}
```

The key difference from Circom testing: you are testing a contract with state, not just a circuit with inputs. Your tests should cover:

1. **Correct proofs**: Valid Merkle proofs pass verification
2. **Invalid proofs**: Tampered proofs fail assertions
3. **State transitions**: Ledger values update correctly after verification
4. **Edge cases**: Empty trees, single-leaf trees, maximum depth proofs

---

## Conclusion

The transition from Circom to Compact is a journey from thinking about static constraint systems to thinking about dynamic, stateful smart contracts that preserve privacy. The core ZK concepts you know from Circom — signals become variables, templates become circuits, constraints become asserts — remain valid. But Compact adds new dimensions: persistent ledger state, explicit off-chain/on-chain boundaries, and a type system that enforces privacy at the compiler level.

Start small. Port a simple Circom circuit like a hash preimage check to Compact. Then work up to more complex circuits like Merkle proof verification. As you gain experience, you will find that Compact's model makes it easier to build real applications because the contract model handles the state management that Circom leaves entirely to your application layer.

The ZK primitives are the same. The thinking model is what changes. Once you think in Compact, you will not want to go back.
