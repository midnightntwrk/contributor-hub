# Proof Server and Indexer: How Midnight Processes Transactions

## Introduction

The Midnight Network is a privacy-focused Layer 1 blockchain built on zero-knowledge (ZK) proofs, enabling developers to build decentralized applications (DApps) with programmable confidentiality. At the heart of Midnight's transaction processing are two critical components: the **proof server** and the **indexer**. Understanding how these components work together is essential for building robust, privacy-preserving applications on Midnight.

In this tutorial, we'll explore:
- The proof server's role in generating ZK proofs from circuit inputs
- Setting up a local development environment with Docker
- Understanding Docker tag versioning and ledger compatibility
- Working with the indexer's GraphQL API
- Implementing WebSocket subscriptions for real-time updates
- Choosing between `indexerPublicDataProvider` and direct indexer access

By the end of this tutorial, you'll have a complete understanding of how Midnight processes transactions and how to integrate these services into your DApp.

## Understanding the Proof Server

### What is the Proof Server?

The proof server is a critical component in Midnight's architecture that generates zero-knowledge proofs locally for your transactions. When you submit a transaction on Midnight, the proof server:

1. **Receives circuit inputs** from your wallet or DApp
2. **Generates ZK proofs** that prove the validity of your transaction without revealing private data
3. **Returns the proof** to be included in the on-chain transaction
4. **Enables privacy** by keeping sensitive information (token ownership, private state) off-chain

The proof server operates as a passive service—it doesn't initiate network connections but listens for requests from your wallet or application.

### Why Local Proof Generation Matters

Privacy is paramount in Midnight. The proof server processes sensitive information including:
- Private token balances
- DApp private state
- Transaction details that should remain confidential

For this reason, you should **only use proof servers you control**:
- Run locally during development
- Deploy on infrastructure you manage in production
- Always use encrypted channels (HTTPS/WSS) for remote connections

### Security Considerations

Never send private data to untrusted proof servers. Since the proof server sees all private inputs before generating proofs, using a third-party server would compromise your privacy guarantees. Think of it like entering your password—you wouldn't type it on someone else's computer.

## Setting Up Your Local Development Environment

### Prerequisites

Before we begin, ensure you have:
- **Docker Desktop** installed and running
- **Node.js** version 22.0.0 or higher
- **Git** for cloning repositories
- Basic familiarity with command-line tools

### Step 1: Clone the Midnight Local Development Repository

```bash
git clone https://github.com/midnightntwrk/midnight-local-dev.git
cd midnight-local-dev
npm install
```

This repository provides a complete local Midnight network with all necessary services pre-configured.

### Step 2: Understanding the Docker Services

The local development environment runs three Docker containers:

| Service | Port | Purpose |
|---------|------|---------|
| **Midnight Node** | 9944 | Blockchain node that processes and validates transactions |
| **Indexer** | 8088 | Indexes blockchain data and provides GraphQL/WebSocket APIs |
| **Proof Server** | 6300 | Generates ZK proofs for transactions |

Each service has specific endpoints:

```javascript
const endpoints = {
  node: 'http://localhost:9944',
  indexer: 'http://localhost:8088/api/v3/graphql',
  indexerWS: 'ws://localhost:8088/api/v3/graphql/ws',
  proofServer: 'http://localhost:6300'
};
```

### Step 3: Start the Local Network

```bash
npm start
```

This command will:
1. Pull the latest Docker images for all three services
2. Start containers with health checks
3. Initialize the genesis master wallet (holds all minted NIGHT tokens)
4. Display an interactive menu for funding test accounts

You should see output indicating all services are healthy:

```
✓ Midnight Node: Running on port 9944
✓ Indexer: Running on port 8088
✓ Proof Server: Running on port 6300
```

### Step 4: Fund Your Development Wallets

The local network provides two methods for funding test wallets:

**Method 1: Config File (Recommended for Multiple Wallets)**

Create a `wallets.json` file:

```json
{
  "wallets": [
    {
      "name": "Alice",
      "mnemonic": "your twelve word mnemonic phrase here for alice wallet"
    },
    {
      "name": "Bob",
      "mnemonic": "your twelve word mnemonic phrase here for bob wallet"
    }
  ]
}
```

