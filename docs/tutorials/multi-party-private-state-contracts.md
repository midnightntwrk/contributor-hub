## Multi-Party Private State and Contracts Between Two+ Users

**Difficulty:** Advanced  
**Time:** 35 minutes  
**Bounty:** #303

---

### Overview

Most smart contracts involve a single user calling a function. Multi-party contracts allow TWO or MORE users to share private state, enabling collaborative applications like joint accounts, multi-sig wallets, and shared liquidity pools with privacy.

### Key Concepts

- **Shared private state**: State visible only to authorized parties
- **Multi-party transactions**: Require signatures from all parties
- **Private vs public state**: Only public state is visible on-chain

### Step 1: Joint Account Contract

```javascript
// contracts/joint-account/index.compact

import { LEDGER, SEED } from "std";

export const JointAccount = contract(() => {
    const party1: [u8; 32];
    const party2: [u8; 32];
    const balance: u64;

    export function deposit(tokenHash: [u8; 32]): void {
        require(SEED.publicKey == party1 || SEED.publicKey == party2);
        LEDGER.transferFrom(SEED.publicKey, contract, tokenHash, amount);
    }

    // Requires BOTH parties to sign
    export function withdraw(amount: u64, tokenHash: [u8; 32]): void {
        require(LEDGER.isMultiPartyTx(), "Requires multi-party");
        require(balance >= amount, "Insufficient balance");
        LEDGER.transfer(contract, SEED.publicKey, tokenHash, amount);
    }
});
```

### Step 2: Testing Multi-Party

```bash
# Deposit from party1
midnight contract call joint-account deposit \
  --args '{"tokenHash":"0xTOKEN"}' \
  --from party1

# Withdraw requires both signatures
midnight contract call joint-account withdraw \
  --args '{"amount":100,"tokenHash":"0xTOKEN"}' \
  --multi-party party1,party2
```

### Use Cases

| Contract | Parties | Private State |
|----------|---------|---------------|
| Joint Account | 2 | Balance, transaction history |
| Multi-sig Wallet | 3-of-5 | Signers, pending transactions |
| Private Auction | 2+ | Bids (hidden until reveal) |
| Shared Liquidity | 2+ | Positions, P&L |

### Key Differences from Single-Party

| Aspect | Single-Party | Multi-Party |
|--------|-------------|-------------|
| State visibility | Public to all | Private to parties |
| Transaction signing | 1 signature | N signatures |
| State transitions | Any time | Consensus required |
| Complexity | Low | Medium-High |
