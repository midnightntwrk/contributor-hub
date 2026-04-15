const walletProvider = require('../providers/wallet');
const config = require('../config/midnight');

class ProofService {
  constructor() {
    this.pendingProofs = new Map();
  }

  async generateContractProof(contractAddress, method, args) {
    try {
      // Validate inputs
      this.validateInputs(contractAddress, method, args);

      // Generate proof using wallet provider
      const proof = await walletProvider.generateProof(method, {
        contractAddress,
        args,
      });

      // Store proof metadata
      const proofId = this.storeProofMetadata(proof, contractAddress, method);

      return {
        success: true,
        proofId,
        proof,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error('Proof service error:', error);
      throw this.handleError(error);
    }
  }

  validateInputs(contractAddress, method, args) {
    if (!contractAddress || typeof contractAddress !== 'string') {
      throw new Error('Invalid contract address');
    }

    if (!method || typeof method !== 'string') {
      throw new Error('Invalid method name');
    }

    if (!Array.isArray(args)) {
      throw new Error('Arguments must be an array');
    }
  }

  storeProofMetadata(proof, contractAddress, method) {
    const proofId = `proof_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    this.pendingProofs.set(proofId, {
      contractAddress,
      method,
      createdAt: Date.now(),
      status: 'generated',
    });

    // Clean up old proofs after 1 hour
    setTimeout(() => {
      this.pendingProofs.delete(proofId);
    }, 3600000);

    return proofId;
  }

  getProofStatus(proofId) {
    const proof = this.pendingProofs.get(proofId);
    if (!proof) {
      return { exists: false };
    }

    return {
      exists: true,
      ...proof,
      age: Date.now() - proof.createdAt,
    };
  }

  handleError(error) {
    // Categorize errors for better client handling
    if (error.message.includes('timeout')) {
      error.type = 'PROOF_TIMEOUT';
      error.retryable = true;
    } else if (error.message.includes('network')) {
      error.type = 'NETWORK_ERROR';
      error.retryable = true;
    } else if (error.message.includes('invalid')) {
      error.type = 'INVALID_INPUT';
      error.retryable = false;
    } else {
      error.type = 'UNKNOWN_ERROR';
      error.retryable = false;
    }

    return error;
  }
}

module.exports = new ProofService();
