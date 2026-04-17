// This file is part of contributor-hub.
// Copyright (C) 2025 Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * Token Service - High-level API for UnshieldedTokenManager
 *
 * Provides a clean interface for interacting with the
 * unshielded token contract from the frontend.
 */

/** Contract address type alias */
type ContractAddress = string;

/** Provider interface for Midnight network connection */
export interface MidnightProvider {
  deployContract(config: Record<string, unknown>): Promise<UnshieldedTokenAPI>;
  connectContract(address: ContractAddress): Promise<UnshieldedTokenAPI>;
}

/** Contract API interface */
export interface UnshieldedTokenAPI {
  callMint(to: string, amount: bigint): Promise<boolean>;
  callTransfer(to: string, amount: bigint): Promise<boolean>;
  callApprove(spender: string, amount: bigint): Promise<boolean>;
  callTransferFrom(from: string, to: string, amount: bigint): Promise<boolean>;
  callBalanceOf(account: string): Promise<bigint>;
  callGetTotalSupply(): Promise<bigint>;
  callGetAllowance(owner: string, spender: string): Promise<bigint>;
  callGetName(): Promise<string>;
  callGetSymbol(): Promise<string>;
  callIsPaused(): Promise<boolean>;
  callPause(): Promise<boolean>;
  callUnpause(): Promise<boolean>;
}

/**
 * Token information structure
 */
export interface TokenInfo {
  name: string;
  symbol: string;
  totalSupply: bigint;
  isPaused: boolean;
}

/**
 * Transfer event data
 */
export interface TransferEvent {
  from: string;
  to: string;
  amount: bigint;
  timestamp: number;
}

/**
 * TokenService provides a high-level API for interacting
 * with the UnshieldedTokenManager contract.
 *
 * Usage:
 * ```typescript
 * const service = await TokenService.connect(provider, contractAddress);
 * const balance = await service.balanceOf(walletAddress);
 * await service.transfer(recipient, 100n);
 * ```
 */
export class TokenService {
  private contract: UnshieldedTokenAPI;
  private provider: MidnightProvider;
  private _address: ContractAddress;

  private constructor(
    contract: UnshieldedTokenAPI,
    provider: MidnightProvider,
    address: ContractAddress
  ) {
    this.contract = contract;
    this.provider = provider;
    this._address = address;
  }

  /** Get the contract address */
  get address(): ContractAddress {
    return this._address;
  }

  /**
   * Deploy a new token contract
   *
   * @param provider - Midnight network provider
   * @param name - Token name
   * @param symbol - Token symbol
   * @returns Connected TokenService instance
   */
  static async deploy(
    provider: MidnightProvider,
    name: string,
    symbol: string
  ): Promise<TokenService> {
    const contract = await provider.deployContract({
      name,
      symbol,
    });
    // In a real implementation, we'd get the address from the deploy result
    const address = 'deployed-address';
    return new TokenService(contract, provider, address);
  }

  /**
   * Connect to an existing token contract
   *
   * @param provider - Midnight network provider
   * @param address - Contract address to connect to
   * @returns Connected TokenService instance
   */
  static async connect(
    provider: MidnightProvider,
    address: ContractAddress
  ): Promise<TokenService> {
    const contract = await provider.connectContract(address);
    return new TokenService(contract, provider, address);
  }

  // ─── Token Operations ───────────────────────────────────

  /**
   * Mint new tokens to a recipient (minter only)
   *
   * @param to - Recipient address
   * @param amount - Amount to mint
   * @returns true if successful
   */
  async mint(to: string, amount: bigint): Promise<boolean> {
    return await this.contract.callMint(to, amount);
  }

  /**
   * Transfer tokens to another address
   *
   * @param to - Recipient address
   * @param amount - Amount to transfer
   * @returns true if successful
   */
  async transfer(to: string, amount: bigint): Promise<boolean> {
    return await this.contract.callTransfer(to, amount);
  }

  /**
   * Approve a spender to spend tokens on your behalf
   *
   * @param spender - Address to approve
   * @param amount - Approved amount
   * @returns true if successful
   */
  async approve(spender: string, amount: bigint): Promise<boolean> {
    return await this.contract.callApprove(spender, amount);
  }

  /**
   * Transfer tokens from an approved address
   * Requires prior approval via approve()
   *
   * @param from - Address to transfer from
   * @param to - Recipient address
   * @param amount - Amount to transfer
   * @returns true if successful
   */
  async transferFrom(
    from: string,
    to: string,
    amount: bigint
  ): Promise<boolean> {
    return await this.contract.callTransferFrom(from, to, amount);
  }

  // ─── View Functions ─────────────────────────────────────

  /**
   * Get the balance of an account
   *
   * @param account - Address to check
   * @returns The account balance
   */
  async balanceOf(account: string): Promise<bigint> {
    return await this.contract.callBalanceOf(account);
  }

  /**
   * Get the total token supply
   *
   * @returns Total supply
   */
  async totalSupply(): Promise<bigint> {
    return await this.contract.callGetTotalSupply();
  }

  /**
   * Get the approved allowance for a spender
   *
   * @param owner - Token owner
   * @param spender - Approved spender
   * @returns The approved amount
   */
  async allowance(owner: string, spender: string): Promise<bigint> {
    return await this.contract.callGetAllowance(owner, spender);
  }

  /**
   * Get token metadata
   *
   * @returns Token info object
   */
  async getTokenInfo(): Promise<TokenInfo> {
    const [name, symbol, totalSupply, isPaused] = await Promise.all([
      this.contract.callGetName(),
      this.contract.callGetSymbol(),
      this.contract.callGetTotalSupply(),
      this.contract.callIsPaused(),
    ]);

    return { name, symbol, totalSupply, isPaused };
  }

  // ─── Admin Functions ────────────────────────────────────

  /**
   * Pause the contract (minter only)
   */
  async pause(): Promise<boolean> {
    return await this.contract.callPause();
  }

  /**
   * Unpause the contract (minter only)
   */
  async unpause(): Promise<boolean> {
    return await this.contract.callUnpause();
  }
}

export default TokenService;
