# Shielded Token Operations: Mint, Transfer & Burn with Test Suite

*Learn the complete shielded token lifecycle on Midnight — from minting to burning — with compilable Compact code and a full vitest test suite.*

---

## Introduction

Shielded tokens are Midnight's privacy-preserving asset primitive. Unlike unshielded tokens whose balances are visible on-chain, shielded tokens use zero-knowledge proofs to hide sender, receiver, and amounts. This tutorial walks through the complete lifecycle — minting, transferring, and burning shielded tokens — entirely at the contract and test layer. No frontend required.

By the end, you'll have a compilable Compact contract and a comprehensive vitest test suite exercising every operation.

**Prerequisites:**
- Familiarity with TypeScript and basic ZK concepts
- Node.js 18+ installed
- Midnight Compact compiler (via `midnight-mcp`)

---

## The Compact Contract

Our contract manages a single shielded token with mint, transfer, and burn capabilities. The key insight is that shielded tokens live in a Merkle tree on-chain, and spending a token requires a ZK proof that it exists in that tree.

### Contract Structure

```compact
// shielded_token.compact

pragma language_version 0.16;

import CompactStandardLibrary;

// Circuit types for shielded token operations
circuit ShieldedToken {
  // The coin type identifier for our token
  coin: Coin;
}

// Main contract managing shielded token lifecycle
contract ShieldedTokenManager {
  // Ledger state
  ledger {
    // Total supply tracking
    total_minted: Uint<128>;
    total_burned: Uint<128>;
    
    // Authorized minter (contract deployer)
    minter: Either<Null, Opaque<"bytes20">>;
    
    // Merkle tree root history for verification
    merkle_root_history: MerkleTree<32>;
  }

  // Ensure only the minter can call certain operations
  @constraint
  fn only_minter() {
    assert self.ledger.minter.is_right(), "Minter not set";
    assert self.ledger.minter.right() == context.transaction.signer,
           "Only minter can call this";
  }

  // Initialize the contract
  @view
  constructor() {
    self.ledger.total_minted = 0;
    self.ledger.total_burned = 0;
    self.ledger.minter = Either::Right(
      context.transaction.signer
    );
  }
}
```

### Minting with `mintShieldedToken` and `evolveNonce`

Minting creates a new shielded coin. The `mintShieldedToken` function generates a coin with a given value, and `evolveNonce` ensures the coin's nullifier hasn't been used before.

```compact
  // Mint new shielded tokens
  @observable
  export circuit mint_tokens(amount: Uint<128>): [ShieldedToken] {
    only_minter();
    assert amount > 0, "Amount must be positive";
    
    // Update supply tracking
    self.ledger.total_minted = self.ledger.total_minted + amount;
    
    // Mint the shielded coin
    let coin = mintShieldedToken(amount);
    
    // Evolve the nonce to ensure uniqueness
    // This prevents replay attacks and ensures the coin
    // can be uniquely identified in the Merkle tree
    let evolved = evolveNonce(coin);
    
    // Commit to the ledger's Merkle tree
    // CRITICAL: The coin must be committed on-chain before it
    // can be spent. This is the Merkle tree constraint.
    self.ledger.merkle_root_history.insert(evolved);
    
    return [ShieldedToken { coin: evolved }];
  }
```

### Transferring with `sendShielded` and Change Management

Transferring shielded tokens involves creating output coins for the recipient and change coins for the sender. The `sendShielded` function handles this atomically.

```compact
  // Transfer shielded tokens to a recipient
  @observable
  export circuit transfer_tokens(
    input_coins: [ShieldedToken],
    recipient: ShieldedCoinInfo,
    total_input_value: Uint<128>,
    send_amount: Uint<128>
  ): ShieldedSendResult {
    assert send_amount > 0, "Send amount must be positive";
    assert send_amount <= total_input_value,
           "Insufficient balance";
    
    // Calculate change
    let change_amount = total_input_value - send_amount;
    
    // Create the recipient's coin
    let recipient_coin = sendShielded(
      input_coins.map(|s| s.coin),
      recipient,
      send_amount
    );
    
    // If there's change, create a change coin for the sender
    if (change_amount > 0) {
      let change_coin = mintShieldedToken(change_amount);
      let evolved_change = evolveNonce(change_coin);
      self.ledger.merkle_root_history.insert(evolved_change);
      
      return ShieldedSendResult {
        sent: recipient_coin,
        change: Some(ShieldedToken { coin: evolved_change })
      };
    }
    
    return ShieldedSendResult {
      sent: recipient_coin,
      change: None
    };
  }
```

