# Tutorial — Confidential Asset Management on Midnight

> Submission for [contributor-hub#97](https://github.com/midnightntwrk/contributor-hub/issues/97)

This tutorial covers a **Confidential Asset Management dApp** on Midnight Network: a production-style demo of how fund managers can onboard LPs, report fund performance, and process payouts while keeping LP identities and allocations private through commitments, Merkle proofs, and zero-knowledge circuits.

It reuses and extends the architectural patterns from the [Confidential Dividend](../confidential-dividend/README.md) tutorial, introducing fund-management-specific primitives, period-based payout systems, and public solvency-verification flows.

- **Source repo:** https://github.com/ayushsingh82/Midnight-dApps/tree/main/confidential-asset-management
- **Article:** https://dev.to/ayush_singh_4525768ba4731/-tutorial-confidential-asset-management-on-midnight-2hmb
- **Launch thread:** https://x.com/eth_ay32/status/2054505770599981554

---

## Table of contents

1. [Motivation](#motivation)
2. [Architecture](#architecture)
3. [Compact contract — full walkthrough](#compact-contract--full-walkthrough)
4. [LP commitment model](#lp-commitment-model)
5. [Zero-knowledge LP verification](#zero-knowledge-lp-verification)
6. [Payout nullifier design](#payout-nullifier-design)
7. [Aggregate public metrics](#aggregate-public-metrics)
8. [Witness system](#witness-system)
9. [TypeScript API layer](#typescript-api-layer)
10. [Reactive frontend integration](#reactive-frontend-integration)
11. [Indexer-based state reading](#indexer-based-state-reading)
12. [Deployment](#deployment)
13. [Design summary](#design-summary)

---

## Motivation

Hedge funds and private credit shops generally do **not** want to publish their entire LP book on a transparent chain. But they do want — and regulators increasingly require — verifiable solvency, AUM transparency, and provable payout integrity.

Midnight makes that asymmetry possible. The contract holds the LP book as **commitments** and exposes only aggregate solvency metrics (AUM, ROI, payout counts). LPs prove they are members of the fund in zero knowledge when they redeem or claim a payout. Auditors can verify the process end-to-end without ever seeing identities.

The result is the on-chain equivalent of an audited fund report: trustworthy public numbers, sealed underlying book.

---

## Architecture

```
                        ┌─────────────────────────┐
                        │      GP / Manager       │
                        │  Admits LPs (commits)   │
                        │  Reports ROI            │
                        │  Triggers payouts       │
                        └────────────┬────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────┐
│                Compact Contract (public ledger)              │
│                                                              │
│   manager           : Sealed<Bytes<32>>                      │
│   lpCommitments     : HistoricMerkleTree<10, Bytes<32>>      │
│   payoutNullifiers  : Set<Bytes<32>>                         │
│   aum               : Uint<64>          // public            │
│   reportedRoiBp     : Int<32>           // public            │
│   currentPeriod     : Uint<32>          // public            │
│   payoutCount       : Counter           // public            │
│   lpCount           : Counter           // public            │
└──────────────────────────────────────────────────────────────┘
                                     ▲
                                     │
                ┌────────────────────┴────────────────────┐
                ▼                                         ▼
   ┌────────────────────────┐              ┌────────────────────────┐
   │         LP             │              │   Auditor / Observer   │
   │  Proves membership ZK  │              │  Reads aggregates only │
   │  Claims period payout  │              │  Verifies solvency     │
   └────────────────────────┘              └────────────────────────┘
```

---

## Compact contract — full walkthrough

```compact
import CompactStandardLibrary;

export ledger manager: Sealed<Bytes<32>>;
export ledger lpCommitments: HistoricMerkleTree<10, Bytes<32>>;
export ledger payoutNullifiers: Set<Bytes<32>>;
export ledger aum: Counter;
export ledger reportedRoiBp: Cell<Int<32>>;
export ledger currentPeriod: Counter;
export ledger payoutCount: Counter;
export ledger lpCount: Counter;

constructor(managerPk: Bytes<32>) {
  manager.seal(disclose(managerPk));
}

// ------------------------------------------------------------------
// GP CIRCUITS
// ------------------------------------------------------------------

export circuit admitLp(commitment: Bytes<32>, contribution: Uint<64>): [] {
  assert ownPublicKey().bytes == manager.unsealed() "only manager";
  lpCommitments.insert(disclose(commitment));
  lpCount.increment(1);
  aum.increment(disclose(contribution));
}

export circuit reportRoi(roiBp: Int<32>): [] {
  assert ownPublicKey().bytes == manager.unsealed() "only manager";
  reportedRoiBp.write(disclose(roiBp));
}

export circuit advancePeriod(): [] {
  assert ownPublicKey().bytes == manager.unsealed() "only manager";
  currentPeriod.increment(1);
}

// ------------------------------------------------------------------
// LP CIRCUITS
// ------------------------------------------------------------------

export circuit proveLp(): [] {
  const secret = lpSecret();
  const commitment = persistent_hash<Vector<2, Bytes<32>>>(
    [pad(32, "lp"), secret]
  );
  // Membership: any historic root accepted (long-lived proofs)
  assert lpCommitments.checkRoot(/* root */) "not an LP";
}

export circuit claimPayout(amount: Uint<64>): [] {
  const secret = lpSecret();
  // Commitment derivation (Merkle membership identical to proveLp)
  // ...
  const nullifier = persistent_hash<Vector<3, Bytes<32>>>(
    [pad(32, "payout"), secret, currentPeriod.read() as Bytes<32>]
  );
  assert !payoutNullifiers.member(disclose(nullifier)) "already claimed period";
  payoutNullifiers.insert(disclose(nullifier));

  aum.decrement(disclose(amount));
  payoutCount.increment(1);
}

export circuit redeemLp(amount: Uint<64>): [] {
  // Same membership check + decrements AUM
  // Used for full LP exit; payoutNullifiers remain valid for prior periods
  ...
}
```

Three circuit families:

- **Manager-only** mutations: `admitLp`, `reportRoi`, `advancePeriod`
- **LP ZK proofs**: `proveLp` (membership), `claimPayout` (with nullifier), `redeemLp`
- **Public reads**: served by the indexer, not via circuits

---

## LP commitment model

```
commitment = H( "lp" || secret_key )
```

A `secret_key` is derived deterministically from the LP's wallet seed and never leaves the wallet. The GP only ever sees the `commitment` value (provided off-chain or via an encrypted side channel) and inserts it into `lpCommitments`.

Because `lpCommitments` is a `HistoricMerkleTree<10, ...>`, the tree supports **2^10 = 1024 LPs** with low circuit cost and keeps **all historic roots** valid, so an inclusion proof generated months ago still verifies today even after many other LPs have been admitted.

---

## Zero-knowledge LP verification

The `proveLp` circuit proves:

> "I know a secret whose commitment is included in some historic root of `lpCommitments`."

What gets disclosed publicly: nothing identifying. What gets verified: that the prover is a current LP.

This is the building block used by `claimPayout` and `redeemLp` — both inline the same membership check before performing balance mutations.

---

## Payout nullifier design

```
nullifier = H( "payout" || secret_key || current_period )
```

Properties:

- **Replay-safe**: A second attempt by the same LP in the same period collides with the stored nullifier, so the transaction reverts.
- **Period-scoped**: Distinct periods produce uncorrelated nullifiers — an observer can't link this period's claims to previous periods or to specific LPs.
- **Cheap**: One hash + one set membership check.

Anti-double-spend logic for periodic distributions is essentially "the nullifier set" — period-bound for payouts, lifetime-bound for redemption (different domain separator).

---

## Aggregate public metrics

| Metric            | Source                            |
| ----------------- | --------------------------------- |
| AUM               | `aum.read()`                      |
| Reported ROI (bp) | `reportedRoiBp.read()`            |
| Payout count      | `payoutCount.read()`              |
| LP count          | `lpCount.read()`                  |
| Current period    | `currentPeriod.read()`            |

All five values are publicly verifiable. Anyone — LP, regulator, market observer — can read them via the indexer without authorization. This is what makes the fund **publicly auditable** while keeping the cap table sealed.

---

## Witness system

```compact
witness lpSecret(): Bytes<32>;
```

TS witness implementation:

```ts
export const witnesses = {
  lpSecret: ({ privateState }: WitnessContext<LpPrivateState>) => [
    privateState,
    privateState.secret,
  ],
};
```

`LpPrivateState` is persisted by the `levelPrivateStateProvider`, scoped to the contract instance, and contains exactly one field: the 32-byte LP secret. The proof server reads it during proof generation; it never leaves the local machine.

---

## TypeScript API layer

```ts
import {
  deployContract,
  findDeployedContract,
} from "@midnight-ntwrk/midnight-js-contracts";
import { ConfidentialAssetMgmt, witnesses } from "../contract";

export const deployFund = (providers, managerPk) =>
  deployContract(providers, {
    contract: new ConfidentialAssetMgmt(witnesses),
    initialPrivateState: { secret: random32() },
    args: [managerPk],
  });

export const admitLp = (providers, address, commitment, contribution) =>
  withContract(providers, address).then((c) =>
    c.callTx.admitLp(commitment, contribution),
  );

export const claimPayout = (providers, address, amount) =>
  withContract(providers, address).then((c) =>
    c.callTx.claimPayout(amount),
  );

async function withContract(providers, address) {
  return findDeployedContract(providers, {
    contractAddress: address,
    contract: new ConfidentialAssetMgmt(witnesses),
  });
}
```

Dynamic/lazy loading of Compact contract artifacts keeps the initial bundle small — the `findDeployedContract` call only fetches what is needed for the active circuit.

---

## Reactive frontend integration

Role-based architecture with separate flows:

- **GP panel** — admit LPs (commitment input), report ROI, advance period.
- **LP panel** — generate commitment (one-time), prove membership, claim payout, redeem.
- **Observer / auditor panel** — read-only AUM, ROI, payout count, LP count.

Providers are composed centrally:

```ts
const providers = {
  publicDataProvider: indexerPublicDataProvider(INDEXER),
  privateStateProvider: levelPrivateStateProvider("/private"),
  zkConfigProvider: new FetchZkConfigProvider(BASE),
  proofProvider: httpClientProofProvider(PROOF_SERVER),
  walletProvider,
  midnightProvider: walletProvider,
};
```

The same wallet, when reconnected from a new device, deterministically re-derives the LP secret — so historic proofs and nullifier behavior are reproducible without local persistence beyond what's in the wallet itself.

---

## Indexer-based state reading

```ts
const raw = await providers.publicDataProvider.queryContractState(address);
const state = ledger(raw.data);

return {
  aum: state.aum,
  roiBp: state.reportedRoiBp,
  period: state.currentPeriod,
  lpCount: state.lpCount,
  payoutCount: state.payoutCount,
};
```

For live dashboards, use the observable variant and re-render on each new transaction. There is no per-LP query path — by design.

---

## Deployment

### Local devnet

```bash
docker compose -f compose/devnet.yaml up -d
npx compact build
pnpm dev
```

### Testnet

Configure the proof server, indexer, and node URLs in `.env`, fund the manager wallet, then deploy the contract via the GP panel.

---

## Design summary

**Public data** — auditors and regulators see this:

- AUM
- Reported ROI
- Payout count
- LP count
- Current period

**Private data** — never leaks:

- LP wallet identities
- LP-to-allocation mapping
- Fund strategy / trading book
- Payout recipient linkage

That separation makes the contract a privacy-preserving alternative to transparent on-chain hedge funds: process integrity is publicly verifiable while the allocator book is sealed.

---

## Repository layout

```
confidential-asset-management/
├── contracts/
│   └── fund.compact
├── src/
│   ├── api/
│   ├── components/    # GpPanel, LpPanel, ObserverPanel
│   ├── hooks/
│   └── App.tsx
└── README.md
```

---

## Companion tutorials in this series

- [Confidential Dividend Distribution](../confidential-dividend/README.md)
- [Confidential Tokenized Real Estate](../confidential-real-estate/README.md)

---

**Author:** Ayush ([@eth_ay32](https://x.com/eth_ay32)) — [ayushsingh82](https://github.com/ayushsingh82)
