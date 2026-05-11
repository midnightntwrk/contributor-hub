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

# Shielded Token Operations: Mint, Transfer, Burn, and Tests

This tutorial walks through a small Compact contract that demonstrates a full
shielded token lifecycle on Midnight: minting a shielded coin, spending it to a
recipient, returning change, burning shielded value, and testing the edge cases
that matter for production code. The companion code lives in this directory and
is organized as a minimal package that can be installed, typechecked, tested
with Vitest, and compiled with the Midnight Compact toolchain.

The examples focus on contract-owned shielded coins. A contract mints a shielded
token to itself, later spends the committed coin with `sendShielded`, and uses
`ShieldedSendResult.change` to keep track of any remaining value. The same
contract also demonstrates the immediate path: when a coin is created and spent
inside the same transaction, it is a `ShieldedCoinInfo`, not a
`QualifiedShieldedCoinInfo`, so the correct helper is `sendImmediateShielded`.
This distinction is the main trap in this topic.

## Project shape

The package contains four important files:

- `src/shielded-token-lifecycle.compact` contains the Compact circuits.
- `src/witnesses.ts` implements local private state for nonce seed management.
- `src/model/shielded-token-model.ts` mirrors the shielded-token rules for
  deterministic unit tests.
- `test/shielded-token-lifecycle.test.ts` covers mint, transfer, burn, change,
  nonce evolution, and Merkle timing.

Install the package and run the tests:

```bash
npm install
npm run typecheck
npm test
```

Compile the Compact contract after installing the Midnight Compact toolchain:

```bash
npm run compact
```

On Windows, be careful with the command name. Windows ships a system utility
named `compact.exe` for filesystem compression. If that binary appears before
the Midnight toolchain in `PATH`, `npm run compact` will call the wrong program.
Using WSL or adjusting `PATH` avoids that collision.

## Compact contract structure

The contract starts like current Midnight examples: no wrapper object, a language
version pragma, and an import of the standard library.

```compact
pragma language_version >= 0.20;

import CompactStandardLibrary;

export ledger mintedOperations: Counter;
export ledger totalBurned: Uint<128>;

constructor() {
  totalBurned = 0;
}
```

`mintedOperations` is a simple counter so tests and users can see that a minting
path was executed. `totalBurned` records the amount that the contract has sent
to the shielded burn address. This is not meant to replace chain accounting, but
it is useful application state for a tutorial because it makes the burn path
observable.

The contract also declares one witness:

```compact
witness localNonceSeed(): Bytes<32>;
```

The witness returns a private local seed. The Compact circuit can combine that
seed with a public index by calling `evolveNonce(index, nonce)`. This pattern
keeps nonce generation deterministic while making accidental nonce reuse easier
to avoid. A production app should persist its private state and should never
reset the seed/index pair in a way that reuses the same nonce for the same token
domain.

## Minting shielded tokens

The standard library function used for minting is:

```compact
mintShieldedToken(
  domainSep: Bytes<32>,
  value: Uint<64>,
  nonce: Bytes<32>,
  recipient: Either<ZswapCoinPublicKey, ContractAddress>
): ShieldedCoinInfo
```

The returned `ShieldedCoinInfo` describes a newly created shielded output. It
has a `nonce`, `color`, and `value`. The `color` is the token type derived from
the domain separator and contract address. The `nonce` must be unique for secure
operation.

The tutorial contract exposes an explicit mint function:

```compact
export circuit mint_to_contract(
  domainSep: Bytes<32>,
  value: Uint<64>,
  nonce: Bytes<32>
): ShieldedCoinInfo {
  assert(disclose(value) > 0, "mint amount must be non-zero");

  const coin = mintShieldedToken(
    disclose(domainSep),
    disclose(value),
    disclose(nonce),
    right<ZswapCoinPublicKey, ContractAddress>(kernel.self())
  );

  mintedOperations.increment(1);
  return coin;
}
```

The recipient is `right<ZswapCoinPublicKey, ContractAddress>(kernel.self())`,
which means the shielded output is addressed to the current contract. This is
the important choice for the rest of the tutorial: the contract can later spend
that coin after it is committed on-chain and referenced as a
`QualifiedShieldedCoinInfo`.

There is also a nonce-managed mint:

```compact
export circuit mint_with_local_nonce(
  domainSep: Bytes<32>,
  value: Uint<64>,
  nonceIndex: Uint<128>
): ShieldedCoinInfo {
  assert(disclose(value) > 0, "mint amount must be non-zero");

  const nonce = disclose(evolveNonce(disclose(nonceIndex), localNonceSeed()));
  const coin = mintShieldedToken(
    disclose(domainSep),
    disclose(value),
    nonce,
    right<ZswapCoinPublicKey, ContractAddress>(kernel.self())
  );

  mintedOperations.increment(1);
  return coin;
}
```

