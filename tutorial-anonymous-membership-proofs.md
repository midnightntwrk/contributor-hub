# Anonymous Membership Proofs: Building Allowlists, Voter Rolls & Gated Access on Midnight

## Introduction

Privacy-preserving membership verification is a fundamental building block for decentralized applications. Whether you're building a token allowlist, a voter registration system, or gated access to exclusive content, you need a way to prove "I'm on the list" without revealing who you are.

Traditional blockchain solutions expose all members publicly—every address, every transaction, every interaction is visible on-chain. This creates privacy risks: competitors can see your customer list, governments can track voters, and users lose anonymity.

Zero-knowledge proofs solve this problem. With Midnight's Compact language and sparse Merkle trees, you can build systems where users prove membership anonymously. The blockchain verifies the proof without learning the user's identity, their position in the list, or any other private information.

In this tutorial, you'll build a complete anonymous allowlist system from scratch. You'll learn:

- How sparse Merkle trees enable efficient membership proofs
- Implementing depth-20 path verification in Compact
- Nullifier-based replay prevention
- Admin root management and governance
- The complete flow from off-chain member addition to on-chain verification

By the end, you'll have a working allowlist contract with tests, ready to deploy for token sales, governance systems, or any application requiring private membership verification.

## Understanding the Architecture

### The Privacy Model

Our allowlist system separates data into two categories:

**Private (computed locally, never revealed):**
- User's secret (like a password or private key)
- Leaf hash (derived from the secret)
- Merkle path (proof of inclusion in the tree)
- Leaf index (position in the tree)

**Public (stored on-chain, visible to everyone):**
- Merkle root (commitment to the entire member list)
- Nullifier (one-time-use token preventing replay attacks)
- ZK proof (cryptographic proof of membership)

This separation is crucial. The blockchain never sees who you are—only that you're a valid member who hasn't used their proof before.

### The Flow

1. **Admin Setup (Off-Chain)**
   - Admin creates a sparse Merkle tree locally
   - Adds member secrets as leaves
   - Computes the Merkle root

2. **Root Publication (On-Chain)**
   - Admin pushes the root to the smart contract
   - Contract stores the root as the current member list commitment

3. **Proof Generation (Off-Chain)**
   - Member generates a Merkle path from their leaf to the root
   - Creates a nullifier (unique identifier for this proof)
   - Generates a ZK proof proving: "I know a secret whose leaf is in the tree"

4. **Verification (On-Chain)**
   - Member submits proof and nullifier to the contract
   - Contract verifies the Merkle path matches the stored root
   - Contract checks the nullifier hasn't been used before
   - Contract records the nullifier to prevent reuse

### Why Sparse Merkle Trees?

A sparse Merkle tree is a Merkle tree where most leaves are empty. For our allowlist:

- **Depth 20** = 2^20 = ~1 million possible positions
- **Sparse** = only occupied positions store data
- **Efficient** = proof size is constant (20 hashes) regardless of member count

This means whether you have 10 members or 100,000 members, the proof size stays the same—just 20 hash values proving the path from leaf to root.

## Contract Structure

Let's build the Compact contract step by step.

### State Variables

Our contract maintains three pieces of public state:

```compact
contract Allowlist {
    // Current Merkle root (commitment to member list)
    merkle_root: Bytes<32>;
    
    // Admin commitment (for authenticated updates)
    admin_commitment: Bytes<32>;
    
    // Used nullifiers (replay prevention)
    used_nullifiers: Set<Bytes<32>>;
}
```

**merkle_root**: The root hash of the sparse Merkle tree. When the admin adds or removes members, they compute a new tree locally and push the new root on-chain.

**admin_commitment**: A hash of the admin's secret. Only someone who knows the admin secret can update the root. This prevents unauthorized modifications.

**used_nullifiers**: A set of nullifiers that have been consumed. Each member can only use their proof once. The nullifier is derived from their secret, so the same secret always produces the same nullifier.

### Circuit 1: Setup

The setup circuit initializes the contract with an admin commitment:

```compact
circuit setup(Bytes<32> commitment) {
    // Verify this is the first setup (root is zero)
    assert(merkle_root == Bytes::<32>::default());
    
    // Store admin commitment
    admin_commitment = commitment;
    
    // Initialize empty root
    merkle_root = Bytes::<32>::default();
}
```

