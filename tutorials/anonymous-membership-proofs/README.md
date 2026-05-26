# Anonymous Membership Proofs: Allowlists, Voter Rolls, and Gated Access

This tutorial builds an anonymous allowlist that proves membership without revealing which member acted. The pattern is useful for gated downloads, private voting eligibility, invitation-only claims, compliance checks, and any flow where the contract needs to know that a user belongs to a set but does not need to learn the user's identity.

The example has five moving parts:

- A depth-20 sparse Merkle tree that stores member commitments.
- An admin circuit that updates the public allowlist root.
- A membership circuit that verifies a depth-20 path.
- A nullifier that prevents replay without identifying the member.
- A local workflow that keeps member secrets and Merkle paths off-chain.

The repository includes a Compact contract sketch in `contracts/AnonymousMembership.compact` and a tested JavaScript reference implementation in `src/`. The JavaScript code mirrors the contract logic so you can run the full flow locally with `npm test`.

## What You Are Building

Many access-control systems start with a public list: addresses, email hashes, ticket IDs, employee IDs, or wallet public keys. That is easy to audit, but it leaks information. If a member submits their address to prove eligibility, every observer can link that action to the allowlist entry. In a voting setting, the list can reveal who voted. In a gated access setting, it can reveal who claimed access. In a compliance setting, it can reveal more personal data than the application needs.

The anonymous membership pattern replaces public member identities with commitments. Each member has a local secret. The admin receives or derives a commitment to that secret and places the commitment into a Merkle tree. The contract only stores the tree root. Later, a member proves that their commitment appears under the current root. The contract checks the proof, records a nullifier, and accepts the action.

The nullifier is the key to replay prevention. A member derives it from the same secret and a public scope, such as `vote:proposal-7` or `gate:early-access`. The nullifier is stable for that member and that scope, so the contract can reject a second use. Because it is a hash of private material, it does not reveal which leaf was used. Different scopes produce different nullifiers, so the same member can vote once in one election and still claim access in another flow.

This design gives you a practical privacy boundary:

- Public: the current root, used nullifiers, accepted count, and admin updates.
- Private: member secrets, raw membership list, Merkle index, and Merkle path.
- Disclosed only when required: the nullifier for the current scope.

The contract does not need to know names, addresses, or which leaf matched. It only needs to know that a valid witness exists.

## Why a Sparse Merkle Tree

A sparse Merkle tree has a fixed address space. This tutorial uses depth 20, which gives `2^20` possible leaf slots. Empty leaves use deterministic zero hashes, so the tree has one well-defined empty root and can generate proofs even when most slots are unused.

Depth 20 is a useful tutorial depth because it is large enough to model realistic allowlists while keeping the verification cost easy to understand. A proof contains exactly 20 sibling hashes. Verification starts from the member leaf and walks up one level at a time:

1. Look at the lowest bit of the index.
2. If the bit is `0`, hash `current` on the left and the sibling on the right.
3. If the bit is `1`, hash the sibling on the left and `current` on the right.
4. Divide the index by two and continue.
5. After 20 levels, compare the result with the public root.

The contract can do this without seeing the whole tree. It only needs the leaf, index, path, and root. On Midnight, those values can be provided through witness data so the circuit proves the calculation without exposing unnecessary private inputs.

The JavaScript reference implementation uses SHA-256 with domain-separated labels. Production Compact contracts should use Midnight's native hash primitives consistently across off-chain tools and on-chain circuits. The important rule is that the admin tool and the contract must compute the exact same leaf, node, admin, and nullifier hashes.

## Contract State

The Compact contract keeps a small public state:

```compact
export ledger root: Bytes<32>;
export ledger adminCommitment: Bytes<32>;
export ledger acceptedCount: Counter;
export ledger nullifiers: Map<Bytes<32>, Boolean>;
```

`root` is the active allowlist root. The admin changes it whenever the off-chain membership tree changes.

`adminCommitment` is a commitment to the admin secret. The admin proves knowledge of the secret when pushing a new root. This avoids using a public caller identity as the only authority check.

`acceptedCount` is not required for security, but it is useful in tests and dashboards.

`nullifiers` records spent nullifiers. A used nullifier means one valid proof has already been accepted for that scope and member secret.

The contract also declares witnesses for private membership inputs:

```compact
witness memberLeaf(): Bytes<32>;
witness memberIndex(): Uint<32>;
witness memberPath(): Vector<20, Bytes<32>>;
```

Those witnesses represent local data assembled by the member or client. The member does not submit the full allowlist. They submit a proof that the local witness values produce the public root.

## Hash Domains

Every hash in the example includes a label:

- `midnight:anonymous-membership:leaf:v1`
- `midnight:anonymous-membership:node:v1`
- `midnight:anonymous-membership:nullifier:v1`
- `midnight:anonymous-membership:admin:v1`

