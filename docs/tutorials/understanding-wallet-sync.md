## Understanding Wallet Sync: Why Your Deploy Fails Before It Starts

**Difficulty:** Beginner-Intermediate  
**Time:** 15 minutes  
**Bounty:** #300

---

### Overview

You run `midnight contract deploy` and get: `Error: Wallet not synced`. Or worse — it deploys but your transactions never confirm. Wallet synchronization is the most common source of frustration for new Midnight developers. This tutorial explains how wallet sync works and how to fix sync issues.

### What You'll Learn

- What "wallet sync" actually means
- The sync process: from genesis to current block
- Why sync takes time
- Troubleshooting common sync failures

### How Wallet Sync Works

```
Wallet Start ──► Check Last Synced Block
                     │
           ┌─────────┴─────────┐
           │                   │
      Genesis Block      Recent Blocks
           │                   │
           ▼                   ▼
    ┌──────────────────────────────┐
    │ Download & Verify All Blocks │
    │                              │
    │ Progress:  ████░░░░░░  40%  │
    └──────────────────────────────┘
                     │
                     ▼
    ┌──────────────────────────────┐
    │  Rebuild Private State       │
    │  (Decrypt your transactions) │
    └──────────────────────────────┘
                     │
                     ▼
    ┌──────────────────────────────┐
    │   ✅ Wallet Synced!          │
    │   Ready to deploy/transact   │
    └──────────────────────────────┘
```

### Step 1: Check Sync Status

```bash
# Check wallet sync progress
midnight wallet status

# Output example:
# Wallet: 0xabc...def
# Network: testnet
# Synced: 142,305 / 1,204,830 blocks (11.8%)
# Last block: 2026-05-21 14:30:00 UTC
# Estimated time remaining: ~12 minutes

# Verbose output
midnight wallet status --verbose
# Shows connected peers, download speed, etc.
```

### Step 2: Why Sync is Slow

| Factor | Impact | Why |
|--------|--------|-----|
| Network speed | High | Downloading millions of blocks |
| Block count | High | More blocks = more to process |
| Your transaction count | Medium | More txs = more state to rebuild |
| Peer connections | Medium | More peers = faster download |
| CPU | Medium | ZK proof verification per block |

### Step 3: First Sync (Full vs Fast)

```bash
# Full sync — default, verifies everything
midnight wallet init --network testnet --sync full
# Takes: 10-30 minutes on first run

# Fast sync — trusts recent checkpoints
midnight wallet init --network testnet --sync fast
# Takes: 2-5 minutes
# Caution: Less secure for high-value contracts

# Snapshot sync — download pre-verified state
midnight wallet init --network testnet --sync snapshot
# Takes: 30-60 seconds
# Requires: Snapshot file from trusted source
```

### Step 4: Real-Time Sync Monitoring

```typescript
// monitor-sync.ts
import { WalletProvider } from '@midnight-ntwrk/midnight-js';

async function monitorSync(provider: WalletProvider) {
    let lastProgress = 0;
    
    // Poll sync status every 2 seconds
    const interval = setInterval(async () => {
        const status = await provider.getSyncStatus();
        const progress = (status.syncedBlocks / status.totalBlocks) * 100;
        
        if (Math.abs(progress - lastProgress) > 1) {
            lastProgress = progress;
            console.log(
                `Sync: ${status.syncedBlocks.toLocaleString()}/` +
                `${status.totalBlocks.toLocaleString()} blocks ` +
                `(${progress.toFixed(1)}%)`
            );
            
            // Update UI
            updateSyncBar(progress);
        }
        
        if (status.isSynced) {
            clearInterval(interval);
            console.log('✅ Wallet synced! Ready to deploy.');
            onSyncComplete();
        }
    }, 2000);
}

function updateSyncBar(progress: number) {
    const bar = '█'.repeat(Math.floor(progress / 5)) +
                '░'.repeat(20 - Math.floor(progress / 5));
    process.stdout.write(`\r[${bar}] ${progress.toFixed(1)}%`);
}
```

### Step 5: Common Errors & Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `Wallet not synced` | Sync not complete | Wait for sync, check `midnight wallet status` |
| `Sync stalled at X%` | No peers / network issue | Check network, restart wallet |
| `Block verification failed` | Corrupted local data | `midnight wallet reset --sync fresh` |
| `Genesis mismatch` | Wrong network config | `midnight wallet config --network correct-network` |
| `Timeout: sync too slow` | Low bandwidth | Use `--sync fast` or `--sync snapshot` |

### Step 6: Automate Sync in CI/CD

```bash
#!/bin/bash
# deploy-check.sh — Wait for sync before deploying

echo "Checking wallet sync..."

# Wait up to 5 minutes for sync
for i in $(seq 1 60); do
    STATUS=$(midnight wallet status --json 2>/dev/null)
    SYNCED=$(echo "$STATUS" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print(d.get('isSynced', False))
")
    
    if [ "$SYNCED" = "True" ]; then
        echo "✅ Wallet synced after ${i}0 seconds"
        break
    fi
    
    PROGRESS=$(echo "$STATUS" | python3 -c "
import json,sys
d=json.load(sys.stdin)
p=d.get('syncedBlocks',0)/max(d.get('totalBlocks',1),1)*100
print(f'{p:.1f}%')
" 2>/dev/null || echo "checking...")
    
    echo "  Sync progress: $PROGRESS (${i}0s elapsed)"
    sleep 10
done

# Check if synced
IS_SYNCED=$(midnight wallet status --json | python3 -c "
import json,sys
print(json.load(sys.stdin).get('isSynced', False))
")

if [ "$IS_SYNCED" != "True" ]; then
    echo "❌ Wallet failed to sync in 5 minutes"
    echo "   Try: midnight wallet reset --sync fast"
    exit 1
fi

# Proceed with deployment
echo "Deploying contract..."
midnight contract deploy my-contract ... --network testnet
```

### Step 7: Background Sync Mode

For development workflows, keep the wallet syncing in the background:

```bash
# Terminal 1: Start wallet sync in background
midnight wallet daemon --network testnet --log-file ~/.midnight/sync.log &

# Terminal 2: Check progress periodically
tail -f ~/.midnight/sync.log | grep -i "sync\|progress\|block"

# Terminal 3: Wait for sync then deploy
midnight wallet wait-for-sync --timeout 300
midnight contract deploy my-contract ...
```

### Summary

- Wallet sync downloads and verifies all blocks since genesis
- Full sync is secure but slow; fast/snapshot modes are quicker
- Always check sync status before deploying
- Automate sync waiting in CI/CD scripts
- Use background daemon mode for development
