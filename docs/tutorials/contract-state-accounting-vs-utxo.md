## Contract-State Accounting vs UTXO Tokens: Two Models for Managing Value

**Difficulty:** Intermediate  
**Time:** 20 minutes  
**Bounty:** #302

---

### Overview

Midnight supports two fundamentally different models for managing value and state: **contract-state accounting** (similar to Ethereum's balance model) and **UTXO tokens** (similar to Bitcoin's unspent output model). Understanding both is critical for choosing the right architecture for your dApp.

### What You'll Learn

- The differences between contract-state and UTXO models
- When to use each approach
- How to convert between models
- Hybrid patterns combining both

### Core Differences

| Feature | Contract-State (Account) | UTXO Tokens |
|---------|-------------------------|-------------|
| State storage | Single global balance map | Individual token outputs |
| Concurrency | Serial (one tx at a time) | Parallel (per UTXO) |
| Privacy | All balances visible | Each UTXO can be private |
| Complexity | Simpler to implement | More complex code |
| Gas cost | Lower per operation | Higher per UTXO |
| Reorg resistance | Lower | Higher (UTXO tombstone) |
| Best for | Simple dApps, access control | DeFi, exchanges, multi-user |

### Model 1: Contract-State Accounting

```javascript
// contracts/account-model/index.compact

import { LEDGER, SEED } from "std";

// All balances stored in one central map
export const AccountModel = contract(() => {
    const balances: Map<[u8; 32], u64>;  // user -> balance
    
    export function initialize(): void {
        // Deployer gets initial supply
        balances.set(SEED.publicKey, 1_000_000);
    }
    
    // Simple transfer — update two entries in one map
    export function transfer(to: [u8; 32], amount: u64): void {
        const senderBal = balances.get(SEED.publicKey) ?? 0;
        require(senderBal >= amount, "Insufficient balance");
        
        // Debit sender
        balances.set(SEED.publicKey, senderBal - amount);
        
        // Credit receiver
        const receiverBal = balances.get(to) ?? 0;
        balances.set(to, receiverBal + amount);
    }
    
    // Check balance (simple query)
    export function balanceOf(user: [u8; 32]): u64 {
        return balances.get(user) ?? 0;
    }
    
    // Batch transfer (same sender to multiple recipients)
    export function batchTransfer(
        recipients: [u8; 32][3],
        amounts: u64[3]
    ): void {
        let total: u64 = 0;
        for (let i = 0; i < 3; i++) {
            total += amounts[i];
        }
        
        const senderBal = balances.get(SEED.publicKey) ?? 0;
        require(senderBal >= total, "Insufficient");
        
        balances.set(SEED.publicKey, senderBal - total);
        
        for (let i = 0; i < 3; i++) {
            const current = balances.get(recipients[i]) ?? 0;
            balances.set(recipients[i], current + amounts[i]);
        }
    }
});
```

**Pros:** Simple, atomic batch operations, easy balance queries.  
**Cons:** Serial execution, all balances visible on-chain.

### Model 2: UTXO Tokens

```javascript
// contracts/utxo-model/index.compact

import { LEDGER, SEED, VERIFIER } from "std";

// Each token is a separate output
export const UTXOModel = contract(() => {
    const outputs: Map<[u8; 32], Output>;  // txId -> output
    
    struct Output {
        owner: [u8; 32];
        amount: u64;
        data: [u8; 32];  // optional metadata
        spent: bool;
    }
    
    export function mint(amount: u64, data: [u8; 32]): void {
        const txId = hash(SEED.publicKey, SEED.height, amount);
        outputs.set(txId, Output(SEED.publicKey, amount, data, false));
    }
    
    // Spend an output, create new ones
    export function spend(
        inputTxId: [u8; 32],
        recipients: [u8; 32][2],
        amounts: u64[2]
    ): void {
        const input = outputs.get(inputTxId);
        require(input !== null, "Output not found");
        require(!input.spent, "Output already spent");
        require(input.owner == SEED.publicKey, "Not your output");
        
        let totalSpent: u64 = 0;
        for (let i = 0; i < 2; i++) totalSpent += amounts[i];
        require(totalSpent <= input.amount, "Insufficient");
        
        // Mark input as spent
        input.spent = true;
        outputs.set(inputTxId, input);
        
        // Create new outputs
        for (let i = 0; i < 2; i++) {
            if (amounts[i] > 0) {
                const newId = hash(
                    recipients[i], SEED.height, amounts[i], i
                );
                outputs.set(newId, Output(
                    recipients[i], amounts[i], input.data, false
                ));
            }
        }
        
        // Create change output if needed
        const change = input.amount - totalSpent;
        if (change > 0) {
            const changeId = hash(
                SEED.publicKey, SEED.height, change, 99
            );
            outputs.set(changeId, Output(
                SEED.publicKey, change, input.data, false
            ));
        }
    }
    
    // Get unspent outputs for a user
    export function getUnspentOutputs(user: [u8; 32]): [u8; 32][5] {
        let results: [u8; 32][5];
        let count = 0;
        // Note: iteration would be needed for production
        return results;
    }
});
```

