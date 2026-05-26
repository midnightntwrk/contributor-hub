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

import { assertHex32, sha256Hex } from './crypto.js';

export const DEFAULT_DEPTH = 20;

function assertDepth(depth) {
  if (!Number.isInteger(depth) || depth < 1 || depth > 32) {
    throw new RangeError('depth must be an integer between 1 and 32');
  }
}

function assertIndex(index, depth) {
  if (!Number.isInteger(index) || index < 0 || index >= 2 ** depth) {
    throw new RangeError(`index must be an integer in [0, ${2 ** depth})`);
  }
}

export function hashNode(left, right) {
  assertHex32(left, 'left');
  assertHex32(right, 'right');
  return sha256Hex('midnight:anonymous-membership:node:v1', left, right);
}

export function zeroHashes(depth = DEFAULT_DEPTH) {
  assertDepth(depth);
  const zeros = [sha256Hex('midnight:anonymous-membership:zero:v1')];
  for (let level = 0; level < depth; level += 1) {
    zeros.push(hashNode(zeros[level], zeros[level]));
  }
  return zeros;
}

export class SparseMerkleTree {
  constructor(depth = DEFAULT_DEPTH) {
    assertDepth(depth);
    this.depth = depth;
    this.zeros = zeroHashes(depth);
    this.leaves = new Map();
  }

  set(index, leaf) {
    assertIndex(index, this.depth);
    assertHex32(leaf, 'leaf');
    this.leaves.set(index, leaf);
  }

  root() {
    let level = new Map(this.leaves);
    for (let height = 0; height < this.depth; height += 1) {
      const parents = new Map();
      const parentIndexes = new Set([...level.keys()].map((index) => Math.floor(index / 2)));
      for (const parentIndex of parentIndexes) {
        const left = level.get(parentIndex * 2) ?? this.zeros[height];
        const right = level.get(parentIndex * 2 + 1) ?? this.zeros[height];
        parents.set(parentIndex, hashNode(left, right));
      }
      level = parents;
    }
    return level.get(0) ?? this.zeros[this.depth];
  }

  proof(index) {
    assertIndex(index, this.depth);
    let cursor = index;
    let level = new Map(this.leaves);
    const siblings = [];

    for (let height = 0; height < this.depth; height += 1) {
      const siblingIndex = cursor % 2 === 0 ? cursor + 1 : cursor - 1;
      siblings.push(level.get(siblingIndex) ?? this.zeros[height]);

      const parents = new Map();
      const parentIndexes = new Set([...level.keys()].map((leafIndex) => Math.floor(leafIndex / 2)));
      for (const parentIndex of parentIndexes) {
        const left = level.get(parentIndex * 2) ?? this.zeros[height];
        const right = level.get(parentIndex * 2 + 1) ?? this.zeros[height];
        parents.set(parentIndex, hashNode(left, right));
      }

      cursor = Math.floor(cursor / 2);
      level = parents;
    }

    return siblings;
  }
}

export function verifySparseMerkleProof({ leaf, index, path, root, depth = DEFAULT_DEPTH }) {
  assertDepth(depth);
  assertIndex(index, depth);
  assertHex32(leaf, 'leaf');
  assertHex32(root, 'root');
  if (!Array.isArray(path) || path.length !== depth) {
    throw new TypeError(`path must contain exactly ${depth} sibling hashes`);
  }

  let current = leaf;
  let cursor = index;
  for (let height = 0; height < depth; height += 1) {
    const sibling = path[height];
    assertHex32(sibling, `path[${height}]`);
    current = cursor % 2 === 0 ? hashNode(current, sibling) : hashNode(sibling, current);
    cursor = Math.floor(cursor / 2);
  }

  return current === root;
}

