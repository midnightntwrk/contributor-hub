// This file is part of contributor-hub.
// Copyright (C) 2025 Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");

/**
 * Usage example: Private AMM on Midnight
 *
 * Demonstrates pool creation, private swaps, and LP management.
 */

import { PrivateAMMClient } from './amm-client';
import { CompactRuntime } from '@midnight-ntwrk/compact-runtime';
import { Wallet } from '@midnight-ntwrk/wallet-sdk';

async function main() {
  console.log('=== Private AMM on Midnight ===\n');

  // 1. Setup
  const runtime = await CompactRuntime.connect('testnet');
  const wallet = await Wallet.loadOrCreate('./wallet.json');

  const TOKEN_A = '0xTokenAAddress';
  const TOKEN_B = '0xTokenBAddress';
  const CONTRACT = '0xDeployedContractAddress';

  const amm = new PrivateAMMClient(runtime, wallet, CONTRACT, TOKEN_A, TOKEN_B);

  // 2. Create pool (1:1 initial price)
  console.log('--- Creating Pool ---');
  const { txHash: initHash, lpTokens } = await amm.initializePool(
    1_000_000n,
    1_000_000n,
  );
  console.log(`TX: ${initHash}`);
  console.log(`LP tokens: ${lpTokens}\n`);

  // 3. Estimate and execute a private swap
  console.log('--- Private Swap (A -> B) ---');
  const estimated = await amm.estimateSwap(10_000n, true);
  console.log(`Estimated output: ${estimated}`);

  const { amountOut, txHash: swapHash } = await amm.swap(10_000n, true);
  console.log(`Actual output:   ${amountOut}`);
  console.log(`TX: ${swapHash}`);
  console.log('Swap amount and trader are HIDDEN on-chain\n');

  // 4. Check pool state (transparent)
  console.log('--- Pool State ---');
  const { reserveA, reserveB, totalLpSupply } = await amm.getPoolState();
  console.log(`Reserve A: ${reserveA}`);
  console.log(`Reserve B: ${reserveB}`);
  console.log(`Total LP:  ${totalLpSupply}`);
  console.log(`Price:     ${Number(reserveB) / Number(reserveA)}\n`);

  // 5. Add liquidity (private LP position)
  console.log('--- Add Liquidity ---');
  const userIndex = 0;
  const lpReceived = await amm.addLiquidity(500_000n, 500_000n, userIndex);
  console.log(`LP received: ${lpReceived}\n`);

  // 6. Check price impact
  console.log('--- Price Impact ---');
  const impact = await amm.priceImpact(100_000n, true);
  console.log(`Price impact for 100k swap: ${(impact * 100).toFixed(4)}%\n`);

  // 7. Swap with slippage protection
  console.log('--- Swap with Slippage Protection ---');
  try {
    const result = await amm.swapWithSlippage(50_000n, false, 100n);
    console.log(`Output: ${result.amountOut} (slippage OK)`);
  } catch (e) {
    console.log(`Swap rejected: ${(e as Error).message}`);
  }

  // 8. Remove liquidity (private)
  console.log('\n--- Remove Liquidity ---');
  const [withdrawnA, withdrawnB] = await amm.removeLiquidity(
    lpReceived / 2n,
    userIndex,
  );
  console.log(`Withdrew: ${withdrawnA} A, ${withdrawnB} B`);

  console.log('\n=== Done ===');
}

main().catch(console.error);
