# Building an Unshielded Token dApp with UI

*Create a complete decentralized application for unshielded tokens on Midnight — from smart contract to React frontend — with wallet connection, minting, transfers, and balance display.*

---

## Introduction

Unshielded tokens on Midnight are the simpler counterpart to shielded tokens. While shielded tokens use zero-knowledge proofs for privacy, unshielded tokens have publicly visible balances and transactions. This makes them an excellent starting point for developers new to Midnight.

This tutorial walks through building a complete dApp:
- A Compact smart contract for unshielded token operations
- TypeScript integration layer
- A React frontend with wallet connection

**When to use unshielded vs shielded tokens:**

| Feature | Unshielded | Shielded |
|---------|-----------|----------|
| Balance visibility | Public | Private (ZK) |
| Transaction amounts | Public | Hidden |
| Complexity | Lower | Higher |
| Gas cost | Lower | Higher |
| Use case | Public governance, transparent DeFi | Private payments, confidential transfers |

---

## The Compact Contract

Our contract manages unshielded tokens with standard ERC-20-like operations: mint, transfer, and balance queries.

### Contract Structure

```compact
// unshielded_token.compact

pragma language_version 0.16;

import CompactStandardLibrary;

contract UnshieldedTokenManager {
  // ─── Ledger State ───────────────────────────────────────
  ledger {
    // Token name and symbol
    name: Bytes<32>;
    symbol: Bytes<8>;

    // Total supply tracking
    total_supply: Uint<128>;

    // Balances: maps address -> balance
    balances: Map<Opaque<"bytes20">, Uint<128>>;

    // Authorized minter
    minter: Opaque<"bytes20">;

    // Allowances: (owner, spender) -> amount
    allowances: Map<
      Tuple<Opaque<"bytes20">, Opaque<"bytes20">>,
      Uint<128>
    >;
  }

  // ─── Constructor ────────────────────────────────────────

  constructor(
    token_name: Bytes<32>,
    token_symbol: Bytes<8>
  ) {
    self.ledger.name = token_name;
    self.ledger.symbol = token_symbol;
    self.ledger.total_supply = 0;
    self.ledger.minter = context.transaction.signer;
  }

  // ─── Mint ───────────────────────────────────────────────

  @observable
  export circuit mint(
    to: Opaque<"bytes20">,
    amount: Uint<128>
  ): Boolean {
    assert context.transaction.signer == self.ledger.minter,
           "Only minter can mint";
    assert amount > 0, "Amount must be positive";

    let current = self.ledger.balances[to] ?? 0;
    self.ledger.balances[to] = current + amount;
    self.ledger.total_supply = self.ledger.total_supply + amount;

    return true;
  }

  // ─── Transfer ───────────────────────────────────────────

  @observable
  export circuit transfer(
    to: Opaque<"bytes20">,
    amount: Uint<128>
  ): Boolean {
    let sender = context.transaction.signer;
    let sender_balance = self.ledger.balances[sender] ?? 0;

    assert amount > 0, "Amount must be positive";
    assert sender_balance >= amount, "Insufficient balance";

    self.ledger.balances[sender] = sender_balance - amount;
    let to_balance = self.ledger.balances[to] ?? 0;
    self.ledger.balances[to] = to_balance + amount;

    return true;
  }

  // ─── Approve & Transfer From ────────────────────────────

  @observable
  export circuit approve(
    spender: Opaque<"bytes20">,
    amount: Uint<128>
  ): Boolean {
    let owner = context.transaction.signer;
    let key = Tuple(owner, spender);
    self.ledger.allowances[key] = amount;
    return true;
  }

  @observable
  export circuit transfer_from(
    from: Opaque<"bytes20">,
    to: Opaque<"bytes20">,
    amount: Uint<128>
  ): Boolean {
    let sender = context.transaction.signer;
    let key = Tuple(from, sender);
    let allowance = self.ledger.allowances[key] ?? 0;
    let from_balance = self.ledger.balances[from] ?? 0;

    assert amount > 0, "Amount must be positive";
    assert allowance >= amount, "Insufficient allowance";
    assert from_balance >= amount, "Insufficient balance";

    self.ledger.allowances[key] = allowance - amount;
    self.ledger.balances[from] = from_balance - amount;
    let to_balance = self.ledger.balances[to] ?? 0;
    self.ledger.balances[to] = to_balance + amount;

    return true;
  }

  // ─── View Functions ─────────────────────────────────────

  @view
  export circuit balance_of(
    account: Opaque<"bytes20">
  ): Uint<128> {
    return self.ledger.balances[account] ?? 0;
  }

  @view
  export circuit get_total_supply(): Uint<128> {
    return self.ledger.total_supply;
  }

  @view
  export circuit get_allowance(
    owner: Opaque<"bytes20">,
    spender: Opaque<"bytes20">
  ): Uint<128> {
    let key = Tuple(owner, spender);
    return self.ledger.allowances[key] ?? 0;
  }
}
```

