## Proof Server and Indexer: How Midnight Processes Transactions

**Difficulty:** Intermediate  
**Time:** 20 minutes  
**Bounty:** #308

---

### Overview

When you submit a transaction on Midnight, it doesn't just go to the mempool. It passes through a **Proof Server** that generates zero-knowledge proofs, and an **Indexer** that makes state queryable. Understanding these components helps you debug issues and optimize your dApp.

### What You'll Learn

- The transaction lifecycle: submit → prove → index → confirm
- How the Proof Server generates ZK proofs
- How the Indexer organizes contract state
- Debugging proof failures and indexer lag

### Transaction Lifecycle

```
User submits tx
      │
      ▼
┌─────────────┐
│ Proof       │  Generate ZK proof
│ Server      │  (~1-5 seconds)
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Validator   │  Verify proof
│ Node        │  Add to block
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Indexer     │  Index state changes
│             │  Make queryable
└──────┬──────┘
       │
       ▼
    ✅ Confirmed
```

### Step 1: The Proof Server

The Proof Server is a critical component that generates ZK proofs for transactions:

```bash
# Check proof server status
midnight proof-server status

# Output:
# Proof Server: running
# Version: 0.4.2
# Queue depth: 3
# Avg proof time: 2.3s
# Workers: 4
# Memory: 1.2 GB / 4 GB

# View proof server logs
midnight proof-server logs --tail 50
```

#### Proof Generation Stages

| Stage | Time | Description |
|-------|------|-------------|
| Witness generation | 30% | Build execution trace |
| Circuit compilation | 20% | Compile contract to circuit |
| Proof computation | 40% | Generate ZK proof (heaviest) |
| Proof verification | 10% | Verify proof before submission |

### Step 2: Transaction Flow Detail

```javascript
// tx-flow.js — Simulate what happens when you submit a tx

async function submitTransaction(contract, method, args) {
    console.log('1. Building transaction...');
    const tx = await contract.buildTransaction(method, args);
    
    console.log('2. Sending to Proof Server...');
    const proofJob = await proofServer.submit(tx);
    // proofJob.id = "proof_abc123"
    
    console.log('3. Waiting for proof generation...');
    const proof = await pollProofStatus(proofJob.id);
    // Polling: ████░░░░ 40%
    
    console.log('4. Submitting proven transaction...');
    const txHash = await node.submitTransaction(proof);
    
    console.log('5. Waiting for confirmation...');
    const receipt = await waitForTransaction(txHash);
    // Confirmed in block #1,234,567
    
    console.log('6. Waiting for indexer...');
    await waitForIndexer(txHash);
    // State available for queries
    
    return receipt;
}

async function pollProofStatus(jobId) {
    while (true) {
        const status = await proofServer.getStatus(jobId);
        process.stdout.write(`\rProgress: ${status.progress}%`);
        
        if (status.status === 'completed') {
            console.log('\n✅ Proof ready');
            return status.proof;
        }
        if (status.status === 'failed') {
            throw new Error(`Proof failed: ${status.error}`);
        }
        await sleep(500);
    }
}
```

### Step 3: Proof Server Configuration

```yaml
# proof-server-config.yaml
proof_server:
  # Number of parallel proof workers
  workers: 4
  
  # Max queue size before rejecting
  max_queue: 100
  
  # Proof timeout (seconds)
  timeout: 60
  
  # Memory limit per proof (MB)
  memory_per_proof: 2048
  
  # Cache proved circuits for reuse
  circuit_cache_size: 50
  
  # Log level
  log_level: info
  
  # Resource limits
  resources:
    cpu_limit: 8
    memory_limit: 8GB
```

### Step 4: The Indexer

The Indexer makes contract state queryable after transactions confirm:

```bash
# Check indexer status
midnight indexer status

# Output:
# Indexer: running
# Last indexed block: 1,234,567
# Indexing gap: 0 blocks (up to date)
# Contracts tracked: 12
# State entries: 45,678

# Check specific contract index
midnight indexer contract --address 0xabc...def
```

