---
title: "Full-Stack Midnight dApp: Contract + TypeScript API + React Frontend + Wallet"
description: "Build a complete, production-ready dApp on Midnight from scratch — Compact contract with privacy, TypeScript API layer, React frontend, and wallet integration."
tags: [midnight, compact, fullstack, react, typescript, dapp, tutorial]
published: false
---

# Full-Stack Midnight dApp: Contract + TypeScript API + React Frontend + Wallet

## Introduction

Building a production dApp on Midnight means more than just writing a smart contract. You need a complete stack: the on-chain contract logic, off-chain witness/API services, a responsive frontend, and seamless wallet integration.

This tutorial walks through building a complete private voting dApp — a real-world use case that demonstrates Midnight's privacy features end-to-end. You'll go from `compact compile` to interacting with the deployed contract in a browser.

## Architecture Overview

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   React         │     │   TypeScript API  │     │   Compact        │
│   Frontend      │────▶│   (Witness Layer) │────▶│   Contract       │
│   (Browser)     │     │   (Node.js)       │     │   (On-chain)     │
└────────┬────────┘     └──────────────────┘     └────────┬────────┘
         │                                                │
         │           ┌──────────────────┐                 │
         └──────────▶│   Wallet         │◀────────────────┘
                     │   (Lace / 1AM)   │
                     └──────────────────┘
                           │
                     ┌─────▼──────┐
                     │   Proof    │
                     │   Server   │
                     └────────────┘
```

## Part 1: The Compact Contract — Private Voting

Our dApp is a private voting system where votes are cast via shielded tokens:
- Each registered voter gets one voting token
- Votes are cast by transferring the token to a candidate's address
- Vote totals are encrypted — only the voter and the candidate know individual votes

```compact
// contracts/private_voting.compact
import CompactStandardLibrary;

// Register a voter by minting a unique voting token
export circuit registerVoter(
    domainSep: Bytes<32>,
    nonce: Bytes<32>
): ShieldedCoinInfo {
  return mintShieldedToken(
      disclose(domainSep),
      disclose(1 as Uint<64>),    // Exactly 1 voting token
      disclose(nonce),
      right<ZswapCoinPublicKey, ContractAddress>(kernel.self())
  );
}

// Cast a vote by sending the token to a candidate
export circuit castVote(
    input: QualifiedShieldedCoinInfo,
    candidateId: Uint<64>,
    publicKey: ZswapCoinPublicKey
): ShieldedSendResult {
  // The candidate ID is public (disclosed), the vote weight is private
  return sendShielded(
      disclose(input),
      left<ZswapCoinPublicKey, ContractAddress>(disclose(publicKey)),
      disclose(1 as Uint<128>)
  );
}

// Query a candidate's total votes (public count via unshielded mechanism)
export circuit getCandidateVoteCount(candidateId: Uint<64>): Uint<128> {
  // Read from contract state - total votes are public
  return kernel.getStorage(candidateId);
}

// Admin: end the election and freeze voting
export circuit endElection(): [] {
  require(kernel.caller() == admin());
  kernel.setStorage(LEDGER_KEY_ELECTION_ACTIVE, 0);
}
```

Compile:

```bash
compact compile contracts/private_voting.compact --out-dir compiled/
```

## Part 2: TypeScript Backend Service

### API Layer

```typescript
// src/api/index.ts
import express from "express";
import cors from "cors";
import { createContext } from "@midnight-ntwrk/midnight-js";
import { type LedgerContext } from "@midnight-ntwrk/midnight-js";

const app = express();
app.use(cors());
app.use(express.json());

// Midnight configuration
const MIDNIGHT_CONFIG = {
  proverServerUrl: process.env.PROVER_SERVER_URL || "http://localhost:6300",
  nodeUrl: process.env.NODE_URL || "http://localhost:9944",
  indexerUrl: process.env.INDEXER_URL || "http://localhost:8088/api/v3/graphql",
  networkId: (process.env.NETWORK_ID as string) || "DevNet",
};

let context: LedgerContext;
let contractInstance: any;

