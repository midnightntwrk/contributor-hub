# Building Decentralized Identity (DIDs) with Midnight Network

## Introduction

Decentralized Identity (DID) represents a paradigm shift in how we manage digital identities. Unlike traditional identity systems controlled by centralized authorities, DIDs empower individuals with full control over their personal data. This tutorial demonstrates how to build a complete decentralized identity system using Midnight Network\'s privacy-preserving infrastructure.

Midnight Network provides a unique advantage for identity systems: zero-knowledge proofs that allow verification without revealing sensitive data. This is crucial for identity management where privacy is paramount.

## What You Will Build

In this tutorial, you will create:
1. A DID document generator and manager
2. A verifiable credential system  
3. Zero-knowledge proof integration for selective disclosure
4. A complete identity wallet application

## Prerequisites

- Node.js 18+ installed
- Basic understanding of blockchain concepts
- Familiarity with TypeScript
- Midnight Network testnet access

## Part 1: Understanding DIDs on Midnight

### What is a DID?

A Decentralized Identifier (DID) is a globally unique identifier that enables verifiable, decentralized digital identity. According to the W3C specification, a DID has the format: `did:midnight:<unique-identifier>`

### Why Midnight for Identity?

Midnight Network offers several advantages for identity systems:

- **Zero-knowledge proofs**: Verify attributes without revealing data
- **Privacy by default**: Built-in privacy features  
- **Regulatory compliance**: Designed with compliance in mind
- **Interoperability**: Compatible with existing DID standards

## Part 2: Setting Up the Development Environment

### Step 1: Initialize the Project

```bash
mkdir midnight-did-system && cd midnight-did-system
npm init -y
npm install @midnight-ntwrk/did-sdk typescript @types/node zod dotenv
```

### Step 2: Configure TypeScript

Create `tsconfig.json` with ES2022 target, commonjs modules, strict mode enabled, and output directed to `./dist` with source maps and declarations.

## Part 3: Core DID Implementation

### Step 3: Create the DID Manager

Create `src/did-manager.ts` with the following components:

**Interfaces:**

- `DIDDocument` - Contains context, id, created/updated timestamps, verification methods, authentication references, assertion methods, capability delegation, and service endpoints
- `VerificationMethod` - Contains id, type (Ed25519VerificationKey2020), controller, and publicKeyMultibase
- `ServiceEndpoint` - Contains id, type, and serviceEndpoint URL

**DIDManager Class Methods:**

- `createDID(userId)` - Generates a unique identifier using `crypto.randomBytes(16)`, creates the DID string `did:midnight:<hex>`, generates an Ed25519 key pair, and assembles the full DID Document per W3C spec
- `resolveDID(did)` - Looks up and returns the DID Document from the in-memory store
- `updateDID(did, updates)` - Merges partial updates into an existing DID Document and updates the timestamp
- `deactivateDID(did)` - Removes the DID Document and associated keys from storage
- `addService(did, service)` - Appends a new service endpoint to an existing DID Document

The key generation uses the Midnight SDK `generateKeyPair()` function which produces Ed25519 keys suitable for DID authentication and assertion.

## Part 4: Verifiable Credentials

### Step 4: Implement Credential System

Create `src/credential-manager.ts` with:

**Interfaces:**

- `VerifiableCredential` - W3C-compliant credential with context, id, type array, issuer DID, issuance/expiration dates, credential subject, and cryptographic proof
- `CredentialSubject` - Contains the subject DID and arbitrary claims
- `Proof` - Contains proof type, creation timestamp, verification method reference, proof purpose, and the proof value
- `Presentation` - Wraps multiple credentials for presenting to a verifier

**CredentialManager Class Methods:**

- `issueCredential(issuerDID, subjectDID, claims, expirationDays)` - Creates a W3C VerifiableCredential with UUID identifier, sets issuance date, optionally sets expiration, attaches claims to the credential subject, and generates an Ed25519Signature2020 proof
- `verifyCredential(credential)` - Checks expiration date, resolves the issuer DID, finds the verification method, and validates the proof
- `createPresentation(holderDID, credentialIds)` - Bundles selected credentials into a VerifiablePresentation with a holder proof

The credential type includes both `VerifiableCredential` and `MidnightIdentityCredential` to indicate it was issued through the Midnight ecosystem.

## Part 5: Zero-Knowledge Proofs for Selective Disclosure

### Step 5: Implement ZK Proofs

Create `src/zk-proof.ts` with:

**Interfaces:**

- `ZKProof` - Contains type (MidnightZKProof2024), timestamps, verification method, proof purpose, proof value, and lists of revealed vs hidden attributes
- `AttributeProof` - Per-attribute proof with name, value (null if hidden), revelation status, and cryptographic commitment

**ZKProofManager Class Methods:**

