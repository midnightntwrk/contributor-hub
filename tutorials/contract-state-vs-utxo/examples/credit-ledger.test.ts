// This file is part of contributor-hub.
// Copyright (C) 2025 Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * Credit Ledger — Contract-State Accounting Test Harness
 *
 * This file demonstrates how to interact with the credit-ledger.compact
 * contract from TypeScript. It shows the full lifecycle: deploy,
 * credit accounts, transfer between accounts, and query balances.
 *
 * Key difference from the token vault: no UTXO operations.
 * All balances are stored in the contract's Map ledger field.
 *
 * Usage:
 *   npx ts-node examples/credit-ledger.test.ts
 *
 * Prerequisites:
 * - Midnight toolchain installed
 * - Local devnet running (or testnet access)
 * - A funded wallet (for transaction fees, not for the credits)
 */

import { Contract } from '@midnight-ntwrk/compact-runtime';

// =============================================
// Types
// =============================================

interface WalletState {
  isSynced: boolean;
  shielded: { balances: Record<string, bigint> };
  unshielded: { balances: Record<string, bigint> };
  address: string;
}

interface Providers {
  wallet: {
    submitTransaction(tx: any): Promise<{ txHash: string }>;
    state(): any;
  };
  contract: {
    getState(address: string): Promise<any>;
  };
}

interface DeployedContract {
  address: string;
  callTx: {
    credit(account: string, amount: bigint): Promise<any>;
    debit(account: string, amount: bigint): Promise<any>;
    transferCredits(recipient: string, amount: bigint): Promise<any>;
    getBalance(account: string): Promise<bigint>;
    getTotalOps(): Promise<bigint>;
    getAccountCount(): Promise<bigint>;
  };
  deploy(providers: Providers): Promise<any>;
}

// =============================================
// Helper: wait for wallet sync
// =============================================

async function waitForSync(wallet: any, timeoutMs: number = 30_000): Promise<WalletState> {
  const { firstValueFrom } = await import('rxjs');
  const { filter, timeout, catchError } = await import('rxjs/operators');
  const { of } = await import('rxjs');

  try {
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

    const currentState = await firstValueFrom(wallet.state());
    console.warn(`[Sync] Timeout after ${timeoutMs}ms. Proceeding with partial sync.`);
    return currentState;
  } catch (err) {
    throw new Error(`Wallet sync failed: ${err}`);
  }
}

// =============================================
// Deploy the credit ledger
// =============================================

async function deployCreditLedger(providers: Providers): Promise<DeployedContract> {
  console.log('=== Deploying Credit Ledger ===');

  const state = await waitForSync(providers.wallet);
  console.log('Wallet synced:', state.isSynced);

  // In a real setup, import the compiled contract module:
  //   import { contractModule } from '../contracts/credit-ledger/contract/index.js';
  // const contract = new Contract(contractModule);
  // const deployTx = await contract.deploy(providers);
  // const receipt = await providers.wallet.submitTransaction(deployTx);

  console.log('Credit ledger deployed at: <contract-address>');
  console.log('Admin set to deployer public key');

  // Placeholder — replace with actual contract instance
  return {} as DeployedContract;
}

// =============================================
// Credit an account
// =============================================

async function creditAccount(
  providers: Providers,
  contract: DeployedContract,
  account: string,
  amount: bigint
): Promise<void> {
  console.log(`\n=== Crediting Account: ${account.slice(0, 16)}... with ${amount} ===`);

  // This is a pure state update — no tokens move.
  // The admin calls credit(), which updates the Map.
  // No receiveShielded/sendShielded involved.

  // const tx = await contract.callTx.credit(account, amount);
  // const receipt = await providers.wallet.submitTransaction(tx);

  console.log('Credit TX: <tx-hash>');

  // Query the balance back
  // const balance = await contract.callTx.getBalance(account);
  // console.log('New balance:', balance.toString());

  console.log('Note: No real tokens were minted or transferred.');
  console.log('The balance exists only in the contract state Map.');
}

// =============================================
// Transfer credits between accounts
// =============================================

async function transferCredits(
  providers: Providers,
  contract: DeployedContract,
  recipient: string,
  amount: bigint
): Promise<void> {
  console.log(`\n=== Transferring ${amount} credits to ${recipient.slice(0, 16)}... ===`);

  // Pure arithmetic on the Map — sender's balance decreases,
  // recipient's balance increases. No UTXO operations.

  // const tx = await contract.callTx.transferCredits(recipient, amount);
  // const receipt = await providers.wallet.submitTransaction(tx);

  console.log('Transfer TX: <tx-hash>');

  console.log('Note: This transfer is internal to the contract.');
  console.log('Neither party sees this in their wallet balance.');
}

// =============================================
// Query balances
// =============================================

async function queryBalances(
  providers: Providers,
  contract: DeployedContract,
  accounts: string[]
): Promise<void> {
  console.log('\n=== Querying Balances ===');

  for (const account of accounts) {
    // const balance = await contract.callTx.getBalance(account);
    // console.log(`${account.slice(0, 16)}...: ${balance}`);
    console.log(`${account.slice(0, 16)}...: <balance>`);
  }

  // const totalOps = await contract.callTx.getTotalOps();
  // const accountCount = await contract.callTx.getAccountCount();
  console.log('Total operations: <count>');
  console.log('Unique accounts: <count>');

  console.log('\nNote: All these queries read from on-chain ledger state.');
  console.log('Anyone on the network can perform these queries.');
  console.log('The balances are NOT private.');
}

// =============================================
// Main: run the full lifecycle
// =============================================

async function main() {
  console.log('Credit Ledger — Contract-State Accounting Example');
  console.log('==================================================\n');

  console.log('This example demonstrates the ledger-state approach:');
  console.log('- No real tokens move — balances are pure bookkeeping');
  console.log('- All data stored in contract Map (public on-chain)');
  console.log('- Credits cannot be seen in wallets or traded on DEXes');
  console.log('- Cheaper and faster than UTXO operations\n');

  // In a real setup, initialize providers and run:
  //   const providers = await initializeProviders();
  //   const contract = await deployCreditLedger(providers);
  //
  //   // Admin credits accounts
  //   await creditAccount(providers, contract, aliceAddress, 1000n);
  //   await creditAccount(providers, contract, bobAddress, 500n);
  //
  //   // User transfers credits
  //   await transferCredits(providers, contract, bobAddress, 200n);
  //
  //   // Query all balances
  //   await queryBalances(providers, contract, [aliceAddress, bobAddress]);

  console.log('To run this example with a live devnet:');
  console.log('1. Install Midnight toolchain');
  console.log('2. Start local devnet');
  console.log('3. Fund a wallet (for TX fees only — credits are not real tokens)');
  console.log('4. Compile credit-ledger.compact');
  console.log('5. Uncomment the provider/contract calls above');
  console.log('6. Run: npx ts-node examples/credit-ledger.test.ts');
}

main().catch(console.error);
