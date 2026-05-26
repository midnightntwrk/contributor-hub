<!--
This file is part of contributor-hub.
Copyright (C) 2026 Midnight Foundation
SPDX-License-Identifier: Apache-2.0
Licensed under the Apache License, Version 2.0.
-->

# Time and Deadlines in Compact: Block Time, Counters, and the `Uint<16>` Problem

Time-based rules appear in many contracts. An auction must reject bids after it
closes. An escrow must allow refunds after an expiry. A subscription must prove
that the renewal window is open. On Midnight, those rules are written in Compact,
and Compact gives developers a different model than the `block.timestamp` pattern
used on many public smart contract platforms.

Instead of reading the current block time into a contract variable, Compact
provides comparison circuits. The contract can ask whether the current block time
is less than, less than or equal to, greater than, or greater than or equal to a
public value. That sounds like a small distinction, but it changes how you design
deadlines. You do not build logic around a raw `now()` value. You build logic
around predicates that the proving system can enforce.

The other practical issue is storage. Compact ledger counters are useful for
public numeric state, but `Counter.increment()` accepts a `Uint<16>` increment.
That means one increment call can add at most `65,535`. A Unix timestamp in
seconds is already larger than 1.7 billion, so a naive "store the timestamp by
incrementing the counter once" design does not work.

This tutorial explains both sides of the problem:

- how to use the four block-time query functions;
- why the `Counter.increment()` argument size matters;
- how to store deadline-like values using hours since epoch;
- how to build larger values with multiple increments; and
- how to split a large timestamp into `deadline_hi` and `deadline_lo` fields.

The examples use current Compact syntax: top-level `export ledger` declarations,
`import CompactStandardLibrary;`, and circuits that return `[]`.

## The Block-Time API

Compact's standard library exposes four block-time comparison functions:

| Function | Meaning |
| --- | --- |
| `blockTimeLt(t)` | current block time is less than `t` |
| `blockTimeLte(t)` | current block time is less than or equal to `t` |
| `blockTimeGt(t)` | current block time is greater than `t` |
| `blockTimeGte(t)` | current block time is greater than or equal to `t` |

The input is a public time value, normally represented as seconds since the Unix
epoch. Each function returns a boolean-like value that can be passed to `assert`.
The contract learns only the result of the comparison it asks for.

A deadline check usually uses either `blockTimeLt` or `blockTimeLte`:

```compact
pragma language_version >= 0.16 && <= 0.25;

import CompactStandardLibrary;

export circuit submitBefore(deadline: Uint<64>): [] {
  assert(blockTimeLt(disclose(deadline)), "Deadline has passed");
}

export circuit submitUntil(deadline: Uint<64>): [] {
  assert(blockTimeLte(disclose(deadline)), "Deadline has passed");
}
```

The difference is the boundary. `submitBefore` accepts transactions only while
the current block time is strictly before the deadline. `submitUntil` accepts
transactions through the deadline value itself. In user-facing applications,
strict deadlines are often easier to reason about: "bidding closes before
12:00:00 UTC" means a bid at exactly `12:00:00` is too late. Inclusive deadlines
are useful when the stored value is already a rounded bucket, such as an hour
number or a day number.

Start checks usually use `blockTimeGte`:

```compact
export circuit startAtOrAfter(start: Uint<64>): [] {
  assert(blockTimeGte(disclose(start)), "Not started");
}
```

`blockTimeGt` is the strict version:

```compact
export circuit afterGracePeriod(graceEndsAt: Uint<64>): [] {
  assert(blockTimeGt(disclose(graceEndsAt)), "Grace period is still active");
}
```

Use strict comparisons when the exact boundary should be excluded. Use inclusive
comparisons when the boundary should be accepted. This is a product decision as
much as a programming decision. The contract should match the words used in the
user interface and documentation.

There is one important privacy and correctness point: if the contract compares
against a private witness value, that comparison may disclose information. In
typical deadline code, the deadline is public because anyone should be able to
understand when an auction, claim, or escrow window opens or closes. The examples
therefore use `disclose(deadline)` around circuit arguments. That makes the
comparison value public and explicit.

## Why `Counter.increment()` Has a Ceiling

Compact ledger state can include `Counter` fields:

```compact
export ledger totalBids: Counter;

export circuit recordBid(): [] {
  totalBids.increment(1);
}
```

Counters are convenient for public, monotonically changing values such as totals,
round numbers, sequence numbers, or accumulated quantities. However, a counter is
not the same thing as a general-purpose `Uint<64>` storage cell. The increment
operation takes a `Uint<16>` argument. `Uint<16>` can represent values from `0`
through `65,535`, so this is the largest amount that one `increment()` call can
add.

