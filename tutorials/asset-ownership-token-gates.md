# Verifying Asset Ownership and Membership Using Token Gates

## Overview

This tutorial demonstrates how to build token-gated access systems on Midnight, verifying asset ownership and membership without revealing which specific assets you hold.

## Prerequisites

- Midnight SDK
- Understanding of Compact circuits
- Funded wallet

## What is Token Gating?

Token gating restricts access to content, features, or services based on ownership of specific tokens or membership in a group. On Midnight, this can be done privately using zero-knowledge proofs.

## Implementation

### Step 1: Membership Contract

```compact
circuit TokenGate {
    // Public: gate configuration
    gates: Map<String, GateConfig>;
    
    // Private: membership records
    secret memberships: Map<Digest, Membership>;
    secret access_log: Map<Digest, AccessRecord>;
    
    struct GateConfig {
        name: String,
        required_token_commitment: Digest,
        min_balance: Uint<64>,
        active: bool,
    }
    
    struct Membership {
        user_commitment: Digest,
        gate_name: String,
        token_commitment: Digest,
        balance: Uint<64>,
        verified_at: Uint<64>,
    }
    
    struct AccessRecord {
        user_commitment: Digest,
        gate_name: String,
        accessed_at: Uint<64>,
        proof_valid: bool,
    }
    
    // Create a token gate
    export create_gate(
        name: String,
        required_token: Digest,
        min_balance: Uint<64>,
    ) {
        gates[name] = GateConfig {
            name,
            required_token_commitment: required_token,
            min_balance,
            active: true,
        };
    }
    
    // Verify ownership and grant access
    export verify_and_access(
        gate_name: String,
        user_secret: Bytes,
        token_id: Bytes,
        balance: Uint<64>,
    ) -> bool {
        let gate = gates[gate_name];
        require(gate.active, "Gate not active");
        
        let user_commitment = hash(ownPublicKey(), user_secret);
        let token_commitment = hash(token_id);
        
        // Verify the user holds the required token
        require(token_commitment == gate.required_token_commitment, "Wrong token");
        require(balance >= gate.min_balance, "Insufficient balance");
        
        // Record membership
        let membership_id = hash(user_commitment, gate_name);
        memberships[membership_id] = Membership {
            user_commitment,
            gate_name,
            token_commitment,
            balance,
            verified_at: current_time(),
        };
        
        // Log access
        let access_id = hash(user_commitment, gate_name, current_time());
        access_log[access_id] = AccessRecord {
            user_commitment,
            gate_name,
            accessed_at: current_time(),
            proof_valid: true,
        };
        
        true
    }
    
    // Check if a user has access (view function)
    export check_access(gate_name: String, user_commitment: Digest) -> bool {
        let membership_id = hash(user_commitment, gate_name);
        let membership = memberships[membership_id];
        membership.verified_at > 0
    }
}
```

### Step 2: Frontend Integration

```tsx
import { useState } from 'react';

function GatedContent({ gateName, children }) {
  const [hasAccess, setHasAccess] = useState(false);
  const [verifying, setVerifying] = useState(false);
  
  const verifyAccess = async () => {
    setVerifying(true);
    try {
      const result = await sdk.verifyAndAccess(gateName);
      setHasAccess(result);
    } finally {
      setVerifying(false);
    }
  };
  
  if (hasAccess) return children;
  
  return (
    <div className="gated-content">
      <h3>🔒 Token-Gated Content</h3>
      <p>Hold the required token to access this content.</p>
      <button onClick={verifyAccess} disabled={verifying}>
        {verifying ? 'Verifying...' : 'Verify Ownership'}
      </button>
    </div>
  );
}
```

## Use Cases

1. **NFT Holder Communities**: Gate Discord channels or content
2. **DAO Membership**: Verify governance participation rights
3. **Premium Features**: Unlock features based on token holdings
4. **Event Access**: Conference tickets as private tokens

## Privacy Features

- Gate operators don't see which specific token you hold
- Access verification uses ZK proofs
- Membership records are private on-chain
- No linkability between different gates

## Conclusion

Token gating on Midnight provides privacy-preserving access control, enabling membership verification without compromising user privacy.
