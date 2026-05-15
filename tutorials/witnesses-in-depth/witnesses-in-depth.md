# Witnesses in Depth

*A comprehensive guide to the Witness pattern in Midnight Network smart contracts*

---

## 1. Introduction

In the Midnight Network, smart contracts operate within a zero-knowledge proof (ZKP) framework. Unlike traditional blockchains where all contract state is publicly visible on-chain, Midnight leverages zero-knowledge proofs to enable **data-protecting smart contracts** — contracts that can enforce business logic without revealing the underlying data.

At the heart of this architecture lies the concept of **Witnesses**.

A **witness** is a piece of data that is:
1. **Computed off-chain** — it is never stored on the blockchain
2. **Supplied to the ZK circuit** during proof generation
3. **Used to validate** that a particular state transition is valid
4. **Never revealed** to other participants or on-chain observers

Think of a witness as the "secret ingredient" that proves you know something without showing what that something is. It is analogous to the "witness" concept in Bitcoin's SegWit or the "private inputs" in ZK-SNARKs, but with a richer type system and tooling support specific to the Midnight Compact language.

### Why Witnesses Matter

Without witnesses, a ZK contract would have no way to reference private state. Consider a simple token transfer: to prove that Alice has enough balance to send 10 tokens to Bob, the contract needs Alice's current balance. But Alice's balance is private — it should not appear on-chain. The **witness** provides Alice's balance to the circuit off-chain, and the circuit proves (via the ZKP) that the balance is sufficient, without ever revealing the actual number.

This tutorial covers:
- The **witness declaration pattern** in Compact
- The **witness provider pattern** in TypeScript
- All major **witness types**: primitive, composite, Merkle, and stateful
- **Real-world use cases** and architectural best practices

---

## 2. The Witness Pattern

The witness pattern in Midnight follows a **declare-then-provide** workflow that spans two layers:

### Layer 1: Compact (On-Chain Contract)

In the Compact smart contract language, you **declare** a witness using the `witness` keyword. This tells the compiler: "This value will be supplied externally during proof generation."

```compact
witness secret_balance(): Field;
```

This declaration creates a "hole" in the circuit. The ZK compiler knows a value will fill this hole, but it does not know the value at compile time. The circuit uses this value in its constraints, and during proof generation, the prover supplies the actual data.

### Layer 2: TypeScript (Off-Chain Provider)

The counterpart to a Compact witness declaration is a **witness provider** — a TypeScript function that computes and returns the witness value at proof-generation time.

```typescript
const witnessProviders: WitnessProviders = {
  secret_balance: (): Field => {
    return BigInt(userBalance);
  }
};
```

### The Full Lifecycle

```
+---------------+     +-----------------+     +--------------+
|  1. Declare   |     |  2. Implement   |     |  3. Generate |
|  (Compact)    | --> |  (TypeScript)   | --> |  (Proof)     |
|               |     |                 |     |              |
|  witness f()  |     |  f: () => val   |     |  ZKP uses val|
+---------------+     +-----------------+     +--------------+
```

1. **Declare**: In Compact, you declare the witness function signature
2. **Implement**: In TypeScript, you write the function that returns the value
3. **Generate**: When creating a ZKP, the runtime calls your TypeScript function, receives the value, and feeds it into the circuit as a private input

The circuit then uses the witness value to compute constraints. If the constraints are satisfied, the proof is valid. The witness value itself never appears in the proof or on-chain.

---

## 3. Witness Types

Midnight supports several categories of witnesses, each suited to different use cases.

### 3.1 Primitive Witnesses

The simplest form: a witness that returns a single primitive value.

```compact
witness get_balance(owner: Address): Field;
```

**Use case**: Returning a private balance, a secret key, or a single numeric value.

Primitive witnesses work with Compact's core types:
- `Field` — an element of the proving system's field (most common)
- `Uint<8>`, `Uint<16>`, `Uint<32>`, `Uint<64>` — unsigned integers of various widths
- `Boolean` — a boolean value
- `Bytes<N>` — fixed-length byte arrays

### 3.2 Composite Witnesses

A witness that returns a **struct** — multiple values grouped together.

```compact
struct UserRecord {
  balance: Field;
  nonce: Field;
  tier: Uint<8>;
}

witness get_user_record(addr: Address): UserRecord;
```

**Use case**: When a single witness lookup needs to return multiple related values. This avoids multiple round-trips and keeps related data logically grouped.

