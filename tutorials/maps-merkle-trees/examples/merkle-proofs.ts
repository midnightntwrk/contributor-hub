/**
 * Merkle Proofs - TypeScript Client for Midnight Network
 * Demonstrates Merkle Tree construction, proof generation, and verification.
 * Prerequisites: npm install @midnight-ntwrk/compact-runtime
 */

import { CompactRuntime } from '@midnight-ntwrk/compact-runtime';

interface MerkleProof {
  leaf: Uint8Array;
  path: Uint8Array[];
  directions: boolean[];
  root: Uint8Array;
}

class ClientMerkleTree {
  private depth: number;
  private leaves: Uint8Array[];
  private layers: Uint8Array[][];

  constructor(depth: number) {
    this.depth = depth;
    this.leaves = [];
    this.layers = [];
    this.initializeLayers();
  }

  private initializeLayers(): void {
    const zeroHash = new Uint8Array(32);
    for (let i = 0; i <= this.depth; i++) {
      const layerSize = Math.pow(2, this.depth - i);
      this.layers[i] = new Array(layerSize).fill(null).map(() => {
        const copy = new Uint8Array(32);
        copy.set(zeroHash);
        return copy;
      });
    }
  }

  insert(leaf: Uint8Array): number {
    const index = this.leaves.length;
    if (index >= Math.pow(2, this.depth)) {
      throw new Error('Merkle tree is full');
    }
    this.leaves.push(leaf);
    this.layers[0][index] = leaf;
    this.recomputePath(index);
    return index;
  }

  private recomputePath(leafIndex: number): void {
    let currentIndex = leafIndex;
    for (let level = 0; level < this.depth; level++) {
      const siblingIndex = currentIndex % 2 === 0 ? currentIndex + 1 : currentIndex - 1;
      const left = currentIndex % 2 === 0 ? this.layers[level][currentIndex] : this.layers[level][siblingIndex];
      const right = currentIndex % 2 === 0 ? this.layers[level][siblingIndex] : this.layers[level][currentIndex];
      const parentIndex = Math.floor(currentIndex / 2);
      this.layers[level + 1][parentIndex] = this.hashPair(left, right);
      currentIndex = parentIndex;
    }
  }

  private hashPair(left: Uint8Array, right: Uint8Array): Uint8Array {
    const combined = new Uint8Array(64);
    combined.set(left, 0);
    combined.set(right, 32);
    const result = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      result[i] = combined[i] ^ combined[i + 32] ^ (i * 7);
    }
    return result;
  }

  root(): Uint8Array {
    return this.layers[this.depth][0];
  }

  proof(leafIndex: number): MerkleProof {
    if (leafIndex >= this.leaves.length) {
      throw new Error('Leaf index out of bounds');
    }
    const path: Uint8Array[] = [];
    const directions: boolean[] = [];
    let currentIndex = leafIndex;

    for (let level = 0; level < this.depth; level++) {
      const isRight = currentIndex % 2 === 1;
      const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;
      path.push(this.layers[level][siblingIndex]);
      directions.push(isRight);
      currentIndex = Math.floor(currentIndex / 2);
    }

    return { leaf: this.leaves[leafIndex], path, directions, root: this.root() };
  }

  size(): number {
    return this.leaves.length;
  }

  capacity(): number {
    return Math.pow(2, this.depth);
  }
}

function verifyProof(proof: MerkleProof): boolean {
  let current = proof.leaf;
  for (let i = 0; i < proof.path.length; i++) {
    const sibling = proof.path[i];
    const isRight = proof.directions[i];
    current = isRight ? hashPair(sibling, current) : hashPair(current, sibling);
  }
  return arraysEqual(current, proof.root);
}

function hashPair(left: Uint8Array, right: Uint8Array): Uint8Array {
  const combined = new Uint8Array(64);
  combined.set(left, 0);
  combined.set(right, 32);
  const result = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    result[i] = combined[i] ^ combined[i + 32] ^ (i * 7);
  }
  return result;
}

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

class MerkleContractClient {
  private runtime: CompactRuntime;
  private contractAddress: string;

  constructor(runtime: CompactRuntime, contractAddress: string) {
    this.runtime = runtime;
    this.contractAddress = contractAddress;
  }

  async insertCredential(credentialHash: Uint8Array): Promise<void> {
    await this.runtime.invokeCircuit(this.contractAddress, 'issue_credential', [credentialHash]);
  }

  async getTreeRoot(): Promise<Uint8Array> {
    const result = await this.runtime.invokeCircuit(this.contractAddress, 'get_tree_root', []);
    return result as Uint8Array;
  }

  async verifyCredential(credentialId: Uint8Array, proofPath: Uint8Array[], proofDirections: boolean[]): Promise<boolean> {
    const result = await this.runtime.invokeCircuit(this.contractAddress, 'verify_credential', [credentialId, proofPath, proofDirections]);
    return result as boolean;
  }
}

async function main() {
  console.log('=== Midnight Network Merkle Proof Operations ===\n');

  const tree = new ClientMerkleTree(16);
  console.log(`Created Merkle tree with capacity: ${tree.capacity()}`);

  const credentials: Uint8Array[] = [];
  for (let i = 0; i < 5; i++) {
    const leaf = new Uint8Array(32);
    leaf[0] = i + 1;
    leaf[1] = 0xAB;
    const index = tree.insert(leaf);
    credentials.push(leaf);
    console.log(`Inserted credential at index ${index}`);
  }

  const root = tree.root();
  console.log(`\nMerkle root: ${Buffer.from(root).toString('hex')}`);

  const proofIndex = 2;
  const proof = tree.proof(proofIndex);
  console.log(`\nGenerated proof for leaf ${proofIndex}:`);
  console.log(`  Path length: ${proof.path.length}`);
  console.log(`  Root matches: ${arraysEqual(proof.root, tree.root())}`);

  const isValid = verifyProof(proof);
  console.log(`  Client-side verification: ${isValid}`);

  console.log('\n--- Multiple Proofs ---');
  for (let i = 0; i < tree.size(); i++) {
    const p = tree.proof(i);
    const valid = verifyProof(p);
    console.log(`Leaf ${i}: proof valid = ${valid}`);
  }

  console.log('\n=== Merkle Proof Operations Complete ===');
}

if (require.main === module) {
  main().catch(console.error);
}

export { ClientMerkleTree, MerkleContractClient, MerkleProof, verifyProof };