#### Indexer Architecture

```
Blockchain ──► Indexer ──► Database ──► Query API
                   │
            ┌──────┴──────┐
            │  State       │  Event
            │  Index       │  Index
            └──────┬──────┘
                   │
            ┌──────▼──────┐
            │  GraphQL    │
            │  Endpoint   │
            └─────────────┘
```

### Step 5: Common Issues & Debugging

| Issue | Symptom | Cause | Fix |
|-------|---------|-------|-----|
| Proof timeout | `Error: proof generation timed out` | Complex contract, insufficient workers | Increase timeout or simplify logic |
| Indexer lag | State not updating for 30+ seconds | High tx volume | Wait or check `midnight indexer status` |
| Proof failed | `Error: circuit compilation failed` | Invalid contract code | Check contract for errors |
| Out of memory | Proof server crashes | Too many parallel proofs | Reduce `workers` in config |
| Stale state | Old data returned | Indexer behind | Check gap, wait for sync |

### Step 6: Monitoring Setup

```bash
#!/bin/bash
# monitor-midnight.sh

echo "=== Midnight Infrastructure Monitor ==="
echo ""

# Check Proof Server
PS_STATUS=$(midnight proof-server status --json 2>/dev/null)
if [ $? -eq 0 ]; then
    QUEUE=$(echo "$PS_STATUS" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('queue_depth','?'))")
    WORKERS=$(echo "$PS_STATUS" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('workers','?'))")
    echo "✅ Proof Server: queue=$QUEUE workers=$WORKERS"
else
    echo "❌ Proof Server: DOWN"
fi

# Check Indexer
IDX_STATUS=$(midnight indexer status --json 2>/dev/null)
if [ $? -eq 0 ]; then
    GAP=$(echo "$IDX_STATUS" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('indexing_gap','?'))")
    echo "✅ Indexer: gap=$GAP blocks"
else
    echo "❌ Indexer: DOWN"
fi

# Check Node
NODE_STATUS=$(midnight node status --json 2>/dev/null)
if [ $? -eq 0 ]; then
    PEERS=$(echo "$NODE_STATUS" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('peers','?'))")
    BLOCK=$(echo "$NODE_STATUS" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('current_block','?'))")
    echo "✅ Node: peers=$PEERS block=$BLOCK"
else
    echo "❌ Node: DOWN"
fi

echo ""
echo "=== Health: $([[ $QUEUE ]] && echo 'OK' || echo 'ISSUES') ==="
```

### Step 7: Optimizing Proof Generation

```typescript
// proof-optimizer.ts

interface ProofMetrics {
    contractComplexity: number;  // Lines of Compact code
    stateSize: number;          // Bytes of state accessed
    proofTime: number;          // Milliseconds
}

export function estimateProofTime(contract: string): ProofMetrics {
    const lines = contract.split('\n').length;
    const stateAccesses = (contract.match(/\.set\(|\.get\(|\.delete\(/g) || []).length;
    
    // Rough estimation
    const estimatedMs = (lines * 50) + (stateAccesses * 200);
    
    return {
        contractComplexity: lines,
        stateSize: stateAccesses * 32,  // Approximate
        proofTime: estimatedMs,
    };
}

// Tips for faster proofs
export const OPTIMIZATION_TIPS = [
    'Minimize state reads/writes per transaction',
    'Use smaller data types (u8 vs u64 when possible)',
    'Avoid loops with dynamic bounds',
    'Cache frequently accessed state',
    'Split complex operations into multiple simpler txs',
];
```

### Summary

- **Proof Server** generates ZK proofs for every transaction (1-5s)
- **Indexer** organizes state for fast queries
- Proof timeout? → Simplify contract or increase workers
- Indexer lag? → Wait or reduce transaction frequency
- Monitor all three components (proof server, indexer, node) for health
