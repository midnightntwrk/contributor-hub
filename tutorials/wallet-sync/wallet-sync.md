# Understanding Wallet Sync: Why Your Deploy Fails Before It Starts

**By billbtbillb | May 2026**

You wrote your first Midnight dApp. The Compact contract compiles. The proof server is up. You call `balanceUnboundTransaction` to deploy — and nothing happens. Or you get a cryptic error about missing UTXOs. Or the transaction submits but immediately fails with Error 1010.

The instinct is to blame the contract, the proof server, or the network. In almost every case, the real problem is simpler: **your wallet has not finished syncing with the chain**.

This tutorial explains what "sync" means inside the Midnight SDK, why the wallet is architecturally three independent sub-wallets that each scan the chain on their own schedule, how a known bug in the DUST sub-wallet can hang your startup on quiet networks, and the exact patterns that eliminate sync-related failures for good.

---

## Prerequisites

- Midnight toolchain installed ([installation guide](https://docs.midnight.network/getting-started/installation))
- Node.js v22+
- Familiarity with Compact syntax basics ([hello world tutorial](https://docs.midnight.network/getting-started/hello-world))
- A funded wallet on Midnight testnet (or local devnet running)

---

## 1. What `balanceUnboundTransaction` Actually Needs

When you build a transaction in Midnight, you start with an *unbound* transaction — a description of what you intend to do without any inputs or outputs selected. Before the network can process it, the wallet must:

1. **Select shielded UTXOs** — encrypted outputs that only your keys can decrypt
2. **Select unshielded UTXOs** — transparent tokens at your address
3. **Attach DUST** — the fee token that pays for transaction execution
4. **Balance the transaction** — ensuring inputs equal outputs plus fees

All four steps require the wallet to have a *current* view of which UTXOs it owns. That view comes from sync. If the wallet has not finished scanning the chain, `balanceUnboundTransaction` builds a transaction from whatever partial state it has — and the result is almost always wrong.

```
// What you think happens:
const tx = await wallet.balanceUnboundTransaction(unboundTx);
// → balanced transaction ready to submit

// What actually happens when unsynced:
const tx = await wallet.balanceUnboundTransaction(unboundTx);
// → Error: insufficient balance
// → Error: missing UTXO
// → hangs indefinitely (DUST bug)
// → or worse: silently succeeds with wrong amounts
```

---

## 2. The Three Sub-Wallets

A Midnight wallet is not a single object. It manages **three independent sub-wallets**, each with its own UTXO set, its own sync state, and its own failure modes.

### 2.1 Shielded Sub-Wallet

The shielded wallet holds **private tokens** — encrypted UTXOs that only the wallet owner can decrypt and spend. When someone sends you shielded tokens, the wallet must scan every new block, attempt to decrypt each shielded output with your viewing key, and add any matches to its local database.

- **Discovery method:** Block-by-block decryption scan
- **Sync dependency:** HIGH — cannot spend what has not been decrypted
- **Failure mode when unsynced:** "Insufficient balance" for tokens you actually own

The shielded wallet is the slowest to sync because decryption is computationally expensive. On a fresh wallet scanning from genesis, this can take several minutes.

### 2.2 Unshielded Sub-Wallet

The unshielded wallet holds **transparent tokens** — visible on-chain, similar to a regular blockchain address. The wallet still needs to index the chain to know which UTXOs are currently spendable.

- **Discovery method:** Indexer queries for UTXOs at your address
- **Sync dependency:** MEDIUM — chain data is public but wallet must still index it
- **Failure mode when unsynced:** Same "insufficient balance" problem, but for transparent tokens

### 2.3 DUST Sub-Wallet

DUST is Midnight's fee token. Every transaction costs DUST, and the DUST sub-wallet must have available UTXOs to pay those fees. A wallet generates DUST by holding NIGHT tokens, but the wallet must sync to discover newly generated DUST UTXOs.

- **Discovery method:** Scanning for DUST-generating events at your address
- **Sync dependency:** CRITICAL — no DUST means no fee payment means no transactions at all
- **Failure mode when unsynced:** Transaction fails with fee-related errors before any contract logic runs

The DUST sub-wallet is also the source of a known bug, which we will cover in Section 4.

### How They Interact

```
┌─────────────────────────────────────────────────────────┐
│                    Wallet Facade                         │
│                                                         │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐    │
│  │  Shielded    │ │  Unshielded  │ │    DUST      │    │
│  │  Sub-Wallet  │ │  Sub-Wallet  │ │  Sub-Wallet  │    │
│  │              │ │              │ │              │    │
│  │  ZK notes    │ │  Transparent │ │  Fee tokens  │    │
│  │  Encrypted   │ │  UTXOs       │ │  Generated   │    │
│  │  UTXOs       │ │              │ │  from NIGHT  │    │
│  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘    │
│         │                │                │            │
│         └────────────────┼────────────────┘            │
│                          │                              │
│              balanceUnboundTransaction()                 │
│              needs ALL three synced                      │
└─────────────────────────────────────────────────────────┘
```

When you call `balanceUnboundTransaction`, the wallet draws from whichever sub-wallets are relevant to the transaction. A deploy might need shielded tokens (for contract state), unshielded tokens (for public operations), and DUST (for fees). If *any* sub-wallet is out of sync, the balancing fails.

---

## 3. What Happens When You Skip Sync

### Scenario A: Missing UTXOs

Your wallet received tokens five seconds ago. You immediately try to spend them. The wallet has not synced since receiving, so it does not know the tokens exist.

```
Time 0: Someone sends you 100 NIGHT (shielded)
Time 1: You call balanceUnboundTransaction (sync NOT complete)
Time 2: Wallet has no record of the 100 NIGHT → "insufficient balance"
```

This is the most common failure for new developers. The fix is trivial — wait for sync — but the error message gives no hint that sync is the problem.

### Scenario B: Double-Spending Stale UTXOs

You submitted Transaction A, which consumed UTXO #1. Before the wallet re-syncs, you try to build Transaction B. The wallet still thinks UTXO #1 is available and tries to spend it again.

```
Time 0: Transaction A submitted, consumes UTXO #1
Time 1: Wallet hasn't re-synced, still thinks UTXO #1 exists
Time 2: balanceUnboundTransaction tries to spend UTXO #1 again
Time 3: Network rejects → Error 1010 (Invalid Transaction)
```

This is particularly insidious because the error looks like a contract problem, not a sync problem.

### Scenario C: DUST Fee Failure

Your wallet has NIGHT tokens that are generating DUST. But the DUST sub-wallet has not synced, so it has no record of any DUST UTXOs.

```
Time 0: Wallet receives NIGHT, starts generating DUST
Time 1: You call transact() before DUST sub-wallet syncs
Time 2: Wallet has zero known DUST UTXOs → cannot pay fees → fails
```

New wallets are especially vulnerable. Until the DUST sub-wallet syncs, the wallet literally cannot pay for any transaction — even if it has plenty of DUST on-chain.

---

## 4. The Known DUST Wallet Bug

There is a documented issue with the DUST sub-wallet's `isStrictlyComplete()` method on idle chains. When network activity is low, this method may hang indefinitely, never resolving to `true`.

### Root Cause

The wallet sync process checks whether each sub-wallet has finished processing all relevant blocks. For the shielded and unshielded sub-wallets, this check works reliably. But the DUST sub-wallet's `isStrictlyComplete()` waits for confirmation that all expected DUST-generating events have been processed. On an idle chain, these events are sparse, and the completion signal may never arrive.

```typescript
// This may NEVER resolve on an idle chain:
const state = await facade.state()
  .pipe(filter(s => s.dust.isStrictlyComplete()))
  .toPromise();

// isSynced may stay false because the DUST sub-wallet
// is waiting for block data that arrives very slowly
```

### The Symptom

Your application starts, initializes the wallet, calls `waitForSyncedState()` — and hangs. The shielded and unshielded sub-wallets are fine, but the DUST sub-wallet is stuck waiting for events that have not arrived yet. The overall `isSynced` flag remains `false`.

### The Workaround

Use a timeout. Instead of waiting indefinitely for `isStrictlyComplete()`, wait for `isSynced` with a reasonable timeout, then fall back to checking the current state:

```typescript
import { firstValueFrom, timeout, catchError, of } from 'rxjs';
import { filter } from 'rxjs/operators';

async function waitForWalletSync(wallet: Wallet, timeoutMs = 30_000) {
  try {
    // Try the normal path first
    const state = await firstValueFrom(
      wallet.state().pipe(
        filter(s => s.isSynced),
        timeout({ first: timeoutMs }),
        catchError(() => of(null))
      )
    );

    if (state?.isSynced) {
      return state;
    }

    // Fallback: check current state even if isSynced is false
    // (DUST bug — shielded and unshielded may be fine)
    const currentState = await firstValueFrom(wallet.state());
    console.warn(
      `[Sync] Timeout after ${timeoutMs}ms. ` +
      `Current state: synced=${currentState.isSynced}. ` +
      `Proceeding with partial sync.`
    );
    return currentState;
  } catch (err) {
    throw new Error(`Wallet sync failed: ${err}`);
  }
}
```

This pattern ensures your application starts even when the DUST sub-wallet is stuck. The tradeoff is that DUST-dependent operations may still fail if the DUST sub-wallet is genuinely out of sync — but at least the rest of your application is functional.

---

## 5. The Safe Sync Pattern

Every production Midnight application should follow this three-part sync pattern.

### Part 1: Wait for Sync at Startup

Before your application accepts any transaction requests, wait for the wallet to sync:

```typescript
async function initializeApplication(seed: Uint8Array) {
  const wallet = await createWallet(seed, proofServer);

  console.log('[Startup] Waiting for wallet sync...');
  const syncedState = await waitForWalletSync(wallet, 60_000);
  console.log('[Startup] Wallet synced:', syncedState.isSynced);

  // Now safe to create providers and accept requests
  const providers = createProviders(syncedState);
  return { wallet, providers };
}
```

### Part 2: Check Sync Before Every Transaction

Do not assume the wallet stayed synced. Check before each transaction:

```typescript
async function submitWithSyncCheck(
  wallet: Wallet,
  tx: Transaction
): Promise<SubmitResult> {
  const state = await firstValueFrom(wallet.state());
  if (!state.isSynced) {
    console.warn('[Sync] Wallet not synced, re-syncing...');
    await waitForWalletSync(wallet, 30_000);
  }
  return submitContractTransaction(wallet, tx);
}
```

### Part 3: Re-Sync After Failures

When a transaction fails with a UTXO-related error, re-sync before retrying. The failure likely consumed or created UTXOs that the wallet does not yet know about:

```typescript
async function transactWithRetry(
  wallet: Wallet,
  tx: Transaction,
  maxRetries = 3
): Promise<SubmitResult> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      console.log(`[Retry ${attempt}] Re-syncing wallet...`);
      await waitForWalletSync(wallet, 30_000);
    }

    try {
      return await submitWithSyncCheck(wallet, tx);
    } catch (err) {
      if (isNonRetryable(err)) throw err;
      console.warn(`[Attempt ${attempt + 1}] Failed: ${err.message}`);
    }
  }
  throw new Error(`Transaction failed after ${maxRetries} attempts`);
}
```

---

## 6. The Complete Transaction Pipeline

Here is where sync fits in the prove-balance-submit pipeline:

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  0. SYNC     │────→│  1. CREATE   │────→│  2. PROVE    │
│  wallet.state│     │  build tx    │     │  ZK proof    │
│  isSynced?   │     │              │     │  generation  │
└──────────────┘     └──────────────┘     └──────────────┘
                                                │
                     ┌──────────────┐     ┌─────▼──────┐
                     │  4. SUBMIT   │←────│ 3. BALANCE │
                     │  to network  │     │ add inputs │
                     │              │     │ & fees     │
                     └──────────────┘     └────────────┘
```

Step 0 is the sync check. Without it, steps 1–4 operate on stale data. The transaction may fail at any stage, and the error messages will point to step 3 (balancing) or step 4 (submission) — never to the actual root cause at step 0.

---

## 7. Production Monitoring

For backend services that run continuously, a one-time sync check at startup is not enough. The wallet can fall out of sync if:

- The indexer goes down temporarily
- Network connectivity is interrupted
- The wallet process is suspended and resumes

### Continuous Sync Monitoring

```typescript
class SyncMonitor {
  private lastSyncTime: Date | null = null;
  private isSynced = false;

  start(wallet: Wallet, alertCallback: (msg: string) => void) {
    wallet.state().subscribe(state => {
      const wasSynced = this.isSynced;
      this.isSynced = state.isSynced;

      if (state.isSynced) {
        this.lastSyncTime = new Date();
      }

      // Alert on sync loss
      if (wasSynced && !state.isSynced) {
        alertCallback('Wallet lost sync — transactions may fail');
      }
    });
  }

  getStatus() {
    return {
      isSynced: this.isSynced,
      lastSyncTime: this.lastSyncTime,
    };
  }
}
```

### Health Check Endpoint

Expose sync status for load balancers and orchestration systems:

```typescript
app.get('/health', (_req, res) => {
  const status = syncMonitor.getStatus();
  res.status(status.isSynced ? 200 : 503).json({
    status: status.isSynced ? 'ok' : 'degraded',
    walletSynced: status.isSynced,
    lastSyncTime: status.lastSyncTime?.toISOString() ?? null,
  });
});
```

When `isSynced` is `false`, the endpoint returns HTTP 503. A load balancer or Kubernetes readiness probe will stop routing traffic to this instance until sync recovers.

---

## Quick Reference

| Failure | Root Cause | Fix |
|---------|-----------|-----|
| "Insufficient balance" for tokens you own | Shielded or unshielded sub-wallet not synced | Wait for `isSynced === true` before transacting |
| Error 1010 on second transaction | Double-spend of stale UTXO | Re-sync between transactions |
| Fee-related errors on new wallet | DUST sub-wallet not synced | Wait for DUST sync; use timeout workaround |
| `waitForSyncedState()` hangs forever | DUST bug on idle chain | Use timeout + fallback (Section 4) |
| Works locally, fails on testnet | Testnet has more blocks to scan | Increase sync timeout for testnet |

---

## Resources

- [Midnight Wallet SDK Docs](https://docs.midnight.network/relnotes/wallet)
- [Wallet Developer Guide](https://docs.midnight.network/sdks/official/wallet-developer-guide)
- [Generating DUST Programmatically](https://docs.midnight.network/guides/generating-dust-programmatically)
- [Midnight Developer Forum](https://forum.midnight.network/)
- [Midnight Discord](https://discord.com/invite/midnightnetwork)
