# Reading and Reacting to Contract State from a Frontend

A practical guide to querying and subscribing to Midnight contract state from a React/TypeScript frontend using the Midnight Indexer GraphQL API and `indexerPublicDataProvider`.

---

## Table of Contents

1. [The Problem with On-Chain State](#1-the-problem-with-on-chain-state)
2. [Midnight's Indexer Architecture](#2-midnights-indexer-architecture)
3. [GraphQL Endpoint Overview](#3-graphql-endpoint-overview)
4. [Setting Up indexerPublicDataProvider](#4-setting-up-indexerpublicdataprovider)
5. [Querying Ledger State Fields](#5-querying-ledger-state-fields)
6. [WebSocket Subscriptions with contractActions](#6-websocket-subscriptions-with-contractactions)
7. [Displaying Contract State in a UI](#7-displaying-contract-state-in-a-ui)
8. [Error Handling and Reconnection Strategies](#8-error-handling-and-reconnection-strategies)
9. [Code Examples](#9-code-examples)
10. [Best Practices for Frontend/Contract State Synchronization](#10-best-practices-for-frontendcontract-state-synchronization)
11. [Working Demo Outline](#11-working-demo-outline)

---

## 1. The Problem with On-Chain State

Midnight is a privacy-preserving blockchain. Smart contracts on Midnight have two kinds of state:

| State Type | Stored On-Chain? | Accessible To | How to Read |
|---|---|---|---|
| **Private state** | No — encrypted locally | Only the user who holds the key | `getStates()` via `privateStateProvider` |
| **Ledger state** (public) | Yes — committed as hex-encoded bytes | Anyone with the contract address | Indexer GraphQL API |

Your frontend needs to read the **ledger state** — the public portion of a contract's data that is committed to the chain — to display things like poll results, leaderboard scores, or game state to all users. This tutorial shows you exactly how to do that.

---

## 2. Midnight's Indexer Architecture

The Midnight Indexer is a backend service that:

1. **Listens** to the Midnight blockchain for new blocks
2. **Parses** transactions and extracts contract actions (deploys, calls, updates)
3. **Indexes** the extracted data into a queryable, subscription-friendly store
4. **Serves** that data over a **GraphQL API (v4)**

### What the Indexer Indexes

The indexer extracts and stores:

- **Blocks** — hash, height, timestamp, parent, author, transactions
- **Transactions** — id, hash, status, fees, contract actions, inputs/outputs
- **Contract Actions** — deploys, calls, and updates for every contract
- **Unshielded balances** — token balances held by contracts
- **Shielded transaction events** — for wallet-session authenticated queries
- **DUST generation status** — for Cardano stake key addresses

### Why Use the Indexer?

Contract ledger state is stored as raw hex bytes (`HexEncoded`). You can't just read it like a JSON object — you need the indexer to deliver it, and you need your contract's own state schema to decode it. The indexer also gives you **real-time subscriptions**, so your UI updates automatically when the chain advances.

---

## 3. GraphQL Endpoint Overview

The Midnight Indexer exposes two endpoints:

### HTTP Endpoint — Queries & Mutations

```
POST https://<host>:<port>/api/v4/graphql
Content-Type: application/json
```

Use this for one-shot queries — fetching the current poll tally, looking up a contract's latest state, etc.

### WebSocket Endpoint — Subscriptions

```
wss://<host>:<port>/api/v4/graphql/ws
Sec-WebSocket-Protocol: graphql-transport-ws
```

Use this for real-time streams — live leaderboard updates, new poll votes, game moves.

### Key Queries

```graphql
# Get latest block
query { block { hash height timestamp } }

# Get a contract's current state
query {
  contractAction(address: "0xabcd...") {
    __typename
    ... on ContractCall { address state entryPoint }
  }
}

# Get transactions for a contract
query {
  contractActions(address: "0xabcd...") {
    __typename
    ... on ContractCall { address state entryPoint }
  }
}
```

### Key Subscriptions

```graphql
# Stream new blocks
subscription { blocks { hash height timestamp } }

# Stream contract updates for a specific address
subscription {
  contractActions(address: "0xabcd...") {
    __typename
    ... on ContractUpdate { address state }
  }
}
```

---

## 4. Setting Up indexerPublicDataProvider

The `@midnight-ntwrk/midnight-js-indexer-public-data-provider` package wraps the indexer GraphQL API with a clean TypeScript interface.

### Installation

```bash
npm install @midnight-ntwrk/midnight-js-indexer-public-data-provider
```

### Constructor

```typescript
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';

const queryUrl = 'https://indexer.testnet.midnight.network/api/v4/graphql';
const subscriptionUrl = 'wss://indexer.testnet.midnight.network/api/v4/graphql/ws';

const publicDataProvider = indexerPublicDataProvider(queryUrl, subscriptionUrl);
```

### Provider in the Midnight Provider Stack

When building a full Midnight dApp, you assemble a provider bundle:

```typescript
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';

const providers: MidnightProviders = {
  privateStateProvider: levelPrivateStateProvider({
    privateStoragePasswordProvider: () => password,
    accountId: walletAddress,
  }),
  publicDataProvider: indexerPublicDataProvider(queryUrl, subscriptionUrl),
  zkConfigProvider: new FetchZkConfigProvider(zkArtifactsUrl),
  proofProvider: httpClientProofProvider(proofServerUrl, zkConfigProvider),
  walletProvider,   // from @midnight-ntwrk/wallet-sdk-facade
  midnightProvider, // from @midnight-ntwrk/wallet-sdk-facade
};
```

> **Network endpoints:** On testnet, the public indexer endpoints are `https://indexer.testnet.midnight.network/api/v4/graphql` and `wss://indexer.testnet.midnight.network/api/v4/graphql/ws`. For mainnet, check the [Midnight docs](https://docs.midnight.network).

---

## 5. Querying Ledger State Fields

### The contractAction Query

The primary query for reading a contract's current state:

```graphql
query {
  contractAction(address: "30313233...") {
    __typename
    ... on ContractDeploy {
      address
      state
      zswapState
      unshieldedBalances { tokenType amount }
    }
    ... on ContractCall {
      address
      state
      entryPoint
      zswapState
      unshieldedBalances { tokenType amount }
    }
    ... on ContractUpdate {
      address
      state
      zswapState
      unshieldedBalances { tokenType amount }
    }
  }
}
```

### Using the TypeScript Provider

```typescript
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';

const publicDataProvider = indexerPublicDataProvider(queryUrl, subscriptionUrl);

// Query the latest state of a contract
const latestState = await publicDataProvider.query((`
  query GetContractState($address: HexEncoded!) {
    contractAction(address: $address) {
      __typename
      ... on ContractCall {
        address
        state
        entryPoint
        unshieldedBalances { tokenType amount }
      }
    }
  }
`), {
  address: contractAddress,
});

// The `state` field is a HexEncoded string — your contract determines how to decode it
console.log('Raw state bytes:', latestState.contractAction.state);
```

### Decoding Ledger State

The `state` field in every `ContractAction` is a hex-encoded string. How you decode it depends on your contract's state encoding. A common pattern is to use the Compact runtime types:

```typescript
import { fromHex } from '@midnight-ntwrk/midnight-js-utils';
import { StateValue, CompactTypeUnsignedInteger, addField } from '@midnight-ntwrk/compact-runtime';

// Example: decoding a state that is a record { voteCount: u32 }
function decodeVoteCount(hexState: string): bigint {
  const bytes = fromHex(hexState);
  // Contract-specific decoding logic here
  // The compact runtime provides `StateValue` and type constructors for this
  return stateValueToBigInt(decodeFromBytes(bytes));
}
```

If your contract exposes its state layout, the generated TypeScript types from the Compact compiler will include a state interface. Use those to drive the decoding.

### Querying Historical State

You can query contract state at a specific block:

```graphql
query {
  contractAction(
    address: "0xabcd..."
    offset: { blockOffset: { height: 100 } }
  ) {
    ... on ContractCall { state }
  }
}
```

Or at a specific transaction:

```graphql
query {
  contractAction(
    address: "0xabcd..."
    offset: { transactionOffset: { hash: "303132..." } }
  ) {
    ... on ContractCall { state }
  }
}
```

---

## 6. WebSocket Subscriptions with contractActions

### Why Subscriptions?

Polling (repeatedly querying) the indexer every few seconds is wasteful and slow. WebSocket subscriptions give you **push-based updates** the moment a new block is indexed.

### Subscription Setup

```typescript
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';

const publicDataProvider = indexerPublicDataProvider(queryUrl, subscriptionUrl);

const subscription = publicDataProvider.subscribe((`
  subscription WatchContract($address: HexEncoded!) {
    contractActions(address: $address) {
      __typename
      ... on ContractUpdate {
        address
        state
        transaction { hash block { height } }
      }
      ... on ContractCall {
        address
        state
        entryPoint
        transaction { hash block { height } }
      }
    }
  }
`), { address: contractAddress });

subscription.on('data', (result) => {
  const action = result.data.contractActions;
  console.log(`New ${action.__typename} at block ${action.transaction.block.height}`);
  console.log('New state:', action.state);

  // Update your UI state here
  setContractState(action.state);
});

subscription.on('error', (err) => {
  console.error('Subscription error:', err);
});
```

### Block-Level Subscriptions

To subscribe to all new blocks:

```typescript
const blockSub = publicDataProvider.subscribe((`
  subscription WatchBlocks {
    blocks {
      hash
      height
      timestamp
    }
  }
`), {});

blockSub.on('data', (result) => {
  const { hash, height, timestamp } = result.data.blocks;
  console.log(`New block #${height}:`, hash);
});
```

### Filtering by Entry Point

Most contracts have multiple entry points. You can filter which contract calls to receive using the `entryPoint` field (where supported by the indexer schema):

```graphql
subscription {
  contractActions(address: "0xabcd...") {
    __typename
    ... on ContractCall {
      entryPoint
      state
    }
  }
}
```

---

## 7. Displaying Contract State in a UI

### Polls

For a voting contract, the ledger state might encode `{ yes: u32, no: u32, total: u32 }`. Decode the hex state, then render:

```tsx
function PollResults({ hexState }: { hexState: string }) {
  const { yes, no, total } = decodePollState(hexState);

  return (
    <div>
      <div>
        <span>Yes: {yes}</span>
        <div style={{ width: `${(yes / total) * 100}%` }} />
      </div>
      <div>
        <span>No: {no}</span>
        <div style={{ width: `${(no / total) * 100}%` }} />
      </div>
      <p>Total votes: {total}</p>
    </div>
  );
}
```

### Leaderboards

A game leaderboard contract might store a sorted Merkle tree of scores. The ledger state is the Merkle root, and individual scores are private. You show only the publicly committed data:

```tsx
function LeaderboardEntry({ rank, address, score }: LeaderboardEntryProps) {
  return (
    <li>
      <span>#{rank}</span>
      <span>{formatAddress(address)}</span>
      <span>{score}</span>
    </li>
  );
}
```

### Live Game State

For a real-time game, subscribe to `contractActions` and update React state on each update:

```tsx
function GameBoard({ contractAddress }: { contractAddress: string }) {
  const [boardState, setBoardState] = useState<string | null>(null);

  useEffect(() => {
    const provider = indexerPublicDataProvider(queryUrl, subscriptionUrl);
    const sub = provider.subscribe(SUBSCRIPTION_QUERY, { address: contractAddress });

    sub.on('data', (result) => {
      const action = result.data.contractActions;
      if (action.__typename === 'ContractUpdate') {
        setBoardState(action.state);
      }
    });

    return () => sub.unsubscribe();
  }, [contractAddress]);

  if (!boardState) return <div>Loading...</div>;
  return <Board state={decodeBoardState(boardState)} />;
}
```

---

## 8. Error Handling and Reconnection Strategies

### Common Errors

| Error | Cause | Fix |
|---|---|---|
| `Connection refused` | Indexer is down or wrong URL | Verify endpoint URL; implement retry |
| `Invalid address` | Contract address not hex-encoded | Ensure address is a valid `HexEncoded` string |
| `Contract not found` | Address has no indexed actions | Check the contract has been deployed and indexed |
| `Subscription closed` | Network drop or server restart | Implement reconnection logic |
| `Decoding error` | `state` bytes don't match expected layout | Verify contract schema with the Compact compiler output |

### Retry with Exponential Backoff

```typescript
async function queryWithRetry<T>(
  provider: IndexerPublicDataProvider,
  query: string,
  variables: Record<string, unknown>,
  maxRetries = 3
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await provider.query<T>(query, variables);
    } catch (err) {
      lastError = err as Error;
      const delay = Math.min(1000 * 2 ** attempt, 10000);
      console.warn(`Query failed (attempt ${attempt + 1}), retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }

  throw new Error(`Query failed after ${maxRetries} retries: ${lastError?.message}`);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

### WebSocket Reconnection

```typescript
function createResilientSubscription(
  provider: IndexerPublicDataProvider,
  query: string,
  variables: Record<string, unknown>,
  onData: (data: unknown) => void,
  onError: (err: Error) => void
) {
  let active = true;
  let retryDelay = 1000;

  function connect() {
    if (!active) return;

    const sub = provider.subscribe(query, variables);

    sub.on('data', onData);
    sub.on('error', (err) => {
      console.warn(`Subscription error: ${err}. Reconnecting in ${retryDelay}ms...`);
      onError(err);
      sub.unsubscribe();
      setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 30000); // cap at 30s
    });
  }

  connect();

  return {
    unsubscribe: () => {
      active = false;
    },
  };
}
```

### Graceful Degradation

Always render something meaningful while reconnecting:

```tsx
function ContractStateView({ hexState, isConnected }: Props) {
  if (!isConnected) {
    return (
      <div className="disconnected">
        <p>⚠️ Live connection lost. Showing last known state.</p>
        <PollResults hexState={hexState ?? '0000'} />
      </div>
    );
  }
  return <PollResults hexState={hexState} />;
}
```

---

## 9. Code Examples

### React Hook: useContractState

```typescript
// hooks/useContractState.ts
import { useState, useEffect, useCallback, useRef } from 'react';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';

const QUERY_URL = import.meta.env.VITE_INDEXER_QUERY_URL;
const SUBSCRIPTION_URL = import.meta.env.VITE_INDEXER_SUBSCRIPTION_URL;

const CONTRACT_STATE_QUERY = (`
  query GetContractState($address: HexEncoded!) {
    contractAction(address: $address) {
      __typename
      ... on ContractCall {
        address
        state
        entryPoint
      }
    }
  }
`);

const CONTRACT_STATE_SUBSCRIPTION = (`
  subscription WatchContract($address: HexEncoded!) {
    contractActions(address: $address) {
      __typename
      ... on ContractCall { address state entryPoint }
      ... on ContractUpdate { address state }
    }
  }
`);

export function useContractState(contractAddress: string) {
  const [state, setState] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const providerRef = useRef(indexerPublicDataProvider(QUERY_URL, SUBSCRIPTION_URL));

  // Initial query
  useEffect(() => {
    let cancelled = false;

    providerRef.current
      .query(CONTRACT_STATE_QUERY, { address: contractAddress })
      .then((result) => {
        if (!cancelled && result.contractAction) {
          setState(result.contractAction.state);
          setIsConnected(true);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      });

    return () => {
      cancelled = true;
    };
  }, [contractAddress]);

  // Subscription for real-time updates
  useEffect(() => {
    const sub = providerRef.current.subscribe(CONTRACT_STATE_SUBSCRIPTION, {
      address: contractAddress,
    });

    sub.on('data', (result) => {
      const action = result.data.contractActions;
      setState(action.state);
      setIsConnected(true);
    });

    sub.on('error', (err) => {
      setError(err);
      setIsConnected(false);
    });

    return () => {
      sub.unsubscribe();
    };
  }, [contractAddress]);

  const refetch = useCallback(async () => {
    const result = await providerRef.current.query(CONTRACT_STATE_QUERY, {
      address: contractAddress,
    });
    if (result.contractAction) {
      setState(result.contractAction.state);
    }
  }, [contractAddress]);

  return { state, isConnected, error, refetch };
}
```

### WebSocket Subscription Manager Class

```typescript
// lib/contractSubscriptionManager.ts
import { indexerPublicDataProvider, IndexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';

export type SubscriptionEvent = {
  typename: string;
  address: string;
  state: string;
  entryPoint?: string;
  blockHeight?: number;
};

export class ContractSubscriptionManager {
  private provider: IndexerPublicDataProvider;
  private subscriptions = new Map<string, ReturnType<IndexerPublicDataProvider['subscribe']>>();
  private listeners = new Map<string, Set<(event: SubscriptionEvent) => void>>();
  private retryDelay = 1000;
  private active = true;

  constructor(queryUrl: string, subscriptionUrl: string) {
    this.provider = indexerPublicDataProvider(queryUrl, subscriptionUrl);
  }

  subscribe(
    contractAddress: string,
    listener: (event: SubscriptionEvent) => void
  ): () => void {
    if (!this.listeners.has(contractAddress)) {
      this.listeners.set(contractAddress, new Set());
      this.startSubscription(contractAddress);
    }

    this.listeners.get(contractAddress)!.add(listener);

    return () => {
      this.listeners.get(contractAddress)?.delete(listener);
      if (this.listeners.get(contractAddress)?.size === 0) {
        this.stopSubscription(contractAddress);
      }
    };
  }

  private startSubscription(contractAddress: string): void {
    const sub = this.provider.subscribe(
      (`
        subscription WatchContract($address: HexEncoded!) {
          contractActions(address: $address) {
            __typename
            ... on ContractUpdate { address state }
            ... on ContractCall { address state entryPoint }
          }
        }
      `),
      { address: contractAddress }
    );

    sub.on('data', (result) => {
      const action = result.data.contractActions;
      const event: SubscriptionEvent = {
        typename: action.__typename,
        address: action.address,
        state: action.state,
        entryPoint: action.entryPoint,
        blockHeight: action.transaction?.block?.height,
      };

      this.listeners.get(contractAddress)?.forEach((listener) => {
        listener(event);
      });
    });

    sub.on('error', (err) => {
      console.error(`[SubscriptionManager] Error for ${contractAddress}:`, err);
      setTimeout(() => {
        if (this.active) {
          this.startSubscription(contractAddress);
        }
      }, this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, 30000);
    });

    this.subscriptions.set(contractAddress, sub);
  }

  private stopSubscription(contractAddress: string): void {
    this.subscriptions.get(contractAddress)?.unsubscribe();
    this.subscriptions.delete(contractAddress);
    this.listeners.delete(contractAddress);
  }

  destroy(): void {
    this.active = false;
    this.subscriptions.forEach((sub) => sub.unsubscribe());
    this.subscriptions.clear();
    this.listeners.clear();
  }
}
```

### Decoding Helper

```typescript
// lib/decodeContractState.ts
import { fromHex } from '@midnight-ntwrk/midnight-js-utils';

/**
 * Decode a poll contract's ledger state.
 * Assumes the contract stores: { yes: u32, no: u32, total: u32 }
 * encoded as three consecutive little-endian u32 values.
 */
export interface PollState {
  yes: number;
  no: number;
  total: number;
}

export function decodePollState(hexState: string): PollState {
  const bytes = fromHex(hexState);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  return {
    yes: view.getUint32(0, true),       // little-endian
    no: view.getUint32(4, true),
    total: view.getUint32(8, true),
  };
}

/**
 * Encode a poll state into hex (for comparison/testing)
 */
export function encodePollState(poll: PollState): string {
  const buf = new ArrayBuffer(12);
  const view = new DataView(buf);
  view.setUint32(0, poll.yes, true);
  view.setUint32(4, poll.no, true);
  view.setUint32(8, poll.total, true);
  return Buffer.from(new Uint8Array(buf)).toString('hex');
}
```

---

## 10. Best Practices for Frontend/Contract State Synchronization

### 1. Always Show a Snapshot While Loading

Never leave the UI blank. Display the last known state immediately, then update when a fresh subscription event arrives. This is especially important on slow or unreliable connections.

### 2. Separate Ledger State from Private State

Ledger state (from the indexer) and private state (from `privateStateProvider`) serve different purposes. Your UI should compose both:

```typescript
const publicStates = await getPublicStates(providers, contractAddress);
const privateStates = await getStates(providers, contractAddress, privateStateId);
```

### 3. Decode in the Model Layer, Not in Components

Keep decoding logic in a dedicated module (`decodeContractState.ts`) so components stay clean and the decoding is testable in isolation.

### 4. Handle Multiple Contract Action Types

The `contractAction` query returns a union type. Always check `__typename`:

```typescript
function handleContractAction(action: ContractAction) {
  switch (action.__typename) {
    case 'ContractCall':
      return { state: action.state, entryPoint: action.entryPoint };
    case 'ContractUpdate':
      return { state: action.state };
    case 'ContractDeploy':
      return { state: action.state };
  }
}
```

### 5. Unsubscribe on Component Unmount

Every subscription must be cleaned up. React's `useEffect` return function or a `useRef` pattern for class-based managers handles this:

```typescript
useEffect(() => {
  const unsubscribe = subscriptionManager.subscribe(contractAddress, onUpdate);
  return unsubscribe; // React calls this on unmount
}, [contractAddress]);
```

### 6. Batch Multiple Contracts in One Subscription

GraphQL allows a single subscription to watch multiple addresses if your schema supports it. Otherwise, use one subscription per contract but consolidate listener management in a single `ContractSubscriptionManager` (as shown in section 9) to avoid creating duplicate connections.

### 7. Validate Hex State Before Decoding

A malformed `state` field will crash your decoder. Guard against empty strings, odd-length hex, and oversized payloads:

```typescript
export function isValidHexState(hex: string): boolean {
  return /^([0-9a-fA-F]{2})+$/.test(hex) && hex.length > 0;
}

export function safeDecodePollState(hex: string): PollState | null {
  if (!isValidHexState(hex)) return null;
  try {
    return decodePollState(hex);
  } catch {
    return null;
  }
}
```

### 8. Use `refetch` for Critical User Actions

After a user submits a transaction, call `refetch()` to get the latest state immediately rather than waiting for the next subscription event, which may be delayed by block time.

### 9. Keep Subscription Manager Instances at the App Level

Create one `ContractSubscriptionManager` per app (or per network), not per component. Reusing connections prevents resource exhaustion and reduces latency from repeated handshakes.

---

## 11. Working Demo Outline

### Project Structure

```
midnight-contract-state-demo/
├── src/
│   ├── lib/
│   │   ├── contractSubscriptionManager.ts   # WebSocket subscription manager
│   │   ├── decodeContractState.ts            # State decoding utilities
│   │   └── indexerProvider.ts               # Provider singleton
│   ├── hooks/
│   │   └── useContractState.ts              # React hook for contract state
│   ├── components/
│   │   ├── PollResults.tsx                  # Poll display component
│   │   ├── Leaderboard.tsx                  # Leaderboard component
│   │   └── ConnectionStatus.tsx             # Live/disconnected indicator
│   ├── App.tsx
│   └── main.tsx
├── .env
│   └── VITE_INDEXER_QUERY_URL=https://indexer.testnet.midnight.network/api/v4/graphql
│   └── VITE_INDEXER_SUBSCRIPTION_URL=wss://indexer.testnet.midnight.network/api/v4/graphql/ws
├── package.json
└── vite.config.ts
```

### Step-by-Step Demo Flow

1. **Deploy a poll contract** to testnet using the [Midnight quickstart](https://docs.midnight.network/getting-started). Note the contract address.

2. **Configure environment variables** in `.env` with the testnet indexer URL.

3. **Wire the provider:**
   ```typescript
   // src/lib/indexerProvider.ts
   import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
   export const provider = indexerPublicDataProvider(
     import.meta.env.VITE_INDEXER_QUERY_URL,
     import.meta.env.VITE_INDEXER_SUBSCRIPTION_URL,
   );
   ```

4. **Write the decoding layer** (`decodeContractState.ts`) to match the poll contract's ledger state layout.

5. **Build the React hook** (`useContractState.ts`) to query initial state and subscribe to updates.

6. **Render the UI** using `PollResults` and `ConnectionStatus` components.

7. **Interact**: Cast votes through the wallet (a separate transaction flow). Watch the poll tally update live in the browser.

8. **Test reconnection**: Toggle the network tab in DevTools to simulate a dropped connection. Verify the "last known state" appears with a warning banner, and that the subscription resumes automatically when the network returns.

---

## Quick Reference

| Need | How |
|---|---|
| Read current contract state | `contractAction(address: "...")` query |
| Decode state bytes | Contract-specific decoder + `fromHex()` |
| Get live updates | `contractActions(address: "...")` subscription |
| Historical state | Add `offset: { blockOffset: { height: N } }` |
| Multiple contracts | One `ContractSubscriptionManager` instance per app |
| Handle disconnection | Exponential backoff + last-known-state rendering |

---

## Further Reading

- [Midnight Docs — Getting Started](https://docs.midnight.network/getting-started)
- [Midnight Indexer API Reference](https://docs.midnight.network/api-reference/midnight-indexer.md)
- [Midnight.js API Reference](https://docs.midnight.network/api-reference/midnight-js.md)
- [Midnight Indexer Schema (v4)](https://github.com/midnightntwrk/midnight-indexer/blob/v4.0.1/indexer-api/graphql/schema-v4.graphql)
- [Midnight Compact Runtime API](https://docs.midnight.network/api-reference/compact-runtime.md)
- [Midnight Discord](https://discord.com/invite/midnightnetwork)
- [Midnight Forum](https://forum.midnight.network/)

---

> **Bounty:** Issue [#310](https://github.com/midnightntwrk/contributor-hub/issues/310)
> **Bounty Wallet:** `63Ar4MqMrYwj294ERD7ygT7xrZefAzzd6GqdGEMNX4JW`