The point is not that every application must use exactly this API. The point is
that the nonce policy should be explicit. Passing arbitrary nonces from a UI is
easy to demo and easy to get wrong. Passing an index and deriving the nonce from
a private seed gives the application a clear place to enforce monotonic use. The
`disclose(...)` wrapper around the evolved nonce is intentional. Compact tracks
values derived from witnesses, and a minted coin returns a nonce-derived output.
By disclosing the evolved nonce, the contract declares that this obfuscated
derived value may be visible without disclosing the raw witness seed itself.

## TypeScript witness implementation

The witness implementation in `src/witnesses.ts` defines the private state shape:

```ts
export type ShieldedTokenPrivateState = {
  readonly nonceSeed: Uint8Array;
  readonly nextNonceIndex: bigint;
};
```

It also exports a constructor for the state and a `witnesses` object with a
`localNonceSeed` implementation:

```ts
export const witnesses = {
  localNonceSeed: ({ privateState }) => [
    {
      nonceSeed: privateState.nonceSeed,
      nextNonceIndex: privateState.nextNonceIndex + 1n,
    },
    privateState.nonceSeed,
  ],
};
```

The returned tuple follows the generated Compact runtime pattern: first the next
private state, then the witness value returned to the circuit. The circuit still
takes a `nonceIndex` parameter. Keeping the index visible in the circuit makes
tests and callers explicit about which nonce should be used for a mint, while the
private state gives the UI or service layer a way to track local progress.

## Sending committed shielded coins

The standard library distinguishes fresh shielded coins from committed shielded
coins. `ShieldedCoinInfo` is a new coin, usually created in the current
transaction. `QualifiedShieldedCoinInfo` is a coin that already exists in the
ledger and includes a Merkle tree position:

```compact
struct QualifiedShieldedCoinInfo {
  nonce: Bytes<32>;
  color: Bytes<32>;
  value: Uint<128>;
  mtIndex: Uint<64>;
}
```

That `mtIndex` is load-bearing. The Merkle index is what lets the transaction
prove which committed coin is being spent. A fresh output from
`mintShieldedToken` does not have this index yet.

The committed send circuit therefore accepts a `QualifiedShieldedCoinInfo`:

```compact
export circuit send_committed(
  input: QualifiedShieldedCoinInfo,
  recipient: ZswapCoinPublicKey,
  value: Uint<128>
): ShieldedSendResult {
  assert(disclose(value) > 0, "send amount must be non-zero");
  assert(disclose(input).value >= disclose(value), "send amount exceeds coin value");

  return sendShielded(
    disclose(input),
    left<ZswapCoinPublicKey, ContractAddress>(disclose(recipient)),
    disclose(value)
  );
}
```

The result is a `ShieldedSendResult`:

```compact
struct ShieldedSendResult {
  change: Maybe<ShieldedCoinInfo>;
  sent: ShieldedCoinInfo;
}
```

When the input value is larger than the send value, `change` contains a new
contract-owned `ShieldedCoinInfo`. The application must not forget this value.
The change output is how the remaining balance continues to exist. If the input
is exactly consumed, `change` is empty.

Tests should verify both cases. The suite includes one test that sends `35` out
of a `100` value coin and expects `65` of change, and another that sends exactly
`100` and expects no change.

## Burning shielded value

The standard library exposes a special burn recipient:

```compact
shieldedBurnAddress(): Either<ZswapCoinPublicKey, ContractAddress>
```

Any shielded coins sent to that address are burned. The committed burn circuit
is a small variant of the committed send path:

```compact
export circuit burn_committed(
  input: QualifiedShieldedCoinInfo,
  value: Uint<128>
): ShieldedSendResult {
  assert(disclose(value) > 0, "burn amount must be non-zero");
  assert(disclose(input).value >= disclose(value), "burn amount exceeds coin value");

  const result = sendShielded(
    disclose(input),
    shieldedBurnAddress(),
    disclose(value)
  );

  totalBurned = (totalBurned + disclose(value)) as Uint<128>;
  return result;
}
```

The burn result can also include change. Burning `40` out of a `90` value coin
creates a burned output of `40` and a contract-owned change output of `50`. That
change output must be committed before it can be spent by a later `sendShielded`
call.

Fresh burns use a different helper:

```compact
export circuit burn_fresh(
  domainSep: Bytes<32>,
  mintValue: Uint<64>,
  mintNonce: Bytes<32>,
  burnValue: Uint<128>
): ShieldedSendResult {
  const coin = mintShieldedToken(
    disclose(domainSep),
    disclose(mintValue),
    disclose(mintNonce),
    right<ZswapCoinPublicKey, ContractAddress>(kernel.self())
  );

  assert(coin.value >= disclose(burnValue), "burn amount exceeds minted value");

  const result = sendImmediateShielded(
    coin,
    shieldedBurnAddress(),
    disclose(burnValue)
  );

  mintedOperations.increment(1);
  totalBurned = (totalBurned + disclose(burnValue)) as Uint<128>;
  return result;
}
```

