Designing Public vs. Private State: What Goes Where and Why

Introduction
-----------

When building decentralized applications (dApps), it's essential to decide what data belongs in the public ledger versus what remains private. This tutorial will guide you through the process of designing your dApp's state management, covering exported vs non-exported ledger fields, the implications of `disclose()`, shielded vs unshielded token choices, and common mistakes.

Exported vs Non-Exported Ledger Fields
--------------------------------------

When defining your data structure for the public ledger, consider what fields can be safely exposed to users. Non-exported ledger fields are those that should remain private and not be written to the blockchain in their entirety.

*   **Private State**: Use non-exported fields to store sensitive information, such as user balances or private keys.
*   **Exported Data**: Exported fields are those that can be safely written to the public ledger. These might include public state variables like the current block number or the total supply of tokens.

**Example:**

Suppose we're building a simple token-based economy where each user has a balance on the blockchain. We want to expose the `balance` field but keep the private user ID (`id`) hidden.
```javascript
// Public ledger fields (exported)
publicState.balance = 100;

// Private state (non-exported)
privateState.id = 'user123';
privateState.balance = 100;
```
Implications of `disclose()`
-----------------------------

The `disclose()` function allows you to explicitly specify which non-exported fields should be written to the public ledger. This is particularly useful when working with shielded tokens, where the underlying private data remains confidential.

*   **Shielded Tokens**: Use `disclose()` to expose specific parts of your private state to the public ledger.
*   **Unshielded Tokens**: For unshielded tokens, you don't need to explicitly specify which fields should be exposed. The entire private state is written to the blockchain.

**Example:**
```javascript
// Shielded token example
publicState.balance = disclose(privateState.balance); // Only balance is exposed

// Unshielded token example
privateState.id = 'user123';
privateState.balance = 100;
```
Shielded vs Unshielded Token Choices
--------------------------------------

When deciding between shielded and unshielded tokens, consider the following factors:

*   **Security**: Shielded tokens offer greater security by keeping sensitive data private. However, this comes at the cost of increased complexity.
*   **Scalability**: Unshielded tokens are generally faster and more scalable but may compromise on security.

**Example:**
```javascript
// Shielded token contract
contract {
    // Private state fields...
}

// Unshielded token contract
contract {
    // Public state variables, no private state...
}
```
Common Mistakes
----------------

When managing your dApp's state, be aware of the following common mistakes:

*   **Merkle Path Disclosure**: Accidentally exposing Merkle paths can reveal sensitive information about the underlying data.
*   **Intermediate Value Leaks**: Disclosing intermediate values during calculations can leak private state.

**Example:**
```javascript
// Mistake example (accidental Merkle path disclosure)
publicState.merklePath = getMerklePath(privateState.data);

// Corrected code (securely storing the Merkle path)
const merkleProof = await signAndVerifyMerklePath(
    privateState.data,
    networkId
);
```
Decision Trees for Common dApp Patterns
--------------------------------------

Here are some common dApp patterns and decision trees to help you design your state management:

*   **User Authentication**
    *   Ask user for login credentials
    *   Hash and store credentials securely
    *   Use shielded tokens for sensitive data

|  |  |  |
| --- | --- | --- |
| 1  | Ask user for password | Disclose hashed password for secure storage |
| 2  | Verify user with network ID | Return verification result to public ledger |

*   **Token Distribution**
    *   Generate new tokens
    *   Store token details securely (id, balance, etc.)
    *   Use non-exported fields to store sensitive information

|  |  |  |
| --- | --- | --- |
| 1  | Create token with random ID | Set public state variable for token ID |
| 2  | Distribute token to users | Store user's private state (id, balance) securely |

Conclusion
----------

Designing your dApp's state management is crucial for security and scalability. By understanding the differences between exported and non-exported ledger fields, the implications of `disclose()`, and common mistakes, you can create a secure and efficient state management system.