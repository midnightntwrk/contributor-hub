# Handling Midnight SDK Breaking Changes: A Developer's Upgrade Playbook

## Introduction

Midnight SDK evolves rapidly. When breaking changes land, your dev environment can break with `CompactError: Version mismatch`. This playbook gives you a repeatable process to upgrade confidently.

## 1. Identify Which Packages Changed

Start by comparing your current `package.json` with the latest Midnight starter template.

```bash
npx midnight-mcp init temp-upgrade-test --template hello-world
cd temp-upgrade-test
cat package.json
```

Then run `npm outdated` in your project:

```bash
cd your-project
npm outdated
```

Look for packages like `@midnight-ntwrk/*`, `midnight-mcp`, `compact-*`.

**Before (your project):**
```json
{
  "dependencies": {
    "@midnight-ntwrk/midnight-js-sdk": "^0.1.0",
    "compact-encoding": "^1.0.0"
  }
}
```

**After (new template):**
```json
{
  "dependencies": {
    "@midnight-ntwrk/midnight-js-sdk": "^0.2.0",
    "compact-encoding": "^2.0.0"
  }
}
```

Update your `package.json` to match, then run `npm install`.

## 2. Resolve `CompactError: Version mismatch`

This error means your compiled `.compact` artifacts don't match the current SDK version. Delete and recompile.

```bash
rm -rf dist/compact/*.compact
npx compact compile --src src/compact --out dist/compact
```

If your code imports compact modules, update imports:

```typescript
// Before
import { MyContract } from './dist/compact/my_contract.compact';

// After
import { MyContract } from './dist/compact/my_contract.js';
```

## 3. Update Compiled Artifacts After Compiler Upgrade

When the Compact compiler version changes, recompile all contracts.

```bash
npx compact compile --src src --out dist --force
```

Run tests to verify:

```bash
npm test
```

## 4. Dependency Audit Workflow

Run `npm audit` to find vulnerabilities:

```bash
npm audit
```

Create a lockfile diff:

```bash
diff package-lock.json ../backup/package-lock.json
```

Use `npm overrides` if needed:

```json
{
  "overrides": {
    "compact-encoding": "^2.0.0"
  }
}
```

## 5. Before/After Package.json Examples

See the full example in [midnight-upgrade-example](https://github.com/your-org/midnight-upgrade-example).

## Conclusion

With this playbook, you can handle any Midnight SDK breaking change systematically. Always keep a backup, test thoroughly, and refer to the [Midnight Docs](https://docs.midnight.network/getting-started).

---

*Published with #MidnightforDevs*