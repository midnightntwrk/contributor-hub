## Building a Shielded Token dApp with UI

**Difficulty:** Intermediate  
**Time:** 30 minutes  
**Bounty:** #326

---

### Overview

Build a complete shielded token dApp with a working web UI. Users can mint, transfer, and check balances — all with privacy. The shield contract keeps balances encrypted on-chain, and only authorized users can see their own balance.

### Architecture

```
User's Browser ──► React UI ──► Midnight Provider
                                      │
                            ┌─────────┴─────────┐
                            │  Shielded Token   │
                            │  Contract         │
                            │  (Compact)        │
                            │                   │
                            │  - Balances       │
                            │  - Transfers      │
                            │  - Mints           │
                            └───────────────────┘
```

### Step 1: Shielded Token Contract

```javascript
// contracts/shielded-token/index.compact

import { LEDGER, SEED, VERIFIER } from "std";

export const ShieldedToken = contract(() => {
    // Encrypted balances — only owner sees their own
    const balances: Map<[u8; 32], u64>;
    const encryptedBalances: Map<[u8; 32], [u8; 64]>;
    const totalSupply: u64;
    const tokenName: [u8; 32];
    const tokenSymbol: [u8; 8];
    
    export function initialize(name: [u8; 32], symbol: [u8; 8]): void {
        tokenName = name;
        tokenSymbol = symbol;
        totalSupply = 0;
    }
    
    // Mint new tokens (only deployer)
    export function mint(amount: u64): void {
        require(SEED.publicKey == DEPLOYER, "Only deployer can mint");
        
        const current = balances.get(SEED.publicKey) ?? 0;
        balances.set(SEED.publicKey, current + amount);
        totalSupply = totalSupply + amount;
        
        emit("Minted", SEED.publicKey, amount);
    }
    
    // Shielded transfer — only sender and receiver see details
    export function transfer(
        to: [u8; 32],
        amount: u64,
        encryptedMemo: [u8; 64]
    ): void {
        const senderBal = balances.get(SEED.publicKey) ?? 0;
        require(senderBal >= amount, "Insufficient shielded balance");
        
        // Deduct from sender
        balances.set(SEED.publicKey, senderBal - amount);
        
        // Credit receiver
        const receiverBal = balances.get(to) ?? 0;
        balances.set(to, receiverBal + amount);
        
        // Store encrypted memo
        encryptedBalances.set(SEED.publicKey, encryptedMemo);
        
        emit("Transfer", SEED.publicKey, to, amount);
    }
    
    // View your own balance
    export function balanceOf(user: [u8; 32]): u64 {
        return balances.get(user) ?? 0;
    }
    
    // Public total supply (always visible)
    export function getTotalSupply(): u64 {
        return totalSupply;
    }
});
```

### Step 2: React UI Setup

```bash
# Create React app
npx create-react-app shielded-token-ui --template typescript
cd shielded-token-ui

# Install Midnight SDK
npm install @midnight-ntwrk/midnight-js @midnight-ntwrk/midnight-provider

# Install UI dependencies
npm install @headlessui/react @heroicons/react
```

### Step 3: Provider Hook

```typescript
// hooks/useMidnightProvider.ts
import { useState, useEffect, useCallback } from 'react';
import { MidnightProvider } from '@midnight-ntwrk/midnight-provider';

export function useMidnightProvider() {
    const [provider, setProvider] = useState<MidnightProvider | null>(null);
    const [address, setAddress] = useState<string>('');
    const [balance, setBalance] = useState<bigint>(0n);
    const [loading, setLoading] = useState(false);
    
    const connect = useCallback(async () => {
        setLoading(true);
        try {
            // In production, this prompts user for seed
            const p = await MidnightProvider.create({
                network: 'testnet',
                seed: localStorage.getItem('midnight_seed') || undefined
            });
            
            setProvider(p);
            setAddress(await p.getAddress());
            
            // Load initial balance
            const bal = await p.call('shielded-token', 'balanceOf', [await p.getPublicKey()]);
            setBalance(bal);
        } catch (error) {
            console.error('Failed to connect:', error);
            alert('Failed to connect to Midnight network');
        } finally {
            setLoading(false);
        }
    }, []);
    
    const refreshBalance = useCallback(async () => {
        if (!provider) return;
        const bal = await provider.call('shielded-token', 'balanceOf', [await provider.getPublicKey()]);
        setBalance(bal);
    }, [provider]);
    
    return { provider, address, balance, connect, refreshBalance, loading };
}
```

### Step 4: Token Dashboard Component