- `generateSelectiveDisclosureProof(didDoc, attributes, revealedAttributes)` - The core privacy feature. Takes a set of attributes and a list of which ones to reveal. For each attribute, creates a commitment. Only revealed attributes have their actual values included; hidden attributes get null values but still have commitments proving they exist
- `verifyZKProof(proof, expectedAttributes)` - Validates that revealed attributes match expected values and that the proof structure is valid

**How Selective Disclosure Works:**

1. Alice has credentials with: degree, major, graduationYear, gpa
2. Alice wants to prove she has a degree without revealing her GPA
3. She generates a ZK proof revealing only: degree, major, graduationYear
4. The verifier can confirm these attributes are valid
5. The GPA remains hidden but its existence is cryptographically committed

This is the key privacy feature of Midnight Network - users control exactly what information they share.

## Part 6: Complete Application

### Step 6: Build the Main Application

Create `src/app.ts` demonstrating the full workflow:

1. **Create DIDs** - Generate DIDs for Alice, Bob, and a University issuer
2. **Issue Credentials** - University issues a degree credential to Alice with degree, major, graduation year, and GPA
3. **Verify Credentials** - Validate the issued credential cryptographically
4. **Selective Disclosure** - Alice generates a ZK proof revealing degree info but hiding GPA
5. **Verify ZK Proof** - A verifier checks the proof confirms the revealed attributes
6. **Create Presentation** - Alice bundles her credential into a verifiable presentation
7. **Add Services** - Alice adds a DecentralizedWebNode service endpoint to her DID

## Part 7: Running the Application

Compile and run:
```bash
npx tsc
node dist/app.js
```

Expected output shows each step completing successfully with DIDs created, credentials issued and verified, ZK proofs generated with selective attributes, and presentations created.

## Part 8: Production Considerations

### Security Best Practices

1. **Key Management** - Use hardware security modules (HSMs) for key storage
2. **Encryption** - Encrypt all sensitive data at rest and in transit
3. **Access Control** - Implement proper access control mechanisms
4. **Audit Logging** - Log all identity operations for compliance

### Scalability

1. **Caching** - Implement caching for frequently accessed DIDs
2. **Indexing** - Use database indexing for efficient lookups
3. **Load Balancing** - Distribute load across multiple nodes

### Compliance

1. **GDPR** - Implement right to erasure capabilities
2. **KYC/AML** - Integrate with compliance checks
3. **Data Minimization** - Only collect necessary attributes

## Architecture Overview

The system follows a layered architecture:

```
Application Layer (app.ts)
    |
    v
Credential Layer (credential-manager.ts)
    |
    v
Identity Layer (did-manager.ts)
    |
    v
Privacy Layer (zk-proof.ts)
    |
    v
Midnight Network (blockchain/crypto)
```

Each layer builds on the one below, with the Midnight Network providing the cryptographic foundations.

## Use Cases

This decentralized identity system can be applied to:

- **Academic Credentials** - Universities issue verifiable degrees and transcripts
- **Professional Certifications** - Bodies issue licenses that employers can verify
- **Healthcare Records** - Patients control access to medical history
- **Government IDs** - Digital driver licenses and national IDs
- **Financial Credentials** - KYC verification without sharing raw documents
- **Employment Verification** - Prove employment without revealing salary

## Extending the System

To extend this system for production:

1. Add persistent storage (PostgreSQL, MongoDB)
2. Implement DID resolution over the network (DID resolver)
3. Add support for multiple key types (RSA, BBS+)
4. Implement revocation registries
5. Add wallet UI with QR code scanning
6. Integrate with existing DID networks (ION, Sidetree)
7. Add support for DIDComm messaging

## Conclusion

This tutorial demonstrated how to build a complete decentralized identity system using Midnight Network. Key takeaways:

1. **DIDs provide self-sovereign identity** - Users control their own identifiers without relying on centralized authorities
2. **Verifiable Credentials enable trust** - Credentials can be cryptographically verified by any party
3. **Zero-Knowledge Proofs protect privacy** - Selective disclosure allows proving facts without revealing all data
4. **Midnight Network offers unique advantages** - Privacy-preserving infrastructure designed for compliance

The combination of DIDs, Verifiable Credentials, and ZK proofs on Midnight Network creates a powerful identity system that respects user privacy while enabling trust in digital interactions.

## Additional Resources

- [W3C DID Specification](https://www.w3.org/TR/did-core/)
- [W3C Verifiable Credentials](https://www.w3.org/TR/vc-data-model/)
- [Midnight Network Documentation](https://docs.midnight.network)
- [Zero-Knowledge Proofs Explained](https://zkintro.com)

## Contributing

Contributions are welcome! Please see the CONTRIBUTING.md file for guidelines.

## License

This project is licensed under the MIT License.
