/**
 * rollback.ts
 *
 * Rollback utility for Midnight SDK upgrades.
 * Creates snapshots before upgrades and restores them when needed.
 *
 * Usage:
 *   npx tsx examples/rollback.ts --snapshot <tag-name>    # Restore from snapshot
 *   npx tsx examples/rollback.ts --list                   # List available snapshots
 *   npx tsx examples/rollback.ts --create <tag-name>      # Create a new snapshot
 */

import { execSync } from "child_process";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  copyFileSync,
  cpSync,
  readdirSync,
} from "fs";
import { join, resolve } from "path";

const SNAPSHOT_DIR = ".sdk-snapshots";

interface Snapshot {
  name: string;
  timestamp: string;
  packageJsonHash: string;
  lockfileHash: string;
  artifactCount: number;
}

/**
 * Ensure the snapshot directory exists.
 */
function ensureSnapshotDir(projectDir: string): string {
  const snapshotDir = join(projectDir, SNAPSHOT_DIR);
  if (!existsSync(snapshotDir)) {
    mkdirSync(snapshotDir, { recursive: true });
  }
  return snapshotDir;
}

/**
 * Create a snapshot of the current project state.
 */
function createSnapshot(projectDir: string, name: string): void {
  const snapshotDir = ensureSnapshotDir(projectDir);
  const snapshotPath = join(snapshotDir, name);

  if (existsSync(snapshotPath)) {
    console.error(`Snapshot '${name}' already exists. Choose a different name.`);
    process.exit(1);
  }

  mkdirSync(snapshotPath, { recursive: true });

  // Save package files
  const filesToSave = ["package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml"];
  for (const file of filesToSave) {
    const src = join(projectDir, file);
    if (existsSync(src)) {
      copyFileSync(src, join(snapshotPath, file));
      console.log(`  Saved ${file}`);
    }
  }

  // Save compiled artifacts
  const managedDir = join(projectDir, "contracts", "managed");
  if (existsSync(managedDir)) {
    const artifactBackup = join(snapshotPath, "contracts-managed");
    cpSync(managedDir, artifactBackup, { recursive: true });
    const count = countFiles(artifactBackup);
    console.log(`  Saved ${count} compiled artifacts`);
  }

  // Create snapshot metadata
  const metadata: Snapshot = {
    name,
    timestamp: new Date().toISOString(),
    packageJsonHash: hashFile(join(projectDir, "package.json")),
    lockfileHash: hashFile(join(projectDir, "package-lock.json")),
    artifactCount: existsSync(managedDir) ? countFiles(managedDir) : 0,
  };

  writeFileSync(join(snapshotPath, "metadata.json"), JSON.stringify(metadata, null, 2));

  // Also create a git tag
  try {
    execSync(`git tag -a "pre-sdk-upgrade-${name}" -m "SDK upgrade snapshot: ${name}"`, {
      cwd: projectDir,
      stdio: "pipe",
    });
    console.log(`  Created git tag: pre-sdk-upgrade-${name}`);
  } catch {
    console.log("  Warning: Could not create git tag (not a git repo or tag exists)");
  }

  console.log(`\nSnapshot '${name}' created successfully.`);
  console.log(`Location: ${snapshotPath}`);
}

/**
 * List all available snapshots.
 */
function listSnapshots(projectDir: string): void {
  const snapshotDir = join(projectDir, SNAPSHOT_DIR);

  if (!existsSync(snapshotDir)) {
    console.log("No snapshots found. Create one with --create <name>");
    return;
  }

  const entries = readdirSync(snapshotDir, { withFileTypes: true });
  const snapshots = entries.filter((e) => e.isDirectory());

  if (snapshots.length === 0) {
    console.log("No snapshots found.");
    return;
  }

  console.log("Available snapshots:\n");

  for (const entry of snapshots) {
    const metadataPath = join(snapshotDir, entry.name, "metadata.json");
    if (existsSync(metadataPath)) {
      const meta: Snapshot = JSON.parse(readFileSync(metadataPath, "utf-8"));
      console.log(`  ${meta.name}`);
      console.log(`    Created: ${meta.timestamp}`);
      console.log(`    Artifacts: ${meta.artifactCount}`);
      console.log("");
    } else {
      console.log(`  ${entry.name} (no metadata)`);
    }
  }
}

/**
 * Restore from a snapshot.
 */