**Why a commitment?** We don't store the admin's secret directly. Instead, we store `hash(secret)`. Later, when the admin wants to update the root, they prove they know the secret by providing it and verifying it hashes to the stored commitment.

### Circuit 2: Set Root

The setRoot circuit allows the admin to update the Merkle root:

```compact
circuit setRoot(
    Bytes<32> admin_secret,
    Bytes<32> new_root
) {
    // Verify admin authentication
    let computed_commitment = persistentHash(
        "zk-allowlist:admin:v1",
        admin_secret
    );
    assert(computed_commitment == admin_commitment);
    
    // Update root
    merkle_root = new_root;
}
```

**Authentication flow:**
1. Admin provides their secret
2. Contract hashes it: `hash(secret)`
3. Contract compares to stored commitment
4. If match, admin is authenticated and can update the root

This happens in zero-knowledge—the secret is never revealed on-chain. The proof shows "I know a secret that hashes to the commitment" without revealing the secret itself.

### Circuit 3: Verify and Use

The core circuit verifies membership and consumes the nullifier:

```compact
circuit verifyAndUse(
    Bytes<32> secret,
    Bytes<32>[20] merkle_path,
    u32 leaf_index,
    Bytes<32> nullifier_context
) {
    // 1. Compute leaf hash from secret
    let leaf = persistentHash(
        "zk-allowlist:leaf:v1",
        secret
    );
    
    // 2. Verify Merkle path (depth 20)
    let mut current_hash = leaf;
    let mut index = leaf_index;
    
    for i in 0..20 {
        let sibling = merkle_path[i];
        
        if index % 2 == 0 {
            // Current node is left child
            current_hash = persistentHash(
                "zk-allowlist:node:v1",
                current_hash,
                sibling
            );
        } else {
            // Current node is right child
            current_hash = persistentHash(
                "zk-allowlist:node:v1",
                sibling,
                current_hash
            );
        }
        
        index = index / 2;
    }
    
    // 3. Verify computed root matches stored root
    assert(current_hash == merkle_root);
    
    // 4. Compute nullifier
    let nullifier = persistentHash(
        "zk-allowlist:nullifier:v1",
        secret,
        nullifier_context
    );
    
    // 5. Check nullifier hasn't been used
    assert(!used_nullifiers.contains(nullifier));
    
    // 6. Record nullifier
    used_nullifiers.insert(nullifier);
}
```

Let's break down each step:

**Step 1: Compute Leaf Hash**

The leaf is derived from the user's secret:
```compact
leaf = hash("zk-allowlist:leaf:v1" || secret)
```

The context string `"zk-allowlist:leaf:v1"` ensures this hash is domain-separated—it can't be confused with hashes from other parts of the system.

**Step 2: Verify Merkle Path**

This is the heart of the proof. We start at the leaf and work our way up to the root, hashing with siblings at each level:

```
Level 0 (leaf):     hash(secret)
Level 1:            hash(level0, sibling0)
Level 2:            hash(level1, sibling1)
...
Level 20 (root):    hash(level19, sibling19)
```

The `leaf_index` tells us whether we're a left or right child at each level:
- If `index % 2 == 0`: we're the left child, hash as `hash(current, sibling)`
- If `index % 2 == 1`: we're the right child, hash as `hash(sibling, current)`

After 20 iterations, we reach the root.

**Step 3: Verify Root**

We assert the computed root matches the stored root. If they match, the proof is valid—the secret is in the tree.

**Step 4: Compute Nullifier**

The nullifier is derived from the secret and a context:
```compact
nullifier = hash("zk-allowlist:nullifier:v1" || secret || context)
```

The context allows different use cases. For example:
- Context "mint_v1" for token minting
- Context "vote_proposal_42" for voting
- Context "access_tier_gold" for gated content

Same secret + different context = different nullifier, allowing multiple uses.

**Step 5-6: Replay Prevention**

We check if the nullifier has been used before. If not, we record it. This prevents the same proof from being used twice.

## Building the Merkle Tree

Now let's implement the off-chain Merkle tree that generates proofs.

### Tree Structure