That is fine for many counters. It is also a trap for timestamps. A Unix
timestamp in seconds is far above `65,535`, and even a timestamp in hours is
currently above `490,000`. If you want to initialize a counter to a timestamp-like
value, you need an encoding strategy.

The rest of this tutorial shows three workable patterns. They are not
interchangeable; each has different trade-offs.

| Pattern | Best for | Trade-off |
| --- | --- | --- |
| Hours since epoch | Human-scale deadlines and expiry windows | Loses sub-hour precision |
| Multiple increments | Keeping one counter while storing larger values | More ledger operations and more code |
| `deadline_hi` + `deadline_lo` | Full seconds precision with bounded parts | Requires recomposition in client code or comparison helpers |

## Pattern 1: Hours Since Epoch

If your application only needs hour-level precision, store the deadline as hours
since the Unix epoch instead of seconds. This immediately reduces the value by a
factor of 3,600.

The client converts:

```ts
export function unixSecondsToEpochHours(unixSeconds: bigint): bigint {
  return unixSeconds / 3600n;
}

export function epochHoursToUnixSeconds(epochHours: bigint): bigint {
  return epochHours * 3600n;
}
```

In the contract, the ledger counter stores the hour value. Because the hour value
is still larger than `65,535`, the example accepts chunks. Each chunk must fit in
`Uint<16>`.

```compact
pragma language_version >= 0.16 && <= 0.25;

import CompactStandardLibrary;

export ledger deadline_hours: Counter;

export circuit addDeadlineHoursChunk(chunk: Uint<16>): [] {
  deadline_hours.increment(chunk);
}

export circuit assertBeforeUnixDeadline(deadlineSeconds: Uint<64>): [] {
  assert(blockTimeLt(disclose(deadlineSeconds)), "Deadline has passed");
}
```

This example separates storage from enforcement. The counter records the public
hour value. When the application later calls a deadline-protected circuit, it
passes the corresponding Unix-seconds deadline to the circuit and the circuit
checks it with `blockTimeLt`.

A small TypeScript test for the conversion logic is enough to catch off-by-one
errors:

```ts
import assert from "node:assert/strict";

const MAX_UINT16 = 65_535n;

export function unixSecondsToEpochHours(unixSeconds: bigint): bigint {
  return unixSeconds / 3600n;
}

export function epochHoursToUnixSeconds(epochHours: bigint): bigint {
  return epochHours * 3600n;
}

export function toUint16Chunks(value: bigint): bigint[] {
  if (value < 0n) throw new Error("value must be non-negative");

  const chunks: bigint[] = [];
  let remaining = value;

  while (remaining > 0n) {
    const chunk = remaining > MAX_UINT16 ? MAX_UINT16 : remaining;
    chunks.push(chunk);
    remaining -= chunk;
  }

  return chunks.length === 0 ? [0n] : chunks;
}

const deadlineSeconds = 1_763_020_800n; // 2025-11-13T00:00:00Z
const deadlineHours = unixSecondsToEpochHours(deadlineSeconds);

assert.equal(deadlineHours, 489_728n);
assert.equal(epochHoursToUnixSeconds(deadlineHours), deadlineSeconds);
assert.deepEqual(toUint16Chunks(deadlineHours), [
  65_535n,
  65_535n,
  65_535n,
  65_535n,
  65_535n,
  65_535n,
  65_535n,
  30_983n,
]);
```

The hours-since-epoch pattern is a good default when exact seconds do not matter.
For example, it works well for weekly challenges, membership periods, claim
windows, and content unlocks. It is a poor fit for high-frequency auctions or
trading workflows where seconds matter.

When using this pattern, be precise in the interface. If the contract stores
hours, tell users that deadlines are rounded down or rounded up. For expiry
checks, a common approach is to round up when converting a selected wall-clock
time to an hour bucket. That avoids accidentally closing earlier than the user
expected.

## Pattern 2: Multiple Increments

Sometimes you want to keep a single counter and store an exact larger number. You
can do that by incrementing the counter more than once. Each call stays within
the `Uint<16>` limit, but the accumulated counter reaches the desired value.

The Compact side is intentionally small:

```compact
pragma language_version >= 0.16 && <= 0.25;

import CompactStandardLibrary;

export ledger deadline_seconds: Counter;

export circuit addDeadlineSecondsChunk(chunk: Uint<16>): [] {
  deadline_seconds.increment(chunk);
}

export circuit requireOpen(deadlineSeconds: Uint<64>): [] {
  assert(blockTimeLt(disclose(deadlineSeconds)), "Closed");
}
```

