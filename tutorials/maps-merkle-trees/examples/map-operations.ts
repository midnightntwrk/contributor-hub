/**
 * Map Operations - TypeScript Client for Midnight Network
 * Demonstrates interaction with Compact contracts that use Maps.
 * Prerequisites: npm install @midnight-ntwrk/compact-runtime
 */

import { CompactRuntime, Field, Uint64, Bytes32 } from '@midnight-ntwrk/compact-runtime';

interface TokenInfo {
  name: string;
  symbol: string;
  totalSupply: bigint;
  decimals: number;
  issuer: Uint8Array;
}

interface TokenRegistryState {
  tokens: Map<string, TokenInfo>;
  registered: Map<string, boolean>;
  tokenCount: number;
}

class MapOperations {
  private runtime: CompactRuntime;
  private contractAddress: string;

  constructor(runtime: CompactRuntime, contractAddress: string) {
    this.runtime = runtime;
    this.contractAddress = contractAddress;
  }

  async registerToken(tokenId: Uint8Array, info: TokenInfo, adminKey: Uint8Array): Promise<boolean> {
    console.log(`Registering token: ${info.name} (${info.symbol})`);
    const result = await this.runtime.invokeCircuit(this.contractAddress, 'register_token', [tokenId, info, adminKey]);
    console.log(`Token registered: ${result}`);
    return result as boolean;
  }

  async isRegistered(tokenId: Uint8Array): Promise<boolean> {
    const result = await this.runtime.invokeCircuit(this.contractAddress, 'is_registered', [tokenId]);
    return result as boolean;
  }

  async getTokenInfo(tokenId: Uint8Array): Promise<TokenInfo> {
    const result = await this.runtime.invokeCircuit(this.contractAddress, 'get_token_info', [tokenId]);
    return result as TokenInfo;
  }

  async mint(tokenId: Uint8Array, to: Uint8Array, amount: bigint, adminKey: Uint8Array): Promise<boolean> {
    console.log(`Minting ${amount} tokens to account`);
    const result = await this.runtime.invokeCircuit(this.contractAddress, 'mint', [tokenId, to, amount, adminKey]);
    return result as boolean;
  }

  async transfer(tokenId: Uint8Array, from: Uint8Array, to: Uint8Array, amount: bigint): Promise<boolean> {
    console.log(`Transferring ${amount} tokens`);
    const result = await this.runtime.invokeCircuit(this.contractAddress, 'transfer', [tokenId, from, to, amount]);
    return result as boolean;
  }

  async getBalance(tokenId: Uint8Array, account: Uint8Array): Promise<bigint> {
    const result = await this.runtime.invokeCircuit(this.contractAddress, 'get_balance', [tokenId, account]);
    return result as bigint;
  }

  async getTokenCount(): Promise<number> {
    const result = await this.runtime.invokeCircuit(this.contractAddress, 'get_token_count', []);
    return result as number;
  }
}

async function main() {
  console.log('=== Midnight Network Map Operations ===\n');

  const runtime = new CompactRuntime({ nodeUrl: 'http://localhost:9944' });
  const contractAddress = '0x...'; // Replace with actual deployed address
  const mapOps = new MapOperations(runtime, contractAddress);

  const toBytes32 = (hex: string): Uint8Array => {
    return Uint8Array.from(Buffer.from(hex.padEnd(64, '0'), 'hex'));
  };

  const adminKey = toBytes32('admin_key_heretokenId = toBytes32('token_001');
  const tokenInfo: TokenInfo = {
    name: 'Midnight Token',
    symbol: 'MNT',
    totalSupply: 1000000000n,
    decimals: 18,
    issuer: adminKey,
  };

  await mapOps.registerToken(tokenId, tokenInfo, adminKey);
  console.log('Token registered\n');

  const isRegistered = await mapOps.isRegistered(tokenId);
  console.log(`Token registered: ${isRegistered}`);

  const info = await mapOps.getTokenInfo(tokenId);
  console.log(`Token: ${info.name} (${info.symbol}), Supply: ${info.totalSupply}\n`);

  const recipient = toBytes32('recipient_001');
  await mapOps.mint(tokenId, recipient, 1000n, adminKey);
  console.log('Minted 1000 tokens\n');

  const balance = await mapOps.getBalance(tokenId, recipient);
  console.log(`Recipient balance: ${balance}`);

  const recipient2 = toBytes32('recipient_002');
  await mapOps.transfer(tokenId, recipient, recipient2, 500n);
  console.log('Transferred 500 tokens\n');

  const b1 = await mapOps.getBalance(tokenId, recipient);
  const b2 = await mapOps.getBalance(tokenId, recipient2);
  console.log(`Recipient 1: ${b1}, Recipient 2: ${b2}`);

  const count = await mapOps.getTokenCount();
  console.log(`\nTotal tokens registered: ${count}`);
  console.log('\n=== Map Operations Complete ===');
}

if (require.main === module) {
  main().catch(console.error);
}

export { MapOperations, TokenInfo, TokenRegistryState };
