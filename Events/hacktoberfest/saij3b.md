---
type: tutorial
team_slug: saij3b
team_name: saij3b
project_title: Multi-Party Private State and Contracts Between Two+ Users
repo_url: https://github.com/saij3b/midnight-multiparty-tutorial
demo_url: https://github.com/saij3b/midnight-multiparty-tutorial/blob/main/TUTORIAL.md
link:
members:
  - name: saij3b
    github: saij3b
tech_stack: [TypeScript, Compact, Midnight.js, zk]
tracks: [tutorial, privacy, multi-party]
---

A tutorial that extends Midnight's two-party private-state pattern to N parties using a staking-pool example. Covers a `Map` of commitments keyed by party identifier, multiple users joining a deployed contract via `findDeployedContract`, and how to keep concurrent private-state updates safe. Built for the Multi-Party Private State Tutorial bounty (issue #303).

---

# Multi-Party Private State and Contracts Between Two+ Users on Midnight

The Midnight examples that ship with the SDK lean heavily on two-party patterns: a sender and a recipient, or a counterparty pair holding mirrored secrets. Real applications rarely stop at two participants. Treasuries have five signers. Staking pools have hundreds. Auctions have whatever number of bidders show up. The two-party recipe doesn't quite stretch to those shapes, and the place it stops stretching is usually the same: the part of the contract that has to remember *which secret belongs to which person*.

This tutorial walks through that transition end to end. We build a small staking-pool contract — multiple users deposit private commitments to a shared pool, the pool tracks a `Map` of those commitments keyed by party identifier, and any participant can later withdraw their own stake by proving knowledge of their secret. Along the way we cover joining a deployed contract via `findDeployedContract`, partitioning private state per party, and the concurrency gotchas you only meet once you have more than two writers racing for the same on-chain state.

The full source — Compact contract, witnesses, tests, and a `main.ts` runner that spins up three local parties — lives in the linked repository. This file is the written walkthrough.

## Why two-party patterns don't generalize for free

In the classic two-party private-state example, each side keeps a local secret and the contract holds one or two commitments. The contract effectively says: *"there are exactly two slots; the first one belongs to Alice, the second to Bob, and we know who is who because of positional ordering."* That works because the cardinality is fixed and the seating chart is hardcoded.

The moment you add a third party, three things break.

First, positional ordering stops being meaningful. If five users can join a pool in any order, the contract can't index participants by `party_1`, `party_2`, etc. It needs an identifier that travels with each user.

Second, the private state has to fan out. Two parties is comfortable as a pair of locals on each machine. N parties means each user holds their own state, but the contract has to be able to *look up* the right commitment for whichever user is calling — without learning who that user is.

Third, two writers can be coordinated by polite turn-taking. N writers cannot. Two of them will try to update the pool in the same block, and the contract has to handle the conflict without either of them having to re-do work or, worse, silently drop a deposit.

A `Map` keyed by a derived party identifier solves the first two. Optimistic-retry semantics with idempotent operations solve the third. The rest of the tutorial is about wiring those together.

## The scenario: a private staking pool

The example we'll use is a staking pool. Any number of users can deposit a stake. Each user's stake is private — nobody else, including future joiners, learns how much you put in or that you participated at all unless you choose to reveal. At any time a participant can withdraw exactly their own stake by proving knowledge of the secret they used at deposit. Aggregate-only views (total pool size, number of participants) are public so a UI can render them.

This shape covers a lot of real ground. The same skeleton works for a multi-sig treasury (each signer holds a private approval commitment, the contract reveals action only when a threshold of distinct commitments is opened), a sealed-bid auction (each bidder commits a bid, all opened at close), and a private payroll (each contributor commits a salary, the payer settles without the others learning the split).

## The contract shape

Here's the Compact contract, trimmed to the parts that matter. Full source is in the repo.

