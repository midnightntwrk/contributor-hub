/**
 * Shielded Token — Testnet Deployment Script
 *
 * Prerequisites:
 * - Docker running with midnight-proof-server on port 9300
 * - A funded NIGHT wallet
 *
 * Usage:
 *   npx tsx src/deploy.ts
 */

import { deployContract, NetworkId } from '@midnight-ntwrk/ledger-app';
import { createContract } from './contract/Token';

async function main() {
  console.log('🚀 Deploying Shielded Token contract to testnet...');

  const deployment = await deployContract(createContract, {
    constructor: [],
    networkId: 'testnet' as NetworkId,
    proofServerUrl: 'http://localhost:9300',
  });

  console.log(`✅ Contract deployed at: ${deployment.contractAddress}`);
  console.log(`   Transaction ID: ${deployment.txId}`);
  console.log(`   Block: ${deployment.blockNumber}`);
}

main().catch((err) => {
  console.error('❌ Deployment failed:', err);
  process.exit(1);
});
