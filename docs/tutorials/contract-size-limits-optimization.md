## Contract Size Limits: Understanding and Optimizing Midnight Contract Deployment

**Difficulty:** Intermediate  
**Time:** 25 minutes  
**Bounty:** #305

---

### Overview

Midnight's blockchain enforces size limits on deployed contracts to ensure network performance and prevent resource abuse. Understanding these limits is crucial for building production-ready dApps. This tutorial covers the size constraints, how to measure your contract size, and optimization techniques.

### What You'll Learn

- Midnight contract size limits and their rationale
- How to measure compact contract size
- Common size pitfalls and solutions
- Optimization strategies for smaller contracts

### Size Limits

| Limit Type | Value | Trigger |
|-----------|-------|---------|
| Maximum compact source | 65,536 bytes | Deployment |
| Maximum compiled WASM | 131,072 bytes | Compilation |
| Maximum state size | 1,048,576 bytes (1 MB) | Runtime |
| Maximum proof size | 2,097,152 bytes (2 MB) | Proof generation |

### Step 1: Measuring Contract Size

```bash
# Check compact source size
midnight contract build my-contract --output build/
ls -la build/my-contract.compact

# Check compiled WASM
ls -la build/my-contract.wasm

# Check all intermediates
wc -c build/*.compact build/*.wasm
```

### Step 2: Contract Size Report

Create a size report script:

```bash
#!/bin/bash
# size-report.sh - Analyze Midnight contract sizes

echo "=== Contract Size Report ==="
echo ""

for file in contracts/*/index.compact; do
    name=$(basename $(dirname $file))
    size=$(wc -c < "$file")
    lines=$(wc -l < "$file")
    echo "$name: $size bytes ($lines lines)"
done

echo ""
echo "=== Largest Contracts ==="
du -sh contracts/*/index.compact | sort -rh | head -5

echo ""
echo "=== Red Flags (size > 20KB) ==="
for file in contracts/*/index.compact; do
    size=$(wc -c < "$file")
    name=$(basename $(dirname $file))
    if [ $size -gt 20000 ]; then
        echo "⚠️  $name: $size bytes — consider refactoring"
    fi
done
```

### Step 3: Optimization Techniques

**1. Remove Dead Code**

```javascript
// ❌ Bad: imports you never use
import { LEDGER, SEED, ROLLUP, TIMESTAMP, VERIFIER, CROSS_CHAIN, NFT, SWAP } from "std";

// ✅ Good: only import what you need
import { LEDGER, SEED } from "std";
```

**2. Minimize State Variables**

```javascript
// ❌ Bad: verbose struct with unused fields
struct UserProfile {
    name: [u8; 64];
    bio: [u8; 256];
    avatar: [u8; 256];
    joinTime: u64;
    lastActive: u64;
    reputation: u64;
    flags: [u8; 32];
}

// ✅ Good: compact struct, remove bio/avatar on-chain
struct UserCompact {
    nameHash: [u8; 8];  // Hash of name, not full name
    joinedAt: u64;
    reputation: u64;
}
```

**3. Use Efficient Data Structures**

```javascript
// ❌ Bad: per-item storage (O(n) lookup)
const allowances: [address; u64][];  // Each entry stores full address

// ✅ Good: use compact representation
const allowanceMap: Map<address, u64>; // Direct lookup

// Or pack multiple values into one
const packedFlags: u8;  // Bitfield: 8 flags in 1 byte
```

**4. Shorten Parameter Names**

```javascript
// ❌ Bad: verbose naming
export function transferTokensToRecipient(senderPublicKey: [u8; 32], recipientAddress: address, tokenAmount: u64): void {

// ✅ Good: compact parameter names (docs explain the names)
export function transfer(sender: [u8; 32], to: address, amt: u64): void {
```

**5. Combine Init/Update Functions**

```javascript
// ❌ Bad: separate init + update
export function initializeOwner(addr: address): void { ... }
export function updateOwner(newAddr: address): void { ... }

// ✅ Good: auto-detect initialization
export function setOwner(addr: address): void {
    if (owner == ZERO_ADDRESS) {
        // init path
    } else {
        // update path
    }
}
```

### Step 4: Pre-Deployment Checklist

```bash
#!/bin/bash
# pre-deploy-check.sh

echo "=== Pre-Deployment Checklist ==="

for contract in contracts/*/; do
    name=$(basename $contract)
    src="${contract}index.compact"
    
    if [ ! -f "$src" ]; then
        echo "⏭️  $name: no index.compact found"
        continue
    fi
    
    size=$(wc -c < "$src")
    
    echo ""
    echo "📦 $name"
    echo "   Size: $size bytes"
    
    if [ $size -gt 65536 ]; then
        echo "   ❌ EXCEEDS MAX (65,536 bytes)"
    elif [ $size -gt 50000 ]; then
        echo "   ⚠️  Close to limit (65,536)"
    else
        echo "   ✅ Safe to deploy"
    fi
    
    # Check for common issues
    if grep -q "timeout\|loop\|recursive" "$src" 2>/dev/null; then
        echo "   ⚠️  Contains loop/recursive calls — check gas costs"
    fi
done
```

### Common Issues

| Problem | Cause | Fix |
|---------|-------|-----|
| "Contract exceeds max size" | Source > 65KB | Optimize or split into multiple contracts |
| "Deployment failed" | WASM > 131KB | Reduce imports, simplify logic |
| "Proof generation timeout" | State too large | Minimize stored state |
| "Out of gas" | Complex computation | Optimize algorithms |

### Summary

- Always measure contract size before deployment
- Target < 50KB for headroom
- Split large contracts into modules
- Use compact data structures
- Run the pre-deploy checklist as part of CI/CD
