---
title: Building an Unshielded Token dApp with UI
description: Learn how to build an unshielded token dApp on Midnight with a React frontend.
author: ayortiz-journal
tags: [midnight, dApp, tutorial, unshielded-tokens]
---

# Building an Unshielded Token dApp with UI

This tutorial will guide you through the process of building a decentralized application (dApp) on the Midnight network that interacts with unshielded tokens. We will cover the contract implementation using Compact and the frontend development using React and the Midnight wallet.

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Smart Contract Implementation](#smart-contract-implementation)
3. [Frontend Development](#frontend-development)
4. [Interacting with the dApp](#interacting-with-the-dapp)
5. [Conclusion](#conclusion)

## Prerequisites
Before you begin, ensure you have the following installed:
- [Midnight SDK](https://docs.midnight.network/sdk)
- [Node.js](https://nodejs.org/) (v18 or higher)
- [Midnight Wallet](https://midnight.network/wallet)


## Smart Contract Implementation
The core logic of our dApp resides in the smart contract. We use Compact to define the unshielded token operations.

### Minting Unshielded Tokens
```compact
export ledger mintUnshieldedToken(amount: Uint256): Void {
    // Logic to mint tokens and update the ledger
    }
    ```

    ### Transferring Unshielded Tokens
    ```compact
    export ledger sendUnshielded(to: Address, amount: Uint256): Void {
        // Logic to transfer tokens between addresses
        }
        ```

        ## Frontend Development
        We will use React to build a simple UI for our dApp.

        ### Connecting the Wallet
        ```javascript
        const connectWallet = async () => {
            // Logic to connect to the Midnight wallet
            };
            ```

            ### Minting Tokens from UI
            ```javascript
            const handleMint = async (amount) => {
                // Call the mintUnshieldedToken function from the contract
                };
                ```

                ## Interacting with the dApp
                1. Connect your Midnight wallet.
                2. Enter the amount of tokens you want to mint.
                3. Click "Mint Tokens".
                4. View your updated balance in the UI.

                ## Conclusion
                You have successfully built an unshielded token dApp with a UI on the Midnight network. This is a great starting point for building more complex privacy-focused applications.

                ---
                (c) 2026 Midnight Network Contributors. Licensed under MIT.
