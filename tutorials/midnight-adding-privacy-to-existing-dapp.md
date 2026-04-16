# Tutorial: Adding Privacy to an Existing dApp: A Retrofit Guide

**Bounty Issue**: #307

## Introduction

You've built a successful dApp on Ethereum or another EVM chain. Now you want to add privacy features using Midnight's Compact. This tutorial walks through the complete retrofit process: from audit of your existing contract's state to determine what should be private, through the implementation of commitment schemes, to deployment with a proof server integration.

## When to Consider Adding Privacy

**Good candidates for privacy retrofit:**
- DeFi applications where trade sizes leak alpha
- Identity/KYC applications with personal data
- Supply chain applications with proprietary business data
- Voting/governance where ballot secrecy matters
- Financial applications where salary or wealth should be private

**Poor candidates:**
- AMM pools where transparency is essential for price discovery
- Stablecoin protocols where redeemability must be verifiable
- Bridge protocols where fraud detection requires transparency

## Step 1: Audit Your Existing State

Before writing any code, audit every state variable in your contract.

### State Audit Template

For each state variable, ask:

```
┌────────────────────────────────────────────────────────────┐
│ Variable: ________________________________________________ │
├────────────────────────────────────────────────────────────┤
│ Current visibility: PUBLIC / PRIVATE / INTERNAL          │
│                                                              │
│ Who needs to read this?                                     │
│ □ The contract itself (on-chain logic)                     │
│ □ The owner/user directly                                  │
│ □ Other contracts (cross-contract calls)                   │
│ □ The public (transparency for trust)                     │
│                                                              │
│ Who should NOT read this?                                  │
│ □ Competitors (business-sensitive data)                     │
│ □ The public (user privacy)                               │
│ □ MEV bots (front-running prevention)                      │
│                                                              │
│ Decision: KEEP PUBLIC / MAKE PRIVATE / PARTIALLY PRIVATE   │
└────────────────────────────────────────────────────────────┘
```

### Example: Decentralized Todo App

```solidity
// Original Solidity contract (simplified)
contract TodoApp {
    struct Task {
        address owner;
        string description;
        bool completed;
        uint256 deadline;
        uint256 reward;
    }

    mapping(uint256 => Task) public tasks;
    mapping(address => uint256[]) public userTasks;
    uint256 public taskCount;
}
```

**State Audit Results:**

| Variable | Keep Public? | Reason |
|----------|-------------|--------|
| `taskCount` | ✅ Yes | Global statistics, no privacy concern |
| `tasks[id].completed` | ⚠️ Maybe | Competitors shouldn't see your task status |
| `tasks[id].description` | ❌ No | Private work content |
| `tasks[id].reward` | ❌ No | Salary/compensation should be private |
| `tasks[id].deadline` | ⚠️ Maybe | Depends on project sensitivity |
| `userTasks[address]` | ❌ No | Reveals all your tasks and productivity |

## Step 2: Design the Private State Schema

Once you've audited your state, design the private state schema using commitment schemes.

### Commitment Scheme Design

```
Public State: Aggregates, IDs, counts, cryptographic commitments
Private State: Individual values, amounts, sensitive parameters
```

For our Todo App:

```compact
// Converted Compact contract
contract PrivateTodo {
  state {
    // PUBLIC: What needs to be globally visible
    field task_count: u64;
    field task_commitments: Set<Field>;  // Set of valid task commitments
    field nullifiers: Set<Field>;         // Set of completed task nullifiers

    // PRIVATE: Per-user data (stored off-chain, proven on-chain)
    // Task = Hash(owner, description, reward, deadline)
    // This never appears on-chain — only the commitment hash
  }

  // Mapping from public task ID to private commitment root
  field task_commitment_roots: Map<u64, Field>;
}
```

## Step 3: Replace Public State with Commitments

### Pattern 1: Simple Commitment

```compact
// Create a commitment from task data
transition create_task(description_hash: Field, reward: Field, deadline: u64) {
  let caller = ctx.sender();

  // Derive commitment from private inputs
  // commitment = Hash(owner, description_hash, reward, deadline)
  let commitment = poseidon_hash(
    caller,
    description_hash,
    reward,
    deadline
  );

  // Store commitment publicly (hides actual values)
  let task_id = self.task_count as Field;
  self.task_commitments.insert(commitment);
  self.task_commitment_roots[task_id] = commitment;
  self.task_count = self.task_count + 1;
}
```

### Pattern 2: Commitment with Sequential Nullifier

```compact
// For tasks that can be marked complete
transition complete_task(task_id: u64, nullifier: Field, proof: Proof) {
  let caller = ctx.sender();

  // Derive the commitment for this task
  let stored_commitment = self.task_commitment_roots[task_id];

  // Verify the proof WITHOUT revealing the task details
  // proof demonstrates: I know the preimage of stored_commitment
  // AND the preimage includes caller as owner
  let proof_valid = verify_proof(proof, stored_commitment, caller);
  constrain proof_valid == true;

  // Mark as completed via nullifier (no linkability)
  constrain !self.nullifiers.contains(nullifier);
  self.nullifiers.insert(nullifier);

  // Emit completion event (no task details revealed)
  emit TaskCompleted(task_id, nullifier, block_number());
}
```