```compact
pragma language_version >= 0.13;

import CompactStandardLibrary;

// Public ledger state
export ledger total_staked: Counter;
export ledger participant_count: Counter;

// Private-keyed map: each party_id maps to a commitment over their stake.
// party_id is a public identifier derived from a per-party secret salt,
// NOT the user's wallet address.
export ledger stakes: Map<Bytes<32>, Bytes<32>>;

// Set of party_ids that have already withdrawn. Prevents replay.
export ledger withdrawn: Set<Bytes<32>>;

// Witness functions — these read from per-party local state, never on-chain.
witness local_secret(): Bytes<32>;
witness local_stake_amount(): Uint<64>;

export circuit deposit(amount: Uint<64>): [] {
  const secret = local_secret();
  const party_id = persistent_hash<Vector<2, Bytes<32>>>(
    [pad(32, "midnight:stakepool:pid"), secret]
  );
  const commitment = persistent_hash<Vector<3, Bytes<32>>>(
    [pad(32, "midnight:stakepool:cmt"), secret, amount_to_bytes(amount)]
  );

  assert(!stakes.member(disclose(party_id)), "party already staked");
  stakes.insert(disclose(party_id), disclose(commitment));
  total_staked.increment(amount);
  participant_count.increment(1);
}

export circuit withdraw(amount: Uint<64>): [] {
  const secret = local_secret();
  const party_id = persistent_hash<Vector<2, Bytes<32>>>(
    [pad(32, "midnight:stakepool:pid"), secret]
  );
  const expected = persistent_hash<Vector<3, Bytes<32>>>(
    [pad(32, "midnight:stakepool:cmt"), secret, amount_to_bytes(amount)]
  );

  assert(stakes.member(disclose(party_id)), "no such party");
  assert(stakes.lookup(disclose(party_id)) == disclose(expected),
         "commitment does not match claimed amount");
  assert(!withdrawn.member(disclose(party_id)), "already withdrawn");

  stakes.remove(disclose(party_id));
  withdrawn.insert(disclose(party_id));
  total_staked.decrement(amount);
  participant_count.decrement(1);
}
```

Five things are worth pausing on.

**`party_id` is derived, not assigned.** Each user mints their own identifier deterministically from a local secret. The contract never has to assign them, and two users can join in either order without coordination. The hash is domain-separated with a tag string so identifiers from this pool can't collide with identifiers from another contract that happens to share the same secret.

**The commitment binds the amount.** If the commitment were just `H(secret)`, a user could later claim to have staked any amount and the contract couldn't tell. Including `amount` in the preimage ties the two together, so withdrawal can only succeed for the exact amount that was deposited.

**`Map` instead of indexed slots.** `Map<Bytes<32>, Bytes<32>>` gives O(log n) lookup keyed on the derived identifier. Adding a sixth participant doesn't touch the first five's slots. This is the structural change that takes the contract from two-party to N-party.

**`Set<Bytes<32>> withdrawn` is the replay guard.** Once a party has withdrawn, their `party_id` is parked in `withdrawn` so they can't deposit and withdraw against the same identifier twice. Without this, an attacker who recovered a leaked secret could withdraw, then re-deposit, then withdraw again.

**Public aggregates are explicit.** `total_staked` and `participant_count` are public counters because we *want* them to be. Anything you don't put on the ledger stays private. The exercise of designing the contract is mostly the exercise of choosing what's public.

## Witnesses: per-party private state

