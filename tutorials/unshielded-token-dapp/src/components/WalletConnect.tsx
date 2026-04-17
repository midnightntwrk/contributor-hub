// This file is part of contributor-hub.
// Copyright (C) 2025 Midnight Foundation
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { useWallet } from '../hooks/useWallet';

/**
 * WalletConnect component
 * 
 * Displays wallet connection status and provides
 * connect/disconnect functionality.
 */
export function WalletConnect() {
  const { address, isConnected, isConnecting, error, connect, disconnect } =
    useWallet();

  if (isConnected && address) {
    return (
      <div className="wallet-card">
        <div className="wallet-status">
          <span className="status-dot connected" />
          <span className="label">Connected</span>
        </div>
        <code className="address">
          {address.slice(0, 6)}...{address.slice(-4)}
        </code>
        <button onClick={disconnect} className="btn btn-secondary">
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="wallet-card">
      <button onClick={connect} disabled={isConnecting} className="btn btn-primary">
        {isConnecting ? (
          <>
            <span className="spinner" />
            Connecting...
          </>
        ) : (
          'Connect Wallet'
        )}
      </button>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

export default WalletConnect;
