/**
 * Example: Wallet initialization with the new Midnight SDK 4.x+ API
 *
 * This file demonstrates the before/after patterns for wallet setup
 * when upgrading from SDK 3.x to 4.x/5.x.
 */

// ============================================================
// OLD PATTERN (SDK 3.x) — For reference only
// ============================================================
/*
import { WalletBuilder } from '@midnight-ntwrk/wallet';

const OLD_initializeWallet = async (seed: string) => {
  const wallet = await WalletBuilder.build(
    'https://indexer.testnet.midnight.network',    // indexerUrl
    'wss://indexer.testnet.midnight.network/ws',   // indexerWSUrl
    'http://localhost:6300',                        // proofServerUrl
    'testnet'                                       // networkId (string)
  );
  await wallet.restoreState(seed);
  return wallet;
};
*/

// ============================================================
// NEW PATTERN (SDK 4.x+)
// ============================================================

import { WalletBuilder } from '@midnight-ntwrk/wallet';
import { NetworkId } from '@midnight-ntwrk/midnight-js-types';

interface MidnightNetworkConfig {
  indexer: string;
  indexerWS: string;
  proofServer: string;
  networkId: NetworkId;
}

const TESTNET_CONFIG: MidnightNetworkConfig = {
  indexer: 'https://indexer.testnet.midnight.network',
  indexerWS: 'wss://indexer.testnet.midnight.network/ws',
  proofServer: 'http://localhost:6300',
  networkId: NetworkId.TestNet,
};

/**
 * Initialize a wallet using the new SDK 4.x+ API.
 *
 * Key changes from 3.x:
 * - Seed is the FIRST argument (not set separately)
 * - Network config is a single options object
 * - NetworkId is an enum, not a string
 *
 * @param seedOrKey - BIP-39 mnemonic phrase or 64-char hex private key
 * @param config - Network configuration (defaults to testnet)
 */
export async function initializeWallet(
  seedOrKey: string,
  config: MidnightNetworkConfig = TESTNET_CONFIG,
) {
  const wallet = await WalletBuilder.build(seedOrKey, config);

  // Wait for wallet to sync with the network
  await wallet.awaitSync();

  console.log('Wallet initialized and synced');
  console.log('Address:', await wallet.address());

  return wallet;
}

/**
 * Example: connecting to event streams using RxJS observables.
 *
 * Old API used callback-based events (wallet.on('event', callback)).
 * New API uses RxJS observables.
 */
export function subscribeToWalletEvents(wallet: any) {
  // Import at the top of your real file:
  // import { filter, map } from 'rxjs';

  // Subscribe to new blocks
  const blockSub = wallet.blocks$.subscribe((block: any) => {
    console.log(`New block #${block.height} at ${new Date().toISOString()}`);
  });

  // Subscribe to balance changes
  const balanceSub = wallet.balance$.subscribe((balance: any) => {
    console.log('Balance updated:', balance);
  });

  // Return unsubscribe functions for cleanup
  return () => {
    blockSub.unsubscribe();
    balanceSub.unsubscribe();
  };
}

// Example usage (for testing outside a framework):
if (require.main === module) {
  const SEED = process.env.MIDNIGHT_WALLET_SEED;
  if (!SEED) {
    console.error('Set MIDNIGHT_WALLET_SEED environment variable');
    process.exit(1);
  }

  initializeWallet(SEED)
    .then(async (wallet) => {
      const cleanup = subscribeToWalletEvents(wallet);

      // Keep running for 60 seconds, then clean up
      setTimeout(() => {
        cleanup();
        wallet.close();
        process.exit(0);
      }, 60_000);
    })
    .catch((err) => {
      console.error('Failed to initialize wallet:', err);
      process.exit(1);
    });
}
