// This file is part of contributor-hub.
// Copyright (C) 2025 Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * Witness implementations for Shielded Token Operations
 *
 * Witnesses provide the private inputs to zero-knowledge proofs.
 * For shielded tokens, witnesses include:
 * - Coin secrets (prove ownership without revealing the secret)
 * - Merkle tree paths (prove coin exists in the tree)
 * - Recipient information (encrypted for the recipient)
 */

import type { Witness } from '@midnight-ntwrk/compact-runtime';

/**
 * Coin secret type - the private data that proves ownership
 * of a shielded coin. This is never revealed on-chain.
 */
export interface CoinSecret {
  /** Unique nonce for this coin */
  nonce: Uint8Array;
  /** Owner's viewing key (for balance discovery) */
  viewingKey: Uint8Array;
  /** Owner's spending key (required to spend) */
  spendingKey: Uint8Array;
}

/**
 * Merkle tree path proving a coin's inclusion in the tree.
 * Contains sibling hashes needed to reconstruct the root.
 */
export interface MerkleTreePath {
  /** The coin's position in the tree */
  index: bigint;
  /** Sibling hashes from leaf to root */
  path: Uint8Array[];
  /** The leaf hash of the coin */
  leafHash: Uint8Array;
}

/**
 * Shielded coin information for a recipient.
 * Encrypted so only the recipient can read it.
 */
export interface ShieldedCoinInfo {
  /** Recipient's viewing public key */
  viewingPubKey: Uint8Array;
  /** Encrypted coin data */
  encryptedPayload: Uint8Array;
}

/**
 * Witness for proving knowledge of a coin's secret.
 *
 * This witness allows the prover to demonstrate they know
 * the secret values associated with a coin without revealing
 * those values to the verifier. The ZK proof circuit uses
 * this witness to validate ownership during transfers and burns.
 */
export const coinSecretWitness: Witness<CoinSecret> = {
  name: 'coin_secret',
  generate: (privateInput: CoinSecret): CoinSecret => {
    // Validate the secret has the expected structure
    if (!privateInput.nonce || privateInput.nonce.length !== 32) {
      throw new Error('Invalid coin secret: nonce must be 32 bytes');
    }
    if (!privateInput.viewingKey || privateInput.viewingKey.length !== 32) {
      throw new Error('Invalid coin secret: viewingKey must be 32 bytes');
    }
    if (!privateInput.spendingKey || privateInput.spendingKey.length !== 32) {
      throw new Error('Invalid coin secret: spendingKey must be 32 bytes');
    }
    return privateInput;
  },
};

/**
 * Witness for proving a coin exists in the Merkle tree.
 *
 * The Merkle path witness provides the sibling hashes needed
 * to reconstruct the tree root from a leaf. This proves the
 * coin was committed to the tree without revealing other coins.
 */
export const merklePathWitness: Witness<MerkleTreePath> = {
  name: 'merkle_path',
  generate: (path: MerkleTreePath): MerkleTreePath => {
    // Validate the path structure
    if (path.path.length === 0) {
      throw new Error('Invalid Merkle path: path cannot be empty');
    }
    if (path.leafHash.length !== 32) {
      throw new Error('Invalid Merkle path: leafHash must be 32 bytes');
    }
    // Each path element should be a 32-byte hash
    for (const hash of path.path) {
      if (hash.length !== 32) {
        throw new Error('Invalid Merkle path: all hashes must be 32 bytes');
      }
    }
    return path;
  },
};

/**
 * Witness for the recipient's shielded coin info.
 *
 * Used during transfers to encrypt the coin data for the
 * recipient. Only someone with the recipient's viewing key
 * can decrypt and discover the received coin.
 */
export const recipientWitness: Witness<ShieldedCoinInfo> = {
  name: 'recipient_info',
  generate: (recipient: ShieldedCoinInfo): ShieldedCoinInfo => {
    // Validate recipient info structure
    if (!recipient.viewingPubKey || recipient.viewingPubKey.length !== 32) {
      throw new Error('Invalid recipient: viewingPubKey must be 32 bytes');
    }
    if (!recipient.encryptedPayload || recipient.encryptedPayload.length === 0) {
      throw new Error('Invalid recipient: encryptedPayload cannot be empty');
    }
    return recipient;
  },
};

/**
 * Utility: Create a CoinSecret from raw key material.
 *
 * Helper function to construct a properly formatted CoinSecret
 * from individual key components.
 */
export function createCoinSecret(
  nonce: Uint8Array,
  viewingKey: Uint8Array,
  spendingKey: Uint8Array
): CoinSecret {
  return { nonce, viewingKey, spendingKey };
}

/**
 * Utility: Create a MerkleTreePath from components.
 *
 * Helper function to construct a properly formatted MerkleTreePath.
 */
export function createMerklePath(
  index: bigint,
  path: Uint8Array[],
  leafHash: Uint8Array
): MerkleTreePath {
  return { index, path, leafHash };
}

/**
 * All witnesses required by the ShieldedTokenManager contract.
 * Export as a collection for easy integration with the runtime.
 */
export const shieldedTokenWitnesses = {
  coin_secret: coinSecretWitness,
  merkle_path: merklePathWitness,
  recipient_info: recipientWitness,
};

export default shieldedTokenWitnesses;
