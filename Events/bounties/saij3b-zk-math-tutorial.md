---
type: tutorial
team_slug: saij3b-zk-math
team_name: saij3b
project_title: "Verified Math in ZK Circuits: Division, Exchange Rates & Overflow Protection"
repo_url: https://github.com/saij3b/midnight-verified-math
link:
members:
  - name: saij3b
    github: saij3b
tech_stack: [Compact, TypeScript, Midnight, zk]
tracks: [tutorial, compact, zk]
bounty_issue: "#298"
---

# Verified Math in ZK Circuits: Division, Exchange Rates & Overflow Protection

Zero-knowledge circuits do not behave like normal code. A circuit proves a statement is true over a fixed prime field, which means three things that bite new Midnight developers fast:

1. There is no native integer division — only multiplication and addition.
2. Counter fields are `Uint<16>`, so they cap at 65,535 and silently misbehave if you try to push past that.
3. Decimal math and large balances both need scaling tricks, because fractions and big numbers do not fit cleanly into a single bounded field.

This tutorial walks through the patterns Midnight Compact contracts use to handle all three. Every snippet is small enough to drop into a Compact project, and the TypeScript witnesses can be tested in isolation with `vitest`.

## Why circuits cannot just divide

In a normal language, `let q = a / b` is one instruction. In a zk circuit, every operation has to be expressed as an arithmetic constraint the prover commits to. Division by a witness value is not a polynomial relation, so the compiler refuses to emit it directly.

The fix is older than zk itself: have the prover compute the answer outside the circuit, hand it back as a witness, and then verify the answer inside the circuit using only addition and multiplication. That is the **witness-verified division pattern**, and it is the foundation everything else in this tutorial builds on.

## The witness-verified division pattern

A Midnight contract is split into two halves: the **circuit** (`.compact` file) defines what gets proven, and the **witness** (TypeScript file) provides values the prover knows but the circuit does not compute itself.

### Witness side — TypeScript

```ts
// witnesses.ts
export type DivideResult = { quotient: bigint; remainder: bigint };

export const witnesses = {
  divide: (
    _context: WitnessContext<Ledger, unknown>,
    numerator: bigint,
    divisor: bigint,
  ): [unknown, [bigint, bigint]] => {
    if (divisor === 0n) {
      throw new Error('divide: divisor must be non-zero');
    }
    const quotient = numerator / divisor;
    const remainder = numerator % divisor;
    return [_context.privateState, [quotient, remainder]];
  },
};
```

The witness does the easy thing: native BigInt division. It returns `[quotient, remainder]` as a tuple. The witness is **not trusted** — the prover could lie and return any pair. The circuit's job is to make lying impossible.

### Circuit side — Compact

```compact
// VerifiedMath.compact
pragma language_version >= 0.16;

import CompactStandardLibrary;

ledger lastQuotient: Uint<64>;
ledger lastRemainder: Uint<64>;

witness divide(
  numerator: Uint<64>,
  divisor: Uint<64>,
): [Uint<64>, Uint<64>];

export circuit safeDivide(
  numerator: Uint<64>,
  divisor: Uint<64>,
): [] {
  // Refuse divide-by-zero before trusting the witness.
  assert divisor != 0 "divisor must be non-zero";

  const [q, r] = divide(numerator, divisor);

  // The core verification: numerator == q * divisor + r, and r < divisor.
  assert q * divisor + r == numerator "quotient*divisor + remainder must equal numerator";
  assert r < divisor "remainder must be smaller than divisor";

  lastQuotient = q;
  lastRemainder = r;
}
```

Two assertions do all the work:

- `q * divisor + r == numerator` forces the witness's quotient and remainder to satisfy the division identity. A dishonest prover cannot pick any other `(q, r)` pair that passes this constraint for a given `(numerator, divisor)`.
- `r < divisor` rules out the degenerate cases where someone tries to inflate `r` and shrink `q`, or vice versa. Combined with the first check, this nails down `(q, r)` uniquely.

Both assertions are pure multiplication and comparison, which compile to clean arithmetic constraints. The expensive operation (division) happens off-circuit; the cheap operation (verification) happens on-circuit. That is the whole trick.

### Testing the witness

The witness is plain TypeScript, so test it directly:

```ts
// witnesses.test.ts
import { describe, it, expect } from 'vitest';
import { witnesses } from './witnesses';

const ctx = { privateState: undefined } as any;

describe('divide witness', () => {
  it('returns floor quotient and remainder', () => {
    const [, [q, r]] = witnesses.divide(ctx, 17n, 5n);
    expect(q).toBe(3n);
    expect(r).toBe(2n);
    expect(q * 5n + r).toBe(17n);
  });

  it('throws on divide-by-zero', () => {
    expect(() => witnesses.divide(ctx, 1n, 0n)).toThrow();
  });
});
```

Run with `npx vitest`. Every property the circuit asserts is also a property your witness should already satisfy — testing them together catches bugs before you ever spin up a prover.

## The `Uint<16>` Counter ceiling

Compact's `Counter` type is backed by `Uint<16>`. That gives you values from 0 to 65,535 — exactly the same as a classic 16-bit unsigned integer. Anything beyond that is a problem:

```compact
// This compiles, but the runtime will fail when count reaches 65,536.
ledger count: Counter;

export circuit bump(): [] {
  count.increment(1);
}
```

A contract that bumps a `Counter` once per user action will hit the wall after 65,536 calls. For low-volume admin counters that is fine. For anything user-facing — vote tallies, NFT mint counts, transaction sequence numbers — it is a ticking bomb.

Three ways to handle it:

### 1. Widen the type

If you do not need the `Counter` API specifically, declare your own `Uint<N>` ledger field:

```compact
ledger count: Uint<64>;

export circuit bump(): [] {
  assert count < 0xFFFFFFFFFFFFFFFF "count saturated";
  count = count + 1;
}
```

`Uint<64>` gives you ~1.8 × 10¹⁹ headroom, which is enough for every real-world counter. Always guard against the next overflow anyway — there is no implicit saturation in a circuit, just a failing proof.

### 2. Roll over and bucket

For genuinely unbounded counters, keep the `Counter` and pair it with an epoch:

```compact
ledger epoch: Uint<32>;
ledger count: Counter;     // resets every 65,536

export circuit bump(): [] {
  if (count.read() == 65535) {
    epoch = epoch + 1;
    count.reset();           // pseudocode — implement via reassignment
  }
  count.increment(1);
}
```

The true total is `epoch * 65_536 + count`. You pay one extra field of storage and you have to expose `(epoch, count)` together to anyone reading the value, but you keep the `Counter` ergonomics.

### 3. Refuse to overcount

The cheapest option: cap the counter and reject further increments. This works when "we have reached the maximum" is itself a valid business state (a vote with a fixed cap, an NFT mint with a hard supply).

```compact
export circuit bump(): [] {
  assert count.read() < 65535 "supply exhausted";
  count.increment(1);
}
```

Pick the option that matches your threat model. The mistake is to pick none, ship, and watch the contract brick at exactly the 65,536th call.

## Scaling factors for decimal math

Circuits work over a prime field; there is no native `float`. The standard fix is **fixed-point arithmetic**: every "decimal" value is stored as a scaled integer.

Pick a scaling factor `S` (usually a power of 10) once and stick to it across the contract. To represent `1.23` at `S = 1_000_000` you store `1_230_000`. The number of decimals you need depends on the application:

| Use case | Suggested `S` | Reason |
|---|---|---|
| Token balances | `10^6` to `10^18` | Match the token's on-chain decimals |
| Exchange rates | `10^6` | Six decimals is plenty for FX-style rates |
| Percentages | `10^4` | Basis points (0.01%) granularity |
| Probabilities | `10^6` | Avoid rounding cascades in compound math |

### Exchange-rate conversion, end to end

Suppose `rate` is stored at scale `S = 1_000_000` and represents "USDC per NIGHT". Converting an amount of NIGHT to USDC means `usdc = night * rate / S`. That divide is exactly the witness-verified pattern.

```compact
const SCALE: Uint<64> = 1_000_000;

export circuit convertNightToUsdc(
  nightAmount: Uint<64>,
  rate: Uint<64>,
): Uint<64> {
  // intermediate product
  const product: Uint<64> = nightAmount * rate;

  const [usdc, _r] = divide(product, SCALE);
  assert usdc * SCALE + _r == product "scaling check failed";
  assert _r < SCALE "remainder out of range";

  return usdc;
}
```