```typescript
interface MerkleTree {
    depth: number;           // Tree depth (20 for ~1M capacity)
    leaves: Map<number, Bytes32>;  // Sparse leaf storage
    nodes: Map<string, Bytes32>;   // Cached internal nodes
}

const TREE_DEPTH = 20;
const LEAF_CONTEXT = "zk-allowlist:leaf:v1";
const NODE_CONTEXT = "zk-allowlist:node:v1";
```

### Hashing Functions

We use Midnight's `persistentHash` (Poseidon hash) for ZK-friendly hashing:

```typescript
import { persistentHash } from '@midnight-ntwrk/compact-runtime';

function hashLeaf(secret: Bytes32): Bytes32 {
    return persistentHash(LEAF_CONTEXT, secret);
}

function hashNode(left: Bytes32, right: Bytes32): Bytes32 {
    return persistentHash(NODE_CONTEXT, left, right);
}
```

### Inserting Leaves

```typescript
function insertLeaf(tree: MerkleTree, index: number, secret: Bytes32): void {
    if (index >= Math.pow(2, tree.depth)) {
        throw new Error(`Index ${index} exceeds tree capacity`);
    }
    
    const leaf = hashLeaf(secret);
    tree.leaves.set(index, leaf);
    
    // Clear cached nodes on this path (they're now stale)
    clearPathCache(tree, index);
}
```

### Computing the Root

```typescript
function computeRoot(tree: MerkleTree): Bytes32 {
    return computeNodeHash(tree, 0, tree.depth);
}

function computeNodeHash(
    tree: MerkleTree,
    index: number,
    level: number
): Bytes32 {
    // Check cache
    const cacheKey = `${level}:${index}`;
    if (tree.nodes.has(cacheKey)) {
        return tree.nodes.get(cacheKey)!;
    }
    
    // Base case: leaf level
    if (level === 0) {
        const leaf = tree.leaves.get(index);
        return leaf || ZERO_BYTES32;  // Empty leaves are zero
    }
    
    // Recursive case: internal node
    const leftChild = computeNodeHash(tree, index * 2, level - 1);
    const rightChild = computeNodeHash(tree, index * 2 + 1, level - 1);
    const hash = hashNode(leftChild, rightChild);
    
    // Cache result
    tree.nodes.set(cacheKey, hash);
    return hash;
}
```

### Generating Merkle Paths

```typescript
function getMerklePath(tree: MerkleTree, index: number): Bytes32[] {
    const path: Bytes32[] = [];
    
    for (let level = 0; level < tree.depth; level++) {
        // Get sibling index
        const siblingIndex = index % 2 === 0 ? index + 1 : index - 1;
        
        // Compute sibling hash
        const sibling = computeNodeHash(tree, siblingIndex, level);
        path.push(sibling);
        
        // Move to parent
        index = Math.floor(index / 2);
    }
    
    return path;
}
```

## Nullifier System

Nullifiers are the key to replay prevention. Let's understand how they work.

### Nullifier Generation

```typescript
const NULLIFIER_CONTEXT = "zk-allowlist:nullifier:v1";

function generateNullifier(
    secret: Bytes32,
    context: string
): Bytes32 {
    return persistentHash(
        NULLIFIER_CONTEXT,
        secret,
        stringToBytes(context)
    );
}
```

### Why Nullifiers Work

**Property 1: Deterministic**
- Same secret + same context → same nullifier
- This allows the contract to detect reuse

**Property 2: Unlinkable**
- Same secret + different context → different nullifier
- This allows multiple uses for different purposes

**Property 3: Anonymous**
- Nullifier reveals nothing about the secret
- Even if you see a nullifier, you can't reverse it to find the secret

### Example: Token Minting

```typescript
// Alice wants to mint tokens
const aliceSecret = generateSecret();
const mintContext = "mint_v1";

// First mint: succeeds
const nullifier1 = generateNullifier(aliceSecret, mintContext);
await contract.verifyAndUse(aliceSecret, path, index, mintContext);
// Nullifier recorded: nullifier1

// Second mint attempt: fails
const nullifier2 = generateNullifier(aliceSecret, mintContext);
// nullifier2 === nullifier1 (same secret + same context)
await contract.verifyAndUse(aliceSecret, path, index, mintContext);
// Reverts: nullifier already used

// Different context: succeeds
const voteContext = "vote_proposal_1";
const nullifier3 = generateNullifier(aliceSecret, voteContext);
// nullifier3 !== nullifier1 (different context)
await contract.verifyAndUse(aliceSecret, path, index, voteContext);
// Succeeds: new nullifier
```

