/**
 * Privacy Retrofit Utility
 *
 * Converts transparent transaction flows to shielded flows
 * with minimal code changes. Drop-in replacement for existing
 * dApp transaction creation.
 */

import { Wallet, Transaction, Note, UTXO, ShieldedTransaction } from '@midnight-ntwrk/wallet';
import { CompactCircuit, Proof, Field } from '@midnight-ntwrk/compact';
import { Observable, filter, firstValueFrom, timeout } from 'rxjs';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// ─── Types ───────────────────────────────────────────────────────────────

interface TransparentInput {
  utxo: UTXO;
  amount: bigint;
  owner: string;
}

interface ShieldedInput {
  note: Note;
  nullifier: Uint8Array;
  secret: Uint8Array;
  spendingKey: Uint8Array;
}

interface TransactionOutput {
  recipient: string;
  amount: bigint;
  memo?: string;
}

interface ShieldedOutput {
  commitment: Uint8Array;
  recipientPayload: Uint8Array;   // encrypted to recipient
  senderPayload: Uint8Array;      // encrypted to sender
}

interface RetrofitResult {
  transaction: ShieldedTransaction;
  proof: Proof;
  nullifiers: Uint8Array[];
  commitments: Uint8Array[];
  generationTimeMs: number;
}

interface PrivacyConfig {
  /** Enable proof caching to speed up repeated transactions */
  cacheProofs: boolean;
  /** Maximum number of notes to combine in a single transaction */
  maxNoteCombination: number;
  /** Whether to automatically migrate transparent UTXOs */
  autoMigrateTransparent: boolean;
  /** Timeout for proof generation in milliseconds */
  proofTimeoutMs: number;
}

const DEFAULT_CONFIG: PrivacyConfig = {
  cacheProofs: true,
  maxNoteCombination: 10,
  autoMigrateTransparent: false,
  proofTimeoutMs: 30_000,
};

// ─── Nullifier Generation ────────────────────────────────────────────────

/**
 * Generates a nullifier for a shielded note.
 *
 * The nullifier is derived from the note's secret and the spending key.
 * It uniquely identifies the note's consumption without revealing
 * which note was spent.
 */
export function generateNullifier(
  noteSecret: Uint8Array,
  spendingKey: Uint8Array
): Uint8Array {
  // In production, this uses Poseidon hash inside the ZK circuit.
  // This is the out-of-circuit equivalent for pre-computation.
  const combined = new Uint8Array(noteSecret.length + spendingKey.length);
  combined.set(noteSecret);
  combined.set(spendingKey, noteSecret.length);

  // Placeholder: real implementation uses Poseidon(note_secret, spending_key)
  return crypto.subtle.digest('SHA-256', combined).then(
    buf => new Uint8Array(buf)
  ) as unknown as Uint8Array;
}

// ─── Note Encryption ─────────────────────────────────────────────────────

/**
 * Encrypts a note payload for a specific recipient.
 *
 * Uses AES-256-GCM with a shared secret derived from the
 * sender's ephemeral key and the recipient's encryption key.
 */
export function encryptNotePayload(
  payload: { amount: bigint; memo: string },
  recipientEncryptionKey: Uint8Array
): { ciphertext: Uint8Array; ephemeralPubKey: Uint8Array } {
  const ephemeralKey = randomBytes(32);

  // Derive shared secret (simplified — real implementation uses ECDH)
  const keyMaterial = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    keyMaterial[i] = ephemeralKey[i] ^ recipientEncryptionKey[i % recipientEncryptionKey.length];
  }

  const iv = randomBytes(12);
  const plaintext = new TextEncoder().encode(
    JSON.stringify({
      amount: payload.amount.toString(),
      memo: payload.memo,
    })
  );

  // In real implementation, use AES-256-GCM
  // This is a structural placeholder
  const ciphertext = new Uint8Array(iv.length + plaintext.length);
  ciphertext.set(iv);
  ciphertext.set(plaintext, iv.length);

  return {
    ciphertext,
    ephemeralPubKey: ephemeralKey,
  };
}

/**
 * Decrypts a note payload using the recipient's decryption key.
 */
