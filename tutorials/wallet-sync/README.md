# Understanding Wallet Sync: Why Your Deploy Fails Before It Starts

## Overview

Your contract compiles, your proof server is running, you call `balanceUnboundTransaction` — and it hangs. Or throws an error about missing UTXOs. Or silently builds a transaction with wrong balances that fails downstream with a completely unrelated message.

The problem is not your contract. The problem is sync.

This tutorial explains what "wallet sync" actually means inside the Midnight SDK, why the wallet is not one object but three independent sub-wallets that each scan the chain separately, how a known bug in the DUST sub-wallet can hang `isStrictlyComplete()` on quiet networks, and the exact RxJS patterns that prevent all of these failures.

## Files

- `wallet-sync.md` — Main tutorial (2,000+ words): sub-wallet architecture, failure modes, the DUST bug, safe sync patterns
- `examples/wallet-sync.ts` — TypeScript utility: `waitForWalletSync()` with timeout, polling fallback, and DUST bug workaround
- `examples/health-check.ts` — Production health-check integration: Express `/health` endpoint, readiness probe, sync monitoring

## Prerequisites

- Midnight toolchain installed ([installation guide](https://docs.midnight.network/getting-started/installation))
- Node.js v22+
- Familiarity with Compact basics ([hello world tutorial](https://docs.midnight.network/getting-started/hello-world))
- A funded wallet on Midnight testnet (or local devnet running)

## Topics Covered

1. Why `balanceUnboundTransaction` fails on unsynced wallets
2. The three sub-wallets: shielded, unshielded, DUST — and what each needs to sync
3. The known DUST wallet bug: `isStrictlyComplete()` hanging on idle chains
4. Safe sync pattern using `facade.state().pipe(filter(s => s.isSynced))`
5. Polling fallback for environments where RxJS observables are impractical
6. Production monitoring: health checks, readiness probes, and continuous sync validation

## Related Issue

[#300 — [Tutorial] Understanding Wallet Sync: Why Your Deploy Fails Before It Starts](https://github.com/midnightntwrk/contributor-hub/issues/300)
