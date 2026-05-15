# Selective Disclosure Patterns in Compact

**Author:** billbtbillb  
**Last Updated:** May 2026  
**Difficulty:** Intermediate  
**Prerequisites:** Basic understanding of zero-knowledge proofs, familiarity with the Compact language, and a working Midnight development environment.

---

## Introduction

One of Midnight's most powerful features is the ability to selectively reveal information about private data without exposing the underlying values. This concept — **selective disclosure** — lets you prove that a secret meets certain criteria (age >= 18, balance >= 100, membership in a set) while keeping the actual secret hidden.

This tutorial walks through the core patterns for implementing selective disclosure in Compact contracts. We will cover how `disclose()` works internally, what constitutes safe versus unsafe disclosure, how to use domain-separated hashing to prevent cross-property linkability, and how to audit your own contracts for privacy leaks.

By the end, you will have a concrete, reusable toolkit for building privacy-preserving smart contracts that expose only what they must.

---

## Why Selective Disclosure Matters

Blockchains are transparent by default. Every transaction, every state change, every piece of data is visible to all participants. This transparency is useful for auditability but disastrous for user privacy.

Traditional blockchains force an all-or-nothing choice: either publish your data to the world or keep it off-chain entirely. Midnight's ZK architecture breaks this dichotomy. With selective disclosure, you can:

- **Prove compliance** without revealing identity (e.g., prove you are over 18 without showing your birthdate).
- **Demonstrate solvency** without exposing balances (e.g., prove you hold at least 1,000 tokens without revealing the exact amount).
- **Verify membership** without listing members (e.g., prove you belong to a whitelist without revealing which member you are).
- **Enforce business rules** without exposing trade secrets (e.g., prove a bid meets a minimum threshold without revealing the bid amount).

The key insight is that zero-knowledge proofs separate *knowledge* from *disclosure*. You can prove you know something without revealing what you know. Selective disclosure is the controlled, intentional act of choosing which fragments of knowledge to expose.

---

## How `disclose()` Works in Compact

In Compact, the `disclose()` function is the primary mechanism for controlled revelation of private data. When you call `disclose(value)`, the contract reveals `value` publicly on-chain as part of the transaction output. Critically, `disclose()` does **not** reveal the inputs that produced `value` — it only reveals the output itself.

### Basic Syntax

```compact
// Compact pseudocode — illustrate the pattern

contract SelectiveAge {
  ledger secret_birth_year: Opaque<Uint<32>>;

  // Prove you are at least 18 without revealing birth year
  circuit prove_age(min_age: Uint<32>): Boolean {
    const current_year = 2026;
    const age = current_year - secret_birth_year;

    // Only disclose the boolean: "is age >= min_age?"
    // The actual birth year stays hidden
    return age >= min_age;
  }

  // Optionally disclose the computed age itself
  circuit reveal_age(): Opaque<Uint<32>> {
    const current_year = 2026;
    const age = current_year - secret_birth_year;
    return disclose(age);  // Age becomes public, birth year stays private
  }
}
```

In `prove_age()`, nothing is explicitly disclosed — the ZK proof attests that the condition holds. In `reveal_age()`, the computed age is explicitly disclosed. The birth year itself is never revealed in either circuit.

### Key Principle

`disclose()` is a one-way door. Once data is disclosed, it cannot be un-disclosed. Every `disclose()` call should be a deliberate design decision, not an afterthought.

---

## Pattern 1: Threshold Disclosure

The most common selective disclosure pattern is proving that a private value exceeds (or falls below) a threshold without revealing the exact value.

```compact
contract ThresholdDemo {
  ledger secret_balance: Opaque<Uint<64>>;

  // Prove balance >= threshold without revealing balance
  circuit meets_threshold(threshold: Uint<64>): Boolean {
    return secret_balance >= threshold;
  }

  // Disclose only the range bucket, not the exact balance
  circuit balance_bucket(): Opaque<Uint<8>> {
    const bal = secret_balance;
    if (bal < 100) {
      return disclose(0 as Uint<8>);        // "low"
    } else if (bal < 10000) {
      return disclose(1 as Uint<8>);        // "medium"
    } else {
      return disclose(2 as Uint<8>);        // "high"
    }
  }
}
```

