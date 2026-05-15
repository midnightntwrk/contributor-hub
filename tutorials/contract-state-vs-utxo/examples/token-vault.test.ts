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
 * Token Vault — UTXO-Layer Shielded Token Test Harness
 *
 * This file demonstrates how to interact with the token-vault.compact
 * contract from TypeScript. It shows the full lifecycle: deploy,
 * deposit shielded tokens, query state, and withdraw.
 *
 * Usage:
 *   npx ts-node examples/token-vault.test.ts
 *
 * Prerequisites:
 * - Midnight toolchain installed
 * - Local devnet running (or testnet access)
 * - A funded wallet
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
    deposit(): Promise<any>;
    withdraw(amount: bigint, color: string): Promise<any>;
    getDepositCount(): Promise<bigint>;
    getWithdrawalCount(): Promise<bigint>;
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

    // Timeout fallback — proceed with partial sync
    const currentState = await firstValueFrom(wallet.state());
    console.warn(`[Sync] Timeout after ${timeoutMs}ms. Proceeding with partial sync.`);
    return currentState;
  } catch (err) {
    throw new Error(`Wallet sync failed: ${err}`);
  }
}

// =============================================
// Deploy the token vault
// =============================================

async function deployVault(providers: Providers): Promise<DeployedContract> {
  console.log('=== Deploying Token Vault ===');

  // Wait for wallet to sync before deploying
  const state = await waitForSync(providers.wallet);
  console.log('Wallet synced:', state.isSynced);
  console.log('Shielded balances:', state.shielded.balances);

  // Deploy the contract
  // In a real setup, import the compiled contract module:
  //   import { contractModule } from '../contracts/token-vault/contract/index.js';
  // const contract = new Contract(contractModule);
  // const deployTx = await contract.deploy(providers);
  // const receipt = await providers.wallet.submitTransaction(deployTx);

  console.log('Vault deployed at: <contract-address>');
  console.log('Owner set to deployer public key');

  // Placeholder — replace with actual contract instance
  return {} as DeployedContract;
}

// =============================================
// Deposit shielded tokens
// =============================================

async function depositTokens(
  providers: Providers,
  contract: DeployedContract
): Promise<void> {
  console.log('\n=== Depositing Shielded Tokens ===');

  // The wallet automatically selects shielded UTXOs to attach
  // to the transaction. The contract calls receiveShielded()
  // which proves the coin is valid and locks it to the contract.

  // const tx = await contract.callTx.deposit();
  // const receipt = await providers.wallet.submitTransaction(tx);

  console.log('Deposit TX: <tx-hash>');

  // Query the deposit count from contract state
  // const depositCount = await contract.callTx.getDepositCount();
  // console.log('Total deposits:', depositCount.toString());

  console.log('Note: The deposited tokens now live on the UTXO ledger,');
  console.log('locked to the contract address. They are NOT stored');
  console.log('inside the contract state — only the deposit count is.');
}

// =============================================
// Withdraw tokens
// =============================================

async function withdrawTokens(
  providers: Providers,
  contract: DeployedContract,
  amount: bigint,
  color: string
): Promise<void> {
  console.log('\n=== Withdrawing Tokens (Owner Only) ===');

  // The contract verifies the caller is the owner,
  // then calls sendShielded() to create a new UTXO
  // output locked to the owner's address.

  // const tx = await contract.callTx.withdraw(amount, color);
  // const receipt = await providers.wallet.submitTransaction(tx);

  console.log(`Withdraw TX: <tx-hash>`);
  console.log(`Amount: ${amount}, Color: ${color}`);

  // After sync, the owner's wallet will see the new UTXO
  // and include it in their shielded balance.
}

// =============================================
// Main: run the full lifecycle
// =============================================

async function main() {
  console.log('Token Vault — UTXO-Layer Shielded Token Example');
  console.log('================================================\n');

  console.log('This example demonstrates the UTXO approach:');
  console.log('- Real tokens flow in and out via receiveShielded/sendShielded');
  console.log('- Tokens live on the UTXO ledger, not in contract state');
  console.log('- Contract state only tracks metadata (deposit count)');
  console.log('- Shielded tokens are private (encrypted amounts)\n');

  // In a real setup, initialize providers:
  //   const providers = await initializeProviders();
  // Then run the lifecycle:
  //   const contract = await deployVault(providers);
  //   await depositTokens(providers, contract);
  //   await withdrawTokens(providers, contract, 1000n, '0x...token-color');

  console.log('To run this example with a live devnet:');
  console.log('1. Install Midnight toolchain');
  console.log('2. Start local devnet');
  console.log('3. Fund a wallet');
  console.log('4. Compile token-vault.compact');
  console.log('5. Uncomment the provider/contract calls above');
  console.log('6. Run: npx ts-node examples/token-vault.test.ts');
}

main().catch(console.error);
