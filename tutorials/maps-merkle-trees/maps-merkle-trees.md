# Maps and Merkle Trees in Midnight Network

A comprehensive tutorial on using Map types and Merkle Tree structures in the Compact language for building privacy-preserving smart contracts on the Midnight Network.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Understanding Maps in Compact](#understanding-maps-in-compact)
3. [Map Declaration and Initialization](#map-declaration-and-initialization)
4. [Map Operations](#map-operations)
5. [Merkle Trees in Midnight](#merkle-trees-in-midnight)
6. [Merkle Tree Structure](#merkle-tree-structure)
7. [Proof Generation and Verification](#proof-generation-and-verification)
8. [Combining Maps and Merkle Trees](#combining-maps-and-merkle-trees)
9. [Practical Use Cases](#practical-use-cases)
10. [Best Practices](#best-practices)
11. [Conclusion](#conclusion)

---

## Introduction

The Midnight Network is a privacy-preserving blockchain platform that leverages zero-knowledge proofs to enable confidential smart contract execution. At its core, Midnight uses the **Compact language**, a domain-specific language designed for writing smart contracts that can generate and verify zero-knowledge proofs efficiently.

Two fundamental data structures in Compact are **Maps** and **Merkle Trees**. Maps provide key-value storage for on-chain data, while Merkle Trees enable efficient proof of inclusion without revealing the entire dataset. Together, they form the backbone of many privacy-preserving applications on Midnight.

This tutorial will guide you through both concepts, from basic declarations to advanced usage patterns, with practical code examples you can deploy on the Midnight testnet.

---

## Understanding Maps in Compact

Maps in Compact are similar to hash maps or dictionaries in traditional programming languages. They store key-value pairs where both keys and values must be of types supported by the Compact type system. Maps are **on-chain state**, meaning their contents are persisted across contract calls and are part of the blockchain state.

### Key Characteristics

- **Type-safe**: Both keys and values must conform to declared types
- **Persistent**: Map state survives across contract invocations
- **Private**: Map contents can be kept confidential using zero-knowledge proofs
- **Efficient**: Lookups and updates are O(1) operations

### Supported Map Key Types

Compact supports several primitive types as map keys:
- `Field` — Field elements (the native type in ZK circuits)
- `Uint<8|16|32|64|128>` — Unsigned integers of various sizes
- `Bytes<N>` — Fixed-length byte arrays
- `Boolean` — True/false values

Values can be any of the above types, plus compound types like structs and other maps (nested maps).

---

## Map Declaration and Initialization

### Basic Map Declaration

In Compact, you declare maps using the `Map` type constructor:

```compact
// Map from Field to Uint<64>
ledger balances: Map<Field, Uint<64>>;

// Map from Bytes<32> to Boolean
ledger verified_addresses: Map<Bytes<32>, Boolean>;

// Map from Uint<32> to Bytes<20>
ledger token_metadata: Map<Uint<32>, Bytes<20>>;
```

The `ledger` keyword indicates that the map is part of the contract's persistent state. This is analogous to storage variables in Solidity.

### Map Initialization

Maps in Compact are automatically initialized as empty when a contract is first deployed. You do not need to explicitly initialize them — any key not yet set will return a default value (zero for numeric types, false for Boolean, all-zero bytes for byte arrays).

```compact
contract TokenRegistry() {
    ledger token_names: Map<Bytes<32>, Bytes<64>>;
    ledger token_supply: Map<Bytes<32>, Uint<128>>;
    ledger token_active: Map<Bytes<32>, Boolean>;

    // No constructor needed — maps start empty
}
```

### Using Structs as Map Values

For more complex data, you can use structs as map values:

```compact
struct TokenInfo {
    name: Bytes<64>;
    symbol: Bytes<8>;
    total_supply: Uint<128>;
    decimals: Uint<8>;
    issuer: Bytes<32>;
}

contract AdvancedRegistry() {
    ledger tokens: Map<Bytes<32>, TokenInfo>;
}
```

This pattern is particularly useful when you need to store multiple related fields under a single key.

---

## Map Operations

### Reading from a Map

To read a value from a map, use bracket notation:

```compact
circuit get_balance(owner: Field): Uint<64> {
    return balances[owner];
}
```

If the key has never been set, the operation returns the type's default value. This is an important property — there is no "key not found" error. You must use a separate mechanism (like a Boolean flag map) to distinguish between "key exists with value zero" and "key does not exist."

### Writing to a Map

To write a value, use the assignment operator with bracket notation:

```compact
circuit set_balance(owner: Field, amount: Uint<64>): () {
    balances[owner] = amount;
}
```

### Updating a Map Entry

For incremental updates, read-modify-write patterns are common:

```compact
circuit deposit(owner: Field, amount: Uint<64>): () {
    balances[owner] = balances[owner] + amount;
}
```

### Conditional Operations

You can combine map reads with conditional logic:

```compact
circuit transfer(from: Field, to: Field, amount: Uint<64>): Boolean {
    if (balances[from] >= amount) {
        balances[from] = balances[from] - amount;
        balances[to] = balances[to] + amount;
        return true;
    }
    return false;
}
```

### Iterating Over Maps

Compact does not support direct iteration over maps in circuits (this would require knowing all keys, which is expensive in ZK). Instead, you typically maintain a separate counter or array of keys:

```compact
contract IterableMap() {
    ledger data: Map<Uint<32>, Field>;
    ledger keys: Map<Uint<32>, Uint<32>>;  // index -> key
    ledger count: Uint<32>;

    circuit insert(key: Uint<32>, value: Field): () {
        data[key] = value;
        keys[count] = key;
        count = count + 1;
    }

    circuit get_key_at(index: Uint<32>): Uint<32> {
        return keys[index];
    }
}
```

---

## Merkle Trees in Midnight

Merkle Trees are a fundamental data structure in zero-knowledge systems. They allow you to prove that a particular piece of data is included in a set without revealing the entire set. In Midnight, Merkle Trees are a first-class primitive, built into the Compact language and runtime.

### Why Merkle Trees?

In a privacy-preserving blockchain, you often need to prove properties about data without revealing the data itself. For example:
- "I am a member of this group" (without revealing which member)
- "My balance is above a threshold" (without revealing the exact balance)
- "This credential is valid" (without revealing the credential details)

Merkle Trees make this possible by allowing you to generate a compact proof (a "Merkle proof" or "authentication path") that demonstrates membership in the tree, which can then be verified inside a ZK circuit.

### Compact's Built-in Merkle Tree Support

Compact provides a native `MerkleTree` type that handles tree construction, insertion, and proof generation automatically. You declare a Merkle Tree in your contract's ledger:

```compact
import CompactStandardLibrary;

contract MerkleContract() {
    // Merkle tree with depth 20 (supports ~1 million leaves)
    ledger tree: MerkleTree<20>;
}
```

The type parameter (20 in this example) specifies the depth of the tree. A tree of depth `d` can hold up to `2^d` leaves. Common depths:
- Depth 10: ~1,024 leaves
- Depth 16: ~65,536 leaves
- Depth 20: ~1,048,576 leaves
- Depth 32: ~4.3 billion leaves

---

## Merkle Tree Structure

A Merkle Tree is a binary tree where:
- Each **leaf node** contains the hash of a data element
- Each **internal node** contains the hash of its two children
- The **root** (top node) represents a cryptographic commitment to the entire tree

```
            Root (H(H01|H23))
           /                \
      H01 (H(H0|H1))    H23 (H(H2|H3))
       /      \           /       \
     H0       H1        H2        H3
     |         |         |         |
   Data0    Data1     Data2     Data3
```

### Properties

1. **Tamper-evident**: Changing any data element changes the root hash
2. **Efficient verification**: Proving membership requires only O(log n) hashes
3. **Privacy-preserving**: The proof reveals nothing about other leaves

### Merkle Proofs (Authentication Paths)

A Merkle proof for a leaf consists of:
1. The leaf value itself
2. The "sibling" hash at each level from the leaf to the root
3. The path (left/right direction) at each level

To verify, you recompute the root hash using the leaf and the sibling hashes, then check if it matches the expected root.

---

## Proof Generation and Verification

### Generating a Merkle Proof in Compact

Compact's `MerkleTree` type provides built-in methods for proof generation:

```compact
import CompactStandardLibrary;

contract ProofSystem() {
    ledger tree: MerkleTree<16>;
    ledger root: Bytes<32>;

    circuit insert_leaf(leaf_data: Bytes<32>): () {
        tree.insert(leaf_data);
        root = tree.root();
    }

    circuit get_root(): Bytes<32> {
        return tree.root();
    }
}
```

### Client-Side Proof Generation

On the client side (TypeScript/JavaScript), you generate proofs using the Midnight runtime:

```typescript
import { MerkleTree } from '@midnight-ntwrk/compact-runtime';

// Create a Merkle tree with depth 16
const tree = new MerkleTree(16);

// Insert leaves
tree.insert(leafData1);
tree.insert(leafData2);
tree.insert(leafData3);

// Generate a proof for leaf at index 0
const proof = tree.proof(0);
// proof contains: { path: [...], siblings: [...] }

// Verify the proof against the root
const isValid = MerkleTree.verify(tree.root(), proof, leafData1);
console.log('Proof valid:', isValid); // true
```

### Verifying Proofs in a Circuit

To verify a Merkle proof inside a Compact circuit, you use the `MerkleTree.verify` helper:

```compact
import CompactStandardLibrary;

contract Verifier() {
    ledger known_root: Bytes<32>;

    circuit verify_membership(
        leaf: Bytes<32>,
        path: Vector<16, Bytes<32>>,
        indices: Vector<16, Boolean>
    ): Boolean {
        // Recompute root from leaf and path
        var current: Bytes<32> = leaf;
        for (var i = 0; i < 16; i = i + 1) {
            if (indices[i]) {
                current = hash(path[i] ++ current);
            } else {
                current = hash(current ++ path[i]);
            }
        }
        return current == known_root;
    }
}
```

This pattern is extremely powerful: the proof is generated off-chain (where the full data is available), but verified on-chain inside a ZK circuit (where only the proof and root are visible).

---

## Combining Maps and Merkle Trees

One of the most powerful patterns in Midnight is combining Maps with Merkle Trees. The Map provides O(1) random access to data, while the Merkle Tree provides cryptographic proof of inclusion.

### Pattern: Map as Index, Merkle Tree as Commitment

```compact
import CompactStandardLibrary;

contract TokenWithProof() {
    // Map for fast lookups
    ledger balances: Map<Field, Uint<64>>;
    
    // Merkle tree for proof of balance
    ledger balance_tree: MerkleTree<20>;
    
    // Track leaf indices for each user
    ledger leaf_indices: Map<Field, Uint<32>>;
    ledger next_index: Uint<32>;

    circuit register_user(user: Field): Uint<32> {
        let index: Uint<32> = next_index;
        leaf_indices[user] = index;
        next_index = next_index + 1;
        
        // Insert a commitment to zero balance
        balance_tree.insert(hash(user ++ field(0)));
        return index;
    }

    circuit update_balance(user: Field, new_balance: Uint<64>): () {
        balances[user] = new_balance;
        // In a full implementation, you'd need to handle
        // tree updates for the modified leaf
    }

    circuit get_balance(user: Field): Uint<64> {
        return balances[user];
    }

    circuit get_root(): Bytes<32> {
        return balance_tree.root();
    }
}
```

### Pattern: Sparse Merkle Tree with Map Storage

For scenarios where you need to prove *non-membership* (proving a key does NOT exist), a Sparse Merkle Tree is ideal. In Compact, you can simulate this:

```compact
contract SparseRegistry() {
    ledger tree: MerkleTree<256>;  // Full 256-bit address space
    ledger occupied: Map<Bytes<32>, Boolean>;
    ledger values: Map<Bytes<32>, Bytes<32>>;

    circuit insert(key: Bytes<32>, value: Bytes<32>): Boolean {
        if (occupied[key]) {
            return false;  // Already exists
        }
        occupied[key] = true;
        values[key] = value;
        tree.insert(hash(key ++ value));
        return true;
    }

    circuit exists(key: Bytes<32>): Boolean {
        return occupied[key];
    }
}
```

---

## Practical Use Cases

### Use Case 1: Privacy-Preserving Voting

A voting system where votes are recorded in a Merkle Tree, and voters can prove they voted without revealing their choice:

```compact
import CompactStandardLibrary;

contract PrivateVoting() {
    ledger voter_tree: MerkleTree<20>;
    ledger vote_commitments: MerkleTree<20>;
    ledger has_voted: Map<Bytes<32>, Boolean>;
    ledger voting_open: Boolean;

    circuit register_voter(voter_id: Bytes<32>): () {
        require(voting_open);
        require(!has_voted[voter_id]);
        voter_tree.insert(voter_id);
    }

    circuit cast_vote(
        vote: Field,
        voter_id: Bytes<32>,
        voter_proof_path: Vector<20, Bytes<32>>,
        voter_proof_indices: Vector<20, Boolean>
    ): () {
        require(voting_open);
        require(!has_voted[voter_id]);
        
        // Verify voter is registered (Merkle proof)
        // ... verification logic ...
        
        has_voted[voter_id] = true;
        vote_commitments.insert(hash(vote));
    }
}
```

### Use Case 2: Credential Verification

A system where credentials are stored in a Merkle Tree, and users can prove possession of valid credentials:

```compact
import CompactStandardLibrary;

contract CredentialVerifier() {
    ledger credential_tree: MerkleTree<16>;
    ledger revoked: Map<Bytes<32>, Boolean>;
    ledger issuer_key: Bytes<32>;

    circuit issue_credential(credential_hash: Bytes<32>): () {
        credential_tree.insert(credential_hash);
    }

    circuit revoke_credential(credential_hash: Bytes<32>): () {
        revoked[credential_hash] = true;
    }

    circuit verify_credential(
        credential_hash: Bytes<32>,
        proof_path: Vector<16, Bytes<32>>,
        proof_indices: Vector<16, Boolean>
    ): Boolean {
        // Check not revoked
        if (revoked[credential_hash]) {
            return false;
        }
        
        // Verify Merkle inclusion
        var current: Bytes<32> = credential_hash;
        for (var i = 0; i < 16; i = i + 1) {
            if (proof_indices[i]) {
                current = hash(proof_path[i] ++ current);
            } else {
                current = hash(current ++ proof_path[i]);
            }
        }
        return current == credential_tree.root();
    }
}
```

### Use Case 3: Token Registry with Proofs

A complete token registry that combines Maps for fast lookups and Merkle Trees for proof-based operations:

```compact
import CompactStandardLibrary;

contract TokenRegistry() {
    ledger tokens: Map<Bytes<32>, TokenInfo>;
    ledger token_tree: MerkleTree<16>;
    ledger registered: Map<Bytes<32>, Boolean>;
    ledger admin: Bytes<32>;

    circuit register_token(
        token_id: Bytes<32>,
        info: TokenInfo,
        caller: Bytes<32>
    ): Boolean {
        require(caller == admin);
        require(!registered[token_id]);
        
        tokens[token_id] = info;
        registered[token_id] = true;
        token_tree.insert(hash(token_id ++ info.to_bytes()));
        return true;
    }

    circuit get_token_info(token_id: Bytes<32>): TokenInfo {
        return tokens[token_id];
    }

    circuit prove_token_exists(
        token_id: Bytes<32>,
        proof_path: Vector<16, Bytes<32>>,
        proof_indices: Vector<16, Boolean>
    ): Boolean {
        // Verify the token is in the Merkle tree
        var current: Bytes<32> = hash(token_id ++ tokens[token_id].to_bytes());
        for (var i = 0; i < 16; i = i + 1) {
            if (proof_indices[i]) {
                current = hash(proof_path[i] ++ current);
            } else {
                current = hash(current ++ proof_path[i]);
            }
        }
        return current == token_tree.root();
    }
}
```

---

## Best Practices

### 1. Choose Appropriate Tree Depths

Select Merkle Tree depths based on your expected data volume:
- Too shallow: You'll run out of leaves
- Too deep: Wasted computation in proof generation
- Rule of thumb: `depth = ceil(log2(expected_max_entries)) + 2`

### 2. Handle Default Values Carefully

Remember that unset map entries return default values. Use a companion Boolean map to distinguish between "not set" and "set to zero":

```compact
ledger value_exists: Map<Bytes<32>, Boolean>;
ledger values: Map<Bytes<32>, Field>;
```

### 3. Minimize On-Chain Proof Verification

Merkle proof verification in a ZK circuit is expensive. Prefer to verify proofs off-chain when possible, and only verify on-chain when the verification result affects state transitions.

### 4. Use Commitments for Privacy

When storing sensitive data in a map, store a cryptographic commitment (hash) instead of the raw value. Reveal the value only when necessary, along with a proof that it matches the commitment.

### 5. Batch Operations

When inserting multiple leaves into a Merkle Tree, batch them together in a single circuit call to reduce per-operation overhead.

---

## Conclusion

Maps and Merkle Trees are essential tools for building privacy-preserving applications on the Midnight Network. Maps provide efficient key-value storage for on-chain state, while Merkle Trees enable cryptographic proofs of data inclusion without revealing the underlying data.

By combining these two structures, you can build sophisticated applications that balance performance (O(1) lookups via Maps) with privacy (zero-knowledge proofs via Merkle Trees). The patterns covered in this tutorial — from basic declarations to advanced use cases like private voting and credential verification — provide a solid foundation for your Midnight development journey.

### Next Steps

1. Explore the [code examples](./examples/) in this tutorial
2. Try deploying a contract on the [Midnight testnet](https://docs.midnight.network/testnet)
3. Read the [Compact language specification](https://docs.midnight.network/compact) for advanced features
4. Join the [Midnight Discord](https://discord.gg/midnight) for community support

---

*This tutorial is part of the Midnight Network Contributor Hub. For questions or contributions, see the [CONTRIBUTING guide](../../CONTRIBUTING.md).*
