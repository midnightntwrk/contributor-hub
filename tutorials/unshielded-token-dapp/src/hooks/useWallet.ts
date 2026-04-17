// This file is part of contributor-hub.
// Copyright (C) 2025 Midnight Foundation
// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect, useCallback } from 'react';

interface WalletState {
  address: string | null;
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
}

interface UseWalletReturn extends WalletState {
  connect: () => Promise<void>;
  disconnect: () => void;
}

interface MidnightWallet {
  enable: () => Promise<string[]>;
  getAccounts: () => Promise<string[]>;
}

declare global {
  interface Window {
    midnight?: MidnightWallet;
  }
}

/**
 * Custom hook for managing Midnight wallet connection.
 * Handles initial connection check, connection/disconnection flow,
 * and error states.
 */
export function useWallet(): UseWalletReturn {
  const [state, setState] = useState<WalletState>({
    address: null,
    isConnected: false,
    isConnecting: false,
    error: null,
  });

  useEffect(() => {
    const checkConnection = async () => {
      if (typeof window === 'undefined' || !window.midnight) return;
      try {
        const accounts = await window.midnight.getAccounts();
        if (accounts.length > 0) {
          setState({
            address: accounts[0],
            isConnected: true,
            isConnecting: false,
            error: null,
          });
        }
      } catch {
        // No existing connection
      }
    };
    checkConnection();
  }, []);

  const connect = useCallback(async () => {
    setState((prev) => ({ ...prev, isConnecting: true, error: null }));
    try {
      if (!window.midnight) {
        throw new Error('Midnight wallet not found. Please install the Lace browser extension.');
      }
      const accounts = await window.midnight.enable();
      if (accounts.length === 0) {
        throw new Error('No accounts found. Please create an account in your wallet.');
      }
      setState({
        address: accounts[0],
        isConnected: true,
        isConnecting: false,
        error: null,
      });
    } catch (err) {
      setState({
        address: null,
        isConnected: false,
        isConnecting: false,
        error: err instanceof Error ? err.message : 'Failed to connect wallet',
      });
    }
  }, []);

  const disconnect = useCallback(() => {
    setState({ address: null, isConnected: false, isConnecting: false, error: null });
  }, []);

  return { ...state, connect, disconnect };
}

export default useWallet;
