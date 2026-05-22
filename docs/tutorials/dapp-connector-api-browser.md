## DApp Connector API: Connecting a Browser dApp to Midnight

**Difficulty:** Intermediate  
**Time:** 40 minutes  
**Bounty:** #309

---

### Overview

The DApp Connector API allows browser-based dApps to communicate with the Midnight blockchain. This tutorial covers connecting a React frontend to a Midnight contract, handling wallet connections, signing transactions, and reacting to on-chain state changes.

### What You'll Learn

- Setting up the Midnight DApp Connector in a React app
- Connecting to a user's Midnight wallet
- Reading contract state from the frontend
- Sending transactions and listening for events
- Handling network changes and errors

### Prerequisites

- Node.js 18+ and npm/yarn
- React basics
- A deployed Midnight contract (use the shield token contract from [Tutorial #327])
- [Midnight Wallet](https://dev.midnight.network/wallet) browser extension installed

### Step 1: Project Setup

```bash
# Create a new React app with TypeScript
npx create-react-app midnight-dapp --template typescript
cd midnight-dapp

# Install the DApp Connector SDK
npm install @midnight-ntwrk/dapp-connector @midnight-ntwrk/compact-runtime
```

### Step 2: Initialize the Connector

```typescript
// src/lib/midnight.ts
import { DAppConnector } from "@midnight-ntwrk/dapp-connector";
import { CompactRuntime } from "@midnight-ntwrk/compact-runtime";

// Contract ABI (generated from compilation)
import contractArtifact from "../contracts/artifacts/shielded-token.json";

class MidnightService {
  private connector: DAppConnector | null = null;
  private runtime: CompactRuntime | null = null;
  private contract: any = null;

  /**
   * Initialize the Midnight DApp Connector.
   * Call this on app mount.
   */
  async initialize(): Promise<void> {
    // Check if wallet is installed
    if (!(window as any).midnight) {
      throw new Error(
        "Midnight Wallet not found. Please install the extension."
      );
    }

    this.connector = new DAppConnector({
      networkId: "testnet",   // or "mainnet"
      appName: "My Midnight DApp",
      appVersion: "1.0.0",
      contracts: [contractArtifact],
    });

    this.runtime = new CompactRuntime();
  }

  /**
   * Connect to the user's wallet.
   */
  async connectWallet(): Promise<string> {
    if (!this.connector) throw new Error("Connector not initialized");

    const accounts = await this.connector.connect();
    if (accounts.length === 0) {
      throw new Error("No accounts returned from wallet");
    }

    return accounts[0]; // Current wallet address
  }

  /**
   * Get the connected wallet address.
   */
  async getWalletAddress(): Promise<string | null> {
    if (!this.connector) return null;
    try {
      const accounts = await this.connector.getAccounts();
      return accounts[0] || null;
    } catch {
      return null;
    }
  }

  /**
   * Disconnect the wallet.
   */
  async disconnect(): Promise<void> {
    if (this.connector) {
      await this.connector.disconnect();
      this.connector = null;
    }
  }
}

export const midnightService = new MidnightService();
```

### Step 3: React Context Provider

```typescript
// src/context/MidnightContext.tsx
import React, { 
  createContext, useContext, useState, useEffect, 
  ReactNode, useCallback 
} from "react";
import { midnightService } from "../lib/midnight";

interface MidnightContextType {
  walletAddress: string | null;
  isConnecting: boolean;
  isConnected: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  contractState: any;
  refreshState: () => Promise<void>;
}

const MidnightContext = createContext<MidnightContextType>({
  walletAddress: null,
  isConnecting: false,
  isConnected: false,
  error: null,
  connect: async () => {},
  disconnect: async () => {},
  contractState: null,
  refreshState: async () => {},
});

export function MidnightProvider({ children }: { children: ReactNode }) {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contractState, setContractState] = useState<any>(null);

  // Initialize on mount
  useEffect(() => {
    midnightService.initialize()
      .then(() => midnightService.getWalletAddress())
      .then(addr => {
        if (addr) setWalletAddress(addr);
      })
      .catch(err => setError(err.message));
  }, []);

  const connect = useCallback(async () => {
    setIsConnecting(true);
    setError(null);
    try {
      const addr = await midnightService.connectWallet();
      setWalletAddress(addr);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    await midnightService.disconnect();
    setWalletAddress(null);
    setContractState(null);
  }, []);

  const refreshState = useCallback(async () => {
    try {
      // Query contract state via the connector
      const state = await midnightService.queryContractState();
      setContractState(state);
    } catch (err: any) {
      console.error("Failed to refresh state:", err);
    }
  }, []);

  return (
    <MidnightContext.Provider value={{
      walletAddress,
      isConnecting,
      isConnected: !!walletAddress,
      error,
      connect,
      disconnect,
      contractState,
      refreshState,
    }}>
      {children}
    </MidnightContext.Provider>
  );
}

export const useMidnight = () => useContext(MidnightContext);
```

### Step 4: Wallet Connect Button

```typescript
// src/components/WalletConnect.tsx
import React, { useState } from "react";
import { useMidnight } from "../context/MidnightContext";

export function WalletConnect() {
  const { 
    walletAddress, isConnected, isConnecting, 
    error, connect, disconnect 
  } = useMidnight();

  if (isConnected && walletAddress) {
    return (
      <div className="wallet-connected">
        <span className="address">
          {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
        </span>
        <button onClick={disconnect}>Disconnect</button>
      </div>
    );
  }

  return (
    <div className="wallet-connect">
      <button 
        onClick={connect} 
        disabled={isConnecting}
      >
        {isConnecting ? "Connecting..." : "Connect Wallet"}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
```

### Step 5: Reading Contract State

```typescript
// src/components/TokenBalance.tsx
import React, { useEffect, useState } from "react";
import { useMidnight } from "../context/MidnightContext";
import { midnightService } from "../lib/midnight";

export function TokenBalance() {
  const { isConnected, walletAddress } = useMidnight();
  const [balance, setBalance] = useState<string>("0");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isConnected || !walletAddress) return;

    async function fetchBalance() {
      setLoading(true);
      try {
        // Call the contract's balanceOf function
        const result = await midnightService.callContract(
          "balanceOf",
          [walletAddress]
        );
        setBalance(result.toString());
      } catch (err) {
        console.error("Failed to fetch balance:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchBalance();
    // Poll every 30 seconds
    const interval = setInterval(fetchBalance, 30000);
    return () => clearInterval(interval);
  }, [isConnected, walletAddress]);

  if (!isConnected) {
    return <p>Connect wallet to view balance</p>;
  }

  return (
    <div className="token-balance">
      <h3>Token Balance</h3>
      {loading ? (
        <p>Loading...</p>
      ) : (
        <p className="balance">{balance} tokens</p>
      )}
    </div>
  );
}
```

### Step 6: Sending Transactions

```typescript
// src/components/TransferForm.tsx
import React, { useState } from "react";
import { useMidnight } from "../context/MidnightContext";
import { midnightService } from "../lib/midnight";

export function TransferForm() {
  const { isConnected, refreshState } = useMidnight();
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<"idle" | "pending" | "success" | "error">("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleTransfer(e: React.FormEvent) {
    e.preventDefault();
    setStatus("pending");
    setErrorMsg(null);

    try {
      const result = await midnightService.callContract(
        "transfer",
        [recipient, amount]
      );
      
      setTxHash(result.transactionHash);
      setStatus("success");
      await refreshState(); // Update balance after transfer
    } catch (err: any) {
      setStatus("error");
      setErrorMsg(err.message || "Transfer failed");
    }
  }

  if (!isConnected) {
    return <p>Connect wallet to transfer tokens</p>;
  }

  return (
    <form onSubmit={handleTransfer} className="transfer-form">
      <h3>Transfer Tokens</h3>
      
      <input
        type="text"
        placeholder="Recipient address (hex)"
        value={recipient}
        onChange={e => setRecipient(e.target.value)}
        disabled={status === "pending"}
      />
      
      <input
        type="number"
        placeholder="Amount"
        value={amount}
        onChange={e => setAmount(e.target.value)}
        disabled={status === "pending"}
        min="1"
      />
      
      <button type="submit" disabled={status === "pending"}>
        {status === "pending" ? "Processing..." : "Transfer"}
      </button>

      {status === "success" && (
        <div className="success">
          Transfer submitted! TX: {txHash?.slice(0, 16)}...
        </div>
      )}
      
      {status === "error" && (
        <div className="error">{errorMsg}</div>
      )}
    </form>
  );
}
```

### Step 7: Transaction History

```typescript
// src/components/TxHistory.tsx
import React, { useEffect, useState } from "react";
import { useMidnight } from "../context/MidnightContext";

interface TxEvent {
  hash: string;
  type: "transfer" | "mint" | "burn";
  from: string;
  to: string;
  amount: string;
  timestamp: number;
}

export function TxHistory() {
  const { isConnected, contractState } = useMidnight();
  const [events, setEvents] = useState<TxEvent[]>([]);

  useEffect(() => {
    if (!isConnected || !contractState?.events) return;

    // Parse events from contract state
    const parsed: TxEvent[] = contractState.events
      .map((ev: any) => ({
        hash: ev.transactionHash,
        type: ev.name,
        from: ev.args.from,
        to: ev.args.to,
        amount: ev.args.amount.toString(),
        timestamp: ev.timestamp * 1000,
      }))
      .sort((a: TxEvent, b: TxEvent) => b.timestamp - a.timestamp)
      .slice(0, 20); // Last 20 events

    setEvents(parsed);
  }, [isConnected, contractState]);

  if (!isConnected) return null;

  return (
    <div className="tx-history">
      <h3>Transaction History</h3>
      {events.length === 0 ? (
        <p>No transactions yet</p>
      ) : (
        <ul>
          {events.map((ev, i) => (
            <li key={i}>
              <span className={`tx-type ${ev.type}`}>{ev.type}</span>
              <span className="tx-amount">{ev.amount}</span>
              <span className="tx-time">
                {new Date(ev.timestamp).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

### Step 8: Main App Integration

```typescript
// src/App.tsx
import React from "react";
import { MidnightProvider } from "./context/MidnightContext";
import { WalletConnect } from "./components/WalletConnect";
import { TokenBalance } from "./components/TokenBalance";
import { TransferForm } from "./components/TransferForm";
import { TxHistory } from "./components/TxHistory";

function App() {
  return (
    <MidnightProvider>
      <div className="app">
        <header>
          <h1>Midnight Shielded Token DApp</h1>
          <WalletConnect />
        </header>
        
        <main>
          <TokenBalance />
          <TransferForm />
          <TxHistory />
        </main>
      </div>
    </MidnightProvider>
  );
}

export default App;
```

### Step 9: Error Handling

```typescript
// src/lib/errors.ts

export enum MidnightErrorCode {
  WALLET_NOT_FOUND = "WALLET_NOT_FOUND",
  CONNECTION_REJECTED = "CONNECTION_REJECTED",
  NETWORK_MISMATCH = "NETWORK_MISMATCH",
  INSUFFICIENT_FUNDS = "INSUFFICIENT_FUNDS",
  TRANSACTION_FAILED = "TRANSACTION_FAILED",
  USER_REJECTED = "USER_REJECTED",
}

export function parseMidnightError(error: any): {
  code: MidnightErrorCode;
  message: string;
} {
  const msg = error?.message || String(error);
  
  if (msg.includes("wallet not found") || msg.includes("extension")) {
    return {
      code: MidnightErrorCode.WALLET_NOT_FOUND,
      message: "Please install the Midnight Wallet extension",
    };
  }
  
  if (msg.includes("rejected") || msg.includes("cancelled")) {
    return {
      code: MidnightErrorCode.USER_REJECTED,
      message: "Transaction was rejected",
    };
  }
  
  if (msg.includes("network") || msg.includes("chain")) {
    return {
      code: MidnightErrorCode.NETWORK_MISMATCH,
      message: "Please switch to the correct network",
    };
  }
  
  if (msg.includes("balance") || msg.includes("insufficient")) {
    return {
      code: MidnightErrorCode.INSUFFICIENT_FUNDS,
      message: "Insufficient token balance",
    };
  }
  
  return {
    code: MidnightErrorCode.TRANSACTION_FAILED,
    message: msg.slice(0, 100),
  };
}
```

### Testing the DApp

```bash
# Start the development server
npm start

# Build for production
npm run build

# Deploy to IPFS or your hosting provider
npx ipfs-deploy build
```

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| `midnight is not defined` | Wallet not installed | Prompt user to install Midnight Wallet |
| `User rejected` | User cancelled in wallet | Let user retry |
| `Network mismatch` | Wrong network selected | Auto-switch or prompt user |
| State not updating | Stale subscription | Call `refreshState` after transactions |

### Best Practices

1. **Optimistic UI**: Update UI immediately, revert on error
2. **Loading states**: Show spinners during wallet operations
3. **Error boundaries**: Wrap dApp in error boundary for wallet errors
4. **Auto-refresh**: Poll contract state every 30 seconds
5. **Event-driven**: Subscribe to contract events instead of polling when possible

### Next Steps

- Add event subscriptions for real-time updates
- Implement multi-contract interactions
- Add support for shielded (private) transactions
- Deploy to mainnet with proper error monitoring