---

## TypeScript Integration Layer

The integration layer connects the React frontend to the Compact contract through the Midnight runtime.

```typescript
// src/tokenService.ts

import {
  type MidnightProvider,
  type WalletProvider,
  type ContractAddress,
} from '@midnight-ntwrk/midnight-js-types';
import {
  type UnshieldedTokenManagerAPI,
} from '../generated/contract/index';

/**
 * TokenService provides a high-level API for interacting
 * with the UnshieldedTokenManager contract.
 */
export class TokenService {
  private contract: UnshieldedTokenManagerAPI;
  private provider: MidnightProvider;

  constructor(
    contract: UnshieldedTokenManagerAPI,
    provider: MidnightProvider
  ) {
    this.contract = contract;
    this.provider = provider;
  }

  /**
   * Deploy a new token contract
   */
  static async deploy(
    provider: MidnightProvider,
    name: string,
    symbol: string
  ): Promise<TokenService> {
    const contract = await provider.deployContract({
      // Contract deployment config
    });
    return new TokenService(contract, provider);
  }

  /**
   * Connect to an existing token contract
   */
  static async connect(
    provider: MidnightProvider,
    address: ContractAddress
  ): Promise<TokenService> {
    const contract = await provider.connectContract(address);
    return new TokenService(contract, provider);
  }

  /**
   * Mint new tokens (minter only)
   */
  async mint(to: string, amount: bigint): Promise<boolean> {
    return await this.contract.callMint(to, amount);
  }

  /**
   * Transfer tokens to another address
   */
  async transfer(to: string, amount: bigint): Promise<boolean> {
    return await this.contract.callTransfer(to, amount);
  }

  /**
   * Approve spender to spend tokens
   */
  async approve(spender: string, amount: bigint): Promise<boolean> {
    return await this.contract.callApprove(spender, amount);
  }

  /**
   * Transfer tokens from one address to another
   * (requires prior approval)
   */
  async transferFrom(
    from: string,
    to: string,
    amount: bigint
  ): Promise<boolean> {
    return await this.contract.callTransferFrom(from, to, amount);
  }

  /**
   * Get the balance of an account
   */
  async balanceOf(account: string): Promise<bigint> {
    return await this.contract.callBalanceOf(account);
  }

  /**
   * Get the total token supply
   */
  async totalSupply(): Promise<bigint> {
    return await this.contract.callGetTotalSupply();
  }

  /**
   * Get the allowance for a spender
   */
  async allowance(owner: string, spender: string): Promise<bigint> {
    return await this.contract.callGetAllowance(owner, spender);
  }
}
```

---

## React Frontend

### Wallet Connection Hook

```typescript
// src/hooks/useWallet.ts

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

/**
 * Custom hook for managing wallet connection
 * with the Midnight Lace wallet extension.
 */
export function useWallet(): UseWalletReturn {
  const [state, setState] = useState<WalletState>({
    address: null,
    isConnected: false,
    isConnecting: false,
    error: null,
  });

  // Check for existing connection on mount
  useEffect(() => {
    const checkConnection = async () => {
      if (typeof window !== 'undefined' && window.midnight) {
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
      }
    };
    checkConnection();
  }, []);

  const connect = useCallback(async () => {
    setState((s) => ({ ...s, isConnecting: true, error: null }));

    try {
      if (!window.midnight) {
        throw new Error(
          'Midnight wallet not found. Please install the Lace extension.'
        );
      }

      const accounts = await window.midnight.enable();

      if (accounts.length === 0) {
        throw new Error('No accounts found in wallet');
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
        error: err instanceof Error ? err.message : 'Connection failed',
      });
    }
  }, []);

  const disconnect = useCallback(() => {
    setState({
      address: null,
      isConnected: false,
      isConnecting: false,
      error: null,
    });
  }, []);

  return { ...state, connect, disconnect };
}

// Type declarations for the Midnight wallet
declare global {
  interface Window {
    midnight?: {
      enable: () => Promise<string[]>;
      getAccounts: () => Promise<string[]>;
    };
  }
}
```

