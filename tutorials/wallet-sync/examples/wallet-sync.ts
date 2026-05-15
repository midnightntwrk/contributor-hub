/**
 * Wallet Sync Utilities for Midnight Network
 *
 * Provides waitForWalletSync() with timeout, polling fallback,
 * and DUST bug workaround. Also includes re-sync helpers for
 * transaction retry loops.
 *
 * Usage:
 *   import { waitForWalletSync, waitForSyncByPolling } from './wallet-sync';
 *
 *   const wallet = await createWallet(seed, proofServer);
 *   const state = await waitForWalletSync(wallet, 60_000);
 *   console.log('Synced:', state.isSynced);
 */

import { firstValueFrom, timeout, catchError, of, throwError } from 'rxjs';
import { filter } from 'rxjs/operators';

// =============================================
// Types (replace with actual SDK types)
// =============================================

interface WalletState {
  isSynced: boolean;
  shielded: { balances: Record<string, bigint> };
  unshielded: { balances: Record<string, bigint> };
  dust: { totalCoins: bigint };
  address: string;
}

interface Wallet {
  state(): import('rxjs').Observable<WalletState>;
  waitForSyncedState(): Promise<WalletState>;
}

// =============================================
// waitForWalletSync — primary sync function
// =============================================

/**
 * Wait for the wallet to sync with the blockchain.
 *
 * Uses facade.state() combined with a filter on isSynced and an
 * explicit timeout. Falls back to the current state if the DUST
 * sub-wallet's isStrictlyComplete() hangs on an idle chain.
 *
 * @param wallet - The wallet instance to sync
 * @param timeoutMs - Maximum time to wait in milliseconds (default: 30s)
 * @returns The synced (or partially synced) wallet state
 * @throws If the wallet cannot sync at all
 */
export async function waitForWalletSync(
  wallet: Wallet,
  timeoutMs: number = 30_000
): Promise<WalletState> {
  try {
    // Primary path: wait for isSynced with timeout
    const state = await firstValueFrom(
      wallet.state().pipe(
        filter((s: WalletState) => s.isSynced),
        timeout({ first: timeoutMs }),
        catchError(() => of(null))
      )
    );

    if (state?.isSynced) {
      return state;
    }

    // DUST bug fallback: isSynced never became true within timeout.
    // The shielded and unshielded sub-wallets are likely fine;
    // only the DUST sub-wallet is stuck on isStrictlyComplete().
    const currentState = await firstValueFrom(wallet.state());
    console.warn(
      `[Sync] Timeout after ${timeoutMs}ms. ` +
      `Current state: synced=${currentState.isSynced}. ` +
      `Proceeding with partial sync — DUST operations may fail.`
    );
    return currentState;
  } catch (err) {
    throw new Error(`Wallet sync failed: ${err}`);
  }
}

// =============================================
// waitForSyncByPolling — polling alternative
// =============================================

/**
 * Poll-based sync wait for environments where RxJS observables
 * are impractical (CLI tools, scripts, test harnesses).
 *
 * @param wallet - The wallet instance to sync
 * @param intervalMs - Polling interval in milliseconds (default: 2s)
 * @param maxAttempts - Maximum polling attempts (default: 30)
 * @returns The synced wallet state
 * @throws If maxAttempts is exceeded without sync
 */
export async function waitForSyncByPolling(
  wallet: Wallet,
  intervalMs: number = 2_000,
  maxAttempts: number = 30
): Promise<WalletState> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const state = await firstValueFrom(wallet.state());
    if (state.isSynced) {
      console.log(`[Sync] Wallet synced after ${attempt + 1} attempts`);
      return state;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Wallet failed to sync after ${maxAttempts} attempts`);
}

// =============================================
// submitWithSyncCheck — verify sync before tx
// =============================================

/**
 * Verify wallet is synced before submitting a transaction.
 * Re-syncs if necessary.
 *
 * @param wallet - The wallet instance
 * @param submitFn - The transaction submission function
 * @param syncTimeoutMs - Sync timeout (default: 30s)
 * @returns The submission result
 */
export async function submitWithSyncCheck<T>(
  wallet: Wallet,
  submitFn: () => Promise<T>,
  syncTimeoutMs: number = 30_000
): Promise<T> {
  const state = await firstValueFrom(wallet.state());
  if (!state.isSynced) {
    console.warn('[Sync] Wallet not synced, waiting...');
    await waitForWalletSync(wallet, syncTimeoutMs);
  }
  return submitFn();
}

// =============================================
// transactWithRetry — sync-aware retry loop
// =============================================

/**
 * Submit a transaction with automatic re-sync between retries.
 * Re-syncs the wallet after each failure to ensure UTXO state
 * is current before the next attempt.
 *
 * @param wallet - The wallet instance
 * @param submitFn - The transaction submission function
 * @param maxRetries - Maximum retry attempts (default: 3)
 * @param isRetryable - Optional function to classify errors
 * @returns The submission result
 */
export async function transactWithRetry<T>(
  wallet: Wallet,
  submitFn: () => Promise<T>,
  maxRetries: number = 3,
  isRetryable?: (err: unknown) => boolean
): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Re-sync on retries (not on first attempt)
    if (attempt > 0) {
      console.log(`[Retry ${attempt}] Re-syncing wallet...`);
      await waitForWalletSync(wallet, 30_000);
    }

    try {
      return await submitWithSyncCheck(wallet, submitFn);
    } catch (err) {
      // Check if this error is worth retrying
      if (isRetryable && !isRetryable(err)) {
        console.error(`[Fatal] Non-retryable error: ${err}`);
        throw err;
      }
      console.warn(`[Attempt ${attempt + 1}] Failed: ${err}`);

      if (attempt === maxRetries - 1) {
        throw new Error(
          `Transaction failed after ${maxRetries} attempts: ${err}`
        );
      }
    }
  }

  throw new Error('unreachable');
}

// =============================================
// Example usage
// =============================================

/**
 * Complete startup sequence demonstrating all sync patterns.
 * Replace createWallet() and proofServer with your actual setup.
 */
async function example() {
  // Assume these are defined elsewhere:
  // const wallet = await createWallet(seed, proofServer);

  // 1. Wait for sync at startup
  // console.log('[Startup] Waiting for wallet sync...');
  // const syncedState = await waitForWalletSync(wallet, 60_000);
  // console.log('[Startup] Wallet synced:', syncedState.isSynced);
  // console.log('[Startup] Shielded balance:', syncedState.shielded.balances);
  // console.log('[Startup] Unshielded balance:', syncedState.unshielded.balances);
  // console.log('[Startup] DUST balance:', syncedState.dust.totalCoins);

  // 2. Submit a transaction with sync check
  // const result = await submitWithSyncCheck(wallet, async () => {
  //   return wallet.submitTransaction(tx);
  // });

  // 3. Submit with retry and re-sync
  // const result = await transactWithRetry(
  //   wallet,
  //   async () => wallet.submitTransaction(tx),
  //   3,
  //   (err) => {
  //     const msg = String(err).toLowerCase();
  //     return msg.includes('utxo') || msg.includes('balance') || msg.includes('1010');
  //   }
  // );
}
