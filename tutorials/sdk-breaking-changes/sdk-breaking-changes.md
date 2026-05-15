# Handling Midnight SDK Breaking Changes: A Developer's Upgrade Playbook

**By billbtbillb | May 2026**

Your CI pipeline is red. The error reads `CompactError: Version mismatch`. You run `npm outdated` and see six `@midnight-ntwrk/*` packages with new major versions. Your compiled contract artifacts are stale. Your proof server rejects every transaction. The Discord is full of developers asking the same question: *how do I upgrade without breaking everything?*

This tutorial gives you a repeatable playbook. Not a one-time fix for a specific version — a process you run every time Midnight ships breaking changes. By the end, you will detect breaking changes before they break production, resolve version mismatch errors systematically, recompile artifacts after compiler upgrades, audit your dependency tree for conflicts, and roll back cleanly when something goes wrong.

## Prerequisites

- Midnight toolchain installed ([installation guide](https://docs.midnight.network/getting-started/installation))
- Node.js v22+
- Familiarity with Compact syntax basics ([hello world tutorial](https://docs.midnight.network/getting-started/hello-world))
- An existing Midnight dApp project with `@midnight-ntwrk/*` dependencies

---

## 1. How Midnight Packages Are Organized

The Midnight SDK is split into scoped packages under `@midnight-ntwrk/`. Each handles a specific layer of the dApp stack:

```
@midnight-ntwrk/midnight-js-contracts          ← Contract deployment & interaction
@midnight-ntwrk/midnight-js-types               ← Shared TypeScript types
@midnight-ntwrk/midnight-js-utils               ← Utility functions
@midnight-ntwrk/midnight-js-network-id          ← Network identifier helpers
@midnight-ntwrk/midnight-js-http-client-proof-provider  ← Proof server client
@midnight-ntwrk/midnight-js-indexer-public-data-provider ← Indexer queries
@midnight-ntwrk/midnight-js-level-private-state-provider ← Local private state
@midnight-ntwrk/midnight-js-fetch-zk-config-provider    ← ZK config fetching
@midnight-ntwrk/dapp-connector-api              ← Wallet connector interface
@midnight-ntwrk/compactc                        ← Compact compiler (CLI)
```

When Midnight ships a release, these packages often version together — but not always. A compiler upgrade (`compactc`) might bump independently from the runtime packages. Understanding which packages are coupled and which move independently is the first skill in the upgrade playbook.

### Version Coupling Map

```
┌─────────────────────────────────────────────────────────────┐
│                    Compiler Layer                            │
│  compactc ←————————————————→ Compiled Artifacts (.contract)  │
└─────────────────────────────────────────────────────────────┘
         │
         │ (ABI compatibility)
         ▼
┌─────────────────────────────────────────────────────────────┐
│                    Runtime Layer                             │
│  midnight-js-contracts ←→ midnight-js-types                 │
│  midnight-js-utils     ←→ midnight-js-network-id            │
└─────────────────────────────────────────────────────────────┘
         │
         │ (provider interface)
         ▼
┌─────────────────────────────────────────────────────────────┐
│                    Provider Layer                            │
│  midnight-js-http-client-proof-provider                      │
│  midnight-js-indexer-public-data-provider                    │
│  midnight-js-level-private-state-provider                    │
│  midnight-js-fetch-zk-config-provider                        │
└─────────────────────────────────────────────────────────────┘
         │
         │ (wallet interface)
         ▼
┌─────────────────────────────────────────────────────────────┐
│                    Connector Layer                           │
│  dapp-connector-api                                         │
└─────────────────────────────────────────────────────────────┘
```

**Rule of thumb:** When `compactc` changes major version, you must recompile all artifacts. When the runtime layer changes, you must update imports and possibly rewire provider construction. When the provider layer changes, you update configuration objects. The connector layer changes rarely.

---

## 2. Detecting Breaking Changes

Before touching any code, identify what changed. Run this sequence:

### Step 1: Check for Outdated Packages

```bash
npm outdated --long 2>/dev/null | grep @midnight-ntwrk
```

Output looks like:

```
Package                                  Current  Wanted  Latest  Location
@midnight-ntwrk/midnight-js-contracts    3.2.1    3.2.1   4.0.0   my-dapp
@midnight-ntwrk/midnight-js-types        3.1.0    3.1.0   4.0.0   my-dapp
@midnight-ntwrk/compactc                 0.23.0   0.23.0  0.24.0  my-dapp
```

A major version bump (3.x → 4.x) is always breaking. A minor bump (0.23 → 0.24) in pre-1.0 packages is also breaking under semver.

### Step 2: Read the Release Notes

Check the [Midnight release overview](https://docs.midnight.network/relnotes/overview) for the specific version you are upgrading to. Focus on:

- **Breaking changes** section — API removals, renames, signature changes
- **Migration guide** section — official step-by-step if provided
- **Deprecation notices** — warnings that become errors in the *next* release

### Step 3: Diff Your Lock File

```bash
# Save current state
cp package-lock.json package-lock.json.bak

# Update only @midnight-ntwrk packages
npm update --save @midnight-ntwrk/*

# See what changed
diff package-lock.json.bak package-lock.json | grep -A2 -B2 "@midnight-ntwrk"
```

### Step 4: Automated Detection Script

Use the `detect-changes.ts` example from this tutorial to scan your project programmatically. It compares your installed versions against the latest published versions and flags breaking changes:

```bash
npx tsx examples/detect-changes.ts
```

Output:

```
=== Midnight SDK Change Report ===

BREAKING CHANGES DETECTED:
  @midnight-ntwrk/midnight-js-contracts: 3.2.1 → 4.0.0 (MAJOR)
    → Contract.deploy() signature changed
    → ProviderConfig type restructured
  @midnight-ntwrk/compactc: 0.23.0 → 0.24.0 (MINOR in pre-1.0 = BREAKING)
    → Compiler output format changed
    → New proof circuit ABI version

ACTION REQUIRED:
  1. Recompile all .compact contracts
  2. Update provider construction code
  3. Regenerate type bindings
```

---

## 3. Resolving `CompactError: Version mismatch`

This is the most common error after an SDK upgrade. It means your compiled contract artifacts were built with a different compiler version than the runtime expects.

### What Causes It

Every compiled `.contract` file embeds the compiler version that produced it. The runtime (`midnight-js-contracts`) checks this version against its own expected ABI version. If they do not match, you get:

```
CompactError: Version mismatch
  Expected ABI version: 4
  Found ABI version: 3
  Recompile your contract with compactc >= 0.24.0
```

### The Fix (Always the Same)

```bash
# 1. Clean old artifacts
rm -rf contracts/managed/ contracts/build/

# 2. Recompile with the new compiler
npx compactc contracts/my_contract.compact contracts/managed/

# 3. Regenerate TypeScript bindings if your workflow uses them
npx compactc --typescript contracts/my_contract.compact contracts/managed/
```

### Why This Cannot Be Skipped

The ABI version is baked into the zero-knowledge proof circuits. A version 3 proof cannot be verified by a version 4 verifier. There is no backward-compatible path — you must recompile. This is a fundamental constraint of the ZK proof system, not a software design choice.

### Preventing Future Mismatches

Add a pre-build check to your `package.json`:

```json
{
  "scripts": {
    "prebuild": "npx tsx examples/detect-changes.ts --check-artifacts",
    "build": "compactc contracts/*.compact contracts/managed/ && tsc",
    "clean": "rm -rf contracts/managed/ contracts/build/ dist/"
  }
}
```

The `--check-artifacts` flag in the detection script compares the embedded compiler version in each `.contract` file against the currently installed `compactc` version. If they differ, the pre-build step fails with a clear message instead of letting you hit `CompactError` at runtime.

---

## 4. Updating Compiled Artifacts After a Compiler Upgrade

A `compactc` upgrade changes more than just the version stamp. New compiler versions may:

- Change the proof circuit structure (new constraints, optimizations)
- Alter the generated TypeScript bindings
- Add or remove compiler flags
- Change default behavior for `disclose()`, `left()`/`right()` casting, or numeric types

### Migration Workflow

```bash
# 1. Record the old compiler version
compactc --version > .compactc-old-version

# 2. Update the compiler
npm install --save-dev @midnight-ntwrk/compactc@latest

# 3. Clean everything
rm -rf contracts/managed/ contracts/build/ dist/

# 4. Attempt recompilation
compactc contracts/*.compact contracts/managed/ 2>&1 | tee compile-log.txt

# 5. If compilation fails, check compile-log.txt for:
#    - Removed APIs (update contract source)
#    - Changed type signatures (update arguments)
#    - New required parameters (add defaults)
```

### Handling Compiler Errors After Upgrade

Common post-upgrade compiler errors and their fixes:

**Error: `Unknown function 'sendShielded'`**
The function was renamed or removed. Check the release notes for the replacement. Often `sendShielded` becomes `sendShieldedTokens` with a different argument order.

**Error: `Type mismatch: expected Uint<128>, got Uint<64>`**
The compiler tightened type checking. Explicitly cast:
```compact
// Before (worked in old compiler)
totalAmount = totalAmount + amount;

// After (required in new compiler)
totalAmount = totalAmount + (amount as Uint<128>);
```

**Error: `disclose() requires explicit type annotation`**
The compiler now requires type context for `disclose()` calls:
```compact
// Before
const value = disclose(secretValue);

// After
const value = disclose(secretValue) as Uint<64>;
```

### Regenerating TypeScript Bindings

After recompilation, regenerate the TypeScript types that your dApp code imports:

```bash
compactc --typescript contracts/my_contract.compact contracts/managed/
```

Then update your import paths if the generated module structure changed:

```typescript
// Before (old compiler output)
import { MyContract } from "./contracts/managed/my_contract";

// After (new compiler output — check your actual generated path)
import { MyContract } from "./contracts/managed/my_contract/module";
```

---

## 5. Dependency Audit Workflow

When multiple packages change, you need a systematic way to verify that every dependency is compatible. This workflow catches problems that `npm install` alone will not surface.

### The Audit Script

Run the full audit:

```bash
npx tsx examples/detect-changes.ts --full-audit
```

This performs four checks:

**Check 1: Version Matrix**
Verifies that all `@midnight-ntwrk/*` packages are on compatible versions. Packages within the same release train share a version matrix — mixing versions from different releases causes subtle runtime failures.

**Check 2: Peer Dependency Resolution**
Checks that every package's peer dependencies are satisfied. Midnight packages declare peer dependencies on each other, and mismatches cause silent type errors or runtime crashes.

**Check 3: Artifact Compatibility**
Scans `contracts/managed/` for compiled artifacts and compares their embedded compiler version against the installed `compactc`.

**Check 4: Import Path Validation**
Scans your TypeScript source for `@midnight-ntwrk/*` imports and verifies each imported symbol exists in the installed version. This catches renamed or removed exports.

### Manual Audit Checklist

If you prefer manual verification:

```bash
# 1. Check for version conflicts
npm ls @midnight-ntwrk/* 2>&1 | grep -i "invalid\|missing\|peer"

# 2. Verify no duplicate versions
npm dedupe --dry-run 2>&1 | grep @midnight-ntwrk

# 3. Check all artifacts are fresh
find contracts/managed -name "*.contract" -newer node_modules/@midnight-ntwrk/compactc/package.json

# 4. Search for deprecated imports
grep -rn "from.*@midnight-ntwrk" src/ | sort -u
```

### Before/After `package.json` Examples

Here is what a typical migration looks like when upgrading from SDK v3.x to v4.x:

**Before (v3.x):**
```json
{
  "dependencies": {
    "@midnight-ntwrk/midnight-js-contracts": "^3.2.1",
    "@midnight-ntwrk/midnight-js-types": "^3.1.0",
    "@midnight-ntwrk/midnight-js-utils": "^3.0.0",
    "@midnight-ntwrk/midnight-js-network-id": "^2.1.0",
    "@midnight-ntwrk/midnight-js-http-client-proof-provider": "^3.1.0",
    "@midnight-ntwrk/midnight-js-indexer-public-data-provider": "^3.0.2",
    "@midnight-ntwrk/midnight-js-level-private-state-provider": "^3.0.1",
    "@midnight-ntwrk/midnight-js-fetch-zk-config-provider": "^3.0.0",
    "@midnight-ntwrk/dapp-connector-api": "^2.0.0"
  },
  "devDependencies": {
    "@midnight-ntwrk/compactc": "^0.23.0"
  }
}
```

**After (v4.x):**
```json
{
  "dependencies": {
    "@midnight-ntwrk/midnight-js-contracts": "^4.0.0",
    "@midnight-ntwrk/midnight-js-types": "^4.0.0",
    "@midnight-ntwrk/midnight-js-utils": "^4.0.0",
    "@midnight-ntwrk/midnight-js-network-id": "^3.0.0",
    "@midnight-ntwrk/midnight-js-http-client-proof-provider": "^4.0.0",
    "@midnight-ntwrk/midnight-js-indexer-public-data-provider": "^4.0.0",
    "@midnight-ntwrk/midnight-js-level-private-state-provider": "^4.0.0",
    "@midnight-ntwrk/midnight-js-fetch-zk-config-provider": "^4.0.0",
    "@midnight-ntwrk/dapp-connector-api": "^3.0.0"
  },
  "devDependencies": {
    "@midnight-ntwrk/compactc": "^0.24.0"
  }
}
```

**Key observations:**
- Runtime packages (contracts, types, utils, providers) moved to v4.x together
- `midnight-js-network-id` jumped from v2 to v3 (it had a different version track)
- `dapp-connector-api` moved from v2 to v3
- `compactc` bumped from 0.23 to 0.24 (breaking in pre-1.0 semver)

### Automated Migration

Use the `migrate-packages.ts` script to automate the version bump and import rewriting:

```bash
npx tsx examples/migrate-packages.ts --from 3 --to 4
```

The script:
1. Updates all `@midnight-ntwrk/*` versions in `package.json`
2. Rewrites import paths if any package was renamed or restructured
3. Runs `npm install` and captures any peer dependency warnings
4. Runs the detection script to verify everything is consistent

---

## 6. Common Code Changes During Migration

Beyond version numbers, SDK upgrades often require code changes. Here are the most frequent patterns:

### Provider Construction Changes

The provider configuration API often restructures between major versions:

```typescript
// BEFORE: v3.x provider construction
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";

const providers = {
  proofProvider: httpClientProofProvider("http://localhost:6300"),
  publicDataProvider: indexerPublicDataProvider("http://localhost:8088/api/v1"),
  privateStateProvider: levelPrivateStateProvider("./private-state"),
};
```

```typescript
// AFTER: v4.x provider construction (example of typical changes)
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";

// v4.x may require explicit network ID or config objects
const providers = {
  proofProvider: httpClientProofProvider({
    url: "http://localhost:6300",
    networkId: "testnet",
  }),
  publicDataProvider: indexerPublicDataProvider({
    indexerUrl: "http://localhost:8088",
    apiVersion: "v3",
  }),
  privateStateProvider: levelPrivateStateProvider({
    path: "./private-state",
  }),
};
```

### Contract Deployment Changes

```typescript
// BEFORE: v3.x
const contract = await Contract.deploy(providers, contractConfig, privateState);

// AFTER: v4.x — deployment may require additional options
const contract = await Contract.deploy(providers, {
  contractConfig,
  privateState,
  proofServerUrl: "http://localhost:6300",
  network: "testnet",
});
```

### Transaction Submission Changes

```typescript
// BEFORE: v3.x
const tx = await contract.callTx.myMethod(arg1, arg2);
const txHash = await wallet.submitTransaction(tx.prove());

// AFTER: v4.x — prove() may become asynchronous or change signature
const tx = await contract.callTx.myMethod(arg1, arg2);
const provenTx = await tx.prove();  // Note: prove() might now be async
const txHash = await wallet.submitTransaction(provenTx);
```

---

## 7. Rollback Strategy

Not every upgrade goes smoothly. When the new SDK version breaks your dApp in ways you cannot fix immediately, you need a clean rollback.

### Snapshot Before Upgrading

Always create a rollback point before starting an upgrade:

```bash
# Create a git tag
git tag -a pre-sdk-upgrade-$(date +%Y%m%d) -m "Snapshot before SDK upgrade"

# Backup critical files
cp package.json package.json.pre-upgrade
cp package-lock.json package-lock.json.pre-upgrade
cp -r contracts/managed/ contracts/managed.backup/
```

### Automated Rollback

Use the `rollback.ts` script:

```bash
npx tsx examples/rollback.ts --snapshot pre-sdk-upgrade-20260515
```

The script:
1. Restores `package.json` and `package-lock.json` from the snapshot
2. Runs `npm ci` to reinstall the exact previous dependency tree
3. Restores compiled artifacts from the backup
4. Verifies the rollback by running the detection script

### Manual Rollback Steps

If you prefer manual rollback:

```bash
# 1. Restore package files
cp package.json.pre-upgrade package.json
cp package-lock.json.pre-upgrade package-lock.json

# 2. Clean and reinstall
rm -rf node_modules/
npm ci

# 3. Restore compiled artifacts
rm -rf contracts/managed/
cp -r contracts/managed.backup/ contracts/managed/

# 4. Rebuild
npm run build

# 5. Verify
npm test
```

### Partial Rollback

Sometimes you only need to roll back one package. This is safe when the package is in the provider layer (not coupled to the compiler):

```bash
# Roll back only the proof provider
npm install @midnight-ntwrk/midnight-js-http-client-proof-provider@3.1.0

# Keep everything else on the new version
# Test thoroughly — provider layer packages are usually safe to mix
```

**Warning:** Never partially roll back the compiler (`compactc`) without also rolling back the runtime packages. The compiler and runtime must be ABI-compatible.

---

## 8. The Upgrade Playbook (Step-by-Step)

Run this sequence every time you upgrade:

```
┌─────────────────────────────────────────────────────────┐
│  1. DETECT                                               │
│     npm outdated | grep @midnight-ntwrk                  │
│     npx tsx examples/detect-changes.ts                   │
├─────────────────────────────────────────────────────────┤
│  2. SNAPSHOT                                             │
│     git tag pre-upgrade-$(date +%Y%m%d)                  │
│     cp package*.json backups/                            │
│     cp -r contracts/managed/ backups/artifacts/          │
├─────────────────────────────────────────────────────────┤
│  3. READ                                                 │
│     Check release notes for breaking changes             │
│     Note compiler version changes                        │
│     Note API removals/renames                            │
├─────────────────────────────────────────────────────────┤
│  4. UPDATE                                               │
│     npm install @midnight-ntwrk/*@latest                 │
│     npm install @midnight-ntwrk/compactc@latest          │
├─────────────────────────────────────────────────────────┤
│  5. CLEAN                                                │
│     rm -rf contracts/managed/ dist/                      │
│     compactc contracts/*.compact contracts/managed/      │
├─────────────────────────────────────────────────────────┤
│  6. FIX                                                  │
│     Resolve compiler errors                              │
│     Update imports and provider construction             │
│     Regenerate TypeScript bindings                       │
├─────────────────────────────────────────────────────────┤
│  7. AUDIT                                                │
│     npx tsx examples/detect-changes.ts --full-audit      │
│     npm test                                             │
├─────────────────────────────────────────────────────────┤
│  8. COMMIT or ROLLBACK                                   │
│     If tests pass: git commit -am "Upgrade SDK to v4.x"  │
│     If tests fail: npx tsx examples/rollback.ts          │
└─────────────────────────────────────────────────────────┘
```

---

## 9. Best Practices for Minimizing Upgrade Pain

1. **Pin exact versions in production** — Use exact versions (`4.0.0` not `^4.0.0`) for `@midnight-ntwrk/*` packages. The caret operator is dangerous when breaking changes ship in minor releases (pre-1.0 packages).

2. **Use a version matrix file** — Create a `midnight-versions.json` that records the tested combination of package versions. The detection script reads this file.

3. **Automate artifact checks** — Add `detect-changes.ts --check-artifacts` to your CI pipeline. Catch stale artifacts before they hit production.

4. **Upgrade in a separate branch** — Never upgrade SDK versions on `main`. Create a branch, run the full playbook, and merge only after tests pass.

5. **Test against the same network** — If your testnet environment runs a different SDK version than mainnet, you will get version mismatches that only appear in production. Use environment-specific lock files.

6. **Read the changelog, not just the diff** — Automated diff tools miss semantic changes. A function that returns `Uint<64>` instead of `Uint<128>` looks identical in a diff but causes runtime truncation.

7. **Keep the compiler and runtime in sync** — Never mix `compactc` 0.23 with `midnight-js-contracts` 4.x. They must be from the same release train.

8. **Document your migration** — Record what changed in your project during each upgrade. Future you will thank present you when the next breaking change lands.

---

## Summary

SDK breaking changes are a fact of life on Midnight. The network is actively evolving — new compiler features, optimized proof circuits, improved provider APIs. Each release brings improvements that require migration work.

The playbook is simple: **detect, snapshot, read, update, clean, fix, audit, commit or rollback.** Follow it every time, and breaking changes become a 30-minute task instead of a three-day fire drill.

The key insight: `CompactError: Version mismatch` is not a bug — it is a safety mechanism. The ZK proof system refuses to mix artifacts from different compiler versions because that would compromise proof correctness. Recompilation is always the answer.

## Resources

- [Midnight Documentation](https://docs.midnight.network)
- [Midnight Release Notes](https://docs.midnight.network/relnotes/overview)
- [Compact Language Reference](https://docs.midnight.network/compact/reference/compact-reference)
- [Midnight MCP](https://www.npmjs.com/package/midnight-mcp)
- [Midnight Developer Forum](https://forum.midnight.network)
- [Midnight Discord](https://discord.com/invite/midnightnetwork)

---

*Tags: #MidnightforDevs #MidnightNetwork #SDK #BreakingChanges #Migration #Compact #UpgradeGuide*