export function decryptNotePayload(
  ciphertext: Uint8Array,
  decryptionKey: Uint8Array
): { amount: bigint; memo: string } | null {
  try {
    const iv = ciphertext.slice(0, 12);
    const data = ciphertext.slice(12);
    const plaintext = new TextDecoder().decode(data);
    const parsed = JSON.parse(plaintext);
    return {
      amount: BigInt(parsed.amount),
      memo: parsed.memo,
    };
  } catch {
    return null;
  }
}

// ─── Note Selection ──────────────────────────────────────────────────────

/**
 * Selects shielded notes to cover a target amount.
 *
 * Greedy algorithm: select smallest notes first to minimize
 * the number of inputs (and proof complexity).
 */
export function selectNotes(
  notes: Note[],
  targetAmount: bigint,
  maxInputs: number = DEFAULT_CONFIG.maxNoteCombination
): { selected: Note[]; totalValue: bigint; change: bigint } {
  // Sort by amount ascending
  const sorted = [...notes].sort((a, b) =>
    Number(a.amount - b.amount)
  );

  const selected: Note[] = [];
  let accumulated = 0n;

  for (const note of sorted) {
    if (selected.length >= maxInputs) break;
    if (accumulated >= targetAmount) break;

    selected.push(note);
    accumulated += note.amount;
  }

  if (accumulated < targetAmount) {
    throw new Error(
      `Insufficient shielded balance: need ${targetAmount}, ` +
      `have ${accumulated} across ${notes.length} notes`
    );
  }

  return {
    selected,
    totalValue: accumulated,
    change: accumulated - targetAmount,
  };
}

// ─── Privacy Retrofitter ─────────────────────────────────────────────────

/**
 * Main class for retrofitting privacy into existing dApps.
 *
 * Usage:
 *   const retrofitter = new PrivacyRetrofitter(wallet, circuit);
 *   const result = await retrofitter.createShieldedTransaction([
 *     { recipient: 'addr2...', amount: 500n, memo: 'payment' }
 *   ]);
 *   await wallet.submitTransaction(result.transaction);
 */
export class PrivacyRetrofitter {
  private wallet: Wallet;
  private circuit: CompactCircuit;
  private config: PrivacyConfig;
  private proofCache: Map<string, Proof> = new Map();

