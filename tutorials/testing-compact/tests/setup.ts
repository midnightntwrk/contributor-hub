/**
 * Shared test setup and fixtures
 *
 * Provides `beforeEach` / `afterEach` helpers for creating
 * and tearing down test contexts.
 */

import { createShieldedLedger } from '@midnight-ntwrk/compact-runtime';

export interface TestContext {
  contract: any;
  ledger: any;
  wallet: any;
  cleanup: () => Promise<void>;
}

/**
 * Creates a fresh in-memory test context.
 * Each call returns a completely isolated environment.
 */
export async function createContext(ContractClass: any): Promise<TestContext> {
  const ledger = await createShieldedLedger();
  const wallet = await ledger.createWallet();

  const contract = new ContractClass({ ledger, wallet });

  return {
    contract,
    ledger,
    wallet,
    cleanup: async () => {
      await ledger.close();
    },
  };
}

/**
 * Deploys a contract in a test context.
 * Call this in `beforeEach` to set up a clean contract instance.
 */
export async function deployInContext(ctx: TestContext, ...args: any[]): Promise<void> {
  const tx = await ctx.contract.deploy(...args);
  await ctx.ledger.commitTransaction(tx);
}
