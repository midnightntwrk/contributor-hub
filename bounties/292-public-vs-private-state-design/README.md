# Bounty #292: Designing Public vs. Private State — What Goes Where and Why

## Overview

This tutorial provides a decision framework for Midnight developers choosing between public (ledger) and private (witness) state in Compact smart contracts.

## Files

- **[TUTORIAL.md](./TUTORIAL.md)** — The main tutorial covering the two state models, a decision framework, real-world patterns, anti-patterns, and cost considerations.
- **[PrivateVoting.compact](./PrivateVoting.compact)** — Working Compact contract demonstrating private votes with a public tally.
- **[PrivateToken.compact](./PrivateToken.compact)** — Token contract with private balances and public metadata.
- **[AccessControl.compact](./AccessControl.compact)** — Access control pattern using private credentials with public commitment registry.

## Key Takeaways

1. **Default to private.** Only make state public when the network needs to verify it.
2. **Use commitments, not raw values** for any public registry of private data.
3. **Aggregates can be public** even when individual values are private.
4. **Every `export` is a permanent disclosure** — make it intentional.
5. **Merkle tree positions can leak information** — be careful with membership proofs.

## Requirements

- Compact compiler (language version ≥ 0.16.0)
- Midnight testnet access for deployment

## Links

- [Midnight Docs](https://docs.midnight.network/)
- [Compact Reference](https://docs.midnight.network/build/reference/compact/)
- [Issue #292](https://github.com/midnightntwrk/contributor-hub/issues/292)
