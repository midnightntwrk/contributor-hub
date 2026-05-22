# Decoding Error 1010: What 'Invalid Transaction' Actually Means in Midnight

## Overview

Error 1010 — "Invalid Transaction" — is the most confusing error on Midnight.

It appears when:
- A testnet transaction fails silently
- A shielded transfer gets rejected with no explanation
- Your frontend shows an error immediately after signing

In practice, it means: **the L1 verifier rejected the ZK proof that accompanied your transaction**. The error is on-Midnight showing you what happened, wrapped in a single cryptic code.

This tutorial decoding the 7 scenarios behind error 1010, with concrete example error bodies, stack traces, and the exact fix for each case.

## What's Covered

| Scenario | Error signature | Fix |
|----------|---------------|-----|
| Merkle root mismatch | `"root_expected": "0x1234" "root_actual": "0xABCD"` | Wait 1 L1 confirmation after mint |
| Nullifier already spent | `"nullifier": "0x..."` in error body | Never reuse a spent note |
| Public key mismatch | `"signing_key": "..."` in payload | Compact pub key binding error |
| Insufficient proof | `"proof_incomplete"` | Regenerate ZK proof with new blinding |
| Burn address misuse | `"to": "0x..."` not `shieldedBurnAddress()` | Use built-in burn fn |
| Wrong commitment | `"note_committed": false` | Ensure `ShieldedMinted` event emitted |
| Expired proof | `"expires_at": 1234 < now=5678` | Refresh proof (proofs time-bound) |

## Prerequisites

- Midnight wallet (testnet)
- Node.js 18+ (for shielded operations)
- `midnight-compact` installed
- Prior tech reading: [Tutorial: Writing Compact Smart Contracts]()

## Error 1010 Anatomy

When a shielded transaction fails the on-chain verifier, the L1 returns:

```json
{
  "code": "INVALID_TRANSACTION",
  "detail": "Transaction rejected by Midnight proof verifier",
  "extras": {
    "error_1010": true,
    "scenario": "MERKLE_ROOT_MISMATCH",
    "expected_root": "0x3f7a...",
    "actual_root":   "0x11c4...",
    "tip": "Commitment may not yet be written to Merkle tree. Wait 1 L1 confirmation."
  }
}
```

**The `scenario` field is the key** — it tells you exactly which of the 7 cases triggered.

## Architecture of Error 1010

```
Shielded TX → ZK Proof → L1 Verifier → Expected Root vs Actual Root
                                         │
                                    Mismatch → Error 1010
                                    Match     → State Update
```

The error fires at the contract **runtime** level, not the wallet level. Your wallet will show the error, but the cause is always in one of the 7 categories below.

## All 7 Scenarios with Examples

### Scenario 1 — Merkle Root Mismatch (Most Common)

**Error body**:
```json
{
  "scenario": "MERKLE_ROOT_MISMATCH",
  "expected_root": "0x3f7a2be1...",
  "actual_root":   "0x11c43391...",
  "tip": "Newly minted commitment not in indexer Merkle tree yet. Wait 1 confirmation."
}
```

**What happened**: You tried to spend coins that were just minted in the same
block. The Midnight indexer hadn't included the new commitment in its Merkle tree
yet, so the proof proves ownership of a coin that doesn't exist in the verifier's view yet.

**Fix**: Use `mint_and_send` atomic pattern (combine mint+transfer in one proof),
OR wait 1 L1 confirmation before spending.

```compact
// ✅ Mint and transfer in same proof — no Merkle root race
impl TokenState {
    pub fn mint_and_send(&mut self, to: &Address, value: u64) {
        let note = self.mintShieldedToken(to, value);  // mint directly to recipient
        // No spend needed — recipient can use immediately after 1 conf
    }
}
```

### Scenario 2 — Nullifier Already Spent

**Error body**:
```json
{
  "scenario": "NULLIFIER_ALREADY_SPENT",
  "nullifier": "0x7a3b...",
  "tip": "This note was already spent in a previous transaction. Cannot be reused."
}
```

**What happened**: You tried to spend a note that was already spent in a prior
`sendShielded` call. The nullifier exists in the on-chain nullifier set.

**Fix**: Every note has one spend: track your local wallet note state carefully.
Wipe or reset your wallet DB if you're on a fresh testnet and want to retry.

```typescript
// ✅ Check nullifier set before spending
async function safeSendShielded(provider: any, notes: Note[], recipient: string, value: bigint) {
    for (const note of notes) {
        const spent = await provider.contract.is_nullifier_spent(note.nullifier);
        if (spent) {
            throw new Error(`Note ${note.nullifier} already spent — remove from wallet DB`);
        }
    }
    return provider.contract.send_shielded(notes, recipient, value);
}
```

### Scenario 3 — Public Key Mismatch

**Error body**:
```json
{
  "scenario": "PUBLIC_KEY_MISMATCH",
  "provided_key": "0x22a1...",
  "expected_key": "0x99c4...",
  "tip": "The wallet's signing key doesn't match the proof's public key. Re-connect wallet."
}
```

**What happened**: Your Midnight wallet's signing key got updated (derivation path changed),
but the ZK proof was generated with an old key. The proof publisher and the L1 verifier
disagree on the public key.

**Fix**: Reconnect/re-derive your wallet, regenerate all proofs, try again.
Never store wallet state across node restarts without re-deriving keys.

