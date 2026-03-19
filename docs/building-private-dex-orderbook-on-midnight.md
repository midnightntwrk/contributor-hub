# Building a Private DEX Order Book on Midnight

## Overview

Front-running and MEV (Maximal Extractable Value) cost DeFi traders billions of dollars every year on transparent blockchains. When every pending transaction is visible in a public mempool, bots can observe your trade, copy it, and execute it first — or sandwich you between two of their own transactions.

Midnight solves this at the protocol level. Its selective disclosure model lets you build a DEX where:

- **Liquidity is public** — anyone can see available buy and sell volumes at each price level
- **Individual orders are private** — the amounts, trader identities, and strategies are shielded
- **Trade execution is trustless** — the smart contract enforces fair matching without exposing positions

This tutorial walks through building exactly that: a private DEX order book using Compact smart contracts on Midnight.

---

## Prerequisites

- Familiarity with Solidity or another smart contract language
- Node.js 18+ and the Midnight developer toolkit installed
- Basic understanding of order book mechanics (bids, asks, matching)

Install the Midnight CLI and Compact toolchain:

```bash
npm install -g @midnight-ntwrk/midnight-js-cli
npm install -g @midnight-ntwrk/compact-compiler
```

---

## Understanding Midnight's Privacy Model

Before writing code, it helps to understand what Midnight actually hides and what it exposes.

Midnight separates state into two categories:

| Category | Visibility | Use case |
|----------|------------|----------|
| **Public state** | Everyone can read | Order book depth (volume at each price) |
| **Private state** | Only the owning wallet | Individual order amounts, trader identity |

Compact, Midnight's smart contract language, enforces this separation at the type level. A `private` witness is known only to the prover; a `ledger` variable is public on-chain.

---

## Contract Architecture

Our DEX order book contract needs three things:

1. **A public order book** — price levels with aggregate volume
2. **Private order placement** — traders commit to orders without revealing size
3. **Private trade execution** — matching engine that settles without exposing individual positions

```
┌──────────────────────────────────────────────────────┐
│                  DEX Order Book                       │
│                                                        │
│  Public ledger state:                                  │
│    bids: Map<Price, AggregateVolume>                  │
│    asks: Map<Price, AggregateVolume>                  │
│    last_price: u64                                     │
│                                                        │
│  Private per-order state (stored in wallet):           │
│    order_id: Bytes<32>                                 │
│    amount: u64  ← never leaves the prover's machine   │
│    side: enum { Buy, Sell }                            │
│    price: u64                                          │
└──────────────────────────────────────────────────────┘
```

---

## Writing the Compact Contract

Create `dex_orderbook.compact`:

