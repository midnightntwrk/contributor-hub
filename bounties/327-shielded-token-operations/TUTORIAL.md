# Build shielded token mint, transfer, and burn flows in Compact

Shielded tokens let Midnight applications move value while keeping sensitive
transaction details private. In this tutorial, you will build a small Compact
project that mints shielded value, transfers it, burns it, and verifies the
full lifecycle with a Vitest test suite.

The core idea is simple but important: a newly minted shielded coin is not yet a
committed ledger coin. Fresh coins use `ShieldedCoinInfo` and can be spent
immediately with `sendImmediateShielded`. Coins that already exist in the ledger
use `QualifiedShieldedCoinInfo`, which includes the Merkle tree index required
by `sendShielded`.

You will use that distinction to build three practical flows: minting to the
current contract, transferring committed value to a user, and burning both fresh
and committed shielded value. Along the way, you will also handle change outputs
and nonce derivation, two details that matter in real wallet and DApp code.

By the end of this tutorial, you will:

- Create a Compact contract that mints shielded tokens to itself.
- Use `evolveNonce` to derive mint nonces safely.
- Transfer committed shielded coins with `sendShielded`.
- Burn committed and freshly minted coins with `shieldedBurnAddress`.
- Use `sendImmediateShielded` for coins created in the same transaction.
- Write Vitest tests for minting, transfers, burns, change, nonce reuse, and the
  Merkle timing rule.

## Prerequisites

You need:

- Node.js 20 or newer.
- npm.
- The Midnight Compact toolchain.
- Basic TypeScript knowledge.
- Basic familiarity with Compact circuits and ledgers.

Install or update the Compact toolchain from the Midnight documentation, then
check that the command is available:

```bash
compact check
```

Expected result:

```text
compact: Latest version available: ...
```

On Windows, run the Compact toolchain from WSL or make sure the Midnight
`compact` binary appears before `C:\Windows\System32\compact.exe` in your
`PATH`. Windows also has a system command named `compact`, and that command is
not the Midnight compiler.

## What you will build

The finished demo project has this structure:

```text
shielded-token-operations/
|-- package.json
|-- tsconfig.json
|-- src/
|   |-- shielded-token-lifecycle.compact
|   |-- witnesses.ts
|   `-- model/
|       `-- shielded-token-model.ts
`-- test/
    `-- shielded-token-lifecycle.test.ts
```

The Compact file contains the contract. The witness file manages local nonce
state. The TypeScript model gives you deterministic tests without needing a live
node. The Vitest file proves the flows and catches the mistakes developers tend
to make when they mix fresh and committed shielded coins.

## Part 0: Choose the right shielded API

Before writing code, map each operation to the correct standard library helper.
Most bugs in shielded token examples come from choosing the right idea but the
wrong helper.

Use `mintShieldedToken` when the contract creates a new shielded token. It
returns `ShieldedCoinInfo`, which describes a fresh output from the current
transaction.

Use `sendImmediateShielded` when that fresh output is spent in the same
transaction. This is the right tool for atomic flows such as mint-and-send or
mint-and-burn.

Use `sendShielded` when the coin already exists in the ledger. This requires
`QualifiedShieldedCoinInfo`, not plain `ShieldedCoinInfo`, because the committed
coin must include its Merkle tree position.

Use `shieldedBurnAddress()` when the send target should destroy the shielded
value. Burning is not a separate token primitive in this example; it is a send
to a special recipient.

Keep this decision table nearby while building:

```text
Operation                      Input coin type              Helper
Mint new shielded value        none                         mintShieldedToken
Spend fresh minted value       ShieldedCoinInfo             sendImmediateShielded
Spend later committed value    QualifiedShieldedCoinInfo    sendShielded
Burn fresh minted value        ShieldedCoinInfo             sendImmediateShielded + shieldedBurnAddress
Burn committed value           QualifiedShieldedCoinInfo    sendShielded + shieldedBurnAddress
```

The tutorial code follows this table exactly. If you change the API shape later,
re-run the tests that check immediate sends and Merkle timing.

## Part 1: Create the package

Create a folder for the demo project:

```bash
mkdir shielded-token-operations
cd shielded-token-operations
```

Initialize the package:

```bash
npm init -y
```

Install the test and TypeScript dependencies:

```bash
npm install --save-dev typescript vitest @types/node
```

Update `package.json` with these scripts:

```json
{
  "scripts": {
    "compact": "compact compile src/shielded-token-lifecycle.compact ./src/managed/shielded-token-lifecycle",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  }
}
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "types": ["node", "vitest"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

This setup lets you run fast local tests while still keeping a direct Compact
compile command for the smart contract.

## Part 2: Write the Compact contract

Create the source folder:

```bash
mkdir -p src
touch src/shielded-token-lifecycle.compact
```

Start the contract with the language pragma, the standard library import, and
two public ledger fields:

```compact
pragma language_version >= 0.20;

import CompactStandardLibrary;

export ledger mintedOperations: Counter;
export ledger totalBurned: Uint<128>;

constructor() {
  totalBurned = 0;
}
```

`mintedOperations` is a simple counter used by the example. `totalBurned`
records the amount this contract has intentionally sent to the shielded burn
address.

Next, add a witness for local nonce seed management:

```compact
witness localNonceSeed(): Bytes<32>;
```

The witness value is private state supplied by the TypeScript layer. The
contract will combine it with a public nonce index using `evolveNonce`.

## Part 3: Mint shielded tokens

Add a circuit that mints directly to the current contract:

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

`mintShieldedToken` returns a `ShieldedCoinInfo`. That is a fresh output. It has
a nonce, color, and value, but it does not have a Merkle index yet.

The recipient is:

```compact
right<ZswapCoinPublicKey, ContractAddress>(kernel.self())
```

That means the new shielded coin belongs to the current contract. This is useful
when the contract should later spend the coin after it appears in the ledger.

Now add a second minting circuit that derives its nonce:

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

`evolveNonce` takes an index and a prior nonce/seed. The `disclose(...)` wrapper
around the evolved nonce is intentional. Compact treats witness-derived values
as private by default, and a minted coin returns nonce-derived data. This wrapper
declares that the derived nonce value may be used in that public-facing result
without disclosing the raw witness seed.

## Part 4: Transfer a committed shielded coin

Add a committed transfer circuit:

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

The input type matters. `sendShielded` spends a `QualifiedShieldedCoinInfo`.
That type represents an existing shielded coin in the ledger. It includes the
Merkle tree position:

```compact
struct QualifiedShieldedCoinInfo {
  nonce: Bytes<32>;
  color: Bytes<32>;
  value: Uint<128>;
  mtIndex: Uint<64>;
}
```

The result type is `ShieldedSendResult`:

```compact
struct ShieldedSendResult {
  change: Maybe<ShieldedCoinInfo>;
  sent: ShieldedCoinInfo;
}
```

If you send the full input value, `change` is empty. If you send less than the
input value, `change` contains a new contract-owned shielded coin. Your
application must keep track of that change output, wait for it to be committed,
and later spend it as a qualified coin.

## Part 5: Burn shielded tokens

Burning is a send to the special burn recipient returned by
`shieldedBurnAddress()`.

Add a committed burn circuit:

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

This works like a committed transfer, except the recipient is the burn address.
The result can still include change. Burning `40` from a `90` value coin burns
`40` and returns `50` as change.

Now add a fresh burn circuit:

```compact
export circuit burn_fresh(
  domainSep: Bytes<32>,
  mintValue: Uint<64>,
  mintNonce: Bytes<32>,
  burnValue: Uint<128>
): ShieldedSendResult {
  assert(disclose(mintValue) > 0, "mint amount must be non-zero");
  assert(disclose(burnValue) > 0, "burn amount must be non-zero");

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

Use `sendImmediateShielded` here because the coin was created in the same
transaction. It has not been committed yet, so it cannot be spent with
`sendShielded`.

## Part 6: Add atomic mint and send

Atomic mint-and-send is the same fresh-coin pattern. Add this circuit:

```compact
export circuit mint_and_send(
  domainSep: Bytes<32>,
  mintValue: Uint<64>,
  mintNonce: Bytes<32>,
  recipient: ZswapCoinPublicKey,
  sendValue: Uint<128>
): ShieldedSendResult {
  assert(disclose(mintValue) > 0, "mint amount must be non-zero");
  assert(disclose(sendValue) > 0, "send amount must be non-zero");

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

This circuit mints to the contract and immediately sends part or all of the
fresh coin to a user public key. If `mintValue` is larger than `sendValue`, the
returned change belongs to the contract.

## Part 7: Add the TypeScript witness

Create the witness file:

```bash
touch src/witnesses.ts
```

Add a private state type and a witness implementation:

```ts
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
  localNonceSeed: ({ privateState }: WitnessContext<ShieldedTokenPrivateState>) => [
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
```

The witness returns the nonce seed to Compact and advances local private state.
In a production DApp, persist this private state. Do not reset it casually, or
you may reuse nonce material.

## Part 8: Build a local test model

Create a deterministic model for tests:

```bash
mkdir -p src/model
touch src/model/shielded-token-model.ts
```

The model should mirror the standard library types closely:

```ts
export type ShieldedCoinInfo = {
  readonly nonce: string;
  readonly color: string;
  readonly value: bigint;
  readonly recipient: Recipient;
};

export type QualifiedShieldedCoinInfo = ShieldedCoinInfo & {
  readonly mtIndex: bigint;
};

export type ShieldedSendResult = {
  readonly sent: ShieldedCoinInfo;
  readonly change: ShieldedCoinInfo | null;
};
```

Then model the two send paths:

```ts
export function sendShielded(
  input: QualifiedShieldedCoinInfo,
  recipient: Recipient,
  value: bigint | number,
): ShieldedSendResult {
  assertQualified(input);
  return splitCoin(input, recipient, value, "sendShielded");
}

export function sendImmediateShielded(
  input: ShieldedCoinInfo,
  target: Recipient,
  value: bigint | number,
): ShieldedSendResult {
  return splitCoin(input, target, value, "sendImmediateShielded");
}
```

The important test helper is `assertQualified`. It rejects fresh coins that do
not have an `mtIndex`:

```ts
function assertQualified(
  input: ShieldedCoinInfo | QualifiedShieldedCoinInfo,
): asserts input is QualifiedShieldedCoinInfo {
  if (!("mtIndex" in input)) {
    throw new Error("sendShielded requires a committed coin with an mtIndex");
  }
}
```

This is how the test suite makes the Merkle timing rule visible without running
a full network.

## Part 9: Write the Vitest suite

Create the test file:

```bash
mkdir -p test
touch test/shielded-token-lifecycle.test.ts
```

Start with a mint test:

```ts
it("mints a shielded coin to the contract with the expected color", () => {
  const harness = new ShieldedTokenHarness(DOMAIN);

  const coin = harness.mintToContract(1000n, NONCE);

  expect(coin.value).toBe(1000n);
  expect(coin.color).toEqual(tokenType(DOMAIN));
  expect(coin.recipient).toEqual(CONTRACT_SELF);
});
```

Add a nonce test:

```ts
it("derives deterministic unique nonces with evolveNonce", () => {
  const first = evolveNonce(0n, SEED);
  const second = evolveNonce(1n, SEED);

  expect(first).not.toEqual(second);
  expect(evolveNonce(0n, SEED)).toEqual(first);
});
```

Add the Merkle timing test:

```ts
it("requires a committed Merkle position before sendShielded can spend a coin", () => {
  const harness = new ShieldedTokenHarness(DOMAIN);
  const fresh = harness.mintToContract(25n, NONCE);

  expect(() =>
    sendShielded(fresh as unknown as QualifiedShieldedCoinInfo, ALICE, 5n),
  ).toThrow(/mtIndex/);
});
```

Add committed transfer tests for partial and exact sends:

```ts
const qualified = harness.commit(harness.mintToContract(100n, NONCE));
const result = harness.sendCommitted(qualified, ALICE, 35n);

expect(result.sent.value).toBe(35n);
expect(result.change?.value).toBe(65n);
```

Add burn tests for both paths:

```ts
const committed = harness.commit(harness.mintToContract(90n, NONCE));
const committedBurn = harness.burnCommitted(committed, 40n);
expect(committedBurn.sent.recipient).toEqual(BURN_ADDRESS);
expect(committedBurn.change?.value).toBe(50n);

const freshBurn = harness.burnFresh(75n, NONCE, 75n);
expect(freshBurn.sent.recipient).toEqual(BURN_ADDRESS);
expect(freshBurn.change).toBeNull();
```

Finally, test atomic mint-and-send:

```ts
const result = harness.mintAndSend(120n, NONCE, ALICE, 45n);

expect(result.sent.value).toBe(45n);
expect(result.sent.recipient).toEqual(ALICE);
expect(result.change?.value).toBe(75n);
```

The completed suite should cover normal flows and edge cases: over-spend,
over-burn, zero-value operations, change reuse, fresh immediate sends, and color
preservation.

Add one more test for change reuse. This test proves that change from a partial
send is not just bookkeeping text; it is the next coin your application must
commit and track:

```ts
it("allows change from one transaction to be committed and spent later", () => {
  const harness = new ShieldedTokenHarness(DOMAIN);
  const qualified = harness.commit(harness.mintToContract(100n, NONCE));
  const first = harness.sendCommitted(qualified, ALICE, 30n);

  const change = harness.commit(first.change!);
  const second = harness.sendCommitted(change, BOB, 20n);

  expect(second.sent.value).toBe(20n);
  expect(second.change?.value).toBe(50n);
});
```

This is the test that catches a common wallet integration bug. If the application
forgets to store `first.change`, the user may believe the remaining value is
still available, but the app will not know which output to qualify and spend
later.

## Part 10: Run the checks

Run TypeScript:

```bash
npm run typecheck
```

Expected output:

```text
tsc -p tsconfig.json --noEmit
```

Run the tests:

```bash
npm test
```

Expected output:

```text
Test Files  1 passed (1)
Tests  18 passed (18)
```

Compile the Compact smart contract:

```bash
npm run compact
```

Expected result:

```text
Compilation successful
```

The compile step creates generated contract files under `src/managed`. Those
generated files are build output and do not need to be committed.

For final review, record the three verification results together:

```text
Compact compiler: passed
TypeScript: passed
Vitest: 18 tests passed
```

Do not treat the Vitest result as a substitute for Compact compilation. The
tests prove the lifecycle model and edge cases. The compiler proves the Compact
syntax, types, witness disclosure, and standard library calls.

## Troubleshooting

### `compact` runs the wrong command on Windows

Problem:

```text
Listing ... New files added to this directory will not be compressed.
```

That is the Windows filesystem compression utility, not the Midnight compiler.

Fix:

- Run the command from WSL, or
- Put the Midnight Compact toolchain earlier in `PATH` than
  `C:\Windows\System32`.

### The compiler complains about witness disclosure

Problem:

```text
potential witness-value disclosure must be declared but is not
```

Fix:

Wrap the evolved nonce in `disclose(...)`:

```compact
const nonce = disclose(evolveNonce(disclose(nonceIndex), localNonceSeed()));
```

This declares the intentional disclosure of the derived nonce value, not the raw
witness seed.

### A later transfer fails because the coin has no `mtIndex`

Problem:

You are trying to call `sendShielded` with a fresh `ShieldedCoinInfo`.

Fix:

Use `sendImmediateShielded` if the coin was created in the same transaction. If
the coin was created in a previous transaction, wait until it is committed and
spend it as a `QualifiedShieldedCoinInfo` with the real Merkle index.

### Change disappears from your app state

Problem:

A partial send or burn returns change, but the app does not store it.

Fix:

Always inspect `ShieldedSendResult.change`. If it is present, persist it and
track its later Merkle position. That change is the remaining balance.

## Conclusion

You have built a complete shielded token lifecycle example:

- `mintShieldedToken` creates fresh shielded coins.
- `evolveNonce` gives you deterministic nonce derivation.
- `sendShielded` spends committed coins with `mtIndex`.
- `sendImmediateShielded` spends coins created in the same transaction.
- `shieldedBurnAddress` turns a shielded send into a burn.
- `ShieldedSendResult.change` carries the unspent remainder.
- Vitest tests prove the normal paths and the common failure cases.

The most important lesson is the fresh-versus-committed distinction. If you keep
that boundary clear, shielded mint, transfer, and burn operations become much
easier to reason about.

Related resources:

- Midnight documentation: https://docs.midnight.network/
- Compact language reference: https://docs.midnight.network/compact/
- Compact standard library exports:
  https://docs.midnight.network/compact/standard-library/exports