Composite witnesses are especially useful when the prover needs to supply a record from a database, where all fields are correlated and should be fetched atomically.

### 3.3 Merkle Witnesses (Authenticated Witnesses)

The most powerful witness type. A Merkle witness returns a value **along with a Merkle proof** that authenticates the value against a known root.

```compact
witness get_leaf_with_proof(index: Field): [MerkleWitness, Field];
```

**Use case**: Proving that a specific piece of data exists in a dataset (e.g., a UTXO set, an allowlist, or a state tree) without revealing the entire dataset.

Merkle witnesses combine the witness pattern with authenticated data structures:

```
         Root (public)
        /      \
       H1      H2
      / \     / \
    H3  H4  H5  H6
    |   |   |   |
   v0  v1  v2  v3
```

To prove that `v2` is in the tree, the Merkle witness supplies `v2` plus the sibling hashes `[H6, H1]` (the "Merkle path"). The circuit reconstructs the root and checks that it matches the on-chain root.

### 3.4 Stateful Witnesses

A witness that maintains **internal state** across calls. The provider function is a closure that captures mutable state.

```typescript
let nonceCounter = 0;

const witnessProviders = {
  next_nonce: (): Field => {
    nonceCounter++;
    return BigInt(nonceCounter);
  }
};
```

**Use case**: Generating sequential nonces, counters, or any value that must change between calls. Stateful witnesses are essential for contracts that need to track ordering or prevent replay attacks.

---

## 4. Real-World Use Cases

### 4.1 Private Token Transfers

The canonical use case. A private token contract stores balances in a Merkle tree. Each leaf is a commitment to a user's balance.

**Witnesses needed:**
- `get_balance_commitment(owner): Field` — returns the user's balance commitment
- `get_merkle_path(index): MerklePath` — returns the Merkle proof for the leaf
- `get_nullifier_key(owner): Field` — returns a secret key used to derive nullifiers

The circuit proves: "I know a balance that, when committed, produces a leaf in the Merkle tree with the known root, and that balance is >= the transfer amount."

### 4.2 Voting and Governance

A private voting system where each eligible voter can cast one vote without revealing their choice.

**Witnesses needed:**
- `get_voter_eligibility(addr): Field` — proves membership in the voter set
- `get_vote_secret(): Field` — the voter's secret ballot
- `get_merkle_proof(index): MerklePath` — authenticates eligibility

### 4.3 Decentralized Identity (DID) Verification

Proving attributes about your identity without revealing the identity itself.

**Witnesses needed:**
- `get_age(): Uint<8>` — proves you are over 18
- `get_credential_commitment(): Field` — commitment to your credential
- `get_issuer_signature(): Bytes<64>` — the issuer's signature on your credential

### 4.4 Supply Chain Tracking

Proving a product passed through a specific checkpoint without revealing the full supply chain route.

**Witnesses needed:**
- `get_checkpoint_id(): Field` — the checkpoint identifier
- `get_route_proof(): MerklePath` — proof the checkpoint is in the authorized route set
- `get_timestamp(): Uint<64>` — when the checkpoint was recorded

---

## 5. Implementation Deep Dive

### 5.1 Compact Declaration Patterns

**Pattern A: Input-Dependent Witness**

The witness takes an argument that determines which value to return.

```compact
witness get_balance(owner: Address): Field;
```

The TypeScript provider receives `owner` and looks up their balance.

**Pattern B: Argument-Free Witness**

The witness takes no arguments — it returns a value determined entirely by the off-chain state.

```compact
witness current_timestamp(): Uint<64>;
```

Useful for values that are context-dependent (e.g., the current block time, a random nonce).

**Pattern C: Witness with Complex Return**

The witness returns a tuple or struct.

```compact
struct TransferProof {
  balance_before: Field;
  balance_after: Field;
  merkle_path: MerklePath;
}

witness prepare_transfer(sender: Address, amount: Field): TransferProof;
```

This bundles everything the circuit needs for a single operation into one witness call.

### 5.2 TypeScript Provider Patterns

**Provider Registration**

All witness providers are registered in a single object:

```typescript
import { WitnessProviders, Field } from "@midnight-ntwrk/compact-runtime";

const witnessProviders: WitnessProviders = {
  get_balance: (owner: Uint8Array): Field => {
    const balance = localDatabase.getBalance(owner);
    return BigInt(balance);
  },

  current_timestamp: (): Field => {
    return BigInt(Math.floor(Date.now() / 1000));
  },

  prepare_transfer: (sender: Uint8Array, amount: bigint): TransferProof => {
    const before = localDatabase.getBalance(sender);
    const after = before - Number(amount);
    const path = merkleTree.getPath(sender);
    return { balance_before: BigInt(before), balance_after: BigInt(after), merkle_path: path };
  }
};
```

