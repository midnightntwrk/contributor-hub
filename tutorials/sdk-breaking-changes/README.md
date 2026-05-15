# Handling Midnight SDK Breaking Changes: A Developer's Upgrade Playbook

## Overview

A repeatable process for upgrading when Midnight ships breaking changes — not tied to any single version. This tutorial covers identifying which packages changed, resolving `CompactError: Version mismatch` errors, updating compiled artifacts after a compiler upgrade, a dependency audit workflow, and rollback strategies with real before/after `package.json` examples.

## Files

- `sdk-breaking-changes.md` — Main tutorial (2,500+ words): detection, migration, compilation, audit workflow, rollback
- `examples/detect-changes.ts` — TypeScript utility for detecting SDK version mismatches across a project
- `examples/migrate-packages.ts` — Script to automate package migration and import rewriting
- `examples/rollback.ts` — Rollback utility with snapshot and restore capabilities

## Prerequisites

- Midnight toolchain installed ([installation guide](https://docs.midnight.network/getting-started/installation))
- Node.js v22+
- Familiarity with Compact syntax basics ([hello world tutorial](https://docs.midnight.network/getting-started/hello-world))
- An existing Midnight dApp project with `@midnight-ntwrk/*` dependencies

## Topics Covered

1. Detecting which SDK packages changed and understanding the changelog
2. Resolving `CompactError: Version mismatch` errors step by step
3. Updating compiled artifacts after a compiler upgrade
4. A repeatable dependency audit workflow
5. Before/after `package.json` migration patterns
6. Rollback strategies when an upgrade goes wrong
7. Automation scripts for safe, repeatable upgrades

## Related Issue

[#321 — [Tutorial] Handling Midnight SDK Breaking Changes: A Developer's Upgrade Playbook](https://github.com/midnightntwrk/contributor-hub/issues/321)
