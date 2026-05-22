## Integrating Midnight Proofs into an Existing Backend

**Difficulty:** Intermediate-Advanced  
**Time:** 30 minutes  
**Bounty:** #311

---

### Overview

You have an existing backend (Node.js, Python, Rust) and want to verify Midnight proofs without running a full Midnight node. This tutorial covers integrating proof verification into your server-side logic — useful for APIs, webhooks, and backend services.

### What You'll Learn

- Midnight proof verification without a full node
- Building a verification API endpoint
- Integrating with existing authentication
- Proof caching and batching for performance

### Architecture

```
Client dApp ──► Your Backend API
                     │
            ┌────────┴────────┐
            │  Verify Proof   │
            │  (Light client) │
            └────────┬────────┘
                     │
            ┌────────▼────────┐
            │  Midnight Node  │
            │  (Light query)  │
            └─────────────────┘
```

### Step 1: Install the Midnight Light Client

```bash
# Node.js
npm install @midnight-ntwrk/light-client

# Python
pip install midnight-light-client

# Rust (Cargo.toml)
# midnight-light-client = "0.1"
```

### Step 2: Node.js Verification Service

```typescript
// verification-service.ts
import { LightClient, ProofVerifier } from '@midnight-ntwrk/light-client';

interface VerificationRequest {
    proof: string;            // Base64-encoded proof
    contractAddress: string;  // Contract being verified against
    publicInputs: Record<string, any>;
    timestamp: number;
}

interface VerificationResult {
    valid: boolean;
    verifiedAt: number;
    error?: string;
}

export class ProofVerificationService {
    private client: LightClient;
    private verifier: ProofVerifier;
    private cache: Map<string, VerificationResult> = new Map();
    
    constructor(nodeUrl: string) {
        this.client = new LightClient({ nodeUrl });
        this.verifier = new ProofVerifier(this.client);
    }
    
    // Verify a single proof
    async verifyProof(request: VerificationRequest): Promise<VerificationResult> {
        // Check cache first (proofs are valid for same contract+inputs)
        const cacheKey = this.buildCacheKey(request);
        const cached = this.cache.get(cacheKey);
        if (cached && (Date.now() - cached.verifiedAt) < 60_000) {
            return cached;  // Return cached result (valid for 60s)
        }
        
        try {
            const result = await this.verifier.verify({
                proof: Buffer.from(request.proof, 'base64'),
                contractAddress: request.contractAddress,
                publicInputs: request.publicInputs,
            });
            
            const verification: VerificationResult = {
                valid: result.isValid,
                verifiedAt: Date.now(),
            };
            
            // Cache valid proofs
            if (result.isValid) {
                this.cache.set(cacheKey, verification);
            }
            
            return verification;
        } catch (error) {
            return {
                valid: false,
                verifiedAt: Date.now(),
                error: `Verification failed: ${error.message}`,
            };
        }
    }
    
    // Batch verification for multiple proofs at once
    async verifyBatch(requests: VerificationRequest[]): Promise<VerificationResult[]> {
        const results = await Promise.all(
            requests.map(r => this.verifyProof(r))
        );
        return results;
    }
    
    private buildCacheKey(request: VerificationRequest): string {
        return `${request.contractAddress}:${JSON.stringify(request.publicInputs)}`;
    }
}
```

### Step 3: Express API Middleware

```typescript
// api-middleware.ts
import express from 'express';
import { ProofVerificationService } from './verification-service';

const app = express();
const verifier = new ProofVerificationService(
    process.env.MIDNIGHT_NODE_URL || 'https://testnet.midnight.network'
);

app.use(express.json({ limit: '5mb' }));

// Verification endpoint
app.post('/api/verify-proof', async (req, res) => {
    try {
        const { proof, contractAddress, publicInputs, timestamp } = req.body;
        
        // Validate request
        if (!proof || !contractAddress) {
            return res.status(400).json({
                error: 'proof and contractAddress required'
            });
        }
        
        // Check timestamp recency (prevent replay attacks)
        const age = Date.now() - (timestamp || 0);
        if (age > 300_000) {  // 5 minutes
            return res.status(400).json({
                error: 'Proof too old, re-submit from dApp'
            });
        }
        
        const result = await verifier.verifyProof({
            proof,
            contractAddress,
            publicInputs: publicInputs || {},
            timestamp: timestamp || Date.now(),
        });
        
        res.json(result);
    } catch (error) {
        res.status(500).json({
            valid: false,
            error: `Internal error: ${error.message}`
        });
    }
});

// Batch verification
app.post('/api/verify-proofs/batch', async (req, res) => {
    try {
        const { proofs } = req.body;
        if (!Array.isArray(proofs) || proofs.length === 0) {
            return res.status(400).json({ error: 'proofs array required' });
        }
        
        const results = await verifier.verifyBatch(proofs);
        res.json({ results });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        verifierConnected: verifier.isConnected(),
        verifiedCount: verifier.getStats().totalVerified,
    });
});

app.listen(3001, () => {
    console.log('Proof verification API running on port 3001');
});
```

### Step 4: Python Backend Integration

