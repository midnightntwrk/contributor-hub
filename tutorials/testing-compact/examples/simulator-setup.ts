/**
 * Simulator Setup — Contract simulator initialization helpers
 *
 * Provides a reusable test context with an in-memory ledger,
 * wallet, and contract instance for unit testing.
 */

import { createShieldedLedger } from '@midnight-ntwrk/compact-runtime';

export interface TestContext<T> {
  contract: T;
  ledger: ReturnType<typeof createShieldedLedger>;
  wallet: any;
  cleanup: () => Promise<void>;
}

/**
 * Creates a fresh test context with an in-memory ledger.
 * Each call produces an isolated environment — no shared state.
 */
export async function createTestContext<T>(
  ContractClass: new (opts: any) => T
): Promise<TestContext<T>> {
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
 * Deploys a contract and commits the deployment transaction.
 */
export async function deployContract<T extends { deploy: (...args: any[]) => Promise<any> }>(
  ctx: TestContext<T>,
  ...args: Parameters<T['deploy']>
): Promise<void> {
  const tx = await ctx.contract.deploy(...args);
  await ctx.ledger.commitTransaction(tx);
}

/**
 * Calls a circuit method and commits the resulting transaction.
 */
export async function callCircuit<T>(
  contract: T,
  ledger: any,
  method: (...args: any[]) => Promise<any>,
  ...args: any[]
): Promise<void> {
  const tx = await method(...args);
  await ledger.commitTransaction(tx);
}
