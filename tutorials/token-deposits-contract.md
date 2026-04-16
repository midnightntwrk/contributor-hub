# Tutorial: Accepting Token Deposits into a Contract: Receive, Track & Secure

**Bounty Issue**: #288

## Introduction

Accepting external tokens in a smart contract requires careful handling: receiving the tokens, updating internal balances, preventing re-entrancy attacks, and handling edge cases like zero transfers or unauthorized approvals. This tutorial covers production-ready token deposit patterns in Compact for Midnight.

## Background: ERC-20 vs Native Token Deposits

In most EVM chains, tokens are either:
- **Native tokens** (ETH, SOL): transferred via `transfer()` to msg.sender
- **ERC-20 tokens**: transferred via `transferFrom()` — requires prior approval

Midnight's Compact supports both patterns with additional privacy features. This tutorial focuses on ERC-20 style deposits using Midnight's token interface.

## Pattern 1: Basic Deposit with Balance Tracking

```compact
contract TokenVault {
  state {
    field token_address: Address;
    field total_deposits: Field;
    field deposits: Map<Address, Field>;  // user -> deposited amount
  }

  transition deposit(amount: Field) {
    // Validate amount
    constrain amount > 0;

    // Get the caller's address
    let caller = ctx.sender();

    // Transfer tokens from caller to this contract
    // The contract must be approved to spend caller's tokens
    token.transfer_from(caller, self.address, amount);

    // Update internal balance
    let current = self.deposits[caller];
    self.deposits[caller] = current + amount;
    self.total_deposits = self.total_deposits + amount;
  }
}
```

### The Approval Flow

Before calling `deposit()`, the user must approve the contract:

```typescript
import { Contract, providers } from 'thers';

const vault = new Contract(tokenVaultAddress, vaultABI);
const token = new Contract(tokenAddress, erc20ABI);

// Approve the vault to spend 100 tokens
await token.approve(vault.address, 100);
```

## Pattern 2: Reentrancy Protection

The single-function pattern above is vulnerable to reentrancy. If the token triggers a callback to the caller during `transfer_from`, the caller could recursively call `deposit()` before the balance is updated.

```compact
contract SecureTokenVault {
  state {
    field locked: bool;
    field deposits: Map<Address, Field>;
  }

  transition deposit(amount: Field) {
    // Non-reentrant check
    constrain !self.locked;
    self.locked = true;

    // Process deposit
    let caller = ctx.sender();
    token.transfer_from(caller, self.address, amount);

    let current = self.deposits[caller];
    self.deposits[caller] = current + amount;

    // Release lock
    self.locked = false;
  }

  // Separate withdrawal function
  transition withdraw(amount: Field) {
    constrain !self.locked;
    self.locked = true;

    let caller = ctx.sender();
    constrain self.deposits[caller] >= amount;

    self.deposits[caller] -= amount;
    token.transfer(caller, amount);

    self.locked = false;
  }
}
```

## Pattern 3: Deposit with Minimum Amount and Fee

```compact
contract FeeVault {
  state {
    field min_deposit: Field;
    field fee_basis_points: u64;
    field operator: Address;
    field deposits: Map<Address, Field>;
  }

  transition deposit(amount: Field) {
    // Minimum amount check
    constrain amount >= self.min_deposit;

    // Calculate fee
    let fee = (amount * self.fee_basis_points as Field) / 10000;
    let net_amount = amount - fee;

    // Transfer
    let caller = ctx.sender();
    token.transfer_from(caller, self.address, amount);

    // Credit net amount to user
    self.deposits[caller] = self.deposits[caller] + net_amount;
  }

  // Operator can withdraw fees
  transition withdraw_fees(to: Address, amount: Field) {
    let caller = ctx.sender();
    constrain caller == self.operator;

    token.transfer(to, amount);
  }
}
```

## Pattern 4: Conditional Airdrop Deposit (Privacy-Preserving)

For airdrop scenarios where you want to credit deposits without revealing amounts:

```compact
// Commitment = Hash(secret, amount)
// Deposit without revealing amount until claim
contract CommitmentVault {
  state {
    field commitments: Set<Field>;
    field claimed: Set<Field>;
    field nullifiers: Set<Field>;
  }

  transition deposit_commitment(commitment: Field) {
    // Verify commitment is not already used
    constrain !self.commitments.contains(commitment);

    // Add to commitment set
    self.commitments.insert(commitment);
  }

  transition withdraw(preimage: Field, amount: Field, recipient: Address) {
    // Derive commitment and nullifier
    let commitment = pedersen_hash(preimage, amount);
    let nullifier = pedersen_hash(preimage, ctx.tx_hash());

    // Constraints
    constrain self.commitments.contains(commitment);
    constrain !self.claimed.contains(commitment);
    constrain !self.nullifiers.contains(nullifier);

    // Mark as claimed
    self.claimed.insert(commitment);
    self.nullifiers.insert(nullifier);

    // Transfer to recipient
    token.transfer(recipient, amount);
  }
}
```

## Security Checklist

- [ ] **Always check `amount > 0`** — zero transfers waste gas
- [ ] **Implement reentrancy protection** for any state-changing operation after an external call
- [ ] **Use Checks-Effects-Interactions pattern**: update state before external calls
- [ ] **Validate token address** — don't accept deposits of the zero address
- [ ] **Handle edge cases**: rounding errors in fee calculations, maximum deposit limits
- [ ] **Test approval race conditions**: what if user reduces approval between checking and calling?
- [ ] **For privacy deposits**: always bind nullifiers to `ctx.tx_hash()`

## Common Pitfalls

### Pitfall 1: Missing Approval Check

```compact
// WRONG: Assumes transfer_from will always succeed
transition deposit(amount: Field) {
  token.transfer_from(ctx.sender(), self.address, amount);
  self.deposits[ctx.sender()] += amount;  // Can be exploited!
}
```

### Pitfall 2: Integer Overflow in Fee Calculation

```compact
// WRONG: fee calculation can overflow for large amounts
let fee = (amount * fee_bps) / 10000;  // May overflow field!

// RIGHT: use field arithmetic properly or cap amount
const MAX_AMOUNT: Field = 1000000;
const MAX_FEE_BPS: u64 = 100;
const max_fee = (MAX_AMOUNT * MAX_FEE_BPS as Field) / 10000;
```

## Testing Deposits

```typescript
// Test script
async function testDeposit() {
  const amount = 100n * 10n ** 18n;

  // Approve
  await token.approve(vault.address, amount);
  
  // Check allowance
  const allowance = await token.allowance(user.address, vault.address);
  console.log('Allowance:', allowance);

  // Deposit
  const tx = await vault.deposit(amount);
  const receipt = await tx.wait();
  console.log('Deposited:', receipt.events[0].args.amount);

  // Check balance
  const balance = await vault.balanceOf(user.address);
  console.log('Balance:', balance);
}
```

## Conclusion

Token deposit patterns in Compact require careful handling of:
- **Approval flow**: users must approve before deposit
- **Reentrancy**: use non-reentrant locks or CEI pattern
- **Privacy**: commitment/nullifier pattern for hidden amounts
- **Validation**: minimum amounts, fee calculations, overflow checks

The SecureTokenVault pattern with reentrancy protection is the minimum recommended implementation for any production contract holding token value.

---

*Author: 一筒 | GitHub: D2758695161*
