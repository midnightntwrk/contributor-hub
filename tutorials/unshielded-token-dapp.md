# Building an Unshielded Token dApp with UI

> **Bounty #328** — A complete tutorial for building an unshielded token dApp on Midnight with a React frontend.

## Overview

This tutorial walks through building a fully functional unshielded token dApp on the Midnight network. Unshielded tokens are the simpler entry point for new contributors — they operate similarly to standard token operations on other chains, making them ideal for learning the Midnight SDK before tackling shielded (private) operations.

### When to Use Unshielded vs Shielded Tokens

| Feature | Unshielded | Shielded |
|---------|-----------|----------|
| Privacy | Public balances | Private balances via ZK proofs |
| Complexity | Simple | Complex (proof generation) |
| Use Case | Voting tokens, public rewards | Financial transactions, private data |
| Performance | Fast | Slower (proof computation) |

## Prerequisites

- Node.js 18+
- Midnight SDK (`@midnight-ntwrk/midnight-js`)
- A Midnight wallet (Nightpoint)
- React 18+

```bash
npm install @midnight-ntwrk/midnight-js @midnight-ntwrk/zswap-api
npm install react react-dom
```

## Step 1: Project Setup

```bash
mkdir unshielded-token-dapp && cd unshielded-token-dapp
npm init -y
npm install @midnight-ntwrk/midnight-js react react-dom vite
```

Create `src/index.html` and `src/App.jsx` for the React frontend.

## Step 2: Initialize the Midnight Client

```typescript
// src/midnight/client.ts
import { initializeMidnight } from '@midnight-ntwrk/midnight-js';

export async function createMidnightClient() {
  const client = await initializeMidnight({
    network: 'testnet',
    wallet: {
      type: 'nightpoint',
    },
  });
  return client;
}
```

## Step 3: Mint Unshielded Tokens

```typescript
// src/midnight/tokens.ts
import { mintUnshieldedToken } from '@midnight-ntwrk/midnight-js';

export async function mintToken(client: any, amount: number) {
  const tx = await mintUnshieldedToken(client, {
    tokenType: 'NIGHT',
    amount: BigInt(amount),
  });
  
  console.log(`Minted ${amount} tokens in tx: ${tx.hash}`);
  return tx;
}
```

The `mintUnshieldedToken` function creates new tokens on the Midnight network. For testnet, tokens are minted immediately. On mainnet, this requires appropriate permissions.

## Step 4: Transfer Unshielded Tokens

```typescript
export async function sendUnshielded(
  client: any,
  recipient: string,
  amount: number
) {
  const tx = await client.sendUnshielded({
    recipient,
    amount: BigInt(amount),
    tokenType: 'NIGHT',
  });
  
  console.log(`Sent ${amount} tokens to ${recipient}`);
  return tx;
}
```

### Key Points for Transfers
- The recipient address must be a valid Midnight address
- Amount is specified in the smallest unit (like wei for Ethereum)
- Gas fees are paid in NIGHT tokens

## Step 5: Receive Unshielded Tokens

```typescript
export async function receiveUnshielded(client: any) {
  const balance = await client.getUnshieldedBalance('NIGHT');
  console.log(`Current balance: ${balance}`);
  return balance;
}
```

Incoming tokens are automatically credited to your unshielded balance. No explicit "receive" transaction is needed — checking your balance reflects all received tokens.

## Step 6: React Frontend

```jsx
// src/App.jsx
import React, { useState, useEffect } from 'react';
import { createMidnightClient, mintToken, sendUnshielded, receiveUnshielded } from './midnight';

function App() {
  const [client, setClient] = useState(null);
  const [balance, setBalance] = useState('0');
  const [mintAmount, setMintAmount] = useState('');
  const [sendTo, setSendTo] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [status, setStatus] = useState('Not connected');

  useEffect(() => {
    async function init() {
      try {
        const c = await createMidnightClient();
        setClient(c);
        setStatus('Connected');
        const bal = await receiveUnshielded(c);
        setBalance(bal.toString());
      } catch (err) {
        setStatus(`Error: ${err.message}`);
      }
    }
    init();
  }, []);

  const handleMint = async () => {
    if (!client || !mintAmount) return;
    setStatus('Minting...');
    try {
      await mintToken(client, Number(mintAmount));
      const bal = await receiveUnshielded(client);
      setBalance(bal.toString());
      setStatus('Minted successfully!');
    } catch (err) {
      setStatus(`Mint failed: ${err.message}`);
    }
  };

  const handleSend = async () => {
    if (!client || !sendTo || !sendAmount) return;
    setStatus('Sending...');
    try {
      await sendUnshielded(client, sendTo, Number(sendAmount));
      const bal = await receiveUnshielded(client);
      setBalance(bal.toString());
      setStatus('Sent successfully!');
    } catch (err) {
      setStatus(`Send failed: ${err.message}`);
    }
  };

  return (
    <div className="App">
      <h1>Midnight Unshielded Token dApp</h1>
      <p>Status: {status}</p>
      <p>Balance: {balance} NIGHT</p>
      
      <div className="section">
        <h2>Mint Tokens</h2>
        <input
          type="number"
          value={mintAmount}
          onChange={(e) => setMintAmount(e.target.value)}
          placeholder="Amount to mint"
        />
        <button onClick={handleMint}>Mint</button>
      </div>
      
      <div className="section">
        <h2>Send Tokens</h2>
        <input
          type="text"
          value={sendTo}
          onChange={(e) => setSendTo(e.target.value)}
          placeholder="Recipient address"
        />
        <input
          type="number"
          value={sendAmount}
          onChange={(e) => setSendAmount(e.target.value)}
          placeholder="Amount"
        />
        <button onClick={handleSend}>Send</button>
      </div>
    </div>
  );
}

export default App;
```

## Step 7: Run the dApp

```bash
npx vite --open
```

Your dApp will open in the browser. Connect your Nightpoint wallet, mint some testnet tokens, and try sending them to another address.

## Troubleshooting

### Common Issues

1. **"Wallet not connected"** — Make sure Nightpoint is installed and unlocked
2. **"Insufficient balance"** — Mint tokens first on testnet
3. **"Invalid recipient"** — Midnight addresses start with a specific prefix
4. **Transaction pending** — Midnight blocks take ~6 seconds on testnet

### Network Configuration

For mainnet:
```typescript
const client = await initializeMidnight({
  network: 'mainnet',
  wallet: { type: 'nightpoint' },
});
```

## Security Considerations

- Never expose private keys in frontend code
- Validate all user inputs before submitting transactions
- Use environment variables for sensitive configuration
- Test thoroughly on testnet before deploying to mainnet

## Next Steps

- Try [Building a Shielded Token dApp](./shielded-token-dapp.md) for privacy-preserving operations
- Explore ZK proofs for private transactions
- Build a multi-token portfolio tracker

## Resources

- [Midnight Documentation](https://docs.midnight.network)
- [Midnight SDK Reference](https://docs.midnight.network/sdk)
- [Nightpoint Wallet](https://nightpoint.midnight.network)
- [Testnet Faucet](https://faucet.midnight.network)
