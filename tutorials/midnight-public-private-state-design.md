# Tutorial: Designing Public vs. Private State: What Goes Where

**Bounty Issue**: #292

## Introduction

One of Midnight's defining features is the ability to design contracts with both public and private state. Choosing what goes where is one of the most important architectural decisions in Compact development. Put too much public and you leak privacy. Put too much private and you break composability. This tutorial teaches you how to make the right call.

## Understanding the Dual Ledger Architecture

Midnight uses a dual-ledger model:
- **Public ledger**: transactions and state visible to everyone (like Ethereum)
- **Private ledger**: state visible only to involved parties (protected by ZK proofs)

```
┌─────────────────────────────────────────────────────┐
│  Public Ledger (transparent)                        │
│  • msg.sender, msg.value                            │
│  • Public state: balances, parameters               │
│  • Everyone can read                                │
└─────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────┐
│  Private Ledger (confidential)                       │
│  • Private state: individual balances               │
│  • Transaction amounts (in certain designs)         │
│  • Only visible to transaction participants         │
└─────────────────────────────────────────────────────┘
```

## The Decision Framework

Ask these questions in order:

### 1. Does the data need to be readable by the counterparty?

**YES → Consider Private**
- Individual account balances in a DeFi protocol
- Trade details in an exchange
- Salary or personal financial data

**NO → Consider Public**
- Total value locked (TVL) in a protocol
- Governance parameters (fee rates, thresholds)
- Aggregated data (price oracles, indexes)

### 2. Does the data need to be verifiable by third parties?

**YES → Public (with proof)**
- Merkle proof that a private account has sufficient balance
- Zero-knowledge proof of identity without revealing data
- Compliance attestations

**NO → Private is sufficient**
- Bilateral contract terms
- Personal preferences or settings

### 3. Does the contract need atomic composability with other contracts?

**YES → Bridge via Public**
- Cross-contract calls require public data
- AMM pricing must be public for arbitrage
- Liquidation triggers need public thresholds

**NO → Can use Private**
- Standalone personal wallets
- Isolated bilateral agreements

## Pattern 1: Fully Public State

Best for: Governance, AMM pools, public parameters

```compact
// Public governance contract - everyone can see current parameters
contract PublicGovernance {
  state {
    field proposal_count: u64;
    field votes_for: Map<u64, Field>;
    field votes_against: Map<u64, Field>;
    field proposal_threshold: Field;
    field voting_period_blocks: u64;
  }

  transition propose(description: Field, target_value: Field) {
    let proposer = ctx.sender();

    // Public: check voting power publicly
    let voting_power = get_public_voting_power(proposer);
    constrain voting_power >= self.proposal_threshold;

    // Create proposal
    let id = self.proposal_count;
    self.proposal_count = id + 1;
    self.votes_for[id] = 0;
    self.votes_against[id] = 0;
  }
}
```

**Characteristics:**
- Anyone can read current state
- Anyone can verify governance health
- No privacy for voters or proposal details
- Full composability with other public contracts

## Pattern 2: Fully Private State

Best for: Personal wallets, confidential transactions, salary payments

```compact
// Private payment contract - only sender/receiver know the amounts
contract PrivatePayment {
  state {
    // Private: no on-chain balance tracking
    // Instead, use commitment scheme
    field commitments: Set<Field>;  // Hash of (secret, amount)
  }

  transition pay(recipient: Address, amount: Field, secret: Field) {
    let sender = ctx.sender();

    // Create commitment from secret + amount
    let commitment = pedersen_hash(secret, amount);

    // Verify commitment not already used
    constrain !self.commitments.contains(commitment);
    self.commitments.insert(commitment);

    // Transfer (public call, but amount hidden from ledger)
    token.transfer_from(sender, recipient, amount);
  }
}
```

**Characteristics:**
- On-chain observers cannot determine payment amounts
- Sender and receiver can verify via secret
- Not composable with other contracts
- Requires off-chain communication for verification

## Pattern 3: Hybrid — Public Total, Private Individual

Best for: DeFi protocols where aggregate data matters but individual positions are private

