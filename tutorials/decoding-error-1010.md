# Decoding Error 1010: What 'Invalid Transaction' Actually Means

## Introduction

When developing on Midnight, encountering `POOL_INVALID_TX` (Error 1010) can be confusing. This tutorial explains the error's structure, maps common custom error codes to their root causes, provides diagnostic steps, and introduces the ledger cost model.

## Error Code Structure

The error code is defined as:
- `POOL_INVALID_TX = AUTHOR(1000) + 10`

`AUTHOR(1000)` is the base code for pool-related authorization failures. Adding 10 yields 1010. This modular design allows for indicative subcodes (e.g., +10 for invalid transaction). In practice, you may see custom errors like 139, 154, etc., which are offsets from `AUTHOR`.

## Common Error Codes and Diagnostics

### Error 139: Transaction Builder Error
- **Meaning**: The transaction builder (e.g., `@midnight-ntwrk/midnight-js-transaction-builder`) failed to construct a valid transaction.
- **Causes**: Missing required inputs, incorrect output addresses, invalid signatures.
- **Diagnostic Steps**:
  1. Check transaction input construction.
  2. Verify all required fields are present.
  3. Ensure signatures are generated correctly.
- **Code Example**:
  ```typescript
  import { TransactionBuilder } from '@midnight-ntwrk/midnight-js-transaction-builder';
  
  try {
    const tx = builder.build({
      inputs: [{ utxo: 'utxo1', value: 100n }],
      outputs: [{ address: 'addr1', value: 50n }]
    });
  } catch (e) {
    if (e.code === 139) {
      console.error('Transaction builder error:', e.message);
    }
  }
  ```

### Error 154: BlockLimitExceeded
- **Meaning**: The transaction exceeds block resource limits (e.g., size, compute units).
- **Causes**: Too many inputs/outputs, large scripts, high cost.
- **Diagnostic Steps**:
  1. Check transaction size.
  2. Estimate execution cost using the cost model.
  3. Split into multiple transactions.
- **Code Example**:
  ```typescript
  const cost = estimateCost(transaction);
  if (cost.total > blockLimit) {
    throw new Error('Transaction exceeds block limit');
  }
  ```

### Error 168: Batch Settlement Failure
- **Meaning**: A batch of transactions failed settlement (e.g., in a rollup).
- **Causes**: Invalid proofs, conflicting state, timeout.
- **Diagnostic Steps**:
  1. Verify proof generation for each transaction.
  2. Ensure state consistency across batch.
  3. Retry with smaller batch.

### Error 170: Merkle Root Pruning
- **Meaning**: Merkle tree root pruning caused leaf removal.
- **Causes**: Pruning parameters too aggressive, supply not reserved.
- **Diagnostic Steps**:
  1. Check pruning configuration.
  2. Ensure necessary leaves are reserved.
- **Code Example**:
  ```typescript
  setPruningConfig({ maxLeaves: 1000, pruneInterval: 60 });
  reserveLeaves([leafHash1, leafHash2]);
  ```

### Error 186: EffectsCheckFailure
- **Meaning**: Expected state effects do not match actual effects.
- **Causes**: Incorrect state transition specification, race conditions.
- **Diagnostic Steps**:
  1. Compare expected vs actual effects.
  2. Review contract logic for state mutations.
  3. Add debug logging.

## Ledger Cost Model

The ledger assigns costs across five dimensions:
1. **Memory** – bytes allocated
2. **Computation** – CPU cycles
3. **Storage** – permanent state size
4. **Bandwidth** – network data
5. **Proof** – zero-knowledge proof complexity

Each transaction is limited per block. Use the cost model API to estimate:

```typescript
import { costModel } from '@midnight-ntwrk/ledger';

const costs = costModel.estimate(transaction);
console.log('Memory:', costs.memory);
console.log('Computation:', costs.computation);
console.log('Storage:', costs.storage);
console.log('Bandwidth:', costs.bandwidth);
console.log('Proof:', costs.proof);
```

## Conclusion

Understanding `POOL_INVALID_TX` and its subcodes is crucial for debugging Midnight dApps. By mapping error codes to diagnostic steps and leveraging the cost model, developers can efficiently resolve common issues.

For more, visit [Midnight Docs](https://docs.midnight.network/getting-started) and the [Developer Forum](https://forum.midnight.network/).