The tool will automatically:
- Generate wallet addresses from mnemonics
- Transfer tokens from the master wallet
- Sync wallets with the indexer
- Register wallets for DUST (Midnight's UTXO model)

**Method 2: Public Key (Quick Testing)**

Enter up to 10 Bech32 addresses separated by commas. Each receives 50,000 tNIGHT:

```
Enter wallet addresses: tnight1abc...,tnight1def...,tnight1ghi...
```

**Important**: Recipients must manually register for DUST after receiving tokens.

## Docker Tag Versioning: Critical for Compatibility

### Understanding Version Matching

One of the most important aspects of running Midnight services is **version compatibility**. The Docker tag versions for your proof server, indexer, and node **must match your ledger version**.

Current versions (as of this writing):
- Node: `0.20.0`
- Indexer: `3.0.0`
- Proof Server: `7.0.0`

### Why Version Matching Matters

Midnight's ZK circuits evolve with each release. A proof generated by version 7.0.0 of the proof server may not be valid for a ledger running version 8.0.0. Mismatched versions can cause:

- **Transaction failures**: Proofs rejected by the network
- **Sync issues**: Indexer unable to parse new block formats
- **Runtime errors**: Incompatible API changes

### Checking Your Versions

**For Docker images:**

```bash
docker images | grep midnightntwrk
```

Output:
```
midnightntwrk/proof-server    7.0.0    abc123    2 weeks ago    1.2GB
midnightntwrk/indexer         3.0.0    def456    2 weeks ago    800MB
midnightntwrk/node            0.20.0   ghi789    2 weeks ago    1.5GB
```

**For running containers:**

```bash
docker ps --format "table {{.Names}}\t{{.Image}}"
```

### Updating to Match Ledger Versions

When Midnight releases a new version:

1. **Check the release notes** for breaking changes
2. **Pull new images**:
   ```bash
   docker pull midnightntwrk/proof-server:8.0.3
   docker pull midnightntwrk/indexer:3.1.0
   docker pull midnightntwrk/node:0.21.0
   ```
3. **Update your docker-compose.yml** or configuration
4. **Restart services** with the new versions

### Production Deployment Considerations

For production deployments:

- **Pin specific versions** in your infrastructure-as-code (don't use `latest`)
- **Test upgrades** in staging before production
- **Monitor compatibility** announcements in the [Midnight Developer Forum](https://forum.midnight.network/)
- **Use health checks** to verify services are running correctly after updates

Example Docker Compose snippet with pinned versions:

```yaml
services:
  proof-server:
    image: midnightntwrk/proof-server:8.0.3
    ports:
      - "6300:6300"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:6300/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

## Working with the Indexer

### What is the Indexer?

The indexer is a service that:
- **Monitors the blockchain** for new blocks and transactions
- **Indexes data** into a queryable database
- **Provides GraphQL API** for querying blockchain state
- **Offers WebSocket subscriptions** for real-time updates

Think of it as a search engine for the blockchain—instead of scanning every block manually, you query the indexer for the data you need.

### GraphQL Queries

The indexer exposes a GraphQL API at `http://localhost:8088/api/v3/graphql`. Let's explore common queries:

**Query 1: Get Latest Block**

```graphql
query GetLatestBlock {
  blocks(limit: 1, order_by: {height: desc}) {
    height
    hash
    timestamp
    transaction_count
  }
}
```

**Query 2: Get Account Balance**

```graphql
query GetAccountBalance($address: String!) {
  accounts(where: {address: {_eq: $address}}) {
    address
    balance
    nonce
    last_updated
  }
}
```

Variables:
```json
{
  "address": "tnight1abc123..."
}
```

**Query 3: Get Transaction History**

```graphql
query GetTransactionHistory($address: String!, $limit: Int!) {
  transactions(
    where: {
      _or: [
        {from_address: {_eq: $address}},
        {to_address: {_eq: $address}}
      ]
    },
    order_by: {block_height: desc},
    limit: $limit
  ) {
    hash
    from_address
    to_address
    amount
    block_height
    timestamp
    status
  }
}
```

### Making GraphQL Requests from Your DApp

**Using fetch API:**

```javascript
async function queryIndexer(query, variables = {}) {
  const response = await fetch('http://localhost:8088/api/v3/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      variables
    })
  });
  
  const { data, errors } = await response.json();
  
  if (errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(errors)}`);
  }
  
  return data;
}

