# Building an Unshielded Token dApp with UI

A complete decentralized application for unshielded tokens on the Midnight Network. This tutorial covers building a Compact smart contract, TypeScript integration layer, and React frontend with wallet connection.

## What You'll Learn

- **Compact contract** for unshielded token operations (mint, transfer, approve)
- **TypeScript integration** connecting frontend to smart contract
- **React frontend** with wallet connection, balance display, and token forms
- **Privacy tradeoffs** between unshielded and shielded tokens

## Project Structure

```
unshielded-token-dapp/
├── src/
│   ├── unshielded_token.compact    # Compact smart contract
│   ├── tokenService.ts             # Contract integration service
│   ├── hooks/
│   │   ├── useWallet.ts            # Wallet connection hook
│   │   └── useToken.ts             # Token operations hook
│   ├── components/
│   │   ├── WalletConnect.tsx        # Wallet UI component
│   │   ├── BalanceDisplay.tsx       # Balance display card
│   │   └── TokenActions.tsx         # Mint/Transfer/Approve forms
│   ├── styles/
│   │   └── app.css                 # Application styles
│   ├── App.tsx                     # Main application component
│   └── main.tsx                    # React entry point
├── public/
│   └── index.html                  # HTML template
├── tutorial.md                     # Full written tutorial
├── package.json                    # Project dependencies
├── tsconfig.json                   # TypeScript configuration
├── vite.config.ts                  # Vite build configuration
└── README.md                       # This file
```

## Prerequisites

- Node.js 18+
- npm or yarn
- Midnight MCP CLI (`npm install -g midnight-mcp`)
- Lace browser extension (for wallet connection)

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Compile the Contract

```bash
npm run compile
```

### 3. Start Development Server

```bash
npm run dev
```

### 4. Build for Production

```bash
npm run build
```

## Contract Overview

The `UnshieldedTokenManager` contract provides:

| Function | Description |
|----------|-------------|
| `mint(to, amount)` | Mint new tokens (minter only) |
| `transfer(to, amount)` | Transfer tokens to an address |
| `approve(spender, amount)` | Approve delegated spending |
| `transfer_from(from, to, amount)` | Transfer using allowance |
| `balance_of(account)` | Query account balance |
| `get_total_supply()` | Query total supply |
| `get_allowance(owner, spender)` | Query approved amount |

## React Components

### WalletConnect
Handles wallet connection/disconnection with the Midnight Lace extension.

### BalanceDisplay
Shows the user's current token balance and total supply with loading states.

### TokenActions
Tabbed interface with forms for:
- **Mint**: Create new tokens (minter only)
- **Transfer**: Send tokens to another address
- **Approve**: Allow another address to spend tokens

### useWallet Hook
Manages wallet connection state, auto-checks for existing connections.

### useToken Hook
Provides token operations with automatic balance refresh and error handling.

## Unshielded vs Shielded Tokens

| Use Case | Token Type | Why |
|----------|-----------|-----|
| Public governance | Unshielded | Voting power must be visible |
| Transparent DeFi | Unshielded | Collateral ratios are public |
| Private payments | Shielded | Hide transaction amounts |
| Confidential holdings | Shielded | Keep portfolio private |

## License

Apache-2.0 — See [LICENSE](../../LICENSE) for details.

## Related

- Issue: [#328](https://github.com/midnightntwrk/contributor-hub/issues/328)
- [Midnight Developer Docs](https://docs.midnight.network/getting-started)
- [Midnight MCP](https://www.npmjs.com/package/midnight-mcp)