The client prepares a transaction sequence:

```ts
const MAX_UINT16 = 65_535n;

export function toUint16Chunks(value: bigint): bigint[] {
  if (value < 0n) throw new Error("value must be non-negative");

  const chunks: bigint[] = [];
  let remaining = value;

  while (remaining > 0n) {
    const chunk = remaining > MAX_UINT16 ? MAX_UINT16 : remaining;
    chunks.push(chunk);
    remaining -= chunk;
  }

  return chunks.length === 0 ? [0n] : chunks;
}

export function sumChunks(chunks: readonly bigint[]): bigint {
  return chunks.reduce((sum, chunk) => {
    if (chunk < 0n || chunk > MAX_UINT16) {
      throw new Error(`chunk out of Uint<16> range: ${chunk}`);
    }

    return sum + chunk;
  }, 0n);
}
```

And the test verifies that the encoding is lossless:

```ts
import assert from "node:assert/strict";

const deadlineSeconds = 1_763_020_800n;
const chunks = toUint16Chunks(deadlineSeconds);

assert.equal(chunks.every((chunk) => chunk <= 65_535n), true);
assert.equal(sumChunks(chunks), deadlineSeconds);
assert.equal(chunks.length, 26_902);
```

This works, but the final assertion is the warning sign. Storing the current Unix
timestamp in seconds by repeated increments requires tens of thousands of chunks.
That is not a good user experience and is unlikely to be the best design for a
production contract.

The multiple-increments pattern is still useful for values that are larger than
`65,535` but not enormous. For example, a score of `120,000`, a supply adjustment
of `200,000`, or an hour-based timestamp around `500,000` can be represented with
a handful of chunks. For second-level Unix timestamps, use a different pattern.

If you do use multiple increments, make the update process idempotent at the
application level. A user should not be able to accidentally submit half the
chunks, refresh the page, and then submit all chunks again. Store a separate
state flag, derive the target from an immutable order, or require an admin flow
that tracks progress before finalization.

## Pattern 3: Split `deadline_hi` and `deadline_lo`

For full seconds precision, split the timestamp into two fields. The low field
stores the remainder modulo `65,536`. The high field stores the quotient. For a
Unix timestamp around `1,763,020,800`, the low part fits in one `Uint<16>` chunk,
and the high part is about `26,901`, which also fits in one `Uint<16>` chunk.

The client encoding is simple:

```ts
const BASE = 65_536n;
const MAX_UINT16 = 65_535n;

export type SplitUint16 = {
  hi: bigint;
  lo: bigint;
};

export function splitUint16(value: bigint): SplitUint16 {
  if (value < 0n) throw new Error("value must be non-negative");

  const hi = value / BASE;
  const lo = value % BASE;

  if (hi > MAX_UINT16) {
    throw new Error("value is too large for two Uint<16> fields");
  }

  return { hi, lo };
}

export function joinUint16Parts(parts: SplitUint16): bigint {
  if (parts.hi < 0n || parts.hi > MAX_UINT16) {
    throw new Error("hi out of Uint<16> range");
  }

  if (parts.lo < 0n || parts.lo > MAX_UINT16) {
    throw new Error("lo out of Uint<16> range");
  }

  return parts.hi * BASE + parts.lo;
}
```

The Compact storage uses two counters:

```compact
pragma language_version >= 0.16 && <= 0.25;

import CompactStandardLibrary;

export ledger deadline_hi: Counter;
export ledger deadline_lo: Counter;

export circuit setDeadlineParts(hi: Uint<16>, lo: Uint<16>): [] {
  deadline_hi.increment(hi);
  deadline_lo.increment(lo);
}

export circuit requireBeforeDeadline(deadlineSeconds: Uint<64>): [] {
  assert(blockTimeLt(disclose(deadlineSeconds)), "Deadline has passed");
}
```

The test proves round-trip behavior:

```ts
import assert from "node:assert/strict";

const deadlineSeconds = 1_763_020_800n;
const parts = splitUint16(deadlineSeconds);

assert.deepEqual(parts, { hi: 26_901n, lo: 36_864n });
assert.equal(joinUint16Parts(parts), deadlineSeconds);
```

This two-field layout can represent values up to `4,294,967,295`, which covers
Unix timestamps until February 7, 2106. If your application needs dates beyond
that, add another field or use a wider storage strategy.

The split pattern is usually the best fit when you need exact Unix seconds and
want compact initialization. It avoids thousands of repeated increments while
staying inside the `Uint<16>` argument limit. Its main cost is that the value is
not visually stored as one number. Your application, tests, and documentation
must treat `deadline_hi` and `deadline_lo` as one logical field.

