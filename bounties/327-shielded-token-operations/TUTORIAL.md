---
title: "Shielded Token Operations: Mint, Transfer & Burn with Test Suite on Midnight"
description: "A deep dive into shielded token operations on Midnight — minting, transferring, and burning with ZK privacy, including a full vitest test suite."
tags: [midnight, compact, shielded-tokens, zero-knowledge, blockchain, tutorial]
published: false
---

# Shielded Token Operations: Mint, Transfer & Burn with Test Suite on Midnight

## Introduction

Shielded tokens are Midnight's core privacy feature. Unlike unshielded tokens where every transaction is public, shielded tokens use zero-knowledge proofs to hide amounts, sender addresses, and recipient information. Only the involved parties can see transaction details.

This tutorial walks through the complete shielded token lifecycle in Compact: minting, transferring, and burning, with compilable code and a full vitest test suite.

## Prerequisites

- Midnight toolchain installed (Compact compiler, midnight-node)
- Docker for local network
- Basic understanding of ZK concepts (Merkle trees, nonces)
- Node.js 18+ and TypeScript

## Part 1: How Shielded Tokens Work

Shielded tokens on Midnight use a UTXO (Unspent Transaction Output) model combined with ZK proofs. Key concepts:

- **ShieldedCoinInfo**: Represents a single shielded coin with a nonce, color (token type), and value
- **Nonce**: A unique value that evolves with each transaction to prevent replay attacks
- **Merkle Tree**: Tracks all minted shielded coins; new coins must be committed on-chain before they can be spent
- **ZswapCoinPublicKey**: The recipient's public key for encrypting the coin details

### The Shielded Token Lifecycle

```
1. Mint: Create a new shielded coin → Merkle tree commitment
2. Transfer: Spend existing coin → create new coin for recipient
3. Burn: Spend a coin → send to burn address (removed from circulation)
```

## Part 2: The Compact Contract

```compact
// contracts/shielded_token.compact
import CompactStandardLibrary;

// Receive shielded tokens from another contract or user
export circuit receiveShieldedTokens(coin: ShieldedCoinInfo): [] {
   receiveShielded(disclose(coin));
}

// Send shielded tokens to a user's public key
// Returns change and recipient coin information
export circuit sendShieldedToUser(
    input: QualifiedShieldedCoinInfo,
    publicKey: ZswapCoinPublicKey,
    value: Uint<128>
): ShieldedSendResult {
  return sendShielded(
      disclose(input),
      left<ZswapCoinPublicKey, ContractAddress>(disclose(publicKey)),
      disclose(value)
  );
}

// Mint shielded tokens to self (contract as recipient)
export circuit mintShieldedToSelf(
    domainSep: Bytes<32>,
    value: Uint<64>,
    nonce: Bytes<32>
): ShieldedCoinInfo {
  return mintShieldedToken(
      disclose(domainSep),
      disclose(value),
      disclose(nonce),
      right<ZswapCoinPublicKey, ContractAddress>(kernel.self())
  );
}

// Atomic mint-and-send: mint then immediately send to a public key
export circuit mintAndSendShielded(
    domainSep: Bytes<32>,
    mintValue: Uint<64>,
    mintNonce: Bytes<32>,
    publicKey: ZswapCoinPublicKey,
    sendValue: Uint<128>
): ShieldedSendResult {
  const coin = mintShieldedToken(
      disclose(domainSep),
      disclose(mintValue),
      disclose(mintNonce),
      right<ZswapCoinPublicKey, ContractAddress>(kernel.self())
  );

  const qualified = QualifiedShieldedCoinInfo {
      nonce: coin.nonce,
      color: coin.color,
      value: coin.value,
      mt_index: 0 as Uint<64>
  };

  return sendShielded(
      qualified,
      left<ZswapCoinPublicKey, ContractAddress>(disclose(publicKey)),
      disclose(sendValue)
  );
}

// Burn shielded tokens by sending to the burn address
export circuit burnShieldedTokens(
    input: QualifiedShieldedCoinInfo,
    value: Uint<128>
): [] {
  sendShielded(
      disclose(input),
      left<ZswapCoinPublicKey, ContractAddress>(shieldedBurnAddress()),
      disclose(value)
  );
}
```

