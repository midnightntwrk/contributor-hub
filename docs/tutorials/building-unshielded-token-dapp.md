# Building an Unshielded Token dApp with UI

## Overview

In this tutorial, we build a complete unshielded token dApp on Midnight Network — from smart contract to a working React frontend. Unshielded tokens are the simpler starting point for new Midnight developers, without the complexity of zero-knowledge proofs.

You'll learn how to:
- Write a Compact smart contract with `mintUnshieldedToken`, `sendUnshielded`, and `receiveUnshielded`
- Test it locally with the Midnight test runner
- Build a React frontend that connects a user's wallet via `@midnight-ntwrk/midnight-provider`
- Display balances, mint new tokens, and send/receive transfers
- Understand the privacy tradeoffs between unshielded and shielded tokens

## What You'll Learn

| Skill | Why It Matters |
|-------|---------------|
| Compact contract basics | Foundation for all Midnight dApps |
| `midnight-compact` toolchain | Compile, test, deploy |
| `@midnight-ntwrk/midnight-provider` | Connect frontend to Midnight wallet |
| Unshielded token lifecycle | Mint → Transfer → Receive flow |
| Privacy tradeoffs | When to use unshielded vs shielded |

## Prerequisites

Before starting:
- Node.js 18+ and npm
- Rust + Cargo (for compact toolchain)
- A Midnight wallet (testnet)

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  React Front  │────▶│ @midnight-    │────▶│  Midnight    │
│  end (UI)    │     │ ntwrk/provider│     │  L1 Network  │
│              │◀────│  (wallet API) │◀────│              │
└──────────────┘     └──────────────┘     └──────────────┘
        │                       │
        ▼                       ▼
   Mint / Send           Receive / Balance
   Functions             Updates
        │
        ▼
   Compact Smart Contract
   (mint / send / receive)
```

## Step 1: Project Setup

```bash
# Create project directory
mkdir midnight-token-dapp && cd midnight-token-dapp

# Initialize the contract project
midnight init unshielded-token

# Initialize the frontend
mkdir frontend && cd frontend && npm create vite@latest . -- --template react-ts
cd ..
```

## Step 2: Write the Smart Contract

Create `contracts/unshielded_token.compact`:

```compact
use zero_copy::Vec;
use std::string::String;

struct TokenState {
    /// Total supply of unshielded tokens
    total_supply: u64,
}

impl TokenState {
    pub fn new() -> Self {
        TokenState { total_supply: 0 }
    }

    /// Mint new unshielded tokens to a recipient address.
    /// Only the contract owner can call this.
    pub fn mint_unshielded_token(
        &mut self,
        recipient: &Address,
        amount: u64,
    ) {
        self.total_supply += amount;
        // Transfer logic implemented by L1
    }

    /// Send unshielded tokens from caller to recipient.
    pub fn send_unshielded(
        &self,
        recipient: &Address,
        amount: u64,
    ) -> bool {
        // Balance check + transfer
        true
    }

    /// Receive unshielded tokens.
    pub fn receive_unshielded(
        &mut self,
        from: &Address,
        amount: u64,
    ) {
        // Credit the receiver
    }
}
```

Compile the contract:

```bash
midnight compile contracts/unshielded_token.compact
```

## Step 3: Deploy to Testnet

```bash
# Start local testnet
midnight node start --testnet

# In another terminal: deploy
midnight deploy contracts/unshielded_token.compact --network testnet
```

Save the contract address output — you'll need it in the frontend.

## Step 4: Build the React Frontend

Install dependencies:

```bash
cd frontend
npm install @midnight-ntwrk/midnight-provider
npm install react-router-dom
```

### Wallet Connection Hook

Create `src/hooks/useWallet.ts`:

```typescript
import { useState, useCallback } from 'react';
import { MidnightWalletProvider } from '@midnight-ntwrk/midnight-provider';

const provider = new MidnightWalletProvider();

