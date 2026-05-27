# Midnight dApp Security Checklist: Pre-Deployment Audit Guide

*A practical checklist every Midnight developer should run before shipping to mainnet.*

## Introduction

Deploying a dApp on Midnight Network involves zero-knowledge proofs, privacy-preserving smart contracts, and a novel cryptographic stack. Unlike traditional blockchain deployments, Midnight's Compact language and proof server introduce unique security considerations. Missing a single check can lead to secret leaks, replay attacks, or broken proofs that silently fail in production.

This guide provides a durable, repeatable checklist you can run before every deployment. Each section includes concrete verification steps, code examples, and common pitfalls.

## 1. `disclose()` Audit: No Secret Leaks

The `disclose()` function in Compact exposes data from the shielded state to the public ledger. Any field passed to `disclose()` becomes permanently visible on-chain.

### What to Check

```compact
// ❌ BAD: Disclosing secret user data
contract BadExample {
  ledger secret_balance: Counter;
  
  export circuit check_balance(owner: PublicKey): Field {
    disclose(secret_balance.value);  // Leaks balance to public ledger!
    return secret_balance.value;
  }
}

// ✅ GOOD: Only disclose what's necessary
contract GoodExample {
  ledger balance: EncryptedCounter;
  
  export circuit verify_sufficient(amount: Field): Boolean {
    // Prove sufficiency without revealing actual balance
    return balance.value >= amount;
  }
}
```

### Audit Steps

1. **Search all `disclose()` calls** in your contract:
   ```bash
   grep -rn "disclose(" contracts/ --include="*.compact"
   ```

2. **For each call, verify:**
   - Is the disclosed field intentionally public?
   - Could an observer derive sensitive data from the disclosed value?
   - Is there a privacy-preserving alternative (e.g., range proof instead of exact value)?

3. **Check indirect disclosures** via return values. Public circuit outputs are visible to everyone.

4. **Review event emissions** — if your contract emits events, ensure they don't leak secrets.

### Common Pitfalls

- Disclosing timestamps that reveal user activity patterns
- Exposing partial addresses that enable correlation attacks
- Returning boolean results that leak information about private state (e.g., `balance >= amount` reveals balance is at least `amount`)

## 2. `ownPublicKey()` Usage Review

The `ownPublicKey()` function returns the public key of the circuit caller. While useful for authorization, it has known vulnerability patterns.

### What to Check

```compact
// ❌ BAD: Using ownPublicKey() for authorization without proof of ownership
contract VulnerableAuth {
  ledger authorized: Mapping<PublicKey, Boolean>;
  
  export circuit add_authorized(user: PublicKey): Void {
    // Anyone can call this with any public key!
    authorized.insert(user, true);
  }
  
  export circuit check_access(): Boolean {
    return authorized.get(ownPublicKey());  // Relies on self-reported identity
  }
}

// ✅ GOOD: Require signature proof
contract SecureAuth {
  ledger nonces: Mapping<PublicKey, Counter>;
  
  export circuit authenticated_action(
    signature: Signature,
    nonce: Field
  ): Void {
    const caller = ownPublicKey();
    const expected_nonce = nonces.get(caller).value;
    assert(nonce == expected_nonce, "Invalid nonce");
    
    // Verify signature to prove key ownership
    assert(verify(signature, caller, nonce), "Invalid signature");
    nonces.insert(caller, Counter { value: nonce + 1 });
  }
}
```

### Audit Steps

1. **Find all `ownPublicKey()` usage:**
   ```bash
   grep -rn "ownPublicKey(" contracts/ --include="*.compact"
   ```

2. **For each usage, verify:**
   - Is the caller's identity actually verified, or just assumed?
   - Is there a signature check that proves key ownership?
   - Could an attacker spoof the caller by passing a different public key?

3. **Check for authorization bypasses** where `ownPublicKey()` is used in access control without cryptographic proof.

### Known Vulnerability Pattern

The `ownPublicKey()` function returns the key from the circuit's witness data. Without a corresponding signature verification, an attacker can construct a valid proof using any public key, effectively impersonating any user.

## 3. Replay Protection Verification

Replay attacks allow an attacker to resubmit a valid transaction multiple times. Midnight uses nonces and nullifiers to prevent this.

### What to Check

