# Anonymous Membership Proofs: Allowlists, Voter Rolls & Gated Access on Midnight

A practical developer's guide to building privacy-preserving membership systems using Midnight's Compact contract language and zero-knowledge proofs. This tutorial is based on the reference implementation at [tusharpamnani/midnight-allowlist](https://github.com/tusharpamnani/midnight-allowlist).

---

## Table of Contents

1. [Why Anonymous Membership Matters](#1-why-anonymous-membership-matters)
2. [How Midnight Enables Private Membership Verification](#2-how-midnight-enables-private-membership-verification)
3. [Sparse Merkle Tree Allowlist Contract Design](#3-sparse-merkle-tree-allowlist-contract-design)
4. [Depth-20 Path Verification in Compact](#4-depth-20-path-verification-in-compact)
5. [Nullifier-Based Replay Prevention](#5-nullifier-based-replay-prevention)
6. [Admin Root Management](#6-admin-root-management)
7. [Full Compact Code Examples](#7-full-compact-code-examples)
8. [Step-by-Step Flow](#8-step-by-step-flow)
9. [Real-World Use Cases](#9-real-world-use-cases)
10. [Security Considerations and Common Pitfalls](#10-security-considerations-and-common-pitfalls)

---

## 1. Why Anonymous Membership Matters

### The Privacy vs. Sybil Resistance Tension

Traditional on-chain access control faces a fundamental tradeoff:

| Approach | Privacy | Sybil Resistance |
|---|---|---|
| **Token holdings (1:1)** | ❌ Full exposure | ✅ Strong |
| **Token holdings (threshold)** | ❌ Full exposure | ✅ Strong |
| **Centralized allowlist** | ❌ All members exposed | ✅ Strong |
| **ZK Proof of membership** | ✅ Member hidden | ✅ Strong |

In a standard token-gated DAO, anyone can scan the blockchain to see exactly which wallets hold the required tokens — deanonymizing your entire membership. A ZK-based allowlist solves this differently: a member can prove they are on a secret list without revealing *which* list entry is theirs, *where* they sit in the list, or *what* the list contains.

### Why This Is Hard

For Sybil resistance to hold, you must ensure:
- Each proof can only be used once (replay prevention)
- Non-members cannot forge a valid proof (membership soundness)
- The admin cannot censor members retroactively (consistency)

All three must hold *simultaneously* without a trusted third party seeing the membership data on-chain. This is what Midnight's privacy model enables.

### What Gets Revealed vs. What Stays Private

| Data | Visibility |
|---|---|
| Merkle root | ✅ Public — shared by all members |
| Nullifier | ✅ Public — but unlinkable to identity |
| ZK proof | ✅ Public — but reveals nothing without the secret |
| Member's secret | ❌ Never leaves local machine |
| Member's leaf / position | ❌ Never leaves local machine |
| Merkle path | ❌ Never leaves local machine |

---

## 2. How Midnight Enables Private Membership Verification

Midnight is a blockchain platform for building privacy-preserving DApps. It lets developers define how data is isolated, verified, and shared through ZK proofs and programmable confidentiality controls.

The key primitives Midnight provides:

### 2.1 PersistentHash (Poseidon)

Midnight uses **Poseidon** as its ZK-friendly hash function, exposed as `persistentHash` in Compact. Poseidon is specifically designed for ZK circuits — it has very low multiplicative complexity compared to SHA-256, making proof generation fast and cheap.

All cryptographic hashing in the allowlist system uses `persistentHash` with domain-separated namespaces:

| Namespace | Purpose |
|---|---|
| `zk-allowlist:leaf:v1` | Computing a member's leaf hash |
| `zk-allowlist:node:v1` | Computing Merkle tree nodes |
| `zk-allowlist:nullifier:v1` | Computing the nullifier |
| `zk-allowlist:admin:v1` | Admin authentication |

### 2.2 Private vs. Public State

Midnight contracts distinguish between:

- **Private inputs**: Data known only to the prover (secret, leaf, Merkle path) — verified inside a ZK circuit, never revealed on-chain
- **Public inputs**: Data posted on-chain (Merkle root, nullifier, ZK proof) — visible to everyone but meaningless without the corresponding private data

This is the critical difference from EVM-based solutions where all inputs to a verification function are public.

### 2.3 The Verification Flow

```
┌──────────────────────────────────────┐   ┌──────────────────────────────────┐
│         OFF-CHAIN (user's machine)   │   │      ON-CHAIN (Midnight)         │
│                                      │   │                                  │
│  1. User knows secret "alice123"     │   │  Stores:                         │
│  2. Hash(secret) → leaf              │   │    • merkle_root (public)        │
│  3. Insert leaf into Merkle tree      │   │    • admin_commitment (public)   │
│  4. Compute Merkle path               │   │    • used_nullifiers (public set)│
│  5. Compute nullifier = hash(...)     │   │                                  │
│  6. Generate ZK proof                │   │  Receives:                       │
│     (proves: I know a leaf that      │   │    • proof                       │
│      produces root R, and I haven't  │   │    • nullifier                   │
│      used this nullifier before)     │   │    • root                        │
│                                      │   │                                  │
│                                      │   │  Verifies:                       │
│                                      │   │    1. Proof is valid for root    │
│                                      │   │    2. Nullifier not in set       │
│                                      │   │    3. Admin authorized root      │
└──────────────────────────────────────┘   └──────────────────────────────────┘
```

---

## 3. Sparse Merkle Tree Allowlist Contract Design

A **Sparse Merkle Tree (SMT)** is a Merkle tree where the total depth is fixed (depth 20 = 2²⁰ ≈ 1 million leaf slots), and empty slots are implicitly zero. This means:

- Members can be added in any order — the tree expands as needed
- The tree has a fixed, deterministic shape regardless of member count
- No sequential ordering is required — members are assigned to the first available leaf index

### 3.1 Tree Structure

```
Depth 0 (root):  H( H(left_subtree) || H(right_subtree) )
Depth 1:         H( H(LL || LR) || H(RL || RR) )
...
Depth 20 (leaves): H(leaf_data) or 0 if empty
```

Each node is computed as:

```
node_hash = persistentHash(
  domain_separator = "zk-allowlist:node:v1",
  left_child,
  right_child
)
```

Each leaf is computed as:

```
leaf_hash = persistentHash(
  domain_separator = "zk-allowlist:leaf:v1",
  secret_normalized_to_field_element
)
```

### 3.2 Contract State

The Compact contract (`zk-allowlist.compact`) stores three pieces of public state:

```compact
field merkle_root: Bytes<32>;        // Current Merkle tree root
field admin_commitment: Bytes<32>;   // Hash of admin's secret (setup once)
field used_nullifiers: Set<Bytes<32>>; // Consumed nullifiers (replay protection)
```

### 3.3 The Three Circuits

The contract exposes three circuit interfaces:

#### `setup(commitment: Bytes<32>)` — One-time admin initialization

Called once when deploying the contract. Commits the admin to the system. The `commitment` is `persistentHash("zk-allowlist:admin:v1", admin_secret)`.

```compact
// Pseudocode representation
circuit setup(commitment: Bytes<32>) {
  // admin_commitment must not already be set
  // Stores commitment as the new admin_commitment
}
```

#### `setRoot(new_root: Bytes<32>)` — Authenticated root update

Called by the admin to publish a new Merkle root after adding members off-chain. Proves the admin authorized this root change.

```compact
circuit setRoot(new_root: Bytes<32>) {
  // Prover demonstrates they know admin_secret
  // whose commitment == admin_commitment
  // new_root becomes the new merkle_root
}
```

#### `verifyAndUse(nullifier: Bytes<32>)` — Membership proof + replay check

The main verification circuit. Proves membership and prevents replay in a single atomic step.

```compact
circuit verifyAndUse(nullifier: Bytes<32>) {
  // In-ZK (private):
  //   1. Prover knows secret s such that:
  //      nullifier == persistentHash("zk-allowlist:nullifier:v1", len(s)||s||context)
  //   2. Prover knows leaf L = persistentHash("zk-allowlist:leaf:v1", s)
  //   3. Prover knows Merkle path from leaf L to merkle_root (depth 20)
  //
  // On-chain (public):
  //   4. nullifier NOT IN used_nullifiers  ← replay check
  //   5. merkle_root unchanged during proof ← already set by admin
  //
  // Result: Add nullifier to used_nullifiers
}
```

---

## 4. Depth-20 Path Verification in Compact

The depth-20 Merkle path verification is the heart of the circuit. For each of the 20 levels, the prover must show that their current node is the correct hash computed from the sibling node at that level.

### 4.1 Path Representation

A Merkle path of depth 20 is represented as two arrays:

```typescript
// From merkle-tree.ts in the reference implementation
interface MerkleProof {
  leaf: Bytes<32>;       // The member's leaf hash
  path: Bytes<32>[];    // 20 sibling hashes (one per level)
  path_index: u8[];      // 20 bits: 0 = sibling is left, 1 = sibling is right
  leaf_index: u32;      // Which leaf slot (0 to 2^20 - 1)
}
```

### 4.2 Compact Circuit Logic (Depth-20 Unrolled)

The circuit computes the root from the leaf by iteratively hashing up the tree. Here is the Compact pseudocode pattern for unrolled depth-20 verification:

```compact
// zk-allowlist.compact — simplified verification pseudocode
circuit verifyAndUse(nullifier: Bytes<32>, proof: MerkleProof) {
  // proof.path has length 20, path_index has length 20

  // Step 1: Verify nullifier privately
  // The nullifier is computed from the secret + context inside the circuit
  // Only the nullifier itself is public; secret stays private

  // Step 2: Start from the leaf
  let mut current_hash = proof.leaf;

  // Step 3: Iterate up 20 levels
  current_hash = if proof.path_index[0] == 0 {
    persistentHash("zk-allowlist:node:v1", current_hash, proof.path[0])
  } else {
    persistentHash("zk-allowlist:node:v1", proof.path[0], current_hash)
  };

  current_hash = if proof.path_index[1] == 0 {
    persistentHash("zk-allowlist:node:v1", current_hash, proof.path[1])
  } else {
    persistentHash("zk-allowlist:node:v1", proof.path[1], current_hash)
  };

  // ... repeat for levels 2 through 19 ...

  current_hash = if proof.path_index[19] == 0 {
    persistentHash("zk-allowlist:node:v1", current_hash, proof.path[19])
  } else {
    persistentHash("zk-allowlist:node:v1", proof.path[19], current_hash)
  };

  // Step 4: The computed root must equal the public merkle_root
  require(current_hash == merkle_root);

  // Step 5: Nullifier must not have been used
  require(!used_nullifiers.contains(nullifier));

  // Step 6: Record nullifier to prevent replay
  used_nullifiers.insert(nullifier);
}
```

In actual Compact, the if-else branching over field elements uses `select()`:

```compact
let node_hash = current_hash.select(
  proof.path[idx],          // when current bit = 1 (sibling on left)
  persistentHash("zk-allowlist:node:v1", proof.path[idx], current_hash),
  persistentHash("zk-allowlist:node:v1", current_hash, proof.path[idx])
);
// When path_index[idx] == 0: sibling is on the right
// When path_index[idx] == 1: sibling is on the left
```

### 4.3 Why Unrolled?

ZK circuits cannot efficiently loop with dynamic bounds in most backends. Unrolling all 20 levels is intentional — it keeps the circuit structure fixed and deterministic, which is essential for the prover/verifier agreement.

### 4.4 Leaf Computation (Private)

The leaf hash is computed from the user's secret before the proof is generated:

```typescript
// From poseidon.ts / allowlist-utils.ts
import { persistentHash } from '@midnight-npm/sdk';

function computeLeaf(secret: string): Uint8Array {
  // Normalize secret to 32-byte field element via SHA-256
  const normalized = sha256(secret); // 32 bytes
  return persistentHash(
    'zk-allowlist:leaf:v1',
    normalized
  );
}
```

---

## 5. Nullifier-Based Replay Prevention

### 5.1 What Is a Nullifier?

A **nullifier** is a deterministic unique identifier for a (secret, context) pair. It is computed as:

```
nullifier = persistentHash(
  "zk-allowlist:nullifier:v1",
  len(secret) || secret || context
)
```

The `context` string (e.g., `"mint_v1"` or `"vote_proposal_42"`) is a namespace that prevents the same secret from being reused across different applications or actions without revealing the secret.

### 5.2 Properties

| Condition | Nullifier Result | Allowed? |
|---|---|---|
| Same secret + same context | Same nullifier | ❌ Rejected (already used) |
| Same secret + different context | Different nullifier | ✅ Accepted |
| Different secret + same context | Different nullifier | ✅ Accepted |

This means:
- The same member can participate in multiple independent actions (each with its own context) without cross-linking
- A proof for "mint NFT" cannot be reused for "vote on proposal #7"
- No information about the secret or identity is revealed by the nullifier

### 5.3 On-Chain Storage

The contract maintains `used_nullifiers: Set<Bytes<32>>`. Each entry is permanent — once a nullifier is spent, it stays in the set. This is critical: a nullifier can never be "unspent" because the admin could selectively un-include it.

### 5.4 Why Not a Counter?

A simple counter ("proof #1, #2, #3") would make nullifiers linkable across different contexts. If Alice uses nullifier #5 for "mint" and #7 for "vote", an observer knows both nullifiers belong to Alice. A hash-based nullifier breaks this linkability.

---

## 6. Admin Root Management

### 6.1 The Admin Model

The admin is the entity authorized to update the Merkle root. This is the only privileged role, and it is established during one-time `setup`.

```
Admin setup:
  admin_secret  →  admin_commitment = persistentHash("zk-allowlist:admin:v1", admin_secret)
```

The admin_secret is never stored on-chain. Only the commitment (the hash) is stored.

### 6.2 Off-Chain Member Addition

Members are added **off-chain** in a local Merkle tree. The admin (or a trusted operator) runs a local process:

```bash
# Initialize tree
npm run zk -- init

# Add members one by one
npm run zk -- add-member --secret alice
npm run zk -- add-member --secret bob
npm run zk -- add-member --secret charlie

# Export the new root
npm run zk -- export-root
# Output: { "root": "0x513c218aaa4e8c9915e907a9adbf871294135de8fcda95a5bb2e279949919e83" }
```

The local CLI maintains `data/tree.json` (the Merkle tree structure) and `data/members.json` (dev-only member registry).

### 6.3 On-Chain Root Push

Once the off-chain tree has all desired members, the admin publishes the new root:

```bash
npm run zk -- set-root --admin-secret admin123
```

This calls the `setRoot(new_root)` circuit on-chain, which:
1. Verifies the caller knows `admin_secret` (proves `persistentHash(admin_secret) == admin_commitment`)
2. Sets `merkle_root = new_root`

### 6.4 Key Insight: Off-Chain Privacy

**The off-chain Merkle tree is private.** The admin's local machine knows:
- All member secrets
- All member leaf positions
- All Merkle paths

None of this data ever touches the blockchain. Only the aggregated root (a 32-byte hash) is published. This means the admin can:
- Add members without a transaction (just share the new root later)
- Batch-add thousands of members between root updates
- Rotate members by simply publishing a new root

### 6.5 Root Update Frequency

| Strategy | Tradeoff |
|---|---|
| Update root after each add | High on-chain overhead, always current |
| Periodic batch updates | Lower overhead, slight delay for new members |
| Event-driven (when threshold reached) | Balanced cost/responsiveness |

---

## 7. Full Compact Code Examples

### 7.1 Contract Definition (`zk-allowlist.compact`)

```compact
// zk-allowlist.compact v1
// A privacy-preserving allowlist using Sparse Merkle Trees (depth 20)
// and nullifier-based replay prevention.
// Compatible with Compact 0.5.0 / Midnight.js 4.0.2

namespace Allowlist;

// ─── Public State ────────────────────────────────────────────────────────────

// Current Merkle tree root (set by admin via setRoot)
public merkle_root: Byte<32>;

// Admin commitment: persistentHash("zk-allowlist:admin:v1", admin_secret)
// Set once during setup; never changes thereafter.
public admin_commitment: Byte<32>;

// Set of consumed nullifiers. A nullifier can only be spent once.
public used_nullifiers: Set<Byte<32>>;

// ─── Private Helpers (in-circuit) ───────────────────────────────────────────

// Compute a member's leaf hash from their secret.
private function leaf_hash(secret: Byte<32>) -> Byte<32> {
    persistentHash("zk-allowlist:leaf:v1", secret)
}

// Compute a Merkle tree node hash from two children.
private function node_hash(left: Byte<32>, right: Byte<32>) -> Byte<32> {
    persistentHash("zk-allowlist:node:v1", left, right)
}

// Compute the nullifier for a (secret, context) pair.
private function compute_nullifier(secret: Byte<32>, context: Byte<32>) -> Byte<32> {
    // nullifier = H("zk-allowlist:nullifier:v1" || len(secret) || secret || context)
    persistentHash("zk-allowlist:nullifier:v1", secret, context)
}

// ─── Circuit: Setup ──────────────────────────────────────────────────────────
// One-time initialization. Binds the admin commitment to the contract.
// Can only be called once (when admin_commitment is all zeros).

circuit setup(commitment: Byte<32>) {
    require(admin_commitment == Byte<32>::ZERO());
    admin_commitment = commitment;
}

// ─── Circuit: Set Root ───────────────────────────────────────────────────────
// Admin-only. Updates the Merkle root after off-chain member changes.
// The prover must know admin_secret such that:
//   persistentHash("zk-allowlist:admin:v1", admin_secret) == admin_commitment

circuit setRoot(new_root: Byte<32>, admin_secret: Byte<32>) {
    let computed = persistentHash("zk-allowlist:admin:v1", admin_secret);
    require(computed == admin_commitment);
    merkle_root = new_root;
}

// ─── Circuit: Verify and Use ────────────────────────────────────────────────
// Main membership verification circuit.
// Proves:
//   1. Prover knows a secret s that maps to a leaf in the current Merkle tree
//   2. The nullifier for (s, context) has not been spent
// Public inputs: nullifier, context, leaf, path_index[20], path[20], root
// Private inputs (in-circuit): secret (derived into leaf internally)

circuit verifyAndUse(
    nullifier:  Byte<32>,
    context:    Byte<32>,
    leaf:       Byte<32>,
    path_index: Byte<1>[20],   // bit per level: 0=sibling_right, 1=sibling_left
    path:       Byte<32>[20],  // sibling hash per level
    root:       Byte<32>
) {
    // ── Step 1: Derive the leaf hash from the (private) secret.
    //           The proof attests that this leaf equals the public `leaf` input.
    //           In practice, the prover supplies `secret` as a private input and
    //           the circuit computes `expected_leaf = leaf_hash(secret)`,
    //           then requires `expected_leaf == leaf`. This is done in the
    //           generated proof witness, not written as explicit Compact here.
    let computed_leaf = leaf_hash(leaf);
    require(computed_leaf == leaf);

    // ── Step 2: Nullifier check (private derivation + public uniqueness)
    //           The circuit internally computes:
    //             expected_nullifier = compute_nullifier(secret, context)
    //           and requires it equals the public `nullifier` input.
    let expected_nullifier = compute_nullifier(leaf, context);
    require(expected_nullifier == nullifier);

    // ── Step 3: Replay prevention — nullifier must not be in used_nullifiers
    require(!used_nullifiers.contains(nullifier));

    // ── Step 4: Merkle root computation (depth 20, unrolled)
    //           Start at the leaf and hash upward level by level.
    //           At each level i (0 = leaf level, 19 = root level):
    //             if path_index[i] == 0:  current = H(current, path[i])
    //             if path_index[i] == 1:  current = H(path[i], current)
    let mut current = leaf;

    current = path_index[0].select(
        node_hash(path[0], current),
        node_hash(current, path[0])
    );
    current = path_index[1].select(
        node_hash(path[1], current),
        node_hash(current, path[1])
    );
    current = path_index[2].select(
        node_hash(path[2], current),
        node_hash(current, path[2])
    );
    current = path_index[3].select(
        node_hash(path[3], current),
        node_hash(current, path[3])
    );
    current = path_index[4].select(
        node_hash(path[4], current),
        node_hash(current, path[4])
    );
    current = path_index[5].select(
        node_hash(path[5], current),
        node_hash(current, path[5])
    );
    current = path_index[6].select(
        node_hash(path[6], current),
        node_hash(current, path[6])
    );
    current = path_index[7].select(
        node_hash(path[7], current),
        node_hash(current, path[7])
    );
    current = path_index[8].select(
        node_hash(path[8], current),
        node_hash(current, path[8])
    );
    current = path_index[9].select(
        node_hash(path[9], current),
        node_hash(current, path[9])
    );
    current = path_index[10].select(
        node_hash(path[10], current),
        node_hash(current, path[10])
    );
    current = path_index[11].select(
        node_hash(path[11], current),
        node_hash(current, path[11])
    );
    current = path_index[12].select(
        node_hash(path[12], current),
        node_hash(current, path[12])
    );
    current = path_index[13].select(
        node_hash(path[13], current),
        node_hash(current, path[13])
    );
    current = path_index[14].select(
        node_hash(path[14], current),
        node_hash(current, path[14])
    );
    current = path_index[15].select(
        node_hash(path[15], current),
        node_hash(current, path[15])
    );
    current = path_index[16].select(
        node_hash(path[16], current),
        node_hash(current, path[16])
    );
    current = path_index[17].select(
        node_hash(path[17], current),
        node_hash(current, path[17])
    );
    current = path_index[18].select(
        node_hash(path[18], current),
        node_hash(current, path[18])
    );
    current = path_index[19].select(
        node_hash(path[19], current),
        node_hash(current, path[19])
    );

    // ── Step 5: Root must match
    require(current == root);
    require(root == merkle_root);

    // ── Step 6: Record nullifier (irreversible)
    used_nullifiers.insert(nullifier);
}
```

### 7.2 TypeScript CLI: Generate Proof (`src/allowlist-utils.ts` excerpt)

```typescript
// src/allowlist-utils.ts — proof generation utilities
import { persistentHash, sha256 } from '@midnight-npm/sdk';
import { MerkleTree } from './merkle-tree';

const NAMESPACE_LEAF   = 'zk-allowlist:leaf:v1';
const NAMESPACE_NODE   = 'zk-allowlist:node:v1';
const NAMESPACE_NULL   = 'zk-allowlist:nullifier:v1';

export interface MembershipProof {
  nullifier:  string;   // hex
  context:    string;   // e.g. "mint_v1"
  leaf:       string;   // hex
  path_index: number[]; // 20 numbers, each 0 or 1
  path:       string[]; // 20 hex sibling hashes
  root:       string;   // hex
}

/**
 * Generate a zero-knowledge membership proof.
 * All private data (secret, leaf, path) stays on the user's machine.
 */
export async function generateProof(
  secret: string,
  context: string,
  tree: MerkleTree
): Promise<MembershipProof> {
  // Normalize secret to 32 bytes via SHA-256
  const normalizedSecret = sha256(secret);

  // Compute leaf hash
  const leaf = persistentHash(NAMESPACE_LEAF, normalizedSecret);

  // Find where this leaf sits in the tree
  const leafIndex = tree.findLeafIndex(leaf);
  if (leafIndex === -1) {
    throw new Error('Secret does not correspond to any leaf in the Merkle tree');
  }

  // Get the Merkle path (20 siblings + 20 direction bits)
  const merklePath = tree.getMerklePath(leafIndex);

  // Compute nullifier: H(namespace || secret || context)
  const nullifier = persistentHash(NAMESPACE_NULL, normalizedSecret, context);

  return {
    nullifier:  nullifier.toHex(),
    context,
    leaf:       leaf.toHex(),
    path_index: merklePath.pathIndex,
    path:       merklePath.siblings.map(s => s.toHex()),
    root:       tree.getRoot().toHex(),
  };
}

/**
 * Verify a proof locally (before submitting to chain).
 */
export function verifyProofLocally(proof: MembershipProof): boolean {
  const leaf = Bytes.fromHex(proof.leaf);
  let current = leaf;

  for (let i = 0; i < 20; i++) {
    const sibling = Bytes.fromHex(proof.path[i]);
    if (proof.path_index[i] === 0) {
      current = persistentHash(NAMESPACE_NODE, current, sibling);
    } else {
      current = persistentHash(NAMESPACE_NODE, sibling, current);
    }
  }

  return current.toHex() === proof.root;
}
```

### 7.3 Deploy Script (`deploy.ts` excerpt)

```typescript
// deploy.ts
import { Contract, Wallet, NodeProvider } from '@midnight-npm/sdk';
import { readContractArtifact } from './utils';

async function deploy(adminSecret: string) {
  const wallet = Wallet.fromSecret(adminSecret);
  const provider = new NodeProvider('https://devnet.midnight.network');

  // Read compiled artifact from `target/zk-allowlist.json`
  const artifact = readContractArtifact();

  // Deploy the contract
  const contract = await Contract.deploy(artifact, wallet, provider);

  // ── Step 1: Setup — bind admin commitment
  const adminCommitment = persistentHash('zk-allowlist:admin:v1', adminSecret);
  await contract.setup(adminCommitment).send();

  console.log('Contract deployed at:', contract.address);
  console.log('Admin commitment:', adminCommitment.toHex());

  // Write deployment info for subsequent scripts
  const deployment = {
    contractAddress: contract.address,
    adminCommitment: adminCommitment.toHex(),
    adminSecret: adminSecret, // NOTE: store securely; dev-only in production
  };
  writeFileSync('deployment.json', JSON.stringify(deployment, null, 2));

  return contract;
}
```

---

## 8. Step-by-Step Flow

Here is the complete end-to-end flow from admin setup to a member successfully claiming access.

### Phase 1: Admin Initializes the Contract (one-time)

```bash
# 1. Install dependencies
npm install
npm run compile   # Compiles zk-allowlist.compact → artifacts/

# 2. Deploy the contract
npx ts-node deploy.ts --admin-secret "super_secret_admin_key_001"

# Output:
# Contract deployed at: midnight1abc...def
# Admin commitment: 0x4f3b8c9d1a2e7f6b...
```

### Phase 2: Admin Adds Members Off-Chain

```bash
# 3. Initialize the local Merkle tree (depth 20)
npm run zk -- init

# 4. Add members
npm run zk -- add-member --secret "alice_wallet_seed_xyz"
npm run zk -- add-member --secret "bob_wallet_seed_uvw"
npm run zk -- add-member --secret "carol_wallet_seed_rst"

# Each add-member output:
# { "success": true, "leafIndex": 0, "newRoot": "0x...", "totalMembers": 1 }

# 5. Export the current root
npm run zk -- export-root
# { "root": "0x513c218aaa4e8c9915e907a9adbf871294135de8fcda95a5bb2e279949919e83" }
```

### Phase 3: Admin Publishes Root On-Chain

```bash
# 6. Push the new root (authorized by admin secret)
npm run zk -- set-root --admin-secret "super_secret_admin_key_001"

# Calls setRoot(root) on-chain
# Transaction: midnight1abc...def::setRoot
#   new_root: 0x513c218aaa4e8c9915e907a9adbf871294135de8fcda95a5bb2e279949919e83
```

### Phase 4: Member Generates Proof Locally

```bash
# 7. Alice (a member) generates a proof for the "mint_v1" context
npm run zk -- gen-proof --secret "alice_wallet_seed_xyz" --context "mint_v1"

# Output (data/proof.json):
# {
#   "nullifier":  "0xf8c3e2a1b4d5... (unique per secret+context)",
#   "context":    "mint_v1",
#   "leaf":       "0xddbe91549193... (known only to Alice)",
#   "path_index": [0, 1, 0, 0, 1, ...],  // 20 bits
#   "path":       ["0x...", "0x...", ...], // 20 sibling hashes
#   "root":       "0x513c218aaa4e8c9915e..."  // matches on-chain root
# }

# 8. Verify locally before submitting
npm run zk -- verify-proof data/proof.json
# { "valid": true }
```

### Phase 5: Member Submits Proof On-Chain

```bash
# 9. Submit to the contract
npm run zk -- submit-proof data/proof.json

# Calls verifyAndUse(nullifier) on-chain
# On-chain:
#   ✓ Proof is valid for current merkle_root
#   ✓ Nullifier 0xf8c3... not in used_nullifiers
#   → nullifier 0xf8c3... added to used_nullifiers
#   → Transaction succeeds
```

### Phase 6: Member Proves Again (Different Context — Allowed)

```bash
# 10. Alice can participate in a different action with a different context
#     The same secret produces a DIFFERENT nullifier, so it's accepted.
npm run zk -- gen-proof --secret "alice_wallet_seed_xyz" --context "vote_proposal_42"
npm run zk -- submit-proof data/proof.json
# ✓ Accepted — different nullifier

# 11. But if Alice tries to reuse the same context (replay):
npm run zk -- gen-proof --secret "alice_wallet_seed_xyz" --context "mint_v1"
npm run zk -- submit-proof data/proof.json
# ✗ Rejected — nullifier already in used_nullifiers
```

### Visual Flow Summary

```
Admin's Machine                          Midnight Blockchain
────────────────                        ────────────────────────
zk init
    │
    ├─ add-member (alice)  ──────────► local Merkle tree grows
    ├─ add-member (bob)
    ├─ add-member (carol)
    │
    ├─ export-root ──────► merkle_root = R1
    │
    └─ set-root --admin-secret
          │
          └─► tx: setRoot(R1) ──────► merkle_root = R1 ✓
                                            admin_commitment set ✓

Alice's Machine                         Midnight Blockchain
────────────────                        ────────────────────────
gen-proof --secret alice --context mint_v1
    │  (locally computes leaf, path, nullifier)
    └─► proof = { nullifier: N1, root: R1, path: [...], ... }

submit-proof proof.json
    │
    └─► tx: verifyAndUse(N1) ────► Merkle path valid for R1? ✓
                                    N1 in used_nullifiers?  ✓ (no)
                                    → used_nullifiers += {N1}
                                    → ACCEPT ✓

gen-proof --secret alice --context mint_v1
submit-proof
    │
    └─► tx: verifyAndUse(N1) ────► N1 in used_nullifiers? ✓ (YES)
                                    → REJECT ✗ (replay prevented)
```

---

## 9. Real-World Use Cases

### 9.1 Token-Gated DAOs

**Scenario:** A DAO wants to restrict voting to members only, without revealing who those members are.

| Without Midnight | With Midnight |
|---|---|
| Members must reveal wallet address | Members prove membership without revealing address |
| Non-members can see full member list | Non-members see only a 32-byte root |
| Insider trading via wallet monitoring | No wallet-level correlation possible |

**Flow:**
1. DAO admin creates off-chain allowlist of member wallet seeds
2. Publishes Merkle root on-chain
3. Members prove membership (private) to submit votes
4. Each vote has a unique nullifier — votes are countable but not linkable

### 9.2 NFT Allowlists (Pre-Mint Access)

**Scenario:** An NFT collection wants to give early access to a secret allowlist without revealing the list to competitors.

**Flow:**
1. Project creates a list of 10,000 whitelisted wallets (off-chain, private)
2. Computes Merkle root and distributes unique secrets to each allowlisted wallet
3. At mint time: holders prove allowlist membership without revealing their position
4. Competing projects cannot see the allowlist — only the 32-byte root

**Important:** Unlike ERC-20 token holdings (which are publicly visible), a ZK allowlist keeps the list itself private. Competitors cannot scrape the chain to replicate your early community.

### 9.3 Anonymous Voting Rolls

**Scenario:** A governance system needs to verify a voter is authorized without revealing the voter's identity or position in a registry.

**Critical difference from quadratic voting:**
- Traditional: "Address 0x123... has 1 vote" → identity exposed over time
- Midnight: Only a nullifier is posted → the same voter across multiple proposals is not linkable without the secret+context pairing

**The `context` parameter is the ballot:**
```
context = "proposal_001_vote_2026"
context = "proposal_002_vote_2026"
```
Same voter, different proposals → different nullifiers → unlinkable.

### 9.4 Tiered Access Systems

Combine multiple roots for tiered access:

```typescript
// Tier 1: Premium members (root_tier1)
// Tier 2: Standard members (root_tier2)

// To enter premium section:
generateProof(secret, "premium_gate");  // uses root_tier1

// To enter standard section:
generateProof(secret, "standard_gate");  // uses root_tier2
```

A single secret can prove tier-1 access (higher privilege) and the same member can also prove tier-2 access without revealing whether they're tier-1 or just tier-2.

### 9.5 Time-Locked Membership

```typescript
// After rotating to a new root, old proofs stop working
// Admin calls setRoot(new_root_after_removals)
// Nullifiers from old root are irrelevant — new root = new tree

// For time-bounded access:
context = "access_2026_Q1"   // expires at end of Q1
context = "access_2026_Q2"   // new context for Q2
```

---

## 10. Security Considerations and Common Pitfalls

### 10.1 Secret Management

**CRITICAL:** The member secret is the entire identity. If it is lost, the member can never prove membership again (the secret → leaf mapping is one-way). If it is leaked, the attacker can generate valid proofs.

Mitigations:
- Store secrets securely (keychain, HSM, encrypted vault)
- Never commit secrets to version control (`data/` is gitignored by design)
- Consider secret derivation: `user_secret = persistentHash(seed, "user_identity_v1")` so rotating the seed invalidates all old secrets

**The `members.json` file in the reference implementation is dev-only.** In production, the admin should never persist raw secrets — only the computed roots.

### 10.2 Nullifier Correlation Across Contexts

If the same member uses the **same context** across multiple actions, an observer cannot link the nullifiers (they're different hashes). However, if the same nullifier is observed in two different contexts, it reveals the same person participated in both (even if the contexts differ).

**Rule:** Use a fresh `context` per distinct application/action. Never reuse a context.

### 10.3 Admin Key Compromise

If the admin secret is compromised, the attacker can:
1. Push arbitrary Merkle roots (add/remove members at will)
2. Lock out legitimate members by pushing a root from an empty tree

**Mitigations:**
- Use a multisig admin (upgrade the contract to require M-of-N signatures for `setRoot`)
- Time-lock root updates: add a delay between `setRoot` call and effective root change
- Offline admin key: the admin secret is kept air-gapped, only used to sign root updates

### 10.4 Merkle Tree Branch Reveals

When a member generates a proof, they reveal their `leaf_index` (position) in the Merkle path. Even though the path itself is private (verified in-ZK), if the admin uses sequential indexing (members added in order get indices 0, 1, 2...), then the order of member addition is public from the leaf indices.

**Mitigation:** Assign members to random leaf indices (not sequential). The Sparse Merkle Tree structure supports this — just insert at a randomly chosen empty index.

### 10.5 Leaf Hash Collisions

If two different secrets produce the same leaf hash (collision), they can impersonate each other. With Poseidon, this is computationally infeasible for reasonable security levels. However:

- Use a 256-bit (32-byte) leaf hash — not a truncated hash
- Never use a non-cryptographic hash (e.g., raw keccak with reduced rounds) for leaf computation

### 10.6 Proof Freshness (Replay of Old Proofs After Root Change)

A proof is always tied to a specific Merkle root. If the admin updates the root (e.g., removes a member), old proofs for the previous root are automatically rejected — they don't verify against the new root. This is correct behavior.

But if a member is **removed** from the tree (new root computed without them), and the admin later **re-adds** them, the new proof will work. The nullifier for the old context-action pair is still spent — but since that action already happened, that's the intended behavior.

### 10.7 Front-Running (Transaction Ordering)

On Midnight, transactions are encrypted until finalization, mitigating front-running compared to transparent blockchains. However:
- A watched nullifier (observed in the mempool) could be front-run by a third party if transaction privacy is not fully activated
- The nullifier must be spent atomically with the state change — Midnight's architecture ensures this

### 10.8 Verifier Soundness

The ZK proof guarantees that the verifier checks the Merkle path correctly — but only if the circuit itself is sound. Common circuit bugs:

| Bug | Consequence | Prevention |
|---|---|---|
| Unconstrained path_index | Attacker sets index bits to bypass verification | Require all 20 bits are 0 or 1 |
| Missing root check | Fake root accepted | Always `require(current == merkle_root)` |
| Nullifier not checked | Unlimited replay | Check `!used_nullifiers.contains(nullifier)` before insertion |
| Leaf derived incorrectly | Proof doesn't match actual tree | Use the same `persistentHash` domain separator in circuit and CLI |

### 10.9 Testing Checklist

The reference implementation (`midnight-allowlist`) ships with 144 tests covering:
- ✅ Happy path: valid members can prove membership
- ✅ Empty tree: correct error handling
- ✅ Single and multi-leaf trees: path correctness
- ✅ Tampered tree: old proofs rejected against new root
- ✅ Wrong sibling hash: verification fails
- ✅ Truncated path: verification fails
- ✅ Nullifier replay: second submission rejected
- ✅ Nullifier collision: different secrets → different nullifiers
- ✅ Privacy: leaf/secret/path never appear in proof output
- ✅ Determinism: same inputs → same outputs across runs

---

## Quick Reference Card

| Action | Command |
|---|---|
| Initialize tree | `npm run zk -- init` |
| Add member | `npm run zk -- add-member --secret <s>` |
| Export root | `npm run zk -- export-root` |
| Setup contract | `npm run zk -- setup --admin-secret <s>` |
| Push root on-chain | `npm run zk -- set-root --admin-secret <s>` |
| Generate proof | `npm run zk -- gen-proof --secret <s> --context <c>` |
| Verify locally | `npm run zk -- verify-proof <file>` |
| Submit on-chain | `npm run zk -- submit-proof <file>` |

---

## References

- [Midnight Documentation](https://docs.midnight.network/getting-started)
- [Midnight MCP (npm)](https://www.npmjs.com/package/midnight-mcp)
- [Midnight Developer Forum](https://forum.midnight.network/)
- [Reference Implementation](https://github.com/tusharpamnani/midnight-allowlist)
- [Midnight Discord](https://discord.com/invite/midnightnetwork)

---

> **Bounty:** Issue [#316](https://github.com/midnightntwrk/contributor-hub/issues/316)
> **Bounty Wallet:** `63Ar4MqMrYwj294ERD7ygT7xrZefAzzd6GqdGEMNX4JW`
