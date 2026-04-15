require('dotenv').config();

module.exports = {
  network: process.env.MIDNIGHT_NETWORK || 'testnet',
  nodeUrl: process.env.MIDNIGHT_NODE_URL,
  wallet: {
    privateKey: process.env.WALLET_PRIVATE_KEY,
  },
  proof: {
    timeout: 30000, // 30 seconds
    maxRetries: 3,
    retryDelay: 1000, // 1 second
  },
  server: {
    port: process.env.PORT || 3000,
    nodeEnv: process.env.NODE_ENV || 'development',
  },
};
