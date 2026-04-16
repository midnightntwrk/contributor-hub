export enum VotingPhase {
  INIT = 0,
  COMMIT = 1,
  REVEAL = 2,
  ENDED = 3,
}

export enum VoteOption {
  ABSTAIN = 0,
  YES = 1,
  NO = 2,
}

export type MerkleTreePath<T> = {
  value: T;
  siblings: T[];
};

export type Deployment<T> = {
  ledger: T;
  privateState?: Record<string, unknown>;
};

export type VotingContract = {
  organizer: Uint8Array;
  proposalTitle: Uint8Array;
  proposalDescription: Uint8Array;
  phase: VotingPhase;
  phaseDeadline: bigint;
  eligibleVoters: Uint8Array;
  voterCommitments: Map<string, string>;
  voterNullifiers: Set<string>;
  yesVotes: bigint;
  noVotes: bigint;
  abstainVotes: bigint;
  totalCommitted: bigint;
  totalRevealed: bigint;
};

export type VotingConfig = {
  title: string;
  description: string;
  commitDuration: bigint;
  revealDuration: bigint;
  secretKey: Uint8Array;
};

function derivePublicKey(sk: Uint8Array): Uint8Array {
  let hash = 0n;
  for (let i = 0; i < sk.length; i++) {
    hash = hash * 137n + BigInt(sk[i]);
    hash = hash % (1n << 248n);
  }
  const result = new Uint8Array(32);
  const hashBytes = hash.toString(16).padStart(64, "0");
  const bytes = new Uint8Array(
    [...hashBytes.matchAll(/../g)].map((x) => parseInt(x[0], 16))
  );
  result.set(bytes.slice(0, 32));
  return result;
}

export function createVotingContract(config: VotingConfig): Deployment<VotingContract> {
  const organizer = derivePublicKey(config.secretKey);
  
  const titleBytes = new TextEncoder().encode(config.title).slice(0, 64);
  const paddedTitle = new Uint8Array(64);
  paddedTitle.set(titleBytes);
  
  const descBytes = new TextEncoder().encode(config.description).slice(0, 256);
  const paddedDesc = new Uint8Array(256);
  paddedDesc.set(descBytes);

  return {
    ledger: {
      organizer,
      proposalTitle: paddedTitle,
      proposalDescription: paddedDesc,
      phase: VotingPhase.INIT,
      phaseDeadline: config.commitDuration + config.revealDuration,
      eligibleVoters: new Uint8Array(32),
      voterCommitments: new Map(),
      voterNullifiers: new Set(),
      yesVotes: 0n,
      noVotes: 0n,
      abstainVotes: 0n,
      totalCommitted: 0n,
      totalRevealed: 0n,
    },
  };
}

export function findVoterPath(
  voterPk: Uint8Array,
  _merkleTreeRoot: Uint8Array
): MerkleTreePath<Uint8Array> {
  return {
    value: voterPk,
    siblings: Array(20).fill(new Uint8Array(32)),
  };
}

export function localSecret(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

export function localVote(): VoteOption {
  return VoteOption.YES;
}

export function localSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

export function computeCommitment(
  vote: VoteOption,
  secretKey: Uint8Array,
  salt: Uint8Array
): Uint8Array {
  const encoder = new TextEncoder();
  const domain = encoder.encode("midnight:voting:commitment").slice(0, 32);
  
  const data = new Uint8Array(32 + 1 + 32);
  data.set(domain, 0);
  data.set(new Uint8Array([vote]), 32);
  data.set(secretKey, 33);

  return persistentCommit(data, salt);
}

export function computeNullifier(secretKey: Uint8Array): Uint8Array {
  const encoder = new TextEncoder();
  const domain = encoder.encode("midnight:voting:nullifier").slice(0, 32);
  const salt = encoder.encode("nullifier-salt").slice(0, 32);
  
  const data = new Uint8Array(32 + 32);
  data.set(domain, 0);
  data.set(secretKey, 32);

  return persistentCommit(data, salt);
}

function persistentCommit(data: Uint8Array, salt: Uint8Array): Uint8Array {
  const combined = new Uint8Array(data.length + salt.length);
  combined.set(data);
  combined.set(salt, data.length);
  
  let hash = 0n;
  for (let i = 0; i < combined.length; i++) {
    hash = hash * 137n + BigInt(combined[i]);
    hash = hash % (1n << 248n);
  }
  
  const result = new Uint8Array(32);
  const hashBytes = hash.toString(16).padStart(64, "0");
  const bytes = new Uint8Array(
    [...hashBytes.matchAll(/../g)].map((x) => parseInt(x[0], 16))
  );
  result.set(bytes.slice(0, 32));
  return result;
}

export function assertPhase(voting: VotingContract, expected: VotingPhase): void {
  if (voting.phase !== expected) {
    throw new Error(
      `Expected phase ${VotingPhase[expected]}, got ${VotingPhase[voting.phase]}`
    );
  }
}

export function assertOrganizer(voting: VotingContract, caller: Uint8Array): void {
  if (!bytesEqual(voting.organizer, caller)) {
    throw new Error("Not authorized: caller is not organizer");
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}