```compact
// ❌ BAD: No replay protection
contract VulnerableTransfer {
  ledger balances: Mapping<PublicKey, Counter>;
  
  export circuit transfer(to: PublicKey, amount: Field): Void {
    const from = ownPublicKey();
    const from_balance = balances.get(from).value;
    assert(from_balance >= amount, "Insufficient balance");
    balances.insert(from, Counter { value: from_balance - amount });
    balances.insert(to, Counter { value: balances.get(to).value + amount });
    // Same proof can be submitted multiple times!
  }
}

// ✅ GOOD: Nonce-based replay protection
contract SecureTransfer {
  ledger balances: Mapping<PublicKey, Counter>;
  ledger nonces: Mapping<PublicKey, Counter>;
  
  export circuit transfer(
    to: PublicKey,
    amount: Field,
    nonce: Field,
    signature: Signature
  ): Void {
    const from = ownPublicKey();
    
    // Verify nonce
    const expected_nonce = nonces.get(from).value;
    assert(nonce == expected_nonce, "Invalid nonce");
    
    // Verify signature
    assert(verify(signature, from, nonce), "Invalid signature");
    
    // Execute transfer
    const from_balance = balances.get(from).value;
    assert(from_balance >= amount, "Insufficient balance");
    balances.insert(from, Counter { value: from_balance - amount });
    balances.insert(to, Counter { value: balances.get(to).value + amount });
    
    // Increment nonce
    nonces.insert(from, Counter { value: nonce + 1 });
  }
}
```

### Audit Steps

1. **Verify nonce implementation:**
   - Does each state-changing circuit check a nonce?
   - Is the nonce incremented after each successful execution?
   - Is the nonce stored in the ledger (not just in the witness)?

2. **Check for nullifier usage:**
   - For one-time operations (e.g., claiming airdrops), verify nullifiers are used
   - Ensure nullifiers are derived from unique, unpredictable data

3. **Test replay attack:**
   ```typescript
   // Test: Submit the same transaction twice
   const tx1 = await contract.transfer(recipient, 100, nonce, signature);
   const tx2 = await contract.transfer(recipient, 100, nonce, signature);
   // tx2 should fail with "Invalid nonce" error
   ```

## 4. Exported Ledger Field Review

Ledger fields define the public state of your contract. Incorrect visibility or typing can expose sensitive data.

### What to Check

```compact
contract FieldReview {
  // ❌ BAD: Sensitive data as public ledger field
  ledger user_emails: Mapping<PublicKey, Bytes<256>>;  // Emails visible to all!
  
  // ✅ GOOD: Encrypted or hashed storage
  ledger email_hashes: Mapping<PublicKey, Field>;  // Only hashes are public
  // Store actual emails off-chain or in encrypted notes
}
```

### Audit Steps

1. **List all ledger fields:**
   ```bash
   grep -n "ledger " contracts/*.compact
   ```

2. **For each field, verify:**
   - Is the data type appropriate? (Use `Field` for private data, not `Bytes`)
   - Is the field intentionally public?
   - Could the field value be used to infer private information?

3. **Check mapping key privacy:**
   - `Mapping<PublicKey, T>` keys are visible on-chain
   - Consider using hashed keys for privacy

4. **Review counter initialization:**
   - Ensure `Counter` fields start at the correct value
   - Verify increment logic prevents overflow

## 5. Witness Implementation Correctness

Witnesses provide private inputs to circuits. Incorrect witness logic can lead to invalid proofs or security vulnerabilities.

### What to Check

```typescript
// witness.ts — The witness implementation
export const witness = {
  // ❌ BAD: Witness doesn't validate inputs
  transfer_amount: (private_key: Uint8Array, amount: bigint): bigint => {
    return amount;  // No validation!
  },
  
  // ✅ GOOD: Witness validates and constrains inputs
  transfer_amount: (private_key: Uint8Array, amount: bigint): bigint => {
    if (amount <= 0n) throw new Error("Amount must be positive");
    if (amount > MAX_TRANSFER) throw new Error("Amount exceeds maximum");
    return amount;
  },
};
```

### Audit Steps

1. **Verify all witness functions are implemented:**
   - Every circuit input needs a corresponding witness
   - Missing witnesses cause proof generation failures

2. **Check input validation:**
   - Are numeric inputs bounded?
   - Are string inputs length-checked?
   - Are array inputs size-verified?

3. **Test edge cases:**
   ```typescript
   // Test with zero values
   await expect(contract.transfer(0)).rejects.toThrow();
   
   // Test with maximum values
   await expect(contract.transfer(MAX_VALUE)).resolves.toBeDefined();
   
   // Test with negative values (if applicable)
   await expect(contract.transfer(-1)).rejects.toThrow();
   ```

