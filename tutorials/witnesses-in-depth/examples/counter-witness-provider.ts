// This file is part of contributor-hub.
// Copyright (C) 2025 Midnight Foundation
// SPDX-License-Identifier: Apache-2.0

// Counter / Stateful Witness Provider — TypeScript Implementation
// Demonstrates closures that maintain mutable state across proof generations.

import { WitnessProviders, Field } from "@midnight-ntwrk/compact-runtime";

// --- Types ---

interface ActionRecord {
  action_id: bigint;
  actor_hash: bigint;
  timestamp: bigint;
  nonce: bigint;
}

// --- Stateful Provider Factory ---

interface StatefulWitnessState {
  nonceCounter: bigint;
  actionIdCounter: bigint;
  lastTimestamp: bigint;
  actionLog: ActionRecord[];
}

function createStatefulProviders(initialState?: Partial<StatefulWitnessState>) {
  const state: StatefulWitnessState = {
    nonceCounter: initialState?.nonceCounter ?? 0n,
    actionIdCounter: initialState?.actionIdCounter ?? 0n,
    lastTimestamp: initialState?.lastTimestamp ?? BigInt(Math.floor(Date.now() / 1000)),
    actionLog: initialState?.actionLog ?? [],
  };

  const providers: WitnessProviders = {

    /** Stateful: returns monotonically increasing nonce. */
    next_nonce: (): bigint => {
      state.nonceCounter += 1n;
      console.log(`[next_nonce] => ${state.nonceCounter}`);
      return state.nonceCounter;
    },

    /** Stateful: returns unique action ID. */
    next_action_id: (): bigint => {
      state.actionIdCounter += 1n;
      console.log(`[next_action_id] => ${state.actionIdCounter}`);
      return state.actionIdCounter;
    },

    /** Stateful + Composite: builds a complete ActionRecord. */
    build_action_record: (actor_hash: bigint): ActionRecord => {
      state.nonceCounter += 1n;
      state.actionIdCounter += 1n;
      state.lastTimestamp += 1n;

      const record: ActionRecord = {
        action_id: state.actionIdCounter,
        actor_hash: actor_hash,
        timestamp: state.lastTimestamp,
        nonce: state.nonceCounter,
      };

      state.actionLog.push(record);
      console.log(`[build_action_record] =>`, {
        id: record.action_id.toString(),
        actor: "0x" + record.actor_hash.toString(16),
        ts: record.timestamp.toString(),
        nonce: record.nonce.toString(),
      });

      return record;
    },
  };

  return { providers, getState: () => ({ ...state }) };
}

// --- Demo ---

function demo() {
  console.log("=== Stateful Witness Provider Demo ===\n");

  const { providers, getState } = createStatefulProviders({
    nonceCounter: 100n,
  });

  console.log("Initial state: nonce=" + getState().nonceCounter + "\n");

  console.log("--- Calling next_nonce() three times ---");
  const n1 = providers.next_nonce();
  const n2 = providers.next_nonce();
  const n3 = providers.next_nonce();
  console.log("Nonces: " + n1 + ", " + n2 + ", " + n3);
  console.log("State after: nonce=" + getState().nonceCounter + "\n");

  console.log("--- Building action records ---");
  const actorA = 0xdeadbeefn;
  const actorB = 0xcafebaben;

  providers.build_action_record(actorA);
  providers.build_action_record(actorB);
  providers.build_action_record(actorA);

  console.log("\n--- Action Log ---");
  const log = getState().actionLog;
  log.forEach((r, i) => {
    console.log("  [" + i + "] id=" + r.action_id + " nonce=" + r.nonce +
      " actor=0x" + r.actor_hash.toString(16) + " ts=" + r.timestamp);
  });

  console.log("\n--- Monotonicity Check ---");
  const noncesIncreasing = log.every((r, i) => i === 0 || r.nonce > log[i - 1].nonce);
  const timestampsIncreasing = log.every((r, i) => i === 0 || r.timestamp > log[i - 1].timestamp);
  console.log("  Nonces strictly increasing: " + noncesIncreasing);
  console.log("  Timestamps strictly increasing: " + timestampsIncreasing);

  console.log("\n--- Independent Provider Instances ---");
  const { providers: freshProviders } = createStatefulProviders();
  const freshNonce = freshProviders.next_nonce();
  console.log("  Fresh provider first nonce: " + freshNonce);
  console.log("  Original provider last nonce: " + getState().nonceCounter);
  console.log("  (Each instance has independent state)\n");

  console.log("=== Demo Complete ===");
}

if (require.main === module) {
  demo();
}

export { createStatefulProviders };
export default createStatefulProviders;
