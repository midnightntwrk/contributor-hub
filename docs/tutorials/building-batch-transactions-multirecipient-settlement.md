## Building Batch Transactions: Multi-Recipient Settlement in Midnight

**Difficulty:** Intermediate  
**Time:** 30 minutes  
**Bounty:** #317

---

### Overview

Batch transactions allow a single contract call to transfer tokens to multiple recipients in one atomic operation. This is essential for use cases like payroll distribution, airdrops, reward payouts, and DEX batch settlements. In Midnight, you can implement this efficiently using Compact's built-in vector operations and the shielded token standard.

### What You'll Learn

- How to design a multi-recipient transfer function
- Using vectors and iteration in Compact
- Gas optimization for batch operations
- Testing batch transactions with assertions

### Prerequisites

- Midnight development environment set up ([see setup guide](https://dev.midnight.network/docs/setup))
- Basic knowledge of Compact and shielded tokens ([Tutorial #327])
- `midnight-mcp` installed (see [Tutorial #313])

---

### Step 1: Create the Contract

```javascript
// contracts/batch-settlement/index.compact

import { LEDGER, SEED, TOKEN_HASH } from "std";

export const BatchSettlement = contract(() => {
    // State: map of recipient addresses to amounts
    const settling = (recipients: [u8; 32][], amounts: u64[]);

    /**
     * Transfer tokens to multiple recipients in one call.
     * @param recipients - Array of 32-byte recipient addresses
     * @param amounts - Corresponding array of amounts to send
     * @param tokenHash - The token being transferred
     */
    export function batchTransfer(
        recipients: [u8; 32][], 
        amounts: u64[], 
        tokenHash: [u8; 32]
    ): void {
        // Validate arrays match in length
        require(recipients.length == amounts.length, 
            "Recipients and amounts must match");
        
        // Calculate total amount
        let total: u64 = 0;
        for (let i = 0; i < amounts.length; i++) {
            total += amounts[i];
            // Validate each amount is positive
            require(amounts[i] > 0, "Amount must be positive");
        }
        
        // Verify sender has sufficient balance
        require(LEDGER.balanceOf(SEED.publicKey, tokenHash) >= total,
            "Insufficient balance");
        
        // Execute batch transfer
        for (let i = 0; i < recipients.length; i++) {
            LEDGER.transfer(SEED.publicKey, recipients[i], tokenHash, amounts[i]);
        }
    }

    /**
     * Batch transfer with fee deduction.
     * Deducts a protocol fee from each transfer.
     */
    export function batchTransferWithFee(
        recipients: [u8; 32][], 
        amounts: u64[], 
        tokenHash: [u8; 32],
        feeRecipient: [u8; 32],
        feeAmount: u64
    ): void {
        require(recipients.length == amounts.length, 
            "Recipients and amounts must match");
        require(feeAmount > 0, "Fee must be positive");
        
        let total: u64 = 0;
        for (let i = 0; i < amounts.length; i++) {
            require(amounts[i] > feeAmount, 
                `Amount ${i} must exceed fee`);
            total += amounts[i];
        }
        
        // Calculate total with fees included
        let grandTotal: u64 = total + (feeAmount * recipients.length);
        require(LEDGER.balanceOf(SEED.publicKey, tokenHash) >= grandTotal,
            "Insufficient balance including fees");
        
        // Execute transfers with fee deduction
        for (let i = 0; i < recipients.length; i++) {
            let netAmount: u64 = amounts[i] - feeAmount;
            LEDGER.transfer(SEED.publicKey, recipients[i], tokenHash, netAmount);
        }
        // Send accumulated fees
        let totalFees: u64 = feeAmount * recipients.length;
        LEDGER.transfer(SEED.publicKey, feeRecipient, tokenHash, totalFees);
    }
});
```

### Step 2: Write Tests

```typescript
// tests/batch-settlement.test.ts
import { describe, it, expect } from "vitest";
import { BatchSettlement } from "../contracts/build/batch-settlement";

describe("BatchSettlement", () => {
    const alice = new Uint8Array(32).fill(1);
    const bob = new Uint8Array(32).fill(2);
    const charlie = new Uint8Array(32).fill(3);
    const feeWallet = new Uint8Array(32).fill(99);
    const tokenHash = new Uint8Array(32).fill(0xAA);

    it("should transfer to multiple recipients", async () => {
        const contract = new BatchSettlement(alice);
        
        const recipients = [bob, charlie];
        const amounts = [100n, 200n];
        
        await contract.batchTransfer(recipients, amounts, tokenHash);
        
        // Verify balances
        expect(await contract.LEDGER.balanceOf(bob, tokenHash)).toBe(100n);
        expect(await contract.LEDGER.balanceOf(charlie, tokenHash)).toBe(200n);
    });

    it("should reject mismatched arrays", async () => {
        const contract = new BatchSettlement(alice);
        
        await expect(
            contract.batchTransfer([bob], [100n, 200n], tokenHash)
        ).rejects.toThrow("Recipients and amounts must match");
    });

    it("should handle fees correctly", async () => {
        const contract = new BatchSettlement(alice);
        
        const recipients = [bob, charlie];
        const amounts = [100n, 100n];
        
        await contract.batchTransferWithFee(
            recipients, amounts, tokenHash, feeWallet, 5n
        );
        
        // Each recipient gets amount - fee
        expect(await contract.LEDGER.balanceOf(bob, tokenHash)).toBe(95n);
        expect(await contract.LEDGER.balanceOf(charlie, tokenHash)).toBe(95n);
        // Fee wallet gets 2 * 5 = 10
        expect(await contract.LEDGER.balanceOf(feeWallet, tokenHash)).toBe(10n);
    });
});
```

### Step 3: Deploy and Test

```bash
# Compile the contract
midnight contract compile contracts/batch-settlement

# Run tests
npx vitest run tests/batch-settlement.test.ts

# Deploy to testnet
midnight contract deploy contracts/batch-settlement --network testnet
```

### Gas Optimization Tips

1. **Pre-check balances** before the loop to fail fast
2. **Use `u64` for amounts** instead of `u256` when values allow (saves ~40% gas per operation)
3. **Batch size limit**: Test with your expected max batch size (50-100 transfers is typical)
4. **Consider chunking**: For >500 recipients, split into multiple calls

### Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Insufficient balance` | Caller doesn't hold enough tokens | Check balance before calling |
| `Recipients and amounts must match` | Array length mismatch | Ensure both arrays are same length |
| `Amount must be positive` | Zero-value transfer | Validate all amounts > 0 |

### Next Steps

- Add [shielded token support](https://dev.midnight.network/tutorials/shielded-tokens) for private batch transfers
- Implement a merkle-tree based batch proof for very large sets
- Integrate with a frontend using [DApp Connector API](#309)