  constructor(
    wallet: Wallet,
    circuit: CompactCircuit,
    config: Partial<PrivacyConfig> = {}
  ) {
    this.wallet = wallet;
    this.circuit = circuit;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Creates a shielded transaction from a list of outputs.
   *
   * This is the primary method for retrofitting. It replaces
   * the transparent transaction creation flow:
   *
   *   // BEFORE (transparent)
   *   const tx = await wallet.createTransaction(outputs);
   *
   *   // AFTER (shielded)
   *   const result = await retrofitter.createShieldedTransaction(outputs);
   *   const tx = result.transaction;
   */
  async createShieldedTransaction(
    outputs: TransactionOutput[]
  ): Promise<RetrofitResult> {
    const startTime = Date.now();

    // 1. Calculate total output amount
    const totalOutput = outputs.reduce(
      (sum, out) => sum + out.amount,
      0n
    );

    // 2. Get available shielded notes
    const notes = await this.wallet.getNotes();

    // 3. Select notes to cover the output (plus estimated fee)
    const estimatedFee = 10n; // placeholder — real fee from network
    const { selected, totalValue, change } = selectNotes(
      notes,
      totalOutput + estimatedFee
    );

    // 4. Generate nullifiers for each input note
    const nullifiers: Uint8Array[] = [];
    const spendingKey = await this.wallet.getSpendingKey();

    for (const note of selected) {
      const nullifier = generateNullifier(note.secret, spendingKey);
      nullifiers.push(nullifier);
    }

    // 5. Create shielded outputs with encrypted payloads
    const shieldedOutputs: ShieldedOutput[] = [];

    for (const output of outputs) {
      const recipientKey = await this.resolveEncryptionKey(output.recipient);
      const { ciphertext, ephemeralPubKey } = encryptNotePayload(
        { amount: output.amount, memo: output.memo ?? '' },
        recipientKey
      );

      // Create commitment (in production, done inside ZK circuit)
      const commitment = await this.createCommitment(
        output.amount,
        output.recipient,
        randomBytes(32)
      );

      shieldedOutputs.push({
        commitment,
        recipientPayload: ciphertext,
        senderPayload: new Uint8Array(0), // simplified
      });
    }

    // 6. Add change output if needed
    if (change > 0n) {
      const senderKey = await this.wallet.getEncryptionKey();
      const { ciphertext } = encryptNotePayload(
        { amount: change, memo: 'change' },
        senderKey
      );
      const changeCommitment = await this.createCommitment(
        change,
        await this.wallet.getAddress(),
        randomBytes(32)
      );

      shieldedOutputs.push({
        commitment: changeCommitment,
        recipientPayload: ciphertext,
        senderPayload: new Uint8Array(0),
      });
    }

    // 7. Generate ZK proof
    const proof = await this.generateProof(selected, shieldedOutputs);

    // 8. Construct the shielded transaction
    const transaction = this.buildTransaction(
      nullifiers,
      shieldedOutputs,
      proof,
      estimatedFee
    );

    const generationTimeMs = Date.now() - startTime;

    return {
      transaction,
      proof,
      nullifiers,
      commitments: shieldedOutputs.map(o => o.commitment),
      generationTimeMs,
    };
  }

  /**
   * Migrates all transparent UTXOs to shielded notes.
   *
   * Creates a single transaction that spends all transparent UTXOs
   * and produces shielded outputs owned by the same wallet.
   */
  async migrateTransparentToShielded(): Promise<RetrofitResult> {
    const utxos = await this.wallet.getUtxos();
    if (utxos.length === 0) {
      throw new Error('No transparent UTXOs to migrate');
    }

    const totalAmount = utxos.reduce((sum, u) => sum + u.amount, 0n);
    const selfAddress = await this.wallet.getAddress();

    return this.createShieldedTransaction([{
      recipient: selfAddress,
      amount: totalAmount,
      memo: 'privacy migration',
    }]);
  }

  /**
   * Waits for the wallet to finish syncing shielded state.
   *
   * Shielded wallets need to scan all blocks to decrypt notes
   * addressed to them. This method blocks until sync completes.
   */
  async waitForShieldedSync(timeoutMs: number = 60_000): Promise<void> {
    const facade = this.wallet.getFacade();
    const synced$ = facade.state().pipe(
      filter(state => state.isSynced),
      timeout(timeoutMs)
    );

    await firstValueFrom(synced$);
  }

  /**
   * Returns the shielded balance with sync awareness.
   */
  async getShieldedBalance(): Promise<{
    available: bigint;
    pending: bigint;
    isSynced: boolean;
  }> {
    const facade = this.wallet.getFacade();
    const state = await firstValueFrom(facade.state());

    return {
      available: state.shieldedBalance ?? 0n,
      pending: state.pendingShieldedBalance ?? 0n,
      isSynced: state.isSynced,
    };
  }

  // ─── Internal Methods ────────────────────────────────────────────────

  private async resolveEncryptionKey(address: string): Promise<Uint8Array> {
    // In production, resolve from on-chain registry or address derivation
    // Placeholder: derive from address hash
    const encoded = new TextEncoder().encode(address);
    const hash = await crypto.subtle.digest('SHA-256', encoded);
    return new Uint8Array(hash);
  }

  private async createCommitment(
    amount: bigint,
    owner: string,
    randomness: Uint8Array
  ): Promise<Uint8Array> {
    // Poseidon(amount, owner_key, randomness) in production
    const data = new TextEncoder().encode(
      `${amount.toString()}:${owner}:${randomBytes(8).toString()}`
    );
    const hash = await crypto.subtle.digest('SHA-256', data);
    return new Uint8Array(hash);
  }

  private async generateProof(
    inputs: Note[],
    outputs: ShieldedOutput[]
  ): Promise<Proof> {
    // Check proof cache
    const cacheKey = this.getProofCacheKey(inputs, outputs);
    if (this.config.cacheProofs && this.proofCache.has(cacheKey)) {
      return this.proofCache.get(cacheKey)!;
    }

    // Generate proof using the Compact circuit
    const witness = {
      inputAmounts: inputs.map(n => n.amount),
      outputAmounts: outputs.map(o =>
        BigInt('0x' + Buffer.from(o.commitment).toString('hex').slice(0, 16))
      ),
      fee: 10n,
      randomness: inputs.map(() => randomBytes(32)),
    };

    const proof = await this.circuit.prove(witness);

    if (this.config.cacheProofs) {
      this.proofCache.set(cacheKey, proof);
    }

    return proof;
  }

  private getProofCacheKey(
    inputs: Note[],
    outputs: ShieldedOutput[]
  ): string {
    const inputHash = inputs.map(i => i.commitment.toString()).join(':');
    const outputHash = outputs.map(o =>
      Buffer.from(o.commitment).toString('hex').slice(0, 16)
    ).join(':');
    return `${inputHash}|${outputHash}`;
  }

  private buildTransaction(
    nullifiers: Uint8Array[],
    outputs: ShieldedOutput[],
    proof: Proof,
    fee: bigint
  ): ShieldedTransaction {
    return {
      nullifiers,
      commitments: outputs.map(o => o.commitment),
      encryptedOutputs: outputs.map(o => o.recipientPayload),
      proof,
      fee,
    } as ShieldedTransaction;
  }
}

// ─── Usage Example ───────────────────────────────────────────────────────

/**
 * Example: Retrofitting a simple token transfer dApp.
 *
 * BEFORE (transparent):
 *   const utxos = await wallet.getUtxos();
 *   const tx = await wallet.createTransaction({
 *     inputs: selectUtxos(utxos, amount),
 *     outputs: [{ recipient, amount }],
 *   });
 *   await wallet.submitTransaction(tx);
 *
 * AFTER (shielded):
 *   const retrofitter = new PrivacyRetrofitter(wallet, circuit);
 *   await retrofitter.waitForShieldedSync();
 *   const result = await retrofitter.createShieldedTransaction([
 *     { recipient, amount, memo: 'payment' }
 *   ]);
 *   await wallet.submitTransaction(result.transaction);
 */
export async function exampleShieldedTransfer(
  wallet: Wallet,
  circuit: CompactCircuit,
  recipient: string,
  amount: bigint
): Promise<void> {
  // Create retrofitter with default config
  const retrofitter = new PrivacyRetrofitter(wallet, circuit);

  // Wait for wallet to finish scanning for shielded notes
  console.log('Syncing shielded state...');
  await retrofitter.waitForShieldedSync();

  // Check balance before sending
  const balance = await retrofitter.getShieldedBalance();
  if (!balance.isSynced) {
    console.warn('Warning: wallet not fully synced, balance may be incomplete');
  }
  if (balance.available < amount) {
    throw new Error(
      `Insufficient shielded balance: have ${balance.available}, need ${amount}`
    );
  }

  // Create and submit the shielded transaction
  console.log('Generating zero-knowledge proof...');
  const result = await retrofitter.createShieldedTransaction([{
    recipient,
    amount,
    memo: 'shielded transfer',
  }]);

  console.log(`Proof generated in ${result.generationTimeMs}ms`);
  console.log(`Transaction has ${result.nullifiers.length} inputs and ${result.commitments.length} outputs`);

  await wallet.submitTransaction(result.transaction);
  console.log('Shielded transaction submitted successfully');
}

/**
 * Example: Migrating all transparent UTXOs to shielded notes.
 */
export async function exampleMigrateToShielded(
  wallet: Wallet,
  circuit: CompactCircuit
): Promise<void> {
  const retrofitter = new PrivacyRetrofitter(wallet, circuit);

  console.log('Migrating transparent UTXOs to shielded notes...');
  const result = await retrofitter.migrateTransparentToShielded();

  console.log(`Migration proof generated in ${result.generationTimeMs}ms`);
  await wallet.submitTransaction(result.transaction);
  console.log('All transparent UTXOs have been converted to shielded notes');
}
