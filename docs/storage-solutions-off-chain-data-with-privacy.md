# Storage Solutions on Midnight: Handling Off-Chain Data with Privacy

Blockchain storage is expensive and impractical for large files. A medical record, a legal document, or a high-resolution image cannot live on-chain — not on Midnight, not on Ethereum, not anywhere. But when you move data off-chain, you lose the privacy guarantees that make Midnight interesting. This tutorial shows you how to get both: off-chain storage with on-chain privacy proofs.

## The Core Problem

When you store data on IPFS, Arweave, or any other off-chain system, the content address (CID on IPFS, transaction ID on Arweave) is public. If anyone can guess or obtain that address, they can fetch the data. Your Midnight contract can't directly prevent that.

The solution is layered:

1. **Encrypt the data** before uploading. The encryption key stays off-chain, controlled by access rules you define.
2. **Store a commitment** on-chain (the hash of the encrypted data). This proves integrity without revealing content.
3. **Use Midnight's private state** to store access keys and data references. Only you can see them.
4. **Use circuits** to prove properties about the data without revealing it (e.g., "this document is less than 30 days old" without showing the document).

## When to Store On-Chain vs Off-Chain

| Data Type | Store On-Chain | Store Off-Chain |
|-----------|---------------|-----------------|
| Small flags, status, amounts | Yes | No |
| Hashes / commitments | Yes | No |
| Encryption keys | Never | Yes (private state) |
| Documents, images, files | No | Yes (encrypted) |
| Metadata (filename, size) | Shielded | Encrypted off-chain |
| Audit logs | Yes (shielded) | Maybe |

The boundary: if data fits in a few bytes and needs to be proven in a circuit, it goes on-chain. Everything else goes off-chain, encrypted.

## Building a Private Document Management System

We'll build a system where:
- Documents are encrypted and stored on IPFS
- The encryption key is stored in the user's private Midnight state
- An on-chain commitment proves the document exists and hasn't been tampered with
- Access can be granted to specific parties using their Midnight public keys

### Contract Structure

```compact
contract DocumentVault {
  // Public: number of documents registered (no content revealed)
  ledger document_count: Uint<32>;

  // Public: document commitments (proves existence and integrity)
  // mapping from document_id to commitment hash
  ledger commitments: Map<Bytes<32>, Bytes<32>>;

  // Public: access grants (who has been granted access to what)
  // The grantee identity is shielded — you can see a grant happened
  // but not who received it
  ledger grant_count: Uint<32>;
}
```

Private state (visible only to the owner) is managed by the Midnight SDK on the client side. The contract doesn't store it.

### Encrypting and Uploading a Document

```typescript
import { create } from 'ipfs-http-client';
import { MidnightProvider } from '@midnight-ntwrk/midnight-js-network-id';

interface DocumentRecord {
  docId: Uint8Array;           // 32-byte identifier
  cid: string;                 // IPFS content address
  encryptionKey: Uint8Array;   // AES-256-GCM key (never leaves client)
  commitmentHash: Uint8Array;  // hash(cid + encryptionKey + nonce)
  createdAt: number;
}

async function uploadDocument(
  filePath: string,
  provider: MidnightProvider
): Promise<DocumentRecord> {
  const ipfs = create({ url: process.env.IPFS_API_URL! });

  // Read the file
  const fileContent = await fs.readFile(filePath);

  // Generate a fresh encryption key for this document
  const encryptionKey = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // Encrypt the document before upload
  const cryptoKey = await crypto.subtle.importKey(
    'raw', encryptionKey, 'AES-GCM', false, ['encrypt']
  );
  const encryptedContent = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    fileContent
  );

  // Upload encrypted content to IPFS
  // Content is encrypted — even if the CID leaks, the file is unreadable
  const { cid } = await ipfs.add(
    new Uint8Array(encryptedContent),
    { pin: true }
  );

  // Generate a document ID
  const docId = crypto.getRandomValues(new Uint8Array(32));

  // Commitment: hash of CID + key + IV + docId
  // This goes on-chain to prove the document exists and matches
  const commitmentHash = await computeCommitment(cid.toString(), encryptionKey, iv, docId);

  return {
    docId,
    cid: cid.toString(),
    encryptionKey,
    commitmentHash,
    createdAt: Date.now()
  };
}

async function computeCommitment(
  cid: string,
  key: Uint8Array,
  iv: Uint8Array,
  docId: Uint8Array
): Promise<Uint8Array> {
  const input = new TextEncoder().encode(cid + ':' + iv.join(','));
  const combined = new Uint8Array([...input, ...key, ...docId]);
  const hash = await crypto.subtle.digest('SHA-256', combined);
  return new Uint8Array(hash);
}
```

