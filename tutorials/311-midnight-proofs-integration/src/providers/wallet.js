const { httpClientProofProvider } = require('@midnight-network/http-client-proof-provider');
const config = require('../config/midnight');

class WalletProvider {
  constructor() {
    this.proofProvider = null;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      // Initialize HTTP client proof provider
      this.proofProvider = await httpClientProofProvider({
        url: config.nodeUrl,
        network: config.network,
        timeout: config.proof.timeout,
      });

      this.initialized = true;
      console.log('Wallet provider initialized successfully');
    } catch (error) {
      console.error('Failed to initialize wallet provider:', error);
      throw error;
    }
  }

  getProofProvider() {
    if (!this.initialized) {
      throw new Error('Wallet provider not initialized. Call initialize() first.');
    }
    return this.proofProvider;
  }

  async generateProof(contractCall, inputs) {
    const maxRetries = config.proof.maxRetries;
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Generating proof (attempt ${attempt}/${maxRetries})...`);
        
        const proof = await this.proofProvider.generateProof({
          contractCall,
          inputs,
        });

        console.log('Proof generated successfully');
        return proof;
      } catch (error) {
        lastError = error;
        console.error(`Proof generation failed (attempt ${attempt}):`, error.message);

        if (attempt < maxRetries) {
          // Wait before retrying
          await new Promise(resolve => 
            setTimeout(resolve, config.proof.retryDelay * attempt)
          );
        }
      }
    }

    throw new Error(`Failed to generate proof after ${maxRetries} attempts: ${lastError.message}`);
  }

  async close() {
    if (this.proofProvider) {
      await this.proofProvider.close();
      this.initialized = false;
      console.log('Wallet provider closed');
    }
  }
}

// Singleton instance
const walletProvider = new WalletProvider();

module.exports = walletProvider;