4. **Verify witness consistency:**
   - Witness outputs must match the circuit's expected types
   - Ensure witnesses don't produce values that violate circuit constraints

## 6. Version Compatibility Confirmation

Midnight's SDK and Compact compiler evolve rapidly. Version mismatches can cause silent failures.

### What to Check

```json
// package.json — Verify compatible versions
{
  "dependencies": {
    "@midnight-ntwrk/compact-runtime": "^0.8.0",
    "@midnight-ntwrk/wallet": "^0.8.0",
    "@midnight-ntwrk/zswap": "^0.8.0"
  }
}
```

### Audit Steps

1. **Check Compact compiler version:**
   ```bash
   npx compactc --version
   ```
   Ensure it matches the version in your build scripts.

2. **Verify SDK compatibility:**
   ```bash
   npm ls @midnight-ntwrk/compact-runtime
   npm ls @midnight-ntwrk/wallet
   ```
   All Midnight packages should use compatible versions.

3. **Check proof server version:**
   ```bash
   docker exec midnight-proof-server cat /version
   ```
   Ensure the proof server version matches your SDK.

4. **Test with target network:**
   - Compile contracts against the target network's compiler version
   - Generate proofs using the target proof server
   - Submit test transactions on testnet before mainnet

### Common Pitfalls

- Using a newer Compact compiler than the network supports
- Proof server version mismatch causing proof rejection
- SDK breaking changes in minor version updates

## 7. Proof Generation Testing on Testnet

Before deploying to mainnet, thoroughly test proof generation on testnet.

### What to Check

```typescript
// Test proof generation for every circuit
describe('Proof Generation', () => {
  it('should generate valid proof for transfer', async () => {
    const proof = await contract.transfer(recipient, 100, nonce, signature);
    expect(proof).toBeDefined();
    expect(proof.publicOutputs).toBeDefined();
  });
  
  it('should generate proof within timeout', async () => {
    const start = Date.now();
    await contract.transfer(recipient, 100, nonce, signature);
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(30_000);  // 30 second timeout
  });
  
  it('should handle proof server failures gracefully', async () => {
    // Simulate proof server downtime
    mockProofServer.reject();
    await expect(contract.transfer(recipient, 100, nonce, signature))
      .rejects.toThrow('Proof generation failed');
  });
});
```

### Audit Steps

1. **Test every circuit path:**
   - Happy path (normal operation)
   - Error paths (invalid inputs, insufficient balance, etc.)
   - Edge cases (zero amounts, maximum values, boundary conditions)

2. **Verify proof validity:**
   - Proofs should be accepted by the network
   - Invalid proofs should be rejected with clear error messages

3. **Test proof server interaction:**
   ```bash
   # Start local proof server
   docker run -d -p 6300:6300 midnight-network/proof-server
   
   # Generate test proof
   curl -X POST http://localhost:6300/prove \
     -H "Content-Type: application/json" \
     -d '{"circuit": "transfer", "inputs": {...}}'
   ```

4. **Performance testing:**
   - Measure proof generation time for each circuit
   - Ensure proofs generate within acceptable time limits
   - Test with realistic input sizes

5. **Error handling:**
   - Verify your dApp handles proof server failures gracefully
   - Ensure failed proofs don't leave the contract in an inconsistent state
   - Test network timeout scenarios

## Pre-Deployment Checklist Summary

| # | Check | Status |
|---|-------|--------|
| 1 | `disclose()` audit — no secret leaks | ☐ |
| 2 | `ownPublicKey()` usage — proper authentication | ☐ |
| 3 | Replay protection — nonces or nullifiers | ☐ |
| 4 | Exported ledger fields — correct visibility | ☐ |
| 5 | Witness implementations — validated inputs | ☐ |
| 6 | Version compatibility — SDK, compiler, proof server | ☐ |
| 7 | Proof generation — tested on testnet | ☐ |

## Additional Resources

- [Midnight Documentation](https://docs.midnight.network/getting-started)
- [Midnight MCP](https://www.npmjs.com/package/midnight-mcp) — AI-assisted contract development
- [Developer Forum](https://forum.midnight.network/) — Community support
- [Discord](https://discord.com/invite/midnightnetwork) — Real-time help

## About This Guide

This checklist is maintained by the Midnight community. If you find additional security considerations, please contribute via a PR to the [Contributor Hub](https://github.com/midnightntwrk/contributor-hub).

*Last updated: May 2026*
