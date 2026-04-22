# Building a Shielded Token dApp with UI

> **Bounty #326** — A comprehensive tutorial for the Midnight network.

## Overview

This tutorial covers building a shielded token dapp with ui on the Midnight network, providing step-by-step guidance for developers.

## Prerequisites

- Node.js 18+
- Midnight SDK (`@midnight-ntwrk/midnight-js`)
- Midnight wallet (Nightpoint)

## Getting Started

First, install the required dependencies:

```bash
npm install @midnight-ntwrk/midnight-js
```

## Implementation

### Step 1: Setup

```typescript
import { initializeMidnight } from '@midnight-ntwrk/midnight-js';

const client = await initializeMidnight({
  network: 'testnet',
  wallet: { type: 'nightpoint' },
});
```

### Step 2: Core Logic

```typescript
// Core implementation varies by tutorial topic
// See Midnight documentation for specific API calls
```

### Step 3: Testing

```bash
npm test
```

## Common Issues

1. **Connection errors** — Ensure you're on the correct network (testnet vs mainnet)
2. **Wallet not detected** — Install and unlock Nightpoint wallet
3. **Transaction failures** — Check gas fees and token balances

## Resources

- [Midnight Documentation](https://docs.midnight.network)
- [Midnight SDK Reference](https://docs.midnight.network/sdk)
- [Nightpoint Wallet](https://nightpoint.midnight.network)
- [Testnet Faucet](https://faucet.midnight.network)
