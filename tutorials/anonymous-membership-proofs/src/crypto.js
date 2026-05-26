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

import { createHash, randomBytes } from 'node:crypto';

const HEX_32 = /^[0-9a-f]{64}$/u;

export function randomHex32() {
  return randomBytes(32).toString('hex');
}

export function assertHex32(value, name = 'value') {
  if (typeof value !== 'string' || !HEX_32.test(value)) {
    throw new TypeError(`${name} must be a 32-byte lowercase hex string`);
  }
}

export function sha256Hex(...parts) {
  const hash = createHash('sha256');
  for (const part of parts) {
    if (typeof part === 'string') {
      hash.update(part);
    } else if (part instanceof Uint8Array) {
      hash.update(part);
    } else {
      hash.update(JSON.stringify(part));
    }
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function memberLeaf(secret) {
  assertHex32(secret, 'secret');
  return sha256Hex('midnight:anonymous-membership:leaf:v1', secret);
}

export function memberNullifier(secret, scope) {
  assertHex32(secret, 'secret');
  if (typeof scope !== 'string' || scope.length === 0) {
    throw new TypeError('scope must be a non-empty string');
  }
  return sha256Hex('midnight:anonymous-membership:nullifier:v1', scope, secret);
}

export function adminCommitment(secret) {
  assertHex32(secret, 'secret');
  return sha256Hex('midnight:anonymous-membership:admin:v1', secret);
}