## Admin Root Management

The admin manages the member list by updating the Merkle root.

### Initial Setup

```typescript
// 1. Generate admin secret
const adminSecret = generateSecret();

// 2. Compute commitment
const adminCommitment = persistentHash(
    "zk-allowlist:admin:v1",
    adminSecret
);

// 3. Deploy contract with commitment
await contract.setup(adminCommitment);
```

### Adding Members

```typescript
// 1. Create tree
const tree = createMerkleTree(TREE_DEPTH);

// 2. Add members
const members = [
    { name: "Alice", secret: generateSecret() },
    { name: "Bob", secret: generateSecret() },
    { name: "Charlie", secret: generateSecret() }
];

members.forEach((member, index) => {
    insertLeaf(tree, index, member.secret);
});

// 3. Compute new root
const newRoot = computeRoot(tree);

// 4. Push root on-chain
await contract.setRoot(adminSecret, newRoot);
```

### Removing Members

To remove a member, rebuild the tree without them:

```typescript
// 1. Create new tree
const newTree = createMerkleTree(TREE_DEPTH);

// 2. Add only active members
const activeMembers = members.filter(m => m.name !== "Bob");
activeMembers.forEach((member, index) => {
    insertLeaf(newTree, index, member.secret);
});

// 3. Compute and push new root
const newRoot = computeRoot(newTree);
await contract.setRoot(adminSecret, newRoot);
```

**Important**: Removing a member doesn't invalidate their old proofs immediately. They can still use proofs generated before the removal until you update the root. Plan your update strategy accordingly.

## Complete Flow Example

Let's walk through a complete example: a token allowlist for an NFT mint.

### Step 1: Admin Setup

```typescript
// Admin creates the allowlist
const admin = {
    secret: generateSecret(),
    commitment: null as Bytes32 | null
};

admin.commitment = persistentHash("zk-allowlist:admin:v1", admin.secret);

// Deploy contract
const contract = await deployContract();
await contract.setup(admin.commitment);

console.log("✓ Contract deployed and initialized");
```

### Step 2: Add Members

```typescript
// Create tree and add members
const tree = createMerkleTree(20);
const members = [
    { name: "Alice", secret: generateSecret(), index: 0 },
    { name: "Bob", secret: generateSecret(), index: 1 },
    { name: "Charlie", secret: generateSecret(), index: 2 }
];

members.forEach(member => {
    insertLeaf(tree, member.index, member.secret);
});

// Push root on-chain
const root = computeRoot(tree);
await contract.setRoot(admin.secret, root);

console.log("✓ Added 3 members to allowlist");
console.log("Root:", root);
```

### Step 3: Member Generates Proof

```typescript
// Alice wants to mint
const alice = members[0];

// Generate Merkle path
const path = getMerklePath(tree, alice.index);

// Generate nullifier
const mintContext = "nft_mint_v1";
const nullifier = generateNullifier(alice.secret, mintContext);

console.log("✓ Alice generated proof");
console.log("Nullifier:", nullifier);
```

### Step 4: Submit and Verify

```typescript
// Alice submits proof to contract
await contract.verifyAndUse(
    alice.secret,
    path,
    alice.index,
    mintContext
);

console.log("✓ Proof verified! Alice can mint.");

// Try to mint again (should fail)
try {
    await contract.verifyAndUse(
        alice.secret,
        path,
        alice.index,
        mintContext
    );
    console.log("✗ Should have failed!");
} catch (error) {
    console.log("✓ Replay prevented: nullifier already used");
}
```

### Step 5: Different Context

```typescript
// Alice votes on a proposal (different context)
const voteContext = "vote_proposal_1";

await contract.verifyAndUse(
    alice.secret,
    path,
    alice.index,
    voteContext
);

console.log("✓ Alice voted (different nullifier)");
```

## Testing the Contract

Comprehensive testing is crucial for ZK contracts. Here's a test suite structure:

### Test 1: Basic Membership Verification

```typescript
test("valid member can prove membership", async () => {
    const tree = createMerkleTree(20);
    const secret = generateSecret();
    insertLeaf(tree, 0, secret);
    
    const root = computeRoot(tree);
    await contract.setRoot(adminSecret, root);
    
    const path = getMerklePath(tree, 0);
    await contract.verifyAndUse(secret, path, 0, "test");
    
    // Should succeed
});
```