// Usage
const latestBlock = await queryIndexer(`
  query {
    blocks(limit: 1, order_by: {height: desc}) {
      height
      hash
    }
  }
`);

console.log('Latest block:', latestBlock.blocks[0]);
```

**Using Apollo Client (Recommended for React apps):**

```javascript
import { ApolloClient, InMemoryCache, gql } from '@apollo/client';

const client = new ApolloClient({
  uri: 'http://localhost:8088/api/v3/graphql',
  cache: new InMemoryCache()
});

const GET_BALANCE = gql`
  query GetBalance($address: String!) {
    accounts(where: {address: {_eq: $address}}) {
      balance
    }
  }
`;

// In your component
const { data, loading, error } = useQuery(GET_BALANCE, {
  variables: { address: userAddress }
});
```

## WebSocket Subscriptions for Real-Time Updates

### Why Use WebSockets?

Polling the indexer repeatedly is inefficient. WebSocket subscriptions allow your DApp to receive real-time updates when blockchain state changes.

Use cases:
- **Live balance updates** when tokens are received
- **Transaction status changes** from pending to confirmed
- **New block notifications** for block explorers
- **DApp state changes** for collaborative applications

### Setting Up WebSocket Subscriptions

**Subscription 1: Watch for New Blocks**

```graphql
subscription OnNewBlock {
  blocks(limit: 1, order_by: {height: desc}) {
    height
    hash
    timestamp
    transaction_count
  }
}
```

**Subscription 2: Monitor Account Balance**

```graphql
subscription WatchBalance($address: String!) {
  accounts(where: {address: {_eq: $address}}) {
    address
    balance
    last_updated
  }
}
```

**Subscription 3: Track Transaction Status**

```graphql
subscription TrackTransaction($txHash: String!) {
  transactions(where: {hash: {_eq: $txHash}}) {
    hash
    status
    block_height
    confirmations
  }
}
```

### Implementing WebSocket Subscriptions in JavaScript

**Using native WebSocket:**

```javascript
class MidnightSubscription {
  constructor(url = 'ws://localhost:8088/api/v3/graphql/ws') {
    this.url = url;
    this.ws = null;
    this.subscriptions = new Map();
  }
  
  connect() {
    this.ws = new WebSocket(this.url, 'graphql-ws');
    
    this.ws.onopen = () => {
      // Send connection init
      this.ws.send(JSON.stringify({ type: 'connection_init' }));
    };
    
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      
      if (message.type === 'data' && message.id) {
        const callback = this.subscriptions.get(message.id);
        if (callback) {
          callback(message.payload.data);
        }
      }
    };
    
    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }
  
  subscribe(id, query, variables, callback) {
    this.subscriptions.set(id, callback);
    
    this.ws.send(JSON.stringify({
      id,
      type: 'start',
      payload: {
        query,
        variables
      }
    }));
  }
  
  unsubscribe(id) {
    this.ws.send(JSON.stringify({
      id,
      type: 'stop'
    }));
    this.subscriptions.delete(id);
  }
  
  disconnect() {
    this.ws.close();
  }
}

// Usage
const subscription = new MidnightSubscription();
subscription.connect();

subscription.subscribe(
  'balance-watch',
  `subscription WatchBalance($address: String!) {
    accounts(where: {address: {_eq: $address}}) {
      balance
    }
  }`,
  { address: 'tnight1abc...' },
  (data) => {
    console.log('Balance updated:', data.accounts[0].balance);
    updateUI(data.accounts[0].balance);
  }
);
```

**Using Apollo Client (Simpler):**

```javascript
import { useSubscription, gql } from '@apollo/client';

const BALANCE_SUBSCRIPTION = gql`
  subscription OnBalanceChange($address: String!) {
    accounts(where: {address: {_eq: $address}}) {
      balance
      last_updated
    }
  }
`;

