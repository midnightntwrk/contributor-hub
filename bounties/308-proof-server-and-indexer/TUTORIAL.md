---
title: "Proof Server and Indexer: How Midnight Processes Transactions"
description: "An in-depth look at Midnight's transaction processing pipeline — from proof generation to indexed blockchain data — with Docker setup, GraphQL queries, and WebSocket subscriptions."
tags: [midnight, proof-server, indexer, graphql, tutorial, infrastructure]
published: false
---

# Proof Server and Indexer: How Midnight Processes Transactions

## Introduction

Every transaction on Midnight goes through a multi-stage pipeline before it reaches end-user applications. Two critical infrastructure components — the **Proof Server** and the **Indexer** — handle the heavy lifting between raw blockchain data and usable application state.

This tutorial explains how both components work, how to set them up locally, and how to interact with them programmatically.

## Part 1: The Proof Server

### What It Does

The Proof Server generates zero-knowledge proofs from circuit inputs. When a user submits a shielded transaction, the proof server:

1. **Receives circuit witness data** from the client (compiled circuit inputs, public inputs, and private inputs)
2. **Loads circuit artifacts** (proving key, verification key, compiled circuit)
3. **Generates a ZK proof** — computationally intensive, especially for first-time use of a circuit
4. **Returns the proof** to the client, which attaches it to the transaction

### Docker Setup

The proof server runs as a Docker container. Here's how to set it up:

```yaml
# docker-compose.yml (proof server section)
version: "3.8"
services:
  proof-server:
    image: midnightntwrk/proof-server:0.22.5
    container_name: midnight-proof-server
    ports:
      - "6300:6300"
    environment:
      - RUST_LOG=info
      - PROOF_SERVER_PARAMS_DIR=/app/params
    volumes:
      - proof-server-params:/app/params
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:6300/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    deploy:
      resources:
        limits:
          cpus: '4'
          memory: '8G'

volumes:
  proof-server-params:
```

Start the proof server:

```bash
docker compose up -d proof-server

# Verify it's running
curl http://localhost:6300/health
# Expected: HTTP 200
```

### Configuration

Key environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `RUST_LOG` | `info` | Logging level (debug, info, warn, error) |
| `PROOF_SERVER_PARAMS_DIR` | `/app/params` | Directory for cached ZK parameters |
| `PROOF_SERVER_MAX_CONCURRENT` | `4` | Maximum concurrent proof generations |
| `PROOF_SERVER_TIMEOUT_SECS` | `600` | Max seconds for a single proof generation |

### Docker Tag Versioning

**Critical rule:** The proof server Docker image TAG must match your Midnight node's ledger version.

```bash
# Check the correct version from the compatibility matrix
# https://docs.midnight.network/relnotes/compatibility-matrix

# Pull the correct version
docker pull midnightntwrk/proof-server:0.22.5

# List available tags
curl -s "https://hub.docker.com/v2/repositories/midnightntwrk/proof-server/tags?page_size=10" | \
  python3 -c "import sys,json; [print(t['name']) for t in json.load(sys.stdin)['results']]"
```

## Part 2: The Indexer

### What It Does

The Midnight Indexer is a set of components that optimize the flow of blockchain data from a Midnight node to end-user applications. It:

- **Retrieves block history** from the Midnight node
- **Processes and indexes** transaction data for efficient querying
- **Provides a GraphQL API** for queries and real-time subscriptions
- **Maintains a searchable database** of contracts, transactions, and state

### Indexer Components

The indexer suite includes several Docker images:

| Component | Docker Image | Purpose |
|-----------|-------------|---------|
| Chain Indexer | `midnightntwrk/chain-indexer` | Processes raw blocks into indexed data |
| Indexer API | `midnightntwrk/indexer-api` | GraphQL endpoint for queries |
| Wallet Indexer | `midnightntwrk/wallet-indexer` | Wallet-specific transaction indexing |
| Standalone Indexer | `midnightntwrk/indexer-standalone` | All-in-one for local dev |

### Docker Setup

```yaml
# docker-compose.yml (indexer section)
services:
  indexer:
    image: midnightntwrk/indexer-standalone:4.3.3
    container_name: midnight-indexer
    ports:
      - "8088:8088"
    environment:
      - MIDNIGHT_INDEXER_NODE_URL=http://midnight-node:9944
      - MIDNIGHT_INDEXER_DATABASE_URL=sqlite:///app/data/indexer.db
    volumes:
      - indexer-data:/app/data
    depends_on:
      - midnight-node
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8088/health"]
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  indexer-data:
```

### GraphQL Queries

The indexer exposes a GraphQL endpoint at `http://localhost:8088/graphql`. Here are essential queries:

#### Querying Contract State

```graphql
{
  contracts(first: 10) {
    edges {
      node {
        id
        address
        stateDigest
        lastExecutedAt
      }
    }
  }
}
```

#### Querying Transaction History

```graphql
{
  transactions(
    first: 20,
    orderBy: BLOCK_NUMBER_DESC
  ) {
    edges {
      node {
        id
        blockNumber
        sender
        success
        errorMessage
      }
    }
  }
}
```

#### Querying Specific Contract

```graphql
{
  contract(address: "0x1234...") {
    id
    address
    stateDigest
    lastExecutedAt
    transactions(first: 10) {
      edges {
        node {
          id
          blockNumber
          success
        }
      }
    }
  }
}
```