Domain separation prevents one hash from being reused as another kind of value. A node hash should not also be valid as a leaf hash. An admin commitment should not also be a member commitment. Versioned labels also give you a migration path if you change the scheme later.

In the JavaScript files, these helpers live in `src/crypto.js`:

```js
export function memberLeaf(secret) {
  return sha256Hex('midnight:anonymous-membership:leaf:v1', secret);
}

export function memberNullifier(secret, scope) {
  return sha256Hex('midnight:anonymous-membership:nullifier:v1', scope, secret);
}
```

For a real app, generate member secrets with a cryptographically secure random source and store them in a wallet, encrypted local storage, or another user-controlled secret store. Do not derive membership secrets from emails, usernames, or predictable identifiers.

## Admin Flow: Add Members Off-Chain

The admin maintains the membership list off-chain. That list can be a CSV, database table, DAO voter roll, customer entitlement service, or event registration export. The private source of truth does not need to be published.

For each member:

1. Generate or receive a 32-byte member secret.
2. Compute the leaf commitment from the secret.
3. Assign the leaf to a depth-20 index.
4. Insert the leaf into the sparse Merkle tree.

The tested reference flow looks like this:

```js
const tree = new SparseMerkleTree(20);
tree.set(17, memberLeaf(aliceSecret));
tree.set(90210, memberLeaf(bobSecret));
```

Indexes do not need to be sequential, but each occupied index must be unique. A deterministic assignment strategy makes operations easier. For example, the admin can keep a database column for the assigned slot or derive a candidate slot from a member record and resolve collisions off-chain.

After all updates are applied, the admin computes the new root:

```js
const newRoot = tree.root();
```

The root is the only membership aggregate that needs to go on-chain.

## Admin Flow: Push the Root On-Chain

The admin updates the contract by proving knowledge of the admin secret and disclosing the new root:

```compact
export circuit pushRoot(newRoot: Bytes<32>): [] {
  assert(hashAdmin(adminSecret()) == adminCommitment, "only admin can update root");
  root = disclose(newRoot);
}
```

The admin secret itself remains private. The contract compares its commitment to the stored `adminCommitment`. If it matches, the contract accepts the root update.

The JavaScript reference implementation mirrors that behavior:

```js
const contract = new AnonymousMembershipContract({ adminSecret });
contract.pushRoot({ adminSecret, newRoot: tree.root() });
```

Only the current root is active in this simple tutorial. If your application needs old proofs to remain valid, store a bounded root history and verify against any non-expired root. If your application requires immediate revocation, use only the latest root and make clients refresh their path before proving.

## Member Flow: Generate a Local Proof

A member needs four local values:

- Their member secret.
- The leaf index assigned by the admin.
- The Merkle path for that index.
- A scope string for the nullifier.

The member computes the same leaf the admin inserted:

```js
const leaf = memberLeaf(aliceSecret);
```

Then the member obtains the sibling path. In this tutorial, the test asks the tree directly:

```js
const path = tree.proof(17);
```

In a production application, the path can come from an allowlist API, a static signed tree artifact, or a local tree file. The path does not need to be secret for the proof to be valid, but it can reveal which index is being used if you send it as public data. On Midnight, keep the path as witness data when the user should remain unlinkable.

Finally, the member computes a scope-specific nullifier:

```js
const nullifier = memberNullifier(aliceSecret, 'vote:proposal-7');
```

Use clear, stable scopes. A voter roll might use `vote:<proposal-id>`. A gated access system might use `claim:<campaign-id>`. A private forum might use `join:<space-id>`. Changing the scope changes the nullifier, so the scope is part of the replay policy.

## Contract Flow: Verify the Depth-20 Path

The verifier is deliberately small. It takes a leaf, index, 20 siblings, and an expected root. It hashes upward until it reaches the root:

```compact
circuit verifyDepth20Path(
  leaf: Bytes<32>,
  index: Uint<32>,
  path: Vector<20, Bytes<32>>,
  expectedRoot: Bytes<32>
): Boolean {
  let current = leaf;
  let cursor = index;

  for (let level = 0; level < 20; level = level + 1) {
    const sibling = path[level];
    if (cursor % 2 == 0) {
      current = hashNode(current, sibling);
    } else {
      current = hashNode(sibling, current);
    }
    cursor = cursor / 2;
  }

  return current == expectedRoot;
}
```

This logic is easy to audit because the proof length is fixed. A malformed path cannot shorten the proof. An incorrect index changes left/right ordering and produces a different root. A stale path verifies only against the old root, not the current one.

The JavaScript tests cover these cases. They reject a proof against a stale root, reject a proof with the wrong index, and reject a replayed nullifier.

## Contract Flow: Record the Nullifier

The membership circuit performs four checks:

