// TypeScript witness implementations for secure-patterns.compact
// Bounty #320 — midnightntwrk/contributor-hub

import { WitnessContext } from '@midnight-ntwrk/compact-runtime';

// Types matching our Compact contract
interface Ledger {
    authority: Uint8Array;
    usedNullifiers: Set<Uint8Array>;
    balanceCommitment: Uint8Array;
    nonce: bigint;
    contractVersion: number;
}

interface PrivateState {
    secretKey: Uint8Array;
    balance: bigint;
    commitmentRand: Uint8Array;
}

export const witnesses = {
    secretKey: ({ privateState }: WitnessContext<Ledger, PrivateState>) => {
        return [privateState, privateState.secretKey];
    },

    getBalance: ({ privateState }: WitnessContext<Ledger, PrivateState>) => {
        return [privateState, privateState.balance];
    },

    getCommitmentRand: ({ privateState }: WitnessContext<Ledger, PrivateState>) => {
        return [privateState, privateState.commitmentRand];
    },
};
