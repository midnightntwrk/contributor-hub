// This file is part of midnightntwrk/contributor-hub.
// Copyright (C) 2026 Midnight Foundation
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

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");

function hashPair(left, right) {
  return createHash("sha256")
    .update(Buffer.concat([Buffer.from(left, "hex"), Buffer.from(right, "hex")]))
    .digest("hex");
}

function leaf(value) {
  return createHash("sha256").update(value).digest("hex");
}

function buildTree(leaves) {
  const levels = [leaves];
  let current = leaves;

  while (current.length > 1) {
    const next = [];
    for (let i = 0; i < current.length; i += 2) {
      next.push(hashPair(current[i], current[i + 1]));
    }
    levels.push(next);
    current = next;
  }

  return levels;
}

function pathForIndex(levels, index) {
  const pathElements = [];
  const pathIndices = [];
  let cursor = index;

  for (let level = 0; level < levels.length - 1; level += 1) {
    const siblingIndex = cursor ^ 1;
    pathElements.push(levels[level][siblingIndex]);
    pathIndices.push(cursor % 2);
    cursor = Math.floor(cursor / 2);
  }

  return { pathElements, pathIndices };
}

function computeRoot(leafValue, pathElements, pathIndices) {
  return pathElements.reduce((current, sibling, level) => {
    assert(pathIndices[level] === 0 || pathIndices[level] === 1);
    return pathIndices[level] === 0
      ? hashPair(current, sibling)
      : hashPair(sibling, current);
  }, leafValue);
}

const leaves = [
  leaf("alice"),
  leaf("bob"),
  leaf("carol"),
  leaf("dave"),
  leaf("erin"),
  leaf("frank"),
  leaf("grace"),
  leaf("heidi"),
];

const levels = buildTree(leaves);
const root = levels.at(-1)[0];
const index = 2;
const proof = pathForIndex(levels, index);

assert.equal(computeRoot(leaves[index], proof.pathElements, proof.pathIndices), root);
assert.notEqual(computeRoot(leaf("mallory"), proof.pathElements, proof.pathIndices), root);

console.log("Merkle proof test vector is valid.");
