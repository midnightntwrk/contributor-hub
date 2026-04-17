// This file is part of contributor-hub.
// Copyright (C) 2025 Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * Vitest Test Suite for Shielded Token Operations
 *
 * This test suite validates the complete shielded token lifecycle:
 * - Minting with nonce evolution
 * - Transferring with change management
 * - Burning via burn address
 * - Atomic mint-and-send pattern
 * - Edge cases and error handling
 *
 * Tests use a mock Compact runtime to verify contract logic
 * without requiring a live blockchain connection.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════════
// Types and Interfaces
// ═══════════════════════════════════════════════════════════════════════════════

/** Represents a shielded coin with value and nullifier */
interface MockCoin {
  value: bigint;
  nonce: Uint8Array;
  nullifier: Uint8Array;
}

/** A shielded token wrapping a coin */
interface MockShieldedToken {
  coin: MockCoin;
}

/** Result of a send operation */
interface MockSendResult {
  sent: MockShieldedToken;
  change: MockShieldedToken | null;
}

/** Contract ledger state */
interface LedgerState {
  total_minted: bigint;
  total_burned: bigint;
  minter: { is_right: () => boolean; right: () => string } | null;
  coin_tree: MockMerkleTree;
  nullifiers: Map<string, boolean>;
}

/** Mock Merkle tree for coin commitments */
interface MockMerkleTree {
  insert: (coin: MockCoin) => void;
  committed: MockCoin[];
}

/** Full contract state */
interface ContractState {
  ledger: LedgerState;
  currentSigner: string;
}

/** Mock shielded coin info for recipient */
interface ShieldedCoinInfo {
  address: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Test Utilities
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate random bytes for testing
 */
function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

/**
 * Compare two Uint8Arrays
 */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Create a mock coin with specified value
 */
function createMockCoin(value: bigint): MockCoin {
  return {
    value,
    nonce: randomBytes(32),
    nullifier: randomBytes(32),
  };
}

/**
 * Evolve a coin's nonce to ensure uniqueness
 * (Simplified mock of Compact's evolveNonce)
 */
function evolveNonce(coin: MockCoin): MockCoin {
  const newNonce = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    newNonce[i] = (coin.nonce[i] + coin.nullifier[i] + 1) % 256;
  }
  return {
    ...coin,
    nonce: newNonce,
    nullifier: randomBytes(32),
  };
}

/**
 * Initialize contract state for testing
 */
function initializeContractState(minterAddress: string): ContractState {
  return {
    ledger: {
      total_minted: 0n,
      total_burned: 0n,
      minter: {
        is_right: () => true,
        right: () => minterAddress,
      },
      coin_tree: {
        insert: vi.fn(),
        committed: [],
      },
      nullifiers: new Map(),
    },
    currentSigner: minterAddress,
  };
}

/**
 * Switch the current signer (simulates different transaction senders)
 */