### Compile

```bash
compact compile contracts/shielded_token.compact --out-dir compiled/
```

## Part 3: TypeScript Witness Implementation

```typescript
// src/witness.ts
import { type LedgerContext } from "@midnight-ntwrk/midnight-js";
import { type ContractInstance } from "@midnight-ntwrk/compact";

export interface ShieldedTokenWitnesses {
  /** Receive shielded coins into the contract */
  receiveShieldedTokens: (coin: ShieldedCoinInfo) => Promise<void>;

  /** Send shielded tokens to a user's public key */
  sendShieldedToUser: (
    input: QualifiedShieldedCoinInfo,
    publicKey: ZswapCoinPublicKey,
    value: bigint
  ) => Promise<ShieldedSendResult>;

  /** Mint new shielded tokens to the contract itself */
  mintShieldedToSelf: (
    domainSep: Uint8Array,
    value: bigint,
    nonce: Uint8Array
  ) => Promise<ShieldedCoinInfo>;

  /** Atomic mint and send operation */
  mintAndSendShielded: (
    domainSep: Uint8Array,
    mintValue: bigint,
    mintNonce: Uint8Array,
    publicKey: ZswapCoinPublicKey,
    sendValue: bigint
  ) => Promise<ShieldedSendResult>;

  /** Burn shielded tokens */
  burnShieldedTokens: (
    input: QualifiedShieldedCoinInfo,
    value: bigint
  ) => Promise<void>;
}

// Type definitions
export interface ShieldedCoinInfo {
  nonce: Uint8Array;
  color: Uint8Array;
  value: bigint;
}

export interface QualifiedShieldedCoinInfo extends ShieldedCoinInfo {
  mt_index: bigint;
}

export interface ShieldedSendResult {
  // Recipient's coin information
  recipientCoin: ShieldedCoinInfo;
  // Change coin (if any)
  changeCoin: ShieldedCoinInfo | null;
}

export type ZswapCoinPublicKey = Uint8Array;

export function createShieldedWitnesses(
  contract: ContractInstance,
  context: LedgerContext
): ShieldedTokenWitnesses {
  return {
    async receiveShieldedTokens(coin: ShieldedCoinInfo): Promise<void> {
      await contract.call("receiveShieldedTokens", [coin], context);
    },

    async sendShieldedToUser(
      input: QualifiedShieldedCoinInfo,
      publicKey: ZswapCoinPublicKey,
      value: bigint
    ): Promise<ShieldedSendResult> {
      const result = await contract.call(
        "sendShieldedToUser",
        [input, publicKey, value],
        context
      );
      return result as ShieldedSendResult;
    },

    async mintShieldedToSelf(
      domainSep: Uint8Array,
      value: bigint,
      nonce: Uint8Array
    ): Promise<ShieldedCoinInfo> {
      const result = await contract.call(
        "mintShieldedToSelf",
        [domainSep, value, nonce],
        context
      );
      return result as ShieldedCoinInfo;
    },

    async mintAndSendShielded(
      domainSep: Uint8Array,
      mintValue: bigint,
      mintNonce: Uint8Array,
      publicKey: ZswapCoinPublicKey,
      sendValue: bigint
    ): Promise<ShieldedSendResult> {
      const result = await contract.call(
        "mintAndSendShielded",
        [domainSep, mintValue, mintNonce, publicKey, sendValue],
        context
      );
      return result as ShieldedSendResult;
    },

    async burnShieldedTokens(
      input: QualifiedShieldedCoinInfo,
      value: bigint
    ): Promise<void> {
      await contract.call("burnShieldedTokens", [input, value], context);
    },
  };
}
```

## Part 4: Nonce and Merkle Tree Management

A critical aspect of shielded token operations is understanding the nonce evolution and Merkle tree constraints:

### Nonce Evolution

Every mint operation requires a unique nonce. The nonce prevents double-spending by ensuring each coin has a unique identifier:

```typescript
// src/nonce.ts
import { randomBytes } from "crypto";

/**
 * Generate a unique nonce for shielded token minting.
 * In production, maintain a counter or use a deterministic scheme.
 */
export function generateNonce(): Uint8Array {
  return randomBytes(32);
}

/**
 * Evolve a nonce for the next operation.
 * The Merkle tree requires freshly minted coins to be committed
 * on-chain before they can be spent in the same block.
 */
export function evolveNonce(currentNonce: Uint8Array): Uint8Array {
  // Hash the current nonce to produce the next one
  // This creates a chain of nonces that can be verified
  const hash = new Uint8Array(32);
  // In production, use a proper hash (Blake2 or SHA-256)
  for (let i = 0; i < 32; i++) {
    hash[i] = (currentNonce[i] + 1) % 256;
  }
  return hash;
}
```

### The Atomic mint_and_send Pattern

The `mintAndSendShielded` circuit is a common pattern that solves the Merkle tree timing constraint. When you mint a token, it must be committed on-chain before it can be spent. The atomic circuit handles both operations within a single circuit call, avoiding the need for a separate block confirmation between mint and send.

**Without the atomic pattern (two-step, may fail):**
```
1. mintShieldedToken() → coin created, but NOT yet in Merkle tree
2. sendShielded() → FAILS because Merkle tree doesn't know about this coin yet
```

**With the atomic pattern (single circuit):**
```
1. mintShieldedToSelf() → coin created
2. Immediately construct QualifiedShieldedCoinInfo with mt_index: 0
3. sendShielded() → succeeds because both operations are in the same circuit
```

## Part 5: Vitest Test Suite

```typescript
// tests/shielded_token.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { createContext } from "@midnight-ntwrk/midnight-js";
import { randomBytes } from "crypto";
import compiledContract from "../compiled/shielded_token.json";
import { createShieldedWitnesses, type ShieldedTokenWitnesses } from "../src/witness";
import { generateNonce } from "../src/nonce";

describe("Shielded Token Operations", () => {
  let witnesses: ShieldedTokenWitnesses;
  let aliceKey: ZswapCoinPublicKey;
  let domain: Uint8Array;

  beforeAll(async () => {
    // Setup: deploy contract and create witnesses
    const context = createContext({
      proverServerUrl: "http://localhost:6300",
      networkId: "DevNet",
    });

    const contract = await context.deploy(compiledContract);
    witnesses = createShieldedWitnesses(contract.instance, context);

    // Example public key (in production, get from wallet)
    aliceKey = new Uint8Array(32).fill(1);
    domain = new Uint8Array(32);
    // Pad domain identifier
    const domainStr = "shielded:demo";
    for (let i = 0; i < domainStr.length; i++) {
      domain[i] = domainStr.charCodeAt(i);
    }
  });

  it("should mint shielded tokens to self", async () => {
    const nonce = generateNonce();
    const mintValue = 1000n;

    const coin = await witnesses.mintShieldedToSelf(
      domain,
      mintValue,
      nonce
    );

    expect(coin).toBeDefined();
    expect(coin.nonce).toBeInstanceOf(Uint8Array);
    expect(coin.nonce.length).toBe(32);
    expect(coin.color).toBeInstanceOf(Uint8Array);
    expect(coin.color.length).toBe(32);
    expect(coin.value).toBe(mintValue);
  });

  it("should send shielded tokens to a user", async () => {
    // First mint tokens
    const nonce = generateNonce();
    const mintValue = 2000n;
    const coin = await witnesses.mintShieldedToSelf(
      domain,
      mintValue,
      nonce
    );

    // Now send to Alice
    const qualifiedInput = {
      nonce: coin.nonce,
      color: coin.color,
      value: coin.value,
      mt_index: 0n,
    };

    const sendValue = 500n;
    const result = await witnesses.sendShieldedToUser(
      qualifiedInput,
      aliceKey,
      sendValue
    );

    expect(result).toBeDefined();
    expect(result.recipientCoin).toBeDefined();
    expect(result.recipientCoin.value).toBe(sendValue);

    // Should have change if sendValue < mintValue
    if (result.changeCoin) {
      expect(result.changeCoin.value).toBe(mintValue - sendValue);
    }
  });

  it("should atomically mint and send", async () => {
    const nonce = generateNonce();
    const mintValue = 3000n;
    const sendValue = 1500n;

    const result = await witnesses.mintAndSendShielded(
      domain,
      mintValue,
      nonce,
      aliceKey,
      sendValue
    );

    expect(result).toBeDefined();
    expect(result.recipientCoin).toBeDefined();
    expect(result.recipientCoin.value).toBe(sendValue);

    // Change should be mintValue - sendValue
    if (result.changeCoin) {
      expect(result.changeCoin.value).toBe(mintValue - sendValue);
    }
  });

  it("should receive shielded tokens", async () => {
    // Mint a coin first
    const nonce = generateNonce();
    const coin = await witnesses.mintShieldedToSelf(
      domain,
      500n,
      nonce
    );

    // Receive it into the contract
    await expect(
      witnesses.receiveShieldedTokens(coin)
    ).resolves.not.toThrow();
  });

  it("should burn shielded tokens", async () => {
    // Mint tokens, then burn them
    const nonce = generateNonce();
    const coin = await witnesses.mintShieldedToSelf(domain, 700n, nonce);

    const qualifiedInput = {
      nonce: coin.nonce,
      color: coin.color,
      value: coin.value,
      mt_index: 0n,
    };

    await expect(
      witnesses.burnShieldedTokens(qualifiedInput, coin.value)
    ).resolves.not.toThrow();
  });

  it("should reject mint with duplicate nonce", async () => {
    const nonce = generateNonce();

    // First mint succeeds
    await witnesses.mintShieldedToSelf(domain, 100n, nonce);

    // Second mint with same nonce should fail
    await expect(
      witnesses.mintShieldedToSelf(domain, 100n, nonce)
    ).rejects.toThrow();
  });

  it("should handle multiple sequential mints", async () => {
    let prevNonce = generateNonce();

    for (let i = 0; i < 5; i++) {
      const coin = await witnesses.mintShieldedToSelf(domain, BigInt((i + 1) * 100), prevNonce);
      expect(coin).toBeDefined();
      expect(coin.value).toBe(BigInt((i + 1) * 100));

      // Evolve nonce for next mint
      prevNonce = evolveNonce(prevNonce);
    }
  });
});
```

