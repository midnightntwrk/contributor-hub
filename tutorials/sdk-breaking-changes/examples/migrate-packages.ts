/**
 * migrate-packages.ts
 *
 * Automates the migration of @midnight-ntwrk/* packages between major versions.
 * Updates package.json, rewrites import paths if packages were restructured,
 * runs npm install, and verifies the migration.
 *
 * Usage:
 *   npx tsx examples/migrate-packages.ts --from 3 --to 4
 *   npx tsx examples/migrate-packages.ts --dry-run  # Preview changes without applying
 */

import { execSync } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, resolve } from "path";

interface MigrationRule {
  packageName: string;
  fromVersionPrefix: string;
  toVersionPrefix: string;
  importChanges?: { old: string; new: string }[];
}

/**
 * Define known migration rules.
 * Add new rules here when Midnight ships breaking changes.
 */
const MIGRATION_RULES: MigrationRule[] = [
  {
    packageName: "@midnight-ntwrk/midnight-js-contracts",
    fromVersionPrefix: "3.",
    toVersionPrefix: "4.",
    importChanges: [
      // Example: if Contract class moved to a different export
      // { old: "Contract", new: "MidnightContract" },
    ],
  },
  {
    packageName: "@midnight-ntwrk/midnight-js-types",
    fromVersionPrefix: "3.",
    toVersionPrefix: "4.",
  },
  {
    packageName: "@midnight-ntwrk/midnight-js-utils",
    fromVersionPrefix: "3.",
    toVersionPrefix: "4.",
  },
  {
    packageName: "@midnight-ntwrk/midnight-js-network-id",
    fromVersionPrefix: "2.",
    toVersionPrefix: "3.",
  },
  {
    packageName: "@midnight-ntwrk/midnight-js-http-client-proof-provider",
    fromVersionPrefix: "3.",
    toVersionPrefix: "4.",
  },
  {
    packageName: "@midnight-ntwrk/midnight-js-indexer-public-data-provider",
    fromVersionPrefix: "3.",
    toVersionPrefix: "4.",
  },
  {
    packageName: "@midnight-ntwrk/midnight-js-level-private-state-provider",
    fromVersionPrefix: "3.",
    toVersionPrefix: "4.",
  },
  {
    packageName: "@midnight-ntwrk/midnight-js-fetch-zk-config-provider",
    fromVersionPrefix: "3.",
    toVersionPrefix: "4.",
  },
  {
    packageName: "@midnight-ntwrk/dapp-connector-api",
    fromVersionPrefix: "2.",
    toVersionPrefix: "3.",
  },
  {
    packageName: "@midnight-ntwrk/compactc",
    fromVersionPrefix: "0.23",
    toVersionPrefix: "0.24",
  },
];

/**
 * Update package.json with new versions for @midnight-ntwrk/* packages.
 */
function updatePackageJson(projectDir: string, fromMajor: number, toMajor: number, dryRun: boolean): string[] {
  const packageJsonPath = join(projectDir, "package.json");
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
  const changes: string[] = [];

  const sections = ["dependencies", "devDependencies", "peerDependencies"];

  for (const section of sections) {
    if (!pkg[section]) continue;

    for (const [name, version] of Object.entries(pkg[section])) {
      if (!name.startsWith("@midnight-ntwrk/")) continue;

      const rule = MIGRATION_RULES.find((r) => r.packageName === name);
      if (!rule) continue;

      const currentVersion = version as string;
      if (currentVersion.includes(rule.fromVersionPrefix)) {
        const newVersion = currentVersion.replace(rule.fromVersionPrefix, rule.toVersionPrefix);
        if (!dryRun) {
          pkg[section][name] = newVersion;
        }
        changes.push(`  ${name}: ${currentVersion} → ${newVersion}`);
      }
    }
  }

  if (!dryRun && changes.length > 0) {
    writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + "\n");
  }

  return changes;
}

/**
 * Rewrite import paths in TypeScript source files.
 */