function BalanceDisplay({ address }) {
  const { data, loading } = useSubscription(BALANCE_SUBSCRIPTION, {
    variables: { address }
  });
  
  if (loading) return <div>Connecting...</div>;
  
  return (
    <div>
      Balance: {data.accounts[0].balance} tNIGHT
    </div>
  );
}
```

## indexerPublicDataProvider vs Direct Indexer Access

### Understanding the Options

Midnight provides two ways to interact with the indexer:

1. **indexerPublicDataProvider**: A high-level abstraction provided by the Midnight SDK
2. **Direct indexer access**: Raw GraphQL queries to the indexer API

### When to Use indexerPublicDataProvider

The `indexerPublicDataProvider` is a convenience wrapper that:
- **Simplifies common operations** (get balance, check transaction status)
- **Handles connection management** automatically
- **Provides type safety** with TypeScript
- **Abstracts GraphQL complexity** for simple use cases

**Example:**

```javascript
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer';

const provider = indexerPublicDataProvider({
  indexerUri: 'http://localhost:8088/api/v3/graphql',
  indexerWsUri: 'ws://localhost:8088/api/v3/graphql/ws'
});

// Simple balance check
const balance = await provider.getBalance('tnight1abc...');
console.log('Balance:', balance);

// Transaction status
const tx = await provider.getTransaction('0x123...');
console.log('Status:', tx.status);
```

**Pros:**
- Quick to implement
- Less boilerplate code
- Built-in error handling
- Maintained by Midnight team

**Cons:**
- Limited to predefined operations
- Less flexibility for custom queries
- May not expose all indexer features

### When to Use Direct Indexer Access

Use direct GraphQL queries when you need:
- **Custom queries** not covered by the provider
- **Complex filtering** and aggregations
- **Batch operations** for efficiency
- **Full control** over query optimization

**Example:**

```javascript
// Complex query: Get top 10 accounts by balance with transaction count
const query = `
  query GetTopAccounts {
    accounts(
      order_by: {balance: desc},
      limit: 10
    ) {
      address
      balance
      transactions_aggregate {
        aggregate {
          count
        }
      }
    }
  }
`;

const result = await fetch('http://localhost:8088/api/v3/graphql', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query })
}).then(r => r.json());
```

**Pros:**
- Full flexibility
- Access to all indexer features
- Optimized queries for your specific needs
- Can use advanced GraphQL features (fragments, aliases, etc.)

**Cons:**
- More code to write
- Need to handle errors manually
- Must understand GraphQL syntax
- Requires more testing

### Recommendation

**Start with indexerPublicDataProvider** for basic operations. As your DApp grows and you need more complex queries, **migrate to direct access** for those specific use cases. You can use both approaches in the same application.

## Putting It All Together: A Complete Example

Let's build a simple transaction monitor that demonstrates all concepts:

```javascript
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer';

class TransactionMonitor {
  constructor(config) {
    this.config = config;
    this.provider = indexerPublicDataProvider({
      indexerUri: config.indexer,
      indexerWsUri: config.indexerWS
    });
    this.ws = null;
  }
  
  async initialize() {
    // Check proof server health
    const proofServerHealth = await fetch(`${this.config.proofServer}/health`);
    console.log('Proof server:', proofServerHealth.ok ? '✓' : '✗');
    
    // Check indexer health
    const indexerHealth = await fetch(`${this.config.indexer.replace('/graphql', '/health')}`);
    console.log('Indexer:', indexerHealth.ok ? '✓' : '✗');
    
    // Setup WebSocket for real-time updates
    this.setupWebSocket();
  }
  
