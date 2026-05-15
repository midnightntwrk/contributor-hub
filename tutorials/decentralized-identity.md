# Building Decentralized Identity (DIDs) with Midnight

## Overview

This tutorial covers building a Decentralized Identity (DID) system on Midnight, leveraging zero-knowledge proofs for privacy-preserving identity verification.

## Prerequisites

- Midnight SDK (`@midnight-ntwrk/midnight-js`)
- Funded Midnight wallet
- Understanding of Compact circuits

## Core Concepts

### What are DIDs on Midnight?

Decentralized Identifiers on Midnight enable:
- Self-sovereign identity without centralized authorities
- Selective disclosure of identity attributes
- Zero-knowledge proofs of identity claims
- Privacy-preserving authentication

## Step 1: Identity Contract

Create `identity.mid`:

```compact
circuit IdentityRegistry {
    // Public: DID to commitment mapping
    did_registry: Map<String, Digest>;
    
    // Private: Identity attributes
    secret identities: Map<Digest, Identity>;
    secret credentials: Map<Digest, Credential>;
    
    struct Identity {
        did: String,
        attributes: Map<String, Digest>,  // attribute name -> commitment
        created_at: Uint<64>,
        active: bool,
    }
    
    struct Credential {
        issuer_did: String,
        subject_did: String,
        claim_type: String,
        claim_value_hash: Digest,
        issued_at: Uint<64>,
        revoked: bool,
    }
    
    // Create a new DID
    export create_did(did: String, secret_key: Bytes) -> Digest {
        require(!did_registry[did], "DID already exists");
        let commitment = hash(did, secret_key);
        did_registry[did] = commitment;
        
        identities[commitment] = Identity {
            did,
            attributes: Map::new(),
            created_at: current_time(),
            active: true,
        };
        commitment
    }
    
    // Issue a verifiable credential
    export issue_credential(
        issuer_secret: Bytes,
        subject_did: String,
        claim_type: String,
        claim_value: Bytes,
    ) -> Digest {
        let issuer_commitment = did_registry[ownPublicKey()];
        let issuer = identities[issuer_commitment];
        require(issuer.active, "Issuer not active");
        
        let credential_id = hash(subject_did, claim_type, issuer.did);
        credentials[credential_id] = Credential {
            issuer_did: issuer.did,
            subject_did,
            claim_type,
            claim_value_hash: hash(claim_value),
            issued_at: current_time(),
            revoked: false,
        };
        credential_id
    }
    
    // Verify a credential (zero-knowledge)
    export verify_credential(
        credential_id: Digest,
        expected_claim_type: String,
    ) -> bool {
        let cred = credentials[credential_id];
        require(!cred.revoked, "Credential revoked");
        cred.claim_type == expected_claim_type
    }
    
    // Selective disclosure: prove an attribute without revealing it
    export prove_attribute_range(
        did: String,
        attribute_name: String,
        secret_key: Bytes,
        min_value: Uint<64>,
        max_value: Uint<64>,
        actual_value: Uint<64>,
    ) -> bool {
        let commitment = did_registry[did];
        let identity = identities[commitment];
        require(identity.active, "Identity not active");
        
        // Verify the prover knows the secret
        require(commitment == hash(did, secret_key), "Invalid proof of identity");
        
        // Range proof (simplified)
        actual_value >= min_value && actual_value <= max_value
    }
}
```

## Step 2: TypeScript SDK

```typescript
import { initialize } from '@midnight-ntwrk/midnight-js';

export class IdentitySDK {
  private wallet;
  
  constructor(wallet: any) {
    this.wallet = wallet;
  }
  
  async createDID(did: string, secretKey: Uint8Array) {
    return this.wallet.execute(
      IdentityRegistry.create_did(did, secretKey)
    );
  }
  
  async issueCredential(
    subjectDid: string,
    claimType: string,
    claimValue: Uint8Array,
  ) {
    return this.wallet.execute(
      IdentityRegistry.issue_credential(subjectDid, claimType, claimValue)
    );
  }
  
  async verifyCredential(credentialId: string, expectedType: string) {
    return this.wallet.query(
      IdentityRegistry.verify_credential(credentialId, expectedType)
    );
  }
  
  async proveAgeRange(did: string, minAge: number, maxAge: number, actualAge: number) {
    const secretKey = this.getStoredSecret(did);
    return this.wallet.execute(
      IdentityRegistry.prove_attribute_range(
        did, 'age', secretKey, minAge, maxAge, actualAge
      )
    );
  }
}
```

## Step 3: Use Cases

### Age Verification
Prove you are over 18 without revealing your exact age:

```typescript
const result = await sdk.proveAgeRange('did:midnight:alice', 18, 150, actualAge);
// Result: true/false, without revealing actualAge
```

### KYC Without Data Sharing
Verify identity attributes through a trusted issuer without exposing raw data.

### Anonymous Authentication
Login to services using ZK proofs of valid credentials.

## Privacy Benefits

- **No central authority**: Identity is self-managed
- **Selective disclosure**: Share only what's needed
- **Revocable credentials**: Issuers can revoke without accessing holder data
- **Cross-service portability**: One DID works across all Midnight dApps

## Conclusion

Midnight's privacy primitives make it ideal for building DID systems that protect user privacy while enabling verifiable identity claims.
