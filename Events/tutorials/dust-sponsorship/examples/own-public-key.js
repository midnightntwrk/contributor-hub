const { ownPublicKey } = require('midnight-mcp');

function getProverPublicKey() {
  try {
    const publicKey = ownPublicKey();
    return publicKey;
  } catch (error) {
    console.error('Error getting prover public key:', error);
    throw error;
  }
}

module.exports = getProverPublicKey;