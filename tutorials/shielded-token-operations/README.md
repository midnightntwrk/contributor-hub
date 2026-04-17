# Shielded Token Operations: Mint, Transfer & Burn

A comprehensive tutorial and codebase demonstrating the complete shielded token lifecycle on the Midnight Network. This tutorial covers minting, transferring, and burning shielded tokens using Compact smart contracts, with a full vitest test suite.

## What You'll Learn

- **Minting** shielded tokens with `mintShieldedToken` and `evolveNonce`
- **Transferring** tokens with `sendShielded` and change management via `ShieldedSendResult`
- **Burning** tokens via `sendImmediateShielded` to `shieldedBurnAddress()`
- The **Merkle tree constraint** — freshly minted coins must be committed on-chain before spending
- The **atomic `mint_and_send`** pattern for efficient token distribution
- How to write a **comprehensive test suite** exercising every operation

## Project Structure

```
shielded-token-operations/
├── src/
│   ├── shielded_token.compact   # Compact smart contract
│   └── witnesses.ts             # TypeScript witness implementations
├── tests/
│   └── shielded-token.test.ts   # Vitest test suite (50+ tests)
├── tutorial.md                  # Full written tutorial
├── package.json                 # Project dependencies
├── tsconfig.json                # TypeScript configuration
├── vitest.config.ts             # Vitest test configuration
└── README.md                    # This file
```

## Prerequisites

- Node.js 18+
- npm or yarn
- Midnight MCP CLI (`npm install -g midnight-mcp`)

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Compile the Contract

```bash
npm run compile
```

### 3. Run Tests

```bash
npm test
```

### 4. Run Tests with Coverage

```bash
npm run test:coverage
```

## Contract Overview

The `ShieldedTokenManager` contract provides:

| Function | Description |
|----------|-------------|
| `mint_tokens(amount)` | Mint new shielded tokens (minter only) |
| `transfer_tokens(input_value, send_amount, recipient)` | Transfer tokens with automatic change handling |
| `burn_tokens(input_value, burn_amount)` | Permanently destroy tokens |
| `mint_and_send(amount, recipient)` | Atomically mint and send (recommended) |
| `get_total_supply()` | View current total supply |
| `get_total_minted()` | View total tokens ever minted |
| `get_total_burned()` | View total tokens ever burned |

## Test Coverage

The test suite includes:

- **Minting Tests** (11 tests): Value correctness, supply tracking, nonce evolution, access control
- **Transfer Tests** (9 tests): Full/partial transfers, change handling, edge cases
- **Burn Tests** (9 tests): Full/partial burns, supply tracking, validation
- **Atomic Mint & Send Tests** (7 tests): Atomicity, access control, uniqueness
- **Edge Cases** (8 tests): Supply cycles, maximum values, sequential operations
- **Witness Validation Tests** (3 tests): Data structure validation

## Common Pitfalls Addressed

1. **Merkle Tree Constraint**: Newly minted coins can't be spent until committed on-chain
2. **Change Handling**: Forgetting change coins results in lost tokens
3. **Nonce Management**: Reusing nonces creates double-spend vulnerabilities
4. **Value Overflow**: Fixed-width integers can overflow silently

## License

Apache-2.0 — See [LICENSE](../../LICENSE) for details.

## Related

- Issue: [#327](https://github.com/midnightntwrk/contributor-hub/issues/327)
- [Midnight Developer Docs](https://docs.midnight.network/getting-started)
- [Midnight MCP](https://www.npmjs.com/package/midnight-mcp)
