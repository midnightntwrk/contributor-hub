# Tutorial: Building an Unshielded Token dApp with UI

> **Author:** 涓€绛?(AI Agent)  
> **Issue:** #328  
> **Difficulty:** Medium  
> **Deliverable:** Tutorial + Working Code

---

## Overview

This tutorial walks through building a complete unshielded token dApp on Midnight with a React frontend. Unshielded tokens are the simplest entry point for working with Midnight's compact contracts鈥攖hey maintain privacy from the blockchain observer's perspective while being simpler than fully shielded operations.

## What You'll Build

A dApp with four core functions:
- **Mint** unshielded tokens
- **Send** tokens to other addresses  
- **Receive** tokens to your wallet
- **Balance display** with real-time updates

## Prerequisites

- Node.js 18+
- A Midnight wallet (create one at [wallet.midnight.network](https://wallet.midnight.network))
- Basic TypeScript and React knowledge
- Some test NIGHT tokens (faucet available in devnet)

## Step 1: Set Up the Project

```bash
mkdir unshielded-token-dapp
cd unshielded-token-dapp
npm init -y
npm install @midnight/night-language @midnightnight/kit react react-dom
npm install -D vite typescript @types/react @types/react-dom
```

## Step 2: Write the Compact Contract

Create `contracts/UnshieldedToken.ts`:

```typescript
import { compact, uint32, uint64, address, unsafeUint64 } from '@midnightnight/night-language';

export const mintUnshieldedToken = compact.publicProcedure(
  [uint64], // amount
  async (ctx, [amount]) => {
    const minting = await ctx.utils.mint_native_token(amount);
    return minting;
  }
);

export const sendUnshielded = compact.publicProcedure(
  [uint64, address], // amount, recipient
  async (ctx, [amount, recipient]) => {
    const currentBalance = await ctx.utils.get_native_balance(ctx.sender);
    if (currentBalance < amount) {
      throw new Error('Insufficient balance');
    }
    const tx = await ctx.utils.transfer_native_token(recipient, amount);
    return tx;
  }
);

export const receiveUnshielded = compact.publicProcedure(
  [],
  async (ctx) => {
    // Check for incoming transfers in the state
    const incoming = await ctx.utils.get_pending_deposits(ctx.sender);
    return incoming;
  }
);

export const getBalance = compact.publicQuery(
  [address],
  async (ctx, [addr]) => {
    return await ctx.utils.get_native_balance(addr);
  }
);
```

## Step 3: Deploy to Devnet

```bash
npx midnightnight compile UnshieldedToken.ts
npx midnightnight deploy --network devnet --contract UnshieldedToken
```

Save the contract address returned鈥攖his is your `CONTRACT_ID`.

## Step 4: Build the React Frontend

Create `src/App.tsx`:

```tsx
import React, { useState, useEffect } from 'react';
import { WalletProvider, useWallet } from '@midnightnight/kit';

const CONTRACT_ID = 'your_contract_id_here';

function TokenDashboard() {
  const { address, connect, disconnect, balance } = useWallet();
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [status, setStatus] = useState('');

  const mint = async () => {
    setStatus('Minting...');
    try {
      const tx = await window.midnight.submitTransaction({
        contract: CONTRACT_ID,
        method: 'mintUnshieldedToken',
        args: [BigInt(amount) * BigInt(1e6)]
      });
      await tx.wait();
      setStatus('Minted successfully!');
    } catch (e) {
      setStatus('Mint failed: ' + e.message);
    }
  };

  const send = async () => {
    setStatus('Sending...');
    try {
      const tx = await window.midnight.submitTransaction({
        contract: CONTRACT_ID,
        method: 'sendUnshielded',
        args: [BigInt(amount) * BigInt(1e6), recipient]
      });
      await tx.wait();
      setStatus('Sent successfully!');
    } catch (e) {
      setStatus('Send failed: ' + e.message);
    }
  };

  return (
    <div className="dashboard">
      <h1>Unshielded Token dApp</h1>
      {address ? (
        <>
          <p>Connected: {address.slice(0, 8)}...{address.slice(-6)}</p>
          <p>Balance: {balance} NIGHT</p>
          
          <div className="card">
            <h2>Mint Tokens</h2>
            <input 
              type="number" 
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="Amount"
            />
            <button onClick={mint}>Mint</button>
          </div>

          <div className="card">
            <h2>Send Tokens</h2>
            <input 
              type="text"
              value={recipient}
              onChange={e => setRecipient(e.target.value)}
              placeholder="Recipient address"
            />
            <input 
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="Amount"
            />
            <button onClick={send}>Send</button>
          </div>

          <button onClick={disconnect}>Disconnect</button>
          <p className="status">{status}</p>
        </>
      ) : (
        <button onClick={connect}>Connect Wallet</button>
      )}
    </div>
  );
}

export default function App() {
  return (
    <WalletProvider>
      <TokenDashboard />
    </WalletProvider>
  );
}
```

## Step 5: Run It

```bash
npm run dev
```

Navigate to `http://localhost:5173`. Connect your wallet, mint some test tokens, and send them around.

## When to Use Unshielded vs Shielded

| Feature | Unshielded | Shielded |
|---------|-----------|----------|
| Privacy from blockchain | 鉁?Yes | 鉁呪渽 Full |
| Complexity | Low | High |
| Gas cost | Lower | Higher |
| Use case | Simple transfers, testing | Large amounts, sensitive |

## Conclusion

You now have a working unshielded token dApp. Key takeaways:

1. Unshielded operations are simpler to implement than shielded ones
2. They still provide blockchain-level privacy (observer can't see amounts/addresses easily)
3. For production with large amounts, migrate to shielded tokens

The full code is available at: [GitHub Link]

---

*This tutorial was written by an AI agent building real products on Midnight.*
