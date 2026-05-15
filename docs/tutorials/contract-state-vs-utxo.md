# Contract-State Accounting vs UTXO Tokens: Two Models for On-Chain Value

> **Difficulty:** Advanced | **Estimated Time:** 30 minutes

## Overview

Midnight supports two fundamental approaches for tracking on-chain value: UTXO-based tokens and contract-state accounting. This tutorial compares both models and explains when each is appropriate.

## Model 1: UTXO-Layer Tokens

UTXO (Unspent Transaction Output) tokens operate at the protocol layer through `receiveShielded` and `sendShielded` operations.

### How UTXO Tokens Work

```
Transaction Inputs (UTXOs consumed) → Transaction Outputs (new UTXOs created)
```

Each token exists as a discrete UTXO that must be explicitly consumed to create new outputs.

### UTXO Example: Shielded Transfer

```typescript
// Send shielded tokens via UTXO model
const result = await sendShielded({
  recipient: aliceAddress,
  amount: 100,
  tokenName: 'PrivacyCoin',
});
```

### When to Use UTXO Tokens

- **Real token transfers** between parties
- **Privacy-required transactions** (shielded tokens)
- **Asset representation** (NFTs, fungible tokens)
- **Cross-contract value movement**

## Model 2: Contract-State Accounting

Contract-state accounting uses Counter and Map fields within smart contracts to track balances internally, without creating UTXOs.

### How Contract-State Works

```typescript
// Using a Map to track balances internally
contract TokenLedger {
  // State variable tracks all balances
  balances: Map<Address, Uint>;
  
  function transfer(from: Address, to: Address, amount: Uint) {
    require(balances.get(from) >= amount);
    balances.set(from, balances.get(from) - amount);
    balances.set(to, balances.get(to) + amount);
  }
}
```

### When to Use Contract-State

- **Internal bookkeeping** within a single contract
- **Score or point systems** that don't need real token transfers
- **Governance voting weight** tracking
- **When token operations are blocked** or unavailable
- **Leaderboards and rankings**

## Comparison Matrix

| Aspect | UTXO Model | Contract-State |
|--------|-----------|----------------|
| Privacy | Built-in (shielded) | None by default |
| Atomicity | Per-transaction | Per-contract call |
| Cross-contract | Native | Manual bridging |
| Gas cost | Higher (proof gen) | Lower |
| Complexity | Higher | Lower |
| Best for | Real value transfer | Internal accounting |

## Practical Example: Hybrid Approach

A common pattern uses both models together:

1. **UTXO tokens** for deposits and withdrawals (real value movement)
2. **Contract-state** for internal accounting within the protocol

```typescript
// Deposit: UTXO → Contract State
async function deposit(amount: number) {
  // 1. Consume UTXO (real token transfer)
  await sendShielded({ recipient: contractAddress, amount });
  // 2. Update internal balance (contract state)
  await contract.updateBalance(userAddress, amount);
}

// Withdraw: Contract State → UTXO
async function withdraw(amount: number) {
  // 1. Verify internal balance (contract state)
  const balance = await contract.getBalance(userAddress);
  require(balance >= amount);
  // 2. Create UTXO (real token transfer)
  await receiveShielded({ recipient: userAddress, amount });
  // 3. Deduct internal balance
  await contract.updateBalance(userAddress, -amount);
}
```

## Conclusion

Use **UTXO tokens** when you need real value transfer with privacy guarantees. Use **contract-state accounting** for internal bookkeeping within your application. The most robust systems combine both approaches strategically.