**Error Handling in Providers**

Witness providers must be deterministic and must not fail unexpectedly. If a provider throws an error, proof generation fails. Best practices:

- Always validate inputs before computing
- Return default/zero values for missing data rather than throwing
- Log errors for debugging

```typescript
get_balance: (owner: Uint8Array): Field => {
  try {
    const balance = localDatabase.getBalance(owner);
    return BigInt(balance);
  } catch (e) {
    console.error("Failed to get balance:", e);
    return 0n;
  }
}
```

### 5.3 Merkle Witness Implementation

Merkle witnesses require careful implementation of the tree structure and proof generation.

```typescript
import { MerkleTree } from "@midnight-ntwrk/compact-runtime";

// Build a Merkle tree from a dataset
const leaves: Field[] = userData.map(u => u.commitment);
const tree = new MerkleTree(leaves, HASH_FUNCTION);

// Witness provider returns both the value and the proof
get_leaf_with_proof: (index: bigint): [MerklePath, Field] => {
  const leaf = tree.getLeaf(Number(index));
  const path = tree.getPath(Number(index));
  return [path, leaf];
}
```

The circuit then reconstructs the root:

```compact
fn verify_inclusion(leaf: Field, path: MerklePath, root: Field) -> Boolean {
  let computed_root = leaf;
  for i in 0..TREE_DEPTH {
    if path.directions[i] {
      computed_root = hash(path.siblings[i], computed_root);
    } else {
      computed_root = hash(computed_root, path.siblings[i]);
    }
  }
  return computed_root == root;
}
```

---

## 6. Best Practices

### 6.1 Keep Witnesses Minimal

Only request the data you need. Each witness value becomes a private input to the circuit, increasing proof size and generation time.

**Anti-pattern**: One witness that returns an entire database record when you only need one field.

**Pattern**: Separate witnesses for each piece of data, or a composite witness with only the needed fields.

### 6.2 Deterministic Providers

Witness providers must be **deterministic** — given the same inputs, they must always return the same output. Non-deterministic behavior (random numbers, timestamps that change) will cause proof verification to fail if the proof is re-verified later.

For time-dependent values, use blockchain timestamps rather than `Date.now()`.

### 6.3 Version Your Witnesses

As your contract evolves, witness signatures may change. Version your witness providers:

```typescript
const witnessProvidersV1 = { /* ... */ };
const witnessProvidersV2 = { /* ... */ };
```

### 6.4 Test Witnesses Independently

Write unit tests for your witness providers separately from contract tests. This catches issues in data retrieval and computation logic before they surface as mysterious proof-generation failures.

---

## 7. Common Pitfalls

- **Proof generation fails silently**: Witness provider returns wrong type. Solution: Ensure return types match Compact declarations exactly.
- **Verification fails after successful generation**: Non-deterministic provider. Solution: Make providers pure functions of inputs + stable state.
- **Merkle root mismatch**: Tree rebuilt with different ordering. Solution: Ensure consistent leaf ordering between tree build and witness lookup.
- **High proof generation time**: Too many large witnesses. Solution: Minimize witness data; use Merkle proofs instead of returning full datasets.

---

## 8. Summary

Witnesses are the cornerstone of data-protecting smart contracts on Midnight Network. They enable:

- **Privacy**: Data stays off-chain; only proofs are published
- **Flexibility**: Any off-chain data source can feed witnesses
- **Security**: The ZK circuit enforces constraints on witness values without revealing them
- **Composability**: Witnesses can be combined to build complex private protocols

The declare-then-provide pattern (Compact declaration + TypeScript provider) creates a clean separation between on-chain logic and off-chain data management. By understanding the four witness types — primitive, composite, Merkle, and stateful — you can build anything from simple private tokens to complex multi-party protocols.

### Next Steps

1. Run the [code examples](./examples/) in this tutorial
2. Read the [Midnight Compact Language Reference](https://docs.midnight.network/compact/)
3. Build your own private contract and share it with the [Midnight community](https://discord.com/invite/midnightnetwork)

---

*This tutorial was contributed as part of [midnightntwrk/contributor-hub#291](https://github.com/midnightntwrk/contributor-hub/issues/291). Licensed under Apache 2.0.*
