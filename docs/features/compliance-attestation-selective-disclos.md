# Compliance Attestation System with Selective Disclosure
> Last updated: 2026-04-23

## Overview
This feature introduces a tutorial and working Compact contract that demonstrates privacy-preserving compliance proofs on the Midnight blockchain. An authority attests to user properties (age, residency, certification) by committing Merkle tree roots to ledger state; users can then prove individual properties in zero-knowledge without revealing the others. Domain-separated hashing ensures that proofs for different properties cannot be correlated, providing cross-property unlinkability.

## How It Works
The system is built around three planned files:

- **`compliance-attestation.compact`** — The Compact contract. Ledger state stores one Merkle root per property type (age, residency, certification). Each circuit accepts a Merkle membership proof and a domain-separated leaf hash (constructed with a property-specific prefix) and verifies inclusion against the stored root without exposing sibling nodes or the full attribute set.
- **`test/compliance.test.ts`** — TypeScript test suite that exercises each selective-disclosure circuit in isolation, verifies that a proof for one property cannot satisfy the circuit for another property (unlinkability), and confirms that the authority attestation flow correctly updates ledger roots.
- **`tutorial.md`** — Written tutorial (2,500–3,500 words) covering authority attestation via Merkle commitments, selective proof construction, domain-separation design, and a walkthrough of the unlinkability demonstration.

Domain separation is achieved by prefixing each leaf value with a property-type tag before hashing, so the hash of `age‖value` is structurally distinct from `residency‖value` even when the underlying value is identical. This means a Merkle proof generated for the age tree cannot be replayed against the residency tree's circuit.

## Configuration
No runtime environment variables are required. The Compact compiler must be available in the development environment to compile `compliance-attestation.compact`. Node.js and the Midnight SDK are required to run the TypeScript test suite.

## Usage
```bash
# Compile the Compact contract
compactc compliance-attestation.compact

# Run the test suite
npx jest test/compliance.test.ts
```

Example selective-disclosure flow (pseudocode):
```typescript
// Authority attests by submitting Merkle roots
await contract.attest({
  ageRoot: merkleRoot(domainHash('age', ageLeaves)),
  residencyRoot: merkleRoot(domainHash('residency', residencyLeaves)),
  certRoot: merkleRoot(domainHash('cert', certLeaves)),
});

// User proves age without revealing residency or certification
await contract.proveAge({
  leaf: domainHash('age', userAgeValue),
  proof: merkleProof(ageTree, userAgeValue),
});
```

## References
- Closes issue #315
- Midnight documentation: https://docs.midnight.network/getting-started
- Developer forum: https://forum.midnight.network/
