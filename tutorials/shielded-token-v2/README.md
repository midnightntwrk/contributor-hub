# Shielded Token Operations Tutorial

A complete developer's guide to building shielded token contracts on **Midnight Network**, covering minting, transferring, and burning with full zero-knowledge privacy.

## Contents

- `TUTORIAL.md` — Full 3,200-word written tutorial
- `package.json` — Project dependencies and scripts
- `tsconfig.json` — TypeScript configuration
- `src/contract/Token.compact` — Compact smart contract (~120 lines)
- `src/witnesses/token-witness.ts` — TypeScript witness provider
- `src/deploy.ts` — Testnet deployment script
- `test/token.test.ts` — Comprehensive Vitest test suite

## Quick Start

```bash
# Install dependencies
npm install

# Compile the Compact contract (without ZK for fast feedback)
npx compactc --skip-zk src/contract/Token.compact managed/

# Run tests
npm test
```

## Bounty

This tutorial is submitted for Bounty [#327](https://github.com/midnightntwrk/contributor-hub/issues/327) — Shielded Token Operations: Mint, Transfer & Burn with Test Suite.

**Tier:** 2 (Medium) — $500–$700 (paid in NIGHT tokens)