function restoreSnapshot(projectDir: string, name: string): void {
  const snapshotPath = join(projectDir, SNAPSHOT_DIR, name);

  if (!existsSync(snapshotPath)) {
    console.error(`Snapshot '${name}' not found.`);
    console.log("Run with --list to see available snapshots.");
    process.exit(1);
  }

  console.log(`Restoring from snapshot '${name}'...\n`);

  // Step 1: Restore package files
  console.log("Step 1: Restoring package files...");
  const filesToRestore = ["package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml"];
  for (const file of filesToRestore) {
    const src = join(snapshotPath, file);
    const dest = join(projectDir, file);
    if (existsSync(src)) {
      copyFileSync(src, dest);
      console.log(`  Restored ${file}`);
    }
  }

  // Step 2: Clean and reinstall dependencies
  console.log("\nStep 2: Reinstalling dependencies...");
  try {
    // Remove node_modules for clean install
    const nodeModulesPath = join(projectDir, "node_modules");
    if (existsSync(nodeModulesPath)) {
      execSync("rm -rf node_modules/", { cwd: projectDir });
      console.log("  Removed node_modules/");
    }

    // Run npm ci for exact lockfile restoration
    execSync("npm ci 2>&1", {
      encoding: "utf-8",
      cwd: projectDir,
      stdio: "pipe",
    });
    console.log("  Dependencies installed from lockfile.");
  } catch (err: any) {
    console.error("  npm ci failed, trying npm install...");
    try {
      execSync("npm install 2>&1", {
        encoding: "utf-8",
        cwd: projectDir,
        stdio: "pipe",
      });
      console.log("  Dependencies installed.");
    } catch (installErr: any) {
      console.error(`  Install failed: ${installErr.message}`);
      process.exit(1);
    }
  }

  // Step 3: Restore compiled artifacts
  console.log("\nStep 3: Restoring compiled artifacts...");
  const artifactBackup = join(snapshotPath, "contracts-managed");
  const managedDir = join(projectDir, "contracts", "managed");

  if (existsSync(artifactBackup)) {
    // Clean current artifacts
    if (existsSync(managedDir)) {
      execSync(`rm -rf ${managedDir}`, { cwd: projectDir });
    }
    cpSync(artifactBackup, managedDir, { recursive: true });
    const count = countFiles(managedDir);
    console.log(`  Restored ${count} compiled artifacts.`);
  } else {
    console.log("  No artifacts to restore.");
  }

  // Step 4: Verify
  console.log("\nStep 4: Verifying rollback...");
  try {
    const output = execSync("npm ls @midnight-ntwrk/* 2>&1", {
      encoding: "utf-8",
      cwd: projectDir,
    });

    const hasErrors = output.includes("invalid") || output.includes("missing") || output.includes("ERR!");
    if (hasErrors) {
      console.log("  Warning: Some dependency issues detected:");
      console.log(
        output
          .split("\n")
          .filter((l) => l.includes("invalid") || l.includes("missing") || l.includes("ERR!"))
          .map((l) => `    ${l}`)
          .join("\n"),
      );
    } else {
      console.log("  All dependencies resolved successfully.");
    }
  } catch {
    console.log("  Warning: Could not verify dependency tree.");
  }

  console.log("\n=== Rollback Complete ===");
  console.log("Run 'npm test' to verify your dApp works with the restored state.");
}

/**
 * Count files recursively in a directory.
 */
function countFiles(dir: string): number {
  let count = 0;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      count += countFiles(join(dir, entry.name));
    } else {
      count++;
    }
  }
  return count;
}

/**
 * Simple hash of a file's contents (for comparison, not cryptographic use).
 */
function hashFile(path: string): string {
  if (!existsSync(path)) return "missing";
  const content = readFileSync(path, "utf-8");
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return hash.toString(16);
}

function main() {
  const args = process.argv.slice(2);
  const projectDir = resolve(process.cwd());

  if (args.includes("--list")) {
    listSnapshots(projectDir);
    return;
  }

  const createIdx = args.indexOf("--create");
  if (createIdx >= 0) {
    const name = args[createIdx + 1] || `snapshot-${Date.now()}`;
    createSnapshot(projectDir, name);
    return;
  }

  const snapshotIdx = args.indexOf("--snapshot");
  if (snapshotIdx >= 0) {
    const name = args[snapshotIdx + 1];
    if (!name) {
      console.error("Please specify a snapshot name: --snapshot <name>");
      process.exit(1);
    }
    restoreSnapshot(projectDir, name);
    return;
  }

  // Default: show usage
  console.log("Midnight SDK Rollback Utility\n");
  console.log("Usage:");
  console.log("  npx tsx examples/rollback.ts --create <name>    Create a snapshot");
  console.log("  npx tsx examples/rollback.ts --list              List snapshots");
  console.log("  npx tsx examples/rollback.ts --snapshot <name>   Restore from snapshot");
  console.log("\nWorkflow:");
  console.log("  1. Before upgrading: npx tsx examples/rollback.ts --create pre-v4-upgrade");
  console.log("  2. If upgrade fails: npx tsx examples/rollback.ts --snapshot pre-v4-upgrade");
}

main();
