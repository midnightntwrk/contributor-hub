// This file is part of contributor-hub.
// Copyright (C) 2025 Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");

/**
 * PrivateAMM Client - TypeScript integration layer for the Private AMM contract.
 *
 * Handles shielding/unshielding of values, transaction construction,
 * and interaction with the Midnight Compact runtime.
 */

import {
  CompactRuntime,
  Transaction,
} from '@midnight-ntwrk/compact-runtime';
import { Wallet } from '@midnight-ntwrk/wallet-sdk';

// ─── Types ───

export interface SwapResult {
  amountOut: bigint;
  txHash: string;
}

export interface PoolState {
  reserveA: bigint;
  reserveB: bigint;
  totalLpSupply: bigint;
}

// ─── Client Class ───

export class PrivateAMMClient {
  private runtime: CompactRuntime;
  private wallet: Wallet;
  private contractAddress: string;
  private tokenA: string;
  private tokenB: string;

  constructor(
    runtime: CompactRuntime,
    wallet: Wallet,
    contractAddress: string,
    tokenA: string,
    tokenB: string,
  ) {
    this.runtime = runtime;
    this.wallet = wallet;
    this.contractAddress = contractAddress;
    this.tokenA = tokenA;
    this.tokenB = tokenB;
  }

  /**
   * Initialize a new liquidity pool.
   */
  async initializePool(
    amountA: bigint,
    amountB: bigint,
  ): Promise<{ txHash: string; lpTokens: bigint }> {
    const tx = new Transaction(this.contractAddress);
    tx.call('initialize', [amountA, amountB]);
    tx.transfer(this.tokenA, amountA);
    tx.transfer(this.tokenB, amountB);

    const result = await this.runtime.submitTransaction(tx);
    const lpTokens = result.returnValue as bigint;

    console.log(`Pool initialized! LP tokens minted: ${lpTokens}`);
    return { txHash: result.txHash, lpTokens };
  }

  /**
   * Execute a private swap. Amount and identity are shielded.
   */
  async swap(amountIn: bigint, tokenInIsA: boolean): Promise<SwapResult> {
    const shieldedAmount = await this.wallet.shield(amountIn);
    const userSecret = await this.wallet.getShieldingSecret();

    const tx = new Transaction(this.contractAddress);
    tx.call('swap', [shieldedAmount, tokenInIsA, userSecret]);

    const result = await this.runtime.submitTransaction(tx);
    const shieldedOutput = result.returnValue as Uint8Array;
    const amountOut = await this.wallet.unshield(shieldedOutput);

    console.log(`Swapped ${amountIn} -> ${amountOut} (${tokenInIsA ? 'A->B' : 'B->A'})`);
    return { amountOut, txHash: result.txHash };
  }

  /**
   * Add liquidity privately. LP position is shielded.
   */
  async addLiquidity(
    amountA: bigint,
    amountB: bigint,
    userIndex: number,
  ): Promise<bigint> {
    const shieldedA = await this.wallet.shield(amountA);
    const shieldedB = await this.wallet.shield(amountB);
    const secret = await this.wallet.getShieldingSecret();

    const tx = new Transaction(this.contractAddress);
    tx.call('add_liquidity', [shieldedA, shieldedB, userIndex, secret]);
    tx.transfer(this.tokenA, amountA);
    tx.transfer(this.tokenB, amountB);

    const result = await this.runtime.submitTransaction(tx);
    const lpReceived = await this.wallet.unshield(result.returnValue as Uint8Array);

    console.log(`Added liquidity, received ${lpReceived} LP tokens`);
    return lpReceived;
  }

  /**
   * Remove liquidity privately.
   */
  async removeLiquidity(
    lpAmount: bigint,
    userIndex: number,
  ): Promise<[bigint, bigint]> {
    const shieldedLP = await this.wallet.shield(lpAmount);
    const secret = await this.wallet.getShieldingSecret();

    const tx = new Transaction(this.contractAddress);
    tx.call('remove_liquidity', [shieldedLP, userIndex, secret]);

    const result = await this.runtime.submitTransaction(tx);
    const [shieldedA, shieldedB] = result.returnValue as [Uint8Array, Uint8Array];

    const amountA = await this.wallet.unshield(shieldedA);
    const amountB = await this.wallet.unshield(shieldedB);

    console.log(`Removed liquidity: ${amountA} A, ${amountB} B`);
    return [amountA, amountB];
  }

  /**
   * Get current pool reserves (transparent).
   */
  async getPoolState(): Promise<PoolState> {
    const tx = new Transaction(this.contractAddress);
    tx.call('get_pool_info', []);
    const result = await this.runtime.submitTransaction(tx);
    const [reserveA, reserveB, totalLp] = result.returnValue as [bigint, bigint, bigint];
    return { reserveA, reserveB, totalLpSupply: totalLp };
  }

  /**
   * Estimate swap output locally (no transaction needed).
   */
  async estimateSwap(amountIn: bigint, tokenInIsA: boolean): Promise<bigint> {
    const { reserveA, reserveB } = await this.getPoolState();
    const feeBps = 30n;
    const amountInAfterFee = amountIn * (10000n - feeBps) / 10000n;

    if (tokenInIsA) {
      const k = reserveA * reserveB;
      const newReserveA = reserveA + amountInAfterFee;
      const newReserveB = k / newReserveA;
      return reserveB - newReserveB;
    } else {
      const k = reserveA * reserveB;
      const newReserveB = reserveB + amountInAfterFee;
      const newReserveA = k / newReserveB;
      return reserveA - newReserveA;
    }
  }

  /**
   * Calculate price impact for a given trade.
   */
  async priceImpact(amountIn: bigint, tokenInIsA: boolean): Promise<number> {
    const { reserveA, reserveB } = await this.getPoolState();
    const spotPrice = tokenInIsA
      ? Number(reserveB) / Number(reserveA)
      : Number(reserveA) / Number(reserveB);

    const estimated = await this.estimateSwap(amountIn, tokenInIsA);
    const executionPrice = tokenInIsA
      ? Number(estimated) / Number(amountIn)
      : Number(estimated) / Number(amountIn);

    return Math.abs(executionPrice - spotPrice) / spotPrice;
  }

  /**
   * Swap with slippage protection.
   */
  async swapWithSlippage(
    amountIn: bigint,
    tokenInIsA: boolean,
    maxSlippageBps: bigint = 50n, // 0.5%
  ): Promise<SwapResult> {
    const estimated = await this.estimateSwap(amountIn, tokenInIsA);
    const minOut = estimated * (10000n - maxSlippageBps) / 10000n;

    const result = await this.swap(amountIn, tokenInIsA);

    if (result.amountOut < minOut) {
      throw new Error(
        `Slippage too high: got ${result.amountOut}, expected min ${minOut}`,
      );
    }

    return result;
  }
}
