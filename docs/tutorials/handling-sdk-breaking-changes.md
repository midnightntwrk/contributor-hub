# Handling Midnight SDK Breaking Changes: A Developer's Upgrade Playbook

> **Difficulty:** Intermediate | **Estimated Time:** 20 minutes

## Overview

Breaking changes are inevitable in rapidly evolving SDKs. This tutorial provides a repeatable process for handling Midnight SDK upgrades, regardless of the specific version.

## The Upgrade Process

### Step 1: Identify What Changed

```bash
# Check changelog
cat CHANGELOG.md | grep -A 20 "Breaking"

# Compare package versions
npm outdated @midnight-ntwrk/*
```

### Step 2: Resolve Version Mismatch Errors

The most common error after an upgrade:

```
CompactError: Version mismatch
```

**Fix:**
1. Ensure all `@midnight-ntwrk/*` packages are on the same version
2. Clear node_modules and reinstall:

```bash
rm -rf node_modules package-lock.json
npm install
```

3. Check for peer dependency conflicts:

```bash
npm ls @midnight-ntwrk/midnight-js
```

### Step 3: Update Compiled Artifacts

After a compiler upgrade, previously compiled contract artifacts may be incompatible.

```bash
# Recompile all contracts
npx midnight-compile ./contracts --output ./artifacts

# Verify artifacts match new compiler version
ls -la ./artifacts/*.zcf
```

### Step 4: Dependency Audit Workflow

```bash
# 1. List all midnight dependencies
npm ls | grep midnight

# 2. Check for deprecated packages
npm deprecate list

# 3. Run tests to catch breaking changes
npm test

# 4. Check TypeScript compilation
npx tsc --noEmit
```

## Before/After package.json Examples

### Before (Broken - Mixed Versions)

```json
{
  "dependencies": {
    "@midnight-ntwrk/midnight-js": "^0.3.0",
    "@midnight-ntwrk/wallet": "^0.2.5",
    "@midnight-ntwrk/zkit": "^0.4.0"
  }
}
```

### After (Fixed - Aligned Versions)

```json
{
  "dependencies": {
    "@midnight-ntwrk/midnight-js": "^0.4.0",
    "@midnight-ntwrk/wallet": "^0.4.0",
    "@midnight-ntwrk/zkit": "^0.4.0"
  }
}
```

## Common Breaking Change Patterns

| Change Type | Symptom | Resolution |
|-------------|---------|------------|
| API rename | TypeError: X is not a function | Check migration guide |
| Type change | TypeScript error | Update type annotations |
| Removed export | Cannot find module X | Import from new location |
| Config format | Config ignored | Update config schema |
| Compiler output | Verification failed | Recompile artifacts |

## Automated Upgrade Script

```bash
#!/bin/bash
# midnight-upgrade.sh - Automated Midnight SDK upgrade

set -e

VERSION=$1
if [ -z "$VERSION" ]; then
  echo "Usage: ./midnight-upgrade.sh <version>"
  exit 1
fi

echo "Upgrading Midnight SDK to $VERSION..."

# Update all midnight packages
npm install @midnight-ntwrk/midnight-js@$VERSION \
  @midnight-ntwrk/wallet@$VERSION \
  @midnight-ntwrk/zkit@$VERSION \
  @midnight-ntwrk/midnight-contracts@$VERSION

# Recompile contracts
echo "Recompiling contracts..."
npx midnight-compile ./contracts --output ./artifacts

# Run tests
echo "Running tests..."
npm test

echo "Upgrade complete!"
```

## Conclusion

Always align all Midnight packages to the same version, recompile artifacts after compiler upgrades, and maintain a test suite to catch breaking changes early.
