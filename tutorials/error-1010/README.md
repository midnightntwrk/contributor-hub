# Decoding Error 1010: What "Invalid Transaction" Actually Means

## Overview

This tutorial demystifies **Error 1010: Invalid Transaction** — the most common and most misleading error on the Midnight Network. You will learn how to decode the error's internal structure, map each variant to its root cause, and follow a systematic diagnostic workflow that turns hours of guesswork into minutes of targeted debugging.

## Files

- `error-1010.md` — Main tutorial (2,500+ words): error anatomy, variant mapping, cost model, diagnostic workflow
- `contracts/block_limit_demo.compact` — Compact contract demonstrating BlockLimitExceeded patterns and safe alternatives
- `contracts/safe_batch.compact` — Compact contract showing chunked batch processing that stays within block limits
- `contracts/effects_debug.compact` — Compact contract with effects-check-friendly patterns
- `examples/diagnose.ts` — TypeScript utility for parsing and classifying Error 1010 variants
- `examples/safe-submit.ts` — TypeScript wrapper for safe transaction submission with retry and chunking

## Prerequisites

- Midnight toolchain installed ([installation guide](https://docs.midnight.network/getting-started/installation))
- Node.js v22+
- Familiarity with Compact syntax basics ([hello world tutorial](https://docs.midnight.network/getting-started/hello-world))
- A funded wallet on Midnight testnet (or local devnet running)

## Topics Covered

1. The `POOL_INVALID_TX = AUTHOR(1000) + 10` error code structure
2. Five common custom error variants: 139, 154, 168, 170, 186
3. The ledger's 5-dimensional cost model
4. Step-by-step diagnostic workflow for each variant
5. Compact contract patterns that avoid Error 1010
6. TypeScript utilities for automated error classification and safe submission

## Related Issue

[#318 — [Tutorial] Decoding Error 1010: What 'Invalid Transaction' Actually Means](https://github.com/midnightntwrk/contributor-hub/issues/318)
