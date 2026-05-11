<!--
This file is part of midnightntwrk/contributor-hub.
Copyright (C) 2025 Midnight Foundation
SPDX-License-Identifier: Apache-2.0
Licensed under the Apache License, Version 2.0 (the "License");
You may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
-->

# Bounty 327: Shielded Token Operations

This package contains the code artifact for issue #327, covering a Compact
shielded-token lifecycle contract plus a Vitest suite for mint, transfer, burn,
change handling, nonce evolution, and the Merkle timing rule.

## Contents

- `src/shielded-token-lifecycle.compact` - Compact contract with shielded mint,
  committed send, committed burn, fresh burn, and atomic mint-and-send circuits.
- `src/witnesses.ts` - TypeScript witness implementation for local nonce seed
  management.
- `src/model/shielded-token-model.ts` - Test model mirroring the contract-facing
  shielded token flow.
- `test/shielded-token-lifecycle.test.ts` - Vitest coverage for normal flows and
  edge cases.
- `TUTORIAL.md` - Written tutorial for the bounty.

## Setup

```bash
npm install
npm run typecheck
npm test
```

To compile the Compact contract, install the Midnight Compact toolchain and run:

```bash
npm run compact
```

On Windows, ensure the Midnight `compact` tool is earlier on `PATH` than
`C:\Windows\System32\compact.exe`, or run the Compact toolchain from WSL. The
Windows system `compact.exe` is a filesystem compression utility, not the
Midnight compiler.

## Notes

The test model deliberately distinguishes `ShieldedCoinInfo` from
`QualifiedShieldedCoinInfo`. A fresh coin can be spent in the same transaction
with `sendImmediateShielded`, but a later `sendShielded` call requires a Merkle
tree index (`mtIndex`) after the coin has been committed on-chain.
