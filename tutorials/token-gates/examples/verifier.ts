/**
 * TokenGateVerifier - Client-side token gate verification
 * 
 * This module provides a TypeScript interface for interacting with
 * the TokenGate smart contract on the Midnight Network.
 */

import {
  MidnightProvider,
  WalletProvider,
  ContractAddress,
} from '@midnight-ntwrk/midnight-js-sdk';

// Types
export type TokenType = 'fungible' | 'nft' | 'soulbound';

export interface GateRequirement {
  tokenType: TokenType;
  contractAddress: string;
  minimumBalance: bigint;
  tokenIds?: bigint[];
}

export interface OwnershipProof {
  gateId: Uint8Array;
  holder: Uint8Array;
  tokenBalances: bigint[];
  signature: Uint8Array;
  timestamp: bigint;
}

export interface VerificationResult {
  passed: boolean;
  gateId: string;
  holder: string;
  timestamp: number;
  details: string[];
}

export interface GateInfo {
  owner: string;
  requirements: GateRequirement[];
  active: boolean;
  createdAt: number;
  expiresAt: number;
}

/**
 * Main verifier class for interacting with token gates.
 */
export class TokenGateVerifier {
  private contractAddress: ContractAddress;
  private provider: MidnightProvider;
  private wallet: WalletProvider;

  constructor(
    contractAddress: ContractAddress,
    provider: MidnightProvider,
    wallet: WalletProvider
  ) {
    this.contractAddress = contractAddress;
    this.provider = provider;
    this.wallet = wallet;
  }

  /**
   * Create a new token gate with specified requirements.
   */
  async createGate(
    gateId: string,
    requirements: GateRequirement[],
    expiresAt?: Date
  ): Promise<string> {
    const encodedReqs = requirements.map((r) => ({
      tokenType: this.encodeTokenType(r.tokenType),
      contractAddress: this.hexToBytes32(r.contractAddress),
      minimumBalance: r.minimumBalance,
      tokenIds: r.tokenIds ?? [],
    }));

    // Submit transaction to create gate
    const tx = {
      circuit: 'createGate',
      args: [
        this.hexToBytes32(gateId),
        encodedReqs,
        expiresAt ? BigInt(Math.floor(expiresAt.getTime() / 1000)) : 0n,
      ],
    };

    const receipt = await this.provider.submitTransaction(tx);
    return receipt.transactionHash;
  }

  /**
   * Generate and submit an ownership proof for verification.
   */
  async verifyOwnership(gateId: string): Promise<VerificationResult> {
    const address = await this.wallet.getAddress();

    // Build the ownership proof
    const proof = await this.buildOwnershipProof(gateId, address);

    // Submit proof to contract
    const tx = {
      circuit: 'verifyOwnership',
      args: [this.hexToBytes32(gateId), proof],
    };

    const receipt = await this.provider.submitTransaction(tx);

    return {
      passed: true,
      gateId,
      holder: address,
      timestamp: Date.now(),
      details: [`Verification successful. Tx: ${receipt.transactionHash}`],
    };
  }

  /**
   * Check if an address has already passed a gate.
   */
  async checkStatus(gateId: string, address?: string): Promise<boolean> {
    const addr = address ?? (await this.wallet.getAddress());

    const result = await this.provider.queryContract(
      this.contractAddress,
      'getGateStatus',
      [this.hexToBytes32(gateId), this.hexToBytes32(addr)]
    );

    return result as boolean;
  }

  /**
   * Get gate configuration details.
   */
  async getGateInfo(gateId: string): Promise<GateInfo | null> {
    const result = await this.provider.queryContract(
      this.contractAddress,
      'gates',
      [this.hexToBytes32(gateId)]
    );

    if (!result) return null;

    return {
      owner: this.bytes32ToHex(result.owner),
      requirements: result.requirements.map((r: any) => ({
        tokenType: this.decodeTokenType(r.tokenType),
        contractAddress: this.bytes32ToHex(r.contractAddress),
        minimumBalance: r.minimumBalance,
        tokenIds: r.tokenIds,
      })),
      active: result.active,
      createdAt: Number(result.createdAt),
      expiresAt: Number(result.expiresAt),
    };
  }

  // --- Private helpers ---

  private async buildOwnershipProof(
    gateId: string,
    address: string
  ): Promise<OwnershipProof> {
    const tokenBalances = await this.queryAllBalances(gateId, address);
    const timestamp = BigInt(Math.floor(Date.now() / 1000));

    const message = this.buildSignatureMessage(gateId, timestamp);
    const signature = await this.wallet.signMessage(message);

    return {
      gateId: this.hexToBytes32(gateId),
      holder: this.hexToBytes32(address),
      tokenBalances,
      signature: this.hexToBytes64(signature),
      timestamp,
    };
  }

  private async queryAllBalances(
    gateId: string,
    address: string
  ): Promise<bigint[]> {
    const gateInfo = await this.getGateInfo(gateId);
    if (!gateInfo) throw new Error('Gate not found');

    const balances: bigint[] = [];
    for (const req of gateInfo.requirements) {
      const balance = await this.queryTokenBalance(req.contractAddress, address);
      balances.push(balance);
    }

    return balances;
  }

  private async queryTokenBalance(
    tokenAddress: string,
    holderAddress: string
  ): Promise<bigint> {
    const result = await this.provider.queryContract(
      tokenAddress as ContractAddress,
      'balanceOf',
      [this.hexToBytes32(holderAddress)]
    );
    return BigInt(result ?? 0);
  }

  private buildSignatureMessage(gateId: string, timestamp: bigint): Uint8Array {
    const encoder = new TextEncoder();
    return encoder.encode(`${gateId}|${timestamp.toString()}`);
  }

  private encodeTokenType(type: TokenType): number {
    const map: Record<TokenType, number> = {
      fungible: 0,
      nft: 1,
      soulbound: 2,
    };
    return map[type];
  }

  private decodeTokenType(code: number): TokenType {
    const map: Record<number, TokenType> = {
      0: 'fungible',
      1: 'nft',
      2: 'soulbound',
    };
    return map[code] ?? 'fungible';
  }

  private hexToBytes32(hex: string): Uint8Array {
    const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
    return Uint8Array.from(Buffer.from(clean.padStart(64, '0'), 'hex'));
  }

  private hexToBytes64(hex: string): Uint8Array {
    const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
    return Uint8Array.from(Buffer.from(clean.padStart(128, '0'), 'hex'));
  }

  private bytes32ToHex(bytes: Uint8Array): string {
    return '0x' + Buffer.from(bytes).toString('hex');
  }
}