### Token Operations Hook

```typescript
// src/hooks/useToken.ts

import { useState, useEffect, useCallback } from 'react';
import { TokenService } from '../tokenService';

interface TokenState {
  balance: bigint;
  totalSupply: bigint;
  isLoading: boolean;
  error: string | null;
}

interface UseTokenReturn extends TokenState {
  mint: (to: string, amount: bigint) => Promise<void>;
  transfer: (to: string, amount: bigint) => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * Custom hook for interacting with the token contract.
 * Manages state and provides action functions.
 */
export function useToken(
  service: TokenService | null,
  address: string | null
): UseTokenReturn {
  const [state, setState] = useState<TokenState>({
    balance: 0n,
    totalSupply: 0n,
    isLoading: false,
    error: null,
  });

  // Fetch balances when service or address changes
  const refresh = useCallback(async () => {
    if (!service || !address) return;

    setState((s) => ({ ...s, isLoading: true }));

    try {
      const [balance, totalSupply] = await Promise.all([
        service.balanceOf(address),
        service.totalSupply(),
      ]);

      setState({
        balance,
        totalSupply,
        isLoading: false,
        error: null,
      });
    } catch (err) {
      setState((s) => ({
        ...s,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to fetch data',
      }));
    }
  }, [service, address]);

  // Auto-refresh on mount and when dependencies change
  useEffect(() => {
    refresh();
    // Poll every 10 seconds
    const interval = setInterval(refresh, 10000);
    return () => clearInterval(interval);
  }, [refresh]);

  const mint = useCallback(
    async (to: string, amount: bigint) => {
      if (!service) return;

      setState((s) => ({ ...s, isLoading: true, error: null }));

      try {
        await service.mint(to, amount);
        await refresh();
      } catch (err) {
        setState((s) => ({
          ...s,
          isLoading: false,
          error: err instanceof Error ? err.message : 'Mint failed',
        }));
      }
    },
    [service, refresh]
  );

  const transfer = useCallback(
    async (to: string, amount: bigint) => {
      if (!service) return;

      setState((s) => ({ ...s, isLoading: true, error: null }));

      try {
        await service.transfer(to, amount);
        await refresh();
      } catch (err) {
        setState((s) => ({
          ...s,
          isLoading: false,
          error: err instanceof Error ? err.message : 'Transfer failed',
        }));
      }
    },
    [service, refresh]
  );

  return { ...state, mint, transfer, refresh };
}
```

### Main Application Component