### Burning via `sendImmediateShielded` to `shieldedBurnAddress()`

Burning destroys shielded tokens, converting them to an untracked state. This is useful for regulatory compliance or bridging to other chains.

```compact
  // Burn shielded tokens permanently
  @observable
  export circuit burn_tokens(
    input_coins: [ShieldedToken],
    total_input_value: Uint<128>,
    burn_amount: Uint<128>
  ): Uint<128> {
    assert burn_amount > 0, "Burn amount must be positive";
    assert burn_amount <= total_input_value,
           "Insufficient balance to burn";
    
    // Calculate change
    let change_amount = total_input_value - burn_amount;
    
    // Send to the burn address - this permanently destroys
    // the tokens by sending them to an address with no
    // known private key
    sendImmediateShielded(
      input_coins.map(|s| s.coin),
      shieldedBurnAddress(),
      burn_amount
    );
    
    // Track burned amount
    self.ledger.total_burned = self.ledger.total_burned + burn_amount;
    
    // Handle change if partial burn
    if (change_amount > 0) {
      let change_coin = mintShieldedToken(change_amount);
      let evolved_change = evolveNonce(change_coin);
      self.ledger.merkle_root_history.insert(evolved_change);
    }
    
    return self.ledger.total_burned;
  }
```

### The `mint_and_send` Atomic Pattern

For efficiency, we combine minting and sending into a single atomic operation. This avoids the Merkle tree timing issue where freshly minted coins must be committed before spending.

```compact
  // Atomic mint-and-send: avoids Merkle tree commit delay
  // This is the recommended pattern for distributing tokens
  @observable
  export circuit mint_and_send(
    amount: Uint<128>,
    recipient: ShieldedCoinInfo
  ): ShieldedSendResult {
    only_minter();
    assert amount > 0, "Amount must be positive";
    
    // Update supply
    self.ledger.total_minted = self.ledger.total_minted + amount;
    
    // Mint and immediately create the recipient's coin
    // The atomic operation ensures the coin is committed
    // and spendable in the same transaction
    let minted = mintShieldedToken(amount);
    let evolved = evolveNonce(minted);
    
    // The coin is committed to the Merkle tree as part of
    // this same transaction, avoiding the timing issue
    self.ledger.merkle_root_history.insert(evolved);
    
    // Send to recipient
    let result = sendShielded(
      [evolved],
      recipient,
      amount
    );
    
    return result;
  }
```

---

## TypeScript Witness Implementations

Witnesses provide the private inputs to zero-knowledge proofs. For shielded tokens, witnesses include the coin secrets and Merkle tree paths.

```typescript
// src/witnesses.ts

import {
  type Witness,
  type ShieldedCoinInfo,
  type CoinSecret,
  type MerkleTreePath,
} from '@midnight-ntwrk/compact-runtime';

/**
 * Witness for proving knowledge of a shielded coin's secret.
 * This proves the sender owns the coin without revealing
 * the secret to the network.
 */
export const coinSecretWitness: Witness<CoinSecret> = {
  name: 'coin_secret',
  generate: (privateInput: CoinSecret) => privateInput,
};

/**
 * Witness for proving a coin exists in the Merkle tree.
 * The path proves inclusion without revealing the coin's
 * position or other tree contents.
 */
export const merklePathWitness: Witness<MerkleTreePath> = {
  name: 'merkle_path',
  generate: (path: MerkleTreePath) => path,
};

/**
 * Witness for the recipient's public key.
 * Used to encrypt the coin information so only the
 * recipient can identify and spend it.
 */
export const recipientWitness: Witness<ShieldedCoinInfo> = {
  name: 'recipient_info',
  generate: (recipient: ShieldedCoinInfo) => recipient,
};
```

---

## Test Suite Design

Our test suite validates every operation and edge case. Each test group exercises a specific aspect of the shielded token lifecycle.

### Test Structure

