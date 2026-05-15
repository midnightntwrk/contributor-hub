# Tutorial — Confidential Tokenized Real Estate on Midnight

> Submission for [contributor-hub#91](https://github.com/midnightntwrk/contributor-hub/issues/91)

This tutorial walks through building a **Confidential Tokenized Real Estate dApp** on Midnight Network. Property shares are tokenized as private commitments, rental-yield distributions are claimed in zero knowledge, and the on-chain ledger stores **no investor identities** — only Merkle commitments and aggregate statistics.

It applies the same privacy primitives used in the [Confidential Dividend](../confidential-dividend/README.md) and [Confidential Asset Management](../confidential-asset-management/README.md) tutorials, adapted for the specifics of fractional real estate: rental cycles, multi-property tracking, and investor-side yield claims.

- **Source repo:** https://github.com/ayushsingh82/Midnight-dApps/tree/main/confidential-real-estate
- **Article:** https://dev.to/ayush_singh_4525768ba4731/-tutorial-building-confidential-tokenized-real-estate-on-midnight-26o9
- **Launch thread:** https://x.com/eth_ay32/status/2054506182988169267

---

## Table of contents

1. [Why confidential real estate?](#why-confidential-real-estate)
2. [Architecture](#architecture)
3. [Compact contract walkthrough](#compact-contract-walkthrough)
4. [Ownership commitment model](#ownership-commitment-model)
5. [Rental yield claims with nullifiers](#rental-yield-claims-with-nullifiers)
6. [Witness system](#witness-system)
7. [TypeScript API layer](#typescript-api-layer)
8. [React frontend integration](#react-frontend-integration)
9. [Indexer-based state reading](#indexer-based-state-reading)
10. [Deployment](#deployment)
11. [Public vs private data summary](#public-vs-private-data-summary)

---

## Why confidential real estate?

Tokenized real estate has the same transparency problem as on-chain equity: once shares are on a public chain, every investor position becomes searchable forever. Family offices, sovereign-wealth participants, and HNWIs typically don't want their property allocations correlated with the rest of their on-chain activity.

Midnight enables the inverse: investors are private, ownership is provable to regulators, and rental yield is claimable in zero knowledge. The result is **investor private, ownership verifiable** — confidentiality for the holders, transparent proof of solvency and yield distribution for everyone else.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                  SPONSOR (Property issuer)                   │
│  Registers investors, tops up rental pool, advances cycle    │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│              Compact Contract (on-chain ledger)              │
│                                                              │
│   sponsor              : Sealed<Bytes<32>>                   │
│   ownershipCommitments : HistoricMerkleTree<10, Bytes<32>>   │
│   yieldClaimNullifiers : Set<Bytes<32>>                      │
│   totalProperties      : Counter                             │
│   totalShares          : Counter                             │
│   totalYieldClaims     : Counter                             │
│   rentalPoolAvailable  : Uint<64>                            │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                INVESTOR (Private fractional owner)           │
│  Proves ownership via Merkle inclusion + secret              │
│  Claims rental yield, nullifier-bound per cycle              │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│              AUDITOR / REGULATOR (Public reader)             │
│  Sees: properties, shares outstanding, yield paid, cycle     │
└──────────────────────────────────────────────────────────────┘
```

---

## Compact contract walkthrough

```compact
import CompactStandardLibrary;

export ledger sponsor: Sealed<Bytes<32>>;
export ledger ownershipCommitments: HistoricMerkleTree<10, Bytes<32>>;
export ledger yieldClaimNullifiers: Set<Bytes<32>>;
export ledger totalProperties: Counter;
export ledger totalShares: Counter;
export ledger totalYieldClaims: Counter;
export ledger rentalPoolAvailable: Counter;
export ledger currentCycle: Counter;

constructor(sponsorPk: Bytes<32>) {
  sponsor.seal(disclose(sponsorPk));
}

// ------------------------------------------------------------------
// SPONSOR CIRCUITS
// ------------------------------------------------------------------

export circuit registerProperty(): [] {
  assert ownPublicKey().bytes == sponsor.unsealed() "only sponsor";
  totalProperties.increment(1);
}

export circuit issueShares(commitment: Bytes<32>, shares: Uint<32>): [] {
  assert ownPublicKey().bytes == sponsor.unsealed() "only sponsor";
  ownershipCommitments.insert(disclose(commitment));
  totalShares.increment(disclose(shares));
}

export circuit topUpRentalPool(amount: Uint<64>): [] {
  assert ownPublicKey().bytes == sponsor.unsealed() "only sponsor";
  rentalPoolAvailable.increment(disclose(amount));
}

export circuit advanceCycle(): [] {
  assert ownPublicKey().bytes == sponsor.unsealed() "only sponsor";
  currentCycle.increment(1);
}

// ------------------------------------------------------------------
// INVESTOR CIRCUITS
// ------------------------------------------------------------------

export circuit proveOwnership(): [] {
  const secret = investorSecret();
  const commitment = persistent_hash<Vector<2, Bytes<32>>>(
    [pad(32, "investor"), secret]
  );
  assert ownershipCommitments.checkRoot(/* root */) "not an owner";
}

export circuit claimYield(amount: Uint<64>): [] {
  const secret = investorSecret();
  // Same Merkle membership check as proveOwnership
  // ...

  const nullifier = persistent_hash<Vector<3, Bytes<32>>>(
    [pad(32, "yield"), secret, currentCycle.read() as Bytes<32>]
  );
  assert !yieldClaimNullifiers.member(disclose(nullifier)) "already claimed cycle";
  yieldClaimNullifiers.insert(disclose(nullifier));

  rentalPoolAvailable.decrement(disclose(amount));
  totalYieldClaims.increment(1);
}
```

---

## Ownership commitment model

```
commitment = H( "investor" || secret_key )
```

Every investor receives a `secret_key` derived deterministically from their wallet seed. They submit the **commitment** off-chain to the sponsor, who calls `issueShares(commitment, n)`. The on-chain state therefore reveals:

- That a new owner was added
- The total share count grew by `n`

but never **who** the owner is, **what share count** they hold (it is summed into `totalShares`), or **which** property they own.

The `HistoricMerkleTree<10, ...>` supports up to 1024 owners and preserves all historic roots so older proofs remain valid.

---

## Rental yield claims with nullifiers

```
nullifier = H( "yield" || secret_key || current_cycle )
```

Properties:

- Same investor, same cycle → same nullifier → second claim reverts.
- Same investor, different cycle → uncorrelated nullifier — no linkability across cycles.
- Anyone watching the chain sees only opaque nullifiers and the aggregate decrease in `rentalPoolAvailable`.

The `currentCycle` counter is what makes this a *recurring* yield, not a one-shot claim. Quarterly rental distributions just bump the cycle and let everyone reclaim.

---

## Witness system

```compact
witness investorSecret(): Bytes<32>;
```

```ts
export const witnesses = {
  investorSecret: ({ privateState }: WitnessContext<InvestorPrivateState>) => [
    privateState,
    privateState.secret,
  ],
};
```

The wallet's private state holds exactly one 32-byte secret. The proof server consumes the witness during proof generation; the public ledger sees only the nullifier hash.

---

## TypeScript API layer

```ts
import {
  deployContract,
  findDeployedContract,
} from "@midnight-ntwrk/midnight-js-contracts";
import { ConfidentialRealEstate, witnesses } from "../contract";

export const deployRealEstate = (providers, sponsorPk) =>
  deployContract(providers, {
    contract: new ConfidentialRealEstate(witnesses),
    initialPrivateState: { secret: crypto.getRandomValues(new Uint8Array(32)) },
    args: [sponsorPk],
  });

export const issueShares = async (providers, address, commitment, shares) => {
  const c = await findDeployedContract(providers, {
    contractAddress: address,
    contract: new ConfidentialRealEstate(witnesses),
  });
  return c.callTx.issueShares(commitment, shares);
};

export const claimYield = async (providers, address, amount) => {
  const c = await findDeployedContract(providers, {
    contractAddress: address,
    contract: new ConfidentialRealEstate(witnesses),
  });
  return c.callTx.claimYield(amount);
};
```

---

## React frontend integration

The frontend has three role-aware panels:

- **Sponsor panel** — register properties, issue shares against commitments, top up the rental pool, advance cycles.
- **Investor panel** — generate commitment to send sponsor at onboarding, then `proveOwnership` and `claimYield` later.
- **Auditor panel** — read-only stats dashboard.

Providers are composed centrally and memoized:

```tsx
const providers = useMemo(() => ({
  publicDataProvider: indexerPublicDataProvider(INDEXER_URL),
  privateStateProvider: levelPrivateStateProvider("/realestate-state"),
  zkConfigProvider: new FetchZkConfigProvider(BASE_URL),
  proofProvider: httpClientProofProvider(PROOF_SERVER_URL),
  walletProvider,
  midnightProvider: walletProvider,
}), [walletProvider]);
```

---

## Indexer-based state reading

```ts
const raw = await providers.publicDataProvider.queryContractState(address);
const state = ledger(raw.data);

return {
  properties: state.totalProperties,
  shares: state.totalShares,
  pool: state.rentalPoolAvailable,
  claims: state.totalYieldClaims,
  cycle: state.currentCycle,
};
```

A subscription variant powers live auditor dashboards that re-render on each new tx.

---

## Deployment

### Local devnet

```bash
docker compose -f compose/devnet.yaml up -d
npx compact build
pnpm dev
```

### Testnet

Point `.env` at the Midnight testnet indexer / proof server / node, fund the sponsor wallet, deploy from the sponsor panel.

---

## Public vs private data summary

| Field                            | Visibility |
| -------------------------------- | ---------- |
| Sponsor public key               | Public     |
| Total properties                 | Public     |
| Total shares outstanding         | Public     |
| Rental pool available            | Public     |
| Total yield claims (count)       | Public     |
| Current rental cycle             | Public     |
| Investor identities              | Private    |
| Per-investor share count         | Private    |
| Investor → property mapping      | Private    |
| Yield amount per investor        | Private    |
| Claim transaction → identity     | Private    |

Investors are private. Solvency, supply, and pool balance are public. Auditors get everything they need to verify the sponsor is distributing yield correctly — without ever seeing the cap table.

---

## Repository layout

```
confidential-real-estate/
├── contracts/
│   └── realestate.compact
├── src/
│   ├── api/             # contract.ts, providers.ts, witnesses.ts
│   ├── components/      # SponsorPanel, InvestorPanel, AuditorPanel
│   ├── hooks/
│   └── App.tsx
├── tutorial.md
└── README.md
```

---

## Companion tutorials in this series

- [Confidential Dividend Distribution](../confidential-dividend/README.md)
- [Confidential Asset Management](../confidential-asset-management/README.md)

---

**Author:** Ayush ([@eth_ay32](https://x.com/eth_ay32)) — [ayushsingh82](https://github.com/ayushsingh82)
