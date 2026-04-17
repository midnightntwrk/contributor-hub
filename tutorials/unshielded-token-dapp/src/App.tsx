// This file is part of contributor-hub.
// Copyright (C) 2025 Midnight Foundation
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { useWallet } from './hooks/useWallet';
import { WalletConnect } from './components/WalletConnect';
import { BalanceDisplay } from './components/BalanceDisplay';
import { TokenActions } from './components/TokenActions';
import './styles/app.css';

/**
 * ErrorBanner component
 * 
 * Displays error messages in a styled banner.
 */
function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="error-banner">
      <span>{message}</span>
      <button onClick={onDismiss} className="dismiss-btn">&times;</button>
    </div>
  );
}

/**
 * Main App component
 * 
 * This is the entry point for the Unshielded Token dApp.
 * It manages the overall layout and delegates to child components
 * for wallet connection, balance display, and token operations.
 */
export default function App() {
  const { address, isConnected } = useWallet();

  // In production, these would be connected to the actual contract
  // through the TokenService and useToken hook
  const mockTokenState = {
    balance: 0n,
    symbol: 'UTKN',
    totalSupply: 0n,
    isLoading: false,
    error: null as string | null,
  };

  const handleMint = async (to: string, amount: bigint): Promise<boolean> => {
    console.log(`Mint ${amount} to ${to}`);
    // In production: return await tokenService.mint(to, amount);
    return true;
  };

  const handleTransfer = async (to: string, amount: bigint): Promise<boolean> => {
    console.log(`Transfer ${amount} to ${to}`);
    // In production: return await tokenService.transfer(to, amount);
    return true;
  };

  const handleApprove = async (spender: string, amount: bigint): Promise<boolean> => {
    console.log(`Approve ${amount} for ${spender}`);
    // In production: return await tokenService.approve(spender, amount);
    return true;
  };

  return (
    <div className="app">
      {/* Header */}
      <header className="app-header">
        <div className="logo">
          <h1>Unshielded Token dApp</h1>
          <span className="subtitle">Midnight Network</span>
        </div>
        <WalletConnect />
      </header>

      {/* Main Content */}
      <main className="app-main">
        {/* Error Display */}
        {mockTokenState.error && (
          <ErrorBanner
            message={mockTokenState.error}
            onDismiss={() => {}}
          />
        )}

        {isConnected ? (
          <div className="dashboard">
            {/* Balance Card */}
            <BalanceDisplay
              balance={mockTokenState.balance}
              symbol={mockTokenState.symbol}
              totalSupply={mockTokenState.totalSupply}
              isLoading={mockTokenState.isLoading}
            />

            {/* Token Actions */}
            <TokenActions
              onMint={handleMint}
              onTransfer={handleTransfer}
              onApprove={handleApprove}
              isLoading={mockTokenState.isLoading}
              userAddress={address || ''}
            />

            {/* Info Section */}
            <div className="info-section">
              <h3>About Unshielded Tokens</h3>
              <p>
                Unshielded tokens on Midnight have publicly visible balances
                and transactions. They are ideal for use cases where
                transparency is desired, such as public governance tokens
                or transparent DeFi protocols.
              </p>
              <div className="comparison">
                <div className="comparison-item">
                  <h4>Unshielded</h4>
                  <ul>
                    <li>Public balances</li>
                    <li>Public transactions</li>
                    <li>Lower gas costs</li>
                    <li>Good for governance</li>
                  </ul>
                </div>
                <div className="comparison-item">
                  <h4>Shielded</h4>
                  <ul>
                    <li>Private balances (ZK)</li>
                    <li>Hidden amounts</li>
                    <li>Higher gas costs</li>
                    <li>Good for privacy</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="connect-prompt">
            <div className="prompt-content">
              <h2>Welcome to Midnight</h2>
              <p>
                Connect your wallet to interact with the unshielded token
                contract. You'll be able to mint, transfer, and manage your
                tokens from this dashboard.
              </p>
              <div className="features">
                <div className="feature">
                  <span className="feature-icon">Mint</span>
                  <span>Create new tokens</span>
                </div>
                <div className="feature">
                  <span className="feature-icon">Transfer</span>
                  <span>Send to any address</span>
                </div>
                <div className="feature">
                  <span className="feature-icon">Approve</span>
                  <span>Allow delegated spending</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="app-footer">
        <p>
          Built on{' '}
          <a
            href="https://midnight.network"
            target="_blank"
            rel="noopener noreferrer"
          >
            Midnight Network
          </a>
          {' '}|{' '}
          <a
            href="https://docs.midnight.network"
            target="_blank"
            rel="noopener noreferrer"
          >
            Documentation
          </a>
        </p>
      </footer>
    </div>
  );
}