### Registering the Commitment On-Chain

The commitment goes into the Midnight contract. No file content, no encryption key, just a 32-byte hash:

```compact
circuit register_document(
  doc_id: Bytes<32>,
  commitment: Bytes<32>
): [] {
  // Verify this document ID hasn't been registered before
  assert !DocumentVault.commitments.member(doc_id);
  assert commitment != zeros();

  // Record the commitment publicly
  DocumentVault.commitments.insert(doc_id, commitment);
  DocumentVault.document_count = DocumentVault.document_count + 1;

  // The doc_id and commitment are public
  // The actual file, CID, and encryption key are stored privately by the client
}
```

```typescript
async function registerDocument(
  provider: MidnightProvider,
  record: DocumentRecord
): Promise<string> {
  const client = await createMidnightClient(provider);

  const tx = await client.buildTransaction({
    contract: VAULT_CONTRACT_ADDRESS,
    circuit: 'register_document',
    privateInputs: {
      doc_id: record.docId,
      commitment: record.commitmentHash
    }
  });

  const receipt = await client.submitTransaction(tx);

  // Store the full record in the user's local private state
  // This is NOT sent to the network
  await storePrivateRecord(record);

  return receipt.txHash;
}
```

The user's local private state (stored encrypted on their device or in their wallet) contains the mapping from `doc_id` to the IPFS CID and decryption key.

### Verifying Data Integrity

When retrieving a document, verify the commitment matches before decrypting:

```typescript
async function retrieveDocument(
  provider: MidnightProvider,
  docId: Uint8Array
): Promise<Buffer> {
  // Fetch private record from local storage
  const record = await getPrivateRecord(docId);

  // Fetch encrypted content from IPFS
  const ipfs = create({ url: process.env.IPFS_API_URL! });
  const chunks: Uint8Array[] = [];
  for await (const chunk of ipfs.cat(record.cid)) {
    chunks.push(chunk);
  }
  const encryptedContent = Buffer.concat(chunks);

  // Verify the on-chain commitment matches what we expect
  const computedCommitment = await computeCommitment(
    record.cid, record.encryptionKey, record.iv, record.docId
  );
  const onChainCommitment = await getOnChainCommitment(provider, docId);

  if (!Buffer.from(computedCommitment).equals(Buffer.from(onChainCommitment))) {
    throw new Error('Document integrity check failed — data may have been tampered with');
  }

  // Decrypt and return
  const cryptoKey = await crypto.subtle.importKey(
    'raw', record.encryptionKey, 'AES-GCM', false, ['decrypt']
  );
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: record.iv },
    cryptoKey,
    encryptedContent
  );

  return Buffer.from(decrypted);
}
```

### Granting Access to Another Party

To share a document with another Midnight user, encrypt the decryption key using their public key:

```compact
circuit grant_access(
  doc_id: Bytes<32>,
  // Encrypted key is private — only the grantee can see it
  encrypted_key_commitment: Bytes<32>
): [] {
  // Verify the document exists
  assert DocumentVault.commitments.member(doc_id);

  // The access grant is recorded (anonymously)
  DocumentVault.grant_count = DocumentVault.grant_count + 1;

  // encrypted_key_commitment proves a key was granted
  // without revealing to whom or what the key is
}
```

```typescript
async function grantAccess(
  provider: MidnightProvider,
  docId: Uint8Array,
  granteePublicKey: Uint8Array
): Promise<void> {
  const record = await getPrivateRecord(docId);

  // Encrypt the document's decryption key with the grantee's public key
  const encryptedKey = await encryptForRecipient(record.encryptionKey, granteePublicKey);

  // Send the encrypted key and IPFS CID to the grantee
  // This happens off-chain (e.g., via encrypted message or their Midnight inbox)
  await sendPrivateMessage(granteePublicKey, {
    docId,
    cid: record.cid,
    encryptedKey,
    iv: record.iv
  });

  // Record the grant on-chain (anonymously)
  const client = await createMidnightClient(provider);
  const commitment = await computeHash(encryptedKey);

  await client.buildTransaction({
    contract: VAULT_CONTRACT_ADDRESS,
    circuit: 'grant_access',
    privateInputs: {
      doc_id: docId,
      encrypted_key_commitment: commitment
    }
  });
}
```

