import { Contract, State, Field, CircuitContext, SecretKey, PublicKey, persistentHash } from '@midnight-ntwrk/compact-runtime';
import { BBoardCircuit } from '../predicates/bboard-predicate';
import { BBoardPrivateState } from '../predicates/bboard-lib';

@Contract
export class BBoardContract extends Contract {
  @State boardName: Field;
  @State ownerCommitment: Field;

  constructor(secretKey: SecretKey, boardName: string) {
    super();
    this.boardName = Field.fromString(boardName);
    this.ownerCommitment = persistentHash([secretKey, this.boardName]);
  }

  @State
  async getOwner(): Promise<Field> {
    // Use persistentHash commitment instead of ownPublicKey
    return this.ownerCommitment;
  }

  @Circuit
  async postMessage(message: string) {
    const circuit = new BBoardCircuit();
    const ctx = new CircuitContext();
    ctx.secretKey = this.secretKey; // injected via contract runtime
    ctx.message = Field.fromString(message);
    const newState = await circuit.methods.postMessage(this.state, ctx);
    this.state = newState;
  }
}