1. Recompute the leaf from the member secret.
2. Check that the disclosed or witnessed leaf matches the recomputed leaf.
3. Check that the nullifier has not been used.
4. Verify the Merkle path against the current root.

If all checks pass, the circuit records the nullifier:

```compact
nullifiers.insert(nullifier, true);
acceptedCount.increment(1);
return disclose(nullifier);
```

The nullifier must be public because other transactions need to know whether it has already been spent. That does not break anonymity when it is derived from a high-entropy secret and a scope. Observers can see that someone used the allowlist for that scope, but they cannot determine which leaf was used.

Do not record the leaf as spent if the goal is anonymous one-time use. Recording the leaf directly links each action to a tree position. The nullifier gives the contract replay protection without publishing the member's commitment.

## Running the Example

From this directory:

```sh
npm test
```

The tests use Node's built-in test runner and require no external packages. They exercise the full flow:

- Admin creates a depth-20 sparse Merkle tree.
- Admin inserts member leaves off-chain.
- Admin pushes the root into the contract model.
- Member generates a local Merkle path.
- Contract verifies the path and records the nullifier.
- Replays, non-admin updates, stale roots, and wrong indexes are rejected.

The most important test is the happy path plus replay rejection:

```js
contract.proveMembership({
  leaf: aliceLeaf,
  index: 17,
  path: alicePath,
  nullifier: aliceNullifier
});
```

Calling the same proof again with the same nullifier throws `nullifier already used`.

## Applying the Pattern

For voter rolls, make the scope the election or proposal identifier. A member can prove eligibility and cast one ballot without revealing their row in the voter roll. Keep ballot content separate from the membership proof if the voting design requires additional privacy.

For gated access, make the scope the gate or campaign identifier. The contract can mint an access token, unlock a claim, or emit an authorization event after proof verification.

For allowlisted claims, use one scope per claim. If the same allowlist is reused for multiple rounds, each round should have a different scope. That lets a member claim once per round while preserving replay protection inside each round.

For compliance proofs, store only commitments in the tree and keep personal data off-chain with the issuer or user. The proof should answer the smallest useful question: "is this user in the approved set?" Avoid putting regulated or identifying data in leaves unless the application explicitly requires it.

## Client and Operator Responsibilities

The contract is only one part of the system. The privacy guarantee also depends on how the client and operator handle data before a proof reaches the chain.

The admin should keep a private mapping from real member records to assigned indexes. That mapping is operational data, not contract data. If the application has multiple administrators, treat the mapping like sensitive production infrastructure: restrict access, audit reads, and avoid exporting it into support tools. If a member loses their secret, issue a new secret, insert the new leaf, publish a new root, and remove or ignore the old assignment in the next tree version.

The member client should store the secret separately from normal application preferences. A browser demo can use local storage for convenience, but a production app should prefer wallet-managed storage, encrypted device storage, or a recovery design that matches the sensitivity of the allowlist. The secret is the member's credential. Anyone who learns it can generate the same leaf and scope nullifiers.

The proof service, if you use one, should not need raw member records. A common design is to publish a signed tree artifact containing leaves by index and enough data for clients to construct paths. The client verifies the artifact signature, extracts its own path, and generates the proof locally. If the service computes paths on demand, avoid logging the requested index together with account, IP address, or session identifiers unless that linkage is part of your explicit threat model.

Root updates should be observable. Emit or index the new root, tree version, and update time in your application backend so clients can detect stale paths before submitting transactions. A failed transaction caused by an old root is not a security failure, but it is poor user experience and can reveal timing metadata.

Finally, write down your revocation policy. Removing a leaf from the next root prevents future proofs against the latest root. It does not erase nullifiers that were already spent, and it does not invalidate proofs if your contract intentionally accepts historical roots. Match the root history policy to the product requirement before users depend on it.

## Security Checklist

Use high-entropy secrets. A nullifier is only private if the secret cannot be guessed.

Use domain-separated hashes everywhere. Leaf, node, admin, and nullifier hashes have different meanings.

Bind nullifiers to a scope. A global nullifier prevents reuse everywhere, while a scoped nullifier prevents reuse only where intended.

Keep Merkle path inputs private when index privacy matters. Public paths can reveal the tree position even if they do not reveal the underlying identity.

Avoid public caller keys as the only authorization check for sensitive circuits. Prefer proving knowledge of a committed secret for admin actions.

Plan root rotation. Decide whether old roots should expire immediately or remain valid for a short window.

Log carefully. Application logs can undo privacy if they store member secrets, raw identifiers, or leaf-to-user mappings in places that operators do not need.

## Next Steps

The tutorial implementation is intentionally small so the membership proof is visible. A production repository can extend it with a CLI for tree generation, signed root artifacts, wallet-backed secret storage, and deployment scripts. The core contract shape stays the same: store a root, verify a fixed-depth Merkle path, spend a scoped nullifier, and keep the member identity out of public state.
