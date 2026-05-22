## Reading and Reacting to Contract State from a Frontend

**Difficulty:** Intermediate  
**Time:** 20 minutes  
**Bounty:** #310

---

### Overview

Your Midnight contract has state — balances, approvals, settings. But how does your frontend read that state and react to changes? Unlike public blockchains where you can query any contract, Midnight's private state needs special handling. This tutorial covers reading both public and private state from a browser dApp.

### What You'll Learn

- Querying public contract state
- Reading private state (visible to authorized parties only)
- Subscribing to state changes in real-time
- Building reactive UI components

### Architecture

```
Browser dApp ──► Midnight Provider ──► Midnight Node
                     │                        │
            ┌────────┴────────┐      ┌────────┴────────┐
            │  Public State   │      │  Private State  │
            │  (Direct query) │      │  (ZKP query)    │
            └─────────────────┘      └─────────────────┘
```

### Step 1: Setup Provider

```typescript
// state-client.ts
import { createProvider } from '@midnight-ntwrk/midnight-js';
import { MidnightProvider } from '@midnight-ntwrk/midnight-provider';

export async function setupProvider(): Promise<MidnightProvider> {
    const provider = await createProvider({
        network: 'testnet',
        seed: loadFromSession(),  // or prompt user
    });
    
    console.log(`Connected: ${await provider.getPublicKey()}`);
    return provider;
}
```

### Step 2: Read Public State

Public state includes committed values that anyone can query:

```typescript
// query-public-state.ts
import { MidnightProvider } from '@midnight-ntwrk/midnight-provider';

export class PublicStateReader {
    private provider: MidnightProvider;
    
    constructor(provider: MidnightProvider) {
        this.provider = provider;
    }
    
    // Read a public state variable by name
    async readPublicState(
        contractAddress: string,
        stateKey: string
    ): Promise<any> {
        const state = await this.provider.queryContractState(
            contractAddress,
            'public'
        );
        return state?.[stateKey];
    }
    
    // Get contract metadata
    async getContractInfo(contractAddress: string) {
        return await this.provider.getContractMetadata(contractAddress);
    }
    
    // Monitor a public state variable
    async watchPublicState(
        contractAddress: string,
        stateKey: string,
        callback: (value: any) => void
    ): Promise<() => void> {
        // Poll every 5 seconds
        const interval = setInterval(async () => {
            try {
                const value = await this.readPublicState(
                    contractAddress, 
                    stateKey
                );
                callback(value);
            } catch (e) {
                console.warn('Poll failed:', e);
            }
        }, 5000);
        
        return () => clearInterval(interval);  // unsubscribe
    }
}
```

### Step 3: Read Private State

Private state requires a zero-knowledge proof that you're authorized:

```typescript
// query-private-state.ts

export class PrivateStateReader {
    private provider: MidnightProvider;
    
    constructor(provider: MidnightProvider) {
        this.provider = provider;
    }
    
    // Read private state (requires party authorization)
    async readPrivateState(
        contractAddress: string,
        stateKey: string,
        partySecret: string
    ): Promise<any> {
        // Generate ZKP proving you're an authorized party
        const proof = await this.provider.generateAuthProof(
            contractAddress,
            partySecret
        );
        
        // Submit proof and get decrypted state
        const state = await this.provider.queryContractState(
            contractAddress,
            'private',
            { proof }
        );
        
        return state?.[stateKey];
    }
    
    // Subscribe to private state changes
    async subscribePrivateState(
        contractAddress: string,
        stateKey: string,
        partySecret: string,
        callback: (value: any) => void
    ): Promise<() => void> {
        // Listen for events from the contract
        const unsubscribe = await this.provider.subscribeToEvents(
            contractAddress,
            (event) => {
                if (event.name === 'StateChanged' && event.data.key === stateKey) {
                    callback(event.data.newValue);
                }
            }
        );
        
        return unsubscribe;
    }
}
```

### Step 4: Watch All State

A comprehensive watcher that handles both public and private state:

```typescript
// contract-watcher.ts

interface StateWatcher {
    contractAddress: string;
    publicKeys: string[];
    privateKeys: string[];
    partySecret?: string;
}

export class ContractWatcher {
    private watchers: Map<string, () => void> = new Map();
    private publicReader: PublicStateReader;
    private privateReader?: PrivateStateReader;
    
    constructor(private provider: MidnightProvider) {
        this.publicReader = new PublicStateReader(provider);
    }
    
    async watchContract(config: StateWatcher) {
        const { contractAddress, publicKeys, privateKeys, partySecret } = config;
        
        console.log(`Watching ${contractAddress}...`);
        
        // Watch public state
        for (const key of publicKeys) {
            const unsub = await this.publicReader.watchPublicState(
                contractAddress,
                key,
                (value) => this.onStateChange(contractAddress, key, value)
            );
            this.watchers.set(`public:${contractAddress}:${key}`, unsub);
        }
        
        // Watch private state (if authorized)
        if (partySecret && this.privateReader) {
            for (const key of privateKeys) {
                const unsub = await this.privateReader.subscribePrivateState(
                    contractAddress,
                    key,
                    partySecret,
                    (value) => this.onStateChange(contractAddress, key, value, true)
                );
                this.watchers.set(`private:${contractAddress}:${key}`, unsub);
            }
        }
    }
    
    private onStateChange(
        address: string,
        key: string,
        value: any,
        isPrivate = false
    ) {
        const prefix = isPrivate ? '🔒' : '🔓';
        console.log(`${prefix} ${key} changed:`, value);
        
        // Dispatch DOM event for UI updates
        window.dispatchEvent(new CustomEvent('midnight-state-change', {
            detail: { address, key, value, isPrivate }
        }));
    }
    
    stopWatching(contractAddress: string) {
        for (const [key, unsub] of this.watchers) {
            if (key.includes(contractAddress)) {
                unsub();
                this.watchers.delete(key);
            }
        }
    }
}
```

### Step 5: React Component

```typescript
// ContractDashboard.tsx
import { useEffect, useState, useCallback } from 'react';

interface ContractDashboardProps {
    contractAddress: string;
}

export function ContractDashboard({ contractAddress }: ContractDashboardProps) {
    const [publicState, setPublicState] = useState<Record<string, any>>({});
    const [privateState, setPrivateState] = useState<Record<string, any>>({});
    const [loading, setLoading] = useState(true);
    
    useEffect(() => {
        const handler = (event: CustomEvent) => {
            const { address, key, value, isPrivate } = event.detail;
            
            if (address !== contractAddress) return;
            
            if (isPrivate) {
                setPrivateState(prev => ({ ...prev, [key]: value }));
            } else {
                setPublicState(prev => ({ ...prev, [key]: value }));
            }
        };
        
        window.addEventListener(
            'midnight-state-change',
            handler as EventListener
        );
        
        return () => window.removeEventListener(
            'midnight-state-change',
            handler as EventListener
        );
    }, [contractAddress]);
    
    const refreshState = useCallback(async () => {
        setLoading(true);
        try {
            // Trigger manual refresh
            const event = new CustomEvent('midnight-refresh', {
                detail: { contractAddress }
            });
            window.dispatchEvent(event);
        } finally {
            setLoading(false);
        }
    }, [contractAddress]);
    
    return (
        <div className="contract-dashboard">
            <h2>Contract: {contractAddress.slice(0, 10)}...</h2>
            <button onClick={refreshState} disabled={loading}>
                {loading ? 'Refreshing...' : 'Refresh'}
            </button>
            
            <section>
                <h3>🔓 Public State</h3>
                <pre>{JSON.stringify(publicState, null, 2)}</pre>
            </section>
            
            <section>
                <h3>🔒 Private State (yours only)</h3>
                <pre>{JSON.stringify(privateState, null, 2)}</pre>
            </section>
        </div>
    );
}
```

### Key APIs

| API | Purpose | Returns |
|-----|---------|---------|
| `queryContractState(address, 'public')` | Read committed state | Plain JSON |
| `queryContractState(address, 'private', proof)` | Read your private state | Decrypted JSON |
| `getContractMetadata(address)` | Contract info & parties | Metadata object |
| `subscribeToEvents(address, handler)` | Real-time event stream | Unsubscribe fn |
| `generateAuthProof(address, secret)` | ZKP for private access | Proof bytes |

### Best Practices

1. **Poll vs Subscribe** — Use `subscribeToEvents` for real-time, fall back to polling for reliability
2. **Cache State** — Don't re-query on every render; cache and update incrementally
3. **Error Handling** — Private state queries can fail if you're not authorized; always catch errors
4. **Batch Queries** — Group multiple state reads into one call when possible
5. **Disconnect** — Always unsubscribe when components unmount

### Summary

- Public state is queried directly from the contract
- Private state requires ZKP authentication
- Use event subscriptions for real-time updates
- Build reactive UIs with the window event pattern or state management
