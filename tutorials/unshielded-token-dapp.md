# Building an Unshielded Token dApp with UI

## Overview

This tutorial guides you through building an **unshielded token dApp** with a working frontend. Unshielded tokens are a simpler entry point for newcomers to the Midnight ecosystem compared to shielded tokens, while still demonstrating core token operations.

## Prerequisites

- Basic understanding of React and TypeScript
- Midnight wallet extension installed
- Node.js 18+ and npm/yarn

## What You'll Build

A dApp that allows users to:
- Mint unshielded tokens
- Transfer tokens to other addresses
- View token balances
- Understand unshielded vs shielded tradeoffs

## Core Concepts

### Unshielded Tokens
Unshielded tokens are visible on-chain. They are ideal for:
- Public transparency requirements
- Regulatory compliance
- Simpler architecture for beginners

### When to Use Unshielded vs Shielded

| Aspect | Unshielded | Shielded |
|--------|-----------|----------|
| Privacy | Public | Private |
| Compliance | Full auditability | Zero-knowledge proofs |
| Complexity | Lower | Higher |
| Use Case | Public tokens, governance | Confidential transactions |

## Project Setup

```bash
npx create-midnight-app unshielded-token-dapp --template react
```

### Dependencies

```bash
npm install @midnight-ntwrk/compact-react @midnight-ntwrk/unshielded-api
```

## Smart Contract Implementation  

```compact
// UnshieldedToken.compact
contract UnshieldedToken {
    // Token state
    ledger: Map<Address, Nat>!;
    totalSupply: Nat!;

    // Mint unshielded tokens
    exercise mintUnshielded(amount: Nat) {
        ledger[msg.sender] = ledger[msg.sender] + amount;
        totalSupply = totalSupply + amount;
    }

    // Transfer unshielded tokens
    exercise sendUnshielded(to: Address, amount: Nat) {
        assert(ledger[msg.sender] >= amount, "Insufficient balance");
        ledger[msg.sender] = ledger[msg.sender] - amount;
        ledger[to] = ledger[to] + amount;
    }

    // Check balance
    getLedger(address: Address): Nat {
        return ledger[address] ?? 0;
    }
}
```

## Frontend Implementation

### Wallet Connection

```typescript
import { useMidnightWallet } from '@midnight-ntwrk/compact-react';

function WalletConnect() {
  const { connect, disconnect, address, isConnected } = useMidnightWallet();
  
  return (
    <button onClick={isConnected ? disconnect : connect}>
      {isConnected ? address?.slice(0, 6) : 'Connect Wallet'}
    </button>
  );
}
```

### Token Mint Component

```typescript
function MintTokens() {
  const { contract } = useContract();
  const [amount, setAmount] = useState('');

  const handleMint = async () => {
    const tx = await contract.mintUnshielded({ 
      amount: BigInt(amount) 
    });
    await tx.wait();
    alert(`Minted ${amount} tokens!`);
  };

  return (
    <div>
      <input 
        type="number" 
        value={amount} 
        onChange={e => setAmount(e.target.value)}
        placeholder="Amount"
      />
      <button onClick={handleMint}>Mint Unshielded</button>
    </div>
  );
}
```

### Transfer Component

```typescript
function TransferTokens() {
  const { contract } = useContract();
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');

  const handleTransfer = async () => {
    const tx = await contract.sendUnshielded({ 
      to: to as Address, 
      amount: BigInt(amount) 
    });
    await tx.wait();
    alert('Transfer complete!');
  };

  return (
    <div>
      <input 
        placeholder="Recipient Address" 
        value={to} 
        onChange={e => setTo(e.target.value)}
      />
      <input 
        placeholder="Amount" 
        value={amount} 
        onChange={e => setAmount(e.target.value)}
      />
      <button onClick={handleTransfer}>Send</button>
    </div>
  );
}
```

### Balance Display

```typescript
function Balance() {
  const { address } = useMidnightWallet();
  const { contract } = useContract();
  const [balance, setBalance] = useState<bigint>(0n);

  useEffect(() => {
    if (address && contract) {
      contract.getLedger(address).then(setBalance);
    }
  }, [address, contract]);

  return <div>Balance: {balance.toString()}</div>;
}
```

## Complete App

```typescript
function App() {
  return (
    <div className="app">
      <h1>Unshielded Token dApp</h1>
      <WalletConnect />
      <Balance />
      <MintTokens />
      <TransferTokens />
    </div>
  );
}
```

## Security Considerations

1. **Input Validation**: Always validate addresses and amounts
2. **Transaction Status**: Wait for confirmation before UI updates
3. **Error Handling**: Gracefully handle failed transactions
4. **State Synchronization**: Poll for balance updates

## Testing

Run the dApp locally:

```bash
npm run dev
```

Test on testnet:
```bash
npm run deploy:testnet
```

## Conclusion

You've built a complete unshielded token dApp! From here, you can:
- Explore shielded token implementation
- Add more token features (burning, pausing)
- Integrate with DeFi protocols

## Resources

- [Midnight Documentation](https://docs.midnight.example)
- [Compact Language Guide](https://docs.midnight.example/compact)
- [React SDK Reference](https://docs.midnight.example/react-sdk)
---
*Contributed by the community. For questions, open an issue or join our Discord.*
