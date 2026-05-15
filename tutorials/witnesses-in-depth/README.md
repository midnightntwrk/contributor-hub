# Witnesses in Depth — Midnight Network Tutorial

> A comprehensive guide to understanding, implementing, and using **Witnesses** in the Midnight Network smart contract ecosystem.

## About This Tutorial

Witnesses are one of the most powerful yet often misunderstood concepts in Midnight's zero-knowledge contract architecture. They serve as the bridge between on-chain state and off-chain computation, enabling contracts to access persistent data during proof generation without revealing that data on-chain.

This tutorial dives deep into the witness pattern, explores all witness types, and provides hands-on code examples you can run and extend.

## Prerequisites

- Familiarity with TypeScript / JavaScript
- Basic understanding of zero-knowledge proofs (ZKPs)
- [Midnight Compact compiler](https://docs.midnight.network/) installed
- Node.js 18+ and npm/yarn

## Tutorial Contents

| Section | Description |
|---------|-------------|
| [Witnesses in Depth](./witnesses-in-depth.md) | Full tutorial covering witness theory, patterns, types, and real-world use cases |
| [Examples](./examples/) | Runnable code samples demonstrating each witness pattern |

## Code Examples

- **`basic-witnesses.compact`** — Core witness declarations and usage in Compact
- **`witness-provider.ts`** — TypeScript witness provider implementation
- **`merkle-witness.compact`** — Merkle tree witness for authenticated data structures
- **`merkle-witness-provider.ts`** — TypeScript Merkle witness provider
- **`counter-witness.compact`** — Stateful witness pattern with counter logic
- **`counter-witness-provider.ts`** — TypeScript counter witness provider with persistence

## Quick Start

```bash
# Clone the contributor-hub repo
git clone https://github.com/midnightntwrk/contributor-hub.git
cd contributor-hub/tutorials/witnesses-in-depth/examples

# Install dependencies (if running TypeScript examples)
npm install

# Compile a Compact contract
compact compile basic-witnesses.compact

# Run the TypeScript witness provider
npx ts-node witness-provider.ts
```

## Key Concepts at a Glance

- **Witness**: A value supplied off-chain that the ZK circuit uses during proof generation
- **Witness Provider**: A TypeScript function that computes and returns the witness value
- **Pattern**: Witnesses follow a declare-then-provide pattern across Compact and TypeScript
- **Types**: Witnesses can be primitive, composite, Merkle-based, or stateful

## Resources

- [Midnight Developer Docs](https://docs.midnight.network/)
- [Midnight Compact Language Reference](https://docs.midnight.network/compact/)
- [Discord Community](https://discord.com/invite/midnightnetwork)
- [GitHub — Midnight Network](https://github.com/midnightntwrk)

## License

This tutorial is provided under the Apache 2.0 License, consistent with the Midnight Network contributor-hub project.

---

*Contributed as part of [midnightntwrk/contributor-hub#291](https://github.com/midnightntwrk/contributor-hub/issues/291)*