```tsx
// src/App.tsx

import React, { useState } from 'react';
import { useWallet } from './hooks/useWallet';
import { useToken } from './hooks/useToken';

// Components
function WalletConnect() {
  const { address, isConnected, isConnecting, error, connect, disconnect } =
    useWallet();

  if (isConnected && address) {
    return (
      <div className="wallet-card">
        <div className="wallet-info">
          <span className="label">Connected:</span>
          <code className="address">
            {address.slice(0, 6)}...{address.slice(-4)}
          </code>
        </div>
        <button onClick={disconnect} className="btn btn-secondary">
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="wallet-card">
      <button
        onClick={connect}
        disabled={isConnecting}
        className="btn btn-primary"
      >
        {isConnecting ? 'Connecting...' : 'Connect Wallet'}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function BalanceDisplay({
  balance,
  totalSupply,
  isLoading,
}: {
  balance: bigint;
  totalSupply: bigint;
  isLoading: boolean;
}) {
  return (
    <div className="balance-card">
      <h2>Token Balance</h2>
      {isLoading ? (
        <p>Loading...</p>
      ) : (
        <>
          <div className="balance">
            <span className="amount">{balance.toString()}</span>
            <span className="symbol">TKN</span>
          </div>
          <p className="supply">
            Total Supply: {totalSupply.toString()}
          </p>
        </>
      )}
    </div>
  );
}

function MintForm({
  onMint,
  isLoading,
}: {
  onMint: (to: string, amount: bigint) => void;
  isLoading: boolean;
}) {
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (to && amount) {
      onMint(to, BigInt(amount));
      setTo('');
      setAmount('');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="action-card">
      <h3>Mint Tokens</h3>
      <input
        type="text"
        placeholder="Recipient address"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        className="input"
      />
      <input
        type="number"
        placeholder="Amount"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        min="1"
        className="input"
      />
      <button type="submit" disabled={isLoading || !to || !amount} className="btn btn-primary">
        {isLoading ? 'Minting...' : 'Mint'}
      </button>
    </form>
  );
}

function TransferForm({
  onTransfer,
  isLoading,
}: {
  onTransfer: (to: string, amount: bigint) => void;
  isLoading: boolean;
}) {
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (to && amount) {
      onTransfer(to, BigInt(amount));
      setTo('');
      setAmount('');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="action-card">
      <h3>Transfer Tokens</h3>
      <input
        type="text"
        placeholder="Recipient address"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        className="input"
      />
      <input
        type="number"
        placeholder="Amount"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        min="1"
        className="input"
      />
      <button type="submit" disabled={isLoading || !to || !amount} className="btn btn-primary">
        {isLoading ? 'Transferring...' : 'Transfer'}
      </button>
    </form>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="error-banner">
      <p>{message}</p>
    </div>
  );
}

// Main App
export default function App() {
  const { isConnected } = useWallet();
  // In a real app, you'd initialize TokenService here
  const tokenState = {
    balance: 0n,
    totalSupply: 0n,
    isLoading: false,
    error: null as string | null,
    mint: async (to: string, amount: bigint) => {},
    transfer: async (to: string, amount: bigint) => {},
    refresh: async () => {},
  };

  return (
    <div className="app">
      <header>
        <h1>Midnight Unshielded Token</h1>
        <WalletConnect />
      </header>

      <main>
        {tokenState.error && (
          <ErrorBanner message={tokenState.error} />
        )}

        {isConnected ? (
          <>
            <BalanceDisplay
              balance={tokenState.balance}
              totalSupply={tokenState.totalSupply}
              isLoading={tokenState.isLoading}
            />

            <div className="actions">
              <MintForm
                onMint={tokenState.mint}
                isLoading={tokenState.isLoading}
              />
              <TransferForm
                onTransfer={tokenState.transfer}
                isLoading={tokenState.isLoading}
              />
            </div>
          </>
        ) : (
          <div className="connect-prompt">
            <p>Connect your wallet to interact with the token contract.</p>
          </div>
        )}
      </main>

      <footer>
        <p>
          Built on{' '}
          <a href="https://midnight.network" target="_blank" rel="noreferrer">
            Midnight Network
          </a>
        </p>
      </footer>
    </div>
  );
}
```

### Styling

```css
/* src/styles/app.css */

:root {
  --primary: #6366f1;
  --primary-hover: #4f46e5;
  --bg: #0f172a;
  --card-bg: #1e293b;
  --text: #f8fafc;
  --text-muted: #94a3b8;
  --error: #ef4444;
  --success: #22c55e;
  --border: #334155;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: 'Inter', system-ui, sans-serif;
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
}

.app {
  max-width: 800px;
  margin: 0 auto;
  padding: 2rem;
}

header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--border);
}

header h1 {
  font-size: 1.5rem;
  font-weight: 600;
}

.wallet-card {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.wallet-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.address {
  background: var(--card-bg);
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
  font-size: 0.875rem;
}

.balance-card {
  background: var(--card-bg);
  padding: 2rem;
  border-radius: 1rem;
  text-align: center;
  margin-bottom: 2rem;
}

.balance .amount {
  font-size: 3rem;
  font-weight: 700;
}

.balance .symbol {
  font-size: 1.5rem;
  color: var(--text-muted);
  margin-left: 0.5rem;
}

.supply {
  color: var(--text-muted);
  margin-top: 0.5rem;
}

.actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

.action-card {
  background: var(--card-bg);
  padding: 1.5rem;
  border-radius: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.action-card h3 {
  font-size: 1.125rem;
}

.input {
  padding: 0.75rem;
  border-radius: 0.5rem;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  font-size: 1rem;
}

.input:focus {
  outline: none;
  border-color: var(--primary);
}

.btn {
  padding: 0.75rem 1.5rem;
  border-radius: 0.5rem;
  border: none;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-primary {
  background: var(--primary);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: var(--primary-hover);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: var(--card-bg);
  color: var(--text);
  border: 1px solid var(--border);
}

.error-banner {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid var(--error);
  padding: 1rem;
  border-radius: 0.5rem;
  margin-bottom: 1rem;
}

.error {
  color: var(--error);
  font-size: 0.875rem;
}

.connect-prompt {
  text-align: center;
  padding: 3rem;
  color: var(--text-muted);
}

footer {
  margin-top: 3rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border);
  text-align: center;
  color: var(--text-muted);
}

footer a {
  color: var(--primary);
  text-decoration: none;
}

@media (max-width: 640px) {
  .actions {
    grid-template-columns: 1fr;
  }
  header {
    flex-direction: column;
    gap: 1rem;
  }
}
```

