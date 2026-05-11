// This file is part of midnightntwrk/contributor-hub.
// Copyright (C) 2025 Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { createHash } from "node:crypto";

export type ShieldedTokenPrivateState = {
  readonly nonceSeed: Uint8Array;
  readonly nextNonceIndex: bigint;
};

type WitnessContext<PrivateState> = {
  readonly privateState: PrivateState;
};

export const createShieldedTokenPrivateState = (
  nonceSeed = hashBytes32("shielded-token:demo-seed"),
): ShieldedTokenPrivateState => ({
  nonceSeed,
  nextNonceIndex: 0n,
});

export const witnesses = {
  localNonceSeed: ({
    privateState,
  }: WitnessContext<ShieldedTokenPrivateState>): [
    ShieldedTokenPrivateState,
    Uint8Array,
  ] => [
    {
      nonceSeed: privateState.nonceSeed,
      nextNonceIndex: privateState.nextNonceIndex + 1n,
    },
    privateState.nonceSeed,
  ],
};

export function hashBytes32(input: string): Uint8Array {
  return createHash("sha256").update(input).digest();
}