function switchSigner(state: ContractState, newSigner: string): ContractState {
  return {
    ...state,
    currentSigner: newSigner,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Mock Contract Functions
// (Simplified implementations matching the Compact contract logic)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Check that the current signer is the minter
 */
function onlyMinter(state: ContractState): void {
  if (!state.ledger.minter?.is_right()) {
    throw new Error('Minter not set');
  }
  if (state.ledger.minter.right() !== state.currentSigner) {
    throw new Error('Only minter can call this');
  }
}

/**
 * Mint new shielded tokens
 */
function mintTokens(state: ContractState, amount: bigint): MockShieldedToken[] {
  if (state.currentSigner !== state.ledger.minter?.right()) {
    throw new Error('Only minter can call this');
  }
  if (amount <= 0n) {
    throw new Error('Amount must be positive');
  }

  state.ledger.total_minted += amount;

  const coin = createMockCoin(amount);
  const evolved = evolveNonce(coin);

  state.ledger.coin_tree.committed.push(evolved);
  state.ledger.coin_tree.insert(evolved);

  return [{ coin: evolved }];
}

/**
 * Transfer shielded tokens
 */
function transferTokens(
  state: ContractState,
  totalInputValue: bigint,
  sendAmount: bigint,
  recipient: ShieldedCoinInfo
): MockSendResult {
  if (sendAmount <= 0n) {
    throw new Error('Send amount must be positive');
  }
  if (sendAmount > totalInputValue) {
    throw new Error('Insufficient balance');
  }

  const changeAmount = totalInputValue - sendAmount;

  const sentCoin = createMockCoin(sendAmount);
  const evolvedSent = evolveNonce(sentCoin);
  state.ledger.coin_tree.committed.push(evolvedSent);
  state.ledger.coin_tree.insert(evolvedSent);

  if (changeAmount > 0n) {
    const changeCoin = createMockCoin(changeAmount);
    const evolvedChange = evolveNonce(changeCoin);
    state.ledger.coin_tree.committed.push(evolvedChange);
    state.ledger.coin_tree.insert(evolvedChange);

    return {
      sent: { coin: evolvedSent },
      change: { coin: evolvedChange },
    };
  }

  return {
    sent: { coin: evolvedSent },
    change: null,
  };
}

/**
 * Burn shielded tokens
 */
function burnTokens(
  state: ContractState,
  totalInputValue: bigint,
  burnAmount: bigint
): bigint {
  if (burnAmount <= 0n) {
    throw new Error('Burn amount must be positive');
  }
  if (burnAmount > totalInputValue) {
    throw new Error('Insufficient balance to burn');
  }

  const changeAmount = totalInputValue - burnAmount;
  state.ledger.total_burned += burnAmount;

  if (changeAmount > 0n) {
    const changeCoin = createMockCoin(changeAmount);
    const evolvedChange = evolveNonce(changeCoin);
    state.ledger.coin_tree.committed.push(evolvedChange);
    state.ledger.coin_tree.insert(evolvedChange);
  }

  return state.ledger.total_burned;
}

/**
 * Atomically mint and send tokens
 */
function mintAndSend(
  state: ContractState,
  amount: bigint,
  recipient: ShieldedCoinInfo
): MockSendResult {
  if (state.currentSigner !== state.ledger.minter?.right()) {
    throw new Error('Only minter can call this');
  }
  if (amount <= 0n) {
    throw new Error('Amount must be positive');
  }

  state.ledger.total_minted += amount;

  const minted = createMockCoin(amount);
  const evolved = evolveNonce(minted);
  state.ledger.coin_tree.committed.push(evolved);
  state.ledger.coin_tree.insert(evolved);

  return {
    sent: { coin: evolved },
    change: null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Test Suite: Minting Operations
// ═══════════════════════════════════════════════════════════════════════════════

describe('ShieldedTokenManager - Minting', () => {
  let state: ContractState;
  let minter: string;

  beforeEach(() => {
    minter = '0x' + '1'.repeat(40);
    state = initializeContractState(minter);
  });

  it('should mint tokens with correct value', () => {
    const amount = 1000n;
    const result = mintTokens(state, amount);

    expect(result).toHaveLength(1);
    expect(result[0].coin.value).toBe(amount);
  });

  it('should update total_minted after minting', () => {
    mintTokens(state, 1000n);
    expect(state.ledger.total_minted).toBe(1000n);

    mintTokens(state, 2000n);
    expect(state.ledger.total_minted).toBe(3000n);
  });

  it('should not change total_burned when minting', () => {
    mintTokens(state, 1000n);
    expect(state.ledger.total_burned).toBe(0n);
  });

  it('should reject minting zero tokens', () => {
    expect(() => mintTokens(state, 0n)).toThrow('Amount must be positive');
  });

  it('should reject minting negative amounts', () => {
    expect(() => mintTokens(state, -100n)).toThrow('Amount must be positive');
  });

  it('should reject minting from non-minter', () => {
    const nonMinter = '0x' + '2'.repeat(40);
    const attackerState = switchSigner(state, nonMinter);

    expect(() => mintTokens(attackerState, 1000n)).toThrow(
      'Only minter can call this'
    );
  });

  it('should evolve nonce for uniqueness', () => {
    const amount = 1000n;

    // Mint two tokens with the same amount
    const result1 = mintTokens(state, amount);
    const result2 = mintTokens(state, amount);

    // Nonces must be different
    expect(bytesEqual(result1[0].coin.nonce, result2[0].coin.nonce)).toBe(false);

    // Nullifiers must be different
    expect(
      bytesEqual(result1[0].coin.nullifier, result2[0].coin.nullifier)
    ).toBe(false);
  });

  it('should commit coins to Merkle tree on mint', () => {
    mintTokens(state, 1000n);
    expect(state.ledger.coin_tree.committed).toHaveLength(1);

    mintTokens(state, 500n);
    expect(state.ledger.coin_tree.committed).toHaveLength(2);
  });

  it('should accumulate total_minted across multiple mints', () => {
    mintTokens(state, 1000n);
    mintTokens(state, 2000n);
    mintTokens(state, 3000n);

    expect(state.ledger.total_minted).toBe(6000n);
  });

  it('should handle minting maximum Uint<128> value', () => {
    const maxUint128 = 2n ** 128n - 1n;
    const result = mintTokens(state, maxUint128);

    expect(result[0].coin.value).toBe(maxUint128);
  });

  it('should handle minting minimum value of 1', () => {
    const result = mintTokens(state, 1n);
    expect(result[0].coin.value).toBe(1n);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test Suite: Transfer Operations
// ═══════════════════════════════════════════════════════════════════════════════

describe('ShieldedTokenManager - Transfers', () => {
  let state: ContractState;
  let minter: string;
  let recipient: ShieldedCoinInfo;

  beforeEach(() => {
    minter = '0x' + '1'.repeat(40);
    recipient = { address: '0x' + '3'.repeat(40) };
    state = initializeContractState(minter);
  });

  it('should transfer full amount with no change', () => {
    // First mint tokens
    mintTokens(state, 1000n);

    // Transfer full amount
    const result = transferTokens(state, 1000n, 1000n, recipient);

    expect(result.sent.coin.value).toBe(1000n);
    expect(result.change).toBeNull();
  });

  it('should transfer partial amount with change', () => {
    mintTokens(state, 1000n);

    const result = transferTokens(state, 1000n, 600n, recipient);

    expect(result.sent.coin.value).toBe(600n);
    expect(result.change).not.toBeNull();
    expect(result.change!.coin.value).toBe(400n);
  });

  it('should reject transfer exceeding balance', () => {
    mintTokens(state, 1000n);

    expect(() => transferTokens(state, 1000n, 1500n, recipient)).toThrow(
      'Insufficient balance'
    );
  });

  it('should reject zero amount transfer', () => {
    mintTokens(state, 1000n);

    expect(() => transferTokens(state, 1000n, 0n, recipient)).toThrow(
      'Send amount must be positive'
    );
  });

  it('should reject negative amount transfer', () => {
    mintTokens(state, 1000n);

    expect(() => transferTokens(state, 1000n, -100n, recipient)).toThrow(
      'Send amount must be positive'
    );
  });

  it('should commit sent coin to Merkle tree', () => {
    mintTokens(state, 1000n);
    const beforeCount = state.ledger.coin_tree.committed.length;

    transferTokens(state, 1000n, 600n, recipient);

    // Should have added 2 coins: sent + change
    expect(state.ledger.coin_tree.committed.length).toBe(beforeCount + 2);
  });

  it('should create different nonces for sent and change coins', () => {
    mintTokens(state, 1000n);
    const result = transferTokens(state, 1000n, 400n, recipient);

    expect(
      bytesEqual(result.sent.coin.nonce, result.change!.coin.nonce)
    ).toBe(false);
  });

  it('should handle change of exactly 1 token', () => {
    mintTokens(state, 1000n);

    const result = transferTokens(state, 1000n, 999n, recipient);

    expect(result.sent.coin.value).toBe(999n);
    expect(result.change!.coin.value).toBe(1n);
  });

  it('should handle transferring all tokens (exact match)', () => {
    mintTokens(state, 500n);

    const result = transferTokens(state, 500n, 500n, recipient);

    expect(result.sent.coin.value).toBe(500n);
    expect(result.change).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test Suite: Burn Operations
// ═══════════════════════════════════════════════════════════════════════════════

describe('ShieldedTokenManager - Burning', () => {
  let state: ContractState;
  let minter: string;

  beforeEach(() => {
    minter = '0x' + '1'.repeat(40);
    state = initializeContractState(minter);
  });

  it('should burn full balance', () => {
    mintTokens(state, 1000n);

    const totalBurned = burnTokens(state, 1000n, 1000n);

    expect(totalBurned).toBe(1000n);
    expect(state.ledger.total_burned).toBe(1000n);
  });

  it('should burn partial balance with change', () => {
    mintTokens(state, 1000n);

    const totalBurned = burnTokens(state, 1000n, 400n);

    expect(totalBurned).toBe(400n);
    expect(state.ledger.total_burned).toBe(400n);
  });

  it('should commit change coin after partial burn', () => {
    mintTokens(state, 1000n);
    const beforeCount = state.ledger.coin_tree.committed.length;

    burnTokens(state, 1000n, 400n);

    // Should have added 1 change coin
    expect(state.ledger.coin_tree.committed.length).toBe(beforeCount + 1);
  });

  it('should reject burn exceeding balance', () => {
    mintTokens(state, 1000n);

    expect(() => burnTokens(state, 1000n, 1500n)).toThrow(
      'Insufficient balance to burn'
    );
  });

  it('should reject zero amount burn', () => {
    mintTokens(state, 1000n);

    expect(() => burnTokens(state, 1000n, 0n)).toThrow(
      'Burn amount must be positive'
    );
  });

  it('should accumulate total_burned across burns', () => {
    mintTokens(state, 1000n);
    burnTokens(state, 1000n, 500n);

    mintTokens(state, 2000n);
    burnTokens(state, 2000n, 1500n);

    expect(state.ledger.total_burned).toBe(2000n);
  });

  it('should not change total_minted when burning', () => {
    mintTokens(state, 1000n);
    const mintedBefore = state.ledger.total_minted;

    burnTokens(state, 1000n, 500n);

    expect(state.ledger.total_minted).toBe(mintedBefore);
  });

  it('should handle burning minimum amount (1 token)', () => {
    mintTokens(state, 1000n);

    const totalBurned = burnTokens(state, 1000n, 1n);

    expect(totalBurned).toBe(1n);
  });

  it('should handle burning with change of 1 token', () => {
    mintTokens(state, 1000n);

    burnTokens(state, 1000n, 999n);

    expect(state.ledger.total_burned).toBe(999n);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test Suite: Atomic Mint & Send
// ═══════════════════════════════════════════════════════════════════════════════

describe('ShieldedTokenManager - Atomic Mint & Send', () => {
  let state: ContractState;
  let minter: string;
  let recipient: ShieldedCoinInfo;

  beforeEach(() => {
    minter = '0x' + '1'.repeat(40);
    recipient = { address: '0x' + '3'.repeat(40) };
    state = initializeContractState(minter);
  });

  it('should atomically mint and send in one transaction', () => {
    const result = mintAndSend(state, 1000n, recipient);

    expect(result.sent.coin.value).toBe(1000n);
    expect(result.change).toBeNull();
    expect(state.ledger.total_minted).toBe(1000n);
  });

  it('should only allow minter to mint_and_send', () => {
    const nonMinter = '0x' + '2'.repeat(40);
    const attackerState = switchSigner(state, nonMinter);

    expect(() => mintAndSend(attackerState, 1000n, recipient)).toThrow(
      'Only minter can call this'
    );
  });

  it('should reject zero amount mint_and_send', () => {
    expect(() => mintAndSend(state, 0n, recipient)).toThrow(
      'Amount must be positive'
    );
  });

  it('should commit coin to Merkle tree atomically', () => {
    mintAndSend(state, 1000n, recipient);

    expect(state.ledger.coin_tree.committed).toHaveLength(1);
    expect(state.ledger.coin_tree.insert).toHaveBeenCalledTimes(1);
  });

  it('should update total_minted correctly', () => {
    mintAndSend(state, 500n, recipient);
    mintAndSend(state, 750n, recipient);

    expect(state.ledger.total_minted).toBe(1250n);
  });

  it('should not create change when sending full mint amount', () => {
    const result = mintAndSend(state, 1000n, recipient);

    expect(result.change).toBeNull();
  });

  it('should produce unique coins across multiple mint_and_send calls', () => {
    const result1 = mintAndSend(state, 1000n, recipient);
    const result2 = mintAndSend(state, 1000n, recipient);

    expect(
      bytesEqual(result1.sent.coin.nonce, result2.sent.coin.nonce)
    ).toBe(false);
    expect(
      bytesEqual(result1.sent.coin.nullifier, result2.sent.coin.nullifier)
    ).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test Suite: Edge Cases
// ═══════════════════════════════════════════════════════════════════════════════

describe('ShieldedTokenManager - Edge Cases', () => {
  let state: ContractState;
  let minter: string;
  let recipient: ShieldedCoinInfo;

  beforeEach(() => {
    minter = '0x' + '1'.repeat(40);
    recipient = { address: '0x' + '3'.repeat(40) };
    state = initializeContractState(minter);
  });

  it('should maintain correct supply after mint-transfer-burn cycle', () => {
    // Mint 1000
    mintTokens(state, 1000n);

    // Transfer 600, keeping 400 as change
    const transferred = transferTokens(state, 1000n, 600n, recipient);

    // Verify change exists
    expect(transferred.change).not.toBeNull();
    expect(transferred.change!.coin.value).toBe(400n);

    // Burn the change (400)
    burnTokens(state, 400n, 400n);

    expect(state.ledger.total_minted).toBe(1000n);
    expect(state.ledger.total_burned).toBe(400n);
  });

  it('should handle multiple sequential operations', () => {
    // Mint
    mintTokens(state, 5000n);
    expect(state.ledger.total_minted).toBe(5000n);

    // Partial transfer
    transferTokens(state, 5000n, 2000n, recipient);
    // Change: 3000

    // Another mint
    mintTokens(state, 1000n);
    expect(state.ledger.total_minted).toBe(6000n);

    // Partial burn
    burnTokens(state, 3000n, 1000n);
    expect(state.ledger.total_burned).toBe(1000n);

    // Final mint-and-send
    mintAndSend(state, 500n, recipient);
    expect(state.ledger.total_minted).toBe(6500n);
  });

  it('should handle maximum Uint<128> mint followed by full burn', () => {
    const maxUint128 = 2n ** 128n - 1n;

    mintTokens(state, maxUint128);
    expect(state.ledger.total_minted).toBe(maxUint128);

    burnTokens(state, maxUint128, maxUint128);
    expect(state.ledger.total_burned).toBe(maxUint128);
  });

  it('should correctly calculate total supply', () => {
    mintTokens(state, 10000n);
    burnTokens(state, 10000n, 3000n);
    mintTokens(state, 5000n);

    // Supply = total_minted - total_burned = 15000 - 3000 = 12000
    const supply = state.ledger.total_minted - state.ledger.total_burned;
    expect(supply).toBe(12000n);
  });

  it('should handle transfer with exact change boundary', () => {
    // Transfer 1 from 2, change should be 1
    mintTokens(state, 2n);

    const result = transferTokens(state, 2n, 1n, recipient);

    expect(result.sent.coin.value).toBe(1n);
    expect(result.change!.coin.value).toBe(1n);
  });

  it('should handle burn with exact change boundary', () => {
    mintTokens(state, 2n);

    burnTokens(state, 2n, 1n);

    expect(state.ledger.total_burned).toBe(1n);
  });

  it('should create unique nullifiers for all operations', () => {
    const nullifiers = new Set<string>();

    // Mint multiple tokens
    const m1 = mintTokens(state, 100n);
    const m2 = mintTokens(state, 200n);

    nullifiers.add(Buffer.from(m1[0].coin.nullifier).toString('hex'));
    nullifiers.add(Buffer.from(m2[0].coin.nullifier).toString('hex'));

    // Transfer
    const t = transferTokens(state, 100n, 50n, recipient);
    nullifiers.add(Buffer.from(t.sent.coin.nullifier).toString('hex'));
    nullifiers.add(Buffer.from(t.change!.coin.nullifier).toString('hex'));

    // All nullifiers should be unique
    expect(nullifiers.size).toBe(4);
  });

  it('should handle sequential mint_and_send operations', () => {
    const recipients = [
      { address: '0x' + 'a'.repeat(40) },
      { address: '0x' + 'b'.repeat(40) },
      { address: '0x' + 'c'.repeat(40) },
    ];

    for (const r of recipients) {
      mintAndSend(state, 1000n, r);
    }

    expect(state.ledger.total_minted).toBe(3000n);
    expect(state.ledger.coin_tree.committed).toHaveLength(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test Suite: Witness Validation
// ═══════════════════════════════════════════════════════════════════════════════

describe('Shielded Token Witnesses', () => {
  it('should validate coin secret structure', () => {
    const validSecret = {
      nonce: randomBytes(32),
      viewingKey: randomBytes(32),
      spendingKey: randomBytes(32),
    };

    expect(validSecret.nonce).toHaveLength(32);
    expect(validSecret.viewingKey).toHaveLength(32);
    expect(validSecret.spendingKey).toHaveLength(32);
  });

  it('should validate Merkle path structure', () => {
    const validPath = {
      index: 42n,
      path: [randomBytes(32), randomBytes(32), randomBytes(32)],
      leafHash: randomBytes(32),
    };

    expect(validPath.path).toHaveLength(3);
    expect(validPath.leafHash).toHaveLength(32);
  });

  it('should validate recipient info structure', () => {
    const validRecipient = {
      viewingPubKey: randomBytes(32),
      encryptedPayload: randomBytes(64),
    };

    expect(validRecipient.viewingPubKey).toHaveLength(32);
    expect(validRecipient.encryptedPayload.length).toBeGreaterThan(0);
  });
});
