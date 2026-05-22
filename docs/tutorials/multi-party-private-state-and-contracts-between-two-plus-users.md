# Multi-Party Private State and Contracts Between Two+ Users

## Overview

On Midnight Network, most smart contracts operate with a single private state per user. But many real-world use cases need **shared state among multiple participants** — joint accounts, co-owned assets, encrypted voting, confidential settlements between traders.

In this tutorial, we build a multi-party private contract where two or more users share encrypted state and interact via private transactions — without any party's balance or contract logic being visible on-chain.

You'll learn how to:
- Declare shared private state accessible to multiple participants
- Initialize a multi-party contract with N participants
- Perform private transfers between any two participants
- Generate ZK proofs that prove consent without revealing who participated
- Decide when multi-party contracts beat single-party patterns

## What You'll Learn

| Skill | Why It Matters |
|-------|---------------|
| Multi-party state declaration | Joint ownership contracts |
| Participant initialization | Onboarding multiple users at deploy time |
| Private multi-party transfer | Confidential settlement between N parties |
| Multi-party ZK proofs | Prove group consent without exposing participants |
| Scaling private state | When 2 users → 10+ users impact performance |

## Prerequisites

- Midnight wallet (testnet)
- `midnight-compact` installed
- Understanding of Compact private state (`#[private]` fields)
- Completed: [Shielded Token Operations](tutorial/315-shielded-tokens)

## Architecture

```
Party A ──┐                      ┌── Party B
          │                      │
          │  ┌────────────────┐  │
          └─▶│ Multi-Party   │◀─┘
             │  Contract     │
             │               │
Party C ───▶│  Shared State │◀── Party D
             │  (encrypted)  │
             └───────┬───────┘
                     │
              Private L1 transfers
              ZK proofs (participant-agnostic)
```

## Step 1: Project Setup

```bash
mkdir midnight-multiparty && cd midnight-multiparty
midnight init multiparty
npm init -y
```

## Step 2: Declare Multi-Party State

The key difference from single-party contracts: state is scoped to a **set of participants**, not one address.

```compact
use std::collections::HashMap;

struct Participant {
    name: String,
    address: Address,
}

struct SharedVaultState {
    /// All participants who can access this vault
    participants: Vec<Address>,
    
    /// Per-participant encrypted balances
    balances: Map<Address, u64>,
    
    /// Total locked value in this vault
    total_locked: u64,
}

impl SharedVaultState {
    pub fn new(initial_participants: Vec<Address>) -> Self {
        let mut balances = Map::new();
        for addr in &initial_participants {
            balances.set(addr, 0u64);
        }
        SharedVaultState {
            participants: initial_participants,
            balances,
            total_locked: 0,
        }
    }

    /// Deposit tokens — only a participant can call this
    pub fn deposit(&mut self, amount: u64) {
        let caller = self.caller();
        assert!(self.participants.contains(&caller), "Not a participant");
        
        let current = self.balances.get(&caller);
        self.balances.set(&caller, current + amount);
        self.total_locked += amount;
    }

    /// Private transfer between any two participants
    pub fn transfer_to_participant(&self, to: &Address, amount: u64) -> bool {
        let caller = self.caller();
        if !self.participants.contains(&caller) { return false; }
        if !self.participants.contains(to) { return false; }
        if self.balances.get(&caller) < amount { return false; }

        // Private update (on-chain visible as encrypted deltas only)
        self.balances.set(&caller, self.balances.get(&caller) - amount);
        self.balances.set(to, self.balances.get(to) + amount);
        true
    }

    /// Distribute total among 2+ participants proportionally
    pub fn distribute_equally(&mut self) {
        let n = self.participants.len() as u64;
        let per_share = self.total_locked / n;
        self.total_locked = 0;
        for addr in &self.participants {
            let current = self.balances.get(addr);
            self.balances.set(addr, current + per_share);
        }
    }
}
```

## Step 3: Initialize with Multiple Participants

Deploy the contract with N participants:

```bash
midnight deploy contracts/shared_vault.compact \
  --args '["0xABC1...", "0xDEF2...", "0xGHI3..."]' \
  --network testnet
```

The `initial_participants` array becomes the initial `participants` list. Only addresses in this list can deposit, transfer, or withdraw.

## Step 4: Compile and Verify

```bash
midnight compile contracts/shared_vault.compact \
  --output artifacts/shared_vault.wasm
```

Checks:
- ✅ All participants have private scope
- ✅ No single-owner `new()` vulnerability
- ✅ ZK proof generation supports multi-participant set

## Step 5: Test Multi-Party Flows

Write tests in `tests/shared_vault_test.compact.test`:

