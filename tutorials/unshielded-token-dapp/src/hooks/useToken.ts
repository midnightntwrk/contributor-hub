// This file is part of contributor-hub.
// Copyright (C) 2025 Midnight Foundation
// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect, useCallback } from 'react';
import { TokenService, TokenInfo } from '../tokenService';

interface TokenState {
  balance: bigint;
  tokenInfo: TokenInfo | null;
  isLoading: boolean;
  error: string | null;
}

interface UseTokenReturn extends TokenState {
  mint: (to: string, amount: bigint) => Promise<boolean>;
  transfer: (to: string, amount: bigint) => Promise<boolean>;
  approve: (spender: string, amount: bigint) => Promise<boolean>;
  transferFrom: (from: string, to: string, amount: bigint) => Promise<boolean>;
  refresh: () => Promise<void>;
}

/**
 * Custom hook for interacting with the token contract.
 * Manages balance state and provides action functions for
 * mint, transfer, approve, and transferFrom operations.
 */
export function useToken(
  service: TokenService | null,
  address: string | null
): UseTokenReturn {
  const [state, setState] = useState<TokenState>({
    balance: 0n,
    tokenInfo: null,
    isLoading: false,
    error: null,
  });

  const refresh = useCallback(async () => {
    if (!service || !address) return;
    setState((s) => ({ ...s, isLoading: true }));
    try {
      const [balance, tokenInfo] = await Promise.all([
        service.balanceOf(address),
        service.getTokenInfo(),
      ]);
      setState({ balance, tokenInfo, isLoading: false, error: null });
    } catch (err) {
      setState((s) => ({
        ...s,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to fetch data',
      }));
    }
  }, [service, address]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 10000);
    return () => clearInterval(interval);
  }, [refresh]);

  const mint = useCallback(
    async (to: string, amount: bigint) => {
      if (!service) return false;
      setState((s) => ({ ...s, isLoading: true, error: null }));
      try {
        const result = await service.mint(to, amount);
        await refresh();
        return result;
      } catch (err) {
        setState((s) => ({
          ...s,
          isLoading: false,
          error: err instanceof Error ? err.message : 'Mint failed',
        }));
        return false;
      }
    },
    [service, refresh]
  );

  const transfer = useCallback(
    async (to: string, amount: bigint) => {
      if (!service) return false;
      setState((s) => ({ ...s, isLoading: true, error: null }));
      try {
        const result = await service.transfer(to, amount);
        await refresh();
        return result;
      } catch (err) {
        setState((s) => ({
          ...s,
          isLoading: false,
          error: err instanceof Error ? err.message : 'Transfer failed',
        }));
        return false;
      }
    },
    [service, refresh]
  );

  const approve = useCallback(
    async (spender: string, amount: bigint) => {
      if (!service) return false;
      setState((s) => ({ ...s, isLoading: true, error: null }));
      try {
        const result = await service.approve(spender, amount);
        await refresh();
        return result;
      } catch (err) {
        setState((s) => ({
          ...s,
          isLoading: false,
          error: err instanceof Error ? err.message : 'Approve failed',
        }));
        return false;
      }
    },
    [service, refresh]
  );

  const transferFrom = useCallback(
    async (from: string, to: string, amount: bigint) => {
      if (!service) return false;
      setState((s) => ({ ...s, isLoading: true, error: null }));
      try {
        const result = await service.transferFrom(from, to, amount);
        await refresh();
        return result;
      } catch (err) {
        setState((s) => ({
          ...s,
          isLoading: false,
          error: err instanceof Error ? err.message : 'TransferFrom failed',
        }));
        return false;
      }
    },
    [service, refresh]
  );

  return { ...state, mint, transfer, approve, transferFrom, refresh };
}

export default useToken;