`sendImmediateShielded` is specifically for coins created in the current
transaction. No Merkle index is required because the coin has not needed to be
looked up as a previously committed input.

## Atomic mint and send

The same immediate rule applies to atomic mint-and-send. If the contract mints a
coin and sends part of it to a user in the same circuit, it should not pretend
the fresh coin has an existing Merkle position. It can directly call
`sendImmediateShielded`:

```compact
export circuit mint_and_send(
  domainSep: Bytes<32>,
  mintValue: Uint<64>,
  mintNonce: Bytes<32>,
  recipient: ZswapCoinPublicKey,
  sendValue: Uint<128>
): ShieldedSendResult {
  const coin = mintShieldedToken(
    disclose(domainSep),
    disclose(mintValue),
    disclose(mintNonce),
    right<ZswapCoinPublicKey, ContractAddress>(kernel.self())
  );

  assert(coin.value >= disclose(sendValue), "send amount exceeds minted value");

  const result = sendImmediateShielded(
    coin,
    left<ZswapCoinPublicKey, ContractAddress>(disclose(recipient)),
    disclose(sendValue)
  );

  mintedOperations.increment(1);
  return result;
}
```

This circuit is useful for onboarding flows, reward distribution, or any case
where a contract creates shielded value and immediately passes some of it to a
recipient. If `mintValue` is larger than `sendValue`, the returned change should
be kept by the contract and committed before a future committed spend.

## Merkle timing pitfall

The most common mistake is trying to spend a freshly minted `ShieldedCoinInfo`
with `sendShielded` in a later operation without first obtaining its
`mtIndex`. A coin created in transaction A is only spendable by `sendShielded`
after transaction A is included and the output can be referenced from the Merkle
tree. Before that point, it is just a fresh output.

There are three safe paths:

1. Mint now, wait until the coin is committed, then spend it as a
   `QualifiedShieldedCoinInfo` with `sendShielded`.
2. Mint and spend inside the same transaction with `sendImmediateShielded`.
3. Mint and burn inside the same transaction with `sendImmediateShielded` and
   `shieldedBurnAddress()`.

The test model enforces this distinction. If a test passes a fresh
`ShieldedCoinInfo` into `sendShielded`, it throws an error that mentions
`mtIndex`. The positive committed path calls `commit(coin)` first, which returns
a `QualifiedShieldedCoinInfo`.

## Test suite design

The Vitest suite uses a deterministic TypeScript model rather than talking to a
live network. This makes the tests fast and focused on lifecycle semantics. The
model is intentionally shaped like the Compact standard library types:

- `ShieldedCoinInfo` has `nonce`, `color`, `value`, and a test-only recipient.
- `QualifiedShieldedCoinInfo` extends it with `mtIndex`.
- `ShieldedSendResult` has `sent` and nullable `change`.

The suite covers:

- Minting a shielded coin to the contract and preserving token color.
- Deterministic nonce derivation with `evolveNonce`.
- Local nonce seed use through `mintWithLocalNonce`.
- Rejection when `sendShielded` receives a fresh coin without `mtIndex`.
- Partial sends that produce change.
- Exact sends that produce no change.
- Overspending rejection.
- Zero-value rejection.
- Committed burns through `shieldedBurnAddress`.
- Fresh burns through `sendImmediateShielded`.
- Atomic `mint_and_send`.
- Spending change after it is committed.
- Color preservation across send, burn, and change outputs.

This is the key test for Merkle timing:

```ts
it("requires a committed Merkle position before sendShielded can spend a coin", () => {
  const harness = new ShieldedTokenHarness(DOMAIN);
  const fresh = harness.mintToContract(25n, NONCE);

  expect(() =>
    sendShielded(fresh as unknown as QualifiedShieldedCoinInfo, ALICE, 5n),
  ).toThrow(/mtIndex/);
});
```

The positive committed flow is equally important:

```ts
const fresh = harness.mintToContract(100n, NONCE);
const qualified = harness.commit(fresh);
const result = harness.sendCommitted(qualified, ALICE, 35n);

expect(result.sent.value).toBe(35n);
expect(result.change?.value).toBe(65n);
```

That mirrors the real operational sequence: create the output, wait for it to be
available in the tree, then spend the qualified coin.

## Operational guidance

Production code should treat nonce state and change state as wallet-critical
data. Losing track of a nonce can cause reuse risk. Losing track of change can
make funds operationally inaccessible even if the chain accounting is correct.
The tutorial contract returns the `ShieldedSendResult` from every send and burn
path so callers cannot ignore change accidentally.

