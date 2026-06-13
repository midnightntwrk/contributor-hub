# Understanding Wallet Sync: Why Your Deploy Fails Before It Starts

## Introduction

When developing on Midnight, a common pitfall is calling `balanceUnboundTransaction` before the wallet has fully synced. This mistake can lead to failed deployments, unexpected errors, and wasted debugging time. In this tutorial, we will explore what happens under the hood when you attempt to interact with an unsynced wallet, the three sub-wallets that need to synchronize, a known bug with the dust wallet, and the safe sync pattern that ensures your code runs reliably.

## What Happens When You Call `balanceUnboundTransaction` Before Sync?

`balanceUnboundTransaction` is a function that retrieves unspent transaction outputs (UTXOs) available for spending. If the wallet has not finished syncing, this function may return incomplete or stale data. The wallet relies on a local state that is updated as it processes blocks from the chain. Calling `balanceUnboundTransaction` before the sync completes can result in:

- Missing UTXOs that are already confirmed
- Incorrect balance calculations
- Transaction failures due to referencing unspendable outputs
- Potential hangs if internal conditions are not met

## The Three Sub-wallets: Shielded, Unshielded, Dust

Midnight's wallet is not a single entity; it consists of three logical sub-wallets, each tracking different types of coins:

- **Shielded Wallet**: Tracks coins that are privacy-protected (shielded transactions). These require syncing of encrypted blocks and decrypting locally.
- **Unshielded Wallet**: Tracks public coins that are not privacy-protected. These sync faster as no decryption is needed.
- **Dust Wallet**: Tracks small UTXOs (dust) that are below a certain threshold. Dust requires special handling and can lead to edge cases.

Each sub-wallet has its own sync state. The overall wallet sync is only complete when all three are fully synced.

## The Known Dust Wallet Bug: `isStrictlyComplete()` Hangs on Idle Chains

A known bug in the dust wallet logic is that `isStrictlyComplete()` can hang indefinitely when the chain is idle (no new blocks). This function is used by the wallet to determine if the dust sync is finished. The bug occurs because the dust wallet expects a certain confirmation threshold that is never reached on idle chains. As a result, the sync state never becomes "complete," blocking any subsequent operations that depend on it.

### Symptoms
- The wallet sync status remains "syncing" even after processing all blocks.
- `balanceUnboundTransaction` hangs or returns an error.
- The application cannot proceed to the next step.

### Workaround
Until the bug is fixed in a future release, a safe workaround is to use a timeout or check the sync status differently. However, the recommended approach is to use the safe sync pattern described next.

## Safe Sync Pattern: `facade.state().pipe(filter(s => s.isSynced))`

To avoid issues with incomplete sync, always wait for the wallet to be fully synced before calling `balanceUnboundTransaction`. The `facade` object provides a reactive state observable that emits the latest sync status. Use RxJS operators to filter only when `isSynced` is true:

```typescript
import { facade } from './wallet-facade';
import { filter, firstValueFrom } from 'rxjs';

async function waitForSync(): Promise<void> {
  await firstValueFrom(
    facade.state().pipe(
      filter(state => state.isSynced)
    )
  );
}

async function getBalance(): Promise<bigint> {
  await waitForSync();
  const balance = await facade.balanceUnboundTransaction();
  return balance;
}
```

This pattern ensures that your code only proceeds after all sub-wallets have synced, preventing hangs and incorrect data.

## Complete Example

Below is a complete example that demonstrates safe usage:

```typescript
import { facade } from './wallet-facade';
import { filter, firstValueFrom } from 'rxjs';

async function main() {
  // Wait for wallet sync
  console.log('Waiting for wallet sync...');
  await firstValueFrom(
    facade.state().pipe(
      filter(state => state.isSynced)
    )
  );
  console.log('Wallet synced!');

  // Now safe to call balanceUnboundTransaction
  const balance = await facade.balanceUnboundTransaction();
  console.log('Balance:', balance);

  // Proceed with deployment
  // ...
}

main().catch(console.error);
```

## Conclusion

Understanding wallet sync is crucial for building reliable Midnight applications. By waiting for all three sub-wallets to sync, avoiding the dust wallet bug, and using the safe sync pattern, you can prevent deployment failures before they start. Always ensure your code handles sync state properly, and stay updated with Midnight's documentation for bug fixes and improvements.

## References

- [Midnight Documentation](https://docs.midnight.network/getting-started)
- [Midnight MCP Package](https://www.npmjs.com/package/midnight-mcp)
- [Developer Forum](https://forum.midnight.network/)
- [Discord](https://discord.com/invite/midnightnetwork)