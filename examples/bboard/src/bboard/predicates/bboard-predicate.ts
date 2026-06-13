import { ZkProgram, Field, SelfProof, Bool, CircuitContext, PersistentSet, persistentHash } from '@midnight-ntwrk/compact-runtime';
import { BBoardPrivateState } from './bboard-lib';

// The circuit now uses witness-based secret key
const BBoardCircuit = ZkProgram({
  name: 'bboard-circuit',
  publicFields: {
    boardName: Field,
    ownerCommitment: Field,
  },
  privateFields: {
    secretKey: Field,
    message: Field,
  },
  methods: {
    postMessage: {
      privateInputs: ['secretKey', 'message'],
      async method(state: BBoardPrivateState, ctx: CircuitContext) {
        const { boardName, ownerCommitment, secretKey, message } = ctx;
        // Verify ownership using persistentHash
        const computedCommitment = persistentHash([secretKey, boardName]);
        computedCommitment.assertEquals(ownerCommitment);
        
        // Update state with new message
        state.messages.add(message);
        return state;
      },
    },
  },
});

export { BBoardCircuit };