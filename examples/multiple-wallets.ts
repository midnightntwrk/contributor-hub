import { Wallet, Transaction } from '@midnight-ntwrk/midnight-js-wallet';
import { createWallet } from '@midnight-ntwrk/midnight-js-wallet';
import { TransactionId } from '@midnight-ntwrk/midnight-js-types';

async function createWalletWithFunds(seed: string): Promise<Wallet> {
  const wallet = await createWallet({ seed });
  // Simulate funding the wallet with DUST UTXOs
  // In production, this would involve requesting tokens from a faucet or previous transactions
  return wallet;
}

async function concurrentTransactions(): Promise<void> {
  const wallet1 = await createWalletWithFunds('seed1');
  const wallet2 = await createWalletWithFunds('seed2');

  const txPromise1 = wallet1.createTransaction({ outputs: [{ value: 10n, address: 'addr1' }] });
  const txPromise2 = wallet2.createTransaction({ outputs: [{ value: 20n, address: 'addr2' }] });

  const [tx1, tx2] = await Promise.all([txPromise1, txPromise2]);

  const id1 = await wallet1.sendTransaction(tx1);
  const id2 = await wallet2.sendTransaction(tx2);

  console.log('Transaction IDs:', id1, id2);
}

concurrentTransactions().catch(console.error);