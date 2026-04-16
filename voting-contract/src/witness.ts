export type MerkleTreePath<T> = {
  value: T;
  siblings: T[];
};

export type VoterPathWitness = {
  findVoterPath: (voterPk: Uint8Array) => MerkleTreePath<Uint8Array>;
};

export type LocalStateWitness = {
  localSecret: () => Uint8Array;
  localVote: () => bigint;
  localSalt: () => Uint8Array;
};

export interface VotingWitnesses extends VoterPathWitness, LocalStateWitness {}

export function findVoterPath(
  _context: { ledger: { eligibleVoters: Uint8Array } },
  voterPk: Uint8Array
): MerkleTreePath<Uint8Array> {
  return {
    value: voterPk,
    siblings: Array(20).fill(new Uint8Array(32)),
  };
}

export function localSecret(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

export function localVote(): bigint {
  return 1n;
}

export function localSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}