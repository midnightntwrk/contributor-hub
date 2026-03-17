# Building Decentralized Identity (DIDs) with Midnight

## Introduction

In this tutorial, we'll explore the concept of Decentralized Identity (DID) and how it integrates with the Midnight Network. We'll cover the basic concepts behind DIDs, how they work in the context of decentralized systems, and provide working code examples demonstrating their integration with Midnight.

## What is a Decentralized Identity (DID)?

A Decentralized Identifier (DID) is a new type of identifier that enables verifiable, self-sovereign digital identities. Unlike traditional centralized identifiers (e.g., email or social security numbers), DIDs are fully under the control of the identity owner and don't depend on a central registry, identity provider, or certificate authority.

### Key Characteristics of DIDs:

1. **Decentralized**: DIDs are stored on decentralized networks, giving control back to the individual.
2. **Self-sovereign**: The identity owner controls their DID and associated verifiable credentials.
3. **Interoperable**: DIDs are designed to work across different decentralized networks.

## How DIDs Work

A DID is typically represented as a URI (Uniform Resource Identifier) with the following structure:

    did:<method>:<method-specific-id>

For example, a DID for a person could look like this:

    did:midnight:1234abcd5678efgh

In this case, `did` indicates it's a DID, `midnight` is the method (which specifies the decentralized network), and `1234abcd5678efgh` is the unique identifier.

DIDs are not inherently tied to any specific platform, but the method component defines the network or service that is responsible for managing the DID.

## Using DIDs with Midnight

Midnight is a decentralized platform that facilitates secure and private interactions. To integrate DIDs with Midnight, we will use the `midnight-identity` library, which provides tools to create, manage, and authenticate DIDs on the Midnight network.

### Step 1: Set Up Your Project

Start by setting up a Node.js project. Run the following commands in your terminal:

```bash
mkdir did-example
cd did-example
npm init -y
npm install midnight-identity
```

### Step 2: Generate a DID

To generate a DID, you'll need to use the `midnight-identity` library. Here's how you can generate a DID:

```javascript
const { generateDID } = require('midnight-identity');

const did = generateDID();
console.log('Generated DID:', did);
```

This will generate a new DID for your application. The DID will be unique and stored on the Midnight network.

### Step 3: Verifying the DID

To verify a DID, you can use the `verifyDID` method provided by the `midnight-identity` library. Here's an example:

```javascript
const { verifyDID } = require('midnight-identity');

const isValid = verifyDID(did);
console.log('Is the DID valid?', isValid);
```

This will verify the DID against the Midnight network and return `true` if the DID is valid, or `false` otherwise.

### Step 4: Creating Verifiable Credentials

Verifiable credentials are a core component of the DID ecosystem. These credentials are used to assert claims about an identity. Here's an example of how to create a verifiable credential:

```javascript
const { createVerifiableCredential } = require('midnight-identity');

const credential = createVerifiableCredential(did, {
  claim: 'Age 30',
  issuer: 'did:midnight:issuer123',
  expiration: '2025-01-01T00:00:00Z'
});

console.log('Created Verifiable Credential:', credential);
```

### Step 5: Verifying a Verifiable Credential

Verifiable credentials can be verified using the `verifyCredential` method. Here's an example:

```javascript
const { verifyCredential } = require('midnight-identity');

const isVerified = verifyCredential(credential);
console.log('Is the credential valid?', isVerified);
```

### Conclusion

In this tutorial, we learned about Decentralized Identities (DIDs) and how to integrate them with the Midnight Network. By using the `midnight-identity` library, we were able to generate DIDs, verify them, and create and verify verifiable credentials. This provides a powerful foundation for building decentralized applications that prioritize privacy and self-sovereign identity management.

## Additional Resources

For more information on DIDs and the Midnight Network, visit the [Midnight documentation](https://midnightntwrk.com/docs).