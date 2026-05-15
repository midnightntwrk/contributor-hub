/**
 * Circuit Helpers — Utility functions for calling circuits in tests
 *
 * Wraps common patterns: deploy, call, query, and assert.
 */

export interface CircuitResult {
  success: boolean;
  error?: string;
  blockHeight: number;
}

/**
 * Deploys a contract and returns the block height after deployment.
 */
export async function deployAndGetHeight(
  contract: { deploy: (...args: any[]) => Promise<any> },
  ledger: { commitTransaction: (tx: any) => Promise<any>; getBlockHeight: () => Promise<number> },
  ...deployArgs: any[]
): Promise<number> {
  const tx = await contract.deploy(...deployArgs);
  await ledger.commitTransaction(tx);
  return ledger.getBlockHeight();
}

/**
 * Calls a circuit, commits the transaction, and returns whether
 * the block height advanced (indicating successful commit).
 */
export async function callAndVerify(
  ledger: { commitTransaction: (tx: any) => Promise<any>; getBlockHeight: () => Promise<number> },
  circuitCall: Promise<any>
): Promise<CircuitResult> {
  const heightBefore = await ledger.getBlockHeight();

  try {
    const tx = await circuitCall;
    await ledger.commitTransaction(tx);
    const heightAfter = await ledger.getBlockHeight();

    return {
      success: heightAfter > heightBefore,
      blockHeight: heightAfter,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message,
      blockHeight: heightBefore,
    };
  }
}

/**
 * Asserts that a circuit call throws with a specific error message.
 */
export async function expectCircuitError(
  circuitCall: Promise<any>,
  expectedMessage?: string
): Promise<void> {
  try {
    await circuitCall;
    throw new Error('Expected circuit to throw, but it succeeded');
  } catch (err: any) {
    if (expectedMessage && !err.message.includes(expectedMessage)) {
      throw new Error(
        `Expected error containing "${expectedMessage}", got: "${err.message}"`
      );
    }
  }
}
