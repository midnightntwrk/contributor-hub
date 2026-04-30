
# Unshielded Token dApp Tutorial

## Introduction

Welcome to the Unshielded Token dApp tutorial! This guide will walk you through creating a decentralized application that interacts with unshielded tokens on the Midnight Network.

Unshielded tokens are standard ERC-20 tokens that can be used directly in dApps without any additional wrapping or conversion process.

---

## Prerequisites

Before you begin, make sure you have the following:

1. **Basic knowledge of:**
   - JavaScript/TypeScript
   - Smart contracts (Solidity)
   - Blockchain concepts

2. **Development environment:**
   - Node.js (v16 or higher)
   - npm or yarn
   - Git
   - A code editor (VS Code recommended)

3. **Required tools:**
   - [Metamask](https://metamask.io/) browser extension
   - [Hardhat](https://hardhat.org/) for smart contract development
   - [Ethers.js](https://docs.ethers.org/) for blockchain interactions

4. **Testnet setup:**
   - Access to a Midnight Network testnet
   - Testnet tokens for testing

---

## Creating the Token

In this section, we'll create a simple ERC-20 token contract that will serve as our unshielded token.

### Step 1: Set up the project

```bash
mkdir unshielded-token-dapp
cd unshielded-token-dapp
npm init -y
npm install --save-dev hardhat
npx hardhat
```

Select "Create a basic sample project" and continue.

### Step 2: Write the token contract

Create a new file at `contracts/UnshieldedToken.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract UnshieldedToken is ERC20 {
    constructor(
        string memory name,
        string memory symbol,
        uint256 initialSupply
    ) ERC20(name, symbol) {
        _mint(msg.sender, initialSupply * 10**decimals());
    }
}
```

### Step 3: Deploy the contract

Update your `scripts/deploy.js` file:

```javascript
const hre = require("hardhat");

async function main() {
  const UnshieldedToken = await hre.ethers.getContractFactory("UnshieldedToken");
  const token = await UnshieldedToken.deploy(
    "Unshielded Test Token",
    "USTT",
    1000000
  );

  await token.deployed();
  console.log("Unshielded Token deployed to:", token.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
```

Deploy using:
```bash
npx hardhat run scripts/deploy.js --network testnet
```

---

## UI Integration

Now let's integrate this token with a simple UI.

### Step 1: Set up the frontend

```bash
npx create-react-app token-ui
cd token-ui
npm install ethers @ethersproject/providers @ethersproject/contracts
```

### Step 2: Create a token interaction component

Create a new file `src/TokenInteraction.js`:

```javascript
import { useState, useEffect } from 'react';
import { ethers } from 'ethers';

// Placeholder ABI - replace with actual ABI from your contract
const UnshieldedTokenABI = [
  "function transfer(address to, uint256 amount) public returns (bool)",
  "function balanceOf(address account) public view returns (uint256)",
  "function approve(address spender, uint256 amount) public returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) public returns (bool)"
];

function TokenInteraction({ tokenAddress }) {
  const [provider, setProvider] = useState(null);
  const [account, setAccount] = useState('');
  const [balance, setBalance] = useState('0');
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const init = async () => {
      if (window.ethereum) {
        const ethProvider = new ethers.providers.Web3Provider(window.ethereum);
        setProvider(ethProvider);

        try {
          await window.ethereum.request({ method: 'eth_requestAccounts' });
          const accounts = await ethProvider.listAccounts();
          setAccount(accounts[0]);
        } catch (error) {
          console.error("User denied account access");
        }
      }
    };

    init();
  }, []);

  const getBalance = async () => {
    if (!provider) return;

    const tokenContract = new ethers.Contract(
      tokenAddress,
      UnshieldedTokenABI,
      provider
    );

    try {
      const balance = await tokenContract.balanceOf(account);
      setBalance(ethers.utils.formatUnits(balance, 18));
    } catch (error) {
      console.error("Error getting balance:", error);
    }
  };

  const sendTokens = async () => {
    if (!provider || !recipient || !amount) return;

    const tokenContract = new ethers.Contract(
      tokenAddress,
      UnshieldedTokenABI,
      provider.getSigner()
    );

    try {
      setIsLoading(true);
      const tx = await tokenContract.transfer(
        recipient,
        ethers.utils.parseUnits(amount, 18)
      );
      await tx.wait();
      alert('Transfer successful!');
      getBalance();
    } catch (error) {
      console.error("Error sending tokens:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div>
      <h2>Unshielded Token Interaction</h2>
      <p>Connected Account: {account || 'Not connected'}</p>
      <p>Balance: {balance}</p>

      <div>
        <button onClick={getBalance} disabled={isLoading}>
          {isLoading ? 'Loading...' : 'Check Balance'}
        </button>
      </div>

      <div style={{ marginTop: '20px' }}>
        <input
          type="text"
          placeholder="Recipient Address"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          style={{ marginRight: '10px', marginBottom: '10px', padding: '5px' }}
        />
        <input
          type="number"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          style={{ marginRight: '10px', marginBottom: '10px', padding: '5px' }}
        />
        <button onClick={sendTokens} disabled={isLoading}>
          {isLoading ? 'Sending...' : 'Send Tokens'}
        </button>
      </div>
    </div>
  );
}

export default TokenInteraction;
```

### Step 3: Update your App.js

```javascript
import React from 'react';
import TokenInteraction from './TokenInteraction';

function App() {
  // Replace with your actual token address
  const tokenAddress = "YOUR_TOKEN_ADDRESS_HERE";

  return (
    <div className="App">
      <TokenInteraction tokenAddress={tokenAddress} />
    </div>
  );
}

export default App;
```

---

## Conclusion

Congratulations! You've successfully:

1. Created an unshielded ERC-20 token
2. Deployed it to the Midnight Network testnet
3. Integrated it with a simple UI using ethers.js

### Next Steps:

1. **Enhance the UI**: Add more features like token swapping, staking, or NFT integration
2. **Add more functionality**: Implement token approvals, events, and more complex interactions
3. **Test thoroughly**: Test on the testnet and prepare for mainnet deployment
4. **Deploy to production**: Once ready, deploy your dApp to the mainnet

### Resources:

- [Midnight Network Documentation](https://docs.midnight.network)
- [Ethers.js Documentation](https://docs.ethers.org/)
- [OpenZeppelin Contracts](https://openzeppelin.com/contracts/)

---