### Test 2: Invalid Proof Rejection

```typescript
test("invalid proof is rejected", async () => {
    const tree = createMerkleTree(20);
    const validSecret = generateSecret();
    const invalidSecret = generateSecret();
    
    insertLeaf(tree, 0, validSecret);
    const root = computeRoot(tree);
    await contract.setRoot(adminSecret, root);
    
    const path = getMerklePath(tree, 0);
    
    await expect(
        contract.verifyAndUse(invalidSecret, path, 0, "test")
    ).toRevert();
});
```

### Test 3: Replay Prevention

```typescript
test("nullifier prevents replay", async () => {
    const tree = createMerkleTree(20);
    const secret = generateSecret();
    insertLeaf(tree, 0, secret);
    
    const root = computeRoot(tree);
    await contract.setRoot(adminSecret, root);
    
    const path = getMerklePath(tree, 0);
    const context = "test";
    
    // First use: succeeds
    await contract.verifyAndUse(secret, path, 0, context);
    
    // Second use: fails
    await expect(
        contract.verifyAndUse(secret, path, 0, context)
    ).toRevert("Nullifier already used");
});
```

### Test 4: Context Separation

```typescript
test("different contexts allow multiple uses", async () => {
    const tree = createMerkleTree(20);
    const secret = generateSecret();
    insertLeaf(tree, 0, secret);
    
    const root = computeRoot(tree);
    await contract.setRoot(adminSecret, root);
    
    const path = getMerklePath(tree, 0);
    
    // Use with context 1
    await contract.verifyAndUse(secret, path, 0, "context1");
    
    // Use with context 2 (should succeed)
    await contract.verifyAndUse(secret, path, 0, "context2");
});
```

### Test 5: Admin Authentication

```typescript
test("only admin can update root", async () => {
    const wrongSecret = generateSecret();
    const newRoot = generateSecret();
    
    await expect(
        contract.setRoot(wrongSecret, newRoot)
    ).toRevert("Invalid admin secret");
});
```

## Production Deployment Considerations

### Gas Optimization

Merkle path verification is computationally expensive. Consider:

**Batch Verification**: If multiple users need to verify at once, batch their proofs into a single transaction.

**Depth Trade-offs**: Depth 20 supports ~1M members but requires 20 hash operations. For smaller lists, use depth 16 (65K members) or depth 12 (4K members).

**Caching**: Cache frequently-used Merkle paths off-chain to avoid recomputation.

### Security Best Practices

**Secret Management**: User secrets must be stored securely. Consider:
- Hardware wallets for high-value applications
- Encrypted local storage with user password
- Never transmit secrets over unencrypted channels

**Admin Key Security**: The admin secret controls the entire allowlist. Use:
- Multi-sig for admin operations
- Time-locked updates for transparency
- Regular key rotation

**Nullifier Context Design**: Choose contexts carefully:
- Use versioned contexts ("mint_v1", "mint_v2") to allow upgrades
- Include relevant parameters ("vote_proposal_42", not just "vote")
- Document context meanings for auditors

### Scalability

**Large Member Lists**: For millions of members:
- Use depth 24 (16M capacity) or depth 28 (268M capacity)
- Implement incremental tree updates (only recompute changed branches)
- Consider sharding (multiple trees with different roots)

**Frequent Updates**: If members join/leave often:
- Batch updates (update root once per day, not per member)
- Use append-only trees (never remove, just add new members)
- Implement versioned roots (keep history for audit)

## Real-World Use Cases

### Token Allowlist

```typescript
// NFT mint with allowlist
contract NFTMint {
    allowlist: Allowlist;
    minted: Map<address, bool>;
    
    circuit mint(
        secret: Bytes<32>,
        path: Bytes<32>[20],
        index: u32
    ) {
        // Verify allowlist membership
        allowlist.verifyAndUse(secret, path, index, "nft_mint_v1");
        
        // Mint NFT
        let recipient = msg.sender;
        assert(!minted.contains(recipient));
        minted.insert(recipient, true);
        
        // ... mint logic ...
    }
}
```

### Anonymous Voting

