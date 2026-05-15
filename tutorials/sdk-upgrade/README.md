# Upgrading the Midnight SDK: A Practical Step-by-Step Guide

> **Related:** This tutorial is the hands-on companion to [Handling Midnight SDK Breaking Changes](#321). While that guide catalogs what changed and why, this one walks you through the actual upgrade process — from auditing your current dependencies to shipping your updated dApp.

## Who This Tutorial Is For

You have an existing Midnight dApp built on an earlier SDK version (pre-4.x) and need to bring it up to date with the latest `@midnight-ntwrk` packages. Whether you're running a simple counter contract or a complex multi-party state machine, the upgrade workflow follows the same pattern.

**Prerequisites:**
- A working Midnight dApp with existing contract code and off-chain logic
- Node.js 18+ and npm 9+ (or yarn/pnpm equivalents)
- Familiarity with `git`, `npm`, and terminal basics
- Access to a Midnight testnet endpoint

---

## 1. Audit Your Current Dependency Tree

Before touching any code, understand what you're working with. Run a dependency audit to map every `@midnight-ntwrk` package your project uses.

```bash
# From your project root
npm ls @midnight-ntwrk/* 2>&1 | tee /tmp/midnight-deps-before.txt
```

A typical pre-4.x project depends on some combination of:

| Package | Typical Old Version | Purpose |
|---|---|---|
| `@midnight-ntwrk/wallet` | `3.7.x` | Wallet management and key derivation |
| `@midnight-ntwrk/wallet-api` | `3.3.x`–`3.5.x` | Wallet TypeScript interfaces |
| `@midnight-ntwrk/compact-runtime` | `0.6.x`–`0.7.x` | Contract execution runtime |
| `@midnight-ntwrk/midnight-js-types` | `3.x`–`4.0.x` | Shared TypeScript type definitions |

Record these versions. You'll reference them when resolving migration issues later.

```bash
# Extract a clean list of @midnight-ntwrk packages and their versions
npm ls @midnight-ntwrk/* --json 2>/dev/null \
  | python3 -c "
import json, sys
data = json.load(sys.stdin)
deps = data.get('dependencies', {})
for pkg, info in deps.items():
    if pkg.startswith('@midnight-ntwrk'):
        print(f'{pkg}@{info.get(\"version\", \"unknown\")}')
" | sort
```

Save this output. If anything goes wrong during the upgrade, you'll want it to roll back.

```bash
# Freeze your current lockfile as a safety net
cp package-lock.json package-lock.json.backup
# Or if using yarn:
# cp yarn.lock yarn.lock.backup
```

## 2. Create a Dedicated Upgrade Branch

Never upgrade on `main`. Create a feature branch so you can iterate without blocking other work:

```bash
git checkout -b chore/upgrade-midnight-sdk-4.x
```

## 3. Update Package Versions

### 3.1 Core Packages

Update the following packages to their latest major versions. The 4.x line represents the current stable generation:

```bash
npm install \
  @midnight-ntwrk/wallet@^5.0.0 \
  @midnight-ntwrk/wallet-api@^5.0.0 \
  @midnight-ntwrk/compact-runtime@^0.9.0 \
  @midnight-ntwrk/midnight-js-types@^4.0.4
```

> **Why the big version jumps?** The wallet packages moved from 3.x to 5.x because the 4.x line was a transitional release that restructured the wallet API surface. The `compact-runtime` went from 0.7 to 0.9, reflecting changes in how contracts are compiled and executed. See [Breaking Changes Reference](#321) for the full migration map.

### 3.2 Tooling Packages

If you use the Midnight MCP (Managed Contract Platform) CLI:

```bash
npm install midnight-mcp@^0.2.9
```

For Compact compiler tooling:

```bash
npm install @midnight-ntwrk/compactc@latest
```

### 3.3 Verify the Update

```bash
# Confirm no peer dependency warnings
npm install 2>&1 | grep -i "peer\|WARN"

# Check that the resolved versions look correct
npm ls @midnight-ntwrk/* 2>&1 | tee /tmp/midnight-deps-after.txt
```

If you see peer dependency conflicts, check the `peerDependencies` field of each package. The SDK packages are tightly version-coupled — a mismatch between `wallet` and `wallet-api` will cause runtime failures.

## 4. Fix Import Path Changes

The 4.x+ SDK restructured its module boundaries. The most common change is that wallet-related types moved from `@midnight-ntwrk/wallet` into `@midnight-ntwrk/wallet-api`.

### Before (3.x)

```typescript
import { WalletBuilder, Wallet } from '@midnight-ntwrk/wallet';
import { NativeWalletKeys } from '@midnight-ntwrk/wallet';
```

### After (4.x+)

```typescript
import { WalletBuilder } from '@midnight-ntwrk/wallet';
import { Wallet, NativeWalletKeys } from '@midnight-ntwrk/wallet-api';
```

**Migration pattern:** If an import breaks, check whether the symbol moved to `wallet-api`. The `wallet` package now exports the builder and high-level operations, while `wallet-api` holds the interface types.

Run a quick grep to find all your import sites:

```bash
grep -rn "@midnight-ntwrk/" src/ --include="*.ts" --include="*.js"
```

For each file, verify the import still resolves. TypeScript will flag unresolved imports at compile time, but JavaScript projects need manual verification.

## 5. Adapt to the New Wallet Initialization API

The wallet initialization flow changed significantly. The old `WalletBuilder.build()` pattern was replaced with an async factory that requires explicit network configuration.

### Old Pattern (3.x)

```typescript
const wallet = await WalletBuilder.build(
  indexerUrl,
  indexerWSUrl,
  proofServerUrl,
  networkId
);
```

### New Pattern (4.x+)

```typescript
import { WalletBuilder } from '@midnight-ntwrk/wallet';
import { NetworkId } from '@midnight-ntwrk/midnight-js-types';

const wallet = await WalletBuilder.build(
  'your-seed-phrase-or-hex-key',
  {
    indexer: 'https://indexer.testnet.midnight.network',
    indexerWS: 'wss://indexer.testnet.midnight.network/ws',
    proofServer: 'http://localhost:6300',
    networkId: NetworkId.TestNet,
  }
);
```

**Key differences:**
1. The seed/key is now the **first** argument, not something set separately
2. Network config is a single options object, not positional parameters
3. `NetworkId` is an enum from `midnight-js-types`, not a raw string

## 6. Update Contract Deployment Code

Contract deployment in 4.x+ uses the `DeployedContract` pattern rather than the older `deployContract` utility function.

### Old Pattern

```typescript
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';

const contract = await deployContract(wallet, contractModule, initialState);
const contractAddress = contract.address;
```

### New Pattern

```typescript
import { Contract } from '@midnight-ntwrk/compact-runtime';

// Build contract instance
const contract = new Contract(contractModule);

// Deploy through the wallet's contract API
const deployed = await wallet.deployContract(contract, {
  initialPrivateState: privateState,
  initialPublicState: publicState,
});

const contractAddress = deployed.address;
```

The key shift is that `Contract` objects are now first-class runtime entities, and deployment goes through the wallet's unified API rather than a standalone utility.

## 7. Handle Proof Server Changes

The proof server interface tightened in the 4.x+ SDK. If your dApp generates zero-knowledge proofs (which most do), you need to update your proof server configuration.

```typescript
// Old: implicit proof server discovery
const proofServer = 'http://localhost:6300';

// New: explicit proof server configuration with timeout
const proofServerConfig = {
  url: 'http://localhost:6300',
  timeout: 120_000, // 2 minutes for complex proofs
  retries: 3,
};
```

Pass this config into your wallet builder options (see Step 5). If you're running against a remote proof server, increase the timeout — ZK proof generation for complex circuits can take several minutes.

### Testing Without a Proof Server

For unit tests that don't need real proofs, you can use the mock proof provider:

```typescript
import { MockProofProvider } from '@midnight-ntwrk/compact-runtime/testing';

// In your test setup
const proofProvider = new MockProofProvider();
```

This generates dummy proofs instantly and is essential for fast test cycles.

## 8. Migrate State Management Code

If your dApp manages private state (almost all Midnight dApps do), the state handling API changed.

### Old Pattern

```typescript
const privateState = await wallet.getPrivateState(contractAddress);
const result = await contract.callMethod('myMethod', args, privateState);
await wallet.updatePrivateState(contractAddress, result.newState);
```

### New Pattern

```typescript
// Private state is now managed automatically by the wallet
// You only need to provide the initial state at deployment
const result = await contract.callMethod('myMethod', args);
// The wallet handles state tracking internally
```

The new SDK introduced automatic state synchronization — the wallet tracks private state changes from contract calls and persists them without manual intervention. This eliminates a major source of bugs in the old API.

If you need explicit state access (rare, but sometimes necessary for debugging):

```typescript
const currentState = await contract.privateState();
```

## 9. Update Event Listeners

The event system moved to an RxJS-based observable pattern in 4.x+:

```typescript
import { Observable } from 'rxjs';

// Old: callback-based events
wallet.on('newBlock', (block) => {
  console.log('New block:', block.height);
});

// New: observable-based events
wallet.blocks$.subscribe((block) => {
  console.log('New block:', block.height);
});

// Old: callback-based balance updates
wallet.on('balanceChanged', handleBalance);

// New: observable-based balance updates
wallet.balance$.subscribe(handleBalance);
```

If your project doesn't already depend on RxJS, you'll need to add it:

```bash
npm install rxjs
```

## 10. Compile and Test

Now comes the moment of truth. Compile your updated code:

```bash
# TypeScript projects
npx tsc --noEmit

# If using Compact contracts, recompile them
npx compactc src/contracts/*.compact build/
```

Fix any remaining type errors. The most common issues at this stage:

- **Missing type exports:** Check if types moved between packages
- **Changed function signatures:** Compare old and new parameter lists
- **Removed deprecated APIs:** Some functions from 3.x have no equivalent; refactor the calling code

Run your test suite:

```bash
npm test
```

If tests fail with connection errors, ensure your proof server is running and your testnet endpoint is accessible.

## 11. Verify on Testnet

After all tests pass locally, deploy to the Midnight testnet:

```bash
# Set your testnet configuration
export MIDNIGHT_NETWORK=testnet
export PROOF_SERVER_URL=http://your-proof-server:6300

# Deploy
npm run deploy
```

Interact with your deployed contract to verify:
- Contract calls succeed and return expected results
- Zero-knowledge proofs generate and verify correctly
- Wallet synchronization works (balance updates, transaction history)
- Event listeners fire on new blocks and state changes

## 12. Clean Up and Commit

Once everything works:

```bash
# Remove the backup lockfile if no longer needed
rm package-lock.json.backup

# Review your changes
git diff --stat

# Commit
git add -A
git commit -m "chore: upgrade Midnight SDK to 4.x/5.x

- @midnight-ntwrk/wallet: 3.7.x -> 5.0.0
- @midnight-ntwrk/wallet-api: 3.5.x -> 5.0.0
- @midnight-ntwrk/compact-runtime: 0.7.x -> 0.9.0
- @midnight-ntwrk/midnight-js-types: 4.0.x -> 4.0.4
- Migrated wallet initialization to new options-based API
- Updated import paths for wallet-api types
- Switched to RxJS-based event system
- Adapted contract deployment to new Contract class pattern"
```

## Troubleshooting

### "Cannot find module '@midnight-ntwrk/wallet-api'"

The `wallet-api` package is separate from `wallet`. Install it explicitly:

```bash
npm install @midnight-ntwrk/wallet-api@^5.0.0
```

### "Peer dependency mismatch" during npm install

The `@midnight-ntwrk` packages are version-locked to each other. Use `--legacy-peer-deps` temporarily, then find the correct compatible versions:

```bash
npm install --legacy-peer-deps
npm ls @midnight-ntwrk/* --json | python3 -c "
import json, sys
data = json.load(sys.stdin)
for name, info in data.get('dependencies', {}).items():
    if 'peerDep' in str(info.get('problems', [])):
        print(f'Mismatch: {name}')
"
```

### Proof generation hangs or times out

1. Verify the proof server is running: `curl http://localhost:6300/health`
2. Check circuit compatibility — recompile contracts with the new Compact compiler
3. Increase the timeout in your proof server config (see Step 7)

### "Wallet seed is invalid" on startup

The seed validation tightened in 4.x+. Ensure you're passing a valid BIP-39 mnemonic or a 64-character hex string. The old API accepted some edge-case formats that the new one rejects.

### Contract state deserialization fails after upgrade

If you have existing deployed contracts with persisted state, the serialization format may have changed. Options:

1. **Redeploy:** For testnet contracts, just redeploy with fresh state
2. **Migration script:** For mainnet contracts, write a one-time migration that reads old state and writes it in the new format

## Summary

The Midnight SDK upgrade from 3.x to 4.x/5.x touches five main areas:

1. **Package versions** — Bump all `@midnight-ntwrk` packages together
2. **Import paths** — Types moved from `wallet` to `wallet-api`
3. **Wallet initialization** — New options-object API with explicit seed
4. **Contract deployment** — `Contract` class replaces standalone deploy utility
5. **Event system** — Callbacks replaced with RxJS observables

The upgrade is non-trivial but systematic. Follow the steps in order, fix compile errors as they appear, and verify on testnet before merging. If you get stuck, the [Midnight Developer Forum](https://forum.midnight.network/) and [Discord](https://discord.com/invite/midnightnetwork) are the best places to ask.

---

*This tutorial is part of the [Midnight Network Contributor Hub](https://github.com/midnightntwrk/contributor-hub). See [issue #322](https://github.com/midnightntwrk/contributor-hub/issues/322) for the bounty details.*