### Scenario 4 — Insufficient Proof

**Error body**:
```json
{
  "scenario": "PROOF_INCOMPLETE",
  "missing_inputs": ["note_commitment"],
  "tip": "The proof was generated without a required commitment input. Rebuild with full note set."
}
```

**What happened**: The client-side proof generator ran with incomplete inputs — either
the note commitment wasn't fetched from the indexer, or the blinding factor was missing.

**Fix**: Rebuild proof from wallet with fresh data from the indexer.

```typescript
// ✅ Fetch fresh commitment before generating proof
const commitment = await indexer.get_commitment(note.commitment_hash);
const proof = await compactProver.prove(
    { ...inputs, commitment },  // ← include fresh commitment
    provingKey
);
```

### Scenario 5 — Burn Address Misuse

**Error body**:
```json
{
  "scenario": "INVALID_BURN_ADDRESS",
  "provided_to": "0x0000...deadbeef",
  "expected":   "shieldedBurnAddress()",
  "tip": "Use the built-in shieldedBurnAddress() — do NOT hardcode the burn address."
}
```

**What happened**: You wrote a hardcoded burn address or called a custom `burn()` fn
instead of using the built-in `shieldedBurnAddress()` function. The verifier expects the
burn address to be provided by the `shieldedBurnAddress()` built-in at verification time.

**Fix**:
```compact
// ✅ CORRECT — use built-in
pub fn burn(&self, nullifiers: Vec<Field>, value: u64) -> bool {
    self.sendShielded(nullifiers, &shieldedBurnAddress(), value, 0)
}

// ❌ WRONG — hardcoded or customer burn address
pub fn burn(&self, nullifiers: Vec<Field>, value: u64) -> bool {
    let bad_burn = Address::from("0x000000...deadbeef");
    self.sendShielded(nullifiers, &bad_burn, value, 0)
}
```

### Scenario 6 — Wrong Commitment (Shielded Minted Not Emitted)

**Error body**:
```json
{
  "scenario": "NOTE_NOT_COMMITTED",
  "commitment": null,
  "tip": "mintShieldedToken must emit ShieldedMinted event to register the note in the Merkle tree."
}
```

**What happened**: You called `mintShieldedToken` but omitted the `emit ShieldedMinted(note.commitment)` line, or the indexer didn't see the event (e.g., indexer crashed or stale).

**Fix**:
```compact
// ✅ CORRECT
pub fn mintShieldedToken(&mut self, owner: &Address, value: u64) -> Note {
    ...
    emit ShieldedMinted(note.commitment);  // ← MUST be present
    note
}
```

Verify the indexer picked it up:
```bash
curl http://localhost:8545/notes/$COMMITMENT
# Should return note details if indexer processed it
```

### Scenario 7 — Expired Proof

**Error body**:
```json
{
  "scenario": "PROOF_EXPIRED",
  "expired_at": 1718800000,
  "now":        1718801200,
  "tip": "Proofs are time-bound in testnet mode. Regenerate and send within 120 seconds."
}
```

**What happened**: You generated the ZK proof, signed the transaction, but sent it later
than 120 seconds after proof generation. Testnet imposes a 120-second proof validity windows.

**Fix**: Generate proof and submit transaction in the same call path — no delays.

## Decision Tree: Quick Debug Flow

```
Error 1010 occurs
    │
    ├── scenario = MERKLE_ROOT_MISMATCH
    │   → Use mint_and_send, wait 1 conf
    │
    ├── scenario = NULLIFIER_ALREADY_SPENT
    │   → Remove note from wallet, track spent set
    │
    ├── scenario = PUBLIC_KEY_MISMATCH
    │   → Reconnect wallet, regenerate keys
    │
    ├── scenario = PROOF_INCOMPLETE
    │   → Rebuild proof with fresh indexer data
    │
    ├── scenario = INVALID_BURN_ADDRESS
    │   → Replace custom address with shieldedBurnAddress()
    │
    ├── scenario = NOTE_NOT_COMMITTED
    │   → Check emit ShieldedMinted, check indexer health
    │
    └── scenario = PROOF_EXPIRED
        → Generate+send in same function call (< 120s)
```

## Error Code Reference

| Error Code | Scenario | Fix Time |
|-----------|----------|---------|
| `E1010-R01` | Merkle root mismatch | Wait 1 conf / use atomic mint_send |
| `E1010-R02` | Nullifier already spent | Remove note, reset wallet db |
| `E1010-R03` | Public key mismatch | Reconnect wallet |
| `E1010-R04` | Proof incomplete | Rebuild proof with fresh data |
| `E1010-R05` | Burn address invalid | Use `shieldedBurnAddress()` |
| `E1010-R06` | Note not committed | Check emit + indexer |
| `E1010-R07` | Proof expired | Generate+send within 120s |

## Summary Checklist

```
When Error 1010 hits:
[ ] Read `scenario` field in error_extras — which of 7 cases?
[ ] Check E1010-XX code in this table
[ ] Apply the specific fix for your scenario
[ ] Rebuild proof (if required) and resubmit
[ ] Open a Midnight GitHub issue if same scenario repeats on clean state
```

## Next Steps

- Add IIFE error handling middleware, call the debug flow automatically in wallet
- Teach `provable_shielded_send()` wrapper to auto-detect all 7 scenarios
- Add nullifier tracking database to wallet to prevent double-spend UX