## Choosing the Right Pattern

Use the block-time functions directly whenever possible. If a deadline is known
at call time, pass it into the circuit and assert the correct comparison:

```compact
export circuit placeBid(deadlineSeconds: Uint<64>): [] {
  assert(blockTimeLt(disclose(deadlineSeconds)), "Auction closed");
}
```

Only store a deadline when the contract or indexer needs durable public state.
For example, an auction contract should store its closing time so clients can
render it, indexers can query it, and later calls can use the same value. A one
off proof that something happened before a supplied timestamp may not need
deadline storage at all.

Choose hours since epoch when the application is naturally coarse-grained. The
code is easy to explain, the stored number is smaller, and the UI can present
deadlines as hour buckets.

Choose multiple increments only when the value is moderately larger than
`65,535`. It is mechanically correct, but it does not scale well to second-level
Unix timestamps.

Choose `deadline_hi` plus `deadline_lo` when exact seconds matter. It is the most
practical workaround for a timestamp that must be stored in counter-like fields
while respecting the `Uint<16>` increment ceiling.

## Complete Example: Auction Deadline Encoding

The following contract combines the split-storage pattern with block-time checks.
The ledger fields are public, and the call that enforces the deadline receives
the recomposed Unix timestamp from the client. The client should derive that
timestamp from the stored parts and verify that it matches the expected auction
configuration before submitting.

```compact
pragma language_version >= 0.16 && <= 0.25;

import CompactStandardLibrary;

export ledger deadline_hi: Counter;
export ledger deadline_lo: Counter;
export ledger bid_count: Counter;

export circuit initializeDeadline(hi: Uint<16>, lo: Uint<16>): [] {
  deadline_hi.increment(hi);
  deadline_lo.increment(lo);
}

export circuit placeBid(deadlineSeconds: Uint<64>): [] {
  assert(blockTimeLt(disclose(deadlineSeconds)), "Auction closed");
  bid_count.increment(1);
}

export circuit claimAfterDeadline(deadlineSeconds: Uint<64>): [] {
  assert(blockTimeGte(disclose(deadlineSeconds)), "Auction still open");
}
```

The corresponding TypeScript helper keeps the contract calls consistent:

```ts
const BASE = 65_536n;
const MAX_UINT16 = 65_535n;

export function splitDeadline(deadlineSeconds: bigint) {
  const hi = deadlineSeconds / BASE;
  const lo = deadlineSeconds % BASE;

  if (hi > MAX_UINT16) {
    throw new Error("deadline exceeds two-part encoding");
  }

  return { hi, lo };
}

export function joinDeadline(hi: bigint, lo: bigint): bigint {
  if (hi > MAX_UINT16 || lo > MAX_UINT16) {
    throw new Error("deadline part exceeds Uint<16>");
  }

  return hi * BASE + lo;
}
```

And the tests document the intended behavior:

```ts
import assert from "node:assert/strict";

const deadlineSeconds = 1_763_020_800n;
const { hi, lo } = splitDeadline(deadlineSeconds);

assert.equal(hi, 26_901n);
assert.equal(lo, 36_864n);
assert.equal(joinDeadline(hi, lo), deadlineSeconds);
assert.throws(() => splitDeadline(4_294_967_296n));
```

## Security and Product Notes

Block time is a consensus value, not a precision clock. Design deadlines with
reasonable tolerance, and avoid UX copy that implies millisecond precision. For
most applications, users think in minutes, hours, or days. The contract should be
stricter than the UI only when the product has made that boundary clear.

Be explicit about inclusivity. `blockTimeLt(deadline)` and
`blockTimeGte(deadline)` form a clean pair: before the deadline, one action is
available; at or after the deadline, the next action is available. This avoids a
gap at the exact boundary. Similarly, `blockTimeLte(deadline)` pairs naturally
with `blockTimeGt(deadline)`.

Do not hide public deadlines in private witnesses. A public deadline is simpler
to audit and easier for wallets, explorers, and indexers to display. If the
deadline itself is sensitive, document exactly what each comparison discloses.

Finally, keep timestamp encoding logic in one client helper and test it. Most
bugs in deadline code are not in the `assert(blockTime...)` line. They are in
rounding, splitting, joining, and retry behavior around ledger updates.

## References

- Midnight developer documentation: <https://docs.midnight.network/>
- Compact standard library documentation: <https://docs.midnight.network/compact/standard-library.md>
- Compact examples: <https://docs.midnight.network/examples/contracts/>
- Midnight developer forum: <https://forum.midnight.network/>