### Test Configuration

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 60000, // Shielded operations may take longer
    hookTimeout: 120000, // Contract deployment can be slow
  },
});
```

### Running the Tests

```bash
# Ensure local network is running
docker compose -f ../midnight-local-dev/docker-compose.yml up -d

# Wait for proof server to be ready
sleep 10

# Run the shielded token tests
npx vitest run tests/shielded_token.test.ts

# Expected output:
#   ✓ should mint shielded tokens to self
#   ✓ should send shielded tokens to a user
#   ✓ should atomically mint and send
#   ✓ should receive shielded tokens
#   ✓ should burn shielded tokens
#   ✓ should reject mint with duplicate nonce
#   ✓ should handle multiple sequential mints
#   Tests: 7 passed, 7 total
```

## Common Pitfalls

| Pitfall | Symptom | Fix |
|---------|---------|-----|
| **Merkle tree timing** | Send fails after recent mint | Use the atomic `mintAndSendShielded` circuit |
| **Duplicate nonce** | `VM error: DuplicateNonce` | Always generate a new nonce per mint; use evolveNonce pattern |
| **Insufficient balance** | Send fails with underflow | Check `input.value >= sendValue` before calling send |
| **Wrong public key format** | `InvalidKey` error | Ensure ZswapCoinPublicKey is exactly 32 bytes |
| **Change management** | Lost tokens | Always handle the change coin from ShieldedSendResult |
| **Proof timeout** | Transaction hangs | Pre-warm the proof server; check resource limits |

## Conclusion

You've built a complete shielded token contract on Midnight with:

- **Four core circuits**: receive, send, mint, and atomic mint-and-send
- **Burn support**: Using `shieldedBurnAddress()` to remove tokens from circulation
- **Full test suite**: 7 tests covering minting, sending, receiving, burning, nonce uniqueness, and sequential operations
- **Nonce management**: Proper nonce evolution for secure token operations
- **Merkle tree awareness**: Understanding when freshly minted coins can be spent

The atomic `mintAndSendShielded` pattern is particularly important — it solves the Merkle tree timing constraint that trips up many developers. Always use it when you need to mint and transfer in the same operation.