**Why this works:** The ZK proof guarantees that the bucket was computed correctly from the actual balance. An observer learns the bucket but not the balance. This is far more privacy-preserving than publishing the exact number, yet still useful for analytics or tiered access control.

**Trade-off:** The coarser your buckets, the more privacy you preserve but the less information you reveal. Choose bucket boundaries based on your specific use case.

---

## Pattern 2: Set Membership Without Exposure

Proving membership in a set (e.g., a whitelist, a credential list) without revealing *which* member you are is a classic selective disclosure use case.

```compact
import MerkleTree from "./merkle_helpers";

contract WhitelistDemo {
  ledger merkle_root: Field;

  // Prove membership without revealing which leaf
  circuit prove_membership(
    leaf: Field,
    path: MerklePath,
    indices: Opaque[32]<Boolean>
  ): Boolean {
    const computed_root = MerkleTree.verify(leaf, path, indices);
    return computed_root == merkle_root;
  }

  // Reveal the leaf hash but not its preimage
  circuit disclose_membership_hash(
    leaf: Field,
    path: MerklePath,
    indices: Opaque[32]<Boolean>
  ): Field {
    const computed_root = MerkleTree.verify(leaf, path, indices);
    assert(computed_root == merkle_root);
    return disclose(leaf);  // Hash is public, identity stays private
  }
}
```

**Privacy analysis:** The Merkle proof itself does not reveal which leaf is being verified (assuming the tree is properly constructed). The `disclose(leaf)` call reveals the leaf hash, which can be useful for deduplication (preventing double-claims) without revealing the underlying identity.

---

## Pattern 3: Composable Disclosure with Domain-Separated Hashing

When you disclose multiple properties about the same underlying data, an observer can potentially link those disclosures together to reconstruct the original data. **Domain-separated hashing** prevents this by binding each disclosure to a unique domain tag, making cross-property linkability computationally infeasible.

### The Problem

Suppose you disclose:

- `disclose(age)` yields 29
- `disclose(income_bucket)` yields 2 (medium)

An observer now knows they are looking for a person aged 29 with medium income. If the pool is small, this can be enough to de-anonymize.

### The Solution: Domain Separation

```compact
import Hash from "./hash_helpers";

contract DomainSeparatedDisclosure {
  ledger secret_data_hash: Field;

  // Each disclosure uses a unique domain tag
  circuit disclose_age_bracket(): Opaque<Uint<8>> {
    const age = compute_age(secret_data_hash);
    const bracket = age / 10;  // 0-9 decades
    // Domain-separated: even if age bracket = 2,
    // it cannot be linked to income bracket = 2
    return disclose(Hash.poseidon_with_domain("age_bracket", bracket));
  }

  circuit disclose_income_bracket(): Opaque<Uint<8>> {
    const income = compute_income(secret_data_hash);
    const bracket = income / 50000;
    return disclose(Hash.poseidon_with_domain("income_bracket", bracket));
  }

  // Safe: these two disclosures produce unrelated hash outputs
  // An observer cannot tell if age_bracket hash X and
  // income_bracket hash Y came from the same user
}
```

### How Domain Separation Works

Domain-separated hashing prepends a unique tag (the "domain") to the data before hashing:

```
H(domain || data)
```

This means `H("age" || 29)` and `H("income" || 29)` produce completely different outputs, even though the underlying numeric value is the same. Without domain separation, both disclosures would leak the fact that the same number appears in two contexts.

**Implementation note:** In Compact, use a Poseidon hash with a domain separator. The domain string should be descriptive and unique per disclosure type. Common convention is to use the circuit name or a dotted path like `"user.age_bracket"`.

---

## Pattern 4: Conditional Disclosure

Sometimes you want to disclose data only when certain conditions are met. This pattern combines assertions with selective disclosure.

```compact
contract ConditionalDisclosure {
  ledger secret_score: Opaque<Uint<32>>;
  ledger secret_tier: Opaque<Uint<8>>;

  // Disclose score only if user is in top tier
  circuit disclose_if_eligible(): Opaque<Uint<32>> {
    assert(secret_tier == 3, "Only top-tier users can disclose scores");
    return disclose(secret_score);
  }

  // Disclose a flag without revealing the tier itself
  circuit is_eligible(): Boolean {
    return secret_tier >= 2;
  }
}
```

**Privacy insight:** The assertion `assert(secret_tier == 3)` does NOT reveal `secret_tier` — it only proves that the condition holds. The ZK proof carries the assertion; the public output does not. This is a subtle but critical distinction.

