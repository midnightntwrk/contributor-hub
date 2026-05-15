// This file is part of contributor-hub.
// Copyright (C) 2025 Midnight Foundation
// SPDX-License-Identifier: Apache-2.0

// Basic Witness Provider — TypeScript Implementation
// Implements witness providers for basic-witnesses.compact

import { WitnessProviders, Field } from "@midnight-ntwrk/compact-runtime";

// --- Simulated Off-Chain Database ---

interface UserRecord {
  balance: bigint;
  nonce: bigint;
  tier: number;
}

const balanceDatabase: Map<string, bigint> = new Map([
  ["alice", 1000n],
  ["bob", 500n],
  ["charlie", 2500n],
]);

const recordDatabase: Map<string, UserRecord> = new Map([
  ["alice", { balance: 1000n, nonce: 5n, tier: 2 }],
  ["bob", { balance: 500n, nonce: 3n, tier: 1 }],
  ["charlie", { balance: 2500n, nonce: 12n, tier: 3 }],
]);

// --- Helper ---

function addressToString(addr: Uint8Array): string {
  return Buffer.from(addr).toString("hex").slice(0, 16);
}

// --- Witness Providers ---

export const basicWitnessProviders: WitnessProviders = {

  /**
   * Primitive Witness: get_balance(owner: Address): Field
   * Returns the balance of the given address as a Field element.
   */
  get_balance: (owner: Uint8Array): bigint => {
    const key = addressToString(owner);
    const balance = balanceDatabase.get(key);
    if (balance === undefined) {
      console.warn(`[get_balance] No balance for ${key}, returning 0`);
      return 0n;
    }
    console.log(`[get_balance] ${key} => ${balance}`);
    return balance;
  },

  /**
   * Composite Witness: get_user_record(addr: Address): UserRecord
   * Returns a full user record (balance, nonce, tier) as a struct.
   */
  get_user_record: (addr: Uint8Array): UserRecord => {
    const key = addressToString(addr);
    const record = recordDatabase.get(key);
    if (!record) {
      console.warn(`[get_user_record] No record for ${key}, returning defaults`);
      return { balance: 0n, nonce: 0n, tier: 0 };
    }
    console.log(`[get_user_record] ${key} =>`, record);
    return record;
  },

  /**
   * Argument-Free Witness: current_timestamp(): Uint<64>
   * Returns the current timestamp. No arguments — value is context-dependent.
   * NOTE: Prefer on-chain block timestamps in production for determinism.
   */
  current_timestamp: (): bigint => {
    const timestamp = BigInt(Math.floor(Date.now() / 1000));
    console.log(`[current_timestamp] => ${timestamp}`);
    return timestamp;
  },
};

// --- Demo Runner ---

async function demo() {
  console.log("=== Basic Witness Provider Demo ===\n");

  const aliceAddr = new Uint8Array(Buffer.from("alice", "utf-8"));
  const bobAddr = new Uint8Array(Buffer.from("bob", "utf-8"));

  console.log("--- Primitive Witness: get_balance ---");
  const aliceBalance = basicWitnessProviders.get_balance(aliceAddr);
  const bobBalance = basicWitnessProviders.get_balance(bobAddr);
  console.log(`Alice balance: ${aliceBalance}, Bob balance: ${bobBalance}\n`);

  console.log("--- Composite Witness: get_user_record ---");
  const aliceRecord = basicWitnessProviders.get_user_record(aliceAddr);
  console.log(`Alice record:`, aliceRecord, "\n");

  console.log("--- Argument-Free Witness: current_timestamp ---");
  const now = basicWitnessProviders.current_timestamp();
  console.log(`Current timestamp: ${now}\n`);

  console.log("=== Demo Complete ===");
}

if (require.main === module) {
  demo().catch(console.error);
}

export default basicWitnessProviders;