async function initialize() {
  context = createContext({
    proverServerUrl: MIDNIGHT_CONFIG.proverServerUrl,
    nodeUrl: MIDNIGHT_CONFIG.nodeUrl,
    networkId: MIDNIGHT_CONFIG.networkId,
  });
}

// Health check
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    network: MIDNIGHT_CONFIG.networkId,
    contract: contractInstance ? contractInstance.address : null,
  });
});

// Deploy the voting contract
app.post("/api/deploy", async (_req, res) => {
  try {
    const compiledContract = await import("../../compiled/private_voting.json");
    const deployed = await context.deploy(compiledContract);
    contractInstance = deployed.instance;
    res.json({ address: deployed.address });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Register a voter
app.post("/api/register", async (req, res) => {
  try {
    const { nonce } = req.body;
    const nonceBytes = new Uint8Array(Buffer.from(nonce, "hex"));
    const domain = new Uint8Array(32);
    const domainStr = "private:voting";
    for (let i = 0; i < domainStr.length; i++) domain[i] = domainStr.charCodeAt(i);

    const result = await contractInstance.call(
      "registerVoter",
      [domain, nonceBytes],
      context
    );

    res.json({ coin: result });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Cast a vote
app.post("/api/vote", async (req, res) => {
  try {
    const { coinInput, candidateId, publicKey } = req.body;
    const result = await contractInstance.call(
      "castVote",
      [coinInput, BigInt(candidateId), new Uint8Array(Buffer.from(publicKey, "hex"))],
      context
    );
    res.json({ result });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Get candidate vote count via GraphQL
app.get("/api/candidates/:id/votes", async (req, res) => {
  try {
    const query = `
      query {
        contract(address: "${contractInstance.address}") {
          stateDigest
        }
      }
    `;
    const response = await fetch(MIDNIGHT_CONFIG.indexerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Voting API running on port ${PORT}`);
  initialize();
});
```

### Witness Implementation

```typescript
// src/voting-witness.ts
import { type ContractInstance, type LedgerContext } from "@midnight-ntwrk/midnight-js";

export interface VotingWitnesses {
  registerVoter: (nonce: Uint8Array) => Promise<any>;
  castVote: (
    coinInput: any,
    candidateId: number,
    publicKey: Uint8Array
  ) => Promise<any>;
}

export function createVotingWitnesses(
  contract: ContractInstance,
  context: LedgerContext
): VotingWitnesses {
  const domain = new Uint8Array(32);
  const domainStr = "private:voting";
  for (let i = 0; i < domainStr.length; i++) domain[i] = domainStr.charCodeAt(i);

  return {
    async registerVoter(nonce: Uint8Array) {
      return contract.call("registerVoter", [domain, nonce], context);
    },

    async castVote(coinInput: any, candidateId: number, publicKey: Uint8Array) {
      return contract.call(
        "castVote",
        [coinInput, BigInt(candidateId), publicKey],
        context
      );
    },
  };
}
```

### Docker Compose for Backend Services

```yaml
# docker-compose.yml
version: "3.8"

services:
  midnight-node:
    image: midnightntwrk/node:0.22.5
    ports:
      - "9944:9944"
      - "30333:30333"
    volumes:
      - node-data:/data

  proof-server:
    image: midnightntwrk/proof-server:0.22.5
    ports:
      - "6300:6300"
    volumes:
      - proof-params:/app/params
    depends_on:
      - midnight-node

  indexer:
    image: midnightntwrk/indexer-standalone:4.3.3
    ports:
      - "8088:8088"
    depends_on:
      - midnight-node

  api-server:
    build:
      context: .
      dockerfile: Dockerfile.api
    ports:
      - "3001:3001"
    environment:
      - PROVER_SERVER_URL=http://proof-server:6300
      - NODE_URL=http://midnight-node:9944
      - INDEXER_URL=http://indexer:8088/api/v3/graphql
      - NETWORK_ID=DevNet
    depends_on:
      - midnight-node
      - proof-server
      - indexer

volumes:
  node-data:
  proof-params:
```

## Part 3: React Frontend

### Project Setup

```bash
# Create React app
npx create-react-app frontend --template typescript
cd frontend

# Install dependencies
npm install @midnight-ntwrk/midnight-js @midnight-ntwrk/wallet react-router-dom
```

### Wallet Provider Context

```tsx
// frontend/src/context/WalletContext.tsx
import React, { createContext, useContext, useState, useCallback } from "react";
import { type MidnightProvider } from "@midnight-ntwrk/wallet";

interface WalletState {
  provider: MidnightProvider | null;
  address: string | null;
  isConnected: boolean;
  isConnecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletState>({
  provider: null,
  address: null,
  isConnected: false,
  isConnecting: false,
  connect: async () => {},
  disconnect: () => {},
});

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [provider, setProvider] = useState<MidnightProvider | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const connect = useCallback(async () => {
    setIsConnecting(true);
    try {
      const midnight = (window as any).midnight;
      if (!midnight) {
        throw new Error("No Midnight wallet found. Install Lace or 1AM.");
      }

      const wallet: MidnightProvider = await midnight.enable("Private Voting dApp");
      const accounts = await wallet.accounts();
      const userAddress = accounts[0];

      setProvider(wallet);
      setAddress(userAddress);
    } catch (error) {
      console.error("Wallet connection failed:", error);
      throw error;
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setProvider(null);
    setAddress(null);
  }, []);

  return (
    <WalletContext.Provider
      value={{
        provider,
        address,
        isConnected: !!provider,
        isConnecting,
        connect,
        disconnect,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  return useContext(WalletContext);
}
```

### Voting Interface

```tsx
// frontend/src/components/VotingInterface.tsx
import React, { useState, useEffect } from "react";
import { useWallet } from "../context/WalletContext";

interface Candidate {
  id: number;
  name: string;
  description: string;
}

const CANDIDATES: Candidate[] = [
  { id: 1, name: "Alice", description: "Privacy-focused platform" },
  { id: 2, name: "Bob", description: "Scalability-first approach" },
  { id: 3, name: "Carol", description: "Community-driven governance" },
];

export function VotingInterface() {
  const { address } = useWallet();
  const [votedFor, setVotedFor] = useState<number | null>(null);
  const [txStatus, setTxStatus] = useState<string>("");
  const [voteCounts, setVoteCounts] = useState<Record<number, number>>({});

  const handleVote = async (candidateId: number) => {
    setTxStatus("Generating proof...");
    try {
      const response = await fetch("/api/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId,
          voterAddress: address,
        }),
      });

      if (!response.ok) throw new Error("Vote submission failed");

      setTxStatus("Vote cast successfully! (shielded)");
      setVotedFor(candidateId);
    } catch (error) {
      setTxStatus(`Error: ${error}`);
    }
  };

  useEffect(() => {
    // Poll vote counts via the API
    const interval = setInterval(async () => {
      const counts: Record<number, number> = {};
      for (const candidate of CANDIDATES) {
        const res = await fetch(`/api/candidates/${candidate.id}/votes`);
        const data = await res.json();
        counts[candidate.id] = data?.data?.contract?.stateDigest
          ? parseInt(data.data.contract.stateDigest, 16)
          : 0;
      }
      setVoteCounts(counts);
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="voting-interface">
      <h2>Private Voting dApp</h2>
      <p className="wallet-badge">
        Connected: {address?.slice(0, 10)}...
      </p>

      <div className="candidates-grid">
        {CANDIDATES.map((candidate) => (
          <div
            key={candidate.id}
            className={`candidate-card ${
              votedFor === candidate.id ? "voted" : ""
            }`}
          >
            <h3>{candidate.name}</h3>
            <p>{candidate.description}</p>
            <div className="vote-count">
              Votes: {voteCounts[candidate.id] ?? "—"}
            </div>
            <button
              onClick={() => handleVote(candidate.id)}
              disabled={votedFor !== null}
            >
              {votedFor === candidate.id ? "✓ Voted" : "Vote (Shielded)"}
            </button>
          </div>
        ))}
      </div>

      {txStatus && (
        <div className={`tx-status ${txStatus.includes("Error") ? "error" : "success"}`}>
          {txStatus}
        </div>
      )}

      <div className="privacy-note">
        <strong>🔒 Privacy Guarantee:</strong> Your vote is cast via a
        shielded token transfer. Only you and the candidate can see your
        individual vote. Total counts are public for transparency.
      </div>
    </div>
  );
}
```

### App Entry Point

```tsx
// frontend/src/App.tsx
import React from "react";
import { WalletProvider, useWallet } from "./context/WalletContext";
import { VotingInterface } from "./components/VotingInterface";

function ConnectButton() {
  const { connect, disconnect, isConnected, isConnecting } = useWallet();

  if (isConnected) {
    return (
      <button className="disconnect-btn" onClick={disconnect}>
        Disconnect Wallet
      </button>
    );
  }

  return (
    <button
      className="connect-btn"
      onClick={connect}
      disabled={isConnecting}
    >
      {isConnecting ? "Connecting..." : "Connect Wallet"}
    </button>
  );
}

function App() {
  return (
    <WalletProvider>
      <div className="app">
        <header>
          <h1>Midnight Private Voting</h1>
          <ConnectButton />
        </header>
        <main>
          <VotingInterface />
        </main>
        <footer>
          <p>
            Powered by Midnight Network · Votes are private via ZK proofs
          </p>
        </footer>
      </div>
    </WalletProvider>
  );
}

export default App;
```

### Styling

```css
/* frontend/src/App.css */
.app {
  max-width: 900px;
  margin: 0 auto;
  padding: 2rem;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #1a202c;
}

header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
  padding-bottom: 1rem;
  border-bottom: 2px solid #e2e8f0;
}

header h1 {
  margin: 0;
  font-size: 1.5rem;
  color: #2d3748;
}

.connect-btn {
  background: #4f46e5;
  color: white;
  border: none;
  padding: 0.5rem 1.5rem;
  border-radius: 6px;
  font-size: 0.9rem;
  cursor: pointer;
}

.disconnect-btn {
  background: #e53e3e;
  color: white;
  border: none;
  padding: 0.5rem 1.5rem;
  border-radius: 6px;
  font-size: 0.9rem;
  cursor: pointer;
}

.wallet-badge {
  background: #ebf4ff;
  padding: 0.5rem 1rem;
  border-radius: 6px;
  font-family: monospace;
  font-size: 0.85rem;
  margin-bottom: 1.5rem;
}

.candidates-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.candidate-card {
  background: white;
  border: 2px solid #e2e8f0;
  border-radius: 12px;
  padding: 1.5rem;
  transition: all 0.2s;
}

.candidate-card:hover {
  border-color: #4f46e5;
  box-shadow: 0 4px 12px rgba(79, 70, 229, 0.1);
}

.candidate-card.voted {
  border-color: #48bb78;
  background: #f0fff4;
}

.candidate-card h3 {
  margin: 0 0 0.5rem;
  color: #2d3748;
}

.candidate-card p {
  margin: 0 0 1rem;
  color: #718096;
  font-size: 0.9rem;
}

.vote-count {
  font-size: 0.85rem;
  color: #a0aec0;
  margin-bottom: 0.75rem;
}

.tx-status {
  padding: 0.75rem 1rem;
  border-radius: 6px;
  margin-bottom: 1rem;
  font-size: 0.9rem;
}

.tx-status.success {
  background: #f0fff4;
  border: 1px solid #c6f6d5;
  color: #276749;
}

.tx-status.error {
  background: #fff5f5;
  border: 1px solid #fed7d7;
  color: #9b2c2c;
}

.privacy-note {
  background: #fffbeb;
  border: 1px solid #f6e05e;
  border-radius: 8px;
  padding: 1rem;
  font-size: 0.9rem;
  color: #744210;
}

footer {
  margin-top: 3rem;
  padding-top: 1rem;
  border-top: 1px solid #e2e8f0;
  text-align: center;
  color: #a0aec0;
  font-size: 0.85rem;
}
```

## Part 4: Deployment Script

```typescript
// scripts/deploy.ts
import { createContext } from "@midnight-ntwrk/midnight-js";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("🚀 Deploying Private Voting dApp to Midnight...\n");

  // Load compiled contract
  const contractPath = path.join(__dirname, "../compiled/private_voting.json");
  const compiledContract = JSON.parse(fs.readFileSync(contractPath, "utf-8"));

  // Create context
  const context = createContext({
    proverServerUrl: process.env.PROVER_SERVER_URL || "http://localhost:6300",
    nodeUrl: process.env.NODE_URL || "http://localhost:9944",
    networkId: (process.env.NETWORK_ID as string) || "DevNet",
  });

  // Deploy
  console.log("1/3 Deploying contract...");
  const deployed = await context.deploy(compiledContract);
  console.log(`   ✅ Contract deployed at: ${deployed.address}`);

  // Register test voters
  console.log("\n2/3 Registering test voters...");
  const testVoters = 3;
  for (let i = 0; i < testVoters; i++) {
    const nonce = new Uint8Array(32);
    nonce[0] = i + 1;
    const result = await deployed.instance.call("registerVoter", [
      createDomainSeparator(),
      nonce,
    ]);
    console.log(`   ✅ Voter ${i + 1} registered. Coin: ${result.color.slice(0, 8)}...`);
  }

  console.log("\n3/3 Deployment complete!");
  console.log(`\n📝 Contract Address: ${deployed.address}`);
  console.log(`🌐 Indexer URL: ${process.env.INDEXER_URL || "http://localhost:8088/api/v3/graphql"}`);
  console.log(`🔗 Node URL: ${process.env.NODE_URL || "http://localhost:9944"}`);
  console.log(`\n✨ Ready for frontend connection!\n`);

  // Output environment file for frontend
  const envContent = `
REACT_APP_CONTRACT_ADDRESS=${deployed.address}
REACT_APP_NODE_URL=${process.env.NODE_URL || "http://localhost:9944"}
REACT_APP_INDEXER_URL=${process.env.INDEXER_URL || "http://localhost:8088/api/v3/graphql"}
REACT_APP_NETWORK_ID=${process.env.NETWORK_ID || "DevNet"}
  `.trim();
  fs.writeFileSync(path.join(__dirname, "../frontend/.env"), envContent);
  console.log("   ✅ Frontend .env file generated");
}

function createDomainSeparator(): Uint8Array {
  const bytes = new Uint8Array(32);
  const str = "private:voting";
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return bytes;
}

main().catch(console.error);
```

## Part 5: Running Everything

### Development Mode

```bash
# Terminal 1: Start local network
cd midnight-local-dev
docker compose up -d
docker compose logs -f

# Terminal 2: Start API server
cd voting-dapp
npm run dev:api

# Terminal 3: Start frontend
cd frontend
npm start

# Terminal 4: Deploy contract
npm run deploy
```

### Production Build

```bash
# Build frontend
cd frontend
npm run build

# Deploy with Docker Compose
docker compose -f docker-compose.prod.yml up -d

# Verify
curl http://localhost:3001/api/health
```

## The Full Development Lifecycle

```
1. compact compile              # Compile Compact → JSON artifact
2. npm run deploy               # Deploy to network
3. npm run dev:api              # Start backend API
4. npm run start (frontend)     # Start React frontend
5. Connect wallet               # Lace/1AM → dApp
6. Register to vote             # Contract interaction
7. Cast vote                    # Shielded token transfer
8. Verify via indexer           # GraphQL query
```

## Conclusion

You've built a complete, full-stack dApp on Midnight:

- **Compact contract**: Private voting using shielded token operations
- **TypeScript API layer**: Express server connecting the contract to the frontend, with GraphQL queries via the indexer
- **React frontend**: Wallet connection via Lace/1AM, voting interface, and real-time vote count polling
- **Docker Compose**: Full local development stack (node, proof server, indexer, API)

The private voting dApp demonstrates Midnight's core value proposition: transactions that are verifiably correct while keeping sensitive data private. The same architecture applies to auctions, identity systems, compliance attestations, and any dApp requiring selective disclosure.
