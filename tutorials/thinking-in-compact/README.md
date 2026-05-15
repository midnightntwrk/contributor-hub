# Thinking in Compact: A Guide for Circom Developers

**Issue:** [#294](https://github.com/midnightntwrk/contributor-hub/issues/294)  
**Type:** Tutorial  
**Difficulty:** Intermediate  
**Estimated Reading Time:** 15 minutes  

## Overview

This tutorial helps Circom developers transition to Compact, the smart contract language for the Midnight Network. It maps every major Circom concept to its Compact equivalent and walks through a complete rewrite of a Merkle proof verifier.

## What You'll Learn

- How Circom signals, templates, components, and constraints map to Compact
- The critical differences: stateful ledger, witness functions, explicit privacy
- How to think in terms of state transitions instead of standalone proofs
- Common pitfalls when migrating from Circom to Compact

## Files

| File | Description |
|------|-------------|
| [thinking-in-compact.md](./thinking-in-compact.md) | Full tutorial (2,500+ words) |
| [examples/MerkleVerifierCircom.circom](./examples/MerkleVerifierCircom.circom) | Circom reference implementation |
| [examples/MerkleVerifierCompact.compact](./examples/MerkleVerifierCompact.compact) | Compact implementation with ledger state |

## Prerequisites

- Experience with Circom 2.x
- Basic understanding of zero-knowledge proofs
- Familiarity with Poseidon hash function

## Quick Links

- [Midnight Documentation](https://docs.midnight.network/getting-started)
- [Compact Language Reference](https://docs.midnight.network/compact)
- [Midnight Developer Forum](https://forum.midnight.network/)
- [Midnight Discord](https://discord.com/invite/midnightnetwork)

## Tags

#MidnightforDevs #Compact #ZeroKnowledge #Circom #Tutorial