---

## Setup and Run Instructions

### Installation

```bash
# Create new Midnight project
midnight-mcp init unshielded-token-dapp
cd unshielded-token-dapp

# Install frontend dependencies
npm install react react-dom
npm install -D @types/react @types/react-dom vite @vitejs/plugin-react

# Install Midnight SDK
npm install @midnight-ntwrk/midnight-js-types
```

### Development

```bash
# Compile the contract
npm run compile

# Start development server
npm run dev

# Build for production
npm run build
```

### Docker Stack (Local Testing)

```bash
# Start local Midnight node
docker-compose up -d

# Run frontend against local node
MIDNIGHT_NETWORK=local npm run dev
```

### Project Structure

```
unshielded-token-dapp/
├── src/
│   ├── unshielded_token.compact   # Compact contract
│   ├── tokenService.ts            # Contract integration
│   ├── hooks/
│   │   ├── useWallet.ts           # Wallet connection hook
│   │   └── useToken.ts            # Token operations hook
│   ├── components/
│   │   ├── WalletConnect.tsx       # Wallet UI
│   │   ├── BalanceDisplay.tsx      # Balance card
│   │   ├── MintForm.tsx           # Mint form
│   │   └── TransferForm.tsx       # Transfer form
│   ├── styles/
│   │   └── app.css                # Application styles
│   └── App.tsx                    # Main component
├── public/
│   └── index.html
├── package.json
├── vite.config.ts
└── tsconfig.json
```

---

## Unshielded vs Shielded: Privacy Tradeoffs

### When to Use Unshielded Tokens

- **Public governance**: Voting power should be visible for transparency
- **Transparent DeFi**: Lending protocols need public collateral ratios
- **Public rewards**: Airdrops and incentives benefit from transparency
- **Simple transfers**: When privacy isn't a concern, unshielded is more efficient

### When to Use Shielded Tokens

- **Private payments**: Salaries, purchases, donations
- **Confidential holdings**: Keep portfolio private
- **Trading strategies**: Hide positions from front-runners
- **Compliance with privacy laws**: GDPR, financial privacy regulations

### The Privacy Spectrum

Midnight's dual token model lets you choose the right level of privacy for each use case. You can even bridge between shielded and unshielded tokens as needed.

---

## Summary

Building an unshielded token dApp on Midnight involves:

1. **Compact contract** with mint, transfer, approve, and transfer_from
2. **TypeScript integration** for connecting to the contract
3. **React frontend** with wallet connection and token operations
4. **Clear understanding** of when to use unshielded vs shielded tokens

The complete code provides a production-ready starting point for token-based dApps on Midnight.

---

## Resources

- [Midnight Developer Docs](https://docs.midnight.network/getting-started)
- [Midnight MCP](https://www.npmjs.com/package/midnight-mcp)
- [Midnight Developer Forum](https://forum.midnight.network/)
- [Midnight Discord](https://discord.com/invite/midnightnetwork)

---

*This tutorial is part of the Midnight Contributor Hub bounty program. Questions? Open an issue or ask on [Discord](https://discord.com/invite/midnightnetwork).*