#### Filtering by Block Range

```graphql
{
  transactions(
    filter: {
      blockNumber: {
        greaterThanOrEqualTo: 1000,
        lessThanOrEqualTo: 2000
      }
    }
  ) {
    totalCount
    edges {
      node {
        id
        blockNumber
        sender
      }
    }
  }
}
```

### WebSocket Subscriptions

For real-time updates, the indexer supports GraphQL subscriptions over WebSocket.

#### Contract State Changes

```graphql
subscription {
  contractActions(contractAddress: "0x1234...") {
    id
    actionType
    blockNumber
    contractState {
      stateDigest
    }
  }
}
```

#### New Transactions

```graphql
subscription {
  newTransactions {
    id
    blockNumber
    sender
    success
  }
}
```

#### Block Header Updates

```graphql
subscription {
  newBlocks {
    number
    hash
    timestamp
    transactionCount
  }
}
```

### Using indexerPublicDataProvider

The `indexerPublicDataProvider` is the recommended way to access indexer data from Midnight dApps. It wraps the GraphQL endpoint with a typed JavaScript/TypeScript API:

```typescript
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js";

// Configure the provider
const provider = indexerPublicDataProvider({
  indexerUrl: "http://localhost:8088/api/v3/graphql",
});

// Query contract state
const state = await provider.queryContractState(
  "0x1234..."
);

// Subscribe to updates
const subscription = provider.subscribeContractState(
  "0x1234...",
  (state) => {
    console.log("Contract state updated:", state);
  }
);

// Clean up
subscription.unsubscribe();
```

### Direct Indexer Access vs indexerPublicDataProvider

| Aspect | Direct GraphQL | indexerPublicDataProvider |
|--------|---------------|---------------------------|
| Control | Full query flexibility | Simplified API |
| Type safety | Raw JSON responses | Typed TypeScript responses |
| Setup complexity | Build your own queries | Zero-config integration |
| Advanced queries | Custom filters, aggregations | Common query patterns only |
| Best for | Custom dashboards, analytics | Standard dApp development |

## Part 3: The Full Transaction Flow

Here's how a complete transaction flows through the system:

```
1. User Action (dApp frontend)
       │
       ▼
2. Transaction Builder (Midnight.js SDK)
   - Collects circuit witness data
   - Builds transaction payload
       │
       ▼
3. Proof Server (port 6300)
   - Generates ZK proof from witness
   - Returns proof to client
       │
       ▼
4. Midnight Node (port 9944)
   - Submits transaction with proof
   - Validates and includes in block
       │
       ▼
5. Block Production
   - Transaction is included in a block
   - Block is added to the chain
       │
       ▼
6. Indexer
   - Reads new block from node
   - Indexes transaction data
   - Updates GraphQL database
       │
       ▼
7. End-User Application
   - Queries indexed data via GraphQL
   - Or receives real-time updates via WebSocket
```

## Complete Local Development Setup

```bash
# 1. Clone and start the entire local network
git clone https://github.com/midnightntwrk/midnight-local-dev.git
cd midnight-local-dev

# 2. Configure environment
cp .env.example .env
# Edit .env if needed

# 3. Start everything
docker compose up -d

# 4. Verify all services
curl http://localhost:6300/health    # Proof server
curl http://localhost:8088/health    # Indexer
curl http://localhost:9944/health    # Node

# 5. Check configurations
cat << 'EOF' > midnight-config.json
{
  "proverServerUrl": "http://localhost:6300",
  "walletServerUrl": "http://localhost:3000",
  "indexerUrl": "http://localhost:8088/api/v3/graphql",
  "nodeUrl": "http://localhost:9944",
  "networkId": "DevNet"
}
EOF
```

## Monitoring and Maintenance

### Health Check Dashboard

```bash
#!/bin/bash
echo "=== Midnight Infrastructure Health ==="
printf "%-20s %s\n" "Service" "Status"
printf "%-20s %s\n" "---" "---"

for svc in "midnight-node:9944" "midnight-proof-server:6300" "midnight-indexer:8088"; do
  name="${svc%%:*}"
  port="${svc##*:}"
  status=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:$port/health 2>/dev/null || echo "down")
  printf "%-20s %s\n" "$name" "$([ "$status" = "200" ] && echo "✅ UP" || echo "❌ DOWN ($status)")"
done
```

### Log Management

```bash
# View real-time logs
docker compose logs -f

# View specific service logs
docker compose logs -f proof-server
docker compose logs -f indexer

# View logs since a specific time
docker compose logs --since "2026-06-10T10:00:00" indexer
```

## Conclusion

The Proof Server and Indexer form the backbone of Midnight's transaction processing infrastructure. The proof server handles the computationally intensive ZK proof generation, while the indexer makes blockchain data queryable and accessible to applications.

Key takeaways:
- **Proof Server** requires matching Docker tag version with your node
- First proof generation is slow (~10 min for parameter download)
- **Indexer** provides both GraphQL queries and WebSocket subscriptions
- Use `indexerPublicDataProvider` for standard dApp development
- Direct GraphQL access for custom analytics and dashboards
- All three services (node, proof server, indexer) must be version-compatible

Set up the complete stack with `docker compose up -d` using `midnight-local-dev`, and you'll have a fully functional development environment.