Two things to notice:

- We multiply *before* we divide. If you divide first, you lose precision permanently. This is exactly the same rule as in any fixed-point library.
- We re-run the verified-division assertions inline. The pattern is so common in real contracts that it pays to extract `safeDivide` as its own circuit and call it everywhere you need a division.

Watch the size of `product`. If `nightAmount` and `rate` can each reach `2^32`, the product fits in `Uint<64>` comfortably. If they can each reach `2^40`, you are already at risk of overflow inside `Uint<64>` — and that is the cue to move to multi-field amounts.

## Handling amounts larger than a single field

Compact's primitive widths top out at `Uint<128>` in practice. That is huge, but two failure modes still bite real contracts:

- **Intermediate overflow.** Two `Uint<64>` values multiplied together can hit `Uint<128>`. Two `Uint<128>` values multiplied together overflow even `Uint<128>`.
- **Application-level limits.** Some protocols want to represent balances or aggregate values that genuinely exceed `2^128`.

The pattern is to split the value into a `(high, low)` pair and treat it as a single logical number.

```compact
struct U256 {
  high: Uint<128>;
  low:  Uint<128>;
}

const TWO_128: Uint<256> = 1 << 128;

circuit addU256(a: U256, b: U256): U256 {
  // Add the low halves; capture the carry.
  const lowSum: Uint<256> = a.low + b.low;
  const carry:  Uint<128> = lowSum >> 128;
  const lowOut: Uint<128> = lowSum as Uint<128>;

  // Add the high halves plus the carry; assert no overflow.
  const highSum: Uint<256> = a.high + b.high + carry;
  assert (highSum >> 128) == 0 "U256 add overflow";

  return U256 { high: highSum as Uint<128>, low: lowOut };
}
```

The same idea extends to multiplication (Karatsuba-style decomposition) and to verified division on `U256` (the witness returns `(quotient_high, quotient_low, remainder_high, remainder_low)`, and the circuit verifies `q * d + r == n` using the `addU256` and `mulU256` you already built).

The cost is constraint count: every wide-arithmetic operation becomes several base operations. The benefit is correctness — no silent wraparounds, no precision loss, and assertions that fail loudly if you ever stray outside the declared range.

### Witness for U256 division

```ts
export const witnesses = {
  divideU256: (
    _ctx: WitnessContext<Ledger, unknown>,
    nHigh: bigint, nLow: bigint,
    dHigh: bigint, dLow: bigint,
  ): [unknown, [bigint, bigint, bigint, bigint]] => {
    const n = (nHigh << 128n) | nLow;
    const d = (dHigh << 128n) | dLow;
    if (d === 0n) throw new Error('divideU256: divisor zero');
    const q = n / d;
    const r = n % d;
    const mask = (1n << 128n) - 1n;
    return [_ctx.privateState, [q >> 128n, q & mask, r >> 128n, r & mask]];
  },
};
```

Plain BigInt math off-circuit, plain bit-masking to repack into the `(high, low)` shape the circuit expects. The verification logic on the circuit side is the same identity as before — `q * d + r == n` and `r < d` — just lifted to `U256` arithmetic.

## Putting it together

Every pattern in this tutorial is one variation on a single idea: **let the prover do the hard math, and have the circuit verify it cheaply.** Division becomes a multiplication check. Decimal math becomes a scaled-integer check. Wide values become a paired-field check.

When you build the next Midnight contract, the order to think in is:

1. What is the largest legitimate value any field will ever hold? Pick widths to match, with at least one bit of headroom.
2. Where do decimals enter? Pick one scaling factor for the whole contract and document it next to the ledger declarations.
3. Where do divisions enter? Wrap every one in a witness-verified `safeDivide` circuit.
4. Where do you need a `Counter`? Confirm 65,535 is enough, or widen the field.
5. Where do values get multiplied? Sanity-check that the product fits the destination type, or split into multi-field arithmetic.

Build the witness alongside the circuit, write a `vitest` test for every witness, and run the assertions yourself before you trust the prover. The whole point of zk is that the verifier does not have to take anyone's word — including yours.
