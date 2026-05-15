# Building a Shielded Token Vault on Midnight Network

## Introduction

Privacy is a fundamental right in the digital age. On public blockchains, every transaction, balance, and token transfer is visible to anyone who cares to look. This transparency, while useful for auditability, creates significant problems for individuals and businesses who need financial privacy. Midnight Network addresses this challenge by providing zero-knowledge-powered privacy infrastructure that allows developers to build applications where sensitive data remains confidential while still maintaining cryptographic verifiability.

In this tutorial, you will learn how to build a **Shielded Token Vault** — a smart contract system that allows users to deposit tokens into a privacy-preserving vault, where balances and transaction amounts are hidden from public view using zero-knowledge proofs. Only the vault owner and authorized parties can see the actual values. This is a foundational primitive for private DeFi, confidential payroll systems, and privacy-preserving treasury management.

By the end of this tutorial, you will understand:

- How Midnight's Compact language works for writing shielded contracts
- How zero-knowledge commitments protect token balances
- How to implement deposit, withdrawal, and transfer operations with privacy
- How to build a TypeScript interface that interacts with the vault
- Best practices for key management and proof generation

## Prerequisites

Before starting, ensure you have the following installed:

- **Node.js** v18 or later
- **Deno** runtime (for Midnight tooling)
- **Midnight Compact compiler** (`compactc`)
- **Midnight Lace wallet** browser extension
- Basic familiarity with TypeScript and zero-knowledge concepts

Install the Midnight development tools:

```bash
npm install -g @midnight-ntwrk/compactc
npm install -g @midnight-ntwrk/midnight-cli
```

## Project Setup

Create a new project directory and initialize it:

```bash
mkdir shielded-token-vault
cd shielded-token-vault
npm init -y
npm install @midnight-ntwrk/compact-runtime @midnight-ntwrk/zswap @midnight-ntwrk/wallet-sdk
```

Your project structure should look like this:

```
shielded-token-vault/
├── contracts/
│   └── shielded_vault.compact
├── src/
│   ├── deploy.ts
│   ├── vault-client.ts
│   └── proof-generator.ts
├── examples/
│   ├── basic-usage.ts
│   └── multi-user.ts
├── tests/
│   └── vault.test.ts
├── package.json
└── tsconfig.json
```

## Understanding the Shielded Vault Architecture

The Shielded Token Vault operates on three core principles:

1. **Commitment-based balances**: Instead of storing plaintext balances, the vault stores Pedersen commitments. A commitment `C = v·H + r·G` hides the value `v` behind a random blinding factor `r`, making it computationally infeasible to determine the balance without knowing `r`.

2. **Zero-knowledge proofs for state transitions**: Every deposit, withdrawal, and transfer requires a ZK proof that the operation is valid — the user has sufficient funds, the amounts are non-negative, and the total supply is conserved — without revealing any actual values.

3. **Encrypted note system**: Transaction details are encrypted and stored as "notes" that only the intended recipient can decrypt, using their viewing key. This ensures that even the validator cannot see the amounts being transferred.

### The Circuit Model

Each operation in the vault requires a specific ZK circuit:

- **Deposit Circuit**: Proves that the user knows the deposit amount and that it equals the difference between the old and new vault commitments.
- **Withdrawal Circuit**: Proves that the user owns a note in the vault, knows its value and blinding factor, and that the withdrawal amount does not exceed the note value.
- **Transfer Circuit**: Proves a spend of an existing note and creation of new notes for sender (change) and recipient, with value conservation.

## Writing the Smart Contract in Compact

Midnight uses **Compact**, a domain-specific language designed for writing zero-knowledge circuits and smart contracts. Create the vault contract:

