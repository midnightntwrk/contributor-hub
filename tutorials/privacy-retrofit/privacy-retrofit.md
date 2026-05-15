# Privacy Retrofit: Adding Shielded Transactions to Existing Midnight dApps

**By billbtbillb | May 2026**

You built a Midnight dApp. It compiles, deploys, and processes transactions. But every transaction is transparent — amounts, sender, receiver, all visible on-chain. You want to add privacy without rewriting your entire application from scratch.

This tutorial walks through the exact steps to retrofit privacy into an existing Midnight application. You will learn how the Midnight privacy model works, why transparent transactions leak information even when you think they don't, and how to convert your existing transaction flows to use shielded operations with minimal code changes.

---

## Prerequisites

- Midnight toolchain installed ([installation guide](https://docs.midnight.network/getting-started/installation))
- Node.js v22+
- An existing Midnight dApp that creates and submits transactions
- Familiarity with Compact syntax basics ([hello world tutorial](https://docs.midnight.network/getting-started/hello-world))
- A funded wallet on Midnight testnet (or local devnet running)

---

## 1. What "Privacy" Actually Means on Midnight

Privacy on Midnight is not encryption at rest. It is not access control. It is **transaction-level unlinkability** — the inability for an observer to determine who sent what to whom, even though all transactions are recorded on a public ledger.

In a transparent transaction, three pieces of information are visible:

1. **Sender address** — who initiated the transaction
2. **Receiver address** — who receives the output
3. **Amount** — how many tokens moved

An observer can trace the flow of funds across the entire transaction graph. If you paid someone for a service, anyone can see that payment, its amount, and both parties involved. This is the default behavior of most blockchain systems.

Shielded transactions hide these details using **zero-knowledge proofs**. The transaction still appears on the ledger, but the critical information — sender, receiver, amount — is encrypted. The ZK proof proves that the transaction is *valid* (the sender had enough tokens, the math checks out) without revealing *what* the transaction actually contains.

---

## 2. The Shielded UTXO Model

Midnight uses a UTXO (Unspent Transaction Output) model. Every transaction consumes existing UTXOs and creates new ones. In the transparent model, UTXOs are visible to everyone. In the shielded model, UTXOs are **notes** — encrypted commitments that only the owner can decrypt.

A shielded note contains:

- **Commitment** — a cryptographic hash of the note's contents (amount, owner key, randomness)
- **Encrypted payload** — the actual note data, encrypted to the recipient's viewing key
- **Nullifier** — revealed when the note is spent, proving it was consumed without revealing which note

The critical insight: the commitment hides the note's value. The nullifier prevents double-spending. Together, they allow the network to verify transaction validity without learning anything about the transaction's contents.

```
// Transparent UTXO — everyone sees everything
{
  owner: "addr1abc...",      // visible
  amount: 1000,              // visible
  txHash: "0xdef...",        // visible
  outputIndex: 0             // visible
}

// Shielded note — only the owner sees the details
{
  commitment: "0x7a8b...",   // visible (but meaningless hash)
  ciphertext: "0x9c2f...",   // visible (encrypted blob)
  // owner, amount, txHash — all hidden inside ciphertext
}
```

---

## 3. What Your Transparent dApp Is Leaking

Before retrofitting, understand what information your current dApp exposes:

**Transaction patterns** reveal behavior. If you submit a transaction every Friday at 5 PM for exactly 500 tokens, an observer can infer payroll. If your dApp transfers tokens between two addresses repeatedly, the relationship between those addresses is obvious.

**Amount correlation** links transactions. If address A sends 1,247 tokens and address B receives 1,247 tokens in the same block, the correlation is trivially computable, even without explicit sender/receiver information.

**Timing analysis** degrades anonymity. Transactions that occur in rapid succession are likely related. Randomized delays help, but the real solution is hiding the transaction details entirely.

Privacy retrofitting addresses all three by converting your transaction flows to use shielded notes, ZK proofs for validation, and encrypted payloads for recipient delivery.

---

## 4. Step-by-Step Retrofit Guide

### Step 1: Audit Your Transaction Creation Code

Find every place in your codebase where you create transactions. Look for calls to:

- `wallet.balanceUnboundTransaction()`
- `wallet.submitTransaction()`
- Direct UTXO selection and construction

Each of these needs to be converted. Create a list of all transaction entry points.

### Step 2: Replace UTXO Selection with Note Selection

Transparent dApps select UTXOs directly:

```typescript
// BEFORE: transparent UTXO selection
const utxos = await wallet.getUtxos();
const selected = selectUtxos(utxos, amount);
```

Shielded dApps select notes:

```typescript
// AFTER: shielded note selection
const notes = await wallet.getNotes();
const selected = selectNotes(notes, amount);
```

The `getNotes()` method returns encrypted notes that the wallet has decrypted using its viewing key. The selection logic is similar, but the data structure is different — notes have commitments instead of plain amounts.

### Step 3: Wrap Transaction Building in ZK Circuits

Transparent transactions are validated by simple arithmetic: inputs must equal outputs plus fees. Shielded transactions require ZK proofs that the same arithmetic holds, but without revealing the actual values.

In Compact, define a circuit that proves:

```
// Compact circuit sketch
circuit balance_check {
  // Private inputs (not revealed)
  private input: input_amounts: [Field; MAX_INPUTS];
  private input: output_amounts: [Field; MAX_OUTPUTS];
  private input: fee: Field;

  // Public inputs (revealed)
  public input: input_commitments: [Field; MAX_INPUTS];
  public input: output_commitments: [Field; MAX_OUTPUTS];

  // Prove: sum of inputs = sum of outputs + fee
  // Without revealing any individual amount
  constraint sum(input_amounts) == sum(output_amounts) + fee;

  // Prove: each commitment is correctly formed
  for i in 0..MAX_INPUTS {
    constraint input_commitments[i] == commit(input_amounts[i], owner_key, randomness[i]);
  }
  for i in 0..MAX_OUTPUTS {
    constraint output_commitments[i] == commit(output_amounts[i], recipient_key, randomness[i]);
  }
}
```

### Step 4: Add Nullifier Generation

When spending a shielded note, you must reveal its nullifier. The nullifier is derived from the note's secret and the spending key, ensuring that only the owner can spend the note while preventing the spent note from being linked to its creation.

```typescript
// Generate nullifier for a note being spent
const nullifier = generateNullifier(note.secret, spendingKey);
// The network checks: has this nullifier been seen before?
// If yes → double spend attempt, reject
// If no → valid spend, record nullifier
```

### Step 5: Encrypt Outputs for Recipients

Shielded transaction outputs must be encrypted to the recipient's viewing key. The sender creates two encrypted blobs:

1. **Recipient payload** — encrypted with the recipient's encryption key
2. **Sender payload** — encrypted with the sender's encryption key (for record-keeping)

```typescript
const recipientPayload = encrypt({
  amount,
  sender: senderKey,
  memo: "payment for services"
}, recipientEncryptionKey);

const senderPayload = encrypt({
  amount,
  recipient: recipientKey,
  memo: "payment for services"
}, senderEncryptionKey);
```

### Step 6: Handle Mixed UTXO Sets

During the migration period, your wallet may contain both transparent UTXOs and shielded notes. You need a strategy for handling this:

- **Immediate migration**: Spend all transparent UTXOs into shielded notes in a single transaction
- **Gradual migration**: As transparent UTXOs are naturally spent, convert the change to shielded notes
- **Dual-mode**: Support both transaction types, letting users choose

The recommended approach for production dApps is gradual migration with dual-mode support, so existing transparent transactions continue working while new transactions default to shielded.

### Step 7: Update Balance Queries

Transparent balance queries return exact amounts. Shielded balance queries return the sum of decrypted notes. Update your UI and business logic to handle:

- **Pending notes** — notes received but not yet confirmed
- **Sync state** — the wallet may not have scanned all blocks yet
- **Proof generation time** — shielded transactions take longer to construct

```typescript
// BEFORE: instant balance
const balance = await wallet.getBalance();

// AFTER: balance with sync awareness
const balance = await wallet.getShieldedBalance();
if (balance.syncState !== 'synced') {
  console.warn('Balance may be incomplete — still syncing');
}
```

---

## 5. Performance Considerations

Shielded transactions are computationally more expensive than transparent ones:

- **Proof generation**: 2-10 seconds depending on circuit complexity
- **Proof verification**: ~50ms per proof (acceptable for validators)
- **Transaction size**: ~2-4x larger than transparent equivalents
- **Sync time**: Wallet must scan all blocks to decrypt its notes

Plan for these costs. Add progress indicators for proof generation. Implement background sync for wallet scanning. Consider batching multiple operations into a single proof when possible.

---

## 6. Testing Privacy

Testing privacy is fundamentally different from testing functionality. You need to verify:

1. **Positive tests**: The transaction succeeds and the recipient receives the correct amount
2. **Negative tests**: An observer cannot determine the amount, sender, or receiver
3. **Nullifier tests**: Double-spending is prevented
4. **Edge cases**: Zero-amount transactions, maximum-value transactions, self-transfers

For observer tests, use a separate node that monitors the chain without possessing any viewing keys. Verify that:

- The commitment hash does not reveal the amount
- The ciphertext cannot be decrypted without the recipient's key
- The nullifier does not reveal which note it corresponds to

---

## 7. Summary

Privacy retrofitting on Midnight follows a clear pattern:

1. **Audit** — find all transparent transaction creation points
2. **Replace** — swap UTXO selection for note selection
3. **Circuit** — wrap balance logic in ZK circuits
4. **Nullify** — add nullifier generation for note spending
5. **Encrypt** — encrypt outputs for recipients
6. **Migrate** — handle mixed transparent/shielded UTXO sets
7. **Query** — update balance and state queries for shielded mode

The result is a dApp that preserves all existing functionality while adding transaction-level privacy. Users can still send and receive tokens, but an observer of the blockchain can no longer determine who sent what to whom.

Shielded transactions cost more in compute and storage, but the privacy guarantees are worth the trade-off for any application where transaction details should remain confidential.