**Pros:** Parallel spending, privacy-friendly, easy to prove ownership of specific UTXO.  
**Cons:** Change management, UTXO fragmentation, more complex queries.

### Model 3: Hybrid Approach

Best of both worlds — use UTXO for value, account for access control:

```javascript
// contracts/hybrid-model/index.compact

import { LEDGER, SEED, VERIFIER } from "std";

export const HybridModel = contract(() => {
    // Account model for roles & permissions
    const roles: Map<[u8; 32], u8>;  // user -> role (1=admin, 2=user, 3=viewer)
    
    // UTXO model for value
    const tokens: Map<[u8; 32], TokenOutput>;
    
    struct TokenOutput {
        owner: [u8; 32];
        amount: u64;
        spent: bool;
    }
    
    // Admin role check via account model
    export function assignRole(user: [u8; 32], role: u8): void {
        const callerRole = roles.get(SEED.publicKey) ?? 0;
        require(callerRole == 1, "Admin only");
        roles.set(user, role);
    }
    
    // UTXO transfer (parallelizable)
    export function transferToken(
        inputTxId: [u8; 32],
        to: [u8; 32],
        amount: u64
    ): void {
        const senderRole = roles.get(SEED.publicKey) ?? 0;
        require(senderRole >= 2, "Users only");
        
        const input = tokens.get(inputTxId);
        require(input !== null, "Not found");
        require(!input.spent, "Spent");
        require(input.owner == SEED.publicKey, "Not yours");
        require(input.amount >= amount, "Insufficient");
        
        input.spent = true;
        tokens.set(inputTxId, input);
        
        const newId = hash(to, SEED.height, amount);
        tokens.set(newId, TokenOutput(to, amount, false));
        
        const change = input.amount - amount;
        if (change > 0) {
            const changeId = hash(SEED.publicKey, SEED.height, change);
            tokens.set(changeId, TokenOutput(
                SEED.publicKey, change, false
            ));
        }
    }
});
```

### When to Use Which Model

| Scenario | Model | Rationale |
|----------|-------|-----------|
| Simple token (ERC-20-like) | Account | Less code, easier queries |
| NFT or unique assets | UTXO | Each token is distinct |
| High-throughput exchange | UTXO | Parallel order matching |
| Access control system | Account | Single source of truth for roles |
| Privacy dApp | UTXO | Each UTXO can be privately held |
| DAO treasury | Account | Simple balance queries for voting |
| Payment channel | UTXO | Independent channel states |
| Multi-sig wallet | Hybrid | Roles (account) + value (UTXO) |

### Converting Between Models

```javascript
// Convert UTXO to account balance
export function convertUtxoToAccount(inputTxId: [u8; 32]): void {
    const input = tokens.get(inputTxId);
    require(input !== null && !input.spent, "Invalid UTXO");
    require(input.owner == SEED.publicKey, "Not yours");
    
    input.spent = true;
    
    // Credit to account balance
    const currentBal = balances.get(SEED.publicKey) ?? 0;
    balances.set(SEED.publicKey, currentBal + input.amount);
    
    emit("Converted", SEED.publicKey, input.amount, "utxo-to-account");
}
```

### Performance Comparison

```
Account Model:
  Transfer:       1 read + 2 writes = ~3 ops
  Batch(3):       1 read + 4 writes = ~5 ops
  Balance query:  1 read = ~1 op

UTXO Model:
  Transfer:       1 read + 1 write (spend) + 1-2 writes (create) = ~4 ops
  Batch(3):       1 read + 1 write + 3-4 writes = ~6 ops
  Balance query:  Scan all UTXOs = N reads (expensive)

Hybrid Model:
  Transfer:       1 role check + UTXO ops = ~5 ops
  Setup:          More complex deployment
```

### Summary

- **Account model** is simpler but serial — use for straightforward dApps
- **UTXO model** enables parallel execution — use for DeFi and exchanges
- **Hybrid model** gives you both — roles via accounts, value via UTXOs
- Choose based on your concurrency needs and query patterns
- You can convert between models when needed