  setupWebSocket() {
    this.ws = new WebSocket(this.config.indexerWS, 'graphql-ws');
    
    this.ws.onopen = () => {
      this.ws.send(JSON.stringify({ type: 'connection_init' }));
      console.log('WebSocket connected');
    };
    
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'data') {
        this.handleUpdate(message.payload.data);
      }
    };
  }
  
  async getAccountInfo(address) {
    // Use provider for simple operations
    const balance = await this.provider.getBalance(address);
    
    // Use direct query for complex data
    const query = `
      query GetAccountDetails($address: String!) {
        accounts(where: {address: {_eq: $address}}) {
          balance
          nonce
          transactions_aggregate {
            aggregate {
              count
            }
          }
        }
      }
    `;
    
    const response = await fetch(this.config.indexer, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { address } })
    });
    
    const { data } = await response.json();
    
    return {
      balance,
      nonce: data.accounts[0].nonce,
      txCount: data.accounts[0].transactions_aggregate.aggregate.count
    };
  }
  
  subscribeToNewBlocks(callback) {
    const subscription = `
      subscription {
        blocks(limit: 1, order_by: {height: desc}) {
          height
          hash
          timestamp
        }
      }
    `;
    
    this.ws.send(JSON.stringify({
      id: 'blocks',
      type: 'start',
      payload: { query: subscription }
    }));
    
    this.handleUpdate = callback;
  }
}

// Usage
const monitor = new TransactionMonitor({
  indexer: 'http://localhost:8088/api/v3/graphql',
  indexerWS: 'ws://localhost:8088/api/v3/graphql/ws',
  node: 'http://localhost:9944',
  proofServer: 'http://localhost:6300'
});

await monitor.initialize();

const accountInfo = await monitor.getAccountInfo('tnight1abc...');
console.log('Account:', accountInfo);

monitor.subscribeToNewBlocks((data) => {
  console.log('New block:', data.blocks[0].height);
});
```

## Troubleshooting Common Issues

### Port Conflicts

**Problem**: Services fail to start due to port conflicts.

**Solution**:
```bash
# Stop existing containers
docker compose -f standalone.yml down

# Or kill processes using the ports
lsof -ti:6300 | xargs kill -9
lsof -ti:8088 | xargs kill -9
lsof -ti:9944 | xargs kill -9
```

### Invalid Wallet Address

**Problem**: "Invalid address" error when funding wallets.

**Solution**: Ensure you're using **Undeployed network** addresses (starting with `tnight1`), not Preprod addresses. Configure your Lace wallet to use the Undeployed network in Settings.

### Slow Wallet Sync

**Problem**: Wallet takes forever to sync.

**Solution**:
```bash
# Check indexer logs
docker logs midnight-indexer

# Verify node is producing blocks
curl http://localhost:9944/health

# Check if indexer is caught up
curl http://localhost:8088/api/v3/health
```

### Proof Generation Fails

**Problem**: Transactions fail with "proof generation error".

**Solution**:
1. Verify proof server is running: `curl http://localhost:6300/health`
2. Check version compatibility between proof server and ledger
3. Ensure proof server has sufficient resources (RAM/CPU)
4. Review proof server logs: `docker logs midnight-proof-server`

## Conclusion

Understanding how Midnight processes transactions through the proof server and indexer is fundamental to building privacy-preserving DApps. In this tutorial, we covered:

- ✅ The proof server's role in generating ZK proofs locally
- ✅ Setting up a complete local development environment with Docker
- ✅ The critical importance of version matching between services
- ✅ Querying blockchain data with GraphQL
- ✅ Implementing real-time updates with WebSocket subscriptions
- ✅ Choosing between `indexerPublicDataProvider` and direct indexer access

With this knowledge, you're ready to build sophisticated DApps on Midnight that leverage zero-knowledge proofs for privacy while maintaining the transparency and verifiability of blockchain technology.

## Next Steps

- Explore the [Midnight Documentation](https://docs.midnight.network/) for advanced topics
- Join the [Midnight Developer Forum](https://forum.midnight.network/) to connect with other builders
- Check out the [Midnight MCP](https://www.npmjs.com/package/midnight-mcp) for additional tooling
- Join the [Discord community](https://discord.com/invite/midnightnetwork) for real-time support

Happy building on Midnight! 🌙

---

**Sources:**
- [Midnight Local Network Guide](https://docs.midnight.network/guides/midnight-local-network)
- [Run Proof Server Documentation](https://docs.midnight.network/guides/run-proof-server)
- [Zero-Knowledge Proofs on Midnight](https://docs.midnight.network/learn/understanding-midnights-technology/zero-knowledge-proofs)
- [Midnight Playground Repository](https://github.com/0xshae/midnight-playground)
- [Midnight Infrastructure Setup](https://lobehub.com/skills/uvroxx-midnight-agent-skills-midnight-infra-setup)