The UI or service layer should store:

- The domain separator used for this token.
- The local nonce seed and next index.
- Newly minted `ShieldedCoinInfo` values until they are committed.
- The `mtIndex` when a coin becomes spendable as `QualifiedShieldedCoinInfo`.
- Returned change outputs and their later Merkle positions.

Do not hardcode a fake Merkle index for production spends. The only reason the
test harness can create an index instantly is because it is a deterministic
local model. A real application must get the actual committed index from the
chain or wallet state.

## Common implementation mistakes

There are several mistakes that look harmless in a small demo but become serious
when a contract is integrated into a wallet or service.

The first mistake is naming an exported circuit exactly like a standard library
function. For example, an application circuit named `sendShielded` is easy for a
reader to confuse with the library function `sendShielded`. This tutorial uses
names such as `send_committed`, `burn_committed`, and `mint_and_send` so that the
boundary between application code and standard library code stays clear.

The second mistake is wrapping modern Compact code in an extra contract object
when the surrounding examples use top-level ledger declarations, witnesses,
constructors, and exported circuits. The current examples in the Midnight docs
show top-level Compact modules. Matching that structure makes the generated
TypeScript contract easier to use with the runtime patterns shown in example
projects.

The third mistake is treating `ShieldedSendResult.change` as optional bookkeeping
that can be handled later. It is optional in the type because exact sends do not
create change. When it is present, however, it is a real output. The app should
persist it, wait for it to be committed, and later qualify it with the real
Merkle position. In the test suite, change from a first transfer is committed
and spent in a second transfer to prove that the output remains usable.

The fourth mistake is assuming a recipient public key behaves exactly like a
contract recipient from a wallet-notification perspective. The standard library
documentation notes that shielded sends do not currently create all user-facing
coin ciphertext flows for arbitrary public key recipients. For a tutorial, it is
still useful to demonstrate the correct recipient type:
`left<ZswapCoinPublicKey, ContractAddress>(recipient)`. For production UX, the
app must verify how the intended wallet discovers and tracks the resulting
shielded output.

The fifth mistake is confusing an immediate spend with a committed spend.
`sendImmediateShielded` is not a shortcut to skip Merkle checks forever. It is
for coins created in the current transaction. Once a transaction boundary is
crossed, the app needs a qualified coin with `mtIndex` and should call
`sendShielded`.

## Review and verification runbook

A reviewer can check the package in three passes.

First, inspect the Compact contract. Confirm that `mint_to_contract` calls
`mintShieldedToken` with a contract recipient, that `send_committed` accepts a
`QualifiedShieldedCoinInfo`, that committed burns send to `shieldedBurnAddress`,
and that the fresh paths use `sendImmediateShielded`. Also confirm that the
contract validates non-zero amounts and rejects sends or burns larger than the
input value.

Second, run the TypeScript checks:

```bash
npm install
npm run typecheck
npm test
```

The unit tests are deterministic. They do not require a node, wallet, faucet, or
proof server. That makes them suitable for CI and for quickly validating the
control-flow assumptions in the tutorial. The tests are not a replacement for a
real Compact compile or an integration test against a deployed contract, but
they are a useful guardrail for the logic around change, burn destinations, and
fresh versus committed coins.

Third, run the Compact compiler:

```bash
npm run compact
```

The expected output is a generated directory under `src/managed`. A complete
application would then import the generated `Contract` class, pass the
`witnesses` object from `src/witnesses.ts`, and drive the circuits through the
Compact runtime in the same style as the official example applications. That
integration layer is intentionally small because the bounty is about the
shielded token operations themselves, not about building a full wallet UI.

If the compiler reports a field-name error around `QualifiedShieldedCoinInfo`,
check the installed Compact toolchain version against the documentation. The
reference page documents the Merkle field as `mtIndex`. Some older examples have
used different casing. This package avoids manually constructing a qualified
coin in Compact for the atomic flow and instead uses `sendImmediateShielded`,
which is the safer API for a freshly minted coin.

## Summary

The lifecycle is straightforward once the two coin states are kept separate.
`mintShieldedToken` creates a fresh `ShieldedCoinInfo`. `sendImmediateShielded`
spends fresh coins within the same transaction. `sendShielded` spends committed
coins that already have a Merkle position. `shieldedBurnAddress()` turns a send
into a burn. `ShieldedSendResult.change` is where unspent value continues after
a partial send or partial burn. Finally, `evolveNonce` should be part of a
deliberate nonce policy, not an afterthought.

Together, the Compact contract and Vitest suite provide a small but complete
reference implementation for mint, transfer, burn, change handling, nonce
management, and the Merkle timing constraint that makes shielded token code easy
to get wrong.
