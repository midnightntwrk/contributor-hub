## [Tutorial] Concurrent Transactions on Midnight: UTXO Race Conditions & Workarounds

### **Introduction**

In this tutorial, we'll delve into why two transactions from the same wallet can fail when they attempt to spend the same DUST UTXOs. We will explore the "stale UTXO" error and explain the differences between the UTXO model and the account model. Additionally, we'll demonstrate patterns for sequential transaction queuing or using multiple wallet instances for parallelism.

### **Target Audience**

This tutorial is designed for developers who are working with Midnight's blockchain technology and need to understand how concurrent transactions can lead to issues such as "stale UTXOs."

### **Prerequisites**

- Basic understanding of blockchain concepts
- Familiarity with the UTXO (Unspent Transaction Output) model
- Experience with JavaScript or TypeScript

### **Why Concurrent Transactions from the Same Wallet Can Fail**

When two transactions from the same wallet try to spend the same DUST UTXOs, they can fail due to race conditions. This occurs because the blockchain system processes transactions in a sequential manner and may not see both transactions at the same time.

#### **The "Stale UTXO" Error Explained**

A "stale UTXO" error typically arises when one transaction spends an output that another transaction is also trying to spend. In such cases, the blockchain system may process only one of the transactions, rendering the other invalid due to the spent state of the UTXO.

#### **UTXO Model vs Account Model Difference**

The UTXO (Unspent Transaction Output) model and account-based models differ in how they manage transaction outputs:

- **UTXO Model**: In this model, only unspent transactions are considered. Each transaction outputs a new set of outputs that can be spent in the future.
- **Account-Based Model**: This model tracks balances for accounts. Transactions directly modify the balance of an account.

In Midnight's implementation, the UTXO model is used to ensure security and prevent double-spending issues.

### **Sequential Transaction Queuing Pattern**

To avoid race conditions and "stale UTXO" errors, one approach is to use a sequential transaction queuing pattern. This involves ensuring that transactions are processed in a specific order to prevent concurrent access.

#### **Example Code for Sequential Queueing**

```typescript
import { MidnightMCP } from 'midnight-mcp';

const mcp = new MidnightMCP();

async function processTransactions(transactions: any[]) {
  const queue = transactions.map(tx => ({ tx, done: false }));
  
  while (queue.length > 0) {
    for (let i = 0; i < queue.length; i++) {
      if (!queue[i].done && !await mcp.sendTransaction(queue[i].tx)) {
        console.error(`Failed to process transaction: ${JSON.stringify(queue[i].tx)}`);
      } else {
        queue[i].done = true;
      }
    }
  }
}

// Example usage
const transactions = [
  { ... },
  { ... }
];

processTransactions(transactions);
```

### **Multiple Wallet Instances for Parallelism**

Another approach is to use multiple wallet instances that operate in parallel. This can help distribute the load and reduce the likelihood of race conditions.

#### **Example Code for Multiple Wallet Instances**

```typescript
import { MidnightMCP } from 'midnight-mcp';

const mcp = new MidnightMCP();

async function processTransactionsParallel(transactions: any[], numInstances: number) {
  const wallets = Array.from({ length: numInstances }, () => new MidnightMCP());
  
  for (let i = 0; i < transactions.length; i++) {
    await Promise.all(
      wallets.map(wallet => wallet.sendTransaction(transactions[i]))
    );
  }
}

// Example usage
const transactions = [
  { ... },
  { ... }
];

processTransactionsParallel(transactions, 3);
```

### **Troubleshooting Section**

If you encounter "stale UTXO" errors, consider the following troubleshooting steps:

1. Ensure that your transaction queue is processed in a sequential manner.
2. Use multiple wallet instances to handle parallel transactions.
3. Verify that all outputs are fully spent before attempting to spend them again.

### **Conclusion**

Understanding and managing concurrent transactions is crucial for building robust applications on Midnight's blockchain platform. By following the patterns outlined in this tutorial, you can ensure that your application handles UTXOs correctly and avoids race conditions.

### **Additional Resources**

- [Midnight Docs: Getting Started](https://docs.midnight.network/getting-started)
- [Midnight MCP Library Documentation](https://www.npmjs.com/package/midnight-mcp)

By following these guidelines, you can effectively manage concurrent transactions in your Midnight application and ensure a smooth user experience.

---

This tutorial is designed to be comprehensive and easy to follow. If you have any questions or need further assistance, please feel free to reach out on the [Midnight Developer Forum](https://forum.midnight.network/) or join our Discord community for support.