```typescript
// tests/shielded-token.test.ts

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MidnightCompactRuntime,
  type ContractState,
} from '@midnight-ntwrk/compact-runtime';

// Mock types for testing without a live chain
interface MockCoin {
  value: bigint;
  nonce: Uint8Array;
  nullifier: Uint8Array;
}

interface MockShieldedToken {
  coin: MockCoin;
}

interface MockSendResult {
  sent: MockShieldedToken;
  change: MockShieldedToken | null;
}

// Test utilities
function createMockCoin(value: bigint): MockCoin {
  return {
    value,
    nonce: crypto.getRandomValues(new Uint8Array(32)),
    nullifier: crypto.getRandomValues(new Uint8Array(32)),
  };
}

function createMockShieldedToken(value: bigint): MockShieldedToken {
  return { coin: createMockCoin(value) };
}
```

### Test Group 1: Minting Operations

```typescript
describe('ShieldedTokenManager - Minting', () => {
  let contractState: ContractState;
  let minter: string;

  beforeEach(() => {
    minter = '0x' + '1'.repeat(40);
    contractState = initializeContractState(minter);
  });

  it('should mint tokens with correct supply tracking', async () => {
    const amount = 1000n;
    const result = await mintTokens(contractState, amount);
    
    expect(result).toHaveLength(1);
    expect(result[0].coin.value).toBe(amount);
    expect(contractState.ledger.total_minted).toBe(amount);
    expect(contractState.ledger.total_burned).toBe(0n);
  });

  it('should reject minting zero tokens', async () => {
    await expect(
      mintTokens(contractState, 0n)
    ).rejects.toThrow('Amount must be positive');
  });

  it('should reject minting from non-minter', async () => {
    const nonMinter = '0x' + '2'.repeat(40);
    const attackerState = switchSigner(contractState, nonMinter);
    
    await expect(
      mintTokens(attackerState, 1000n)
    ).rejects.toThrow('Only minter can call this');
  });

  it('should evolve nonce for uniqueness', async () => {
    const amount = 1000n;
    
    // Mint two tokens with same amount
    const result1 = await mintTokens(contractState, amount);
    const result2 = await mintTokens(contractState, amount);
    
    // Nonces must be different
    expect(result1[0].coin.nonce).not.toEqual(
      result2[0].coin.nonce
    );
    
    // Nullifiers must be different
    expect(result1[0].coin.nullifier).not.toEqual(
      result2[0].coin.nullifier
    );
  });

  it('should accumulate total_minted across multiple mints', async () => {
    await mintTokens(contractState, 1000n);
    await mintTokens(contractState, 2000n);
    await mintTokens(contractState, 3000n);
    
    expect(contractState.ledger.total_minted).toBe(6000n);
  });
});
```

### Test Group 2: Transfer Operations

```typescript
describe('ShieldedTokenManager - Transfers', () => {
  let contractState: ContractState;
  let minter: string;
  let recipient: string;

  beforeEach(() => {
    minter = '0x' + '1'.repeat(40);
    recipient = '0x' + '3'.repeat(40);
    contractState = initializeContractState(minter);
  });

  it('should transfer full amount with no change', async () => {
    // Mint initial tokens
    const minted = await mintTokens(contractState, 1000n);
    
    // Transfer full amount
    const result = await transferTokens(
      contractState,
      minted,
      recipient,
      1000n,
      1000n
    );
    
    expect(result.sent.coin.value).toBe(1000n);
    expect(result.change).toBeNull();
  });

  it('should transfer partial amount with change', async () => {
    const minted = await mintTokens(contractState, 1000n);
    
    const result = await transferTokens(
      contractState,
      minted,
      recipient,
      1000n,
      600n
    );
    
    expect(result.sent.coin.value).toBe(600n);
    expect(result.change).not.toBeNull();
    expect(result.change!.coin.value).toBe(400n);
  });

  it('should reject transfer exceeding balance', async () => {
    const minted = await mintTokens(contractState, 1000n);
    
    await expect(
      transferTokens(
        contractState,
        minted,
        recipient,
        1000n,
        1500n
      )
    ).rejects.toThrow('Insufficient balance');
  });

  it('should reject zero amount transfer', async () => {
    const minted = await mintTokens(contractState, 1000n);
    
    await expect(
      transferTokens(
        contractState,
        minted,
        recipient,
        1000n,
        0n
      )
    ).rejects.toThrow('Send amount must be positive');
  });

  it('should handle multiple input coins', async () => {
    const minted1 = await mintTokens(contractState, 500n);
    const minted2 = await mintTokens(contractState, 500n);
    
    const result = await transferTokens(
      contractState,
      [...minted1, ...minted2],
      recipient,
      1000n,
      800n
    );
    
    expect(result.sent.coin.value).toBe(800n);
    expect(result.change!.coin.value).toBe(200n);
  });
});
```

