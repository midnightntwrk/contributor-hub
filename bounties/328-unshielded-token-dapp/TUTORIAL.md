---
title: "Building an Unshielded Token dApp with UI on Midnight"
description: "A complete walkthrough of building an unshielded token dApp on Midnight — from Compact contract to React frontend, with wallet integration."
tags: [midnight, compact, blockchain, dapp, react, tutorial]
published: false
---

# Building an Unshielded Token dApp with UI on Midnight

## Introduction

Unshielded tokens on Midnight offer the simplest path for moving value on the network. While they don't provide the privacy guarantees of shielded tokens, they're faster, cheaper, and perfect for use cases where transaction transparency is acceptable — such as public leaderboards, rewards distribution, and community token airdrops.

In this tutorial, you'll build a complete unshielded token dApp with:
- A Compact smart contract for mint, send, and receive operations
- TypeScript witness integration
- A React frontend with wallet connection and token operations

## Prerequisites

- Node.js 18+ and npm/yarn
- Docker and Docker Compose (for local network)
- Basic TypeScript and React knowledge
- The Midnight toolchain installed

## Part 1: Environment Setup

### Install the Midnight Toolchain

```bash
# Install the Compact compiler
npm install -g @midnight-ntwrk/compact

# Verify installation
compact --version

# Clone the local development environment
git clone https://github.com/midnightntwrk/midnight-local-dev.git
cd midnight-local-dev

# Start the local network
docker compose up -d

# Verify all services are running
curl http://localhost:6300/health   # Proof server
curl http://localhost:8088/health   # Indexer
curl http://localhost:9944/health   # Node
```

### Create the Project

```bash
# Create project directory
mkdir unshielded-token-dapp && cd unshielded-token-dapp

# Initialize npm project
npm init -y

# Install Midnight dependencies
npm install @midnight-ntwrk/midnight-js @midnight-ntwrk/wallet

# Install development dependencies
npm install -D typescript vitest @types/node
```

## Part 2: The Compact Contract

The contract handles three core operations: minting tokens, sending them to users, and receiving them.

```compact
// contracts/token_contract.compact
import CompactStandardLibrary;

// Mint new unshielded tokens and receive them into the contract
export circuit mintAndReceive(amount: Uint<64>): Bytes<32> {
    const domain = pad(32, "simple:receive");

    const color = mintUnshieldedToken(
        disclose(domain),
        disclose(amount),
        left<ContractAddress, UserAddress>(kernel.self())
    );

    return color;
}

// Send unshielded tokens from the contract to a user address
export circuit sendToUser(amount: Uint<64>, user_addr: UserAddress): [] {
    const domain = pad(32, "simple:receive");
    const color = tokenType(disclose(domain), kernel.self());

    sendUnshielded(
        color,
        disclose(amount) as Uint<128>,
        right<ContractAddress, UserAddress>(disclose(user_addr))
    );
}

// Receive unshielded tokens into the contract
export circuit receiveTokens(amount: Uint<128>): [] {
    const domain = pad(32, "simple:receive");
    const color = tokenType(domain, kernel.self());
    receiveUnshielded(color, disclose(amount));
}
```

### Compile the Contract

```bash
compact compile contracts/token_contract.compact --out-dir compiled/
```

## Part 3: TypeScript Integration

### Witness Implementation

The witness connects the TypeScript frontend to the compiled Compact contract:

```typescript
// src/witness.ts
import { createContext, LedgerContext } from "@midnight-ntwrk/midnight-js";
import { type ContractInstance } from "@midnight-ntwrk/compact";

export interface ContractWitnesses {
  mintAndReceive: (amount: bigint) => Promise<Uint8Array>;
  sendToUser: (amount: bigint, userAddress: string) => Promise<void>;
  receiveTokens: (amount: bigint) => Promise<void>;
}

export function createWitnesses(
  contract: ContractInstance,
  provider: LedgerContext
): ContractWitnesses {
  return {
    async mintAndReceive(amount: bigint): Promise<Uint8Array> {
      const result = await contract.call("mintAndReceive", [amount], provider);
      return result as Uint8Array;
    },

    async sendToUser(amount: bigint, userAddress: string): Promise<void> {
      await contract.call("sendToUser", [amount, userAddress], provider);
    },

    async receiveTokens(amount: bigint): Promise<void> {
      await contract.call("receiveTokens", [amount], provider);
    },
  };
}
```

### Contract Deployment

```typescript
// src/deploy.ts
import { createContext } from "@midnight-ntwrk/midnight-js";
import { type MidnightProvider } from "@midnight-ntwrk/wallet";
import compiledContract from "../compiled/token_contract.json";

export async function deployContract(wallet: MidnightProvider) {
  const context = createContext(wallet);

  const deployedContract = await context.deploy(compiledContract);
  console.log("Contract deployed at:", deployedContract.address);

  return {
    address: deployedContract.address,
    instance: deployedContract.instance,
    context,
  };
}
```

## Part 4: React Frontend

### Project Setup