```python
# verification_client.py
import time
import json
import hashlib
from typing import Optional, Dict, Any
from midnight_light_client import LightClient, ProofVerifier

class MidnightProofClient:
    """Python client for verifying Midnight proofs"""
    
    def __init__(self, node_url: str = "https://testnet.midnight.network"):
        self.client = LightClient(node_url)
        self.verifier = ProofVerifier(self.client)
        self._cache: Dict[str, dict] = {}
    
    def verify(
        self,
        proof_b64: str,
        contract_address: str,
        public_inputs: Optional[Dict] = None
    ) -> dict:
        """Verify a Midnight proof"""
        cache_key = self._cache_key(contract_address, public_inputs)
        
        # Check cache
        cached = self._cache.get(cache_key)
        if cached and (time.time() - cached['verified_at']) < 60:
            return cached
        
        try:
            import base64
            proof_bytes = base64.b64decode(proof_b64)
            
            result = self.verifier.verify(
                proof=proof_bytes,
                contract_address=contract_address,
                public_inputs=public_inputs or {}
            )
            
            response = {
                'valid': result['is_valid'],
                'verified_at': int(time.time() * 1000),
            }
            
            if result['is_valid']:
                self._cache[cache_key] = response
            
            return response
            
        except Exception as e:
            return {
                'valid': False,
                'verified_at': int(time.time() * 1000),
                'error': str(e),
            }
    
    def _cache_key(self, contract: str, inputs: Optional[Dict]) -> str:
        raw = f"{contract}:{json.dumps(inputs or {}, sort_keys=True)}"
        return hashlib.sha256(raw.encode()).hexdigest()


# FastAPI integration example
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()
proof_client = MidnightProofClient()

class ProofRequest(BaseModel):
    proof: str
    contract_address: str
    public_inputs: Optional[Dict] = {}
    timestamp: Optional[int] = None

@app.post("/verify")
async def verify_proof(request: ProofRequest):
    # Replay protection
    if request.timestamp and (time.time() * 1000 - request.timestamp) > 300_000:
        raise HTTPException(400, "Proof expired")
    
    result = proof_client.verify(
        request.proof,
        request.contract_address,
        request.public_inputs
    )
    
    if not result['valid']:
        raise HTTPException(400, f"Invalid proof: {result.get('error', 'unknown')}")
    
    return result
```

### Step 5: Auth Integration

Use proof verification as part of your auth flow:

```typescript
// auth-middleware.ts
import { Request, Response, NextFunction } from 'express';

interface AuthenticatedRequest extends Request {
    user?: {
        midnightAddress: string;
        verifiedAt: number;
    };
}

// Middleware: require valid Midnight proof for protected routes
export function requireMidnightProof(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
) {
    const proofHeader = req.headers['x-midnight-proof'] as string;
    const addressHeader = req.headers['x-midnight-address'] as string;
    
    if (!proofHeader || !addressHeader) {
        return res.status(401).json({
            error: 'Missing Midnight proof headers'
        });
    }
    
    // Verify proof asynchronously
    verifier.verifyProof({
        proof: proofHeader,
        contractAddress: addressHeader,
        publicInputs: { action: req.path, method: req.method },
        timestamp: Date.now(),
    }).then(result => {
        if (result.valid) {
            req.user = {
                midnightAddress: addressHeader,
                verifiedAt: result.verifiedAt,
            };
            next();
        } else {
            res.status(403).json({ error: 'Invalid proof' });
        }
    }).catch(err => {
        res.status(500).json({ error: 'Verification failed' });
    });
}

// Usage
app.post('/api/sensitive-action', requireMidnightProof, (req, res) => {
    // This route is protected by Midnight proof verification
    res.json({ 
        message: 'Action verified',
        user: req.user?.midnightAddress 
    });
});
```

### Performance Optimization

| Technique | Improvement | Trade-off |
|-----------|-------------|-----------|
| Proof caching | 10-50x faster repeated checks | 60s staleness window |
| Batch verification | Parallel verification | Higher memory usage |
| Light client | No full sync needed | Relies on node availability |
| Connection pooling | Reuse TCP connections | More complex setup |
| Proof compression | 30-50% smaller payloads | CPU overhead for compression |

### Step 6: Rust Backend (Bonus)

```rust
// src/verifier.rs
use midnight_light_client::{LightClient, ProofVerifier};

pub struct MidnightVerifier {
    client: LightClient,
    verifier: ProofVerifier,
}

impl MidnightVerifier {
    pub fn new(node_url: &str) -> Self {
        let client = LightClient::new(node_url);
        let verifier = ProofVerifier::new(&client);
        Self { client, verifier }
    }
    
    pub fn verify_proof(
        &self,
        proof: &[u8],
        contract: &str,
        inputs: &serde_json::Value,
    ) -> Result<bool, Box<dyn std::error::Error>> {
        let result = self.verifier.verify(
            proof,
            contract,
            inputs,
        )?;
        Ok(result.is_valid)
    }
}
```

### Summary

- Light client verification works without running a full node
- Expose a REST API for proof verification from any client
- Cache valid proofs with short TTL for performance
- Use proof verification as auth middleware
- Python, Node.js, and Rust are all supported
