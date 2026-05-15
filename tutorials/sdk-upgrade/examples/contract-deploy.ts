/**
 * Example: Contract deployment with the new Midnight SDK 4.x+ API
 *
 * Demonstrates the migration from the old standalone deployContract()
 * utility to the new Contract class + wallet API pattern.
 */

// ============================================================
// OLD PATTERN (SDK 3.x) — For reference only
// ============================================================
/*
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';

async function deployOld(wallet: any, contractModule: any, initialState: any) {
  const contract = await deployContract(wallet, contractModule, initialState);
  return contract.address;
}
*/

// ============================================================
// NEW PATTERN (SDK 4.x+)
// ============================================================

import { Contract } from '@midnight-ntwrk/compact-runtime';

interface DeployOptions {
  initialPrivateState?: Record<string, any>;
  initialPublicState?: Record<string, any>;
  timeout?: number;
}

/**
 * Deploy a Compact contract using the new SDK 4.x+ API.
 *
 * Key changes from 3.x:
 * - Contract is now a first-class runtime object (not a plain module)
 * - Deployment goes through wallet.deployContract()
 * - Private state is provided at deploy time, not restored separately
 *
 * @param wallet - Initialized Midnight wallet instance
 * @param contractModule - Compiled Compact contract module
 * @param options - Deployment options including initial state
 */
export async function deployContract(
  wallet: any,
  contractModule: any,
  options: DeployOptions = {},
) {
  const { initialPrivateState, initialPublicState, timeout = 120_000 } = options;

  // Create a Contract instance from the compiled module
  const contract = new Contract(contractModule);

  // Deploy through the wallet's unified API
  const deployed = await wallet.deployContract(contract, {
    initialPrivateState: initialPrivateState ?? {},
    initialPublicState: initialPublicState ?? {},
  });

  console.log('Contract deployed at:', deployed.address);

  return {
    address: deployed.address,
    contract: deployed,
  };
}

/**
 * Call a method on a deployed contract.
 *
 * In the new SDK, private state is managed automatically by the wallet.
 * You no longer need to manually read/update private state.
 */
export async function callContractMethod(
  deployed: any,
  methodName: string,
  args: any[] = [],
) {
  // Old pattern required passing private state explicitly:
  // const ps = await wallet.getPrivateState(address);
  // const result = await contract.callMethod(method, args, ps);
  // await wallet.updatePrivateState(address, result.newState);

  // New pattern: just call the method
  const result = await deployed.callMethod(methodName, args);

  console.log(`Method ${methodName} returned:`, result);
  return result;
}

// Example: full deployment + interaction flow
export async function exampleDeployAndCall(wallet: any, compiledContract: any) {
  // Deploy with initial state
  const { address, contract } = await deployContract(wallet, compiledContract, {
    initialPrivateState: { counter: 0n },
    initialPublicState: { owner: await wallet.address() },
  });

  // Call a method — private state updates are automatic
  const incrementResult = await callContractMethod(contract, 'increment', []);
  console.log('Counter after increment:', incrementResult);

  // Read current state (debugging / verification)
  const currentState = await contract.privateState();
  console.log('Current private state:', currentState);

  return { address, contract, currentState };
}
