const walletProvider = require('../providers/wallet');

class TransactionService {
  constructor() {
    this.pendingTransactions = new Map();
  }

  async submitTransaction(proof, contractCall) {
    try {
      console.log('Submitting transaction...');

      const txHash = await walletProvider.getProofProvider().submitTransaction({
        proof,
        contractCall,
      });

      console.log('Transaction submitted:', txHash);

      // Store transaction metadata
      const txId = this.storeTransactionMetadata(txHash, proof, contractCall);

      return {
        success: true,
        txHash,
        txId,
        status: 'pending',
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error('Transaction submission error:', error);
      throw this.handleError(error);
    }
  }

  storeTransactionMetadata(txHash, proof, contractCall) {
    const txId = `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    this.pendingTransactions.set(txId, {
      txHash,
      contractCall,
      submittedAt: Date.now(),
      status: 'pending',
    });

    return txId;
  }

  async getTransactionStatus(txId) {
    const tx = this.pendingTransactions.get(txId);
    if (!tx) {
      return { exists: false };
    }

    // In a real implementation, you would query the blockchain
    // to get the actual transaction status
    const status = await this.queryBlockchainStatus(tx.txHash);

    return {
      exists: true,
      ...tx,
      ...status,
      age: Date.now() - tx.submittedAt,
    };
  }

  async queryBlockchainStatus(txHash) {
    // Placeholder for blockchain status query
    // In production, implement actual blockchain query
    return {
      status: 'pending', // 'pending' | 'confirmed' | 'failed'
      confirmations: 0,
      blockNumber: null,
    };
  }

  handleError(error) {
    if (error.message.includes('timeout')) {
      error.type = 'TX_TIMEOUT';
      error.retryable = true;
    } else if (error.message.includes('network')) {
      error.type = 'NETWORK_ERROR';
      error.retryable = true;
    } else if (error.message.includes('insufficient')) {
      error.type = 'INSUFFICIENT_FUNDS';
      error.retryable = false;
    } else {
      error.type = 'TX_UNKNOWN_ERROR';
      error.retryable = false;
    }

    return error;
  }
}

module.exports = new TransactionService();