```compact
// Hybrid DEX — TVL is public, individual positions are private
contract HybridDEX {
  state {
    // PUBLIC: aggregate data
    field total_liquidity: Field;
    field current_price: Field;
    field last_trade_block: u64;

    // PRIVATE: individual positions (not stored on-chain)
    // Instead, use nullifier-based claims
    field liquidity_nullifiers: Set<Field>;
    field position_commitments: Set<Field>;
  }

  // Add liquidity — amount is public for pool math
  transition add_liquidity(amount: Field, secret: Field) {
    let provider = ctx.sender();

    // Public: update aggregate
    self.total_liquidity = self.total_liquidity + amount;

    // Private: create position commitment
    let commitment = pedersen_hash(provider, amount, secret);
    constrain !self.position_commitments.contains(commitment);
    self.position_commitments.insert(commitment);

    token.transfer_from(provider, self.address, amount);
  }

  // Swap — price is public, individual trade amount may be private
  transition swap(input_amount: Field, min_output: Field) {
    // Public: update price
    let price = calculate_price(input_amount, self.total_liquidity);
    constrain price >= min_output;
    self.current_price = price;

    // Transfer (public amounts for AMM math)
    let caller = ctx.sender();
    token.transfer_from(caller, self.address, input_amount);
    token.transfer(caller, price);
  }

  // Remove liquidity — prove your commitment off-chain
  transition remove_liquidity(nullifier: Field, secret: Field, amount: Field) {
    let provider = ctx.sender();
    let commitment = pedersen_hash(provider, amount, secret);

    // Verify commitment exists and nullifier not used
    constrain self.position_commitments.contains(commitment);
    constrain !self.liquidity_nullifiers.contains(nullifier);
    self.liquidity_nullifiers.insert(nullifier);

    // Update aggregate
    self.total_liquidity = self.total_liquidity - amount;

    token.transfer(provider, amount);
  }
}
```

## Pattern 4: Privacy Gradient

Design where different layers have different privacy levels:

```
Layer 0 (Public):      Aggregates, Oracles, Global Parameters
Layer 1 (Restricted):  Protocol-level state (e.g., "is this address whitelisted?")
Layer 2 (Private):     Individual user state (balances, positions)
Layer 3 (Fully Private): Transaction-graph obfuscation
```

```compact
// Layer 0: Public
field protocol_fee: u64;          // Public — everyone knows fee rate
field whitelist_enabled: bool;    // Public — transparency for compliance

// Layer 2: Private
field user_balance_nullifiers: Set<Field>;
field user_commitments: Set<Field>;
```

## Decision Matrix

| Data Type | Public or Private? | Reason |
|-----------|-------------------|---------|
| Total TVL | **Public** | Market transparency, arbitrage prevention |
| Individual balance | **Private** | User financial privacy |
| Transaction amount | **Private** | Prevents front-running, protects privacy |
| Fee rate | **Public** | User trust, auditability |
| User's KYC status | **Private** | Personal data, compliance via proof |
| Liquidation threshold | **Public** | Market stability, prevents oracle gaming |
| Individual position PnL | **Private** | Competitive advantage protection |
| Oracle price feed | **Public** | Required for consensus |

## Common Mistakes

### Mistake 1: Making Everything Public "Because It's Easier"

```compact
// WRONG for a private DeFi app
state {
  field user_balances: Map<Address, Field>;  // Everyone sees everyone's money!
  field transaction_history: Map<Address, Field>;  // Full financial surveillance!
}
```

### Mistake 2: Making Critical State Private That Should Be Public

```compact
// WRONG — if this is a loan collateral factor, it needs to be public
// so liquidators can react to undercollateralization
field secret_collateral_ratios: Set<Field>;
```

### Mistake 3: Broken Composability

```compact
// WRONG — private price means no one can liquidate you
transition liquidate(borrower: Address) {
  // Can't check public price! How do you know when to liquidate?
  constrain secret_price[borrower] < secret_debt[borrower] * liquidation_threshold;
}
```

## Testing Your Privacy Design

```typescript
// Test 1: Verify private data is NOT readable on-chain
const balance = await contract.user_balances(user);
console.log('On-chain balance (should be 0 or encrypted):', balance);
// Expected: either 0, null, or encrypted value, NOT the real balance

// Test 2: Verify public data IS readable
const tvl = await contract.totalLiquidity();
console.log('TVL:', tvl);
// Expected: real aggregate value

// Test 3: Verify ZK proof can still verify private data
const proof = await generateBalanceProof(user, secret, amount);
const verified = await contract.verifyCommitment(proof);
console.log('Proof valid:', verified);
```

## Security Checklist

- [ ] **Map all state variables** to Public/Private/Hybrid before writing code
- [ ] **Verify critical data is public** if it's needed for liquidation, oracle, or compliance
- [ ] **Verify sensitive data is private** if it would harm users if leaked
- [ ] **Test composability boundaries** — what can other contracts read from yours?
- [ ] **Consider the privacy gradient** — different layers may need different visibility
- [ ] **Document privacy assumptions** in code comments and external documentation

## Conclusion

The public/private decision is architectural — it affects security, composability, and privacy simultaneously. Use the decision framework:

1. Who needs to read this data?
2. Who needs to verify this data?
3. Does this need to compose with other contracts?

For most DeFi applications: **aggregate data public, individual data private** is the right default. Start there and move data to public only when required for security or composability.

---

*Author: 一筒 | GitHub: D2758695161*