## Proving Properties Without Revealing Content

This is where things get interesting. Midnight lets you prove facts about your data without revealing the data. For a medical record:

- "This lab result is within normal range" — without showing the result
- "This document was signed less than 30 days ago" — without showing the date
- "This credential was issued by an approved institution" — without showing which one

```compact
// Prove a document was created after a certain timestamp
// without revealing the actual timestamp
circuit prove_document_recency(
  doc_id: Bytes<32>,
  created_at: Uint<64>,       // private: actual creation timestamp
  cutoff_timestamp: Uint<64>  // public: must be after this time
): [] {
  // Verify the document exists on-chain
  assert DocumentVault.commitments.member(doc_id);

  // Prove the timestamp is within acceptable range
  assert created_at >= cutoff_timestamp;

  // The actual created_at value is never revealed
  // The circuit just proves it satisfies the constraint
}
```

## Arweave for Permanent Storage

For documents that need permanent storage (legal records, certificates), use Arweave instead of IPFS:

```typescript
import Arweave from 'arweave';

async function uploadToArweave(
  encryptedContent: Uint8Array,
  arweaveKey: object
): Promise<string> {
  const arweave = Arweave.init({
    host: 'arweave.net',
    port: 443,
    protocol: 'https'
  });

  const transaction = await arweave.createTransaction({
    data: encryptedContent
  }, arweaveKey);

  transaction.addTag('Content-Type', 'application/octet-stream');
  transaction.addTag('App-Name', 'MidnightDocumentVault');
  // Do NOT add metadata tags that reveal document type or owner

  await arweave.transactions.sign(transaction, arweaveKey);
  await arweave.transactions.post(transaction);

  return transaction.id; // Arweave transaction ID (public, but content encrypted)
}
```

The pattern is identical to IPFS — the transaction ID goes into your private state, and a commitment hash goes on-chain.

## Common Pitfalls

**Don't use predictable CIDs as document identifiers.** If you store the IPFS CID in your Midnight contract directly, anyone who finds the CID on IPFS can correlate it to your identity. Use a separate `doc_id` that is only meaningful to you.

**Don't reuse encryption keys.** Generate a fresh key per document. If one key leaks, only that document is exposed.

**Don't store plaintext metadata on-chain.** Filenames, document types, and creation dates can reveal sensitive information. Encrypt them or derive commitments.

**Do verify commitments on read.** Always check the on-chain commitment against the fetched content before decrypting. This catches both data corruption and malicious modification.

## Testing Locally

```bash
git clone https://github.com/your-handle/midnight-document-vault
cd midnight-document-vault
npm install

# Copy environment template
cp .env.example .env
# Fill in: IPFS_API_URL, MIDNIGHT_NODE_URL

# Start local Midnight testnet
npx midnight-js-cli node start --network testnet

# Deploy the contract
npx ts-node scripts/deploy.ts

# Run the test suite
npm test

# Manual test: upload a document
npx ts-node scripts/upload.ts --file ./test-data/sample.pdf

# Verify and retrieve it
npx ts-node scripts/retrieve.ts --doc-id <doc-id-from-upload>
```

## Summary

The pattern for private off-chain storage on Midnight:

1. Encrypt data client-side with a fresh key
2. Upload ciphertext to IPFS or Arweave
3. Store commitment (hash of content address + key) on-chain via a Compact circuit
4. Keep the mapping from doc_id to (CID, key, IV) in private state on the client
5. Use circuits to prove properties about the data when needed

This gives you: tamper-evident storage, selective access control, private data with public verifiability, and the ability to make cryptographic claims about data content without revealing it.

## Next Steps

- Review the [Midnight viewing key documentation](https://docs.midnight.network) for access delegation patterns
- Look at [IPFS pinning services](https://docs.ipfs.tech/) (Pinata, Web3.Storage) for reliable off-chain storage
- Explore [Arweave documentation](https://docs.arweave.org/) for permanent storage use cases
- Discuss your implementation in the [Midnight developer forum](https://forum.midnight.network/)

---

*Published on dev.to: [link-to-article]*