---

## What's Safe to Disclose vs. What Leaks Privacy

Understanding what is safe to disclose requires thinking like an adversary. Here is a framework:

### Generally Safe to Disclose

- **Boolean outcomes** — "Is age >= 18?" reveals one bit, which is minimal.
- **Bucketed categories** — Coarse categories (low/medium/high) reveal limited information.
- **Domain-separated hashes** — Hashes are opaque; they reveal nothing without the preimage.
- **Proof validity** — The fact that a proof verifies is itself a form of disclosure (the circuit accepted), which is usually the desired behavior.

### Dangerous to Disclose

- **Exact private values** — Disclosing `secret_balance` directly is the same as making it public. Only do this when the user explicitly consents.
- **Small-domain values** — Disclosing a value from a small set (e.g., a day of the week) can be trivially brute-forced. If `disclose(day_of_week)` outputs 3, an observer knows it is Wednesday.
- **Multiple correlated values** — Even individually safe disclosures can combine to form a unique fingerprint. Disclosing age bracket + zip code + employer size often uniquely identifies a person.
- **Timing or sequence information** — If disclosures happen in a predictable order, the sequence itself can leak information about the underlying data structure.

### Red Flags Checklist

- Does this disclosure reduce the anonymity set below a safe threshold?
- Can two or more disclosures from the same transaction be combined to narrow down the user?
- Is the disclosed value derivable from public information + the disclosure?
- Would this disclosure be problematic if the user's identity were later revealed?

---

## Privacy Audit Checklist for Developers

Use this checklist when reviewing any Compact contract that uses selective disclosure:

### Design Phase

- [ ] **Inventory all disclosures.** List every `disclose()` call in your contract. For each one, document what value is revealed and why.
- [ ] **Define the adversary model.** Who are you protecting against? A casual observer? A motivated investigator? A state-level actor?
- [ ] **Calculate the anonymity set size.** How many possible users could produce the same disclosed value? If the answer is "very few," reconsider.
- [ ] **Check for cross-property linkability.** Can disclosures from different circuits be correlated? Use domain-separated hashing to prevent this.

### Implementation Phase

- [ ] **Every `disclose()` has a comment** explaining what is revealed and why it is safe.
- [ ] **No raw secret values pass through `disclose()`.** All disclosed values should be derived (hashed, bucketed, threshold-checked).
- [ ] **Domain separators are unique** per disclosure type and do not collide.
- [ ] **Assertions do not leak.** Verify that `assert()` calls on private values do not produce distinguishable error messages or timing differences.

### Testing Phase

- [ ] **Test with adversarial inputs.** Try boundary values (0, max, negative wraparound) to ensure disclosures behave correctly.
- [ ] **Test disclosure isolation.** Verify that disclosures from one user cannot be linked to disclosures from another user.
- [ ] **Audit the transcript.** Examine the public transaction output and verify that only intended data is visible.
- [ ] **Run the contract through a static analyzer** if available. Look for unintentional data flows from private to public state.

### Deployment Phase

- [ ] **Document the disclosure policy** in your contract's README. Users should understand what is revealed before they interact with the contract.
- [ ] **Version your disclosure circuits.** If you update a circuit, the disclosure semantics might change. Version pinning prevents silent privacy regressions.
- [ ] **Monitor for new attack vectors.** As ZK cryptanalysis evolves, previously safe patterns might become vulnerable. Stay current with the Midnight security advisories.

---

## Complete Example: Privacy-Preserving Credential Verification

Below is a complete, annotated contract that demonstrates multiple selective disclosure patterns working together.