## Step 4: Selective Disclosure for Compliance

In many applications, you need selective disclosure — prove something about private data without revealing the data itself.

### Pattern: Prove Balance Above Threshold

```compact
// Prove your balance is above a threshold without revealing the balance
transition prove_balance_above(
  commitment: Field,
  threshold: Field,
  proof: Proof
) -> bool {
  // Verify: I know preimage of `commitment`
  // AND preimage.amount > threshold
  // WITHOUT revealing preimage.amount or preimage.other_fields

  let proof_valid = verify_range_proof(proof, commitment, threshold);
  return proof_valid;
}
```

### Pattern: Prove Membership Without Revealing Identity

```compact
// Prove you're on a whitelist without revealing WHICH whitelist entry is yours
transition prove_whitelisted(
  nullifier: Field,
  merkle_root: Field,
  proof: Proof
) -> bool {
  // Verify: I know a leaf in the Merkle tree with root `merkle_root`
  // AND my nullifier is derived from that leaf
  // WITHOUT revealing WHICH leaf is mine (anonymity)

  let proof_valid = verify_merkle_member_proof(proof, merkle_root, nullifier);
  return proof_valid;
}
```

## Step 5: Full Retrofit Example — Private Todo App

Here's the complete converted Compact contract:

```compact
// ==========================================
// PrivateTodo: Retrofitting Privacy
// ==========================================

contract PrivateTodo {
  state {
    // PUBLIC: Aggregate state
    field task_count: u64;
    field active_task_count: u64;
    field total_reward_paid: Field;

    // PUBLIC: Cryptographic accumulators
    field task_commitments: Set<Field>;
    field task_nullifiers: Set<Field>;
    field task_roots: Map<u64, Field>;  // task_id -> commitment root

    // PUBLIC: Authorization
    field task_registry: Address;  // Authorized task registry contract
  }

  // ==========================================
  // WRITE OPERATIONS
  // ==========================================

  // Create a new private task
  // description_hash: hash of task description (keeps description private)
  // reward: task payment amount (private until claimed)
  // deadline: block number by which task must be completed
  transition create_task(
    description_hash: Field,
    reward: Field,
    deadline: u64
  ) {
    let caller = ctx.sender();

    // Create commitment: H(owner, description_hash, reward, deadline)
    let commitment = poseidon_hash(
      caller,
      description_hash,
      reward,
      deadline
    );

    // Store commitment (hides all task details)
    let task_id = self.task_count;
    self.task_roots[task_id] = commitment;
    self.task_commitments.insert(commitment);
    self.task_count = task_id + 1;
    self.active_task_count = self.active_task_count + 1;
  }

  // Complete a task and claim reward
  // nullifier: prevents double-claiming
  // proof: proves task exists AND caller owns it
  transition complete_task(task_id: u64, nullifier: Field, proof: Proof) {
    let caller = ctx.sender();

    // Verify the task commitment
    let stored_root = self.task_roots[task_id];

    // ZK proof: I know (owner, description_hash, reward, deadline)
    // such that poseidon_hash(...) == stored_root
    // AND owner == caller
    // AND deadline >= current_block
    let proof_ok = verify_task_completion_proof(
      proof,
      stored_root,
      caller,
      deadline
    );
    constrain proof_ok == true;

    // Prevent double-spending
    constrain !self.task_nullifiers.contains(nullifier);
    self.task_nullifiers.insert(nullifier);

    // Update public state (amount not revealed)
    self.active_task_count = self.active_task_count - 1;

    // Transfer reward (amount still private at this point)
    token.transfer(caller, reward);

    emit TaskCompleted(task_id, nullifier, block_number());
  }

  // ==========================================
  // READ OPERATIONS (Selective Disclosure)
  // ==========================================

  // Prove you own a specific task (without revealing details)
  transition prove_task_ownership(task_id: u64, proof: Proof) -> bool {
    let caller = ctx.sender();
    let stored_root = self.task_roots[task_id];

    // ZK proof: I know the preimage of stored_root
    // AND the owner in that preimage is caller
    return verify_ownership_proof(proof, stored_root, caller);
  }

  // Prove active task count is above a threshold (for credit scoring, etc.)
  transition prove_min_tasks(min_count: u64, proof: Proof) -> bool {
    let proof_ok = verify_aggregate_proof(
      proof,
      self.active_task_count,
      min_count
    );
    return proof_ok;
  }

  // ==========================================
  // PUBLIC GETTERS (No privacy loss)
  // ==========================================

  // Total number of tasks (public)
  transition get_task_count() -> u64 {
    return self.task_count;
  }

  // Number of active tasks (public)
  transition get_active_count() -> u64 {
    return self.active_task_count;
  }

  // Verify a commitment exists (without revealing task details)
  transition task_exists(task_id: u64, commitment: Field) -> bool {
    return self.task_commitments.contains(commitment);
  }
}
```

