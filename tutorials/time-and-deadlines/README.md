# Time and Deadlines in Compact: Block Time, Counters & the Uint<16> Problem

## Introduction

In Compact smart contracts, handling time is crucial for features like deadlines, auctions, and timed transitions. Midnight provides four block-time query functions that allow you to check the current block time relative to stored values. However, there is a limitation: `Counter.increment()` accepts only `Uint<16>` values, meaning you can only add up to 65,535 per increment. This poses a problem when storing large timestamps (e.g., Unix time in seconds) in a single field. This tutorial explains the block-time functions, the Uint<16> ceiling, and three workarounds for storing timestamps.

## Block-Time Query Functions

Midnight offers four functions to compare block time against a stored value:

- `blockTimeLt(value)`: Returns true if current block time is less than `value`.
- `blockTimeGte(value)`: Returns true if current block time is greater than or equal to `value`.
- `blockTimeLte(value)`: Returns true if current block time is less than or equal to `value`.
- `blockTimeGt(value)`: Returns true if current block time is greater than `value`.

These functions are typically used in `when` clauses or as constraints on transitions. The `value` must be of type `Uint<16>`.

## The Uint<16> Problem with Counter.increment()

The `Counter` type in Compact allows storing a monotonically increasing value. The `increment` method takes a `Uint<16>` parameter, meaning you can only add up to 65,535 in a single call. This is insufficient if you want to store a Unix timestamp (which can be over 1.7 billion as of 2024).

```compact
// This will cause a compilation error if value > 65535
counter.increment(value);
```

## Workarounds

### 1. Hours-Since-Epoch
Instead of storing seconds since epoch, store hours since epoch. Hours fit within `Uint<16>` (max 65535 hours ≈ 7.5 years). This is suitable for contracts with a limited lifespan.

```compact
// Store hours since Unix epoch
let hours = currentTime / 3600; // truncate to Uint<16>
counter.set(hours);
```

### 2. Multiple Increments
If you need to store a larger value, you can perform multiple increments of 65535, then a final increment with the remainder.

```compact
function setTimestamp(counter: Counter, timestamp: Uint): Unit {
    let remaining = timestamp;
    while (remaining > 65535) {
        counter.increment(65535);
        remaining = remaining - 65535;
    }
    counter.increment(remaining as Uint<16>);
}
```

### 3. Splitting into deadline_hi and deadline_lo
Store the timestamp in two fields: `deadline_hi` (high 16 bits) and `deadline_lo` (low 16 bits). This supports any timestamp up to ~4.3 billion (32 bits).

```compact
// Storing:
let deadline = 1700000000; // example timestamp
let hi = (deadline >> 16) as Uint<16>;
let lo = (deadline & 0xFFFF) as Uint<16>;
counterHi.set(hi);
counterLo.set(lo);

// Reading:
let deadline = (counterHi.get() << 16) | counterLo.get();
```

## Conclusion

By using these workarounds, you can effectively store large timestamps in Compact despite the `Uint<16>` limitation. Choose the method that best fits your contract's requirements.

## References

- Midnight Docs: https://docs.midnight.network/getting-started
- Midnight MCP: https://www.npmjs.com/package/midnight-mcp
- Developer Forum: https://forum.midnight.network/
- Discord: https://discord.com/invite/midnightnetwork