```typescript
// Governance vote with privacy
contract GovernanceVote {
    allowlist: Allowlist;
    votes: Map<u32, u32>;  // proposal_id -> vote_count
    
    circuit vote(
        proposal_id: u32,
        secret: Bytes<32>,
        path: Bytes<32>[20],
        index: u32
    ) {
        // Verify voter eligibility
        let context = format!("vote_proposal_{}", proposal_id);
        allowlist.verifyAndUse(secret, path, index, context);
        
        // Record vote
        let current = votes.get(proposal_id).unwrap_or(0);
        votes.insert(proposal_id, current + 1);
    }
}
```

### Gated Content Access

```typescript
// Premium content with membership proof
contract ContentAccess {
    allowlist: Allowlist;
    access_tiers: Map<Bytes<32>, string>;  // nullifier -> tier
    
    circuit grantAccess(
        tier: string,
        secret: Bytes<32>,
        path: Bytes<32>[20],
        index: u32
    ) {
        // Verify membership
        let context = format!("access_{}", tier);
        allowlist.verifyAndUse(secret, path, index, context);
        
        // Grant access
        let nullifier = generateNullifier(secret, context);
        access_tiers.insert(nullifier, tier);
    }
}
```

## Troubleshooting Common Issues

### Issue 1: Proof Verification Fails

**Symptom**: Valid proofs are rejected

**Causes**:
- Merkle path doesn't match current root (root was updated)
- Leaf index is wrong
- Hash contexts don't match between off-chain and on-chain

**Solution**:
```typescript
// Verify path locally before submitting
function verifyPathLocally(
    secret: Bytes32,
    path: Bytes32[],
    index: number,
    expectedRoot: Bytes32
): boolean {
    let current = hashLeaf(secret);
    let idx = index;
    
    for (const sibling of path) {
        if (idx % 2 === 0) {
            current = hashNode(current, sibling);
        } else {
            current = hashNode(sibling, current);
        }
        idx = Math.floor(idx / 2);
    }
    
    return current === expectedRoot;
}
```

### Issue 2: Nullifier Collision

**Symptom**: Different users get the same nullifier

**Cause**: Secrets are not unique

**Solution**: Ensure secrets are generated with sufficient entropy:
```typescript
import { randomBytes } from 'crypto';

function generateSecret(): Bytes32 {
    return randomBytes(32);
}
```

### Issue 3: Root Update Fails

**Symptom**: Admin cannot update root

**Causes**:
- Wrong admin secret
- Admin commitment not set
- Transaction reverted

**Solution**:
```typescript
// Verify admin secret locally
function verifyAdminSecret(
    secret: Bytes32,
    commitment: Bytes32
): boolean {
    const computed = persistentHash("zk-allowlist:admin:v1", secret);
    return computed === commitment;
}
```

## Conclusion

You've built a complete anonymous membership system using zero-knowledge proofs on Midnight. The key concepts:

- **Sparse Merkle trees** enable efficient membership proofs with constant-size proofs
- **Depth-20 verification** supports ~1 million members with 20 hash operations
- **Nullifiers** prevent replay attacks while preserving privacy
- **Admin root management** allows dynamic member lists with authenticated updates
- **Context separation** enables multiple use cases with the same membership

This system provides strong privacy guarantees:
- Members prove "I'm on the list" without revealing who they are
- The blockchain learns nothing about member identities or positions
- Nullifiers prevent reuse without linking to identities
- The admin can update the list without exposing member data

You can now build privacy-preserving applications for token sales, governance, gated access, and more. The complete code repository with tests is available at [repository link].

## Next Steps

- Explore the [Midnight Documentation](https://docs.midnight.network/) for advanced ZK patterns
- Join the [Midnight Developer Forum](https://forum.midnight.network/) to discuss implementations
- Check out the [reference implementation](https://github.com/tusharpamnani/midnight-allowlist) for production examples
- Join the [Discord community](https://discord.com/invite/midnightnetwork) for real-time support

Happy building with zero-knowledge proofs! 🌙

---

**Word Count**: 3,487 words

**Code Repository**: [Link to be added with working implementation]

**Sources**:
- [Midnight Documentation](https://docs.midnight.network/)
- [midnight-allowlist Reference Implementation](https://github.com/tusharpamnani/midnight-allowlist)
- [Midnight Developer Forum](https://forum.midnight.network/)
