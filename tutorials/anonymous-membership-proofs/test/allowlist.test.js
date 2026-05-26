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

import assert from 'node:assert/strict';
import test from 'node:test';

import { AnonymousMembershipContract } from '../src/allowlistContract.js';
import { memberLeaf, memberNullifier, randomHex32 } from '../src/crypto.js';
import { DEFAULT_DEPTH, SparseMerkleTree, verifySparseMerkleProof } from '../src/sparseMerkleTree.js';

test('admin adds members off-chain, pushes root, and a member proves inclusion once', () => {
  const adminSecret = randomHex32();
  const aliceSecret = randomHex32();
  const bobSecret = randomHex32();
  const tree = new SparseMerkleTree(DEFAULT_DEPTH);

  tree.set(17, memberLeaf(aliceSecret));
  tree.set(90210, memberLeaf(bobSecret));

  const contract = new AnonymousMembershipContract({ adminSecret });
  contract.pushRoot({ adminSecret, newRoot: tree.root() });

  const alicePath = tree.proof(17);
  const aliceLeaf = memberLeaf(aliceSecret);
  const aliceNullifier = memberNullifier(aliceSecret, 'vote:proposal-7');

  assert.equal(
    verifySparseMerkleProof({
      leaf: aliceLeaf,
      index: 17,
      path: alicePath,
      root: tree.root()
    }),
    true
  );

  assert.deepEqual(
    contract.proveMembership({
      leaf: aliceLeaf,
      index: 17,
      path: alicePath,
      nullifier: aliceNullifier
    }),
    { accepted: true, acceptedCount: 1 }
  );

  assert.throws(
    () =>
      contract.proveMembership({
        leaf: aliceLeaf,
        index: 17,
        path: alicePath,
        nullifier: aliceNullifier
      }),
    /nullifier already used/
  );
});

test('non-admin root updates are rejected', () => {
  const adminSecret = randomHex32();
  const attackerSecret = randomHex32();
  const contract = new AnonymousMembershipContract({ adminSecret });
  const tree = new SparseMerkleTree(DEFAULT_DEPTH);

  tree.set(42, memberLeaf(randomHex32()));

  assert.throws(
    () => contract.pushRoot({ adminSecret: attackerSecret, newRoot: tree.root() }),
    /only admin/
  );
});

test('wrong path, wrong index, and stale roots fail verification', () => {
  const adminSecret = randomHex32();
  const memberSecret = randomHex32();
  const tree = new SparseMerkleTree(DEFAULT_DEPTH);
  const staleTree = new SparseMerkleTree(DEFAULT_DEPTH);

  tree.set(12345, memberLeaf(memberSecret));
  staleTree.set(12346, memberLeaf(randomHex32()));

  const contract = new AnonymousMembershipContract({ adminSecret });
  contract.pushRoot({ adminSecret, newRoot: staleTree.root() });

  assert.throws(
    () =>
      contract.proveMembership({
        leaf: memberLeaf(memberSecret),
        index: 12345,
        path: tree.proof(12345),
        nullifier: memberNullifier(memberSecret, 'gate:alpha')
      }),
    /invalid membership proof/
  );

  contract.pushRoot({ adminSecret, newRoot: tree.root() });

  assert.throws(
    () =>
      contract.proveMembership({
        leaf: memberLeaf(memberSecret),
        index: 12346,
        path: tree.proof(12345),
        nullifier: memberNullifier(memberSecret, 'gate:beta')
      }),
    /invalid membership proof/
  );
});