```compact
// License: Apache-2.0
// Demonstrates selective disclosure patterns in Compact

import Hash from "./hash_helpers";
import MerkleTree from "./merkle_helpers";

contract CredentialVerifier {
  // Private state: the user's credential commitment
  ledger credential_root: Field;
  // Public state: revocation list root
  ledger revocation_root: Field;

  // ---- Pattern 1: Threshold ----
  // Prove credential score >= threshold without revealing score
  circuit verify_score_threshold(
    score: Opaque<Uint<32>>,
    threshold: Uint<32>,
    score_path: MerklePath,
    score_indices: Opaque[32]<Boolean>
  ): Boolean {
    // Verify score is in the credential tree
    const leaf = Hash.poseidon_with_domain("score", score);
    assert(MerkleTree.verify(leaf, score_path, score_indices) == credential_root);
    // Prove threshold without disclosing score
    return score >= threshold;
  }

  // ---- Pattern 2: Set Membership ----
  // Prove credential is not revoked without revealing which credential
  circuit verify_not_revoked(
    credential_id: Field,
    rev_path: MerklePath,
    rev_indices: Opaque[32]<Boolean>
  ): Boolean {
    const rev_leaf = Hash.poseidon_with_domain("revocation", credential_id);
    // If this returns true, the credential IS revoked
    const is_revoked = MerkleTree.verify(rev_leaf, rev_path, rev_indices) == revocation_root;
    return !is_revoked;
  }

  // ---- Pattern 3: Domain-Separated Disclosure ----
  // Disclose credential type without linking to other properties
  circuit disclose_credential_type(
    cred_type: Opaque<Uint<8>>,
    type_path: MerklePath,
    type_indices: Opaque[32]<Boolean>
  ): Field {
    const type_leaf = Hash.poseidon_with_domain("credential_type", cred_type);
    assert(MerkleTree.verify(type_leaf, type_path, type_indices) == credential_root);
    // Disclose the domain-separated hash, NOT the raw type
    return disclose(type_leaf);
  }

  // ---- Pattern 4: Conditional Disclosure ----
  // Only reveal credential metadata if all checks pass
  circuit full_verification(
    score: Opaque<Uint<32>>,
    threshold: Uint<32>,
    cred_type: Opaque<Uint<8>>,
    credential_id: Field,
    // Merkle proofs for each property
    score_path: MerklePath,
    score_indices: Opaque[32]<Boolean>,
    type_path: MerklePath,
    type_indices: Opaque[32]<Boolean>,
    rev_path: MerklePath,
    rev_indices: Opaque[32]<Boolean>
  ): Opaque<Uint<8>> {
    // 1. Score threshold check (no disclosure)
    assert(score >= threshold, "Score below threshold");

    // 2. Revocation check (no disclosure)
    const rev_leaf = Hash.poseidon_with_domain("revocation", credential_id);
    const is_revoked = MerkleTree.verify(rev_leaf, rev_path, rev_indices) == revocation_root;
    assert(!is_revoked, "Credential is revoked");

    // 3. Verify type is in credential tree
    const type_leaf = Hash.poseidon_with_domain("credential_type", cred_type);
    assert(MerkleTree.verify(type_leaf, type_path, type_indices) == credential_root);

    // 4. Only now disclose the credential type
    // All checks passed, so disclosure is safe and conditional
    return disclose(cred_type);
  }
}
```

**What the observer sees:** Only the credential type (a single `Uint<8>` value) and the fact that all assertions passed. The score, credential ID, revocation status, and all Merkle paths remain completely hidden.

---

## Summary of Patterns

| Pattern | What You Prove | What You Disclose |
|---|---|---|
| Threshold | Value >= threshold | Nothing, or the boolean result |
| Set Membership | Member of a set | Nothing, or a domain-separated hash |
| Domain Separated | Property value | H(domain || value) -- unlinkable across properties |
| Conditional | Condition holds | Value only if condition is true |

---

## Further Reading

- [Midnight Developer Documentation](https://docs.midnight.network/getting-started)
- [Compact Language Reference](https://docs.midnight.network/compact/)
- [Midnight MCP (npm)](https://www.npmjs.com/package/midnight-mcp)
- [Midnight Developer Forum](https://forum.midnight.network/)
- [Midnight Discord](https://discord.com/invite/midnightnetwork)

---

## Exercises for the Reader

1. **Extend the Threshold pattern** to support range proofs (e.g., prove balance is between 100 and 1000 without revealing the exact value).
2. **Implement a voting contract** where each voter can prove they have not already voted (set membership + revocation) without revealing which voter they are.
3. **Add a time-lock disclosure** where data is disclosed only after a certain block height, using a commit-reveal scheme.
4. **Audit an existing contract** from the Midnight examples repository using the privacy checklist above and document your findings.

---

*This tutorial is part of the Midnight Network Contributor Hub. For questions, corrections, or contributions, please open an issue or join the [Midnight Discord](https://discord.com/invite/midnightnetwork).*
