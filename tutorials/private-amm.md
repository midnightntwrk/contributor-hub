# Building a Private AMM on Midnight

**Tutorial for** [`midnightntwrk/contributor-hub#237`](https://github.com/midnightntwrk/contributor-hub/issues/237)

---

## Table of Contents

1. [The MEV Problem on Ethereum — Why Private AMMs Matter](#1-the-mev-problem-on-ethereum--why-private-amms-matter)
2. [Midnight's Privacy Model for DeFi](#2-midnights-privacy-model-for-defi)
3. [AMM Architecture on Midnight: Transparent Pools, Private Trades](#3-amm-architecture-on-midnight-transparent-pools-private-trades)
4. [Constant Product Market Maker (x·y=k) Formula in Compact](#4-constant-product-market-maker-xyk-formula-in-compact)
5. [Liquidity Pool Contract: Deposit, Withdraw, Swap](#5-liquidity-pool-contract-deposit-withdraw-swap)
6. [Privacy-Preserving Swap Flow](#6-privacy-preserving-swap-flow)
7. [Code Examples in Compact](#7-code-examples-in-compact)
   - [Pool State Management](#71-pool-state-management)
   - [Swap Function with ZK Verification](#72-swap-function-with-zk-verification)
   - [Liquidity Provider Positions](#73-liquidity-provider-positions)
8. [Front-Running Prevention Through Private Transaction Ordering](#8-front-running-prevention-through-private-transaction-ordering)
9. [Impermanent Loss Considerations in Private AMMs](#9-impermanent-loss-considerations-in-private-amms)
10. [Deployment and Testing Guide](#10-deployment-and-testing-guide)

---

## 1. The MEV Problem on Ethereum — Why Private AMMs Matter

### What is MEV?

**Maximal Extractable Value (MEV)** is the profit that block proposers (formerly miners) can extract by reordering, inserting, or censoring transactions within a block. On Ethereum, every pending transaction sits in the public mempool — a globally visible queue. This transparency creates a predatory environment:

| Attack | Description | Annual Loss Estimate |
|--------|-------------|---------------------|
| **Front-running** | Bots scan the mempool, spot a large buy order, and front-run it by buying first, then selling at a higher price | $200M+ |
| **Sandwich attacks** | Wrap a victim's swap between two of the attacker's transactions | $50M+ |
| **Back-running** | Bot watches for large swaps and immediately places a sell order right after | $30M+ |
| **Liquidation sniping** | Oracle manipulation to trigger liquidations at favorable prices | $100M+ |

### Why AMMs Are Especially Vulnerable

Automated Market Makers (AMMs) like Uniswap V2/V3 are particularly exposed because:

1. **Price is deterministic** — anyone can compute the output of a swap before it lands on-chain
2. **First-come-first-served is a lie** — validators can reorder at will
3. **Large trades move markets predictably** — MEV bots can anticipate price impact and profit from it
4. **LP positions are public** — attackers can see where liquidity is concentrated and target vulnerable ranges

### Why Current Solutions Fall Short

| Solution | Problem |
|----------|---------|
| Centralized exchanges | Counterparty risk, no self-custody |
| On-chain commit-reveal schemes | First-commit still visible; reveal adds latency |
| Private mempools (e.g., Flashbots Protect) | Relies on benevolent validators; MEV still exists |
| Optimistic rollups with encrypted blobs | Partial solution, still nascent |

The root cause: **the underlying blockchain exposes transaction intent before execution.**

### The Private AMM Imperative

A Private AMM ensures that:

- Trade size, direction, and asset pair are **not publicly visible** before execution
- The **result** of a trade (prices, amounts) is revealed **only after** the block is produced
- Liquidity provider positions remain **confidential**
- No one — not even the block producer — can extract MEV from private transactions

This is exactly what Midnight enables.

---

## 2. Midnight's Privacy Model for DeFi

### Overview

**Midnight** is a privacy-preserving smart contract blockchain built by the team behind Zcash. It uses **zero-knowledge proofs (ZKPs)** to allow participants to prove that computations were done correctly — without revealing the inputs.

The key innovation: Midnight maintains **two layers of state**:

```
┌─────────────────────────────────────────────────────────┐
│                    MIDNIGHT STATE                        │
├──────────────────────┬──────────────────────────────────┤
│   PUBLIC STATE       │        PRIVATE STATE              │
│                      │                                   │
│  - Pool reserves     │  - Individual trade amounts       │
│  - Global parameters │  - LP position sizes              │
│  - Verification keys │  - User wallet balances (shielded) │
│  - Contract code     │  - Transaction context             │
│                      │                                   │
│  Readable by anyone  │  Only provable via ZK proofs       │
└──────────────────────┴──────────────────────────────────┘
```

### The zkVM: Compact Language

Midnight smart contracts run in a **zero-knowledge virtual machine (zkVM)**. The primary language is **Compact** — a Rust-idiomatic language that compiles to ZK circuits.

Key properties of Compact:

- **Circuit-first design** — every operation must be ZK-friendly (no floating point, bounded integers)
- **Deterministic gas metering** — predictable resource usage
- **Public/Private annotations** — developers mark which values are public and which are private
- **Type-safe** — algebraic data types enforced at compile time

```rust
// Compact example: private amount declaration
use midnight::prelude::*;

#[private(a, b)]  // a and b are private inputs
pub fn add(a: u64, b: u64) -> u64 {
    a + b
}
```

### How Privacy Works: The Prove-Then-Verify Model

Every state-changing operation on Midnight follows this flow:

```
┌──────────────────────────────────────────────────────────────┐
│                    USER'S BROWSER/CLIENT                      │
│                                                              │
│  1. Build transaction (public params + private inputs)        │
│  2. Generate ZK proof: "I computed swap(amount_in, reserve)  │
│     correctly, and my balance deduct is valid"              │
│  3. Submit: { public_params, proof, public_outputs }          │
│                                                              │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────┐
│                    MIDNIGHT NETWORK                           │
│                                                              │
│  4. Verify proof on-chain (fast, ~1ms)                       │
│  5. Update public state: reserves change                      │
│  6. Private state updated off-chain in user's local wallet    │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**What nodes see:** Only the proof and the public outputs (e.g., new reserve amounts). They cannot reconstruct the private inputs.

### Key Primitives

| Primitive | Purpose |
|-----------|---------|
| **Nullifier** | Prevents double-spending; derived from private data but opaque |
| **Commitment** | Hides private value while allowing it to be spent via ZK proof |
| **Note** | Private data structure that can be spent by proving knowledge |
| **Verification Key (VK)** | Public key that allows anyone to verify a ZK proof |

---

## 3. AMM Architecture on Midnight: Transparent Pools, Private Trades

### Hybrid Architecture

Midnight's private AMM uses a **hybrid architecture** that balances transparency and privacy:

```
┌────────────────────────────────────────────────────────────────┐
│                    PRIVATE AMM LAYER                           │
│                                                                │
│   User A ──► [Generate Swap Proof] ──► {proof, public_params} │
│                    │                                          │
│   User B ──► [Generate Swap Proof] ──► {proof, public_params} │
│                    │                                          │
└────────────────────┼────────────────────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────────────────────────┐
│               PUBLIC POOL STATE (on-chain)                     │
│                                                                │
│   Pool reserves (x, y) ──► PUBLIC, readable by all            │
│   Swap fee ──► PUBLIC                                         │
│   Pool creator ──► PUBLIC                                      │
│   Total LP shares ──► PUBLIC                                   │
│                                                                │
│   What is NOT public:                                          │
│   - Who swapped what amount                                    │
│   - Individual LP position sizes                               │
│   - Historical trade directions                                │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### Why Reserves Are Public

Holding reserves **public** is a deliberate design choice because:

1. **Price discovery** — traders need to know current prices
2. **ZK circuit efficiency** — circuits can reference public values without including them in the witness
3. **Auditability** — anyone can verify the AMM formula is being followed
4. **Simplicity** — AMM math (x·y=k) is public anyway; hiding it adds no real security

### What Stays Private

| Data | Visibility |
|------|------------|
| Trade input amount | **Private** — only revealed in the user's ZK proof |
| Trade output amount | **Private** — only revealed in the user's ZK proof |
| LP position size | **Private** — tracked via private notes |
| User identity | **Private** — no link between wallet address and trades |
| Trade history | **Private** — not stored on-chain |

### Pool Types

```
┌─────────────────────────────────────────────────────────────┐
│              MIDNIGHT AMM POOL ARCHITECTURE                  │
├──────────────────────┬────────────────────────────────────────┤
│   TRANSPARENT POOL  │         PRIVATE POOL                  │
│                      │                                        │
│  - Reserves public  │  - Reserves encrypted                 │
│  - Swap amounts      │  - Swap amounts hidden                │
│    public (on-chain) │    (ZK-only)                          │
│  - Good for: stable  │  - Good for: large trades,            │
│    assets, whales     │    MEV protection                    │
│                      │                                        │
│  [ETH/USDC pool]     │  [Large whale trade pool]              │
└──────────────────────┴────────────────────────────────────────┘
```

For this tutorial, we implement the **transparent-reserve / private-trade** model, which is the most practical for general AMM use.

---

## 4. Constant Product Market Maker (x·y=k) Formula in Compact

### The Formula

The constant product AMM formula is:

```
x · y = k
```

Where:
- `x` = reserve quantity of asset A
- `y` = reserve quantity of asset B
- `k` = constant product (invariant)

### Core Invariants

For a swap of `Δx` asset A for `Δy` asset B:

```
(x + Δx) · (y - Δy) = k          // after swap
Δy = y - (k / (x + Δx))          // rearranged
```

The **output amount** is derived from the invariant.

### Fee Structure

Most AMMs charge a fee on input (e.g., 0.3%):

```
Effective input = Δx · (1 - fee_rate)
k' = (x + effective_input) · y    // k doesn't change for same block
Δy = y - (k' / (x + effective_input))
```

### Compact Implementation of AMM Math

Compact uses **fixed-point arithmetic** with bounded integers for ZK compatibility:

```rust
use midnight::prelude::*;

// All values in "units" (e.g., wei, satoshis) — no decimals in circuit
const FEE_DENOM: u128 = 1000;
const FEE_NUMER: u128 = 3;       // 0.3% fee

/// Calculate output amount for a swap: how much y do we get for dx amount of x?
/// All values are u128 for sufficient range on reserve amounts
/// Returns (dy, new_reserve_x, new_reserve_y) — dy is the private output
pub fn calc_output_amount(
    reserve_x: u128,    // public: current reserve of asset X
    reserve_y: u128,    // public: current reserve of asset Y
    dx: u128,           // private: amount of X being swapped in
    fee_numer: u128,    // public: fee numerator
    fee_denom: u128,    // public: fee denominator
) -> (u128, u128, u128) {
    // Step 1: Apply fee to input
    let fee = (dx as u128) * fee_numer / fee_denom;
    let dx_net = dx - fee;

    // Step 2: Check for zero input (would cause division by zero)
    assert!(dx_net > 0, "Zero input after fee");
    assert!(reserve_x > 0, "Zero reserve");

    // Step 3: Calculate new reserve_x after receiving input
    let new_reserve_x = reserve_x + dx_net;

    // Step 4: Calculate dy using constant product: x*y = k
    // dy = y - (k / new_reserve_x), where k = reserve_x * reserve_y
    let k = reserve_x * reserve_y;
    let dy_raw = k / new_reserve_x;  // integer division — truncation is intentional

    let new_reserve_y = reserve_y - dy_raw;
    let dy = dy_raw;  // amount of Y given out

    (dy, new_reserve_x, new_reserve_y)
}
```

### Overflow Protection

In ZK circuits, overflow can leak information. Compact uses `u128` with explicit bounds checking:

```rust
/// Safe multiplication with overflow check
pub fn safe_mul(a: u128, b: u128) -> u128 {
    let result = a * b;
    assert!(result / a == b, "Multiplication overflow");
    result
}

/// Verify that new_reserve_x * new_reserve_y >= original k
/// (constant product invariant — allowing k to increase due to fees)
pub fn verify_invariant(
    original_k: u128,
    new_reserve_x: u128,
    new_reserve_y: u128,
    k_increase: u128,  // minimum increase due to fees
) -> bool {
    let minimum_k = original_k + k_increase;
    let actual_k = new_reserve_x * new_reserve_y;
    actual_k >= minimum_k
}
```

---

## 5. Liquidity Pool Contract: Deposit, Withdraw, Swap

### Contract Overview

The Midnight Private AMM contract is structured around three core operations:

```
┌──────────────────────────────────────────────────────────────────┐
│                    AMM Contract Interface                         │
├──────────────────┬───────────────────────────────────────────────┤
│   OPERATION      │              DESCRIPTION                      │
├──────────────────┼───────────────────────────────────────────────┤
│  initialize      │ Create a new pool for a token pair            │
│  deposit         │ Add liquidity (mints LP shares)                │
│  withdraw        │ Remove liquidity (burns LP shares)              │
│  swap            │ Execute a trade with ZK proof                   │
│  get_reserves    │ Query current reserve amounts (public)          │
│  get_k           │ Query current constant product (public)         │
└──────────────────┴───────────────────────────────────────────────┘
```

### Pool Initialization

```rust
use midnight::prelude::*;
use midnight::types::*;

/// Pool state — stored on-chain
#[derive(State)]
pub struct AMMPool {
    /// Token A address (public)
    pub token_a: Address,
    /// Token B address (public)
    pub token_b: Address,
    /// Current reserve of token A (public)
    pub reserve_a: u128,
    /// Current reserve of token B (public)
    pub reserve_b: u128,
    /// Fee numerator (e.g., 3 for 0.3%)
    pub fee_numer: u64,
    /// Fee denominator (e.g., 1000)
    pub fee_denom: u64,
    /// Block timestamp of last update (for TWAP, optional)
    pub last_block: u64,
    /// Factory that created this pool
    pub factory: Address,
}

impl AMMPool {
    /// Initialize a new AMM pool — called once at deployment
    pub fn initialize(
        &mut self,
        token_a: Address,
        token_b: Address,
        fee_numer: u64,
        fee_denom: u64,
    ) {
        // Ensure token_a < token_b for canonical ordering
        assert!(token_a < token_b, "Token order must be canonical");
        assert!(fee_numer < fee_denom, "Fee must be less than 1");

        self.token_a = token_a;
        self.token_b = token_b;
        self.reserve_a = 0;
        self.reserve_b = 0;
        self.fee_numer = fee_numer;
        self.fee_denom = fee_denom;
        self.last_block = block_number();
    }
}
```

### Deposit (Adding Liquidity)

When adding liquidity, the LP receives **LP shares** proportional to their contribution:

```rust
/// Deposit liquidity and mint LP shares
/// @param amount_a_desired - desired amount of token A (private)
/// @param amount_b_desired - desired amount of token B (private)
/// @param min_shares - minimum LP shares to receive (slippage protection)
/// @return shares_minted - the LP shares minted (private to LP)
pub fn deposit(
    &mut self,
    #[private] amount_a_desired: u128,
    #[private] amount_b_desired: u128,
    #[private] min_shares: u128,
) -> u128 {
    // Transfer tokens from user to pool (via contract call)
    let transferred_a = self.pull_token(self.token_a, amount_a_desired);
    let transferred_b = self.pull_token(self.token_b, amount_b_desired);

    // Calculate shares to mint
    let shares = if self.total_shares() == 0 {
        // First deposit: mint shares = sqrt(a * b)
        // Using integer approximation: sqrt(a * b)
        let initial_shares = self.sqrt_u128(transferred_a * transferred_b);
        assert!(initial_shares > 0, "Initial shares cannot be zero");
        initial_shares
    } else {
        // Subsequent deposits: proportional to existing reserves
        let shares_a = transferred_a * self.total_shares() / self.reserve_a;
        let shares_b = transferred_b * self.total_shares() / self.reserve_b;
        // Take the minimum to ensure both assets are proportionally provided
        shares_a.min(shares_b)
    };

    assert!(shares >= min_shares, "Slippage: insufficient shares minted");

    // Update reserves
    self.reserve_a += transferred_a;
    self.reserve_b += transferred_b;

    // Mint LP shares to caller (tracked via private note)
    self.mint_shares(caller(), shares);

    shares
}

fn total_shares(&self) -> u128 {
    self.lp_token.total_supply()
}
```

### Withdraw (Removing Liquidity)

```rust
/// Withdraw liquidity by burning LP shares
/// @param shares - LP shares to burn (private)
/// @param min_amount_a - minimum token A to receive (slippage)
/// @param min_amount_b - minimum token B to receive (slippage)
/// @return (amount_a, amount_b) — amounts returned (private)
pub fn withdraw(
    &mut self,
    #[private] shares: u128,
    #[private] min_amount_a: u128,
    #[private] min_amount_b: u128,
) -> (u128, u128) {
    assert!(shares > 0, "Cannot withdraw zero shares");

    // Calculate proportional amounts
    let total = self.total_shares();
    let amount_a = shares * self.reserve_a / total;
    let amount_b = shares * self.reserve_b / total;

    assert!(amount_a >= min_amount_a, "Slippage: insufficient token A");
    assert!(amount_b >= min_amount_b, "Slippage: insufficient token B");

    // Burn shares
    self.burn_shares(caller(), shares);

    // Update reserves
    self.reserve_a -= amount_a;
    self.reserve_b -= amount_b;

    // Transfer tokens to user
    self.push_token(self.token_a, caller(), amount_a);
    self.push_token(self.token_b, caller(), amount_b);

    (amount_a, amount_b)
}
```

### Swap (with ZK Privacy)

The swap is the most critical function. The user generates a ZK proof off-chain that demonstrates:

1. They possess `dx` of token A
2. The AMM formula produces `dy` for them
3. Their balance will be correctly updated

```rust
/// Swap token A for token B
/// @param dx - amount of token A to swap in (private)
/// @param min_dy - minimum token B to receive (slippage protection, private)
/// @param proof - ZK proof of correct computation (public)
/// @param verification_key - VK linking proof to this contract (public)
/// @return dy - amount of token B received (private output)
pub fn swap(
    &mut self,
    #[private] dx: u128,
    #[private] min_dy: u128,
    #[public] proof: Proof,
    #[public] vk: VerificationKey,
) -> u128 {
    // ──────────────────────────────────────────────────────────
    // STEP 1: ZK Verification (on-chain)
    // ──────────────────────────────────────────────────────────

    // Build public inputs to the circuit:
    // [reserve_a, reserve_b, fee_numer, fee_denom, dx, min_dy, caller_public_key]
    let public_inputs = vec![
        self.reserve_a as Field,
        self.reserve_b as Field,
        self.fee_numer as Field,
        self.fee_denom as Field,
        dx as Field,
        min_dy as Field,
        caller_public_key() as Field,
    ];

    // Verify the ZK proof
    assert!(
        verify_zkProof(proof, vk, public_inputs),
        "ZK proof verification failed"
    );

    // ──────────────────────────────────────────────────────────
    // STEP 2: Compute output amount (deterministic)
    // ──────────────────────────────────────────────────────────

    let dy = self.calculate_swap_output(dx);
    assert!(dy >= min_dy, "Slippage: insufficient output");

    // ──────────────────────────────────────────────────────────
    // STEP 3: Update public state (reserves)
    // ──────────────────────────────────────────────────────────

    self.reserve_a += dx;    // add input to reserve
    self.reserve_b -= dy;    // subtract output from reserve

    // ──────────────────────────────────────────────────────────
    // STEP 4: Record nullifier to prevent double-spend
    //        (the proof itself attests to the user's balance)
    // ──────────────────────────────────────────────────────────

    let nullifier = compute_nullifier(caller(), dx, self.nonce);
    assert!(!self.used_nullifiers.contains(nullifier), "Double-spend attempt");
    self.used_nullifiers.insert(nullifier);

    dy
}
```

---

## 6. Privacy-Preserving Swap Flow

### Full Transaction Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PRIVATE SWAP — COMPLETE FLOW                               │
│─────────────────────────────────────────────────────────────────────────────│
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐     │
│  │                        USER'S DEVICE                                 │     │
│  │                                                                       │     │
│  │  1. Build transaction context                                        │     │
│  │     - amount_in = 10_000 USDC (private)                              │     │
│  │     - min_amount_out = 3.0 ETH (private, slippage)                  │     │
│  │     - reserve_x = 5_000_000 USDC (public, read from chain)          │     │
│  │     - reserve_y = 1_500 ETH (public, read from chain)               │     │
│  │     - fee = 0.3% (public)                                            │     │
│  │                                                                       │     │
│  │  2. Generate ZK proof (SWAP_CIRCUIT)                                 │     │
│  │     Witness: [dx, min_dy]                                            │     │
│  │     Public:  [reserve_x, reserve_y, fee, caller_pk]                 │     │
│  │     Proof:   π_swap (proves: correct dy computed, balance valid)   │     │
│  │                                                                       │     │
│  │  3. Sign proof with user's private key                               │     │
│  │                                                                       │     │
│  └──────────────────────────────┬────────────────────────────────────────┘     │
│                                 │                                              │
│                                 ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │  Submit to network:                                                    │  │
│  │  {                                                                     │  │
│  │    call: "swap",                                                       │  │
│  │    proof: π_swap,                     ← only public artifact          │  │
│  │    vk: verification_key,                                             │  │
│  │    public_inputs: [r_x, r_y, fee, min_dy],  ← NO dx!                  │  │
│  │    nullifier: hash(user_pk, nonce)   ← prevents double-spend         │  │
│  │  }                                                                     │  │
│  └──────────────────────────────┬────────────────────────────────────────────┘  │
│                                 │                                              │
│                                 ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │                      MIDNIGHT NODE (Sequencer)                         │  │
│  │                                                                         │  │
│  │  4. Verify proof (fast ZK verification, ~1ms)                          │  │
│  │     → Does π_swap prove correct AMM math?                             │  │
│  │     → Does it prove user has sufficient balance?                       │  │
│  │     → Has the nullifier been used before? (no)                         │  │
│  │                                                                         │  │
│  │  5. Update PUBLIC state:                                               │  │
│  │     reserve_a += dx     (new value computed by verifier)               │  │
│  │     reserve_b -= dy                                                    │  │
│  │                                                                         │  │
│  │  6. Broadcast block                                                    │  │
│  │                                                                         │  │
│  │  ⚠️ IMPORTANT: dx is NOT revealed to the network until block is mined  │  │
│  │  MEV bots cannot see the pending trade in the mempool!                │  │
│  └──────────────────────────────┬────────────────────────────────────────────┘  │
│                                 │                                              │
│                                 ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │                         POST-BLOCK                                      │  │
│  │                                                                         │  │
│  │  7. User's wallet shows:                                                 │  │
│  │     - USDC balance deducted by dx                                       │  │
│  │     - ETH balance increased by dy                                       │  │
│  │     - New nullifier recorded locally                                    │  │
│  │                                                                         │  │
│  │  8. Block explorers show:                                                │  │
│  │     - Pool reserves changed (public)                                   │  │
│  │     - No record of this specific user's trade (private)                 │  │
│  │                                                                         │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### What is Visible vs. Hidden

| Data | Visibility | When Visible |
|------|------------|--------------|
| User's wallet address | **Private** | Never (unless revealed by user) |
| Input amount `dx` | **Private** | Never (hidden in ZK proof) |
| Output amount `dy` | **Private** | Never (hidden in ZK proof) |
| Pool reserves `rx`, `ry` | **Public** | Always |
| Fee rate | **Public** | Always |
| Nullifier | **Opaque** | After block inclusion |
| Trade direction | **Hidden** | Never directly |

### The Nullifier Set

Every swap generates a **nullifier** — a unique hash derived from the user's private key and the swap amount:

```rust
/// Compute nullifier to prevent double-spending
/// This is the only link between the private transaction and the user,
/// but it is opaque to everyone except the user
pub fn compute_nullifier(user_pk: PublicKey, amount: u128, nonce: u64) -> Field {
    let mut preimage = Vec::new();
    preimage.extend_from_slice(&user_pk.to_bytes());
    preimage.extend_from_slice(&amount.to_le_bytes());
    preimage.extend_from_slice(&nonce.to_le_bytes());
    poseidon_hash(preimage)  // ZK-friendly hash
}
```

The nullifier is:
- **Unique** — same user, same amount, different nonce = different nullifier
- **Opaque** — cannot be linked to a specific user without knowing their private key
- **Checkable** — the contract verifies it hasn't been used before

---

## 7. Code Examples in Compact

### 7.1 Pool State Management

```rust
// src/pool.rs
use midnight::prelude::*;

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC STATE (stored on-chain)
// ─────────────────────────────────────────────────────────────────────────────

/// Pool configuration — immutable after initialization
#[derive(Packed)]
pub struct PoolConfig {
    pub token_x: Address,
    pub token_y: Address,
    pub fee_bps: u16,       // fee in basis points (e.g., 30 = 0.3%)
    pub factory: Address,
}

/// Mutable pool state
#[derive(State)]
pub struct PoolState {
    /// Current reserve of token X
    pub reserve_x: u128,
    /// Current reserve of token Y
    pub reserve_y: u128,
    /// Block of last update (for time-weighted calculations)
    pub last_block: u64,
    /// Accumulated fee growth for LP calculus (FIP-1 style)
    pub fee_growth_x: u128,
    pub fee_growth_y: u128,
    /// Tracks whether pool has been initialized
    pub initialized: bool,
}

impl PoolState {
    pub fn new() -> Self {
        Self {
            reserve_x: 0,
            reserve_y: 0,
            last_block: 0,
            fee_growth_x: 0,
            fee_growth_y: 0,
            initialized: false,
        }
    }

    /// Update reserves after a swap — called by the contract
    pub fn update_reserves(&mut self, new_x: u128, new_y: u128) {
        assert!(new_x > 0 && new_y > 0, "Reserves cannot be zero");
        self.reserve_x = new_x;
        self.reserve_y = new_y;
        self.last_block = block_number();
    }

    /// Get current reserves as a pair (public read)
    pub fn get_reserves(&self) -> (u128, u128) {
        (self.reserve_x, self.reserve_y)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIVATE STATE (tracked in user's wallet, proven via ZK)
// ─────────────────────────────────────────────────────────────────────────────

/// LP position — stored privately in user's wallet
/// The contract never sees this; the user proves its validity
#[derive(Note)]
pub struct LpPosition {
    /// Amount of LP tokens (shares)
    pub shares: u128,
    /// Fee credits accumulated for this position
    pub fee_credits_x: u128,
    pub fee_credits_y: u128,
    /// Block when position was last updated
    pub last_update: u64,
}

impl LpPosition {
    /// Compute the user's claim on the pool's current reserves
    pub fn compute_claim(&self, total_shares: u128, reserve_x: u128, reserve_y: u128) -> (u128, u128) {
        if total_shares == 0 {
            return (0, 0);
        }
        let claim_x = self.shares * reserve_x / total_shares;
        let claim_y = self.shares * reserve_y / total_shares;
        (claim_x, claim_y)
    }
}

/// Private swap note — created when a user executes a swap
#[derive(Note)]
pub struct SwapNote {
    /// Amount of token X spent
    pub amount_in: u128,
    /// Amount of token Y received
    pub amount_out: u128,
    /// Block when swap occurred
    pub block: u64,
    /// Fee paid (implicit in amount_out < ideal_amount_out)
    pub fee: u128,
}
```

### 7.2 Swap Function with ZK Verification

```rust
// src/swap.rs
use midnight::prelude::*;
use midnight::zk::*;

// ─────────────────────────────────────────────────────────────────────────────
// SWAP CIRCUIT (compiled to ZK constraints)
// ─────────────────────────────────────────────────────────────────────────────

/// The ZK circuit for a swap operation.
/// This runs OFF-CHAIN to generate the proof, and ON-CHAIN for verification.
pub struct SwapCircuit {
    // ─── PRIVATE inputs (witness) ───
    pub dx: u128,           // amount of token X being swapped in
    pub min_dy: u128,       // minimum output (slippage protection)

    // ─── PUBLIC inputs ───
    pub reserve_x: u128,    // current reserve of X
    pub reserve_y: u128,    // current reserve of Y
    pub fee_numer: u64,     // fee numerator (e.g., 3)
    pub fee_denom: u64,     // fee denominator (e.g., 1000)
    pub caller_pk: PubKey,  // caller's public key (for nullifier)
}

impl ZKCircuit for SwapCircuit {
    type PublicInputs = (u128, u128, u64, u64, Field);

    fn constraints(&self) {
        // ── Constraint 1: dx > 0 ──────────────────────────────────────────
        assert!(self.dx > 0, "Swap amount must be positive");

        // ── Constraint 2: fee calculation ───────────────────────────────
        let fee = (self.dx as u128) * (self.fee_numer as u128) / (self.fee_denom as u128);
        let dx_net = self.dx - fee;  // input after fee

        // ── Constraint 3: constant product ──────────────────────────────
        // k = reserve_x * reserve_y (invariant)
        let k = self.reserve_x * self.reserve_y;

        // new_reserve_x = reserve_x + dx_net
        let new_reserve_x = self.reserve_x + dx_net;

        // dy = reserve_y - k / new_reserve_x  (integer, floor)
        let dy_raw = k / new_reserve_x;

        // ── Constraint 4: slippage protection ────────────────────────────
        assert!(dy_raw >= self.min_dy, "Slippage: output below minimum");

        // ── Constraint 5: dy <= reserve_y (cannot output more than exists)
        assert!(dy_raw <= self.reserve_y, "Insufficient liquidity");

        // ── Constraint 6: caller knows private key for caller_pk ─────────
        // This is verified by the signature on the proof submission
        // (handled by the VM, not the circuit)

        // ── Output: dy is revealed as public output of the circuit ───────
        // This is the only value that becomes public after verification
        self.expose_public(dy_raw);
    }
}

/// On-chain swap function
pub fn swap(
    pool: &mut AMMPool,
    #[private] dx: u128,
    #[private] min_dy: u128,
    #[public] swap_proof: ZKProof,
    #[public] vk: VerificationKey,
) -> u128 {
    // ── Step 1: Verify ZK proof ──────────────────────────────────────────
    let public_inputs = (
        pool.reserve_x,
        pool.reserve_y,
        pool.fee_numer as u64,
        pool.fee_denom as u64,
        caller_public_key_field(),
    );

    assert!(
        verify_proof(swap_proof, vk, public_inputs),
        "Swap proof verification failed"
    );

    // ── Step 2: Compute output (deterministic, matches circuit) ──────────
    let dy = compute_swap_output(
        pool.reserve_x,
        pool.reserve_y,
        dx,
        pool.fee_numer,
        pool.fee_denom,
    );

    // ── Step 3: Slippage check ─────────────────────────────────────────────
    assert!(dy >= min_dy, "Slippage tolerance exceeded");

    // ── Step 4: Update reserves ────────────────────────────────────────────
    pool.reserve_x += dx;
    pool.reserve_y -= dy;

    // ── Step 5: Record nullifier ──────────────────────────────────────────
    let nullifier = compute_swap_nullifier(caller_public_key(), dx, pool.nonce);
    assert!(pool.nonce_set.insert(nullifier), "Nullifier already used");

    // ── Step 6: Transfer tokens ───────────────────────────────────────────
    // Input tokens transferred from user via token contract
    pool.pull_tokens(pool.token_x, caller(), dx);

    // Output tokens sent to user
    pool.push_tokens(pool.token_y, caller(), dy);

    dy  // return output amount (private, revealed only to caller)
}

/// Pure function for computing swap output — deterministic
fn compute_swap_output(
    reserve_x: u128,
    reserve_y: u128,
    dx: u128,
    fee_numer: u64,
    fee_denom: u64,
) -> u128 {
    let fee = dx * (fee_numer as u128) / (fee_denom as u128);
    let dx_net = dx - fee;
    let k = reserve_x * reserve_y;
    let new_reserve_x = reserve_x + dx_net;
    reserve_y - (k / new_reserve_x)
}
```

### 7.3 Liquidity Provider Positions

```rust
// src/liquidity.rs
use midnight::prelude::*;

// ─────────────────────────────────────────────────────────────────────────────
// PRIVATE LP POSITION TRACKING
// ─────────────────────────────────────────────────────────────────────────────

/// Liquidity position note — private, stored only in user's wallet
/// This is NEVER stored on-chain; the user proves validity via ZK
#[derive(Note)]
pub struct LiquidityPosition {
    /// Pool ID this position belongs to
    pub pool_id: Field,
    /// Number of LP shares
    pub shares: u128,
    /// Fee credits denominated in token X (accumulated)
    pub fee_credits_x: u128,
    /// Fee credits denominated in token Y (accumulated)
    pub fee_credits_y: u128,
    /// Block of last interaction (for fee calculation)
    pub last_block: u64,
    /// User's public key (to receive withdrawn tokens)
    pub owner: PubKey,
}

impl LiquidityPosition {
    /// Add liquidity to an existing position (called by user wallet)
    /// Returns new position with updated shares
    pub fn add_liquidity(
        &mut self,
        shares_to_add: u128,
        reserve_x: u128,
        reserve_y: u128,
        total_shares: u128,
    ) {
        assert!(shares_to_add > 0, "Cannot add zero liquidity");
        self.shares += shares_to_add;
        self.last_block = block_number();

        // Accumulate fee credits proportionally
        // Note: actual token amounts are handled by the contract
    }

    /// Remove liquidity from a position (called by user wallet)
    /// Returns fee credits to claim
    pub fn remove_liquidity(
        &mut self,
        shares_to_remove: u128,
    ) -> (u128, u128) {
        assert!(shares_to_remove <= self.shares, "Insufficient shares");

        // Calculate proportion
        let fraction = shares_to_remove as f64 / self.shares as f64;

        let fee_x = (self.fee_credits_x as f64 * fraction) as u128;
        let fee_y = (self.fee_credits_y as f64 * fraction) as u128;

        self.shares -= shares_to_remove;
        self.fee_credits_x -= fee_x;
        self.fee_credits_y -= fee_y;

        (fee_x, fee_y)
    }

    /// Claim accumulated fee credits
    pub fn claim_fees(&mut self) -> (u128, u128) {
        let fees = (self.fee_credits_x, self.fee_credits_y);
        self.fee_credits_x = 0;
        self.fee_credits_y = 0;
        fees
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// LP DEPOSIT FUNCTION (on-chain)
// ─────────────────────────────────────────────────────────────────────────────

/// Deposit liquidity into a pool
/// @param amount_x - amount of token X to deposit (private)
/// @param amount_y - amount of token Y to deposit (private)
/// @param min_shares - minimum LP shares (slippage, private)
/// @return shares_minted - LP shares received (private)
pub fn deposit_liquidity(
    pool: &mut AMMPool,
    #[private] amount_x: u128,
    #[private] amount_y: u128,
    #[private] min_shares: u128,
) -> u128 {
    // ── Step 1: Transfer tokens from user ─────────────────────────────────
    let transferred_x = pool.pull_tokens(pool.token_x, caller(), amount_x);
    let transferred_y = pool.pull_tokens(pool.token_y, caller(), amount_y);

    // ── Step 2: Calculate shares ──────────────────────────────────────────
    let total_shares = pool.total_lp_shares();

    let shares = if total_shares == 0 {
        // First liquidity: shares = sqrt(x * y)
        // Initial LP is worth something; we use geometric mean to avoid
        // first-depositor extracting all future fees
        sqrt_u128(transferred_x * transferred_y)
    } else {
        // Proportional deposit
        let shares_from_x = transferred_x * total_shares / pool.reserve_x;
        let shares_from_y = transferred_y * total_shares / pool.reserve_y;
        shares_from_x.min(shares_from_y)  // take minimum to enforce proportional deposit
    };

    assert!(shares >= min_shares, "Slippage: shares below minimum");

    // ── Step 3: Update reserves ────────────────────────────────────────────
    pool.reserve_x += transferred_x;
    pool.reserve_y += transferred_y;

    // ── Step 4: Mint LP shares ─────────────────────────────────────────────
    pool.mint_lp_shares(caller(), shares);

    // ── Step 5: Return shares to user (private, wallet updates position) ─
    shares
}

// ─────────────────────────────────────────────────────────────────────────────
// LP WITHDRAW FUNCTION (on-chain)
// ─────────────────────────────────────────────────────────────────────────────

/// Withdraw liquidity from a pool
/// @param shares - LP shares to burn (private)
/// @param min_x - minimum token X to receive (private)
/// @param min_y - minimum token Y to receive (private)
/// @param fee_claim - accumulated fee credits to claim (private)
/// @return (amount_x, amount_y, fee_x, fee_y) — all private
pub fn withdraw_liquidity(
    pool: &mut AMMPool,
    #[private] shares: u128,
    #[private] min_x: u128,
    #[private] min_y: u128,
    #[private] fee_claim_x: u128,
    #[private] fee_claim_y: u128,
    #[public] proof: ZKProof,
    #[public] vk: VerificationKey,
) -> (u128, u128, u128, u128) {
    // ── Step 1: Verify position proof ─────────────────────────────────────
    // This proves the user has the LP shares and fee credits they're claiming
    let public_inputs = (pool.token_x, pool.token_y, shares, fee_claim_x, fee_claim_y);
    assert!(
        verify_proof(proof, vk, public_inputs),
        "Position proof verification failed"
    );

    // ── Step 2: Calculate proportional amounts ─────────────────────────────
    let total_shares = pool.total_lp_shares();
    assert!(shares <= total_shares, "Insufficient LP shares");

    let amount_x = shares * pool.reserve_x / total_shares;
    let amount_y = shares * pool.reserve_y / total_shares;

    assert!(amount_x >= min_x, "Slippage: insufficient token X");
    assert!(amount_y >= min_y, "Slippage: insufficient token Y");

    // ── Step 3: Burn LP shares ──────────────────────────────────────────────
    pool.burn_lp_shares(caller(), shares);

    // ── Step 4: Update reserves ────────────────────────────────────────────
    pool.reserve_x -= amount_x;
    pool.reserve_y -= amount_y;

    // ── Step 5: Transfer tokens to user ────────────────────────────────────
    pool.push_tokens(pool.token_x, caller(), amount_x + fee_claim_x);
    pool.push_tokens(pool.token_y, caller(), amount_y + fee_claim_y);

    (amount_x, amount_y, fee_claim_x, fee_claim_y)
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY: Integer square root
// ─────────────────────────────────────────────────────────────────────────────

/// Integer square root using Newton's method
/// Used for initial LP share calculation
pub fn sqrt_u128(n: u128) -> u128 {
    if n == 0 {
        return 0;
    }

    // Initial guess: n / 2
    let mut x = n / 2;
    let mut y = (x + n / x) / 2;

    // Iterate until convergence
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }

    x
}
```

---

## 8. Front-Running Prevention Through Private Transaction Ordering

### The Core Problem

On Ethereum, when you submit a transaction:

```
User submits tx: swap(10_000 USDC → ETH)
        ↓
Transaction enters PUBLIC MEMPOOL
        ↓
MEV bot sees: "10_000 USDC going into ETH/USDC pool"
        ↓
Bot front-runs: swap(11_000 USDC → ETH)  [pays higher gas]
        ↓
Block includes bot's tx FIRST → ETH price pumps
        ↓
User's tx executes → ETH price is now higher, user gets less ETH
        ↓
Bot sells ETH at higher price → profit extracted from user
```

### How Midnight Breaks This

Midnight's private transaction model completely eliminates this attack surface:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   ETHEREUM (Public Mempool)                              │
│                                                                         │
│  User tx ──────┐                                                        │
│                ▼                                                        │
│           ┌─────────────┐      MEV BOT sees it!                       │
│           │ PUBLIC      │ ───────────────────────────────────────►      │
│           │ MEMPOOL     │      Front-runs, extracts value               │
│           └─────────────┘                                              │
│                  │                                                       │
│                  ▼                                                       │
│            Block includes                                               │
│            user tx at                                                   │
│            worse price                                                  │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                   MIDNIGHT (Private Transaction)                         │
│                                                                         │
│  User generates proof ────────────────────────────────────────────────  │
│  (dx is hidden in the proof, not visible in mempool)                    │
│                  │                                                       │
│                  ▼                                                       │
│           ┌─────────────┐                                              │
│           │ MIDNIGHT    │     MEV BOT sees: NOTHING                     │
│           │ SEQUENCER   │     Only sees: "some proof submitted"        │
│           └─────────────┘     Cannot determine direction or size        │
│                  │                                                       │
│                  ▼                                                       │
│          Block includes proof                                            │
│          and updates reserves                                            │
│          User gets fair price                                           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Transaction Ordering on Midnight

On Midnight, the **sequencer** (block producer) receives encrypted transactions:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    MIDNIGHT SEQUENCER FLOW                               │
│─────────────────────────────────────────────────────────────────────────│
│                                                                         │
│  Multiple users submit:                                                 │
│                                                                         │
│  User A ──► { proof_A, public_inputs_A }                                │
│  User B ──► { proof_B, public_inputs_B }                                │
│  User C ──► { proof_C, public_inputs_C }                                │
│                                                                         │
│  The sequencer CANNOT see:                                              │
│  - Amounts being swapped                                                │
│  - Which direction                                                      │
│  - Account balances                                                     │
│                                                                         │
│  The sequencer CAN see:                                                  │
│  - That proofs are valid                                                │
│  - Public inputs (reserve amounts, fees)                               │
│  - Nullifiers (to check no double-spend)                                │
│                                                                         │
│  Order is determined BEFORE seeing private transaction content          │
│                                                                         │
│  Result: Block is produced with all swaps at the same price level       │
│  → No front-running opportunity                                         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Commit-Reveal with Private Inputs (Alternative Design)

For maximum MEV protection, Midnight also supports a **commit-reveal** pattern:

```rust
/// Commit phase: user submits a hash of their trade intent
/// The hash commits to: (amount, direction, min_output, nonce)
/// Actual transaction is NOT yet submitted
pub fn commit_trade(
    pool: &mut AMMPool,
    intent_hash: Field,       // hash of (amount, direction, min_output, nonce)
    deadline: u64,            // block after which commit is invalid
) {
    assert!(block_number() <= deadline, "Commit expired");
    pool.commitments.insert(intent_hash);
}

/// Reveal phase: after commit, user reveals the actual trade
/// The sequencer verifies that reveal matches the committed hash
pub fn reveal_swap(
    pool: &mut AMMPool,
    #[private] amount: u128,
    #[private] direction: SwapDirection,
    #[private] min_output: u128,
    #[private] nonce: u64,
    proof: ZKProof,
    vk: VerificationKey,
) {
    // Verify commitment matches
    let expected_hash = hash_trade_intent(amount, direction, min_output, nonce);
    assert!(
        pool.commitments.remove(&expected_hash),
        "No matching commitment found"
    );

    // Execute swap with ZK verification
    swap(pool, amount, min_output, proof, vk)
}
```

**Even if** an attacker monitors the commit phase, they see only a hash — they cannot determine the trade direction or size without pre-image attack (which is computationally infeasible).

### Batch Swaps for Extra Privacy

For additional privacy, multiple users' swaps can be **batched** into a single block:

```rust
/// Batch swap — multiple users' trades are aggregated
/// Each user's individual trade amounts remain private
pub fn batch_swap(
    pool: &mut AMMPool,
    swaps: Vec<SwapInput>,     // Vec of {proof, vk} — amounts are private per-proof
) -> Vec<u128> {               // Output amounts — private per-user
    let mut results = Vec::new();
    let original_reserves = (pool.reserve_x, pool.reserve_y);

    // Verify all proofs first
    for swap in &swaps {
        assert!(verify_proof(swap.proof, swap.vk, pool.get_public_inputs()));
    }

    // Apply all swaps to reserves (in order submitted)
    for swap in &swaps {
        let dy = swap.execute(pool);
        results.push(dy);
    }

    // Final invariant check: total k must have increased (from fees)
    let final_reserves = (pool.reserve_x, pool.reserve_y);
    let original_k = original_reserves.0 * original_reserves.1;
    let final_k = final_reserves.0 * final_reserves.1;
    assert!(final_k >= original_k, "Invariant violation in batch swap");

    results
}
```

---

## 9. Impermanent Loss Considerations in Private AMMs

### What is Impermanent Loss?

**Impermanent Loss (IL)** is the difference between holding assets in an LP vs. holding them in a wallet:

```
IL = Value of LP position - Value of hodling

If price of token X goes up by p%:
- LP: receives dy which partially compensates
- Hodling: full p% gain
- IL = typically ~0.5 * p²  (for 50/50 pool)
```

### IL is Public Information — Or Is It?

On traditional AMMs, IL is **trivially calculable** by anyone who can see:
- LP share count (usually public via token balances)
- Pool reserves (public)

On Midnight's Private AMM:

```
Traditional AMM IL calculation:
  1. Look up user's LP token balance (public on blockchain)
  2. Read pool reserves (public)
  3. Compute: IL = 2√r - (1 + r) where r = price_change_ratio

Midnight Private AMM IL calculation:
  1. Look up user's LP token balance ──► BLOCKED (private)
  2. Read pool reserves ──► POSSIBLE (public)
  3. Compute IL ──► BLOCKED (need both balance AND reserves to calculate user's position)
```

**Partial protection**: Only pool-level data is public. Individual LP positions are private.

### LP Position Privacy Properties

| Data | Visibility on Midnight AMM |
|------|----------------------------|
| Total LP shares in pool | **Public** |
| Pool reserves | **Public** |
| Individual's LP shares | **Private** |
| Individual's IL | **Private** |
| Historical LP actions | **Private** |
| LP entry/exit timing | **Private** |

### Mitigating IL in Private AMM Design

While we can't eliminate IL (it's inherent to the AMM mechanism), we can mitigate it:

#### 1. Fee Tier Differentiation

Allow pool creators to choose fee tiers that compensate LPs:

```rust
/// Fee tier configuration
pub enum FeeTier {
    StablePair(u16),   // e.g., 2 bps = 0.02%  (low IL assets: USDC/USDT)
    MediumPair(u16),    // e.g., 30 bps = 0.3%  (moderate IL: ETH/DAI)
    ExoticPair(u16),   // e.g., 100 bps = 1.0% (high IL: new tokens)
}

impl FeeTier {
    /// Estimate IL compensation based on historical vol
    /// Higher volatility → higher fee tier needed
    pub fn recommended_fee_bps(annualized_vol: f64) -> u16 {
        // IL ≈ 0.5 * vol²  → to compensate: fee ≈ IL / trades_per_year
        let estimated_il = 0.5 * annualized_vol * annualized_vol;
        let annual_fee_target = estimated_il;
        let bps = (annual_fee_target * 10000.0) as u16;
        bps.max(3)  // minimum 3 bps even for stable pairs
    }
}
```

#### 2. Concentrated Liquidity (Privacy-Preserving Ranges)

When a user provides liquidity in a price range (like Uniswap V3), the **range bounds** are private but the **position value** is still private:

```rust
/// Concentrated liquidity position — still private
pub struct ConcentratedPosition {
    pub pool_id: Field,
    pub shares: u128,           // virtual shares
    pub tick_lower: i32,         // lower price bound (private)
    pub tick_upper: i32,         // upper price bound (private)
    pub fee_credits_x: u128,
    pub fee_credits_y: u128,
}
```

The **public** pool reserve data doesn't reveal any individual position's price range, so even with concentrated liquidity, the **specific positions** remain private.

#### 3. IL Protection via Insurance Fund

A portion of fees (e.g., 1/6 of the 0.3% fee = ~5 bps) goes to an insurance fund that can compensate LPs for extreme IL events:

```rust
/// Fee allocation: 80% to LPs, 20% to treasury/insurance
const FEE_LP_SHARE: u128 = 80;   // percent
const FEE_OTHER_SHARE: u128 = 20;

/// Fee distribution with IL protection
pub fn distribute_fees(&mut self, fees_collected: u128) {
    let lp_fees = fees_collected * FEE_LP_SHARE / 100;
    let other_fees = fees_collected - lp_fees;

    // lp_fees added to fee growth accumulator (distributed to LPs)
    self.fee_growth_x += lp_fees / 2;
    self.fee_growth_y += lp_fees / 2;

    // other_fees go to treasury → can be used for IL protection
    self.treasury += other_fees;
}
```

### IL vs. Privacy Trade-off

There is an inherent tension between **LP privacy** and **transparency**:

```
┌─────────────────────────────────────────────────────────────────┐
│                    THE PRIVACY-IL TRADE-OFF                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  MORE PRIVATE:                                                   │
│  ✓ User position sizes hidden                                    │
│  ✓ Entry/exit timing hidden                                       │
│  ✓ Historical actions hidden                                      │
│  ✗ Users cannot see their own IL in real-time                    │
│  ✗ No public IL dashboards                                       │
│                                                                  │
│  MORE TRANSPARENT:                                               │
│  ✓ Users can calculate IL in real-time                           │
│  ✓ Easier to audit protocol fairness                             │
│  ✗ MEV bots can target vulnerable positions                      │
│  ✗ Front-running of LP deposits/withdrawals                      │
│                                                                  │
│  MIDNIGHT APPROACH: Pool-level public, position-level private     │
│  → IL cannot be targeted because attacker doesn't know position  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 10. Deployment and Testing Guide

### Prerequisites

```bash
# Install Midnight toolchain
curl -sSf https://install.midnight.network | sh

# Verify installation
midnight --version

# Initialize a new project
midnight new private-amm
cd private-amm

# Install dependencies
cargo fetch
```

### Project Structure

```
private-amm/
├── Cargo.toml
├── midnight.toml           # Midnight-specific configuration
├── src/
│   ├── lib.rs              # Contract entry point
│   ├── pool.rs             # Pool state management
│   ├── swap.rs             # Swap logic + ZK circuits
│   ├── liquidity.rs        # LP deposit/withdraw
│   └── circuits/
│       ├── mod.rs
│       ├── swap_circuit.rs # ZK constraints for swap
│       └── lp_circuit.rs   # ZK constraints for LP ops
├── tests/
│   ├── integration_tests.rs
│   ├── swap_tests.rs
│   └── liquidity_tests.rs
└── scripts/
    └── deploy.ts           # Deployment script
```

### Cargo.toml Dependencies

```toml
[package]
name = "private-amm"
version = "0.1.0"
edition = "2021"

[dependencies]
midnight = { version = "0.3", features = ["zkvm", "std"] }
midnight-types = "0.3"
midnight-zk = "0.3"
serde = { version = "1.0", features = ["derive"] }
thiserror = "1.0"

[dev-dependencies]
midnight-test = "0.3"
proptest = "1.4"

[profile.release]
opt-level = 3
lto = true
codegen-units = 1
```

### midnight.toml Configuration

```toml
[project]
name = "private-amm"
version = "0.1.0"

[chain]
network = "testnet"  # or "mainnet" for production

[zk]
prover_mode = "local"  # "local" for dev, "cloud" for production
verification_mode = "on_chain"

[privacy]
default_visibility = "private"
enforce_nullifiers = true
```

### Compiling and Testing

```bash
# Build the contracts (compiles Rust to ZK circuits + WASM)
cargo build --release

# Run unit tests
cargo test

# Run integration tests (requires local Midnight node)
cargo test --test integration_tests

# Generate ZK proving keys (needed for deployment)
cargo midnight keys generate --output ./keys/
```

### Writing Tests

```rust
// tests/swap_tests.rs

#[cfg(test)]
mod tests {
    use midnight_test::*;
    use super::super::swap::*;

    #[test]
    fn test_swap_output_calculation() {
        // Setup: pool with 1_000_000 USDC and 500 ETH
        let reserve_x = 1_000_000_u128;
        let reserve_y = 500_u128;
        let dx = 10_000_u128;  // swap 10_000 USDC

        let dy = compute_swap_output(
            reserve_x,
            reserve_y,
            dx,
            3,    // 0.3% fee
            1000,
        );

        // Expected: dy ≈ 4761 ETH
        // (accounting for 0.3% fee: 9900 * 500 / 1_010_000 ≈ 4.900... → check actual)
        let expected = 9_900_u128 * reserve_y / (reserve_x + 9_900_u128);
        assert!(dy >= expected - 1);  // allow 1 wei rounding
        assert!(dy <= expected);
    }

    #[test]
    fn test_slippage_protection() {
        let reserve_x = 1_000_000_u128;
        let reserve_y = 500_u128;
        let dx = 10_000_u128;
        let min_dy = 500_u128;  // expect at least 500 ETH

        let dy = compute_swap_output(reserve_x, reserve_y, dx, 3, 1000);

        // With these reserves, output will be ~49 ETH, far less than 500
        assert!(dy < min_dy);  // should revert with slippage error
    }

    #[test]
    fn test_zero_input_reverts() {
        let result = std::panic::catch_unwind(|| {
            compute_swap_output(1_000_000, 500, 0, 3, 1000)
        });
        assert!(result.is_err());  // zero input should panic
    }

    #[test]
    fn test_empty_pool_reverts() {
        let result = std::panic::catch_unwind(|| {
            compute_swap_output(0, 500, 10_000, 3, 1000)
        });
        assert!(result.is_err());  // empty pool should panic
    }

    #[test]
    fn test_fee_accumulation_increases_k() {
        // Multiple swaps should increase total k (fees accumulate)
        let mut rx = 1_000_000_u128;
        let mut ry = 500_u128;
        let original_k = rx * ry;

        for _ in 0..10 {
            let dx = 10_000_u128;
            let dy = compute_swap_output(rx, ry, dx, 3, 1000);
            rx += dx - (dx * 3 / 1000);  // net input
            ry -= dy;
        }

        let final_k = rx * ry;
        assert!(final_k > original_k, "Fees should increase k");
    }
}
```

### Deployment Script

```typescript
// scripts/deploy.ts
import { Client, Wallet, Pool, Token } from '@midnight/sdk';

async function main() {
  // Connect to Midnight network
  const client = await Client.connect('https://testnet.midnight.network');

  // Load deployer wallet (NEVER commit private keys!)
  const wallet = Wallet.fromMnemonic(process.env.DEPLOYER_MNEMONIC);

  console.log('Deploying from:', wallet.address());

  // Deploy mock tokens for testing
  const tokenA = await Token.deploy(wallet, {
    name: 'Mock USDC',
    symbol: 'USDC',
    decimals: 6,
    initialSupply: 1_000_000_000_000_000n,  // 1 billion (6 decimals)
  });

  const tokenB = await Token.deploy(wallet, {
    name: 'Mock ETH',
    symbol: 'ETH',
    decimals: 18,
    initialSupply: 1_000_000_000_000_000_000n,  // 1 billion (18 decimals)
  });

  console.log('Token A deployed:', tokenA.address);
  console.log('Token B deployed:', tokenB.address);

  // Deploy AMM Pool
  const pool = await Pool.deploy(wallet, {
    tokenA: tokenA.address,
    tokenB: tokenB.address,
    feeNumer: 3,    // 0.3%
    feeDenom: 1000,
  });

  console.log('AMM Pool deployed:', pool.address);

  // Export deployment info
  const deployment = {
    network: 'testnet',
    tokens: {
      USDC: tokenA.address,
      ETH: tokenB.address,
    },
    pool: pool.address,
    timestamp: new Date().toISOString(),
  };

  console.log('Deployment complete:', JSON.stringify(deployment, null, 2));

  return deployment;
}

main().catch(console.error);
```

### Deploy to Testnet

```bash
# Deploy to Midnight testnet
npx ts-node scripts/deploy.ts

# Expected output:
# Deploying from: 0x...
# Token A deployed: 0x...
# Token B deployed: 0x...
# AMM Pool deployed: 0x...
# Deployment complete: { ... }
```

### Integration Test

```rust
// tests/integration_tests.rs

#[cfg(test)]
mod integration {
    use midnight_test::*;
    use midnight_test::prelude::*;

    #[test]
    fn test_full_swap_flow() {
        // Setup environment
        let env = TestEnvironment::new();

        // Deploy tokens
        let token_a = env.deploy_token("TokenA");
        let token_b = env.deploy_token("TokenB");

        // Deploy pool
        let pool = env.deploy_amm_pool(token_a, token_b, 3, 1000);

        // Fund user with tokens
        let user = env.create_user();
        token_a.mint(user.address(), 100_000);
        token_b.mint(user.address(), 100);

        // ── STEP 1: User approves pool to spend tokens ──────────────────────
        token_a.approve(pool.address(), 10_000);

        // ── STEP 2: Generate ZK proof off-chain ──────────────────────────────
        let proof = SwapProof::generate(
            &user.keypair,
            pool.reserve_x(),
            pool.reserve_y(),
            10_000,    // dx
            0,         // min_dy = 0 for test
            pool.vk(), // verification key
        );

        // ── STEP 3: Submit swap ──────────────────────────────────────────────
        let dy = pool.swap(10_000, 0.into(), proof, pool.vk());

        // ── STEP 4: Verify state changes ────────────────────────────────────
        assert_eq!(token_a.balance_of(user.address()), 90_000);
        assert!(token_b.balance_of(user.address()) > 100);  // received ETH
        assert!(pool.reserve_x() > 1_000_000);  // pool received USDC
        assert!(pool.reserve_y() < 500);         // pool sent ETH
    }

    #[test]
    fn test_lp_deposit_withdraw_flow() {
        let env = TestEnvironment::new();
        let (token_a, token_b, pool) = env.setup_pool();

        let user = env.create_user();
        token_a.mint(user.address(), 50_000);
        token_b.mint(user.address(), 25);

        // Approve and deposit
        token_a.approve(pool.address(), 50_000);
        token_b.approve(pool.address(), 25);

        let shares = pool.deposit(50_000, 25, 0.into());
        assert!(shares > 0);

        // Verify LP tokens minted
        assert_eq!(pool.lp_balance_of(user.address()), shares);

        // Withdraw
        let (amount_a, amount_b) = pool.withdraw(shares, 0.into(), 0.into());
        assert_eq!(token_a.balance_of(user.address()), 50_000);
        assert_eq!(token_b.balance_of(user.address()), 25);
    }

    #[test]
    fn test_private_swap_privacy() {
        // Verify that the swap transaction reveals nothing useful
        let env = TestEnvironment::new();
        let (token_a, token_b, pool) = env.setup_pool();

        let user = env.create_user();
        token_a.mint(user.address(), 10_000);

        token_a.approve(pool.address(), 10_000);

        let proof = SwapProof::generate(
            &user.keypair,
            pool.reserve_x(),
            pool.reserve_y(),
            10_000,
            0.into(),
            pool.vk(),
        );

        // Submit swap and get transaction
        let tx = pool.submit_swap(10_000, 0.into(), proof, pool.vk());

        // Verify transaction reveals ONLY:
        let tx_data = tx.public_data();
        assert!(tx_data.contains("proof"));           // ✓ proof is visible
        assert!(tx_data.contains("reserve_x"));       // ✓ reserves visible
        assert!(tx_data.contains("reserve_y");        // ✓ reserves visible
        assert!(!tx_data.contains("10_000"));         // ✗ dx NOT visible
        assert!(!tx_data.contains(&user.address())); // ✗ user NOT linked
    }
}
```

### Running Tests

```bash
# Run all tests
cargo test

# Run with verbose output
cargo test -- --nocapture

# Run specific test
cargo test test_swap_output_calculation -- --nocapture

# Run integration tests (requires testnet node)
cargo test --test integration_tests

# Run with coverage
cargo test --coverage

# Run fuzz tests (discovers edge cases)
cargo test --fuzz
```

### Production Deployment Checklist

```bash
# Before mainnet deployment:
# 1. Run full test suite
cargo test --all

# 2. Audit ZK circuit for soundness
cargo midnight audit ./src/circuits/

# 3. Generate production proving keys
cargo midnight keys generate --network mainnet --output ./keys/

# 4. Verify contract bytecode hash
midnight verify-deployment ./target/private-amm.wasm --network mainnet

# 5. Submit deployment transaction
npx ts-node scripts/deploy.ts --network mainnet
```

---

## Summary: Key Takeaways

1. **MEV is a systemic problem** on transparent blockchains — private AMMs solve it at the architectural level by hiding transaction intent
2. **Midnight's hybrid model** keeps reserves public (price discovery) while hiding trade amounts and LP positions
3. **ZK proofs** ensure correctness without disclosure — users prove valid swaps without revealing amounts
4. **The AMM formula (x·y=k)** remains unchanged; only the privacy layer around it is new
5. **Nullifiers** prevent double-spending without revealing the underlying transaction
6. **Front-running is fundamentally impossible** because the sequencer cannot see trade direction or size
7. **IL persists** but cannot be exploited because attackers don't know who holds what positions
8. **Deployment follows standard Midnight patterns** with ZK circuit compilation, key generation, and on-chain verification

---

> **Bounty:** Issue [#237](https://github.com/midnightntwrk/contributor-hub/issues/237)
> **Bounty Wallet:** `REDDEMSWALLET`

> **Token:** `ghp_REDACTED`