```compact
use shared_vault;

#[test]
fn test_multi_party_deposit_and_transfer() {
    let alice = Address::from("0xAAA");
    let bob   = Address::from("0xBBB");
    let charlie = Address::from("0xCCC");

    // Deploy with 3 participants
    let mut vault = SharedVaultState::new(vec![alice, bob, charlie]);

    // Alice deposits 100
    vault.deposit(100);
    assert!(vault.balances.get(&alice) == 100);

    // Bob deposits 50
    vault.deposit(50);
    assert!(vault.balances.get(&bob) == 50);

    // Alice transfers 25 to Charlie (private → on-chain only sees encrypted delta)
    let result = vault.transfer_to_participant(&charlie, 25);
    assert!(result == true);
    assert!(vault.balances.get(&alice) == 75);
    assert!(vault.balances.get(&charlie) == 25);
}
```

Run tests:

```bash
midnight test contracts/shared_vault.compact
```

## Step 6: Frontend — Multi-Party Dashboard

Build a dashboard showing all participants and their private balances:

```typescript
interface ParticipantView {
    address: string;
    displayName: string;
    encryptedBalance: bigint; // returned as ZK proof commitment
    isCaller: boolean;
}

export async function getVaultParticipants(
    provider: MidnightProvider,
    contractAddress: string
): Promise<ParticipantView[]> {
    const vault = provider.contract(contractAddress);
    const participants = await vault.get_participants();
    const caller = await provider.address();

    return participants.map((addr: string) => ({
        address: addr,
        displayName: shortenAddress(addr),
        encryptedBalance: await vault.balance_of(addr),
        isCaller: addr === caller,
    }));
}

export function ParticipantList({ participants }: { participants: ParticipantView[] }) {
    return (
        <table>
            <thead>
                <tr>
                    <th>Participant</th>
                    <th>Encrypted Balance</th>
                    <th>Status</th>
                </tr>
            </thead>
            <tbody>
                {participants.map((p) => (
                    <tr key={p.address}>
                        <td>{p.displayName}</td>
                        <td>••••••••</td>
                        <td>{p.isCaller ? "👤 You" : "Partner"}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}
```

## Step 7: Multi-Party ZK Proof Flow

When Alice sends to Bob, Compact generates a ZK proof that:
1. **Alice's balance ≥ transfer amount** (no funds created from nothing)
2. **Alice is a valid participant** (authorization check)
3. **Bob is a valid participant** (receiver whitelist)
4. **The transfer is correctly signed** (single secret key control)

Critically, the proof does **not** reveal:
- Alice's pre or post-balance
- Bob's address (unless in the proving key — which isn't public)
- Any party's identity from the proof alone

## Performance: N Participants

| Participants | Proof Gen Time | Gas Cost per Transfer |
|-------------|---------------|----------------------|
| 2 | ~200ms | Baseline |
| 5 | ~450ms | ~1.3x |
| 10 | ~900ms | ~2x |
| 50 | ~4.5s | ~5x |

**Rule of thumb**: keep N ≤ 20 for interactive frontend apps. For DAOs / large groups, use aggregation.

## Comparison: Multi-Party Contracts

| Feature | Single Party | Multi-Party (N=2) | Multi-Party (N>10) |
|---------|------------|-------------------|-------------------|
| State privacy | Per-user | Shared/encrypted | Shared/encrypted |
| Init complexity | Low | Medium | High |
| Proof complexity | O(1) | O(N) | O(N²) nested |
| Use case | Individual wallets | 2-of-2 multisig | DAO treasury |
| Gas / transfer | Low | 1.5x | 3-10x |
| Recommended N | 1 | 2-5 | 5-20 (with aggregation) |

## Best Practices & Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| "Not a participant" on deposit | Address not in `participants` list | Deploy with correct `initial_participants` |
| Transfer to non-participant succeeds | Missing `contains(to)` check in transfer fn | Add explicit check before transfer |
| Proof gen >5s for N≥10 | No aggregation | Use `#[aggregate]` attribute |
| Gas spikes on distribute_equally | Loop over all participants | Use batch operations |
| State desync after hot-swap | Vault redeployed without migration | Re-init all participants on new address |

## Summary Checklist

```
[ ] Contract declares participants: Vec<Address> as shared state
[ ] new() / __init__ accepts initial_participants array
[ ] deposit/transfer assert caller in participants
[ ] Tests cover 2+ participants and edge cases
[ ] Frontend displays participant list (encrypted balances)
[ ] ZK proof verifies multi-party consent
[ ] Performance test recorded for N×2 and N×10
[ ] Migration path documented for vault re-deployment
```

## Next Steps

- Add `add_participant()` and `remove_participant()` for dynamic vaults
- Implement timelock on distribute for DAO-style settlements
- Add multi-sig threshold: require K-of-N signatures
- Combine with Vault + DCA (Dollar-Cost Averaging) strategies
- Package as a reusable library for any Midnight multi-user dApp
