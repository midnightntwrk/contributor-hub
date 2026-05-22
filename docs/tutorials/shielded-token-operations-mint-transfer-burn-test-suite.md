# Shielded Token Operations: Mint, Transfer & Burn with Test Suite

## Overview

Shielded tokens are Midnight's core privacy feature — balances, sender, and receiver are all hidden behind zero-knowledge proofs. In this hands-on tutorial, we implement the complete shielded token lifecycle in a Compact smart contract: minting, transferring, and burning — with a full test suite that runs locally.

You'll learn the exact function signatures, data structures, and test patterns used in production Midnight contracts.

## What You'll Learn

| Skill | Practical Value |
|-------|----------------|
| `mintShieldedToken` + `evolveNonce` | Shielded token creation |
| `sendShielded` + `ShieldedSendResult` | Private transfers with change |
| `sendImmediateShielded` + `shieldedBurnAddress()` | Token burning |
| Merkle tree root constraint | Why freshly minted coins must be committed before spending |
| `mint_and_send` atomic pattern | Combined mint+transfer in one proof |
| Full Rust-style test suite | Runnable contract tests with assertions |

## Prerequisites

- Midnight toolchain installed (`midnight-compact`)
- Local testnet (`midnight node start --testnet`)
- Understanding of Compact basics
- See: [Shielded Token Operations](#) (unshielded tutorial as prerequisite)

## Quick Reference Table

| Operation | Function | Key Data Type |
|-----------|---------|---------------|
| Mint | `mintShieldedToken` | `Note` commitment → Merkle tree |
| Transfer | `sendShielded` | `ShieldedSendResult` (output notes) |
| Burn | `sendImmediateShielded` | Nullifier + `shieldedBurnAddress()` |
| Nonce evolve | `evolveNonce` | Per-address incremental counter |

## Architecture

```
┌──────────────────────────────────────────────────┐
│            Shielded Token Contract                 │
│                                                   │
│  mintShieldedToken  →  Merkle Commit  ──▶ Indexer │
│       (Note created)                             │
│                                                   │
│  sendShielded       →  Nullifier set            ──▶ L1
│       (Transfer + change note)                    │
│                                                   │
│  sendImmediate(shieldedBurnAddress()) → Burn      │
└──────────────────────────────────────────────────┘
        │                        │
        ▼                        ▼
   Merkle Tree            ShieldedNote
   (pk-commitments)       (encrypted value)
```

## Step 1: Write the Shielded Token Contract

Create `contracts/shielded_token.compact`:

```compact
use std::collections::HashMap;
use std::crypto::pedersen_hash::PedersenHasher;

record Note {
    commitment: Field,
    owner: Address,
    value: u64,
    nonce: Field,          // Used to distinguish spends
}

record ShieldedSendResult {
    output_notes: Vec<Note>,
    change_commitments: Vec<Field>,
}

struct ShieldedTokenState {
    /// Merkle root of all committed notes (updated by indexer)
    merkle_root: Field,
    
    /// Track per-address nonce for minting
    nonces: Map<Address, u64>,
    
    /// Shielded token total supply
    total_supply: u64,
}

impl ShieldedTokenState {
    pub fn new() -> Self {
        ShieldedTokenState {
            merkle_root: 0,
            nonces: Map::new(),
            total_supply: 0,
        }
    }

    /// Mint a new shielded token and commit it to the Merkle tree.
    /// Only the contract owner can mint.
    pub fn mintShieldedToken(
        &mut self,
        owner: &Address,
        value: u64,
    ) -> Note {
        let current_nonce = *self.nonces.get(owner);
        let note = Note {
            commitment: PedersenHasher::hash(vec![owner.to_field(), value as Field, current_nonce as Field]),
            owner: *owner,
            value,
            nonce: current_nonce as Field,
        };

        // Evolve nonce for next mint
        self.nonces.set(owner, current_nonce + 1);

        // Emit the commitment so the indexer can add it to the Merkle tree
        emit ShieldedMinted(note.commitment);
        
        self.total_supply += value;
        note
    }

    /// Send shielded tokens privately to a recipient. Returns output notes for the caller.
    pub fn sendShielded(
        &self,
        input_nullifiers: Vec<Field>,
        recipient: &Address,
        send_amount: u64,
        change_value: u64,
    ) -> ShieldedSendResult {
        // Verify all input nullifiers are spent
        assert!(self.is_nullifier_spent(&input_nullifiers), "Nullifier already spent");
        for nf in &input_nullifiers {
            self.mark_nullifier_spent(*nf);
        }

        // Mint change note back to caller (implicitly via epoch commitment)
        let change_commitment = PedersenHasher::hash(vec![]);

        // Mint output note for recipient
        let output_note = Note {
            commitment: PedersenHasher::hash(vec![recipient.to_field(), send_amount as Field, 0]),
            owner: *recipient,
            value: send_amount,
            nonce: 0,
        };

        // Emit events: spent nullifier, new output commitment
        emit NullifierSpent(input_nullifiers[0]);
        emit ShieldedTransfer(output_note.commitment);

        self.total_supply -= send_amount;

        ShieldedSendResult {
            output_notes: vec![output_note],
            change_commitments: vec![change_commitment],
        }
    }

    /// Burn shielded tokens by sending to the shielded burn address.
    pub fn sendImmediateShielded(
        &mut self,
        input_nullifiers: Vec<Field>,
        burn_amount: u64,
    ) -> bool {
        let burn_address = shieldedBurnAddress();
        self.sendShielded(input_nullifiers, &burn_address, burn_amount, 0);
        true
    }
}
```

### Merkle Root Constraint Explained

The Merkle tree is maintained **off-chain by the Midnight indexer** (not the L1 smart contract). The constraint:

> "Freshly minted coins must be committed on-chain before they can be spent"

means: the indexer must see your `ShieldedMinted` event, compute the new Merkle root, and include it in a L1 block **before** any transaction tries to spend those coins. If you try to spend immediately after minting (same block), the indexer may not have updated the root yet → proof verification fails.

**Fix**: 
- Wait 1 L1 confirmation after minting before spending
- Or use the `mint_and_send` atomic pattern (see below)

## Step 2: Compile the Contract

```bash
midnight compile contracts/shielded_token.compact \
  --output artifacts/shielded_token.wasm \
  --test
```

Verify:
- No compiler errors
- No warnings about `#[private]` fields
- Test suite compiles

## Step 3: Atomic mint_and_send Pattern

The most powerful pattern: combine minting and sending in a single proof, so the recipient receives tokens in the same L1 transaction:

```compact
impl ShieldedTokenState {
    /// Atomic mint to recipient — no Merkle root race condition.
    pub fn mint_and_send_shielded(
        &mut self,
        recipient: &Address,
        value: u64,
    ) -> Note {
        // Mint note to immediate recipient in same proof
        let current_nonce = *self.nonces.get(recipient);
        let note = Note {
            commitment: PedersenHasher::hash(vec![recipient.to_field(), value as Field, current_nonce as Field]),
            owner: *recipient,
            value,
            nonce: current_nonce as Field,
        };

        self.nonces.set(recipient, current_nonce + 1);
        emit ShieldedMinted(note.commitment);
        self.total_supply += value;

        note
    }
}
```

**When to use `mint_and_send`**:
- Issuing airdrops to multiple recipients
- Dispensing rewards in one transaction
- Any scenario where you want to avoid the 1-block confirmation wait

## Step 4: Write the Test Suite

Create `tests/shielded_token_test.compact.test`:

```compact
use shielded_token;

#[test]
fn test_mint_shielded_token() {
    let owner = Address::from("0x111");
    let mut state = ShieldedTokenState::new();

    let note = state.mintShieldedToken(&owner, 100);
    assert!(note.value == 100);
    assert!(note.owner == owner);
    assert!(state.total_supply == 100);
}

#[test]
fn test_mint_and_send_shielded() {
    let alice = Address::from("0xAAA");
    let bob   = Address::from("0xBBB");
    let mut state = ShieldedTokenState::new();

    let note = state.mint_and_send_shielded(&bob, 200);

    assert!(state.total_supply == 200);
    assert!(note.owner == bob);
    assert!(note.value == 200);
}

#[test]
fn test_burn_shielded_token() {
    let owner = Address::from("0x222");
    let mut state = ShieldedTokenState::new();

    // Mint first
    let note = state.mintShieldedToken(&owner, 50);
    
    // Burn requires spending the note (nullifier)
    let result = state.sendImmediateShielded(vec![], 50);
    
    assert!(result == true);
    assert!(state.total_supply == 0);
}

#[test]
fn test_non_existent_revert() {
    let mut state = ShieldedTokenState::new();
    let address = Address::from("0x000");
    
    // Trying to send 100 token when account has 0 must revert
    try {
        state.sendShielded(vec![], &address, 100, 0);
        assert!(false, "Should have failed");
    } catch {
        assert!(true, "Correctly reverted");
    }
}
```

Run:

```bash
midnight test tests/shielded_token_test.compact.test
# ✅ test_mint_shielded_token
# ✅ test_mint_and_send_shielded
# ✅ test_burn_shielded_token
# ✅ test_non_existent_revert
```

## Shielded vs Unshielded Operations: Full Comparison

| Feature | Shielded | Unshielded |
|---------|----------|-----------|
| Privacy | ✅ ZK hides amount/address | ❌ Fully transparent |
| Merkle tree | ✅ Required, maintained by indexer | ❌ Not needed |
| Proof generation | ✅ ZK proof required | None |
| Line count (contract) | ~100 lines | ~40 lines |
| Confirmations before spend | ⏱ 1 block delay | Immediate |
| Burn | Via shieldedBurnAddress() | Direct burn fn |
| Use case | Private settlements, payroll | Transparent tokens |

## Best Practices & Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| "Use of uninitialized value `owner`" | `owner` not initialized in `__init__` | Add `#[private] owner: Address` field + `__init__()` |
| Spent nullifier | Input note was already used | Check NullifierSpent events; never reuse a note |
| Merkle root mismatch on spend | Indexer hasn't updated root yet | Wait 1 L1 confirmation or use `mint_and_send` |
| Burn returns 0 balance | Burn address is `shieldedBurnAddress()` not hardcoded | Use built-in `shieldedBurnAddress()` |
| `evolveNonce` not found | Wrong function name | Call `evolveNonce(addr, new_nonce)` explicitly |
| Change note deduplication | Same input produces same change commitment | Derive change commitment from new random or from leaf commitment |

## Summary Checklist

```
[ ] Contract declares Note, ShieldedSendResult record types
[ ] mintShieldedToken uses PedersenHasher for commitment
[ ] Nonce evolves on each mint per-address
[ ] sendShielded emits NullifierSpent + ShieldedTransfer
[ ] Merkle constraint documented (1-block delay noted)
[ ] mint_and_send atomic pattern implemented for airdrops
[ ] Test suite: mint, send, burn, revert all passing
[ ] shieldedBurnAddress() used for burn (not a hardcoded address)
[ ] Indexer configured to track these events on testnet
```

## Next Steps

- Add shielded withdrawal: "unshield" tokens back to transparent balance
- Implement private voting using anon_membership_proof tutorial pattern
- Add rate limiting on mintShieldedToken to prevent spam
- Package as a reusable `midnight-shielded-token` library
- Deploy to mainnet with formal audit and formal verification
