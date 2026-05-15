// This file is part of contributor-hub.
// Copyright (C) 2025 Midnight Foundation
// SPDX-License-Identifier: Apache-2.0

// Merkle Witness Provider — TypeScript Implementation
// Implements witness providers for merkle-witness.compact

import { WitnessProviders, Field } from "@midnight-ntwrk/compact-runtime";

// --- Types ---

interface MerklePath {
  siblings: bigint[];
  directions: boolean[];
}

interface TokenCommitment {
  value: bigint;
  owner_hash: bigint;
  salt: bigint;
}

// --- Simple Merkle Tree ---

class SimpleMerkleTree {
  private leaves: bigint[];
  private layers: bigint[][];

  constructor(leaves: bigint[]) {
    this.leaves = [...leaves];
    this.layers = [leaves];
    this.buildTree();
  }

  private hashPair(left: bigint, right: bigint): bigint {
    return (left + right * 2n) % (2n ** 254n);
  }

  private buildTree(): void {
    let currentLayer = this.leaves;
    while (currentLayer.length > 1) {
      const nextLayer: bigint[] = [];
      for (let i = 0; i < currentLayer.length; i += 2) {
        const left = currentLayer[i];
        const right = i + 1 < currentLayer.length ? currentLayer[i + 1] : 0n;
        nextLayer.push(this.hashPair(left, right));
      }
      this.layers.push(nextLayer);
      currentLayer = nextLayer;
    }
  }

  getRoot(): bigint {
    return this.layers[this.layers.length - 1][0];
  }

  getLeaf(index: number): bigint {
    return this.leaves[index] ?? 0n;
  }

  getProof(index: number): MerklePath {
    const siblings: bigint[] = [];
    const directions: boolean[] = [];
    let currentIndex = index;
    for (let layer = 0; layer < this.layers.length - 1; layer++) {
      const isRight = currentIndex % 2 === 1;
      const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;
      const sibling = this.layers[layer][siblingIndex] ?? 0n;
      siblings.push(sibling);
      directions.push(isRight);
      currentIndex = Math.floor(currentIndex / 2);
    }
    return { siblings, directions };
  }
}

// --- Off-Chain Data ---

const tokenCommitments: TokenCommitment[] = [
  { value: 100n, owner_hash: 0xdeadbeefn, salt: 42n },
  { value: 200n, owner_hash: 0xcafebaben, salt: 43n },
  { value: 300n, owner_hash: 0xfacefeedn, salt: 44n },
  { value: 50n,  owner_hash: 0x12345678n, salt: 45n },
];

function commitToken(token: TokenCommitment): bigint {
  return ((token.value + token.owner_hash * 2n) + token.salt * 2n) % (2n ** 254n);
}

const leafValues = tokenCommitments.map(commitToken);
const merkleTree = new SimpleMerkleTree(leafValues);

console.log(`[MerkleTree] Root: ${merkleTree.getRoot()}`);
console.log(`[MerkleTree] Leaves: ${leafValues.length}`);

// --- Witness Providers ---

export const merkleWitnessProviders: WitnessProviders = {

  /** Returns the leaf value at a given index. */
  get_leaf_value: (index: bigint): bigint => {
    const idx = Number(index);
    const value = merkleTree.getLeaf(idx);
    console.log(`[get_leaf_value] index=${idx} => ${value}`);
    return value;
  },

  /** Returns the Merkle proof for a given leaf index. */
  get_merkle_proof: (index: bigint): MerklePath => {
    const idx = Number(index);
    const proof = merkleTree.getProof(idx);
    console.log(`[get_merkle_proof] index=${idx} => ${proof.siblings.length} siblings`);
    return proof;
  },

  /** Returns the full token commitment at a given index. */
  get_commitment: (index: bigint): TokenCommitment => {
    const idx = Number(index);
    const commitment = tokenCommitments[idx];
    console.log(`[get_commitment] index=${idx} =>`, commitment);
    return commitment ?? { value: 0n, owner_hash: 0n, salt: 0n };
  },
};

// --- Demo ---

function demo() {
  console.log("\n=== Merkle Witness Provider Demo ===\n");

  const leafIndex = 2n;

  console.log("--- Getting leaf value ---");
  const leaf = merkleWitnessProviders.get_leaf_value(leafIndex);

  console.log("\n--- Getting Merkle proof ---");
  const proof = merkleWitnessProviders.get_merkle_proof(leafIndex) as MerklePath;
  console.log(`  Siblings (first 3): [${proof.siblings.slice(0, 3).join(", ")}...]`);
  console.log(`  Directions (first 3): [${proof.directions.slice(0, 3).join(", ")}...]`);

  console.log("\n--- Getting full commitment ---");
  const commitment = merkleWitnessProviders.get_commitment(leafIndex) as TokenCommitment;
  console.log(`  Value: ${commitment.value}, Owner: 0x${commitment.owner_hash.toString(16)}, Salt: ${commitment.salt}`);

  console.log("\n--- Verification ---");
  const root = merkleTree.getRoot();
  console.log(`  Tree root: ${root}`);
  console.log(`  (In the Compact circuit, root is recomputed from leaf + proof and compared to on-chain root)\n`);

  console.log("=== Demo Complete ===");
}

if (require.main === module) {
  demo();
}

export default merkleWitnessProviders;