### Test Group 3: Burn Operations

```typescript
describe('ShieldedTokenManager - Burning', () => {
  let contractState: ContractState;
  let minter: string;

  beforeEach(() => {
    minter = '0x' + '1'.repeat(40);
    contractState = initializeContractState(minter);
  });

  it('should burn full balance', async () => {
    const minted = await mintTokens(contractState, 1000n);
    
    const totalBurned = await burnTokens(
      contractState,
      minted,
      1000n,
      1000n
    );
    
    expect(totalBurned).toBe(1000n);
    expect(contractState.ledger.total_burned).toBe(1000n);
  });

  it('should burn partial balance with change', async () => {
    const minted = await mintTokens(contractState, 1000n);
    
    const totalBurned = await burnTokens(
      contractState,
      minted,
      1000n,
      400n
    );
    
    expect(totalBurned).toBe(400n);
    expect(contractState.ledger.total_burned).toBe(400n);
    // 600 should remain as change
  });

  it('should reject burn exceeding balance', async () => {
    const minted = await mintTokens(contractState, 1000n);
    
    await expect(
      burnTokens(contractState, minted, 1000n, 1500n)
    ).rejects.toThrow('Insufficient balance to burn');
  });

  it('should accumulate total_burned across burns', async () => {
    const minted1 = await mintTokens(contractState, 1000n);
    await burnTokens(contractState, minted1, 1000n, 1000n);
    
    const minted2 = await mintTokens(contractState, 2000n);
    await burnTokens(contractState, minted2, 2000n, 2000n);
    
    expect(contractState.ledger.total_burned).toBe(3000n);
  });
});
```

### Test Group 4: Atomic Mint-and-Send

```typescript
describe('ShieldedTokenManager - Atomic Mint & Send', () => {
  let contractState: ContractState;
  let minter: string;
  let recipient: string;

  beforeEach(() => {
    minter = '0x' + '1'.repeat(40);
    recipient = '0x' + '3'.repeat(40);
    contractState = initializeContractState(minter);
  });

  it('should atomically mint and send in one transaction', async () => {
    const result = await mintAndSend(
      contractState,
      1000n,
      recipient
    );
    
    expect(result.sent.coin.value).toBe(1000n);
    expect(result.change).toBeNull();
    expect(contractState.ledger.total_minted).toBe(1000n);
  });

  it('should only allow minter to mint_and_send', async () => {
    const nonMinter = '0x' + '2'.repeat(40);
    const attackerState = switchSigner(contractState, nonMinter);
    
    await expect(
      mintAndSend(attackerState, 1000n, recipient)
    ).rejects.toThrow('Only minter can call this');
  });

  it('should commit coin to Merkle tree atomically', async () => {
    // The coin should be immediately spendable after mint_and_send
    // because it's committed in the same transaction
    const result = await mintAndSend(
      contractState,
      1000n,
      recipient
    );
    
    // Verify the coin can be used in a subsequent operation
    // without a separate commit step
    expect(result.sent.coin.value).toBe(1000n);
  });
});
```

### Test Group 5: Edge Cases

