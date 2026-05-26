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

import { adminCommitment, assertHex32 } from './crypto.js';
import { DEFAULT_DEPTH, zeroHashes, verifySparseMerkleProof } from './sparseMerkleTree.js';

export class AnonymousMembershipContract {
  constructor({ adminSecret, depth = DEFAULT_DEPTH } = {}) {
    if (!adminSecret) {
      throw new TypeError('adminSecret is required');
    }
    this.depth = depth;
    this.admin = adminCommitment(adminSecret);
    this.currentRoot = zeroHashes(depth)[depth];
    this.usedNullifiers = new Set();
    this.accepted = 0;
  }

  assertAdmin(adminSecret) {
    if (adminCommitment(adminSecret) !== this.admin) {
      throw new Error('only admin can update the root');
    }
  }

  pushRoot({ adminSecret, newRoot }) {
    this.assertAdmin(adminSecret);
    assertHex32(newRoot, 'newRoot');
    this.currentRoot = newRoot;
    return this.currentRoot;
  }

  proveMembership({ leaf, index, path, nullifier }) {
    assertHex32(nullifier, 'nullifier');
    if (this.usedNullifiers.has(nullifier)) {
      throw new Error('nullifier already used');
    }

    const verified = verifySparseMerkleProof({
      leaf,
      index,
      path,
      root: this.currentRoot,
      depth: this.depth
    });

    if (!verified) {
      throw new Error('invalid membership proof');
    }

    this.usedNullifiers.add(nullifier);
    this.accepted += 1;
    return { accepted: true, acceptedCount: this.accepted };
  }
}