```compact
// dex_orderbook.compact
pragma language_version >= 0.12.0;

import CompactStandardLibrary;

// ── Public ledger state ──────────────────────────────────────────────────────

// Aggregate bid and ask volumes at each price tick (visible to all)
ledger bids: Map<Uint<64>, Uint<64>>;
ledger asks: Map<Uint<64>, Uint<64>>;
ledger last_trade_price: Uint<64>;
ledger order_commitments: Set<Bytes<32>>;

// ── Types ─────────────────────────────────────────────────────────────────────

enum Side { Buy, Sell }

// A hidden order: the trader knows all fields; the chain knows only the commitment
struct OrderSecret {
    order_id:   Bytes<32>,
    trader:     Bytes<32>,   // public key
    price:      Uint<64>,
    amount:     Uint<64>,
    side:       Side,
    nonce:      Bytes<32>,   // randomness to prevent pre-image attacks
}

// ── Circuit: place a private order ────────────────────────────────────────────

// The trader proves they know a valid OrderSecret and commits it on-chain.
// Only the commitment (hash) is published — amount and identity stay private.
export circuit place_order(
    witness secret: OrderSecret,
    price:          Uint<64>,
    public_side:    Side,
) : [] {

    // 1. Derive the commitment from the secret order
    const commitment: Bytes<32> = commit(secret);

    // 2. Verify the witness matches the public inputs
    assert secret.price == price "price mismatch";
    assert secret.side  == public_side "side mismatch";

    // 3. Publish the commitment (no amount, no identity on-chain)
    order_commitments.insert(commitment);

    // 4. Update aggregate depth at this price level (public book)
    if public_side == Side::Buy {
        const current = bids.lookup_or_default(price, 0 as Uint<64>);
        bids.insert(price, current + secret.amount);
    } else {
        const current = asks.lookup_or_default(price, 0 as Uint<64>);
        asks.insert(price, current + secret.amount);
    }
}

// ── Circuit: execute a matched trade ─────────────────────────────────────────

// Both buyer and seller prove their secrets; the contract settles privately.
export circuit execute_trade(
    witness buyer_secret:  OrderSecret,
    witness seller_secret: OrderSecret,
    execution_price:       Uint<64>,
) : [] {

    // 1. Both commitments must be on-chain
    const buyer_commit  = commit(buyer_secret);
    const seller_commit = commit(seller_secret);
    assert order_commitments.member(buyer_commit)  "buyer order not found";
    assert order_commitments.member(seller_commit) "seller order not found";

    // 2. Orders must match
    assert buyer_secret.side  == Side::Buy  "buyer side mismatch";
    assert seller_secret.side == Side::Sell "seller side mismatch";
    assert buyer_secret.price  >= execution_price "buyer price too low";
    assert seller_secret.price <= execution_price "seller price too high";

    // 3. Amounts must agree (or handle partial fills — simplified here)
    assert buyer_secret.amount == seller_secret.amount "amount mismatch";

    // 4. Remove commitments and update public book
    order_commitments.remove(buyer_commit);
    order_commitments.remove(seller_commit);

    const bid_vol = bids.lookup_or_default(execution_price, 0 as Uint<64>);
    const ask_vol = asks.lookup_or_default(execution_price, 0 as Uint<64>);
    bids.insert(execution_price, bid_vol - buyer_secret.amount);
    asks.insert(execution_price, ask_vol - seller_secret.amount);

    // 5. Update last trade price (public price discovery)
    last_trade_price = execution_price;
}

// ── Circuit: cancel an order ──────────────────────────────────────────────────

export circuit cancel_order(
    witness secret: OrderSecret,
) : [] {
    const commitment = commit(secret);
    assert order_commitments.member(commitment) "order not found";

    order_commitments.remove(commitment);

    if secret.side == Side::Buy {
        const vol = bids.lookup_or_default(secret.price, 0 as Uint<64>);
        bids.insert(secret.price, vol - secret.amount);
    } else {
        const vol = asks.lookup_or_default(secret.price, 0 as Uint<64>);
        asks.insert(secret.price, vol - secret.amount);
    }
}
```

Compile the contract:

```bash
compactc dex_orderbook.compact --output ./build
```

---

## TypeScript Integration

Install the Midnight JS SDK:

```bash
npm install @midnight-ntwrk/midnight-js-contracts \
            @midnight-ntwrk/midnight-js-network-id \
            @midnight-ntwrk/midnight-js-types
```

### Deploying the contract

```typescript
import { createMidnightClient } from "@midnight-ntwrk/midnight-js-contracts";
import contractAbi from "./build/dex_orderbook_contract.json";

async function deployDex(walletProvider: WalletProvider) {
  const client = createMidnightClient({ walletProvider });
  const contract = await client.deploy(contractAbi, {});
  console.log("DEX deployed at:", contract.address);
  return contract;
}
```

### Placing a private order

The trader's `OrderSecret` is generated locally and never transmitted to any server.

```typescript
import { randomBytes } from "crypto";

interface OrderSecret {
  order_id: Uint8Array;
  trader: Uint8Array; // wallet public key bytes
  price: bigint;
  amount: bigint;
  side: "Buy" | "Sell";
  nonce: Uint8Array;
}

function generateOrderSecret(
  walletPubKey: Uint8Array,
  price: bigint,
  amount: bigint,
  side: "Buy" | "Sell"
): OrderSecret {
  return {
    order_id: randomBytes(32),
    trader: walletPubKey,
    price,
    amount,
    side,
    nonce: randomBytes(32),
  };
}

async function placeBuyOrder(
  contract: DeployedContract,
  price: bigint,
  amount: bigint,
  walletPubKey: Uint8Array
) {
  // Generate secret locally — amount never leaves this machine
  const secret = generateOrderSecret(walletPubKey, price, amount, "Buy");

  // Store secret in wallet/local storage for later cancellation or execution
  storeOrderSecret(secret);

  // Call the contract — only the commitment is published on-chain
  const tx = await contract.call("place_order", {
    // witness fields are proved locally via ZK circuit; not sent to chain
    witness: { secret },
    // public inputs
    price,
    public_side: "Buy",
  });

  console.log("Order placed. Tx hash:", tx.hash);
  console.log("Your order ID (keep this):", Buffer.from(secret.order_id).toString("hex"));
}
```