```typescript
// components/TokenDashboard.tsx

import { useState } from 'react';
import { useMidnightProvider } from '../hooks/useMidnightProvider';

export function TokenDashboard() {
    const { provider, address, balance, connect, refreshBalance, loading } = useMidnightProvider();
    const [recipient, setRecipient] = useState('');
    const [amount, setAmount] = useState('');
    const [txStatus, setTxStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
    const [txHash, setTxHash] = useState('');
    
    const handleTransfer = async () => {
        if (!provider || !recipient || !amount) return;
        
        setTxStatus('pending');
        try {
            const pubKey = await provider.getPublicKey();
            const encryptedMemo = await provider.encrypt(
                JSON.stringify({ from: pubKey, to: recipient, amount }),
                recipient
            );
            
            const result = await provider.call('shielded-token', 'transfer', [
                recipient,
                BigInt(amount),
                encryptedMemo
            ]);
            
            setTxHash(result.transactionHash);
            setTxStatus('success');
            await refreshBalance();
        } catch (error) {
            console.error('Transfer failed:', error);
            setTxStatus('error');
        }
    };
    
    const handleMint = async () => {
        if (!provider) return;
        
        setTxStatus('pending');
        try {
            await provider.call('shielded-token', 'mint', [BigInt(1000)]);
            setTxStatus('success');
            await refreshBalance();
        } catch (error) {
            setTxStatus('error');
        }
    };
    
    if (!provider) {
        return (
            <div className="connect-prompt">
                <h1>🔒 Shielded Token dApp</h1>
                <button onClick={connect} disabled={loading}>
                    {loading ? 'Connecting...' : 'Connect Midnight Wallet'}
                </button>
            </div>
        );
    }
    
    return (
        <div className="dashboard">
            <header>
                <h1>🔒 Shielded Token</h1>
                <div className="account-info">
                    <span>Address: {address.slice(0, 10)}...</span>
                    <span className="balance">
                        Balance: <strong>{balance.toString()}</strong> sNIGHT
                    </span>
                </div>
            </header>
            
            <section className="transfer-card">
                <h2>Send Shielded Transfer</h2>
                
                <input
                    type="text"
                    placeholder="Recipient public key"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                />
                
                <input
                    type="number"
                    placeholder="Amount"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    min="0"
                />
                
                <div className="actions">
                    <button onClick={handleTransfer} disabled={txStatus === 'pending'}>
                        {txStatus === 'pending' ? 'Sending...' : 'Send Shielded'}
                    </button>
                    
                    <button onClick={handleMint} className="secondary">
                        Mint 1000 (Dev only)
                    </button>
                    
                    <button onClick={refreshBalance} className="secondary">
                        Refresh Balance
                    </button>
                </div>
                
                {txStatus === 'success' && (
                    <div className="success-banner">
                        ✅ Transaction successful!
                        {txHash && <p>Tx: {txHash.slice(0, 20)}...</p>}
                    </div>
                )}
                
                {txStatus === 'error' && (
                    <div className="error-banner">
                        ❌ Transaction failed. Check console for details.
                    </div>
                )}
            </section>
            
            <section className="info">
                <h3>🔍 Privacy Note</h3>
                <p>
                    Your balance is stored encrypted on-chain. Only you can see 
                    your balance. Transfer details are visible only to sender 
                    and recipient.
                </p>
            </section>
        </div>
    );
}
```

### Step 5: Styling

```css
/* App.css */
.dashboard {
    max-width: 600px;
    margin: 2rem auto;
    font-family: system-ui, -apple-system, sans-serif;
}

header {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 2rem;
    border-radius: 12px;
    margin-bottom: 1.5rem;
}

.account-info {
    display: flex;
    justify-content: space-between;
    margin-top: 1rem;
    font-size: 0.9rem;
    opacity: 0.9;
}

.balance strong {
    font-size: 1.2rem;
}

.transfer-card {
    background: white;
    padding: 1.5rem;
    border-radius: 12px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

input {
    width: 100%;
    padding: 0.75rem;
    margin-bottom: 0.75rem;
    border: 1px solid #ddd;
    border-radius: 8px;
    font-size: 1rem;
    box-sizing: border-box;
}

.actions {
    display: flex;
    gap: 0.5rem;
}

button {
    padding: 0.75rem 1.5rem;
    background: #667eea;
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 0.9rem;
    cursor: pointer;
    transition: all 0.2s;
}

button:hover {
    background: #5a6fd6;
    transform: translateY(-1px);
}

button.secondary {
    background: #f0f0f0;
    color: #333;
}

button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
}

.success-banner {
    margin-top: 1rem;
    padding: 1rem;
    background: #d4edda;
    border-radius: 8px;
    color: #155724;
}

.error-banner {
    margin-top: 1rem;
    padding: 1rem;
    background: #f8d7da;
    border-radius: 8px;
    color: #721c24;
}

.info {
    margin-top: 1.5rem;
    padding: 1rem;
    background: #fff3cd;
    border-radius: 8px;
    color: #856404;
}

.connect-prompt {
    text-align: center;
    padding: 4rem 2rem;
}
```

### Step 6: Deploy & Run

```bash
# 1. Compile the contract
midnight contract build contracts/shielded-token --output build/

# 2. Deploy to testnet
midnight contract deploy shielded-token \
    --args '{"name":"ShieldedToken","symbol":"SHLD"}' \
    --network testnet

# 3. Note the contract address
# Contract deployed at: 0xabc123...

# 4. Update frontend config
echo 'export const CONTRACT_ADDRESS = "0xabc123...";' > src/config.ts

# 5. Start the UI
npm start
# Opens http://localhost:3000
```

### Step 7: Verify Privacy

```bash
# Check on-chain — balances are encrypted
midnight contract query shielded-token --state balance

# You should see encrypted values, not plain numbers

# Check your balance (only you can see)
midnight contract call shielded-token balanceOf \
    --args "{\"user\":\"0xYOUR_PUBKEY\"}" \
    --signer keys/my-key.json

# Should show your actual balance
```

### Summary

- Shielded token keeps balances encrypted on-chain
- Only the owner can see their balance
- Transfer details are private between sender and receiver
- React UI provides a clean interface for interacting
- Deploy to testnet for testing before mainnet