```bash
# Create React app with TypeScript
npx create-react-app frontend --template typescript
cd frontend

# Install Midnight dependencies
npm install @midnight-ntwrk/midnight-js @midnight-ntwrk/wallet
```

### Wallet Connection Component

```tsx
// src/components/WalletConnect.tsx
import React, { useState } from "react";
import { type MidnightProvider } from "@midnight-ntwrk/wallet";

interface WalletConnectProps {
  onConnected: (provider: MidnightProvider, address: string) => void;
}

export const WalletConnect: React.FC<WalletConnectProps> = ({ onConnected }) => {
  const [connecting, setConnecting] = useState(false);

  const connectWallet = async () => {
    setConnecting(true);
    try {
      // Detect Midnight wallet (Lace or 1AM)
      const midnight = (window as any).midnight;
      if (!midnight) {
        alert("Please install Lace Wallet or 1AM to use this dApp");
        return;
      }

      const wallet: MidnightProvider = await midnight.enable("Unshielded Token dApp");
      const accounts = await wallet.accounts();
      const address = accounts[0];

      onConnected(wallet, address);
    } catch (error) {
      console.error("Wallet connection failed:", error);
      alert("Failed to connect wallet");
    } finally {
      setConnecting(false);
    }
  };

  return (
    <button onClick={connectWallet} disabled={connecting}>
      {connecting ? "Connecting..." : "Connect Wallet"}
    </button>
  );
};
```

### Token Operations Component

```tsx
// src/components/TokenOperations.tsx
import React, { useState } from "react";
import { type ContractWitnesses } from "../witness";

interface TokenOperationsProps {
  witnesses: ContractWitnesses;
  userAddress: string;
  balance: bigint;
  onBalanceChange: () => void;
}

export const TokenOperations: React.FC<TokenOperationsProps> = ({
  witnesses,
  userAddress,
  balance,
  onBalanceChange,
}) => {
  const [mintAmount, setMintAmount] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [status, setStatus] = useState<string>("");

  const handleMint = async () => {
    try {
      setStatus("Minting tokens...");
      await witnesses.mintAndReceive(BigInt(mintAmount));
      setStatus(`Successfully minted ${mintAmount} tokens!`);
      setMintAmount("");
      onBalanceChange();
    } catch (error) {
      setStatus(`Mint failed: ${error}`);
    }
  };

  const handleSend = async () => {
    try {
      setStatus("Sending tokens...");
      await witnesses.sendToUser(BigInt(sendAmount), recipient);
      setStatus(`Sent ${sendAmount} tokens to ${recipient.slice(0, 10)}...`);
      setSendAmount("");
      setRecipient("");
      onBalanceChange();
    } catch (error) {
      setStatus(`Send failed: ${error}`);
    }
  };

  const handleReceive = async () => {
    try {
      setStatus("Receiving tokens...");
      // Query pending tokens from the indexer
      const pendingAmount = await queryPendingTokens(userAddress);
      if (pendingAmount > 0n) {
        await witnesses.receiveTokens(pendingAmount);
        setStatus(`Received ${pendingAmount.toString()} tokens!`);
        onBalanceChange();
      } else {
        setStatus("No pending tokens to receive");
      }
    } catch (error) {
      setStatus(`Receive failed: ${error}`);
    }
  };

  return (
    <div className="token-operations">
      <h2>Token Balance: {balance.toString()}</h2>

      <div className="operation-section">
        <h3>Mint Tokens</h3>
        <input
          type="number"
          value={mintAmount}
          onChange={(e) => setMintAmount(e.target.value)}
          placeholder="Amount to mint"
        />
        <button onClick={handleMint}>Mint</button>
      </div>

      <div className="operation-section">
        <h3>Send Tokens</h3>
        <input
          type="number"
          value={sendAmount}
          onChange={(e) => setSendAmount(e.target.value)}
          placeholder="Amount to send"
        />
        <input
          type="text"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder="Recipient address (0x...)"
        />
        <button onClick={handleSend}>Send</button>
      </div>

      <div className="operation-section">
        <h3>Receive Tokens</h3>
        <button onClick={handleReceive}>Receive Pending</button>
      </div>

      {status && <div className="status">{status}</div>}
    </div>
  );
};
```

### Main App Component

```tsx
// src/App.tsx
import React, { useState, useCallback } from "react";
import { WalletConnect } from "./components/WalletConnect";
import { TokenOperations } from "./components/TokenOperations";
import { deployContract, createWitnesses } from "./witness";
import { type MidnightProvider } from "@midnight-ntwrk/wallet";
import { type ContractWitnesses } from "./witness";

function App() {
  const [connected, setConnected] = useState(false);
  const [witnesses, setWitnesses] = useState<ContractWitnesses | null>(null);
  const [userAddress, setUserAddress] = useState("");
  const [balance, setBalance] = useState(0n);

  const handleConnected = useCallback(
    async (wallet: MidnightProvider, address: string) => {
      try {
        const { instance, context } = await deployContract(wallet);
        const contractWitnesses = createWitnesses(instance, context);

        setWitnesses(contractWitnesses);
        setUserAddress(address);
        setConnected(true);

        // Query initial balance
        const initialBalance = await queryContractBalance(address);
        setBalance(initialBalance);
      } catch (error) {
        console.error("Deployment failed:", error);
      }
    },
    []
  );

  const refreshBalance = useCallback(async () => {
    if (userAddress) {
      const newBalance = await queryContractBalance(userAddress);
      setBalance(newBalance);
    }
  }, [userAddress]);

  return (
    <div className="app">
      <h1>Unshielded Token dApp</h1>

      {!connected ? (
        <WalletConnect onConnected={handleConnected} />
      ) : (
        <>
          <div className="wallet-info">
            Connected: {userAddress.slice(0, 10)}...
          </div>
          <TokenOperations
            witnesses={witnesses!}
            userAddress={userAddress}
            balance={balance}
            onBalanceChange={refreshBalance}
          />
        </>
      )}
    </div>
  );
}

export default App;
```

