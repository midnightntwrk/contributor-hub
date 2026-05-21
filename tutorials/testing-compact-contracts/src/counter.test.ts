import { describe, it, expect, beforeAll } from 'vitest';
import { Contract } from '@midnight-ntwrk/compact-runtime';
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';

// ── Counter contract types ──────────────────────────────────────────────

interface CounterLedger {
  count: bigint;
  lastIncrementor: Uint8Array;
}

interface CounterPrivateState {
  secretKey: Uint8Array;
}

// ── Witness implementations ─────────────────────────────────────────────

const secretKey = ({ privateState }: WitnessContext<CounterLedger, CounterPrivateState>) => {
  return [privateState, privateState.secretKey];
};

const witnesses = { secretKey };

// ── Test Suite ──────────────────────────────────────────────────────────

describe('Counter Contract', () => {
  let contract: Contract<CounterLedger, CounterPrivateState>;

  beforeAll(async () => {
    // Import compiled contract
    const { compact } = await import('./contracts/counter.compact');
    contract = new Contract(compact, witnesses);
  });

  describe('constructor', () => {
    it('initializes count to 0', async () => {
      const ledger = await contract.deploy({ secretKey: new Uint8Array(32) });
      expect(ledger.count).toBe(0n);
    });

    it('initializes lastIncrementor to empty', async () => {
      const ledger = await contract.deploy({ secretKey: new Uint8Array(32) });
      const empty = new Uint8Array(32);
      expect(ledger.lastIncrementor).toEqual(empty);
    });
  });

  describe('increment', () => {
    it('increments count by the given amount', async () => {
      const privateState = { secretKey: new Uint8Array(32).fill(1) };
      const ledger = await contract.deploy(privateState);

      const result = await contract.call('increment', privateState, [5n]);
      expect(result.ledger.count).toBe(5n);
    });

    it('throws when increment is zero', async () => {
      const privateState = { secretKey: new Uint8Array(32).fill(2) };
      const ledger = await contract.deploy(privateState);

      await expect(
        contract.call('increment', privateState, [0n])
      ).rejects.toThrow('Increment must be positive');
    });

    it('rejects increment with negative values', async () => {
      const privateState = { secretKey: new Uint8Array(32).fill(3) };
      const ledger = await contract.deploy(privateState);

      // Compact Uint<64> doesn't accept negative values;
      // the type system rejects this at the circuit boundary
      await expect(
        contract.call('increment', privateState, [-1n])
      ).rejects.toThrow();
    });

    it('accumulates multiple increments', async () => {
      const privateState = { secretKey: new Uint8Array(32).fill(4) };
      const ledger = await contract.deploy(privateState);

      let state = await contract.call('increment', privateState, [3n]);
      expect(state.ledger.count).toBe(3n);

      state = await contract.call('increment', privateState, [7n]);
      expect(state.ledger.count).toBe(10n);

      state = await contract.call('increment', privateState, [0n]);
      expect(state.ledger.count).toBe(10n); // unchanged
    });
  });

  describe('reset', () => {
    it('resets count to 0', async () => {
      const privateState = { secretKey: new Uint8Array(32).fill(5) };
      const ledger = await contract.deploy(privateState);

      await contract.call('increment', privateState, [42n]);
      const result = await contract.call('reset', privateState, []);
      expect(result.ledger.count).toBe(0n);
    });
  });

  describe('readCount', () => {
    it('returns the current count', async () => {
      const privateState = { secretKey: new Uint8Array(32).fill(6) };
      const ledger = await contract.deploy(privateState);

      await contract.call('increment', privateState, [99n]);
      const count = await contract.query('readCount', privateState, []);
      expect(count).toBe(99n);
    });
  });
});