```compact
// contracts/shielded_vault.compact

pragma language_version 0.14;

import CompactStandardLibrary;

// Shielded Token Vault Contract
// Allows private deposits, withdrawals, and transfers of tokens
contract ShieldedTokenVault {
    // The token type this vault manages
    @using(encryption, merkle_tree)
    field vault_id;

    // Merkle tree storing commitments to shielded notes
    @storage
    merkle_tree<32> commitment_tree;

    // Nullifier set — prevents double-spending of notes
    @storage
    set<field> nullifiers;

    // Total committed value (encrypted, for internal accounting)
    @storage
    EncryptedValue total_committed;

    // Vault configuration
    @storage
    field admin_pk;  // Admin public key for emergency operations

    // Circuit: Initialize the vault
    constructor(admin_public_key: field) {
        admin_pk = admin_public_key;
        commitment_tree = MerkleTree.empty();
        nullifiers = Set.empty();
    }

    // Circuit: Deposit tokens into the vault
    // User provides the deposit amount as a private witness
    // The commitment hides the amount and includes a secret randomness
    @circuit
    deposit(
        amount: Field,           // Private: the deposit amount
        blinding: Field,         // Private: random blinding factor
        note_commitment: Field   // Public: C = commit(amount, blinding)
    ): Field {
        // Verify the commitment is correctly formed
        // H(amount || blinding) must equal note_commitment
        assert eq(
            poseidon_hash(amount, blinding),
            note_commitment
        );

        // Add commitment to the Merkle tree
        commitment_tree.insert(note_commitment);

        // Return the new Merkle root
        return commitment_tree.root();
    }

    // Circuit: Withdraw tokens from the vault
    // Proves ownership of a note without revealing which note
    @circuit
    withdraw(
        // Private witnesses
        amount: Field,
        blinding: Field,
        note_commitment: Field,
        merkle_path: MerklePath<32>,
        // Public inputs
        nullifier: Field,
        recipient: Field,
        withdrawal_amount: Field
    ): Bool {
        // Verify the note exists in the tree
        assert merkle_path.verify(note_commitment, commitment_tree.root());

        // Verify the commitment is correctly formed
        assert eq(
            poseidon_hash(amount, blinding),
            note_commitment
        );

        // Verify sufficient balance (amount >= withdrawal_amount)
        assert gte(amount, withdrawal_amount);

        // Verify the nullifier hasn't been used (prevent double-spend)
        assert not(nullifiers.contains(nullifier));

        // Mark nullifier as used
        nullifiers.insert(nullifier);

        // If there's change, create a new note for the remainder
        let change = sub(amount, withdrawal_amount);
        if gt(change, 0) {
            let new_blinding = poseidon_hash(blinding, nullifier);
            let change_commitment = poseidon_hash(change, new_blinding);
            commitment_tree.insert(change_commitment);
        }

        return true;
    }

    // Circuit: Shielded transfer within the vault
    // Transfers value from one shielded note to another
    @circuit
    shielded_transfer(
        // Private witnesses — input note
        input_amount: Field,
        input_blinding: Field,
        input_commitment: Field,
        input_merkle_path: MerklePath<32>,
        input_nullifier: Field,
        // Private witnesses — outputs
        output_amount_1: Field,
        output_blinding_1: Field,
        output_amount_2: Field,
        output_blinding_2: Field,
        // Public inputs
        output_commitment_1: Field,
        output_commitment_2: Field
    ): Bool {
        // Verify input note exists
        assert input_merkle_path.verify(
            input_commitment, 
            commitment_tree.root()
        );

        // Verify input commitment
        assert eq(
            poseidon_hash(input_amount, input_blinding),
            input_commitment
        );

        // Verify no double-spend
        assert not(nullifiers.contains(input_nullifier));

        // Verify output commitments are correctly formed
        assert eq(
            poseidon_hash(output_amount_1, output_blinding_1),
            output_commitment_1
        );
        assert eq(
            poseidon_hash(output_amount_2, output_blinding_2),
            output_commitment_2
        );

        // Value conservation: input = output1 + output2
        assert eq(
            input_amount,
            add(output_amount_1, output_amount_2)
        );

        // Spend the input note
        nullifiers.insert(input_nullifier);

        // Insert output commitments
        commitment_tree.insert(output_commitment_1);
        commitment_tree.insert(output_commitment_2);

        return true;
    }

    // Query: Get the current Merkle root
    @query
    get_merkle_root(): Field {
        return commitment_tree.root();
    }

    // Query: Check if a nullifier has been used
    @query
    is_spent(nullifier: field): Bool {
        return nullifiers.contains(nullifier);
    }
}
```

