# Tutorial — Confidential Dividend Distribution on Midnight

> Submission for [contributor-hub#95](https://github.com/midnightntwrk/contributor-hub/issues/95)

This tutorial walks through building a **Confidential Dividend Distribution dApp** on the Midnight Network — a privacy-preserving alternative to transparent corporate cap tables. Shareholders stay private, dividend claims are verified with zero-knowledge proofs, one-claim-per-cycle is enforced via nullifiers, and auditors see only the aggregate totals.

- **Source repo:** https://github.com/ayushsingh82/Midnight-dApps/tree/main/confidential-dividend
- **Article:** https://dev.to/ayush_singh_4525768ba4731/-tutorial-confidential-dividend-distribution-on-midnight-15e1
- **Launch thread:** https://x.com/eth_ay32/status/2054506013777363255

---

## Table of contents

1. [Why confidential dividends?](#why-confidential-dividends)
2. [Architecture](#architecture)
3. [Compact contract walkthrough](#compact-contract-walkthrough)
4. [Commitment generation](#commitment-generation)
5. [Merkle inclusion proofs](#merkle-inclusion-proofs)
6. [Witness system & private state](#witness-system--private-state)
7. [Nullifier replay protection](#nullifier-replay-protection)
8. [TypeScript API layer](#typescript-api-layer)
9. [React frontend integration](#react-frontend-integration)
10. [Indexer-based state reads](#indexer-based-state-reads)
11. [Deployment](#deployment)
12. [Public vs private data summary](#public-vs-private-data-summary)

---

## Why confidential dividends?

Public corporate cap tables are one of the biggest unsolved problems in on-chain finance. The moment equity moves onto a transparent ledger, every shareholder position becomes permanently searchable — insiders, family offices, preferred holders, everyone.

Midnight changes that model. Using zero-knowledge primitives and selective disclosure, an issuer can:

- Register shareholders **privately** as Merkle commitments
- Top up a **public** dividend pool and declare a payout cycle
- Let holders **claim** their dividend in zero knowledge — without revealing wallet ownership or allocation
- Allow auditors and regulators to verify totals (pool balance, paid-out amount, number of claims) without exposing the cap table

The result: public solvency, private cap table.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                 ISSUER (Cap-table owner)                    │
│  Registers shareholder commitments → declares payout cycle  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Compact Contract (on-chain ledger)             │
│                                                             │
│   issuer            : sealed Bytes<32>                      │
│   shareholderTree   : HistoricMerkleTree<10, Bytes<32>>     │
│   dividendPool      : Uint<64>                              │
│   currentCycle      : Uint<32>                              │
│   claimNullifiers   : Set<Bytes<32>>                        │
│   totalPaidOut      : Uint<64>                              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              SHAREHOLDER (Private claimant)                 │
│  Proves membership via Merkle inclusion proof + secret key  │
│  Submits nullifier-bound ZK claim transaction               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│             AUDITOR (Verifier of aggregates)                │
│  Reads dividendPool, totalPaidOut, claim count via indexer  │
└─────────────────────────────────────────────────────────────┘
```

Three roles, three flows, one shared ledger — but only the aggregate state is publicly visible.

---

## Compact contract walkthrough

The contract uses Midnight's `Compact` language. Here is the core skeleton:

```compact
import CompactStandardLibrary;

export ledger issuer: Sealed<Bytes<32>>;
export ledger shareholderTree: HistoricMerkleTree<10, Bytes<32>>;
export ledger dividendPool: Counter;
export ledger currentCycle: Counter;
export ledger claimNullifiers: Set<Bytes<32>>;
export ledger totalPaidOut: Counter;

constructor(issuerPk: Bytes<32>) {
  issuer.seal(disclose(issuerPk));
}

// ------------------------------------------------------------------
// ISSUER CIRCUITS
// ------------------------------------------------------------------

export circuit registerShareholder(commitment: Bytes<32>): [] {
  assert ownPublicKey().bytes == issuer.unsealed() "only issuer";
  shareholderTree.insert(disclose(commitment));
}

export circuit topUpPool(amount: Uint<64>): [] {
  assert ownPublicKey().bytes == issuer.unsealed() "only issuer";
  dividendPool.increment(disclose(amount));
}

export circuit declareCycle(): [] {
  assert ownPublicKey().bytes == issuer.unsealed() "only issuer";
  currentCycle.increment(1);
}

// ------------------------------------------------------------------
// SHAREHOLDER CIRCUITS
// ------------------------------------------------------------------

export circuit claimDividend(amount: Uint<64>): [] {
  const secret = shareholderSecret();
  const commitment = persistent_hash<Vector<2, Bytes<32>>>(
    [pad(32, "shareholder"), secret]
  );

  // Merkle membership without revealing which leaf
  assert shareholderTree.checkRoot(
    shareholderTree.historicRoots().member(disclose(/* root */))
  ) "stale or unknown root";

  // Per-cycle nullifier so the same holder can't double-claim
  const nullifier = persistent_hash<Vector<3, Bytes<32>>>(
    [pad(32, "claim"), secret, currentCycle.read() as Bytes<32>]
  );
  assert !claimNullifiers.member(disclose(nullifier)) "already claimed this cycle";
  claimNullifiers.insert(disclose(nullifier));

  dividendPool.decrement(disclose(amount));
  totalPaidOut.increment(disclose(amount));
}
```

Key things to notice:

- `Sealed` for the issuer key — it's revealed once at construction and never again.
- `HistoricMerkleTree<10, …>` keeps **historic roots** valid for long-lived proofs (a holder's inclusion proof generated yesterday still verifies today).
- `Set<Bytes<32>>` of `claimNullifiers` enforces one-claim-per-(holder × cycle).

---

## Commitment generation

Every shareholder is represented on-chain only by a commitment:

```
commitment = H( "shareholder" || secret_key )
```

The `secret_key` lives **only** in the shareholder's wallet-derived private state. The issuer never sees it — they only insert the commitment that the shareholder sends them off-chain at registration.

In the frontend:

```ts
import { persistentHash, pad } from "@midnight-ntwrk/compact-runtime";

export function buildCommitment(secret: Uint8Array): Uint8Array {
  return persistentHash([pad(32, "shareholder"), secret]);
}
```

The secret is derived deterministically from the wallet seed so it can be re-derived in any session without persisting anything sensitive in localStorage.

---

## Merkle inclusion proofs

`HistoricMerkleTree` exposes a `checkRoot` predicate inside circuits, which lets a shareholder prove:

> "My commitment exists in **some** historic root of the tree"

without revealing **which** root or **which** leaf. The proof is constructed locally by the wallet using the public tree state read from the indexer.

```ts
const { proof, root } = await tree.openCommitment(commitment);
```

Inside the circuit the `assert checkRoot(...)` line collapses to a single ZK constraint at proving time.

---

## Witness system & private state

Witnesses are how Compact pulls private data into a circuit without it ever appearing in the public transcript. For this contract we use one witness:

```compact
witness shareholderSecret(): Bytes<32>;
```

Implemented in TypeScript:

```ts
export const witnesses = {
  shareholderSecret: ({ privateState }: WitnessContext<PrivateState>) => [
    privateState,
    privateState.secret,
  ],
};
```

The wallet's private state object stores the 32-byte secret. When `claimDividend` runs, the proof server reads the secret via the witness, computes the commitment + nullifier locally, and the on-chain ledger only ever sees the disclosed nullifier (which is just an opaque hash).

---

## Nullifier replay protection

A nullifier prevents the same holder from claiming twice in the same cycle:

```
nullifier = H( "claim" || secret_key || current_cycle )
```

Properties:

- Deterministic per (holder, cycle) — two attempts produce the same nullifier.
- Unlinkable to identity — different cycles produce uncorrelated nullifiers, so an observer can't tell which historical claims came from the same holder.
- Cheap to verify — a `Set<Bytes<32>>` membership lookup.

If the cycle were omitted, a holder could only ever claim once across the lifetime of the contract. Binding to `currentCycle` lets the same holder receive dividends quarterly forever.

---

## TypeScript API layer

The TS layer wires the wallet, proof server, indexer, zk-config provider, and private-state provider together, then exposes typed contract calls.

```ts
import {
  CircuitContext,
  ContractAddress,
} from "@midnight-ntwrk/compact-runtime";
import {
  findDeployedContract,
  deployContract,
} from "@midnight-ntwrk/midnight-js-contracts";
import { ConfidentialDividend, witnesses } from "../contract";

export async function deployDividendContract(
  providers: MidnightProviders,
  issuerPk: Uint8Array,
) {
  return deployContract(providers, {
    contract: new ConfidentialDividend(witnesses),
    initialPrivateState: { secret: crypto.getRandomValues(new Uint8Array(32)) },
    args: [issuerPk],
  });
}

export async function claimDividend(
  providers: MidnightProviders,
  address: ContractAddress,
  amount: bigint,
) {
  const contract = await findDeployedContract(providers, {
    contractAddress: address,
    contract: new ConfidentialDividend(witnesses),
  });
  return contract.callTx.claimDividend(amount);
}
```

`findDeployedContract` returns a typed handle; `callTx.<circuit>(args)` triggers proof generation against the proof server and submits the transaction.

---

## React frontend integration

The frontend uses a centralized provider composition pattern:

```tsx
const providers = useMemo(() => ({
  publicDataProvider: indexerPublicDataProvider(INDEXER_URL),
  privateStateProvider: levelPrivateStateProvider(PRIVATE_STATE_PATH),
  zkConfigProvider: new FetchZkConfigProvider(BASE_URL),
  proofProvider: httpClientProofProvider(PROOF_SERVER_URL),
  walletProvider: walletAndMidnightProvider,
  midnightProvider: walletAndMidnightProvider,
}), [walletAndMidnightProvider]);
```

The role-aware UI exposes:

- **Issuer view** — register shareholders, top up the pool, declare a new cycle.
- **Shareholder view** — generate commitment to send issuer, then later claim dividend.
- **Auditor view** — read-only dashboard backed by indexer queries.

Wallet-derived deterministic role identities mean the same seed produces the same secret across sessions, so claims remain replayable from any device.

---

## Indexer-based state reads

The indexer is the read path. Live ledger state is reconstructed by the contract's `ledger(...)` constructor from raw bytes:

```ts
const raw = await providers.publicDataProvider.queryContractState(address);
const state = ledger(raw.data);

console.log("pool:", state.dividendPool);
console.log("cycle:", state.currentCycle);
console.log("paidOut:", state.totalPaidOut);
console.log("claims so far:", state.claimNullifiers.size());
```

A subscription variant (`contractStateObservable`) lets the UI react live to new declarations and claims.

---

## Deployment

### Local devnet

```bash
# 1. Start a local Midnight devnet (proof server + indexer + node)
docker compose -f compose/devnet.yaml up -d

# 2. Compile contracts
npx compact build

# 3. Run the frontend
pnpm dev
```

### Testnet

Point the providers at the public testnet URLs (indexer, proof server, node) and use a testnet-funded wallet to deploy.

---

## Public vs private data summary

| Field                  | Visibility |
| ---------------------- | ---------- |
| Issuer public key      | Public     |
| Dividend pool balance  | Public     |
| Cycle number           | Public     |
| Total amount paid out  | Public     |
| Number of claims       | Public     |
| Shareholder identities | Private    |
| Per-shareholder amount | Private    |
| Cap-table mapping      | Private    |
| Claim → holder linkage | Private    |

That separation is the entire point. Anyone can verify the issuer is solvent and dividends are being distributed correctly, while nobody — not even the issuer post-registration — can correlate claims back to specific holders.

---

## Repository layout

```
confidential-dividend/
├── contracts/
│   └── dividend.compact
├── src/
│   ├── api/                  # contract.ts, providers.ts, witnesses.ts
│   ├── components/           # IssuerPanel, ShareholderPanel, AuditorPanel
│   ├── hooks/                # useProviders, useContract
│   └── App.tsx
├── package.json
└── README.md
```

---

## Further reading

- Midnight Compact reference: https://docs.midnight.network/
- HistoricMerkleTree primitive in the Compact standard library
- Companion tutorials in this repo:
  - [Confidential Asset Management](../confidential-asset-management/README.md)
  - [Confidential Real Estate](../confidential-real-estate/README.md)

---

**Author:** Ayush ([@eth_ay32](https://x.com/eth_ay32)) — [ayushsingh82](https://github.com/ayushsingh82)
