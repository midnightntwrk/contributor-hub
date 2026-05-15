# Maps and Merkle Trees in Midnight Network

## Overview

This tutorial covers the use of **Maps** and **Merkle Trees** in the Midnight Network, a privacy-preserving blockchain platform built on zero-knowledge proofs. You'll learn how to leverage the Compact language's Map type for on-chain data storage and Merkle Tree structures for efficient proof generation and verification.

## What You'll Learn

- **Compact Language Maps**: How to declare, initialize, and manipulate `Map` types in Compact smart contracts
- **Merkle Tree Architecture**: Understanding Midnight's built-in Merkle Tree support for contract state
- **Proof Generation**: Creating and verifying Merkle proofs for privacy-preserving data access
- **Practical Use Cases**: Building a token registry, voting system, and credential verification system

## Table of Contents

1. [Maps and Merkle Trees Tutorial](./maps-merkle-trees.md) — Full 2000+ word tutorial
2. [Code Examples](./examples/) — Working Compact and TypeScript examples
   - [`token-registry.compact`](./examples/token-registry.compact) — Token registry using Maps
   - [`merkle-voting.compact`](./examples/merkle-voting.compact) — Voting system with Merkle proofs
   - [`credential-verify.compact`](./examples/credential-verify.compact) — Credential verification contract
   - [`map-operations.ts`](./examples/map-operations.ts) — TypeScript client for Map operations
   - [`merkle-proofs.ts`](./examples/merkle-proofs.ts) — TypeScript client for Merkle proof generation

## Prerequisites

- Node.js 18+ and npm/yarn
- Midnight Compact compiler (`compactc`)
- Basic understanding of blockchain concepts and zero-knowledge proofs
- Familiarity with TypeScript for client-side integration

## Quick Start

```bash
# Install dependencies
npm install @midnight-ntwrk/compact-runtime

# Compile a Compact contract
compactc examples/token-registry.compact ./build

# Run TypeScript examples
npx ts-node examples/map-operations.ts
```

## Related Resources

- [Midnight Network Documentation](https://docs.midnight.network)
- [Compact Language Reference](https://docs.midnight.network/compact)
- [Midnight GitHub Repository](https://github.com/midnightntwrk)

## License

This tutorial is part of the Midnight Network Contributor Hub and follows the project's [contributing guidelines](../../CONTRIBUTING.md).
