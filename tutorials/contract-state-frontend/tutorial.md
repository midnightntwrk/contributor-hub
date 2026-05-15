---
title: "Reading and Reacting to Contract State from a Frontend"
author: "billbtbillb"
date: 2026-05-16
tags: [midnight, typescript, react, graphql, smart-contracts, frontend, indexer]
difficulty: intermediate
---

# Reading and Reacting to Contract State from a Frontend

## Introduction

When building decentralized applications on the Midnight Network, one of the most common requirements is reading on-chain contract state from a frontend application and reacting to changes in real time. Whether you are building a dashboard that displays voting results, a wallet that tracks token balances, or a governance tool that monitors proposal status, you need a reliable way to query contract state and subscribe to live updates.

This tutorial walks you through the complete process of connecting a React/TypeScript frontend to a deployed Midnight smart contract. You will learn how to:

- Query contract state using the indexer GraphQL endpoint
- Use `indexerPublicDataProvider` to abstract GraphQL queries
- Subscribe to real-time state changes via WebSocket subscriptions
- Parse ledger fields from contract state
- Display live contract data in a React UI

By the end, you will have a working React application that reads contract state and updates automatically when on-chain data changes.

## Prerequisites

Before starting, ensure you have:

- **Node.js 18+** and npm or yarn installed
- **A running Midnight testnet node** with indexer access (see the [Midnight docs](https://docs.midnight.network/getting-started) for setup)
- **A deployed smart contract** on the Midnight testnet with a readable ledger
- **Basic familiarity** with React, TypeScript, and GraphQL

Required packages:

- `@midnight-ntwrk/midnight-js-client` — the core Midnight JS SDK
- `@apollo/client` — for GraphQL queries and subscriptions
- `graphql-ws` — for WebSocket-based GraphQL subscriptions
- `react` and `react-dom` — for the frontend framework

## Architecture Overview

The Midnight indexer exposes two interfaces for reading contract state:

1. **GraphQL HTTP endpoint** — for one-shot queries (polling or on-demand reads)
2. **GraphQL WebSocket endpoint** — for persistent subscriptions that push updates to your client

Your React frontend will use `indexerPublicDataProvider` from the Midnight JS SDK to interact with both endpoints. This provider wraps the raw GraphQL operations behind a clean TypeScript API.

The data flow:

```
Smart Contract (on-chain)
        |
        v
   Midnight Indexer
   (indexes blocks, exposes GraphQL)
        |
        v
   indexerPublicDataProvider
   (Midnight JS SDK abstraction)
        |
        v
   React Frontend
   (queries + WebSocket subscriptions)
```

## Step 1: Project Setup

Create a new React project with TypeScript:

```bash
npx create-react-app contract-state-viewer --template typescript
cd contract-state-viewer
```

Install the required dependencies:

```bash
npm install @midnight-ntwrk/midnight-js-client @apollo/client graphql graphql-ws
```

## Step 2: Configuring the Indexer Connection

Create `src/config.ts`:

```typescript
export const INDEXER_HTTP_URL =
  process.env.REACT_APP_INDEXER_HTTP_URL ?? "http://localhost:8088/v1/graphql";

export const INDEXER_WS_URL =
  process.env.REACT_APP_INDEXER_WS_URL ?? "ws://localhost:8088/v1/graphql";

export const CONTRACT_ADDRESS =
  process.env.REACT_APP_CONTRACT_ADDRESS ?? "";
```

Create a `.env` file:

```env
REACT_APP_INDEXER_HTTP_URL=http://localhost:8088/v1/graphql
REACT_APP_INDEXER_WS_URL=ws://localhost:8088/v1/graphql
REACT_APP_CONTRACT_ADDRESS=0200abc123...your-contract-address
```

## Step 3: Creating the indexerPublicDataProvider

Create `src/providers/indexerProvider.ts`:

```typescript
import { INDEXER_HTTP_URL, INDEXER_WS_URL } from "../config";
import {
  ApolloClient,
  InMemoryCache,
  HttpLink,
  split,
} from "@apollo/client";
import { GraphQLWsLink } from "@apollo/client/link/subscriptions";
import { createClient } from "graphql-ws";
import { getMainDefinition } from "@apollo/client/utilities";

const httpLink = new HttpLink({ uri: INDEXER_HTTP_URL });

const wsLink = new GraphQLWsLink(
  createClient({
    url: INDEXER_WS_URL,
    connectionParams: () => ({}),
    shouldRetry: () => true,
    retryAttempts: 10,
    retryWait: (retries) =>
      new Promise((resolve) =>
        setTimeout(resolve, Math.min(1000 * 2 ** retries, 30000))
      ),
  })
);

const splitLink = split(
  ({ query }) => {
    const definition = getMainDefinition(query);
    return (
      definition.kind === "OperationDefinition" &&
      definition.operation === "subscription"
    );
  },
  wsLink,
  httpLink
);

export const apolloClient = new ApolloClient({
  link: splitLink,
  cache: new InMemoryCache(),
});
```

This creates a single Apollo Client that routes subscriptions over WebSocket and everything else over HTTP. The retry logic reconnects dropped WebSocket connections automatically.
## Step 4: Querying Contract State via GraphQL

The Midnight indexer exposes contract state through GraphQL queries. Each deployed contract has its state indexed under the `contractState` or `ledger` tables.

### Defining the Queries

Create `src/graphql/queries.ts`:

```typescript
import { gql } from "@apollo/client";

export const GET_CONTRACT_LEDGER = gql`
  query GetContractLedger($contractAddress: String!) {
    contract_state(where: { contract_address: { _eq: $contractAddress } }) {
      contract_address
      ledger_state
      created_at
      updated_at
    }
  }
`;

export const CONTRACT_ACTIONS_SUBSCRIPTION = gql`
  subscription OnContractActions($contractAddress: String!) {
    contractActions(contractAddress: $contractAddress) {
      transactionHash
      actionType
      timestamp
      ledgerDiff
    }
  }
`;
```

### Writing the Query Hook

Create `src/hooks/useContractState.ts`:

```typescript
import { useQuery } from "@apollo/client";
import { GET_CONTRACT_LEDGER } from "../graphql/queries";
import { CONTRACT_ADDRESS } from "../config";

export interface LedgerState {
  contract_address: string;
  ledger_state: string;
  created_at: string;
  updated_at: string;
}

export interface ContractStateResult {
  data: LedgerState | null;
  loading: boolean;
  error: Error | undefined;
  refetch: () => void;
}

export function useContractState(
  contractAddress: string = CONTRACT_ADDRESS
): ContractStateResult {
  const { data, loading, error, refetch } = useQuery(GET_CONTRACT_LEDGER, {
    variables: { contractAddress },
    skip: !contractAddress,
    pollInterval: 30000, // Fallback: poll every 30 seconds
  });

  const ledger: LedgerState | null = data?.contract_state?.[0] ?? null;

  return { data: ledger, loading, error, refetch };
}
```

This hook queries the indexer for the latest ledger state. The `pollInterval` provides a fallback when WebSocket subscriptions are unavailable.

## Step 5: Real-Time Updates via WebSocket Subscriptions

The real power of the Midnight indexer is pushing updates to your frontend whenever contract state changes via GraphQL subscriptions over WebSocket.

### Creating the Subscription Hook

Create `src/hooks/useContractActions.ts`:

```typescript
import { useRef, useState } from "react";
import { useSubscription } from "@apollo/client";
import { CONTRACT_ACTIONS_SUBSCRIPTION } from "../graphql/queries";
import { CONTRACT_ADDRESS } from "../config";

export interface ContractAction {
  transactionHash: string;
  actionType: string;
  timestamp: string;
  ledgerDiff: string;
}

export interface ContractActionsResult {
  actions: ContractAction[];
  latestAction: ContractAction | null;
  loading: boolean;
  error: Error | undefined;
}

export function useContractActions(
  contractAddress: string = CONTRACT_ADDRESS
): ContractActionsResult {
  const [actions, setActions] = useState<ContractAction[]>([]);
  const latestRef = useRef<ContractAction | null>(null);

  const { loading, error } = useSubscription(
    CONTRACT_ACTIONS_SUBSCRIPTION,
    {
      variables: { contractAddress },
      skip: !contractAddress,
      onData: ({ data: subscriptionData }) => {
        const action = subscriptionData?.data?.contractActions;
        if (action) {
          latestRef.current = action;
          setActions((prev) => [action, ...prev].slice(0, 100));
        }
      },
    }
  );

  return {
    actions,
    latestAction: latestRef.current,
    loading,
    error,
  };
}
```

The `onData` callback fires every time the indexer pushes a new `contractActions` event, updating the rolling history and storing the latest action for immediate access.

### Why Subscriptions Over Polling?

- **Latency**: Polling only sees changes when the poll fires; subscriptions react within milliseconds.
- **Wasted requests**: Most polls return identical data. Subscriptions only fire on actual changes.
- **Server load**: Every client polling independently multiplies indexer traffic.

WebSocket subscriptions solve all three problems.

## Step 6: Parsing Ledger Fields

The `ledger_state` field is a JSON-encoded string containing contract ledger fields defined by your Compact smart contract's `ledger` block.

Example Compact ledger:

```compact
ledger {
  proposal: Bytes<32>;
  votes_for: Counter;
  votes_against: Counter;
  deadline: Opaque<Instant>;
}
```

Create `src/utils/parseLedger.ts`:

```typescript
export interface VotingLedger {
  proposal: string;
  votes_for: number;
  votes_against: number;
  deadline: string;
}

export function parseVotingLedger(rawLedgerState: string): VotingLedger {
  try {
    const parsed = JSON.parse(rawLedgerState);
    return {
      proposal: parsed.proposal ?? "0x0",
      votes_for: Number(parsed.votes_for ?? 0),
      votes_against: Number(parsed.votes_against ?? 0),
      deadline: parsed.deadline ?? "unknown",
    };
  } catch (err) {
    console.error("Failed to parse ledger state:", err);
    return { proposal: "0x0", votes_for: 0, votes_against: 0, deadline: "unknown" };
  }
}

export function parseLedgerDiff(rawDiff: string): Partial<VotingLedger> {
  try {
    return JSON.parse(rawDiff);
  } catch (err) {
    console.error("Failed to parse ledger diff:", err);
    return {};
  }
}
```

The parsing strategy is defensive: malformed JSON or missing fields return sensible defaults instead of crashing.
## Step 7: Displaying Contract State in React Components

### ContractStatePanel Component

Create `src/components/ContractStatePanel.tsx`:

```typescript
import React from "react";
import { useContractState } from "../hooks/useContractState";
import { parseVotingLedger } from "../utils/parseLedger";

export const ContractStatePanel: React.FC = () => {
  const { data, loading, error, refetch } = useContractState();
  if (loading) return <div className="panel">Loading contract state...</div>;
  if (error) return (<div className="panel error"><p>Error: {error.message}</p><button onClick={refetch}>Retry</button></div>);
  if (!data) return <div className="panel">No contract state found.</div>;
  const ledger = parseVotingLedger(data.ledger_state);
  return (
    <div className="panel">
      <h2>Contract State</h2>
      <p><strong>Address:</strong> {data.contract_address}</p>
      <p><strong>Proposal:</strong> {ledger.proposal}</p>
      <p><strong>Votes For:</strong> {ledger.votes_for}</p>
      <p><strong>Votes Against:</strong> {ledger.votes_against}</p>
      <p><strong>Deadline:</strong> {ledger.deadline}</p>
      <p><strong>Last Updated:</strong> {data.updated_at}</p>
      <button onClick={refetch}>Refresh</button>
    </div>
  );
};
```

### LiveActionsFeed Component

Create `src/components/LiveActionsFeed.tsx`:

```typescript
import React from "react";
import { useContractActions } from "../hooks/useContractActions";
import { parseLedgerDiff } from "../utils/parseLedger";

export const LiveActionsFeed: React.FC = () => {
  const { actions, latestAction, loading, error } = useContractActions();
  if (loading) return <div className="feed">Connecting to live feed...</div>;
  if (error) return <div className="feed error">Error: {error.message}</div>;
  return (
    <div className="feed">
      <h2>Live Contract Actions</h2>
      {latestAction && (
        <div className="latest-action">
          <h3>Latest Action</h3>
          <p><strong>Type:</strong> {latestAction.actionType}</p>
          <p><strong>Tx:</strong> {latestAction.transactionHash}</p>
          <p><strong>Time:</strong> {latestAction.timestamp}</p>
        </div>
      )}
      <h3>Recent History</h3>
      {actions.length === 0 ? (
        <p>No actions received yet. Waiting for contract events...</p>
      ) : (
        <ul>
          {actions.map((action, idx) => (
            <li key={`${action.transactionHash}-${idx}`}>
              <span>{action.actionType}</span> <span>{action.transactionHash.slice(0, 12)}...</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
```

### App Component

Wire it together in `src/App.tsx`:

```typescript
import React from "react";
import { ApolloProvider } from "@apollo/client";
import { apolloClient } from "./providers/indexerProvider";
import { ContractStatePanel } from "./components/ContractStatePanel";
import { LiveActionsFeed } from "./components/LiveActionsFeed";
import "./App.css";

const App: React.FC = () => (
  <ApolloProvider client={apolloClient}>
    <div className="app">
      <h1>Midnight Contract State Viewer</h1>
      <p>Connected: <code>{process.env.REACT_APP_CONTRACT_ADDRESS}</code></p>
      <div className="dashboard">
        <ContractStatePanel />
        <LiveActionsFeed />
      </div>
    </div>
  </ApolloProvider>
);

export default App;
```

## Step 8: Error Handling and Resilience

### Reconnection Logic

The `createClient` config includes retry logic. For silent subscription failures, add a heartbeat check:

```typescript
import { useEffect, useState } from "react";

export function useSubscriptionHealth(lastEventTime: string | null, timeoutMs = 120000): boolean {
  const [isStale, setIsStale] = useState(false);
  useEffect(() => {
    if (!lastEventTime) return;
    const check = setInterval(() => {
      const elapsed = Date.now() - new Date(lastEventTime).getTime();
      setIsStale(elapsed > timeoutMs);
    }, 10000);
    return () => clearInterval(check);
  }, [lastEventTime, timeoutMs]);
  return isStale;
}
```

### Graceful Degradation

If WebSocket drops, fall back to increased polling using Apollo's `startPolling`/`stopPolling` to dynamically adjust the interval based on subscription health.

## Step 9: Testing the Integration


### Manual Testing

1. Start your Midnight testnet node and indexer
2. Deploy a test contract with a readable ledger
3. Set RECT_APP_CONTRACT_ADDRESS in `.env`
4. Run `npm start` and verify state displays
5. Submit a transaction modifying the ledger
6. Confirm `LiveActionsFeed` shows the new action within seconds


### Automated Testing

Write unit tests for the ledger parser

`` `typescript
// src/utils/__tests__/parseLedger.test.ts
import { parseVotingLedger, parseLedgerDiff } from "../parseLedger";

describe("parseVotingLed ger", () => {
  it("parses valid JSON", () => {
    const raw = JSON.stringify({ proposal: "0xabc", votes_for: 42, votes_against: 7 });
    expect(parseVotingLegger(raw).votes_for).toBe(42);
  });

  it("returns defaults on malformed JSON", () => {
    expect(parseVotingLedger("bad").votes_for).toBe(0);
  });

  it("handles missing fields", () => {
    const r = parseVotingLedger(JSON.stringify({ votes_for: 10 }));
    expect(r.votes_against).toBe(0);
  });
});
```


## Deep Dive: Understanding the Indexer GraphQL Schema

Before writing your frontend code, it helps to understand what the Midnight indexer exposes. The indexer watches every block produced by the network, extracts contract-related data, and stores it in a queryable database accessible via GraphQL.

### Key Types

The indexer schema typically includes these core types relevant to contract state:

- **`contract_state`**: The current state of a deployed contract. Contains the contract address, the JSON-encoded ledger state, and timestamps for when the state was created and last updated.
- **`contractActions`** (subscription): A real-time feed of actions (transactions) that modify contract state. Each action includes the transaction hash, action type, a timestamp, and a `ledgerDiff` showing exactly which ledger fields changed.
- **`transactions`**: Historical transaction data for a contract, useful for building audit logs or transaction explorers.

### Querying Multiple Contracts

If your dApp interacts with multiple contracts, you can batch queries:

```typescript
const GET_MULTIPLE_STATES = gql`
  query GetMultipleStates($addresses: [String!]!) {
    contract_state(where: { contract_address: { _in: $addresses } }) {
      contract_address
      ledger_state
      updated_at
    }
  }
`;
```

This is more efficient than making separate queries for each contract, especially when you have a list of contract addresses from a factory or registry pattern.

## Advanced: Combining Queries and Subscriptions

The real power comes from combining initial query data with live subscription updates. Here is a pattern that fetches the current state on mount, then switches to subscription-only updates:

```typescript
import { useEffect, useState } from "react";
import { useQuery, useSubscription } from "@apollo/client";
import { GET_CONTRACT_LEDGER, CONTRACT_ACTIONS_SUBSCRIPTION } from "../graphql/queries";
import { CONTRACT_ADDRESS } from "../config";

export function useLiveContractState(contractAddress: string = CONTRACT_ADDRESS) {
  const [state, setState] = useState<any>(null);

  // Fetch initial state via query
  const { data: queryData, loading: queryLoading } = useQuery(GET_CONTRACT_LEDGER, {
    variables: { contractAddress },
    skip: !contractAddress,
  });

  // Subscribe to updates
  const { data: subData, loading: subLoading } = useSubscription(
    CONTRACT_ACTIONS_SUBSCRIPTION,
    {
      variables: { contractAddress },
      skip: !contractAddress,
    }
  );

  // Set initial state from query
  useEffect(() => {
    if (queryData?.contract_state?.[0]) {
      setState(queryData.contract_state[0]);
    }
  }, [queryData]);

  // Update state when subscription fires
  useEffect(() => {
    if (subData?.contractActions?.ledgerDiff) {
      setState((prev: any) => {
        if (!prev) return prev;
        const diff = JSON.parse(subData.contractActions.ledgerDiff);
        const currentLedger = JSON.parse(prev.ledger_state);
        const updatedLedger = { ...currentLedger, ...diff };
        return { ...prev, ledger_state: JSON.stringify(updatedLedger), updated_at: subData.contractActions.timestamp };
      });
    }
  }, [subData]);

  return {
    state,
    loading: queryLoading && !state,
    isLive: !subLoading,
  };
}
```

This pattern ensures the UI shows data immediately (from the query) and then stays current (from the subscription). The `isLive` flag lets you show a connection indicator in your UI.

## Working with the Midnight Wallet Provider

While this tutorial focuses on reading state, a complete dApp also needs to write state. The Midnight JS SDK provides a wallet provider that handles transaction signing and submission. When combined with the indexer provider, you get a full read-write loop:

```typescript
import { WalletProvider } from "@midnight-ntwrk/midnight-js-client";

// Initialize wallet provider (requires user to connect their wallet)
const walletProvider = await WalletProvider.create({
  networkId: "testnet",
});

// Submit a transaction that modifies contract state
const txHash = await walletProvider.submitTransaction({
  contractAddress: CONTRACT_ADDRESS,
  method: "vote",
  args: { support: true },
});

// The indexer will pick up this transaction and push a subscription event
// Your useContractActions hook will receive it automatically
```

The beauty of this architecture is that you do not need to manually refresh state after submitting a transaction. The indexer indexes the transaction, detects the ledger change, and pushes a subscription event to all connected clients. Your React UI updates automatically.

## Security Considerations

When building frontends that interact with smart contracts, keep these security practices in mind:

- **Validate contract addresses**: Always verify that the contract address you are querying matches the expected deployment. Malicious actors could deploy contracts with the same interface but different behavior.
- **Sanitize displayed data**: Ledger fields may contain user-provided data. Always sanitize before rendering to prevent XSS attacks.
- **Use environment variables**: Never hardcode contract addresses or indexer URLs in your source code. Use environment variables and provide sensible defaults only for development.
- **Handle connection failures gracefully**: If the indexer is down or the WebSocket connection drops, your UI should degrade gracefully. Show cached data with a staleness indicator rather than an error screen.
- **Rate limiting**: If you are building a public-facing application, consider adding rate limiting on your GraphQL queries to prevent abuse.

## Performance Considerations

- **Subscription limits:** The indexer may cap concurrent WebSocket connections. For many contracts, consider multiplexing or a backend aggregator.
- **History size:** The rolling actions array is capped at 100 entries. Adjust per your UI needs.
- **Cache normalization:** Apollo's InMemoryCache normalizes by __typename__ and id. Ensure queries return unique identifier fields.
- **Bundle size:** @apollo/client is ~30KB zlipped. For smaller bundles, consider urql or raw fetch with graphql-ws.

## Summary

In this tutorial, you learned how to:

1. **Configure** a connection to the Midnight indexer using Apollo Client with HTTP and WebSocket links
2. **Query** contract ledger state using GraphQL queries and the `useQuery` hook
3. **Subscribe** to real-time contract actions via WebSocket using `useSubscription` and the `contractActions` subscription
4. **Parse JSON-encoded indexer responses**
5. **Display** contract state and live action feeds in React components
6. **Handle errors** with reconnection logic, graceful degradation to polling, and subscription health monitoring

The `indexerPublicDataProvider` pattern gives you a clean abstraction over the indexer GraphQL interface, while direct Apollo hooks provide full control over queries and subscriptions. Together, they form a robust foundation for any frontend that reads and reacts to Midnight contract state.

## Next Steps

- **Extend the contract:** Add more ledger fields and update the parser
- **Add write operations:** Use the wallet provider to submit transactions that modify state
- **Deploy to production:** Use environment-specific `.env` files for testnet and mainnet
- **Explore [Midnight MCP](https://www.npmjs.com/package/midnight-mcp):** Additional contract interaction patterns

## Resources

- [Midnight Developer Documentation](https://docs.midnight.network/getting-started)
- [Midnight MCP on npm](https://www.npmjs.com/package/midnight-mcp)
- [Midnight Developer Forum](https://forum.midnight.network)
- [Midnight Discord](https://discord.com/invite/midnightnetwork)
- [Apollo Client Documentation](https://www.apollographql.com/docs/react/)


