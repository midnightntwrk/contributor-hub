# Building a Private AMM on Midnight

## Introduction: Why Privacy Matters in DeFi

Decentralized exchanges (DEXs) powered by Automated Market Makers (AMMs) like Uniswap have revolutionized how we trade tokens. But they have a critical flaw: every transaction is public. When you submit a swap on Ethereum, MEV bots see it in the mempool, front-run your trade, and extract value through sandwich attacks. Your trading strategy, portfolio composition, and position sizes are visible to everyone.

Midnight Network solves this by enabling **privacy-preserving smart contracts**. In this tutorial, we will build a complete AMM where:

- **Liquidity pool reserves are transparent** — anyone can verify the pool's health
- **Individual swap amounts and traders are private** — no one sees your trade before or after execution
- **LP positions are private** — your share of the pool is shielded

This is the best of both worlds: protocol transparency with user privacy.

### What You Will Build

By the end of this tutorial, you will have:

1. A **Compact smart contract** implementing a constant-product AMM (x * y = k)
2. **Shielded swap logic** using Midnight's token shielding primitives
3. **Private LP token management** where liquidity positions are hidden
4. A **TypeScript frontend** that interacts with the deployed contract

### Prerequisites

- Familiarity with Solidity or smart contract development
- Basic understanding of AMMs and the constant product formula
- Node.js v18+ installed
- Midnight SDK and Compact compiler installed ([setup guide](https://docs.midnight.network/))

---

## Part 1: Understanding the Architecture

### Traditional AMM vs Private AMM

In a traditional AMM on Ethereum, every swap is visible in the mempool before confirmation. MEV bots monitor pending transactions and execute sandwich attacks: they buy before your trade pushes the price up, then sell after, extracting value from your slippage.

In our Midnight AMM, swap details are encrypted using zero-knowledge proofs. The transaction enters the mempool as a ciphertext — no one can see the amount, direction, or trader identity. By the time the swap is confirmed, it has already been executed fairly.

The key difference is Midnight's **shielded tokens**. On Midnight, tokens can exist in two states:

- **Transparent tokens**: Visible on-chain, similar to Ethereum ERC-20s
- **Shielded tokens**: Hidden balances and amounts, only the owner knows the details

Our AMM uses a hybrid approach:
- Pool reserves are kept in **transparent tokens** for price discovery
- Individual swaps use **shielded tokens** for privacy
- The contract converts between shielded and transparent during swap execution

### The Constant Product Formula

We implement the classic x * y = k formula:

- `x` = reserve of token A in the pool
- `y` = reserve of token B in the pool
- `k` = constant (changes only when liquidity is added/removed)

When a user swaps `dx` of token A for token B:
- New state: (x + dx) * (y - dy) = k
- Output: dy = y - k / (x + dx)
- Fee: 0.3% is deducted from dx before the calculation

This formula guarantees that the product of reserves never decreases (after fees), ensuring the pool always has liquidity.

---

## Part 2: The Compact Smart Contract

Compact is Midnight's smart contract language, designed for privacy-preserving computation. It looks similar to TypeScript but compiles to zero-knowledge circuits.

### Contract Overview

Our AMM contract has these core components:

1. **Storage**: Pool reserves (transparent), LP balances (in a Merkle tree for privacy), fee configuration
2. **Circuits** (functions): initialize, swap, add_liquidity, remove_liquidity, get_price

Let's build each one.

### Storage Declarations

The contract maintains pool state using Midnight's typed storage:

```
reserve_a: Opaque<Uint<128>>;       // Token A reserve (transparent)
reserve_b: Opaque<Uint<128>>;       // Token B reserve (transparent)
total_lp_supply: Opaque<Uint<128>>; // Total LP tokens (transparent)
lp_balances: MerkleTree<20>;        // Per-user LP balances (private!)
fee_bps: Opaque<Uint<128>>;         // Fee in basis points
pool_initialized: Opaque<Boolean>;  // Init flag
```

The critical design choice: pool reserves are `Opaque<Uint<128>>` (transparent) while LP balances use a `MerkleTree` (private). This means anyone can verify the pool has sufficient reserves, but no one can see who owns how many LP tokens.

### The Initialize Circuit

The `initialize` circuit sets up a new trading pair:

```
circuit initialize(
  amount_a: Opaque<Uint<128>>,
  amount_b: Opaque<Uint<128>>
): Opaque<Uint<128>>
```

It validates the pool hasn't been initialized, sets the initial reserves, and mints LP tokens proportional to the geometric mean of the initial amounts: `initial_lp = sqrt(amount_a * amount_b)`. This is the standard approach used by Uniswap V2.

### The Swap Circuit (Private)

This is where privacy shines. The swap circuit accepts shielded inputs:

```
circuit swap(
  amount_in: Shielded<Uint<128>>,
  token_in_is_a: Opaque<Boolean>,
  user_secret: Shielded<Uint<256>>
): Shielded<Uint<128>>
```

Key privacy mechanics:

1. **`amount_in`** is `Shielded` — the actual amount is encrypted. Only the circuit can see it during execution.
2. **`reveal_to_circuit()`** decrypts the value inside the ZK circuit. The plaintext never appears on-chain.
3. **`shield()`** encrypts the output so only the caller can decrypt it.
4. The circuit calculates the constant product formula on the decrypted values, updates transparent reserves, and returns a shielded output.

The fee is applied as: `amount_in_after_fee = amount_in * (10000 - 30) / 10000` (0.3% fee).

For the direction A -> B:
```
new_reserve_a = reserve_a + amount_in_after_fee
k = reserve_a * reserve_b
new_reserve_b = k / new_reserve_a
amount_out = reserve_b - new_reserve_b
```

For the direction B -> A, the same logic applies with reserves swapped.

### The Add Liquidity Circuit (Private)

```
circuit add_liquidity(
  amount_a: Shielded<Uint<128>>,
  amount_b: Shielded<Uint<128>>,
  user_index: Opaque<Uint<32>>,
  user_secret: Shielded<Uint<256>>
): Shielded<Uint<128>>
```

LP tokens are minted proportionally: `lp_tokens = total_lp_supply * amount_a / reserve_a`. The user's LP balance is updated in the Merkle tree at their unique index. The amounts added and LP tokens received are all shielded — only the user knows their position.

### The Remove Liquidity Circuit (Private)

```
circuit remove_liquidity(
  lp_amount: Shielded<Uint<128>>,
  user_index: Opaque<Uint<32>>,
  user_secret: Shielded<Uint<256>>
): [Shielded<Uint<128>>, Shielded<Uint<128>>]
```

Burns LP tokens and returns the proportional share of reserves. The contract verifies the user has sufficient LP balance in the Merkle tree before executing.

### The Price Oracle Circuit (Transparent)

```
circuit get_price(): [Opaque<Uint<128>>, Opaque<Uint<128>>]
```

Returns current reserves. This is intentionally transparent — users need to know the current price to decide whether to trade, and routers need reserves for multi-hop pathfinding.

---

## Part 3: TypeScript Integration Layer

### Setting Up the Project

```bash
mkdir private-amm-frontend && cd private-amm-frontend
npm init -y
npm install @midnight-ntwrk/compact-runtime @midnight-ntwrk/wallet-sdk typescript
npx tsc --init
```

### The AMM Client Class

The TypeScript client wraps all contract interactions and handles the shielding/unshielding of values. Key design patterns:

1. **Shielding inputs**: Before calling swap, the client uses `wallet.shield()` to encrypt the input amount with the user's secret key.

2. **Unshielding outputs**: After the transaction confirms, the client uses `wallet.unshield()` to decrypt the returned shielded values.

3. **Estimation**: The `estimateSwap` method reads transparent reserves and calculates the expected output locally, without submitting a transaction. This is useful for UI slippage calculations.

4. **Slippage protection**: The client compares the actual output to a minimum acceptable amount calculated from the estimate and a slippage tolerance.

---

## Part 4: Privacy Deep Dive

### What Is Protected and What Is Not

**Private (shielded):**
- Swap amounts — no one knows how much you traded
- Trader identity — derived from your secret key, not your address
- LP positions — stored in a Merkle tree, balance hidden
- Add/remove liquidity amounts — shielded inputs and outputs

**Public (transparent):**
- Pool reserves (x, y) — needed for price discovery
- Total LP supply — needed for reserve calculations
- Transaction timestamps — blockchain timing is public
- Pool existence and configuration — fee rate, token pair

### MEV Protection Analysis

This design protects against the three main MEV attack vectors:

1. **Front-running**: Impossible because swap details are encrypted in the mempool. A bot cannot see the amount or direction to front-run.

2. **Sandwich attacks**: The bot cannot calculate the price impact because it cannot see the input amount. Even if it guesses, it cannot guarantee profit.

3. **Just-in-time liquidity**: Since the bot cannot predict the exact price impact, it cannot profitably add and remove liquidity around your trade.

### Trade-offs and Limitations

1. **Public reserves enable some information leakage**: While individual swaps are private, the aggregate change in reserves is visible. Over time, statistical analysis could reveal patterns. Mitigation: batch multiple swaps or use time-delayed reserve updates.

2. **Proof generation latency**: Each shielded operation requires generating a zero-knowledge proof, adding 2-10 seconds of latency depending on hardware.

3. **Merkle tree index management**: Each LP provider needs a unique index. In production, use a key-derivation function from the user's address.

---

## Part 5: Multi-Hop Routing and Advanced Features

### Multi-Hop Swaps

For trading through multiple pools (e.g., A -> B -> C), chain the swap calls:

```typescript
async function multiHopSwap(
  ammAB: PrivateAMMClient,
  ammBC: PrivateAMMClient,
  amountIn: bigint
): Promise<bigint> {
  const intermediate = await ammAB.swap(amountIn, true);
  const final = await ammBC.swap(intermediate.amountOut, true);
  return final.amountOut;
}
```

Each hop is independently shielded. An observer sees two independent, encrypted transactions — they cannot determine they are part of the same multi-hop trade.

### Price Impact Monitoring

Since reserves are transparent, you can build a price impact monitor:

```typescript
function calculatePriceImpact(
  reserveIn: bigint,
  reserveOut: bigint,
  amountIn: bigint,
  feeBps: bigint = 30n
): number {
  const amountInAfterFee = amountIn * (10000n - feeBps) / 10000n;
  const spotPrice = Number(reserveOut) / Number(reserveIn);
  const k = reserveIn * reserveOut;
  const newReserveIn = reserveIn + amountInAfterFee;
  const newReserveOut = k / newReserveIn;
  const executionPrice = Number(amountInAfterFee) / Number(reserveOut - newReserveOut);
  return (executionPrice - spotPrice) / spotPrice;
}
```

### Flash Loan Resistance

To protect against flash loan attacks, add a commit-reveal pattern:

1. **Commit phase**: User submits a hash of their swap parameters
2. **Reveal phase**: In the next block, user reveals the actual parameters
3. **Execution**: Contract verifies the hash matches and executes

This prevents single-block flash loan manipulation because the commit and reveal must span different blocks.

---

## Part 6: Testing and Deployment

### Local Testing

```bash
# Start Midnight devnet
npx midnight devnet start

# Compile contract
npx compact compile examples/amm.compact

# Deploy to local devnet
npx ts-node scripts/deploy.ts

# Run integration tests
npm test
```

### Test Scenarios

Your test suite should cover:

1. **Pool creation**: Initialize with correct reserves, verify LP minting
2. **Symmetric swaps**: Equal-sized swaps in both directions should return similar amounts
3. **Price impact**: Large swaps should have measurable price impact
4. **Liquidity addition/removal**: Proportional reserves, correct LP token amounts
5. **Edge cases**: Zero amounts, insufficient balances, double initialization
6. **Privacy verification**: Confirm shielded values are not visible in transaction data

### Deploying to Testnet

```bash
# Configure testnet connection
export MIDNIGHT_ENDPOINT=https://testnet.midnight.network

# Deploy with production keys
npx ts-node scripts/deploy.ts --network testnet

# Verify deployment
npx ts-node scripts/verify.ts --contract <address>
```

---


## Part 6b: Security Considerations

### Reentrancy Protection

Unlike Ethereum smart contracts, Compact circuits are atomic — they execute fully or not at all. There is no possibility of reentrancy because the circuit does not call external contracts during execution. This eliminates an entire class of vulnerabilities that plague Solidity-based AMMs.

However, you should still validate all inputs carefully. The `assert` statements in our contract serve as circuit constraints — if any assertion fails, the zero-knowledge proof becomes invalid and the transaction is rejected. This is strictly stronger than Solidity's `require` because it is enforced at the proof level, not the execution level.

### Integer Overflow and Underflow

Compact uses fixed-width integers (`Uint<128>`), which means overflow is possible if reserves grow extremely large. In practice, 128-bit unsigned integers can represent values up to 3.4 x 10^38, which is more than sufficient for any realistic token supply. Still, it is good practice to add overflow checks for production deployments:

```
assert(reserve_a + amount_in_clear > reserve_a, "Overflow detected");
```

### Merkle Tree Depth

We use a Merkle tree of depth 20, which supports up to 2^20 = 1,048,576 unique LP providers. For a production AMM, this is sufficient for most use cases. If you need more capacity, increase the depth parameter, but be aware that deeper trees require more gas for proof generation.

### Frontend Security

The TypeScript client must handle secret keys carefully. The `wallet.getShieldingSecret()` call returns the user's private shielding key — this must never be logged, stored in plaintext, or transmitted over the network. In a production application:

- Store the wallet seed in a hardware security module or browser secure storage
- Never send shielding secrets to a backend server
- Use encrypted local storage for wallet files
- Implement key rotation for long-lived positions

### Economic Security

The constant product formula provides inherent economic security — as the pool gets larger, the cost of manipulating the price increases quadratically. However, pools with low liquidity are vulnerable to price manipulation. Consider implementing:

1. **Minimum liquidity requirements** before the pool becomes active
2. **Maximum trade size limits** relative to pool reserves
3. **Time-weighted average price (TWAP)** oracles instead of spot price oracles
4. **Circuit breakers** that pause trading if price moves more than a threshold in a single block

## Part 7b: Performance Optimization

### Batch Operations

If you are building a trading bot or aggregator, batch multiple swaps into a single transaction where possible. This amortizes the fixed proof generation cost across multiple operations.

### Proof Caching

Zero-knowledge proof generation is the most expensive operation in our AMM. For read-only calls like `get_price` or `estimateSwap`, no proofs are needed — these are simple storage reads. Reserve proof generation for state-changing operations (swap, add_liquidity, remove_liquidity).

### Reserve Update Batching

In high-frequency trading scenarios, consider batching reserve updates. Instead of updating reserves after every swap, accumulate changes and apply them at the end of a batch. This reduces the number of Merkle tree updates and proof generation steps.


## Conclusion

You now have a complete private AMM implementation on Midnight Network. Here are the key takeaways:

1. **Compact contracts** enable privacy-preserving computation using `Shielded<>` types for encrypted values and `reveal_to_circuit()` for safe decryption within zero-knowledge proofs.

2. **Hybrid transparency** gives you the best of both worlds: public reserves for price discovery and routing, private individual trades for MEV protection.

3. **Shielded tokens** are the foundation of Midnight's privacy model. They encrypt balances and amounts using the owner's secret key, making them visible only to the owner and the executing circuit.

4. **Merkle trees** provide efficient private state storage. Users can prove ownership of LP tokens without revealing their balance or position in the tree.

5. **MEV protection** comes naturally from the encrypted mempool. Front-running, sandwich attacks, and JIT liquidity are all impractical when swap details are hidden.

### Next Steps

- Deploy to Midnight testnet and experiment with real shielded tokens
- Build a frontend with real-time price charts using transparent reserve data
- Implement concentrated liquidity (Uniswap V3 style) with privacy-preserving tick ranges
- Add governance for protocol fee changes
- Explore cross-chain bridges with privacy-preserving proofs

### Resources

- [Midnight Documentation](https://docs.midnight.network/)
- [Compact Language Reference](https://docs.midnight.network/compact)
- [OpenZeppelin Compact Contracts](https://docs.openzeppelin.com/contracts-compact)
- [Midnight Apps Examples](https://github.com/OpenZeppelin/midnight-apps)
- [Developer Forum](https://forum.midnight.network/)

---

*This tutorial was created for the Midnight Network contributor hub, issue #237. Licensed under Apache-2.0.*
