# Contract-State Accounting vs UTXO Tokens: Two Models for On-Chain Value

**By billbtbillb | May 2026**

You are building a Midnight dApp and need to track value. Maybe it is a marketplace where users deposit tokens. Maybe it is a leaderboard where points accumulate. Maybe it is a vault that holds assets in escrow. In every case you face the same architectural question: **should your contract move real tokens at the UTXO layer, or should it track balances in its own ledger state?**

This is not a minor implementation detail. The choice determines your privacy guarantees, your transaction costs, your debugging experience, and what happens when things go wrong. Pick the wrong model and you will spend weeks refactoring.

This tutorial builds both approaches side by side with working Compact contracts, explains the mechanics of each, and gives you a decision framework for choosing the right one.

---

## Prerequisites

- Midnight toolchain installed ([installation guide](https://docs.midnight.network/getting-started/installation))
- Node.js v22+
- Familiarity with Compact syntax ([hello world tutorial](https://docs.midnight.network/getting-started/hello-world))
- A funded wallet on Midnight testnet (or local devnet running)

---

## 1. Two Ways to Represent Value

### 1.1 The UTXO Model

Midnight inherits the UTXO (Unspent Transaction Output) model from Cardano. Tokens are not stored inside contracts. They exist as independent outputs on the ledger, each locked to a specific owner and token type. When you send tokens, you consume existing UTXOs and create new ones.

In Compact, a contract interacts with UTXO tokens through four primitives:

```
receiveShielded(coinInfo)    // Accept a shielded (private) token deposit
sendShielded(amount, color, recipient)  // Send a shielded token to someone
receiveUnshielded(coinInfo)  // Accept an unshielded (public) token deposit
sendUnshielded(amount, color, recipient) // Send an unshielded token
```

When a contract calls `receiveShielded`, it is not storing the token inside its state. It is proving that a valid UTXO exists, marking it as consumed, and producing a new UTXO locked to the contract. The token still lives on the UTXO ledger — the contract just became its new owner.

When the contract later calls `sendShielded`, it consumes its own UTXO and produces a new one locked to the recipient. The contract releases the token.

This is fundamentally different from how Ethereum contracts work. On Ethereum, `transferFrom` moves a balance entry inside an ERC-20 contract's storage. On Midnight, `receiveShielded`/`sendShielded` move actual UTXO outputs.

### 1.2 The Ledger-State Model

Compact contracts can declare `ledger` variables that persist on-chain. These are the contract's own bookkeeping:

```
export ledger totalVotes: Counter;
export ledger balances: Map<Bytes<32>, Uint<64>>;
export ledger status: Opaque<"string">;
```

A `Counter` tracks a single incrementing number. A `Map` associates keys with values. An `Opaque<"string">` stores arbitrary data. None of these hold tokens. They hold data that the contract controls.

When a contract increments a `Counter` or updates a `Map`, no tokens move. The contract is simply recording information. If you want to track "Alice has 100 credits," you store `balances[alice_address] = 100` in a `Map`. The 100 credits are not tokens — they are a number in the contract's state.

---

## 2. Building a UTXO Token Vault

Let us build a contract that accepts shielded token deposits and lets the owner withdraw them. This is the UTXO approach: real tokens flow in and out.

### 2.1 The Compact Contract

```compact
pragma language_version >= 0.23;

import CompactStandardLibrary;

// Token vault: accepts shielded deposits, owner can withdraw
export ledger owner: Bytes<32>;
export ledger depositCount: Counter;

// Constructor sets the deployer as owner
constructor() {
    owner = disclose(ownPublicKey);
}

// Deposit: anyone can send shielded tokens into the vault
export circuit deposit(): [] {
    receiveShielded();
    depositCount.increment();
}

// Withdraw: only the owner can pull tokens out
export circuit withdraw(amount: Uint<64>, color: Bytes<32>): [] {
    assert(disclose(ownPublicKey) == owner, "only owner can withdraw");
    sendShielded(amount, color, owner);
}
```

Walk through what happens:

1. **Deploy**: The constructor captures the deployer's public key as `owner`.
2. **deposit()**: A user builds a transaction that calls `deposit()`. The wallet attaches a shielded coin to the transaction. The contract calls `receiveShielded()`, which proves the coin is valid and locks it to the contract. The `depositCount` counter increments.
3. **withdraw()**: The owner calls `withdraw(amount, color)`. The contract calls `sendShielded(amount, color, owner)`, which creates a new UTXO output locked to the owner's address. The owner's wallet picks up this output on the next sync.

Key observations:

- The contract does not store the tokens in its state. The `depositCount` counter tracks how many deposits happened, but the actual tokens live on the UTXO ledger.
- The contract's state (`owner`, `depositCount`) is small. The token balances are tracked by the UTXO layer.
- Privacy: shielded tokens are encrypted. The vault's holdings are not visible on-chain.

### 2.2 TypeScript Integration

```typescript
import { Contract } from '@midnight-ntwrk/compact-runtime';

/**
 * Deploy the token vault contract.
 * The constructor sets the deployer as owner.
 */
async function deployVault(providers: any) {
  const contract = new Contract(TokenVaultContractModule);
  
  // Deploy with constructor context
  const deployTx = await contract.deploy(providers);
  const receipt = await providers.wallet.submitTransaction(deployTx);
  
  console.log('Vault deployed at:', contract.address);
  return contract;
}

/**
 * Deposit shielded tokens into the vault.
 * The wallet must be synced and have sufficient shielded balance.
 */
async function deposit(providers: any, contract: any) {
  // Build the deposit call — the wallet attaches the shielded coin
  const tx = await contract.callTx.deposit();
  const receipt = await providers.wallet.submitTransaction(tx);
  
  console.log('Deposit TX:', receipt.txHash);
  
  // Query deposit count from contract state
  const state = await providers.contract.getState(contract.address);
  console.log('Total deposits:', state.depositCount);
}

/**
 * Withdraw tokens from the vault (owner only).
 * The contract sends shielded tokens back to the owner's address.
 */
async function withdraw(providers: any, contract: any, amount: bigint, color: string) {
  const tx = await contract.callTx.withdraw(amount, color);
  const receipt = await providers.wallet.submitTransaction(tx);
  
  console.log('Withdraw TX:', receipt.txHash);
}
```

Notice that `deposit()` does not pass any token data from the TypeScript side. The wallet automatically attaches the right UTXO inputs. The `sendShielded` call inside the contract creates the UTXO output. The TypeScript code never touches raw coin data — the SDK handles it.

---

## 3. Building a Ledger-State Credit System

Now let us build a system that tracks credits purely in contract state. No real tokens move — just numbers in a `Map`.

### 3.1 The Compact Contract

```compact
pragma language_version >= 0.23;

import CompactStandardLibrary;

// Credit ledger: tracks balances in contract state
export ledger balances: Map<Bytes<32>, Uint<64>>;
export ledger admin: Bytes<32>;
export ledger totalSupply: Counter;

constructor() {
    admin = disclose(ownPublicKey);
}

// Admin credits an account with units
export circuit credit(account: Bytes<32>, amount: Uint<64>): [] {
    assert(disclose(ownPublicKey) == admin, "only admin can credit");
    let current: Uint<64> = balances.lookup(account);
    balances.insert(account, current + amount);
    totalSupply.increment();
}

// Transfer credits between accounts
export circuit transferCredits(recipient: Bytes<32>, amount: Uint<64>): [] {
    let sender: Bytes<32> = disclose(ownPublicKey);
    let senderBal: Uint<64> = balances.lookup(sender);
    assert(senderBal >= amount, "insufficient balance");
    
    let recipientBal: Uint<64> = balances.lookup(recipient);
    balances.insert(sender, senderBal - amount);
    balances.insert(recipient, recipientBal + amount);
}

// Query balance (read-only via queryLedgerState)
export circuit getBalance(account: Bytes<32>): Uint<64> {
    return balances.lookup(account);
}
```

Walk through:

1. **Deploy**: The deployer becomes `admin`.
2. **credit()**: The admin assigns credits to any account. This is a pure bookkeeping operation — no tokens are minted or transferred. The `Map` entry changes.
3. **transferCredits()**: Users can transfer credits between themselves. Again, pure arithmetic on the `Map` — no UTXO operations.
4. **getBalance()**: A read-only query that returns the balance from contract state.

Key observations:

- No `receiveShielded` or `sendShielded` anywhere. The contract never touches the UTXO layer.
- All value tracking happens in the `balances` Map and `totalSupply` Counter.
- The credits have no existence outside this contract. They are not transferable to other contracts or wallets.
- Privacy: the `Map` entries are visible on-chain (ledger state is public). Anyone can query balances.

### 3.2 TypeScript Integration

```typescript
import { Contract } from '@midnight-ntwrk/compact-runtime';

/**
 * Deploy the credit ledger contract.
 */
async function deployCreditLedger(providers: any) {
  const contract = new Contract(CreditLedgerContractModule);
  const deployTx = await contract.deploy(providers);
  const receipt = await providers.wallet.submitTransaction(deployTx);
  
  console.log('Credit ledger deployed at:', contract.address);
  return contract;
}

/**
 * Admin credits an account.
 * No tokens move — this is a pure state update.
 */
async function creditAccount(
  providers: any,
  contract: any,
  account: string,
  amount: bigint
) {
  const tx = await contract.callTx.credit(account, amount);
  const receipt = await providers.wallet.submitTransaction(tx);
  
  console.log('Credit TX:', receipt.txHash);
  
  // Read back the balance from contract state
  const balance = await contract.callTx.getBalance(account);
  console.log('Account balance:', balance);
}

/**
 * Transfer credits between accounts.
 * Pure arithmetic in contract state — no UTXO involved.
 */
async function transferCredits(
  providers: any,
  contract: any,
  recipient: string,
  amount: bigint
) {
  const tx = await contract.callTx.transferCredits(recipient, amount);
  const receipt = await providers.wallet.submitTransaction(tx);
  
  console.log('Transfer TX:', receipt.txHash);
}
```

---

## 4. Comparing the Two Approaches

### 4.1 Privacy

**UTXO tokens (shielded)**: Amounts and recipients are encrypted. A third party observing the chain cannot see how many tokens the vault holds or who deposited them. This is the strongest privacy model Midnight offers.

**Ledger-state accounting**: The `Map` and `Counter` values are stored in plaintext on-chain. Anyone who queries the contract can read every balance. If you need privacy, this model requires additional work — for example, storing hashed account identifiers instead of raw addresses, or combining with zero-knowledge proofs for selective disclosure.

### 4.2 Token Economics

**UTXO tokens**: Tokens have real economic value. They can be traded on DEXes, transferred between wallets, and used across multiple contracts. The token's lifecycle is independent of any single contract.

**Ledger-state credits**: Credits exist only inside the contract. They cannot be transferred to a wallet, traded externally, or used by other contracts unless those contracts explicitly query this contract's state. They are internal accounting units.

### 4.3 Transaction Costs

**UTXO tokens**: Every deposit and withdrawal requires zero-knowledge proof generation. The wallet must prove ownership of the UTXO, prove the coin commitment is valid, and produce a nullifier. This is computationally expensive — proof generation can take several seconds.

**Ledger-state accounting**: State updates require a proof that the transition is valid (the circuit constraints are satisfied), but there is no coin commitment or nullifier computation. These transactions are cheaper and faster to generate.

### 4.4 Concurrency

**UTXO tokens**: UTXOs are consumed atomically. Two transactions trying to spend the same UTXO will conflict — one succeeds, the other fails. This creates race conditions in high-throughput scenarios. (See the companion tutorial on [UTXO Race Conditions](../utxo-race-conditions/).)

**Ledger-state accounting**: State transitions are also atomic, but multiple transactions can update different keys in a `Map` without conflicting. However, two transactions updating the *same* key will still conflict. The contract can design around this with sharded keys.

### 4.5 Composability

**UTXO tokens**: Because tokens are ledger-native, any contract can accept them via `receiveShielded`. A token from your vault contract can flow into a DEX contract, a lending contract, or any other contract that knows how to receive it.

**Ledger-state credits**: Credits are trapped inside the contract. To make them composable, you would need to build explicit cross-contract query mechanisms — which is complex and fragile.

---

## 5. When to Use Each Approach

### Use UTXO tokens when:

- **You need real token transfers**: deposits, withdrawals, escrow, payments
- **You need privacy**: shielded UTXOs hide amounts and recipients
- **You need cross-contract composability**: tokens that flow between multiple contracts
- **You need wallet integration**: users see their token balance in their wallet
- **You are building financial primitives**: DEXes, lending, staking

### Use ledger-state accounting when:

- **Token operations are blocked or unavailable**: some Compact contexts cannot call `receiveShielded`/`sendShielded`
- **You need internal bookkeeping only**: vote tallies, reputation scores, access counts
- **The "credits" have no external economic value**: game points, achievement tracking
- **You need simple, cheap state updates**: counters, flags, metadata
- **You want full control over the accounting logic**: custom transfer rules, conditional balances

### Use both when:

- **You need a vault with metadata**: accept real tokens via UTXO, track deposit history in a `Map`
- **You need a staking contract**: users deposit real tokens (UTXO) and earn points tracked in state
- **You need an escrow with conditions**: hold tokens in UTXO and track agreement state in `Counter`/`Map`

---

## 6. Combining Both in a Single Contract

The most practical pattern is combining both models. Here is a sketch:

```compact
pragma language_version >= 0.23;

import CompactStandardLibrary;

// Real tokens: UTXO layer
export ledger totalDeposited: Counter;

// Bookkeeping: ledger state
export ledger balances: Map<Bytes<32>, Uint<64>>;
export ledger admin: Bytes<32>;

constructor() {
    admin = disclose(ownPublicKey);
}

// Deposit real tokens AND record in ledger state
export circuit deposit(amount: Uint<64>): [] {
    receiveShielded();
    totalDeposited.increment();
    
    let sender: Bytes<32> = disclose(ownPublicKey);
    let current: Uint<64> = balances.lookup(sender);
    balances.insert(sender, current + amount);
}

// Admin can adjust ledger-state credits (no real tokens)
export circuit adjustCredits(account: Bytes<32>, newBalance: Uint<64>): [] {
    assert(disclose(ownPublicKey) == admin, "admin only");
    balances.insert(account, newBalance);
}

// Withdraw: real tokens leave, ledger state updates
export circuit withdraw(amount: Uint<64>, color: Bytes<32>): [] {
    let sender: Bytes<32> = disclose(ownPublicKey);
    let current: Uint<64> = balances.lookup(sender);
    assert(current >= amount, "insufficient ledger balance");
    
    balances.insert(sender, current - amount);
    sendShielded(amount, color, sender);
}
```

This pattern gives you:
- Real token custody via the UTXO layer
- Fast, cheap balance queries via the `Map`
- Admin controls for credit adjustments without moving tokens
- A clear separation between "what the contract holds" (UTXO) and "what the contract tracks" (state)

---

## 7. Common Pitfalls

### 7.1 Forgetting That Ledger State Is Public

If you store `balances[alice] = 1000` in a `Map`, everyone on the network can see that Alice has 1000 credits. If your application needs private balances, you must use shielded UTXOs or add encryption at the application layer.

### 7.2 Assuming Ledger-State Credits Are Tokens

New developers often build a `Map`-based balance system and expect users to see those credits in their wallet. They will not. Wallet balances come from UTXOs, not from contract state. If you want wallet-visible balances, use UTXO tokens.

### 7.3 Ignoring UTXO Concurrency

If your contract holds a single large UTXO (one big deposit), only one withdrawal can happen per block. Users will get "UTXO not found" errors when competing for the same output. Design for multiple smaller UTXOs or implement batching strategies.

### 7.4 Mixing Up Privacy Models

Shielded UTXOs are private. Ledger state is public. If you `receiveShielded()` (private deposit) but then store the amount in a `Map` (public state), you have leaked the deposit amount. Be intentional about what is public and what is private.

### 7.5 Not Handling the Case Where Token Operations Are Blocked

In some Compact contexts (certain circuit configurations, certain network states), `receiveShielded`/`sendShielded` may not be available. If your contract's core logic depends on UTXO operations and those operations are blocked, the contract becomes non-functional. Consider having a ledger-state fallback.

---

## 8. Decision Framework

Ask yourself these questions:

1. **Does the user need to hold this value in their wallet?**
   - Yes → UTXO tokens
   - No → Ledger state is fine

2. **Does the value need to flow to other contracts?**
   - Yes → UTXO tokens
   - No → Ledger state is fine

3. **Do you need the balances to be private?**
   - Yes → Shielded UTXO tokens
   - No → Either approach works

4. **Are token operations available in your contract context?**
   - Yes → Choose based on requirements above
   - No → Ledger state is your only option

5. **Is performance/cost a primary concern?**
   - Yes → Ledger state is cheaper and faster
   - No → UTXO tokens provide stronger guarantees

---

## 9. Summary

| Dimension | UTXO Tokens | Ledger State |
|-----------|-------------|--------------|
| Privacy | Shielded (encrypted) | Public (plaintext) |
| Wallet visibility | Yes | No |
| Cross-contract use | Native | Manual |
| Cost | Higher (ZK proofs) | Lower |
| Concurrency | UTXO conflicts | Key-level conflicts |
| Economic value | Real tokens | Internal credits |

The right choice depends on your requirements. Most mature Midnight dApps use both: UTXO tokens for the value layer and ledger state for the metadata layer. Start with the decision framework above, and you will avoid the most common refactoring traps.

---

## Further Reading

- [Midnight Docs: Getting Started](https://docs.midnight.network/getting-started)
- [Midnight Docs: Compact Language](https://docs.midnight.network/compact)
- [Midnight MCP: AI-assisted development](https://www.npmjs.com/package/midnight-mcp)
- [Midnight Developer Forum](https://forum.midnight.network/)
- [Midnight Discord](https://discord.com/invite/midnightnetwork)