In Midnight, witnesses are the seam between on-chain logic and each party's local secrets. Two-party tutorials usually only have one witness — the local secret — because there's nothing else to remember. For N-party we need at least two: the secret, and the stake amount this party plans to commit (so it doesn't have to be passed in by the UI, which would risk leaking it through logs or wallet popups).

The witness implementation lives in `witnesses.ts`:

```typescript
import { type StakingPoolPrivateState } from './common-types.js';

export const witnesses = {
  local_secret: (
    ctx: { privateState: StakingPoolPrivateState },
  ): [StakingPoolPrivateState, Uint8Array] => [
    ctx.privateState,
    ctx.privateState.secret,
  ],
  local_stake_amount: (
    ctx: { privateState: StakingPoolPrivateState },
  ): [StakingPoolPrivateState, bigint] => [
    ctx.privateState,
    ctx.privateState.intendedAmount,
  ],
};
```

The private state is a per-user object that the Midnight provider persists locally on each user's machine. The contract logic doesn't know it exists; it only sees the witness outputs.

```typescript
export interface StakingPoolPrivateState {
  secret: Uint8Array;          // 32 bytes, generated once per user
  intendedAmount: bigint;      // updated before each deposit / withdraw call
}
```

A new user creates a fresh secret on first run with `crypto.getRandomValues(new Uint8Array(32))` and stores it via the SDK's private-state provider. The same secret is reused across deposit and withdrawal, which is what gives the user the ability to later identify their own stake.

## Joining a deployed contract with `findDeployedContract`

One party deploys the contract. Everyone else joins. The join path is `findDeployedContract`, and this is where multi-party setups diverge most visibly from two-party tutorials.

The deployer's side looks like the standard flow:

```typescript
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';

const deployed = await deployContract(providers, {
  privateStateId: 'stakepool',
  contract,
  initialPrivateState,
});
console.log('Pool address:', deployed.deployTxData.public.contractAddress);
```

A second user who only has the contract address — typically shared out of band via a URL, a Discord post, or a QR code — joins like this:

```typescript
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';

const joined = await findDeployedContract(providers, {
  contractAddress,
  contract,
  privateStateId: 'stakepool',
  initialPrivateState: await freshPrivateState(),
});
```

The second user does *not* inherit the first user's private state. Each party seeds its own `initialPrivateState` with its own freshly generated secret. The `privateStateId` string namespaces it inside that user's private-state store, so the same machine can join the same contract under two different identities for testing — give them different `privateStateId` values and they won't collide.

A common mistake here is to assume `findDeployedContract` is a read-only operation. It isn't. It sets up a fully writable handle: the joining party can immediately call `joined.callTx.deposit(amount)` and the result is indistinguishable from the deploying party's calls. The only difference is who paid the deployment fee.

If you're building a UI that supports both flows, the cleanest pattern is to detect whether an address is present in the URL or local storage and branch:

```typescript
async function connect(providers, address) {
  if (address) {
    return findDeployedContract(providers, { /* join */ });
  }
  return deployContract(providers, { /* deploy */ });
}
```

That way the same code path can either bootstrap the first user or onboard the second through the hundredth.

## Concurrent updates and what they look like in practice

Two-party flows can usually paper over concurrency. With three parties, you'll see your first conflict within a handful of test runs.

A concrete scenario: Alice, Bob, and Carol all hit "deposit" within the same second. The wallet hands all three the same on-chain state snapshot to build their proofs against. All three proofs are valid relative to that snapshot. The block producer picks one — say Alice's — and commits it. Bob's and Carol's proofs were generated against a pre-Alice state, and the contract's runtime check sees that and rejects them.

The user-visible symptom is a transaction failure with a state-mismatch error. The fix has two parts.

**The contract should be re-runnable.** Our `deposit` circuit reads `stakes.member(party_id)` and only inserts if absent. Each party's `party_id` is unique, so re-running the circuit against the post-Alice state still produces a valid proof — there is no actual conflict between Bob's deposit and Alice's deposit; they're just touching adjacent keys. The contract's logic is naturally re-runnable because the `Map` is keyed by party.

**The client should retry on stale-state errors.** The `@midnight-ntwrk/midnight-js-contracts` runtime exposes a re-proof option, but in practice it's cleaner to wrap your call in a small retry helper:

```typescript
async function callWithRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (e) {
      if (!isStaleStateError(e) || i === attempts - 1) throw e;
      await sleep(250 * (i + 1));
    }
  }
  throw new Error('unreachable');
}

await callWithRetry(() => joined.callTx.deposit(amount));
```

Three attempts with linear backoff is enough for a pool of dozens. For an auction with thousands of bidders, you want exponential backoff and a randomized jitter window so retries don't synchronize.

A subtler concurrency gotcha shows up on withdrawal. If a user calls `withdraw` and then immediately calls `deposit` again with the same secret, the second call has to wait until the `withdrawn` set has been updated on-chain — otherwise it will succeed against a stale view that still lists the party as withdrawn-pending-but-not-yet-committed, and your wallet ends up with two pending transactions racing each other. The safest pattern is to await the receipt of the first transaction before submitting the second. The SDK gives you a `txReceipt` promise; resolve it before re-using the same secret.

Idempotency at the application layer matters too. If your UI shows a spinner and the user double-clicks "Deposit", you'd rather the second click no-op than send a second transaction that will fail noisily. Track in-flight calls keyed by `party_id` and short-circuit duplicates.

## Testing multi-party flows

The repo includes a test suite under `contracts/staking-pool/test/` that exercises the multi-party path end-to-end. The structure is worth borrowing.

A `MultiPartyHarness` class wraps the test ledger and lets you spin up N simulated parties, each with its own private state. Every party is just a `{ secret, intendedAmount }` pair plus a thin client wrapper.

```typescript
const harness = new MultiPartyHarness();
const [alice, bob, carol] = await harness.parties(3);
await harness.deploy(alice);
await Promise.all([
  harness.deposit(alice, 100n),
  harness.deposit(bob, 250n),
  harness.deposit(carol, 75n),
]);

expect(harness.totalStaked()).toBe(425n);
expect(harness.participantCount()).toBe(3);

await harness.withdraw(bob, 250n);
expect(harness.totalStaked()).toBe(175n);
expect(harness.participantCount()).toBe(2);
```

Three tests are doing real work here.

**The concurrent-deposit test** fires three deposits at once using `Promise.all`, asserts that all three eventually succeed (with retry), and that the final aggregates are the sum.

**The wrong-amount-withdrawal test** has Bob try to withdraw `100n` instead of his actual `250n`. The assertion inside the contract fires; the test catches the rejection and confirms that Bob's stake remains in the pool.

**The replay-after-withdrawal test** has Carol withdraw, then attempt to withdraw again with the same secret. The first succeeds, the second fails because `party_id` is now in `withdrawn`.

These three tests cover the most common multi-party failure modes. If your own contract passes them, the move from two-party to N-party is structurally sound.

## What changes if you scale further

Everything above scales comfortably to dozens of parties. For hundreds, two more things become worth thinking about.

**Map iteration cost.** Compact's `Map` is logarithmic per lookup, but if you ever need to fold across all entries — to compute a total that isn't already maintained as a counter, for example — that's linear in N. Keep aggregates as counters that you maintain at insert/remove time, the way `total_staked` is maintained above. Don't compute them by traversing `stakes`.

**Witness key management.** Each user keeping a single secret is fine. Each user keeping a hundred secrets (because they're in a hundred pools) is a UX problem. A common pattern is to derive per-pool secrets from a master seed and the contract address via HKDF, so the user only ever has to back up one master seed. This is a wallet-layer concern, not a contract-layer concern, but it's worth designing for from the start.

For thousands of parties — sealed-bid auctions, large airdrops — the contract pattern is the same but you'll want a separate off-chain coordination layer (a relay, or a queue your UI submits to) to smooth out the retry load on the block producer. The contract doesn't change; the client around it does.

## A walkthrough of the multi-sig treasury variant

The same skeleton, with two small swaps, gives you a multi-sig treasury. Worth walking through because it's the variant most teams end up wanting in production.

The treasury holds funds on behalf of a set of signers. Any signer can propose a withdrawal. The withdrawal only executes when a threshold (say, 3 of 5) of distinct signers have privately approved it. Nobody outside the signer set learns who approved, only that the threshold was met.

The contract changes are small. Instead of `stakes: Map<Bytes<32>, Bytes<32>>`, you have `approvals: Map<Bytes<32>, Set<Bytes<32>>>` keyed by the hash of the proposal payload, valued by the set of `party_id`s that have approved. The propose circuit is open to anyone whose `party_id` is in a pre-registered `signers: Set<Bytes<32>>`. The approve circuit checks signer membership, adds the caller's `party_id` to the approvals set, and — if `approvals.size() >= threshold` — flips a `ready_to_execute` flag. A separate execute circuit settles the transfer.

What's interesting about this shape is that the privacy boundary is different from the staking pool. In the pool, each user's *participation* is private; in the treasury, the *signer set* is registered up front and therefore public, but *which signers approved which proposal* stays private inside the `Set<Bytes<32>>` until and unless the contract chooses to reveal it. Because the set lives inside the contract's ledger state and is only ever inspected by `.size()` and `.member()` checks, no external observer learns the membership. The aggregate (threshold met / not met) is what becomes public.

The witnesses are the same as before: a local secret per signer, plus a per-call payload that the signer is approving. The join flow is the same `findDeployedContract`. The concurrency story is the same — two signers approving simultaneously is benign because their `party_id`s are distinct keys in the approvals set — except for one extra wrinkle. If two approvals arrive at the moment the threshold is being crossed, both will see a sub-threshold view and both will set `ready_to_execute = true`. Idempotence in the flag setter handles that without any client coordination.

This is a useful sanity check: if your N-party shape works for both *anyone can deposit* (pool) and *only-this-fixed-list can approve* (treasury), the underlying pattern is solid.

## Wrapping up

The leap from two-party to N-party in Midnight is mostly a change of data structure: a `Map` keyed by a per-party derived identifier instead of a pair of named slots, paired with a `Set` to guard against replay. Around that, the join flow uses `findDeployedContract` to onboard everyone after the deployer, and a small client-side retry helper handles the concurrent-write conflicts that show up the moment you have three writers.

If you start every multi-party contract by writing down the answers to three questions — *how is each party identified*, *what does each party hold privately*, and *what aggregate do we want to be public* — the rest of the design tends to fall out of those answers without much extra work.

The reference repository has the full source, the test harness, and a `main.ts` runner that wires up three local parties against the testnet so you can watch the flow end-to-end. PRs and issues welcome.