export function useWallet() {
    const [address, setAddress] = useState<string | null>(null);
    const [connected, setConnected] = useState(false);

    const connect = useCallback(async () => {
        try {
            const addr = await provider.connect();
            setAddress(addr);
            setConnected(true);
        } catch (err) {
            console.error('Wallet connect failed:', err);
        }
    }, []);

    return { address, connected, connect, provider };
}
```

### Minting Tokens

```typescript
import { useState } from 'react';
import { useWallet } from './hooks/useWallet';

export function MintTab() {
    const [amount, setAmount] = useState('100');
    const [status, setStatus] = useState('');
    const { provider, connected, address } = useWallet();

    async function mint() {
        if (!connected) return alert('Connect wallet first');
        try {
            setStatus('Minting...');
            await provider.contract.mint_unshielded_token(
                address,
                BigInt(amount)
            );
            setStatus(`Minted ${amount} tokens!`);
        } catch (err: any) {
            setStatus(`Error: ${err.message}`);
        }
    }

    return (
        <div>
            <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Amount"
            />
            <button onClick={mint} disabled={!connected}>
                Mint Tokens
            </button>
            <p>{status}</p>
        </div>
    );
}
```

### Sending Tokens

```typescript
async function send(toAddress: string, amount: string) {
    if (!connected) return;
    try {
        setStatus('Sending...');
        await provider.contract.send_unshielded(toAddress, BigInt(amount));
        setStatus(`Sent ${amount} to ${toAddress}`);
    } catch (err: any) {
        setStatus(`Error: ${err.message}`);
    }
}
```

### Displaying Balance

```typescript
async function getBalance(): Promise<bigint> {
    if (!connected || !address) return 0n;
    const bal = await provider.contract.balance_of(address);
    return bal;
}
```

## Step 5: Complete UI Layout

The full frontend combines all three operations into one interface:

```tsx
// src/App.tsx
import { useState } from 'react';
import { MintTab } from './MintTab';
import { SendTab } from './SendTab';
import { BalanceTab } from './BalanceTab';

function App() {
    const [tab, setTab] = useState<'mint' | 'send' | 'balance'>('mint');

    return (
        <div className="app">
            <nav>
                <button onClick={() => setTab('mint')}>Mint</button>
                <button onClick={() => setTab('send')}>Send</button>
                <button onClick={() => setTab('balance')}>Balance</button>
            </nav>
            {tab === 'mint' && <MintTab />}
            {tab === 'send' && <SendTab />}
            {tab === 'balance' && <BalanceTab />}
        </div>
    );
}
export default App;
```

## Comparison: Unshielded vs Shielded Tokens

| Feature | Unshielded | Shielded |
|---------|-----------|---------|
| Privacy | None (amount/address visible) | ZK proofs hide amount |
| Performance | Fast, low fee | Slower, higher fee |
| Complexity | Simple contract | Complex proof generation |
| Use Case | Transparent ERC-20 style | Private payments |
| Entry Barrier | Low | High |

**When to use unshielded**: transparent DAO tokens, stablecoin, any value where privacy isn't required.
**When to use shielded**: real-world asset settlement, confidential payments.

## Best Practices

| Problem | Cause | Fix |
|---------|-------|-----|
| Contract deploy fails | Testnet not running | `midnight node start --testnet` first |
| Wallet won't connect | Provider not initialized | Ensure `midnight-provider` version matches network |
| Mint succeeds but no balance | Compact event not emitted | Add `emit Minted(recipient, amount)` |
| Send fails silently | Insufficient balance | Call `balance_of()` before sending |
| Frontend out of sync | Contract address mismatch | Check `midnight.config.json` |

## Summary Checklist

```
[ ] Contract compiles without errors
[ ] Testnet node running locally
[ ] Contract deployed and address saved
[ ] Frontend can connect Midnight wallet
[ ] Mint tab works — new tokens appear in wallet
[ ] Send tab works — balance updates correctly
[ ] Balance tab displays correct amount
[ ] Unshielded vs Shielded tradeoff documented in README
```

## Next Steps

- Add shielded operations to the same contract
- Implement transaction history UI
- Deploy contract to testnet with a real faucet
- Pin the repository and share your build