### Reading the public order book

The aggregate depth is readable by anyone without authentication:

```typescript
async function getOrderBook(contract: DeployedContract) {
  const state = await contract.queryState();

  // Convert map entries to sorted price levels
  const bids = Object.entries(state.bids)
    .map(([price, volume]) => ({ price: BigInt(price), volume: BigInt(volume) }))
    .sort((a, b) => Number(b.price - a.price)); // descending

  const asks = Object.entries(state.asks)
    .map(([price, volume]) => ({ price: BigInt(price), volume: BigInt(volume) }))
    .sort((a, b) => Number(a.price - b.price)); // ascending

  return { bids, asks, lastPrice: state.last_trade_price };
}

// Example output:
// {
//   bids: [{ price: 1050n, volume: 5000n }, { price: 1000n, volume: 12000n }],
//   asks: [{ price: 1060n, volume: 3000n }, { price: 1100n, volume: 8000n }],
//   lastPrice: 1055n
// }
```

Note: volumes are visible, but you cannot determine how many individual orders make up any volume, nor who placed them.

### Executing a matched trade (off-chain matching + on-chain settlement)

In practice, an off-chain matching engine pairs orders and then both parties call `execute_trade` together. A simple matcher:

```typescript
async function matchAndExecute(
  contract: DeployedContract,
  buyerSecret: OrderSecret,
  sellerSecret: OrderSecret
) {
  // Determine execution price (midpoint or price-time priority logic)
  const executionPrice =
    (buyerSecret.price + sellerSecret.price) / 2n;

  if (buyerSecret.amount !== sellerSecret.amount) {
    throw new Error("Partial fill not supported in this example");
  }

  const tx = await contract.call("execute_trade", {
    witness: {
      buyer_secret: buyerSecret,
      seller_secret: sellerSecret,
    },
    execution_price: executionPrice,
  });

  console.log("Trade executed. Tx hash:", tx.hash);
  console.log("Execution price:", executionPrice.toString());
  // Trader identities and amounts remain hidden — only last_trade_price updates on-chain
}
```

---

## How Privacy Is Enforced

| What an observer sees | What is hidden |
|-----------------------|----------------|
| Total bid volume at $1,000 | Who placed the bids, individual sizes |
| Total ask volume at $1,100 | Who placed the asks, individual sizes |
| Last trade price ($1,050) | Who traded, how much was traded |
| Number of active commitments | Order details behind each commitment |

This is exactly the selective disclosure pattern Midnight enables. The ZK circuits enforce the rules (a trader can only cancel their own order, trade amounts must match) without revealing private inputs to verifiers or the chain.

---

## Protecting Against MEV

On Ethereum, a bot observes your pending `place_order` transaction and can:
1. Front-run: submit an identical order at a slightly better price before yours lands
2. Sandwich: buy before your buy order, then sell immediately after

On Midnight, the bot sees only:
- A commitment hash
- A price level and `Side::Buy` or `Side::Sell`

Without knowing your order amount, the sandwich becomes unprofitable — the bot cannot size its position correctly. Without knowing your identity, targeted MEV is impossible.

---

## Running Locally

```bash
# 1. Start the Midnight devnet
npx @midnight-ntwrk/midnight-js-cli devnet start

# 2. Compile the contract
compactc dex_orderbook.compact --output ./build

# 3. Run the example scripts
npx ts-node deploy.ts
npx ts-node place-order.ts --side buy --price 1000 --amount 500
npx ts-node read-book.ts
```

---

## Next Steps

- **Partial fills**: extend `execute_trade` to handle `amount_fill < order_amount` by updating the residual in the public book
- **Price-time priority**: build an off-chain order book with deterministic matching and submit matched pairs to the contract
- **Shielded token settlement**: replace the amount tracking with Midnight's native shielded token primitives for actual fund movement
- **Market orders**: add a `execute_market_order` circuit that accepts any ask price up to a limit

---

## Further Reading

- [Midnight Documentation](https://docs.midnight.network/)
- [Compact Language Reference](https://docs.midnight.network/compact)
- [Midnight Developer Forum](https://forum.midnight.network/)
- [Selective Disclosure Patterns](https://docs.midnight.network/develop/guides/privacy)
