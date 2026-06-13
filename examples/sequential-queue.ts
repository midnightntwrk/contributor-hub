import { Wallet, Transaction } from '@midnight-ntwrk/midnight-js-wallet';
import { createWallet } from '@midnight-ntwrk/midnight-js-wallet';
import { TransactionId } from '@midnight-ntwrk/midnight-js-types';

class SequentialTransactionQueue {
  private wallet: Wallet;
  private queue: Array<() => Promise<TransactionId>> = [];
  private processing = false;

  constructor(wallet: Wallet) {
    this.wallet = wallet;
  }

  async enqueue(txBuilder: (wallet: Wallet) => Promise<TransactionId>): Promise<TransactionId> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const txId = await txBuilder(this.wallet);
          resolve(txId);
          return txId;
        } catch (error) {
          reject(error);
          throw error;
        }
      });
      if (!this.processing) {
        this.processQueue();
      }
    });
  }

  private async processQueue(): Promise<void> {
    this.processing = true;
    while (this.queue.length > 0) {
      const task = this.queue.shift()!;
      await task();
    }
    this.processing = false;
  }
}

async function main() {
  const wallet = await createWallet({ /* wallet config */ });
  const queue = new SequentialTransactionQueue(wallet);

  // Example transactions
  const tx1 = queue.enqueue(async (wallet) => {
    // Build and send transaction 1
    const tx = await wallet.createTransaction({ outputs: [{ value: 10n, address: 'addr1' }] });
    return await wallet.sendTransaction(tx);
  });

  const tx2 = queue.enqueue(async (wallet) => {
    // Build and send transaction 2
    const tx = await wallet.createTransaction({ outputs: [{ value: 20n, address: 'addr2' }] });
    return await wallet.sendTransaction(tx);
  });

  const [id1, id2] = await Promise.all([tx1, tx2]);
  console.log('Transaction IDs:', id1, id2);
}

main().catch(console.error);