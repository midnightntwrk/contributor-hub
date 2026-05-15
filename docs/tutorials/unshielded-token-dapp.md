# Building an Unshielded Token dApp with UI

> **Difficulty:** Intermediate | **Estimated Time:** 45 minutes

## Overview

This tutorial walks you through building an unshielded token dApp with a working React frontend. Unshielded tokens are the simpler entry point for new Midnight contributors compared to shielded tokens.

## When to Use Unshielded vs Shielded Tokens

| Feature | Unshielded | Shielded |
|---------|-----------|----------|
| Privacy | Public balances | Private balances |
| Complexity | Lower | Higher |
| Use Case | Testing, simple transfers | Privacy-sensitive apps |
| ZK Proofs | Not required | Required |

## Prerequisites

- Node.js 18+
- Midnight SDK installed
- A Midnight wallet (testnet)

## Step 1: Mint Unshielded Tokens

```typescript
import { mintUnshieldedToken } from '@midnight-ntwrk/midnight-js';

async function mintTokens(amount: number) {
  const result = await mintUnshieldedToken({
    amount,
    tokenName: 'MyToken',
    recipient: wallet.address(),
  });
  console.log('Minted:', result.transactionHash);
  return result;
}
```

## Step 2: Transfer Unshielded Tokens

```typescript
import { sendUnshielded } from '@midnight-ntwrk/midnight-js';

async function transferTokens(to: string, amount: number) {
  const result = await sendUnshielded({
    recipient: to,
    amount,
    tokenName: 'MyToken',
  });
  console.log('Transferred:', result.transactionHash);
  return result;
}
```

## Step 3: Receive Unshielded Tokens

```typescript
import { receiveUnshielded } from '@midnight-ntwrk/midnight-js';

async function receiveTokens() {
  const result = await receiveUnshielded({
    tokenName: 'MyToken',
  });
  return result;
}
```

## Step 4: React Frontend

```tsx
import React, { useState, useEffect } from 'react';
import { Connection, Wallet } from '@midnight-ntwrk/midnight-js';

export function TokenDApp() {
  const [balance, setBalance] = useState(0);
  const [mintAmount, setMintAmount] = useState('');
  const [transferTo, setTransferTo] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [wallet, setWallet] = useState(null);

  useEffect(() => {
    // Connect wallet on mount
    connectWallet();
  }, []);

  async function connectWallet() {
    const w = await Wallet.connect();
    setWallet(w);
    refreshBalance(w);
  }

  async function refreshBalance(w) {
    const bal = await w.getBalance('MyToken');
    setBalance(bal);
  }

  async function handleMint() {
    await mintUnshieldedToken({
      amount: Number(mintAmount),
      tokenName: 'MyToken',
      recipient: wallet.address(),
    });
    await refreshBalance(wallet);
    setMintAmount('');
  }

  async function handleTransfer() {
    await sendUnshielded({
      recipient: transferTo,
      amount: Number(transferAmount),
      tokenName: 'MyToken',
    });
    await refreshBalance(wallet);
    setTransferTo('');
    setTransferAmount('');
  }

  return (
    <div className="app">
      <h1>Unshielded Token dApp</h1>
      
      <div className="balance">
        <h2>Balance: {balance} MyToken</h2>
      </div>

      <div className="mint">
        <h3>Mint Tokens</h3>
        <input
          type="number"
          value={mintAmount}
          onChange={(e) => setMintAmount(e.target.value)}
          placeholder="Amount to mint"
        />
        <button onClick={handleMint}>Mint</button>
      </div>

      <div className="transfer">
        <h3>Transfer Tokens</h3>
        <input
          type="text"
          value={transferTo}
          onChange={(e) => setTransferTo(e.target.value)}
          placeholder="Recipient address"
        />
        <input
          type="number"
          value={transferAmount}
          onChange={(e) => setTransferAmount(e.target.value)}
          placeholder="Amount"
        />
        <button onClick={handleTransfer}>Transfer</button>
      </div>
    </div>
  );
}
```

## Conclusion

You now have a working unshielded token dApp with minting, transferring, and a React UI. For privacy-sensitive applications, explore shielded tokens in the Midnight documentation.

## Next Steps

- Add transaction history
- Implement token allowances
- Explore shielded token operations
- Build a more sophisticated UI with proper state management
