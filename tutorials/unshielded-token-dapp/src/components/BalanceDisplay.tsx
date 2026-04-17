// This file is part of contributor-hub.
// Copyright (C) 2025 Midnight Foundation
// SPDX-License-Identifier: Apache-2.0

import React from 'react';

interface BalanceDisplayProps {
  balance: bigint;
  symbol: string;
  totalSupply: bigint;
  isLoading: boolean;
}

/**
 * BalanceDisplay component
 * 
 * Shows the user's token balance and total supply
 * with loading states.
 */
export function BalanceDisplay({ balance, symbol, totalSupply, isLoading }: BalanceDisplayProps) {
  return (
    <div className="balance-card">
      <h2>Your Balance</h2>
      {isLoading ? (
        <div className="loading-skeleton">
          <div className="skeleton-amount" />
          <div className="skeleton-text" />
        </div>
      ) : (
        <>
          <div className="balance-amount">
            <span className="amount">{balance.toString()}</span>
            <span className="symbol">{symbol}</span>
          </div>
          <div className="supply-info">
            <span>Total Supply: {totalSupply.toString()} {symbol}</span>
          </div>
        </>
      )}
    </div>
  );
}

export default BalanceDisplay;
