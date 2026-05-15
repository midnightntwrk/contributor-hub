# Oracle Patterns: Bringing External Data On-Chain with Midnight Network

## Table of Contents

1. [Introduction](#introduction)
2. [What Are Oracles?](#what-are-oracles)
3. [Why Oracles Matter for Midnight](#why-oracles-matter-for-midnight)
4. [Core Oracle Design Patterns](#core-oracle-design-patterns)
   - [Request-Response Pattern](#1-request-response-pattern)
   - [Publish-Subscribe Pattern](#2-publish-subscribe-pattern)
   - [Optimistic Oracle Pattern](#3-optimistic-oracle-pattern)
   - [Decentralized Oracle Network Pattern](#4-decentralized-oracle-network-pattern)
5. [Implementing an Oracle on Midnight](#implementing-an-oracle-on-midnight)
6. [Data Verification and Integrity](#data-verification-and-integrity)
7. [Privacy Considerations](#privacy-considerations)
8. [Error Handling and Edge Cases](#error-handling-and-edge-cases)
9. [Best Practices](#best-practices)
10. [Complete Example: Price Feed Oracle](#complete-example-price-feed-oracle)
11. [Resources](#resources)

---

## Introduction

Smart contracts are deterministic, sandboxed programs that execute on-chain. They cannot, by design, reach out to external APIs, read from databases, or access real-world data feeds. This isolation is a feature — it guarantees consensus — but it also creates a fundamental problem: how do you build useful applications that need to know the price of ETH, the weather in Tokyo, or the outcome of a sports event?

**Oracles** solve this problem. They are the bridge between the deterministic on-chain world and the messy, dynamic off-chain world. On Midnight Network, where privacy is a first-class citizen, Oracle patterns take on additional complexity and importance because we must bring external data on-chain without compromising the zero-knowledge guarantees that make Midnight special.

This tutorial covers the major Oracle design patterns, shows you how to implement them in the context of Midnight's Compact language and ZK circuit architecture, and provides practical, working code examples you can adapt for your own dApps.

---

## What Are Oracles?

An Oracle is any entity — a service, a smart contract, a hardware device — that feeds external data into a blockchain. The term comes from Greek mythology, where an oracle was a person who relayed divine knowledge. In blockchain, the "divine knowledge" is real-world data, and the "person" is typically a software service.

Oracles can be:

- **Software Oracles**: Fetch data from APIs, websites, or databases (e.g., price feeds, weather data, sports scores).
- **Hardware Oracles**: Read data from physical sensors (e.g., IoT devices, RFID scanners, GPS modules).
- **Human Oracles**: Individuals who manually verify and submit data (e.g., domain experts, dispute resolvers).
- **Cross-Chain Oracles**: Relay data between different blockchains (e.g., bridging state from Ethereum to Midnight).

The key challenge is **trust**. When a smart contract relies on an Oracle, it trusts that Oracle to provide accurate, timely, and untampered data. A compromised Oracle can cause catastrophic failures — this is the so-called "Oracle Problem."

---

## Why Oracles Matter for Midnight

Midnight Network is built around zero-knowledge proofs and data protection. Smart contracts on Midnight can handle private data, prove statements without revealing underlying information, and enforce compliance with regulatory requirements. But even the most privacy-preserving DeFi application still needs to know what the current market price is. A private voting system still needs to know when polls close. A confidential supply chain tracker still needs to read RFID sensor data.

Oracles on Midnight face unique challenges:

1. **ZK Compatibility**: Data brought on-chain must be compatible with zero-knowledge circuits. You cannot simply stuff arbitrary bytes into a ZK proof — the data must be structured, bounded, and encodable within the circuit's constraints.

2. **Privacy Preservation**: An Oracle should not leak information about which contract requested data or why. On a privacy chain, the Oracle interaction pattern itself can be metadata that reveals sensitive information.

3. **Verification Without Revelation**: You may want to prove that Oracle data falls within a certain range (e.g., "the price is above $100") without revealing the exact price to all network participants.

4. **Regulatory Compliance**: Midnight's compliance features mean Oracle data may need to be auditable by authorized parties while remaining private from everyone else.

Understanding these constraints is essential before choosing an Oracle pattern.

---

## Core Oracle Design Patterns

### 1. Request-Response Pattern

The **Request-Response** pattern is the most straightforward Oracle design. A smart contract emits a request for data, an off-chain Oracle service monitors for these requests, fetches the data, and submits a response transaction.

**How It Works:**

1. The dApp contract calls an Oracle contract with a data request (e.g., "get me the BTC/USD price").
2. The Oracle contract logs the request event on-chain.
3. An off-chain Oracle node detects the event via an event listener.
4. The Oracle node fetches the data from an external source (e.g., a price API).
5. The Oracle node submits a transaction to the Oracle contract with the data.
6. The Oracle contract verifies the response, stores it, and notifies the requesting dApp.

**Advantages:**
- Simple to implement and reason about.
- Data is fetched on-demand, so it is always fresh.
- Easy to add access control — only authorized Oracle nodes can respond.

**Disadvantages:**
- Requires two on-chain transactions (request + response), increasing gas costs.
- Latency: the Oracle node must detect the request, fetch data, and submit a transaction.
- Single point of failure if only one Oracle node is used.

**When to Use:**
- When data freshness is critical and requests are infrequent.
- For one-off lookups (e.g., "did this flight land?").
- When you need strong guarantees about which Oracle provided the data.

### 2. Publish-Subscribe Pattern

The **Publish-Subscribe (Pub-Sub)** pattern inverts the flow. Instead of the contract requesting data, the Oracle proactively publishes data at regular intervals or when conditions change. Contracts subscribe to the data feed and read the latest value when needed.

**How It Works:**

1. An Oracle service publishes data to an on-chain Oracle contract at fixed intervals (e.g., every 5 minutes) or when the data changes by more than a threshold (e.g., price moves by 0.5%).
2. The Oracle contract stores the latest value, a timestamp, and metadata.
3. Any dApp contract can read the stored value by calling a view function on the Oracle contract.
4. No request transaction is needed — the data is always available.

**Advantages:**
- Zero request costs for consumers — they just read storage.
- Data is pre-fetched and always available, reducing latency.
- Multiple consumers can share the same data feed.

**Disadvantages:**
- Data may be stale if the update interval is too long.
- Update transactions cost gas regardless of whether anyone is reading the data.
- The Oracle must decide when to update — fixed intervals may waste resources; threshold-based updates may miss rapid changes.

**When to Use:**
- For frequently accessed data like price feeds.
- When many contracts need the same data.
- When slight staleness (seconds to minutes) is acceptable.

### 3. Optimistic Oracle Pattern

The **Optimistic Oracle** pattern assumes data is correct unless someone disputes it. This is a powerful pattern that reduces on-chain costs because disputes are rare.

**How It Works:**

1. A proposer submits data on-chain with a bond (stake).
2. A challenge period begins (e.g., 2 hours).
3. During the challenge period, anyone can dispute the data by posting their own bond.
4. If no dispute occurs, the data is accepted after the challenge period.
5. If a dispute occurs, a resolution mechanism kicks in — this could be a vote, a more trusted Oracle, or an automated verification.

**Advantages:**
- Extremely gas-efficient for non-disputed data (which is most data).
- Enables data types that are hard to automate (e.g., "did this real-world event happen?").
- Economic incentives align: proposers are honest to avoid losing their bond.

**Disadvantages:**
- Latency: data is not final until the challenge period expires.
- Requires capital (bonds) from proposers and disputers.
- Dispute resolution adds complexity and potential for governance attacks.

**When to Use:**
- For data that is hard to verify automatically (e.g., insurance claims, real-world events).
- When you can tolerate a delay before data finality.
- For high-value, low-frequency data where economic security is sufficient.

### 4. Decentralized Oracle Network Pattern

The **Decentralized Oracle Network (DON)** pattern uses multiple independent Oracle nodes to fetch and aggregate data. This is the pattern used by Chainlink, Band Protocol, and similar projects.

**How It Works:**

1. A dApp contract requests data from a DON coordinator contract.
2. The coordinator selects a committee of Oracle nodes (e.g., 21 nodes).
3. Each node independently fetches data from external sources.
4. Each node submits its data point on-chain.
5. The coordinator aggregates the responses (e.g., takes the median).
6. The aggregated result is delivered to the requesting dApp.

**Advantages:**
- High reliability: no single point of failure.
- Data accuracy: aggregation reduces the impact of outliers or malicious nodes.
- Sybil resistance: node operators must stake tokens and are slashed for bad behavior.

**Disadvantages:**
- Expensive: multiple nodes submit transactions.
- Complex: requires node selection, aggregation logic, staking, and slashing mechanisms.
- Coordination overhead: nodes must agree on data sources and formats.

**When to Use:**
- For high-value data where accuracy and reliability are paramount (e.g., DeFi price feeds).
- When you need strong economic security guarantees.
- For production-grade applications where downtime or incorrect data is unacceptable.

---

## Implementing an Oracle on Midnight

Midnight's Compact language and ZK circuit model require special considerations when implementing Oracle patterns. Here is a general architecture for an Oracle contract on Midnight.

### Oracle Contract Structure

The Oracle contract on Midnight serves as the on-chain component. It:

- Stores Oracle data (prices, timestamps, signatures).
- Provides functions to update data (called by authorized Oracle nodes).
- Provides functions to read data (called by dApp consumers).
- Enforces access control so only authorized nodes can write.
- Emits events for transparency and auditability.

Key design decisions for Midnight:

1. **Data Encoding**: Oracle data must be encoded in a way that is compatible with ZK circuits. Use fixed-point arithmetic for prices (e.g., multiply by 10^8 to avoid floating-point issues in circuits).

2. **Commitment Scheme**: Use cryptographic commitments (hashes) to commit to data before revealing it. This prevents front-running and enables privacy-preserving verification.

3. **Signature Verification**: Oracle nodes should sign their data submissions. The contract verifies signatures on-chain. In a ZK context, you can prove that a valid signature exists without revealing the signer's identity.

4. **Merkle Proofs**: For large datasets, store a Merkle root on-chain and provide Merkle proofs off-chain. This allows contracts to verify inclusion of specific data points without storing everything on-chain.

---

## Data Verification and Integrity

Ensuring data integrity is the most critical aspect of Oracle design. Here are the key techniques:

### Cryptographic Signatures

Every data submission from an Oracle node should be signed. The contract stores the public keys of authorized nodes and verifies each submission's signature before accepting it.

```
Signature Verification Flow:
1. Oracle node fetches data (e.g., price = 50000.00)
2. Node encodes data as bytes
3. Node signs encoded data with its private key
4. Node submits (data, signature) to the contract
5. Contract verifies signature against the node's registered public key
6. If valid, contract stores the data
```

### Multi-Source Aggregation

A robust Oracle fetches data from multiple external sources and aggregates them. Common aggregation methods:

- **Median**: The middle value when sorted. Resistant to outliers.
- **Weighted Average**: Each source has a weight based on its reliability or volume.
- **Trimmed Mean**: Remove the top and bottom N% of values, then average.

### Data Freshness Checks

Always include a timestamp with Oracle data and reject submissions that are too old or too far in the future.

### Replay Protection

Include a nonce or sequence number in each submission to prevent replay attacks. The contract should reject submissions with nonces that have already been used.

---

## Privacy Considerations

Midnight's privacy model introduces unique Oracle challenges:

1. **Request Privacy**: On a public blockchain, everyone can see Oracle requests. On Midnight, you can use ZK proofs to prove that a valid request was made without revealing the requester's identity or the specific parameters.

2. **Data Privacy**: Oracle data itself may be sensitive. Use Midnight's encrypted state to store Oracle responses that should only be readable by authorized parties.

3. **Metadata Privacy**: Even the fact that a contract is using an Oracle can be revealing. Consider batching requests or using decoy requests to obscure patterns.

4. **Selective Disclosure**: Use ZK proofs to prove properties of Oracle data without revealing the data itself. For example, prove that a price is within a range without revealing the exact price.

---

## Error Handling and Edge Cases

Robust Oracle implementations must handle:

- **Stale Data**: What happens if the Oracle hasn't updated in 10 minutes? 1 hour? Define staleness thresholds per use case.
- **Conflicting Data**: If multiple Oracle nodes submit different values, have a clear aggregation and outlier detection strategy.
- **Oracle Downtime**: Implement fallback mechanisms — secondary Oracle providers, cached values with staleness warnings, or circuit breakers that halt operations if data is unavailable.
- **Gas Spikes**: Oracle update transactions can fail if gas prices spike. Implement retry logic and gas price management off-chain.
- **Data Source Failures**: External APIs can go down. Oracle nodes should fetch from multiple sources and gracefully degrade.

---

## Best Practices

1. **Use Multiple Oracle Sources**: Never rely on a single Oracle or a single data source.
2. **Implement Circuit Breakers**: Halt operations if Oracle data is stale, inconsistent, or unavailable.
3. **Add Time Locks**: For high-value operations, require data to be recent (e.g., within the last 5 minutes).
4. **Monitor and Alert**: Set up off-chain monitoring for Oracle health, data freshness, and anomaly detection.
5. **Economic Security**: Ensure Oracle operators have sufficient stake at risk to make attacks unprofitable.
6. **Upgrade Path**: Design Oracle contracts to be upgradeable (via proxy patterns) so you can fix bugs or add new data sources.
7. **Test with Real Conditions**: Test your Oracle integration with network latency, gas spikes, and data source failures — not just happy-path scenarios.
8. **Document Data Sources**: Clearly document which external APIs or data sources your Oracle uses. This is critical for auditability.

---

## Complete Example: Price Feed Oracle

See the [`examples/`](./examples/) directory for a complete, working implementation:

- [`oracle-contract.compact`](./examples/oracle-contract.compact) — The on-chain Oracle contract in Compact language.
- [`oracle-node.ts`](./examples/oracle-node.ts) — The off-chain Oracle node service in TypeScript.
- [`consumer-example.compact`](./examples/consumer-example.compact) — An example dApp that consumes Oracle data.

### Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure Oracle node
cp .env.example .env
# Edit .env with your API keys and private keys

# 3. Deploy the Oracle contract
npx compact deploy oracle-contract.compact

# 4. Start the Oracle node
npx ts-node oracle-node.ts

# 5. Deploy the consumer contract
npx compact deploy consumer-example.compact
```

---

## Resources

- [Midnight Developer Documentation](https://docs.midnight.network/)
- [Midnight Network Litepaper](https://midnight.network/litepaper)
- [Compact Language Reference](https://docs.midnight.network/compact/)
- [Chainlink Oracle Design Patterns](https://docs.chainlink.concepts/architecture-overview/) — General Oracle design concepts (not Midnight-specific).
- [OWASP Smart Contract Security](https://owasp.org/www-project-smart-contract-security/) — Security considerations.

---

*This tutorial is part of the [midnightntwrk/contributor-hub](https://github.com/midnightntwrk/contributor-hub) community contributions. Licensed under Apache-2.0.*
