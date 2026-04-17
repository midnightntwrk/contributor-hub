# Tutorial: Concurrent Transactions on Midnight: UTXO vs Account Model

> **Author:** 涓€绛?(AI Agent)  
> **Issue:** #301  
> **Difficulty:** Medium  
> **Deliverable:** Tutorial + Code

---

## Overview

Midnight's compact contracts handle concurrent transactions differently than EVM-style blockchains. This tutorial explains how UTXO-based concurrency works in Midnight and how to write contracts that handle multiple simultaneous transactions correctly.

## The Problem

In Ethereum/Account model:
- Two transactions from the same sender can be ordered arbitrarily
- Reentrancy attacks are a real concern
- State updates are sequential by design

In Midnight/UTXO model:
- Each transaction consumes unspent outputs (UTXOs)
- Parallel transactions are truly parallel if they don't touch the same UTXOs
- No reentrancy by default (since state changes are atomic per UTXO)

## Step 1: Define a Transfer Contract

```typescript
import { compact, uint64, address } from '@midnightnight/night-language';

interface TransferOutput {
  recipient: address;
  amount: uint64;
  spent: boolean;
}

export const createTransfer = compact.publicProcedure(
  [uint64, address],
  async (ctx, [amount, recipient]) => {
    const senderBalance = await ctx.utils.get_native_balance(ctx.sender);
    if (senderBalance < amount) {
      throw new Error('Insufficient funds');
    }

    const output: TransferOutput = {
      recipient,
      amount,
      spent: false
    };

    return ctx.utils.create_utxo(output);
  }
);

export const claimTransfer = compact.publicProcedure(
  [],
  async (ctx) => {
    const pending = await ctx.utils.get_pending_utxos(ctx.sender);
    
    let total = BigInt(0);
    for (const utxo of pending) {
      const output = utxo.data as TransferOutput;
      if (!output.spent && output.recipient === ctx.sender) {
        total += BigInt(output.amount);
        // Mark as spent
        output.spent = true;
        await ctx.utils.update_utxo(utxo.id, output);
      }
    }
    
    return total;
  }
);

export const getPending = compact.publicQuery(
  [address],
  async (ctx, [addr]) => {
    const pending = await ctx.utils.get_pending_utxos(addr);
    return pending
      .filter(utxo => {
        const output = utxo.data as TransferOutput;
        return !output.spent && output.recipient === addr;
      })
      .map(utxo => (utxo.data as TransferOutput).amount);
  }
);
```

## Step 2: Handle Concurrent Claims

The key insight: multiple users can claim transfers simultaneously without conflict.

```typescript
// In your frontend
async function checkAndClaim() {
  const pending = await contract.getPending(wallet.address);
  
  if (pending.length > 0) {
    const tx = await contract.claimTransfer();
    await tx.wait();
    console.log('Claimed:', pending, 'tokens');
  }
}

// Poll for new transfers
setInterval(checkAndClaim, 5000);
```

## Step 3: Avoiding Double-Spend

Each UTXO can only be spent once. Midnight's runtime guarantees atomicity:

```typescript
export const atomicSwap = compact.publicProcedure(
  [uint64, address, address], // amount, alice, bob
  async (ctx, [amount, alice, bob]) => {
    // This transaction either fully completes or fully reverts
    // No partial states possible
    
    const aliceHasEnough = await ctx.utils.get_native_balance(alice) >= amount;
    const bobHasEnough = await ctx.utils.get_native_balance(bob) >= amount;
    
    if (!aliceHasEnough || !bobHasEnough) {
      throw new Error('Insufficient balance in atomic swap');
    }

    // Atomic exchange
    await ctx.utils.transfer_native_token(bob, amount, { from: alice });
    await ctx.utils.transfer_native_token(alice, amount, { from: bob });
    
    return { success: true, alice, bob, amount };
  }
);
```

## UTXO vs Account Model Comparison

| Aspect | Midnight (UTXO) | Ethereum (Account) |
|--------|----------------|-------------------|
| Concurrency | Truly parallel if different UTXOs | Sequential ordering |
| Reentrancy | Impossible by default | Must explicitly guard |
| State finality | Per-UTXO atomic | Global state atomic |
| Privacy | Better (off-chain) | Full on-chain |

## Conclusion

Midnight's UTXO model makes concurrent transactions safer:
- No reentrancy attacks possible
- Parallel execution when UTXOs don't overlap
- Atomic swaps with guaranteed consistency

---

*Written by 涓€绛? an AI agent building on Midnight.*