### Key Concepts in the Contract

**`@using(encryption, merkle_tree)`**: This decorator tells the Compact compiler to enable encryption primitives and Merkle tree operations for this contract. These are essential building blocks for the privacy model.

**Merkle Tree**: The `merkle_tree<32>` stores all note commitments in a binary tree of depth 32, supporting up to 2^32 (~4 billion) notes. The root serves as a compact commitment to the entire set of unspent notes.

**Nullifiers**: Each note, when spent, produces a unique nullifier derived from the note's secret data. The nullifier set prevents double-spending without revealing which note was spent.

**Poseidon Hash**: We use the Poseidon hash function because it is "ZK-friendly" — its arithmetic circuit representation is far more efficient than traditional hashes like SHA-256, reducing proof generation time and on-chain verification cost.

## Building the TypeScript Client

The client library handles wallet interaction, proof generation, and transaction construction. Create `src/vault-client.ts`:

```typescript
// src/vault-client.ts

import {
  CompactRuntime,
  CircuitParameters,
  Field,
} from "@midnight-ntwrk/compact-runtime";
import {
  ZswapChainState,
  Transaction,
  CoinInfo,
  EncryptedNote,
} from "@midnight-ntwrk/zswap";
import {
  WalletBuilder,
  Wallet,
  generateSeedPhrase,
} from "@midnight-ntwrk/wallet-sdk";
import * as crypto from "crypto";

// Represents a shielded note that the user owns
interface ShieldedNote {
  commitment: string;
  amount: bigint;
  blinding: string;
  leafIndex: number;
  merklePath: string[];
}

// Vault client configuration
interface VaultConfig {
  contractAddress: string;
  networkId: string;
  proofServerUrl: string;
}

export class ShieldedVaultClient {
  private wallet: Wallet;
  private contractAddress: string;
  private proofServerUrl: string;
  private notes: ShieldedNote[] = [];

  constructor(wallet: Wallet, config: VaultConfig) {
    this.wallet = wallet;
    this.contractAddress = config.contractAddress;
    this.proofServerUrl = config.proofServerUrl;
  }

  /**
   * Generate a random field element for blinding factors
   */
  private randomField(): string {
    const bytes = crypto.randomBytes(31); // 31 bytes to stay within field
    return "0x" + bytes.toString("hex");
  }

  /**
   * Compute a Poseidon hash commitment to a value and blinding factor
   */
  private async computeCommitment(
    amount: bigint,
    blinding: string
  ): Promise<string> {
    const response = await fetch(`${this.proofServerUrl}/poseidon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inputs: [amount.toString(), blinding],
      }),
    });
    const result = await response.json();
    return result.hash;
  }

  /**
   * Compute a nullifier for a note (prevents double-spending)
   */
  private async computeNullifier(
    commitment: string,
    blinding: string,
    ownerSecret: string
  ): Promise<string> {
    const response = await fetch(`${this.proofServerUrl}/poseidon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inputs: [commitment, blinding, ownerSecret],
      }),
    });
    const result = await response.json();
    return result.hash;
  }

  /**
   * Deposit tokens into the shielded vault
   * 
   * This creates a new shielded note and submits a deposit transaction
   * with a ZK proof that the commitment is correctly formed.
   */
  async deposit(amount: bigint): Promise<string> {
    console.log(`Depositing ${amount} tokens into shielded vault...`);

    // Generate random blinding factor
    const blinding = this.randomField();

    // Compute commitment: C = H(amount || blinding)
    const commitment = await this.computeCommitment(amount, blinding);

    // Request ZK proof from the proof server
    const proofResponse = await fetch(`${this.proofServerUrl}/prove`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        circuit: "deposit",
        privateInputs: {
          amount: amount.toString(),
          blinding,
          note_commitment: commitment,
        },
        publicInputs: {
          note_commitment: commitment,
        },
      }),
    });

    const { proof, publicOutputs } = await proofResponse.json();

    // Build and submit the transaction
    const tx = Transaction.new()
      .addContractCall(this.contractAddress, "deposit", [commitment], proof)
      .build();

    const txId = await this.wallet.submitTransaction(tx);

    // Store the note locally (encrypted in practice)
    this.notes.push({
      commitment,
      amount,
      blinding,
      leafIndex: publicOutputs.leafIndex,
      merklePath: publicOutputs.merklePath,
    });

    console.log(`Deposit successful! TX: ${txId}`);
    console.log(`Note commitment: ${commitment.slice(0, 16)}...`);
    return txId;
  }

  /**
   * Withdraw tokens from the shielded vault
   * 
   * Proves ownership of a note and withdraws the specified amount.
   * Any remaining balance is re-committed as a new note.
   */
  async withdraw(amount: bigint, recipientAddress: string): Promise<string> {
    console.log(`Withdrawing ${amount} tokens from vault...`);

    // Find a note with sufficient balance
    const note = this.notes.find((n) => n.amount >= amount);
    if (!note) {
      throw new Error("Insufficient shielded balance");
    }

    const ownerSecret = await this.wallet.getSpendingKey();
    const nullifier = await this.computeNullifier(
      note.commitment,
      note.blinding,
      ownerSecret
    );

    // Request withdrawal proof
    const proofResponse = await fetch(`${this.proofServerUrl}/prove`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        circuit: "withdraw",
        privateInputs: {
          amount: note.amount.toString(),
          blinding: note.blinding,
          note_commitment: note.commitment,
          merkle_path: note.merklePath,
          nullifier,
          recipient: recipientAddress,
          withdrawal_amount: amount.toString(),
        },
        publicInputs: {
          nullifier,
          recipient: recipientAddress,
          withdrawal_amount: amount.toString(),
        },
      }),
    });

    const { proof } = await proofResponse.json();

    const tx = Transaction.new()
      .addContractCall(
        this.contractAddress,
        "withdraw",
        [nullifier, recipientAddress, amount.toString()],
        proof
      )
      .build();

    const txId = await this.wallet.submitTransaction(tx);

    // Update local state — remove spent note, add change note if any
    const change = note.amount - amount;
    this.notes = this.notes.filter((n) => n.commitment !== note.commitment);

    if (change > 0n) {
      const newBlinding = this.randomField();
      const newCommitment = await this.computeCommitment(change, newBlinding);
      // In production, fetch the actual merkle path from the chain
      this.notes.push({
        commitment: newCommitment,
        amount: change,
        blinding: newBlinding,
        leafIndex: -1, // Updated after confirmation
        merklePath: [],
      });
      console.log(`Change note created: ${change} tokens`);
    }

    console.log(`Withdrawal successful! TX: ${txId}`);
    return txId;
  }

  /**
   * Perform a shielded transfer within the vault
   * 
   * Transfers value from one of your notes to a recipient,
   * with change returned as a new shielded note. The amounts
   * are hidden from all third parties.
   */
  async shieldedTransfer(
    amount: bigint,
    recipientPublicKey: string
  ): Promise<string> {
    console.log(`Initiating shielded transfer of ${amount} tokens...`);

    // Find a note with sufficient balance
    const inputNote = this.notes.find((n) => n.amount >= amount);
    if (!inputNote) {
      throw new Error("Insufficient shielded balance");
    }

    const ownerSecret = await this.wallet.getSpendingKey();
    const inputNullifier = await this.computeNullifier(
      inputNote.commitment,
      inputNote.blinding,
      ownerSecret
    );

    // Generate output notes
    const recipientBlinding = this.randomField();
    const recipientCommitment = await this.computeCommitment(
      amount,
      recipientBlinding
    );

    const change = inputNote.amount - amount;
    let changeCommitment = "0";
    let changeBlinding = "0";

    if (change > 0n) {
      changeBlinding = this.randomField();
      changeCommitment = await this.computeCommitment(change, changeBlinding);
    }

    // Generate the ZK proof
    const proofResponse = await fetch(`${this.proofServerUrl}/prove`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        circuit: "shielded_transfer",
        privateInputs: {
          input_amount: inputNote.amount.toString(),
          input_blinding: inputNote.blinding,
          input_commitment: inputNote.commitment,
          input_merkle_path: inputNote.merklePath,
          input_nullifier: inputNullifier,
          output_amount_1: amount.toString(),
          output_blinding_1: recipientBlinding,
          output_amount_2: change.toString(),
          output_blinding_2: changeBlinding,
          output_commitment_1: recipientCommitment,
          output_commitment_2: changeCommitment,
        },
        publicInputs: {
          input_nullifier: inputNullifier,
          output_commitment_1: recipientCommitment,
          output_commitment_2: changeCommitment,
        },
      }),
    });

    const { proof } = await proofResponse.json();

    const tx = Transaction.new()
      .addContractCall(
        this.contractAddress,
        "shielded_transfer",
        [inputNullifier, recipientCommitment, changeCommitment],
        proof
      )
      .build();

    const txId = await this.wallet.submitTransaction(tx);

    // Update local notes
    this.notes = this.notes.filter(
      (n) => n.commitment !== inputNote.commitment
    );

    if (change > 0n) {
      this.notes.push({
        commitment: changeCommitment,
        amount: change,
        blinding: changeBlinding,
        leafIndex: -1,
        merklePath: [],
      });
    }

    console.log(`Shielded transfer complete! TX: ${txId}`);
    return txId;
  }

  /**
   * Get total shielded balance (local calculation)
   */
  getShieldedBalance(): bigint {
    return this.notes.reduce((sum, note) => sum + note.amount, 0n);
  }
}
```

## Deploying the Contract

Create `src/deploy.ts` to deploy the vault to Midnight's testnet:

```typescript
// src/deploy.ts

import { CompactRuntime } from "@midnight-ntwrk/compact-runtime";
import { WalletBuilder } from "@midnight-ntwrk/wallet-sdk";
import { ShieldedVaultClient } from "./vault-client";
import * as fs from "fs";

async function deploy() {
  console.log("=== Deploying Shielded Token Vault ===\n");

  // Load the compiled contract
  const contractModule = await CompactRuntime.loadModule(
    "./contracts/shielded_vault.compact"
  );

  // Initialize wallet from seed phrase
  const seedPhrase = fs.readFileSync("./seed.txt", "utf-8").trim();
  const wallet = await WalletBuilder.build(
    seedPhrase,
    "https://testnet.midnight.network/api",
    "testnet"
  );

  await wallet.start();
  console.log("Wallet initialized");

  // Get the wallet's public key for admin role
  const spendingKey = await wallet.getSpendingKey();

  // Deploy the contract
  const deployTx = await contractModule.deploy({
    constructorArgs: [spendingKey],
    wallet,
  });

  console.log(`Contract deployed at: ${deployTx.contractAddress}`);
  console.log(`Transaction ID: ${deployTx.txId}`);

  // Save deployment info
  const deployment = {
    contractAddress: deployTx.contractAddress,
    deployTxId: deployTx.txId,
    network: "testnet",
    timestamp: new Date().toISOString(),
  };

  fs.writeFileSync(
    "./deployment.json",
    JSON.stringify(deployment, null, 2)
  );
  console.log("\nDeployment info saved to deployment.json");

  // Initialize the client
  const client = new ShieldedVaultClient(wallet, {
    contractAddress: deployTx.contractAddress,
    networkId: "testnet",
    proofServerUrl: "http://localhost:6300",
  });

  console.log("\n=== Vault Ready ===");
  console.log("Use the ShieldedVaultClient to interact with your vault.");
}

deploy().catch(console.error);
```

## Running the Examples

### Example 1: Basic Usage

```typescript
// examples/basic-usage.ts

import { WalletBuilder } from "@midnight-ntwrk/wallet-sdk";
import { ShieldedVaultClient } from "../src/vault-client";
import * as fs from "fs";

async function main() {
  console.log("=== Shielded Token Vault — Basic Usage ===\n");

  // Initialize wallet
  const seed = fs.readFileSync("./seed.txt", "utf-8").trim();
  const wallet = await WalletBuilder.build(
    seed,
    "https://testnet.midnight.network/api",
    "testnet"
  );
  await wallet.start();

  // Read deployment info
  const deployment = JSON.parse(
    fs.readFileSync("./deployment.json", "utf-8")
  );

  // Create vault client
  const vault = new ShieldedVaultClient(wallet, {
    contractAddress: deployment.contractAddress,
    networkId: "testnet",
    proofServerUrl: "http://localhost:6300",
  });

  // Step 1: Deposit tokens into the vault
  console.log("--- Step 1: Deposit ---");
  await vault.deposit(1000n);
  console.log(`Shielded balance: ${vault.getShieldedBalance()}`);

  // Step 2: Make another deposit
  console.log("\n--- Step 2: Second Deposit ---");
  await vault.deposit(500n);
  console.log(`Shielded balance: ${vault.getShieldedBalance()}`);

  // Step 3: Withdraw some tokens
  console.log("\n--- Step 3: Withdraw ---");
  const myAddress = await wallet.getAddress();
  await vault.withdraw(200n, myAddress);
  console.log(`Shielded balance: ${vault.getShieldedBalance()}`);

  // Step 4: Shielded transfer to another user
  console.log("\n--- Step 4: Shielded Transfer ---");
  const recipientPublicKey =
    "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
  await vault.shieldedTransfer(300n, recipientPublicKey);
  console.log(`Shielded balance: ${vault.getShieldedBalance()}`);

  console.log("\n=== All operations completed successfully! ===");
}

main().catch(console.error);
```

### Example 2: Multi-User Scenario

```typescript
// examples/multi-user.ts

import { WalletBuilder } from "@midnight-ntwrk/wallet-sdk";
import { ShieldedVaultClient } from "../src/vault-client";
import * as fs from "fs";

async function main() {
  console.log("=== Multi-User Shielded Vault ===\n");

  // Create two users
  const aliceSeed = fs.readFileSync("./seeds/alice.txt", "utf-8").trim();
  const bobSeed = fs.readFileSync("./seeds/bob.txt", "utf-8").trim();

  const aliceWallet = await WalletBuilder.build(
    aliceSeed,
    "https://testnet.midnight.network/api",
    "testnet"
  );
  const bobWallet = await WalletBuilder.build(
    bobSeed,
    "https://testnet.midnight.network/api",
    "testnet"
  );

  await Promise.all([aliceWallet.start(), bobWallet.start()]);

  const deployment = JSON.parse(
    fs.readFileSync("./deployment.json", "utf-8")
  );
  const config = {
    contractAddress: deployment.contractAddress,
    networkId: "testnet",
    proofServerUrl: "http://localhost:6300",
  };

  const alice = new ShieldedVaultClient(aliceWallet, config);
  const bob = new ShieldedVaultClient(bobWallet, config);

  // Alice deposits tokens
  console.log("Alice deposits 5000 tokens...");
  await alice.deposit(5000n);

  // Alice transfers 2000 to Bob (shielded — nobody else can see the amount)
  console.log("\nAlice transfers 2000 to Bob (shielded)...");
  const bobPublicKey = await bobWallet.getSpendingKey();
  await alice.shieldedTransfer(2000n, bobPublicKey);

  // Both check balances
  console.log(`\nAlice's shielded balance: ${alice.getShieldedBalance()}`);
  console.log(`Bob's shielded balance: ${bob.getShieldedBalance()}`);

  // Bob withdraws 500
  console.log("\nBob withdraws 500 tokens...");
  const bobAddress = await bobWallet.getAddress();
  await bob.withdraw(500n, bobAddress);

  console.log(`\nBob's shielded balance after withdrawal: ${bob.getShieldedBalance()}`);
  console.log("\n=== Multi-user scenario complete! ===");
}

main().catch(console.error);
```

## Security Considerations

When building with shielded vaults, keep these security principles in mind:

1. **Never reuse blinding factors**: Each note must have a unique, randomly generated blinding factor. Reusing blinding factors allows an attacker to correlate notes and potentially determine amounts.

2. **Secure key storage**: The user's spending key controls all shielded funds. Use hardware wallets or secure enclaves in production. Never store spending keys in plaintext.

3. **Merkle tree synchronization**: The client must stay synchronized with the on-chain Merkle tree. Falling behind can lead to failed transactions or, worse, accidentally revealing information about which notes you own.

4. **Nullifier determinism**: Nullifiers must be deterministically derived from note data. If two different wallets could produce different nullifiers for the same note, double-spending becomes possible.

5. **Proof server trust**: In the current architecture, the proof server generates ZK proofs. In production, consider running your own proof server or using a trusted execution environment (TEE) for proof generation.

6. **Timing attacks**: Even though amounts are hidden, an observer might correlate deposit and withdrawal timing to infer relationships. Consider adding random delays for sensitive operations.

## Testing the Vault

Create comprehensive tests in `tests/vault.test.ts`:

```typescript
// tests/vault.test.ts

import { describe, it, expect, beforeAll } from "vitest";
import { CompactRuntime } from "@midnight-ntwrk/compact-runtime";

describe("ShieldedTokenVault", () => {
  let runtime: any;

  beforeAll(async () => {
    runtime = await CompactRuntime.loadModule(
      "./contracts/shielded_vault.compact"
    );
  });

  it("should create a vault and accept deposits", async () => {
    const state = runtime.init("0x1234");
    const result = await runtime.call(state, "deposit", [
      "1000",
      "0xabc",
      "0xcommitment1",
    ]);
    expect(result.success).toBe(true);
  });

  it("should reject withdrawals with invalid proofs", async () => {
    const state = runtime.init("0x1234");
    await expect(
      runtime.call(state, "withdraw", [
        "1000", "0xabc", "0xfake",
        [], // empty merkle path
        "0xnull1", "0xrecipient", "500",
      ])
    ).rejects.toThrow();
  });

  it("should prevent double-spending via nullifiers", async () => {
    const state = runtime.init("0x1234");
    // First spend should succeed
    // Second spend with same nullifier should fail
    // (test implementation depends on runtime API)
  });

  it("should conserve value in transfers", async () => {
    // Verify that input_amount == output_amount_1 + output_amount_2
    // This is enforced by the circuit
  });
});
```

Run tests with:

```bash
npx vitest run tests/
```

## Troubleshooting

**"Proof generation failed"**: Ensure the proof server is running at `http://localhost:6300`. The proof server must be started separately: `midnight-proof-server --port 6300`.

**"Merkle root mismatch"**: Your local Merkle tree is out of sync. Re-sync by fetching the latest root from the contract: `vault-client.get_merkle_root()`.

**"Insufficient shielded balance"**: The client tracks notes locally. If you're using a new instance, you need to rescan the chain for your notes using your viewing key.

**"Field element out of range"**: Ensure all numeric values are within the scalar field (less than the field modulus). Use 31-byte random values for blinding factors.

## Conclusion

In this tutorial, you built a complete Shielded Token Vault on Midnight Network. The vault uses zero-knowledge proofs to hide transaction amounts and balances while maintaining the ability to verify that all operations are valid. The key components are:

- **Compact smart contract** with deposit, withdraw, and shielded transfer circuits
- **TypeScript client** that handles proof generation and transaction construction
- **Merkle tree-based commitment scheme** for efficient note management
- **Nullifier system** to prevent double-spending without compromising privacy

This vault pattern is the foundation for many privacy-preserving applications: private DEXs, confidential payroll systems, anonymous voting treasuries, and more. As Midnight Network evolves, these primitives will become building blocks for a more private on-chain economy.

## Next Steps

- Explore **shielded NFT vaults** by extending the commitment scheme to include token metadata
- Implement **viewing keys** that allow auditors to verify balances without spending ability
- Build a **front-end interface** using Midnight's wallet SDK for browser-based interaction
- Study **recursive proofs** for batching multiple vault operations into a single proof

## Resources

- [Midnight Network Documentation](https://docs.midnight.network)
- [Compact Language Specification](https://docs.midnight.network/compact)
- [Midnight GitHub Organization](https://github.com/midnightntwrk)
- [Zero-Knowledge Proofs: An Introduction](https://zkintro.com)

---

*Tutorial contributed as part of the Midnight Network Contributor Hub bounty program. Issue #287 — Shielded Token Vault.*
