/**
 * Health Check Integration for Midnight Wallet Sync
 *
 * Demonstrates how to wire SyncMonitor into an Express server
 * so that ops teams can monitor wallet sync state via /health.
 *
 * This is the production-ready pattern from the tutorial sections
 * "Practical Monitoring" and "Health Check Endpoint".
 *
 * Usage:
 *   import { SyncMonitor, startServer, performStartupChecks } from './health-check';
 *
 *   const monitor = new SyncMonitor();
 *   await startServer(wallet, monitor);
 */

import { firstValueFrom } from 'rxjs';

// =============================================
// Types
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

// Import waitForWalletSync from the main sync utility
// In production: import { waitForWalletSync } from './wallet-sync';
declare function waitForWalletSync(wallet: Wallet, timeoutMs?: number): Promise<WalletState>;

// =============================================
// SyncMonitor — continuous sync health tracking
// =============================================

interface SyncStatus {
  isSynced: boolean;
  lastSyncTime: Date | null;
  lostSyncCount: number;
}

/**
 * Monitors wallet sync state continuously and provides
 * health status for operational dashboards and probes.
 */
export class SyncMonitor {
  private lastSyncTime: Date | null = null;
  private isSynced = false;
  private lostSyncCount = 0;

  /**
   * Start monitoring a wallet's sync state.
   * Call this once after wallet initialization.
   *
   * @param wallet - The wallet to monitor
   * @param alertCallback - Called when sync is lost
   */
  start(wallet: Wallet, alertCallback?: (msg: string) => void): void {
    wallet.state().subscribe((state: WalletState) => {
      const wasSynced = this.isSynced;
      this.isSynced = state.isSynced;

      if (state.isSynced) {
        this.lastSyncTime = new Date();
      }

      // Alert on sync loss
      if (wasSynced && !state.isSynced) {
        this.lostSyncCount++;
        const msg = 'Wallet lost sync — transactions may fail';
        console.error('[SyncMonitor]', msg);
        alertCallback?.(msg);
      }

      if (!wasSynced && state.isSynced) {
        console.log('[SyncMonitor] Wallet synced at', this.lastSyncTime?.toISOString());
      }
    });
  }

  /**
   * Get the current sync status for health checks.
   */
  getStatus(): SyncStatus {
    return {
      isSynced: this.isSynced,
      lastSyncTime: this.lastSyncTime,
      lostSyncCount: this.lostSyncCount,
    };
  }
}

// =============================================
// Health check endpoints
// =============================================

interface HealthResponse {
  status: 'ok' | 'degraded';
  walletSynced: boolean;
  lastSyncTime: string | null;
  lostSyncCount: number;
}

interface ReadinessResponse {
  ready: boolean;
  walletSynced: boolean;
}

/**
 * Build a health check response object.
 * Use this with any HTTP framework (Express, Fastify, etc.).
 */
export function buildHealthResponse(monitor: SyncMonitor): HealthResponse {
  const status = monitor.getStatus();
  return {
    status: status.isSynced ? 'ok' : 'degraded',
    walletSynced: status.isSynced,
    lastSyncTime: status.lastSyncTime?.toISOString() ?? null,
    lostSyncCount: status.lostSyncCount,
  };
}

/**
 * Build a readiness probe response.
 * Returns ready=false when wallet is not synced,
 * causing load balancers to stop routing traffic.
 */
export function buildReadinessResponse(monitor: SyncMonitor): ReadinessResponse {
  const status = monitor.getStatus();
  return {
    ready: status.isSynced,
    walletSynced: status.isSynced,
  };
}

// =============================================
// Proof server health check
// =============================================

/**
 * Check whether the proof server is reachable.
 * Combine with wallet sync checks for a complete startup sequence.
 *
 * @param proofServerUrl - URL of the proof server
 * @returns true if the proof server responds to health check
 */
export async function checkProofServerHealth(
  proofServerUrl: string = 'http://localhost:6300'
): Promise<boolean> {
  try {
    const response = await fetch(`${proofServerUrl}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// =============================================
// Complete startup sequence
// =============================================

/**
 * Complete startup sequence combining proof-server check
 * with wallet sync. Call this before your server accepts traffic.
 *
 * @param wallet - The wallet instance
 * @param proofServerUrl - URL of the proof server
 * @param syncTimeoutMs - Wallet sync timeout (default: 60s)
 * @returns The synced wallet state
 * @throws If proof server is unreachable or wallet cannot sync
 */
export async function performStartupChecks(
  wallet: Wallet,
  proofServerUrl: string = 'http://localhost:6300',
  syncTimeoutMs: number = 60_000
): Promise<WalletState> {
  // 1. Check proof server
  const proofServerHealthy = await checkProofServerHealth(proofServerUrl);
  if (!proofServerHealthy) {
    throw new Error('Proof server is not reachable at ' + proofServerUrl);
  }
  console.log('[Startup] Proof server healthy');

  // 2. Wait for wallet sync (with DUST bug workaround)
  console.log('[Startup] Waiting for wallet sync...');
  const syncedState = await waitForWalletSync(wallet, syncTimeoutMs);
  console.log('[Startup] Wallet synced:', {
    isSynced: syncedState.isSynced,
    shielded: Object.keys(syncedState.shielded.balances).length + ' tokens',
    unshielded: Object.keys(syncedState.unshielded.balances).length + ' tokens',
    dust: syncedState.dust.totalCoins.toString(),
  });

  return syncedState;
}

// =============================================
// Express integration example
// =============================================

/**
 * Example: Wire health checks into an Express server.
 *
 * Uncomment and adapt for your actual application.
 *
 *   import express from 'express';
 *
 *   async function startServer(wallet: Wallet) {
 *     const monitor = new SyncMonitor();
 *     const app = express();
 *
 *     // 1. Run startup checks
 *     await performStartupChecks(wallet);
 *
 *     // 2. Start continuous monitoring
 *     monitor.start(wallet, (msg) => {
 *       // Replace with your alerting system
 *       console.error('[Alert]', msg);
 *     });
 *
 *     // 3. Health endpoint (for dashboards)
 *     app.get('/health', (_req, res) => {
 *       const health = buildHealthResponse(monitor);
 *       res.status(health.status === 'ok' ? 200 : 503).json(health);
 *     });
 *
 *     // 4. Readiness endpoint (for Kubernetes)
 *     app.get('/ready', (_req, res) => {
 *       const readiness = buildReadinessResponse(monitor);
 *       res.status(readiness.ready ? 200 : 503).json(readiness);
 *     });
 *
 *     // 5. Liveness endpoint (always 200 if process is alive)
 *     app.get('/live', (_req, res) => {
 *       res.status(200).json({ alive: true });
 *     });
 *
 *     app.listen(3000, () => {
 *       console.log('[Server] Ready on port 3000');
 *     });
 *   }
 */
