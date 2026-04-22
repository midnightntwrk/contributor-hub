# Building an Unshielded Token dApp with UI

A step-by-step guide to building a fully functional token dApp on the Midnight network using unshielded tokens, Compact smart contracts, and a React frontend.

---

## Introduction

Midnight is a privacy-focused blockchain that supports both **shielded** (private) and **unshielded** (public) token operations. Unshielded tokens are the simplest entry point for developers new to Midnight — they behave similarly to tokens on other blockchains, with publicly visible balances and straightforward transfer mechanics.

This tutorial walks through the full lifecycle of an unshielded token dApp:

1. Writing a Compact smart contract that mints, sends, and receives unshielded tokens
2. Deploying the contract to the Midnight Preprod testnet
3. Building a React frontend with wallet connection, minting, transfers, and balance display

By the end, you will have a working dApp where users can connect their Midnight wallet, mint custom tokens, send them to other addresses, and view balances in real time.

### When to Use Unshielded vs Shielded Tokens

Midnight's dual-token model gives developers a choice between transparency and privacy:

| Consideration | Unshielded Tokens | Shielded Tokens |
|---|---|---|
| **Privacy** | Balances and transfers are publicly visible on-chain | Balances and transfers are hidden using zero-knowledge proofs |
| **Complexity** | Simpler circuits, faster proof generation | Requires nonce management, coin ciphertexts, and ZK proof overhead |
| **Auditing** | Fully auditable by anyone — ideal for transparency requirements | Only verifiable by parties with the right keys |
| **Use Cases** | Governance voting tokens, public rewards, loyalty points, NFTs | Financial transactions, private data exchanges, confidential commerce |
| **Performance** | Lower gas cost, faster transaction finality | Higher gas cost due to proof computation |

Choose **unshielded** tokens when your application benefits from transparency — such as public voting systems, reward leaderboards, or any scenario where participants should see each other's holdings. Choose **shielded** tokens when user privacy is paramount, such as in payments or confidential agreements.

---

## Prerequisites

Before starting, ensure you have the following:

- **Node.js 22+** — [Install via NVM](https://github.com/nvm-sh/nvm)
- **Docker Desktop** — Installed and running ([download](https://www.docker.com/products/docker-desktop/))
- **Compact compiler** — Installed via the Midnight toolchain
- **A Midnight wallet** — Funded with tNIGHT from the [Preprod faucet](https://faucet.midnight.network)

---

## Step 1: Scaffold the Project

Use the official `create-mn-app` CLI to generate a project with the correct structure:

```bash
npx create-mn-app unshielded-token-dapp
```

When prompted, select **Contract** and then **Hello world** as the starting template. This gives us a minimal setup with the proof server configuration, contract compilation, and deployment scripts already in place.

```bash
cd unshielded-token-dapp
```

After scaffolding, your project structure looks like this:

```
unshielded-token-dapp/
├── contracts/
│   └── hello-world.compact
├── src/
│   ├── cli.ts
│   ├── deploy.ts
│   └── check-balance.ts
├── docker-compose.yml
├── package.json
└── deployment.json
```

---

## Step 2: Write the Compact Smart Contract

Replace the contents of `contracts/hello-world.compact` with our token contract. This contract defines three core operations: minting tokens to the contract itself, sending tokens to a user, and receiving tokens from a user.

```compact
pragma language_version 0.22;

import CompactStandardLibrary;

// The domain separator for our custom token type.
// This uniquely identifies our token on the network.
const TOKEN_DOMAIN: Bytes<32> = pad(32, "my-token:v1");

// Mint new unshielded tokens and receive them into the contract.
// Returns the token color (unique identifier) for the minted token type.
export circuit mintAndReceive(amount: Uint<64>): Bytes<32> {
  // mintUnshieldedToken creates new tokens of a given type.
  // - domainSep: A domain separator to distinguish this token from others
  // - amount: How many tokens to mint
  // - recipient: Who receives the minted tokens (here, the contract itself)
  const color = mintUnshieldedToken(
    disclose(TOKEN_DOMAIN),
    disclose(amount),
    left<ContractAddress, UserAddress>(kernel.self())
  );

  // receiveUnshielded accepts the tokens into the contract's balance.
  // This must be called after minting to actually hold the tokens.
  receiveUnshielded(color, disclose(amount) as Uint<128>);

  return color;
}

// Send tokens from the contract to a user address.
export circuit sendToUser(amount: Uint<64>, user_addr: UserAddress): [] {
  // Derive the token type from our domain separator and contract address.
  const color = tokenType(disclose(TOKEN_DOMAIN), kernel.self());

  // sendUnshielded transfers tokens from the contract to the recipient.
  // - color: The token type identifier
  // - amount: How many tokens to send
  // - recipient: The user address receiving the tokens
  sendUnshielded(
    color,
    disclose(amount) as Uint<128>,
    right<ContractAddress, UserAddress>(disclose(user_addr))
  );
}

// Receive tokens sent to this contract by a user.
export circuit receiveTokens(amount: Uint<128>): [] {
  const color = tokenType(TOKEN_DOMAIN, kernel.self());
  receiveUnshielded(color, disclose(amount));
}

// Query the contract's current balance of this token type.
// Note: This returns the balance at the start of the transaction,
// not updated mid-execution.
export circuit getBalance(): Uint<128> {
  const color = tokenType(TOKEN_DOMAIN, kernel.self());
  return unshieldedBalance(color);
}
```

### Understanding the Core Functions

**`mintUnshieldedToken(domainSep, value, recipient)`** — Creates new tokens out of thin air. The `domainSep` parameter distinguishes your token from others. The `recipient` is an `Either<ContractAddress, UserAddress>` — use `left` to mint to the contract, `right` to mint directly to a user.

**`receiveUnshielded(color, amount)`** — Accepts incoming tokens of the specified type into the contract. This is required when tokens are sent to the contract; without calling this, the transfer would fail.

**`sendUnshielded(color, amount, recipient)`** — Sends tokens from the contract's balance to a recipient. Again, the recipient is an `Either` — use `left` for another contract, `right` for a user address.

**`tokenType(domainSep, contract)`** — Derives the unique "color" (32-byte identifier) for a token type from a domain separator and a contract address. This is collision-resistant: no two contracts can mint tokens of the same color.

---

## Step 3: Deploy the Contract

Start the proof server and deploy:

```bash
npm run setup
```

This command:
1. Starts the Docker-based proof server (generates ZK proofs for transactions)
2. Compiles the Compact contract
3. Prompts you to create or restore a wallet
4. Deploys the contract to the Preprod network

When prompted, create a new wallet and save the seed phrase securely. Then fund the wallet with tNIGHT from the [faucet](https://faucet.midnight.network). The deployment script automatically generates tDUST (used for transaction fees) and deploys the contract.

After successful deployment, note the **Contract Address** saved in `deployment.json`.

---

## Step 4: Build the React Frontend

Now let's create a React frontend that connects to the user's Midnight wallet and interacts with our deployed contract.

### Project Setup

Install React and related dependencies:

```bash
npm install react react-dom
npm install -D @vitejs/plugin-react vite typescript
npm install @midnight-ntwrk/dapp-connector-api @midnight-ntwrk/midnight-js
```

Create `vite.config.ts`:

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    global: 'globalThis',
  },
});
```

### Wallet Connection Hook

The Midnight DApp connector API is injected by wallets into `window.midnight`. Create a hook to manage the connection:

```typescript
// src/frontend/useWallet.ts
import { useState, useEffect, useCallback } from 'react';

export interface WalletState {
  connected: boolean;
  api: any | null;
  unshieldedAddress: string;
  unshieldedBalances: Record<string, bigint>;
  walletName: string;
}

export function useWallet() {
  const [wallet, setWallet] = useState<WalletState>({
    connected: false,
    api: null,
    unshieldedAddress: '',
    unshieldedBalances: {},
    walletName: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Discover available wallets from the window.midnight global
      const midnight = (window as any).midnight;
      if (!midnight) {
        throw new Error(
          'No Midnight wallet detected. Please install a compatible wallet.'
        );
      }

      // Get the first available wallet
      const walletKeys = Object.keys(midnight);
      if (walletKeys.length === 0) {
        throw new Error('No wallets found in window.midnight');
      }

      const walletId = walletKeys[0];
      const walletApi = midnight[walletId];

      // Connect to the wallet — this may prompt the user for authorization
      const api = await walletApi.connect('testnet');

      // Fetch the unshielded address and balances
      const { unshieldedAddress } = await api.getUnshieldedAddress();
      const balances = await api.getUnshieldedBalances();

      setWallet({
        connected: true,
        api,
        unshieldedAddress,
        unshieldedBalances: balances,
        walletName: walletApi.name || walletId,
      });
    } catch (err: any) {
      setError(err.message || 'Failed to connect wallet');
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshBalances = useCallback(async () => {
    if (!wallet.api) return;
    try {
      const balances = await wallet.api.getUnshieldedBalances();
      setWallet((prev) => ({ ...prev, unshieldedBalances: balances }));
    } catch (err: any) {
      console.error('Failed to refresh balances:', err);
    }
  }, [wallet.api]);

  return { wallet, loading, error, connect, refreshBalances };
}
```

### Contract Interaction Layer

Create a service layer that wraps contract calls through the Midnight.js SDK:

```typescript
// src/frontend/contractService.ts
import {
  deployContract,
  findDeployedContract,
} from '@midnight-ntwrk/midnight-js-contracts';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';

const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS || '';

export async function mintTokens(
  providers: MidnightProviders,
  amount: bigint
): Promise<string> {
  const contract = await findDeployedContract(providers, {
    contractAddress: CONTRACT_ADDRESS,
    privateStateId: 'token-state',
  });

  const result = await contract.callTx.mintAndReceive(amount);
  return result;
}

export async function sendTokensToUser(
  providers: MidnightProviders,
  amount: bigint,
  userAddress: string
): Promise<void> {
  const contract = await findDeployedContract(providers, {
    contractAddress: CONTRACT_ADDRESS,
    privateStateId: 'token-state',
  });

  // Convert the hex address to the UserAddress format expected by Compact
  const addressBytes = hexToBytes(userAddress);
  await contract.callTx.sendToUser(amount, { bytes: addressBytes });
}

export async function getContractBalance(
  providers: MidnightProviders
): Promise<bigint> {
  const contract = await findDeployedContract(providers, {
    contractAddress: CONTRACT_ADDRESS,
    privateStateId: 'token-state',
  });

  const result = await contract.callTx.getBalance();
  return result as bigint;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.substr(i, 2), 16);
  }
  return bytes;
}
```

### Main Application Component

```tsx
// src/frontend/App.tsx
import React, { useState } from 'react';
import { useWallet } from './useWallet';
import './App.css';

export default function App() {
  const { wallet, loading, error, connect, refreshBalances } = useWallet();
  const [mintAmount, setMintAmount] = useState('100');
  const [sendTo, setSendTo] = useState('');
  const [sendAmount, setSendAmount] = useState('10');
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  const handleMint = async () => {
    if (!wallet.api || !mintAmount) return;
    setProcessing(true);
    setTxStatus('Minting tokens...');
    try {
      const amount = BigInt(mintAmount);
      // In a production dApp, this would call through the contract service.
      // For wallet-based demonstration, use makeTransfer:
      const result = await wallet.api.makeTransfer(
        [{ type: 'mint', tokenType: 'custom', amount }],
        { payFees: true }
      );
      setTxStatus(`Minted ${mintAmount} tokens successfully!`);
      await refreshBalances();
    } catch (err: any) {
      setTxStatus(`Mint failed: ${err.message}`);
    } finally {
      setProcessing(false);
    }
  };

  const handleSend = async () => {
    if (!wallet.api || !sendTo || !sendAmount) return;
    setProcessing(true);
    setTxStatus('Sending tokens...');
    try {
      const result = await wallet.api.makeTransfer(
        [
          {
            type: 'send',
            recipient: sendTo,
            amount: BigInt(sendAmount),
            tokenType: 'custom',
          },
        ],
        { payFees: true }
      );
      setTxStatus(`Sent ${sendAmount} tokens to ${sendTo.slice(0, 12)}...`);
      await refreshBalances();
    } catch (err: any) {
      setTxStatus(`Send failed: ${err.message}`);
    } finally {
      setProcessing(false);
    }
  };

  // Format balance for display
  const formatBalance = (balances: Record<string, bigint>) => {
    return Object.entries(balances)
      .map(([token, amount]) => `${amount.toString()} ${token}`)
      .join(', ') || '0';
  };

  return (
    <div className="app">
      <header className="header">
        <h1>Unshielded Token dApp</h1>
        <p>Built on Midnight Network</p>
      </header>

      {/* Wallet Connection Section */}
      <section className="card">
        <h2>Wallet</h2>
        {!wallet.connected ? (
          <button onClick={connect} disabled={loading} className="btn-primary">
            {loading ? 'Connecting...' : 'Connect Wallet'}
          </button>
        ) : (
          <div className="wallet-info">
            <div className="info-row">
              <span className="label">Wallet</span>
              <span className="value">{wallet.walletName}</span>
            </div>
            <div className="info-row">
              <span className="label">Address</span>
              <span className="value mono">
                {wallet.unshieldedAddress.slice(0, 20)}...
                {wallet.unshieldedAddress.slice(-8)}
              </span>
            </div>
            <div className="info-row">
              <span className="label">Balances</span>
              <span className="value mono">
                {formatBalance(wallet.unshieldedBalances)}
              </span>
            </div>
            <button onClick={refreshBalances} className="btn-secondary">
              Refresh Balances
            </button>
          </div>
        )}
        {error && <p className="error">{error}</p>}
      </section>

      {/* Mint Section */}
      {wallet.connected && (
        <section className="card">
          <h2>Mint Tokens</h2>
          <p className="hint">
            Mint new tokens to your wallet. On testnet, anyone can mint.
          </p>
          <div className="input-group">
            <input
              type="number"
              value={mintAmount}
              onChange={(e) => setMintAmount(e.target.value)}
              placeholder="Amount"
              min="1"
              className="input"
            />
            <button
              onClick={handleMint}
              disabled={processing || !mintAmount}
              className="btn-primary"
            >
              Mint
            </button>
          </div>
        </section>
      )}

      {/* Transfer Section */}
      {wallet.connected && (
        <section className="card">
          <h2>Send Tokens</h2>
          <p className="hint">
            Transfer tokens to another Midnight address.
          </p>
          <div className="input-group vertical">
            <input
              type="text"
              value={sendTo}
              onChange={(e) => setSendTo(e.target.value)}
              placeholder="Recipient address (Bech32m)"
              className="input"
            />
            <div className="input-group">
              <input
                type="number"
                value={sendAmount}
                onChange={(e) => setSendAmount(e.target.value)}
                placeholder="Amount"
                min="1"
                className="input"
              />
              <button
                onClick={handleSend}
                disabled={processing || !sendTo || !sendAmount}
                className="btn-primary"
              >
                Send
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Transaction Status */}
      {txStatus && (
        <section className="card status">
          <p>{txStatus}</p>
        </section>
      )}

      {processing && (
        <div className="overlay">
          <div className="spinner" />
          <p>Processing transaction...</p>
        </div>
      )}
    </div>
  );
}
```

### Styling

Create `src/frontend/App.css` for a clean interface:

```css
.app {
  max-width: 640px;
  margin: 0 auto;
  padding: 2rem;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  color: #e0e0e0;
  background: #0a0a0a;
  min-height: 100vh;
}

.header {
  text-align: center;
  margin-bottom: 2rem;
}

.header h1 {
  font-size: 1.8rem;
  color: #fff;
  margin-bottom: 0.25rem;
}

.header p {
  color: #888;
  font-size: 0.9rem;
}

.card {
  background: #141414;
  border: 1px solid #222;
  border-radius: 12px;
  padding: 1.5rem;
  margin-bottom: 1rem;
}

.card h2 {
  font-size: 1.1rem;
  color: #fff;
  margin-bottom: 1rem;
}

.hint {
  color: #888;
  font-size: 0.85rem;
  margin-bottom: 1rem;
}

.info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 0;
  border-bottom: 1px solid #1a1a1a;
}

.label {
  color: #888;
  font-size: 0.9rem;
}

.value {
  color: #e0e0e0;
}

.mono {
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 0.85rem;
}

.input-group {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.input-group.vertical {
  flex-direction: column;
  align-items: stretch;
}

.input {
  flex: 1;
  padding: 0.6rem 0.8rem;
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 8px;
  color: #e0e0e0;
  font-size: 0.9rem;
}

.input:focus {
  outline: none;
  border-color: #6366f1;
}

.btn-primary {
  padding: 0.6rem 1.2rem;
  background: #6366f1;
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 500;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  margin-top: 0.75rem;
  padding: 0.4rem 0.8rem;
  background: transparent;
  color: #6366f1;
  border: 1px solid #6366f1;
  border-radius: 8px;
  cursor: pointer;
  font-size: 0.85rem;
}

.status {
  text-align: center;
  font-size: 0.9rem;
}

.error {
  color: #ef4444;
  font-size: 0.85rem;
  margin-top: 0.5rem;
}

.overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 3px solid #333;
  border-top-color: #6366f1;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
```

---

## Step 5: HTML Entry Point

Create the HTML file that loads the React app:

```html
<!-- index.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Unshielded Token dApp</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/frontend/main.tsx"></script>
</body>
</html>
```

```tsx
// src/frontend/main.tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

---

## Step 6: Run the dApp

Add a dev script to `package.json`:

```json
{
  "scripts": {
    "dev": "vite",
    "setup": "node dist/setup.js"
  }
}
```

Start the development server:

```bash
# Ensure the proof server is running first
docker compose up -d

# Start the frontend
npm run dev
```

Open the URL shown by Vite (typically `http://localhost:5173`). The dApp will load and prompt you to connect your Midnight wallet.

---

## How It All Works Together

Here is the full flow from the user's perspective:

1. **Connect Wallet** — The user clicks "Connect Wallet," which triggers the DApp connector API. The wallet extension shows an authorization dialog. Once approved, the frontend receives a `WalletConnectedAPI` instance.

2. **Mint Tokens** — The user enters an amount and clicks "Mint." The frontend submits a transaction through the wallet that calls the contract's `mintAndReceive` circuit. The contract uses `mintUnshieldedToken` to create new tokens and `receiveUnshielded` to accept them.

3. **Send Tokens** — The user enters a recipient address and amount. The `sendToUser` circuit calls `sendUnshielded` to transfer tokens from the contract to the specified user address. The recipient can see the incoming tokens in their wallet.

4. **Check Balance** — The frontend calls `getUnshieldedBalances()` through the wallet API. Balances update after each transaction. The contract can also be queried via the `getBalance` circuit, which uses `unshieldedBalance(color)`.

### Transaction Lifecycle on Midnight

Every interaction follows this path:

```
User action → Circuit execution (local) → ZK proof generation → Transaction balancing → Network submission → Block finality
```

The proof server (running in Docker) handles ZK proof generation. The wallet handles transaction balancing (adding necessary inputs/outputs) and signing. The Midnight network validates the proof and applies the state change.

---

## Working with NIGHT Tokens

The native token on Midnight is NIGHT. You can also work with NIGHT directly in your contracts using the default token type:

```compact
// Receive NIGHT tokens into the contract
export circuit receiveNightTokens(amount: Uint<128>): [] {
  receiveUnshielded(default<Bytes<32>>, disclose(amount));
}

// Send NIGHT tokens from the contract to a user
export circuit sendNightToUser(amount: Uint<64>, user_addr: UserAddress): [] {
  sendUnshielded(
    default<Bytes<32>>,
    disclose(amount) as Uint<128>,
    right<ContractAddress, UserAddress>(disclose(user_addr))
  );
}
```

The `default<Bytes<32>>` value represents the native NIGHT token type. This is the token used for transaction fees and gas payments.

---

## Security Considerations

When building token dApps, keep these principles in mind:

- **Never expose private keys or seed phrases** in frontend code. Always route transactions through the wallet API.
- **Validate user inputs** on the contract side. Use `disclose()` for values that should be publicly visible and verifiable.
- **Use `tokenType()`** to derive token colors instead of hardcoding them. This ensures collision resistance between contracts.
- **Test thoroughly on Preprod** before deploying to mainnet. The testnet faucet provides free tNIGHT for testing.
- **Understand `unshieldedBalance()` semantics** — it returns the balance at the start of transaction execution, not the updated balance during execution. Design your circuits accordingly.

---

## Extending the dApp

Here are ideas for taking this dApp further:

- **Add token metadata** — Store a name, symbol, and decimals in the contract's ledger state
- **Implement access control** — Restrict minting to authorized addresses using a whitelist circuit
- **Add a transfer approval flow** — Require recipients to accept tokens before they're credited
- **Build an explorer page** — Use the Midnight Indexer API to show transaction history
- **Add shielded operations** — Combine unshielded and shielded tokens in the same contract for selective privacy
- **Integrate with the Nightpoint wallet** — Use the wallet's full API for signing, proving, and transaction management

---

## Troubleshooting

| Issue | Solution |
|---|---|
| "No Midnight wallet detected" | Install a Midnight-compatible wallet browser extension |
| "Insufficient balance" | Request tNIGHT from the [faucet](https://faucet.midnight.network) |
| Transaction stuck pending | Blocks finalize in ~6 seconds on Preprod. Check the proof server is running. |
| "Token type mismatch" | Ensure you use the same `domainSep` when calling `tokenType()` across all circuits |
| Proof server errors | Run `docker compose restart` and ensure Docker has sufficient memory (4GB+) |
| Contract compilation errors | Verify the Compact pragma version matches your compiler version |

---

## Resources

- **[Midnight Documentation](https://docs.midnight.network)** — Full API reference and guides
- **[Compact Standard Library](https://docs.midnight.network/compact/standard-library/exports)** — All available circuits and types
- **[Midnight.js SDK](https://docs.midnight.network/sdks/official/wallet-developer-guide)** — Provider pattern and contract interaction
- **[DApp Connector API](https://docs.midnight.network/api-reference/dapp-connector)** — Wallet integration reference
- **[Developer Forum](https://forum.midnight.network)** — Community support
- **[Discord](https://discord.com/invite/midnightnetwork)** — Real-time help from the team
- **[Testnet Faucet](https://faucet.midnight.network)** — Free tNIGHT for testing

---

*This tutorial was created as part of the Midnight Contributor Hub bounty program. Share your builds with **#MidnightforDevs** and tag **@midnightntwrk** on X/LinkedIn!*