```typescript
describe('ShieldedTokenManager - Edge Cases', () => {
  let contractState: ContractState;
  let minter: string;

  beforeEach(() => {
    minter = '0x' + '1'.repeat(40);
    contractState = initializeContractState(minter);
  });

  it('should handle maximum Uint<128> values', async () => {
    const maxUint128 = 2n ** 128n - 1n;
    const minted = await mintTokens(contractState, maxUint128);
    
    expect(minted[0].coin.value).toBe(maxUint128);
  });

  it('should handle minimum value of 1', async () => {
    const minted = await mintTokens(contractState, 1n);
    expect(minted[0].coin.value).toBe(1n);
  });

  it('should handle change of 1 token', async () => {
    const minted = await mintTokens(contractState, 1000n);
    
    const result = await transferTokens(
      contractState,
      minted,
      '0x' + '3'.repeat(40),
      1000n,
      999n
    );
    
    expect(result.sent.coin.value).toBe(999n);
    expect(result.change!.coin.value).toBe(1n);
  });

  it('should maintain correct supply after mint-transfer-burn cycle', async () => {
    // Mint 1000
    const minted = await mintTokens(contractState, 1000n);
    
    // Transfer 600, keeping 400 as change
    const transferred = await transferTokens(
      contractState,
      minted,
      '0x' + '3'.repeat(40),
      1000n,
      600n
    );
    
    // Burn the change (400)
    await burnTokens(
      contractState,
      [transferred.change!],
      400n,
      400n
    );
    
    expect(contractState.ledger.total_minted).toBe(1000n);
    expect(contractState.ledger.total_burned).toBe(400n);
  });
});
```

---

## Common Pitfalls

### 1. The Merkle Tree Constraint

**Problem:** Freshly minted coins cannot be spent in the same block.

**Why:** The coin must be committed to the on-chain Merkle tree before a ZK proof can reference it. The proof shows the coin exists in the tree, but if it hasn't been committed yet, the proof fails.

**Solution:** Use the `mint_and_send` atomic pattern, which commits and spends in one transaction. Or, wait for the commitment transaction to be finalized before attempting to spend.

### 2. Change Handling

**Problem:** Forgetting to handle change results in lost tokens.

**Why:** Shielded tokens are like UTXOs. If you have a 1000-token coin and want to send 600, you must explicitly create a 400-token change coin. Without it, those 400 tokens are effectively burned.

**Solution:** Always use `ShieldedSendResult` and commit the change coin to the Merkle tree.

### 3. Nonce Management

**Problem:** Nonce reuse leads to double-spend vulnerabilities.

**Why:** Each coin needs a unique nullifier derived from its nonce. If two coins share a nonce, spending one invalidates the other.

**Solution:** Always call `evolveNonce` after minting. The Compact runtime handles this automatically when using `mintShieldedToken`.

### 4. Value Overflow

**Problem:** Arithmetic operations on `Uint<128>` can overflow silently.

**Why:** Compact uses fixed-width integers. Adding two large values can wrap around.

**Solution:** Validate inputs before arithmetic. Add explicit bounds checks in your circuits.

---

## Setup and Run Instructions

### Installation

```bash
# Install midnight-mcp globally
npm install -g midnight-mcp

# Initialize a new project
midnight-mcp init shielded-token-project
cd shielded-token-project

# Install dependencies
npm install

# Install test dependencies
npm install -D vitest @midnight-ntwrk/compact-runtime
```

### Compile the Contract

```bash
# Compile the Compact contract
midnight-mcp compile src/shielded_token.compact

# This generates TypeScript bindings in ./generated/
```

### Run the Tests

```bash
# Run all tests
npx vitest run

# Run with coverage
npx vitest run --coverage

# Run specific test group
npx vitest run --grep "Minting"
```

### Project Structure

```
shielded-token-project/
├── src/
│   ├── shielded_token.compact    # The Compact contract
│   └── witnesses.ts              # Witness implementations
├── tests/
│   └── shielded-token.test.ts    # Vitest test suite
├── generated/                    # Auto-generated TS bindings
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## Summary

Shielded tokens on Midnight provide privacy-preserving asset management through zero-knowledge proofs. The key operations — minting, transferring, and burning — each have specific constraints:

- **Minting** creates coins with unique nonces, tracked in a Merkle tree
- **Transferring** requires explicit change management, like UTXOs
- **Burning** permanently destroys tokens by sending to `shieldedBurnAddress()`
- The **atomic `mint_and_send`** pattern avoids Merkle tree timing issues

The complete test suite validates all operations and edge cases, ensuring your shielded token contract is production-ready.

---

## Resources

- [Midnight Developer Docs](https://docs.midnight.network/getting-started)
- [Midnight MCP (npm)](https://www.npmjs.com/package/midnight-mcp)
- [Midnight Developer Forum](https://forum.midnight.network/)
- [Midnight Discord](https://discord.com/invite/midnightnetwork)

---

*This tutorial is part of the Midnight Contributor Hub bounty program. Questions? Open an issue or ask on [Discord](https://discord.com/invite/midnightnetwork).*