## Step 6: Integrating the Proof Server

Midnight's privacy features require a proof server to generate ZK proofs. Here's how to integrate it into your deployment pipeline.

### Architecture Overview

```
User Browser/App
     │
     ▼
Your Backend
     │
     ├──► EVM Contract (public state, on-chain)
     │
     └──► Midnight Proof Server (ZK proofs, off-chain)
              │
              ▼
         Midnight Node (verifies proofs)
```

### Proof Server Integration

```typescript
import { ProofServer } from '@midnight/sdk';

const proofServer = new ProofServer({
  url: process.env.MIDNIGHT_PROOF_SERVER_URL,
  apiKey: process.env.PROOF_SERVER_API_KEY,
});

// Generate a task completion proof
async function generateTaskCompletionProof(taskId: number, taskData: TaskData) {
  const { description, reward, deadline, owner } = taskData;

  // Create the witness
  const witness = {
    owner,
    description_hash: hash(description),
    reward,
    deadline,
  };

  // Request proof generation
  const proof = await proofServer.generate({
    circuit: 'task_completion',
    publicInputs: {
      task_root: taskData.taskRoot,
      nullifier: taskData.nullifier,
    },
    privateInputs: witness,
  });

  return proof;
}

// Submit to chain
async function completeTaskOnChain(taskId: number, proof: Proof) {
  const tx = await contract.completeTask(taskId, proof.nullifier, proof.bytes);
  await tx.wait();
  return tx;
}
```

### Deployment Pipeline

```yaml
# .github/workflows/privacy-deployment.yml
name: Privacy dApp Deployment

on:
  push:
    branches: [main]

jobs:
  # 1. Deploy public contracts (always)
  deploy-public:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to testnet
        run: npx hardhat deploy --network midnight_testnet

  # 2. Run tests including ZK circuit tests
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build circuits
        run: make circuits
      - name: Run tests
        run: make test-all

  # 3. Deploy proof server (production only)
  deploy-proof-server:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - name: Deploy proof server
        run: |
          docker build -t midnight-proof-server .
          docker push $REGISTRY/midnight-proof-server
          kubectl apply -f k8s/
```

## Security Checklist for Privacy Retrofitting

- [ ] **Every new private variable is backed by a commitment** — never store raw private data on-chain
- [ ] **Every state transition has a corresponding nullifier** — prevents double-spending/replay
- [ ] **ZK proofs verify all constraints** — the circuit must enforce the same rules as the original contract
- [ ] **Selective disclosure is opt-in** — users choose what to prove, nothing is revealed by default
- [ ] **Proof server is trusted** — ensure your proof server hasn't been tampered with (use remote attestation if available)
- [ ] **Backwards compatibility is maintained** — existing users' data should migrate cleanly
- [ ] **Gas costs are acceptable** — ZK proofs add computational overhead

## Common Retrofitting Mistakes

### Mistake 1: Making the Commitment Input Public

```compact
// WRONG: Revealing the input defeats the purpose
transition create_task(description: Field, reward: Field) {
  // description is the actual text — now everyone knows!
  let commitment = poseidon_hash(ctx.sender(), description, reward);
}

// RIGHT: Hash the sensitive inputs
transition create_task(description_hash: Field, reward: Field) {
  // description_hash is a hash, not the actual text
  let commitment = poseidon_hash(ctx.sender(), description_hash, reward);
}
```

### Mistake 2: Reusing Nullifiers

```compact
// WRONG: Same nullifier can be used twice!
transition withdraw(nullifier: Field) {
  constrain !self.used_nullifiers.contains(nullifier);
  self.used_nullifiers.insert(nullifier);
  // ... withdraw logic
}
// If someone front-runs the tx, they can replay with same nullifier!

// RIGHT: Bind nullifier to transaction
transition withdraw(nullifier: Field, tx_hash: Field) {
  let combined = poseidon_hash(nullifier, tx_hash);
  constrain !self.used_nullifiers.contains(combined);
  self.used_nullifiers.insert(combined);
}
```

## Conclusion

Retrofitting privacy to an existing dApp is a systematic process:

1. **Audit** every state variable for privacy requirements
2. **Design** a commitment scheme mapping public ↔ private state
3. **Implement** commitments for private data, keep aggregates public
4. **Add** nullifiers to prevent double-spending
5. **Build** selective disclosure proofs for compliance needs
6. **Integrate** a proof server into your deployment pipeline
7. **Test** thoroughly — ZK bugs are subtle and expensive

The investment is significant, but for applications where privacy is a feature (not just a nice-to-have), it opens up entirely new user segments and use cases that aren't possible with fully-transparent contracts.

---

*Author: 一筒 | GitHub: D2758695161*
