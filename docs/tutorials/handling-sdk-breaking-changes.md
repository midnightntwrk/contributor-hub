## Handling Midnight SDK Breaking Changes: A Developer's Survival Guide

**Difficulty:** Beginner-Intermediate  
**Time:** 15 minutes  
**Bounty:** #321

---

### Overview

Midnight's SDK is under active development. Breaking changes happen between versions — type renames, API shifts, config changes. This tutorial shows you how to handle upgrades smoothly, automate migration, and avoid common pitfalls when updating your dApp.

### What You'll Learn

- Detecting breaking changes early
- Automated migration scripts
- Handling common API changes
- Testing across SDK versions

### Step 1: Detect Breaking Changes

```bash
# Pin your SDK version
npm list @midnight-ntwrk/midnight-js
# @midnight-ntwrk/midnight-js@0.2.1

# Check what changed between versions
midnight sdk changelog @midnight-ntwrk/midnight-js 0.2.0 0.3.0

# Or check the GitHub releases
GH_TOKEN=$(python3 -c "import yaml; d=yaml.safe_load(open('/home/user/.config/gh/hosts.yml')); print(d['github.com']['oauth_token'])")
curl -s -H "Authorization: Bearer $GH_TOKEN" \
  "https://api.github.com/repos/midnight-ntwrk/midnight-js/releases?per_page=5" \
  | python3 -c "
import json,sys
releases = json.load(sys.stdin)
for r in releases[:3]:
    print(f'{r[\"tag_name\"]} ({r[\"published_at\"][:10]})')
    print(f'  {r[\"body\"][:200]}...')
    print()
"
```

### Step 2: Common Breaking Changes

| v0.1.x → v0.2.x | v0.2.x → v0.3.x | v0.3.x → v0.4.x |
|-----------------|-----------------|-----------------|
| `createProvider()` → `MidnightProvider.create()` | `call()` → `invoke()` | `queryContract()` → `queryState()` |
| `network: 'testnet'` → `network: Network.Testnet` | `SEED.publicKey` → `SEED.pubkey` | Nonce type: u64 → bytes32 |
| `contract.deploy()`  → `contract.publish()` | `height()` → `blockNumber()` | Event format restructured |

### Step 3: Migration Script Template

```javascript
// migrate-v2-to-v3.mjs
// Run: node migrate-v2-to-v3.mjs ./src/

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const replacements = [
    // Provider changes
    { from: /createProvider\(\)/g, to: 'MidnightProvider.create()' },
    { from: /\.call\(/g, to: '.invoke(' },
    { from: /queryContractState\(/g, to: 'queryState(' },
    
    // SDK renames
    { from: /network:\s*['"]testnet['"]/g, to: 'network: Network.Testnet' },
    { from: /network:\s*['"]mainnet['"]/g, to: 'network: Network.Mainnet' },
    { from: /SEED\.publicKey/g, to: 'SEED.pubkey' },
    
    // Type changes
    { from: /import \{ createProvider \} from/g, to: 'import { MidnightProvider } from' },
    { from: /@midnight-ntwrk\/midnight-js/g, to: '@midnight-ntwrk/midnight-js-v3' },
];

function migrateFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');
    let changed = false;
    
    for (const { from, to } of replacements) {
        if (from.test(content)) {
            content = content.replace(from, to);
            changed = true;
        }
    }
    
    if (changed) {
        fs.writeFileSync(filePath, content);
        console.log(`✅ Migrated: ${filePath}`);
    }
}

function walkDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
            walkDir(fullPath);
        } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.js')) {
            migrateFile(fullPath);
        }
    }
}

// Run migration
const targetDir = process.argv[2] || './src';
console.log(`Migrating ${targetDir}...`);
walkDir(targetDir);
console.log('Done! Run tests to verify.');
```

### Step 4: Version Pinning with Overrides

```json
{
  "name": "my-midnight-dapp",
  "dependencies": {
    "@midnight-ntwrk/midnight-js": "0.2.5",
    "@midnight-ntwrk/light-client": "0.1.3"
  },
  "overrides": {
    "@midnight-ntwrk/midnight-js": "0.2.5",
    "@midnight-ntwrk/light-client": "0.1.3"
  }
}
```

### Step 5: CI/CD Version Check

```yaml
# .github/workflows/sdk-version-check.yml
name: SDK Version Check

on:
  schedule:
    - cron: '0 0 * * 0'  # Weekly

jobs:
  check-versions:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Check SDK versions
        run: |
          CURRENT=$(node -p "require('./package.json').dependencies['@midnight-ntwrk/midnight-js']")
          echo "Current: $CURRENT"
          
          # Check latest from npm
          LATEST=$(curl -s https://registry.npmjs.org/@midnight-ntwrk/midnight-js | \
            python3 -c "import json,sys; versions=list(json.load(sys.stdin)['versions']); print(versions[-1])")
          echo "Latest: $LATEST"
          
          if [ "$CURRENT" != "$LATEST" ]; then
            echo "⚠️  New version available: $LATEST"
            echo "Current pinned: $CURRENT"
            echo "Run: npm install @midnight-ntwrk/midnight-js@$LATEST"
            exit 1
          fi
```

### Step 6: Feature Flag for Breaking Changes

```typescript
// version-compat.ts

interface SDKVersion {
    major: number;
    minor: number;
    patch: number;
}

export class VersionCompat {
    private version: SDKVersion;
    
    constructor(versionString: string) {
        const parts = versionString.replace('^', '').replace('~', '').split('.');
        this.version = {
            major: parseInt(parts[0] || '0'),
            minor: parseInt(parts[1] || '0'),
            patch: parseInt(parts[2] || '0'),
        };
    }
    
    // Check if feature exists in current version
    hasFeature(feature: string): boolean {
        switch (feature) {
            case 'private-state-query':
                return this.version.minor >= 3;
            case 'batch-verify':
                return this.version.minor >= 4;
            case 'event-stream':
                return this.version.major >= 1 || 
                       (this.version.major === 0 && this.version.minor >= 5);
            default:
                return false;
        }
    }
    
    // Return the correct API based on version
    getProviderAPI() {
        if (this.version.minor >= 2) {
            return 'MidnightProvider.create';
        }
        return 'createProvider';
    }
    
    getCallMethod() {
        if (this.version.minor >= 3) {
            return 'invoke';
        }
        return 'call';
    }
}

// Usage
const compat = new VersionCompat(
    require('../package.json').dependencies['@midnight-ntwrk/midnight-js']
);

const callMethod = compat.getCallMethod();
const result = await contract[callMethod]('transfer', [to, amount]);
```

### Step 7: Rollback Strategy

```bash
# Keep a backup of node_modules before upgrade
cp -r node_modules node_modules_backup

# Upgrade
npm install @midnight-ntwrk/midnight-js@latest

# Test
npm test

# If tests fail, rollback
if [ $? -ne 0 ]; then
    echo "❌ Tests failed, rolling back..."
    rm -rf node_modules
    mv node_modules_backup node_modules
    echo "✅ Rolled back to previous version"
    exit 1
fi

rm -rf node_modules_backup
```

### Summary

- Pin SDK versions in package.json with overrides
- Run automated migration scripts for common changes
- Set up weekly version checks in CI/CD
- Use feature flags to handle API changes gracefully
- Always test with `--update-snapshots` flag
- Keep a rollback strategy for when upgrades fail