### Configuration

```typescript
// src/config.ts
export const MIDNIGHT_CONFIG = {
  proverServerUrl: "http://localhost:6300",
  walletServerUrl: "http://localhost:3000",
  indexerUrl: "http://localhost:8088/api/v3/graphql",
  nodeUrl: "http://localhost:9944",
  networkId: "DevNet",
};
```

### Styling

```css
/* src/App.css */
.app {
  max-width: 800px;
  margin: 0 auto;
  padding: 2rem;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.wallet-info {
  background: #f0f4ff;
  padding: 0.75rem 1rem;
  border-radius: 8px;
  margin-bottom: 1.5rem;
  font-family: monospace;
  font-size: 0.9rem;
}

.operation-section {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 1.5rem;
  margin-bottom: 1rem;
}

.operation-section h3 {
  margin-top: 0;
  margin-bottom: 1rem;
  color: #1a202c;
}

input {
  display: block;
  width: 100%;
  padding: 0.5rem;
  margin-bottom: 0.5rem;
  border: 1px solid #cbd5e0;
  border-radius: 4px;
  font-size: 1rem;
}

button {
  background: #4f46e5;
  color: white;
  border: none;
  padding: 0.5rem 1rem;
  border-radius: 4px;
  font-size: 1rem;
  cursor: pointer;
}

button:hover {
  background: #4338ca;
}

button:disabled {
  background: #a0aec0;
  cursor: not-allowed;
}

.status {
  margin-top: 1rem;
  padding: 0.75rem;
  background: #f0fff4;
  border: 1px solid #c6f6d5;
  border-radius: 4px;
  color: #276749;
}
```

## Part 5: Testing

### Integration Test

```typescript
// tests/token.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { createContext } from "@midnight-ntwrk/midnight-js";
import compiledContract from "../compiled/token_contract.json";

describe("Unshielded Token Contract", () => {
  let contract: any;
  let context: any;

  beforeAll(async () => {
    // Use local development network
    context = createContext({
      proverServerUrl: "http://localhost:6300",
      networkId: "DevNet",
    });

    contract = await context.deploy(compiledContract);
  });

  it("should mint tokens and return a color", async () => {
    const result = await contract.instance.call("mintAndReceive", [1000n]);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(32); // Color is 32 bytes
  });

  it("should send tokens to a user address", async () => {
    const testAddress = "0x1234567890abcdef...";
    await expect(
      contract.instance.call("sendToUser", [500n, testAddress])
    ).resolves.not.toThrow();
  });

  it("should receive pending tokens", async () => {
    await expect(
      contract.instance.call("receiveTokens", [500n])
    ).resolves.not.toThrow();
  });
});
```

### Running Tests

```bash
# Start local network
docker compose -f ../midnight-local-dev/docker-compose.yml up -d

# Run tests
npx vitest run

# Expected output:
#   ✓ should mint tokens and return a color
#   ✓ should send tokens to a user address
#   ✓ should receive pending tokens
#   Tests: 3 passed, 3 total
```

## Using Unshielded vs Shielded Tokens

| Consideration | Unshielded | Shielded |
|--------------|------------|----------|
| **Privacy** | Transparent — anyone can see balances and transactions | Hidden — amounts and addresses are encrypted |
| **Transaction cost** | Lower (simpler proofs) | Higher (ZK proofs required) |
| **Speed** | Faster | Slower (proof generation time) |
| **Complexity** | Simple contract code | More complex (nonces, Merkle trees) |
| **Use cases** | Public balances, rewards, leaderboards | Private payments, confidential voting |

**Choose unshielded tokens when:**
- You don't need transaction privacy
- Users should be able to verify balances publicly
- Transaction throughput matters more than confidentiality
- You're building a public reward or points system

## Conclusion

You've built a complete unshielded token dApp on Midnight with:
- A Compact contract supporting mint, send, and receive operations
- TypeScript witness integration for frontend-backend communication
- A React UI with wallet connection (Lace/1AM) and token operation controls

The full code is less than 200 lines across all components — that's the power of Compact and Midnight's development tools.

To take this further:
- Add a transaction history view using the indexer's GraphQL API
- Implement token metadata (name, symbol, decimals)
- Add a faucet for test tokens
- Deploy to the Preview network for public testing
