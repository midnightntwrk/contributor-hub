import { SecretKey, PublicKey, encrypt, decrypt, PersistentSet, persistentHash, findSecretKey, ZkProgram, Field, SelfProof, Struct, Bool, isReady, Ledger, CircuitContext } from '@midnight-ntwrk/compact-runtime';
import { BBoardContract } from '../contract/index';

export function createBBoardPrivateState(secretKey: SecretKey, publicKey: PublicKey, boardName: string): BBoardPrivateState {
  return {
    secretKey,
    publicKey,
    boardName,
    ownerCommitment: persistentHash([secretKey, boardName]),
    messages: new PersistentSet<string>(),
  };
}

export function verifyOwner(state: BBoardPrivateState): Bool {
  return persistentHash([state.secretKey, state.boardName]).equals(state.ownerCommitment);
}

export async function postMessage(state: BBoardPrivateState, message: string, ledger: Ledger): Promise<BBoardPrivateState> {
  // Ensure caller is owner via persistentHash verification
  if (!verifyOwner(state)) {
    throw new Error('Only owner can post messages');
  }
  // ... rest of logic unchanged
}

export async function readMessages(state: BBoardPrivateState, ledger: Ledger): Promise<string[]> {
  // No ownership check for reading
  return state.messages.values();
}