function rewriteImports(projectDir: string, dryRun: boolean): string[] {
  const changes: string[] = [];
  const srcDir = join(projectDir, "src");

  if (!existsSync(srcDir)) {
    return changes;
  }

  // Collect all import changes from migration rules
  const allImportChanges: { old: string; new: string; packageName: string }[] = [];
  for (const rule of MIGRATION_RULES) {
    if (rule.importChanges) {
      for (const change of rule.importChanges) {
        allImportChanges.push({ ...change, packageName: rule.packageName });
      }
    }
  }

  if (allImportChanges.length === 0) {
    return changes;
  }

  function scanAndRewrite(dir: string) {
    const { readdirSync, statSync } = require("fs");
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        scanAndRewrite(fullPath);
      } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        let content = readFileSync(fullPath, "utf-8");
        let modified = false;

        for (const change of allImportChanges) {
          if (content.includes(change.old)) {
            content = content.replace(new RegExp(change.old, "g"), change.new);
            modified = true;
            changes.push(`  ${fullPath.replace(projectDir + "/", "")}: ${change.old} → ${change.new}`);
          }
        }

        if (modified && !dryRun) {
          writeFileSync(fullPath, content);
        }
      }
    }
  }

  scanAndRewrite(srcDir);
  return changes;
}

/**
 * Run npm install and capture output.
 */
function runInstall(projectDir: string): { success: boolean; warnings: string[] } {
  try {
    const output = execSync("npm install 2>&1", {
      encoding: "utf-8",
      cwd: projectDir,
    });

    const warnings = output
      .split("\n")
      .filter((line) => line.includes("WARN") || line.includes("peer") || line.includes("invalid"));

    return { success: true, warnings };
  } catch (err: any) {
    return { success: false, warnings: [err.message] };
  }
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const fromIdx = args.indexOf("--from");
  const toIdx = args.indexOf("--to");

  const fromMajor = fromIdx >= 0 ? parseInt(args[fromIdx + 1]) : 3;
  const toMajor = toIdx >= 0 ? parseInt(args[toIdx + 1]) : 4;

  const projectDir = resolve(process.cwd());

  console.log(`=== Midnight SDK Migration: v${fromMajor}.x → v${toMajor}.x ===\n`);

  if (dryRun) {
    console.log("DRY RUN — no files will be modified\n");
  }

  // Step 1: Update package.json
  console.log("Step 1: Updating package.json...");
  const pkgChanges = updatePackageJson(projectDir, fromMajor, toMajor, dryRun);
  if (pkgChanges.length > 0) {
    console.log("Changes:");
    pkgChanges.forEach((c) => console.log(c));
  } else {
    console.log("  No changes needed.");
  }

  // Step 2: Rewrite imports
  console.log("\nStep 2: Checking import paths...");
  const importChanges = rewriteImports(projectDir, dryRun);
  if (importChanges.length > 0) {
    console.log("Import rewrites:");
    importChanges.forEach((c) => console.log(c));
  } else {
    console.log("  No import rewrites needed.");
  }

  // Step 3: Install
  if (!dryRun && pkgChanges.length > 0) {
    console.log("\nStep 3: Running npm install...");
    const result = runInstall(projectDir);
    if (result.success) {
      console.log("  Install completed successfully.");
      if (result.warnings.length > 0) {
        console.log("  Warnings:");
        result.warnings.forEach((w) => console.log(`    ${w}`));
      }
    } else {
      console.error("  Install FAILED:");
      result.warnings.forEach((w) => console.error(`    ${w}`));
      process.exit(1);
    }

    // Step 4: Verify
    console.log("\nStep 4: Verifying migration...");
    try {
      execSync("npx tsx examples/detect-changes.ts", {
        encoding: "utf-8",
        cwd: projectDir,
        stdio: "inherit",
      });
    } catch {
      console.log("  Verification script encountered issues — check output above.");
    }
  }

  console.log("\n=== Migration Summary ===");
  console.log(`Package updates: ${pkgChanges.length}`);
  console.log(`Import rewrites: ${importChanges.length}`);
  if (dryRun) {
    console.log("\nRun without --dry-run to apply changes.");
  }
}

main();
