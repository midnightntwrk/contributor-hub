# Building an Unshielded Token dApp with UI on Midnight

> A step-by-step guide to creating, minting, transferring, and displaying unshielded tokens using Midnight's Compact smart contract language and a React frontend.

---

## Table of Contents

- [Overview](#overview)
- [What Are Unshielded Tokens?](#what-are-unshielded-tokens)
- [Prerequisites](#prerequisites)
- [Project Setup](#project-setup)
- [Writing the Compact Contract](#writing-the-compact-contract)
- [Compiling the Contract](#compiling-the-contract)
- [Building the dApp Backend (TypeScript)](#building-the-dapp-backend-typescript)
- [Building the React Frontend](#building-the-react-frontend)
- [Running Locally with Devnet](#running-locally-with-devnet)
- [Deploying to Testnet](#deploying-to-testnet)
- [Unshielded vs Shielded Tokens — When to Use Which](#unshielded-vs-shielded-tokens--when-to-use-which)
- [Conclusion](#conclusion)
- [Resources](#resources)

---

## Overview

This tutorial walks you through building a complete dApp on the [Midnight Network](https://midnight.network/) — a privacy-focused blockchain built on Cardano's technology stack. You'll create a Compact smart contract that handles **unshielded tokens** and a React frontend that connects to a Midnight wallet for minting, transferring, and displaying token balances.

By the end, you'll understand:

- How to write, compile, and deploy a Compact contract with unshielded token operations
- How to integrate with `@midnight-ntwrk/midnight-js` for TypeScript-based contract interaction
- How to build a React UI with wallet connection and token management

---

## What Are Unshielded Tokens?

Midnight supports two types of tokens:

| Feature | Unshielded Tokens | Shielded Tokens |
|---------|------------------|-----------------|
| Privacy | Public amounts and addresses | Private via zero-knowledge proofs |
| Complexity | Simpler API, fewer witnesses | Requires coin management and proofs |
| Use Cases | Governance, NFTs, public records | Private transfers, confidential DeFi |
| Gas Cost | Lower | Higher (proof generation) |

**Unshielded tokens** have visible amounts and recipient addresses on-chain. They use a simpler API — `mintUnshieldedToken`, `sendUnshielded`, and `receiveUnshielded` — making them an excellent starting point for learning Midnight development.

> **When should you use unshielded tokens?** Use them when transparency is desired (governance, public leaderboards, NFT collections) or when you're prototyping and don't need privacy. Switch to shielded tokens when transaction confidentiality matters.

---

## Prerequisites

Before starting, ensure you have:

- **Node.js** v18+ and **npm** or **pnpm**
- **Docker** and Docker Compose (for local Devnet)
- A code editor (VS Code recommended with the Compact extension)
- Basic familiarity with React and TypeScript

Install the Midnight CLI tools:

```bash
# Install the Midnight project scaffolding tool
npm install -g @midnight-ntwrk/midnight-cli

# Install pnpm if you prefer it (recommended by Midnight)
npm install -g pnpm
```

---

## Project Setup

Create a new Midnight project:

```bash
npx @midnight-ntwrk/midnight-cli create unshielded-token-dapp
cd unshielded-token-dapp
```

This scaffolds a project with:

```
unshielded-token-dapp/
├── contract/           # Compact smart contract sources
├── src/                # TypeScript application code
├── public/             # Static assets
├── package.json
└── tsconfig.json
```

Install dependencies:

```bash
npm install @midnight-ntwrk/midnight-js-contracts \
            @midnight-ntwrk/midnight-js-protocol \
            @midnight-ntwrk/midnight-js-types \
            @midnight-ntwrk/compact-runtime
```

For the frontend:

```bash
npm install react react-dom
npm install -D @types/react @types/react-dom vite @vitejs/plugin-react
```

---

## Writing the Compact Contract

The Compact language is Midnight's smart contract language. It compiles to zero-knowledge circuits but provides a high-level, functional syntax.

Create `contract/unshielded-token.compact`:

```compact
// This file is part of unshielded-token-dapp.
// Copyright (C) 2026 Midnight Foundation
// SPDX-License-Identifier: Apache-2.0

import CompactStandardLibrary;

// The domain separator uniquely identifies this token type.
// Using a padded string makes it human-readable and collision-resistant.
const DOMAIN: Bytes<32> = pad(32, "unshielded-dapp:v1");

/// Mint new unshielded tokens to the calling contract.
/// Returns the token color (unique identifier for this token type).
export circuit mint(amount: Uint<64>): Bytes<32> {
    const color = mintUnshieldedToken(
        disclose(DOMAIN),
        disclose(amount),
        left<ContractAddress, UserAddress>(kernel.self())
    );
    return color;
}

/// Send unshielded tokens from the contract to a user address.
export circuit sendToUser(amount: Uint<128>, recipient: UserAddress): [] {
    const color = tokenType(disclose(DOMAIN), kernel.self());
    sendUnshielded(
        color,
        disclose(amount),
        right<ContractAddress, UserAddress>(disclose(recipient))
    );
}

/// Receive unshielded tokens sent to this contract.
export circuit receiveTokens(amount: Uint<128>): [] {
    const color = tokenType(DOMAIN, kernel.self());
    receiveUnshielded(color, disclose(amount));
}

/// Query the contract's unshielded token balance for this token type.
export circuit getBalance(): Uint<128> {
    const color = tokenType(DOMAIN, kernel.self());
    return unshieldedBalance(color);
}
```

### Key Concepts

- **`import CompactStandardLibrary;`** — Provides token operations, hashing, and standard types.
- **`mintUnshieldedToken`** — Creates new tokens. Takes a domain separator, amount, and recipient (`left` for contract, `right` for user address).
- **`sendUnshielded`** — Transfers tokens from the contract to a recipient.
- **`receiveUnshielded`** — Claims tokens that were sent to the contract.
- **`tokenType`** — Derives a deterministic token color from a domain separator and contract address.
- **`disclose()`** — Marks values as publicly visible on-chain (appropriate for unshielded operations).
- **`left` / `right`** — Wraps values in an `Either<ContractAddress, UserAddress>` type, where `left` = contract address and `right` = user address.

---

## Compiling the Contract

Use the Compact compiler to compile your contract:

```bash
# The Midnight CLI handles compilation
npx @midnight-ntwrk/midnight-cli compile contract/unshielded-token.compact
```

This produces compiled artifacts in a `compiled/` directory, including:

- TypeScript type definitions for your contract's circuits
- Zero-knowledge proof configuration
- Contract ABI for deployment

The compiled output will be importable in your TypeScript code as:

```typescript
import { CompiledUnshieldedTokenContract } from './compiled/unshielded-token';
```

---

## Building the dApp Backend (TypeScript)

Create the contract interaction layer in `src/contract-api.ts`:

```typescript
// This file is part of unshielded-token-dapp.
// Copyright (C) 2026 Midnight Foundation
// SPDX-License-Identifier: Apache-2.0

import {
  deployContract,
  submitCallTx,
} from '@midnight-ntwrk/midnight-js-contracts';
import { sampleSigningKey } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import type { ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';

// Import the compiled contract generated by the Compact compiler
import { CompiledUnshieldedTokenContract } from '../compiled/unshielded-token';

/** The circuit IDs available in our contract */
export type TokenCircuit =
  | 'mint'
  | 'sendToUser'
  | 'receiveTokens'
  | 'getBalance';

/** Result from deploying the contract */
export interface DeployResult {
  contractAddress: ContractAddress;
  deployTxHash: string;
}

/**
 * Deploy the unshielded token contract to the network.
 */
export async function deployTokenContract(
  providers: any,
): Promise<DeployResult> {
  const deployOptions = {
    compiledContract: CompiledUnshieldedTokenContract,
    signingKey: sampleSigningKey(),
    initialPrivateState: undefined,
  };

  const deployed = await deployContract(providers, deployOptions);
  const contractAddress = deployed.deployTxData.public.contractAddress;

  return {
    contractAddress,
    deployTxHash: deployed.deployTxData.public.txHash,
  };
}

/**
 * Mint new unshielded tokens.
 * @param providers - Midnight providers (wallet, indexer, etc.)
 * @param contractAddress - The deployed contract address
 * @param amount - Number of tokens to mint
 * @returns The token color (unique token type identifier)
 */
export async function mintTokens(
  providers: any,
  contractAddress: ContractAddress,
  amount: bigint,
): Promise<Uint8Array> {
  const txData = await submitCallTx(providers, {
    compiledContract: CompiledUnshieldedTokenContract,
    contractAddress,
    circuitId: 'mint' as TokenCircuit,
    args: [amount],
  });

  return txData.private.result as Uint8Array;
}

/**
 * Send tokens from the contract to a user.
 * @param providers - Midnight providers
 * @param contractAddress - The deployed contract address
 * @param amount - Amount to transfer
 * @param recipientAddress - User's unshielded address (bytes)
 */
export async function sendTokensToUser(
  providers: any,
  contractAddress: ContractAddress,
  amount: bigint,
  recipientAddress: Uint8Array,
): Promise<void> {
  await submitCallTx(providers, {
    compiledContract: CompiledUnshieldedTokenContract,
    contractAddress,
    circuitId: 'sendToUser' as TokenCircuit,
    args: [amount, { bytes: recipientAddress }],
  });
}

/**
 * Receive tokens sent to the contract.
 */
export async function receiveTokens(
  providers: any,
  contractAddress: ContractAddress,
  amount: bigint,
): Promise<void> {
  await submitCallTx(providers, {
    compiledContract: CompiledUnshieldedTokenContract,
    contractAddress,
    circuitId: 'receiveTokens' as TokenCircuit,
    args: [amount],
  });
}

/**
 * Query the contract's balance for this token type.
 */
export async function getBalance(
  providers: any,
  contractAddress: ContractAddress,
): Promise<bigint> {
  const txData = await submitCallTx(providers, {
    compiledContract: CompiledUnshieldedTokenContract,
    contractAddress,
    circuitId: 'getBalance' as TokenCircuit,
    args: [],
  });

  return txData.private.result as bigint;
}
```

---

## Building the React Frontend

Create `src/App.tsx` — a React component with wallet connection, minting, transferring, and balance display:

```tsx
// This file is part of unshielded-token-dapp.
// Copyright (C) 2026 Midnight Foundation
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useCallback } from 'react';
import {
  deployTokenContract,
  mintTokens,
  sendTokensToUser,
  getBalance,
  type DeployResult,
} from './contract-api';

interface WalletState {
  connected: boolean;
  address: string;
  addressBytes: Uint8Array;
}

export const App: React.FC = () => {
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [providers, setProviders] = useState<any>(null);
  const [deployResult, setDeployResult] = useState<DeployResult | null>(null);
  const [balance, setBalance] = useState<string>('—');
  const [status, setStatus] = useState<string>('');
  const [busy, setBusy] = useState(false);

  // ─── Wallet Connection ──────────────────────────────────────
  const connectWallet = useCallback(async () => {
    try {
      setStatus('Connecting wallet...');
      // The @midnight-ntwrk/midnight-js wallet provider integrates
      // with the Midnight wallet extension or a local node wallet.
      const { initializeMidnightProviders } = await import(
        '@midnight-ntwrk/midnight-js-contracts'
      );
      // In a real dApp, you'd get the wallet provider from the
      // Midnight wallet browser extension or a standalone wallet.
      // For this tutorial, we use the testkit wallet.
      const { getTestEnvironment } = await import(
        '@midnight-ntwrk/testkit-js'
      );

      const logger = { info: console.log, error: console.error };
      const testEnv = getTestEnvironment(logger);
      const envConfig = await testEnv.start();
      const walletProvider = await testEnv.getMidnightWalletProvider();

      const address = await walletProvider.wallet.unshielded.getAddress();
      const addressBytes = new Uint8Array(
        Buffer.from(address.hexString, 'hex'),
      );

      setProviders(
        initializeMidnightProviders(walletProvider, envConfig, {
          privateStateStoreName: `token-dapp-${Date.now()}`,
          zkConfigPath: '/compiled/unshielded-token',
        }),
      );
      setWallet({
        connected: true,
        address: address.hexString.slice(0, 16) + '...',
        addressBytes,
      });
      setStatus('Wallet connected');
    } catch (err: any) {
      setStatus(`Wallet error: ${err.message}`);
    }
  }, []);

  // ─── Deploy Contract ────────────────────────────────────────
  const handleDeploy = useCallback(async () => {
    if (!providers) return;
    setBusy(true);
    setStatus('Deploying contract...');
    try {
      const result = await deployTokenContract(providers);
      setDeployResult(result);
      setStatus(`Deployed at ${result.contractAddress.slice(0, 16)}...`);
    } catch (err: any) {
      setStatus(`Deploy error: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }, [providers]);

  // ─── Mint Tokens ────────────────────────────────────────────
  const handleMint = useCallback(async () => {
    if (!providers || !deployResult) return;
    setBusy(true);
    const amount = 1_000_000n;
    setStatus(`Minting ${amount} tokens...`);
    try {
      await mintTokens(providers, deployResult.contractAddress, amount);
      setStatus(`Minted ${amount} tokens`);
    } catch (err: any) {
      setStatus(`Mint error: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }, [providers, deployResult]);

  // ─── Send Tokens ────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (!providers || !deployResult || !wallet) return;
    setBusy(true);
    const amount = 100n;
    setStatus(`Sending ${amount} tokens...`);
    try {
      await sendTokensToUser(
        providers,
        deployResult.contractAddress,
        amount,
        wallet.addressBytes,
      );
      setStatus(`Sent ${amount} tokens to wallet`);
    } catch (err: any) {
      setStatus(`Send error: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }, [providers, deployResult, wallet]);

  // ─── Check Balance ──────────────────────────────────────────
  const handleBalance = useCallback(async () => {
    if (!providers || !deployResult) return;
    try {
      const bal = await getBalance(providers, deployResult.contractAddress);
      setBalance(bal.toString());
    } catch (err: any) {
      setStatus(`Balance error: ${err.message}`);
    }
  }, [providers, deployResult]);

  // ─── Render ─────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 600, margin: '40px auto', fontFamily: 'sans-serif' }}>
      <h1>🔴 Midnight Unshielded Token dApp</h1>
      <p style={{ color: '#666' }}>
        Mint, transfer, and track unshielded tokens on Midnight Network
      </p>

      <div style={{ margin: '20px 0', padding: 16, background: '#f5f5f5', borderRadius: 8 }}>
        <h3>Wallet</h3>
        {!wallet ? (
          <button onClick={connectWallet}>Connect Wallet</button>
        ) : (
          <p>✅ Connected: <code>{wallet.address}</code></p>
        )}
      </div>

      <div style={{ margin: '20px 0', padding: 16, background: '#f5f5f5', borderRadius: 8 }}>
        <h3>Contract</h3>
        <button onClick={handleDeploy} disabled={!wallet || busy}>
          Deploy Contract
        </button>
        {deployResult && (
          <p>
            📄 Address: <code>{deployResult.contractAddress.slice(0, 24)}...</code>
          </p>
        )}
      </div>

      <div style={{ margin: '20px 0', padding: 16, background: '#f5f5f5', borderRadius: 8 }}>
        <h3>Token Operations</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={handleMint} disabled={!deployResult || busy}>
            Mint 1,000,000 Tokens
          </button>
          <button onClick={handleSend} disabled={!deployResult || busy}>
            Send 100 Tokens to Wallet
          </button>
          <button onClick={handleBalance} disabled={!deployResult}>
            Refresh Balance
          </button>
        </div>
        <p>
          Contract Balance: <strong>{balance}</strong> tokens
        </p>
      </div>

      {status && (
        <div
          style={{
            padding: 12,
            background: status.includes('error') ? '#fee' : '#efe',
            borderRadius: 4,
            marginTop: 16,
          }}
        >
          {status}
        </div>
      )}
    </div>
  );
};

export default App;
```

Create `src/main.tsx` as the entry point:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

---

## Running Locally with Devnet

Midnight provides a Docker-based local Devnet for development and testing.

### 1. Start the Devnet

```bash
# Clone the Midnight Devnet Docker configuration
git clone https://github.com/midnightntwrk/midnight-devnet.git
cd midnight-devnet

# Start the local network
docker compose up -d
```

Wait for all services to be healthy (typically 30-60 seconds):

```bash
docker compose ps
```

### 2. Start the dApp

```bash
cd unshielded-token-dapp

# Start the Vite dev server
npx vite --open
```

### 3. Test the Flow

1. Click **Connect Wallet** — the testkit wallet connects to the local Devnet
2. Click **Deploy Contract** — deploys your Compact contract
3. Click **Mint 1,000,000 Tokens** — creates tokens held by the contract
4. Click **Send 100 Tokens to Wallet** — transfers tokens to your wallet address
5. Click **Refresh Balance** — queries the contract's remaining balance

---

## Deploying to Testnet

When you're ready to test on the public testnet:

### 1. Configure Network

Update your provider configuration to point to the Midnight testnet:

```typescript
const testnetConfig = {
  nodeUrl: 'https://testnet.midnight.network',
  indexerUrl: 'https://testnet-indexer.midnight.network',
  // Use the Midnight wallet browser extension for testnet
};
```

### 2. Get Test Tokens

Request test NIGHT tokens from the Midnight Discord faucet to pay for transaction fees.

### 3. Build for Production

```bash
npx vite build
```

Deploy the static files to your preferred hosting (Vercel, Netlify, etc.).

---

## Unshielded vs Shielded Tokens — When to Use Which

### Use Unshielded Tokens When:

- **Governance and voting** — Transparency ensures fair processes
- **NFT collections** — Public ownership verification is a feature
- **Public leaderboards and achievements** — Everyone should see the data
- **Prototyping** — Simpler API speeds up development
- **Regulatory compliance** — Some use cases require visible transactions

### Use Shielded Tokens When:

- **Private payments** — Transaction details should be confidential
- **Confidential DeFi** — Positions and strategies should remain private
- **Private auctions** — Bids shouldn't be publicly visible
- **Personal data tokens** — Identity or health-related tokens require privacy

### Migration Path

You can start with unshielded tokens and migrate to shielded tokens later. The contract structure is similar — the main differences are:

- Shielded tokens use `mintShieldedToken`, `sendShielded`, and `receiveShielded`
- Shielded operations require `ShieldedCoinInfo` and `QualifiedShieldedCoinInfo` types
- Shielded tokens involve zero-knowledge proof generation (higher gas, longer confirmation)

---

## Conclusion

You've built a complete unshielded token dApp on Midnight! Here's what you accomplished:

1. ✅ Wrote a Compact smart contract with `mintUnshieldedToken`, `sendUnshielded`, and `receiveUnshielded`
2. ✅ Compiled the contract to TypeScript-compatible artifacts
3. ✅ Built a TypeScript API layer using `@midnight-ntwrk/midnight-js`
4. ✅ Created a React frontend with wallet connection and token operations
5. ✅ Ran locally against Midnight Devnet

### Next Steps

- Add custom token metadata (name, symbol, decimals)
- Implement an approval/allowance pattern for third-party transfers
- Explore shielded token operations for private transactions
- Build more complex DeFi primitives using the same patterns

---

## Resources

- **Midnight Docs**: [https://docs.midnight.network/](https://docs.midnight.network/)
- **Compact Standard Library Reference**: [https://docs.midnight.network/api-reference/compact-runtime](https://docs.midnight.network/api-reference/compact-runtime)
- **Midnight MCP** (AI-assisted development): [https://www.npmjs.com/package/midnight-mcp](https://www.npmjs.com/package/midnight-mcp)
- **Developer Forum**: [https://forum.midnight.network/](https://forum.midnight.network/)
- **Discord**: [https://discord.com/invite/midnightnetwork](https://discord.com/invite/midnightnetwork)
- **GitHub**: [https://github.com/midnightntwrk](https://github.com/midnightntwrk)

---

*Licensed under the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).*
