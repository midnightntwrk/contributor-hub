/**
 * detect-changes.ts
 *
 * Detects Midnight SDK version mismatches across a project.
 * Compares installed versions against latest published versions,
 * checks compiled artifact compatibility, and validates import paths.
 *
 * Usage:
 *   npx tsx examples/detect-changes.ts                    # Basic check
 *   npx tsx examples/detect-changes.ts --check-artifacts  # Include artifact check
 *   npx tsx examples/detect-changes.ts --full-audit       # All checks
 */

import { execSync } from "child_process";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join, resolve } from "path";

interface PackageInfo {
  name: string;
  current: string;
  latest: string;
  isBreaking: boolean;
  layer: "compiler" | "runtime" | "provider" | "connector";
}

interface ArtifactInfo {
  path: string;
  compilerVersion: string;
  expectedVersion: string;
  isStale: boolean;
}

const MIDNIGHT_PACKAGES = [
  { name: "@midnight-ntwrk/midnight-js-contracts", layer: "runtime" as const },
  { name: "@midnight-ntwrk/midnight-js-types", layer: "runtime" as const },
  { name: "@midnight-ntwrk/midnight-js-utils", layer: "runtime" as const },
  { name: "@midnight-ntwrk/midnight-js-network-id", layer: "runtime" as const },
  { name: "@midnight-ntwrk/midnight-js-http-client-proof-provider", layer: "provider" as const },
  { name: "@midnight-ntwrk/midnight-js-indexer-public-data-provider", layer: "provider" as const },
  { name: "@midnight-ntwrk/midnight-js-level-private-state-provider", layer: "provider" as const },
  { name: "@midnight-ntwrk/midnight-js-fetch-zk-config-provider", layer: "provider" as const },
  { name: "@midnight-ntwrk/dapp-connector-api", layer: "connector" as const },
  { name: "@midnight-ntwrk/compactc", layer: "compiler" as const },
];

/**
 * Parse semver string into components.
 */
function parseSemver(version: string): { major: number; minor: number; patch: number } {
  const cleaned = version.replace(/^[^0-9]*/, "");
  const parts = cleaned.split(".").map(Number);
  return {
    major: parts[0] || 0,
    minor: parts[1] || 0,
    patch: parts[2] || 0,
  };
}

/**
 * Determine if a version change is breaking.
 */
function isBreakingChange(current: string, latest: string, packageName: string): boolean {
  const cur = parseSemver(current);
  const lat = parseSemver(latest);

  // For pre-1.0 packages (like compactc), minor bumps are breaking
  if (cur.major === 0 && lat.major === 0) {
    return lat.minor > cur.minor;
  }

  // For 1.0+ packages, major bumps are breaking
  return lat.major > cur.major;
}

/**
 * Get installed and latest versions for all Midnight packages.
 */
function getVersionInfo(projectDir: string): PackageInfo[] {
  const results: PackageInfo[] = [];

  for (const pkg of MIDNIGHT_PACKAGES) {
    try {
      // Get installed version
      const installedPath = join(projectDir, "node_modules", pkg.name, "package.json");
      let current = "not installed";
      if (existsSync(installedPath)) {
        const installedPkg = JSON.parse(readFileSync(installedPath, "utf-8"));
        current = installedPkg.version;
      }

      // Get latest version from npm
      let latest = "unknown";
      try {
        latest = execSync(`npm view ${pkg.name} version`, {
          encoding: "utf-8",
          cwd: projectDir,
        }).trim();
      } catch {
        // npm view might fail if package is private or network is down
      }

      results.push({
        name: pkg.name,
        current,
        latest,
        isBreaking: current !== "not installed" ? isBreakingChange(current, latest, pkg.name) : false,
        layer: pkg.layer,
      });
    } catch (err) {
      console.error(`Warning: Could not check ${pkg.name}: ${err}`);
    }
  }

  return results;
}

/**
 * Check compiled contract artifacts for version mismatches.
 */
function checkArtifacts(projectDir: string, expectedCompilerVersion: string): ArtifactInfo[] {
  const managedDir = join(projectDir, "contracts", "managed");
  const results: ArtifactInfo[] = [];

  if (!existsSync(managedDir)) {
    console.log("  No contracts/managed/ directory found — skipping artifact check.");
    return results;
  }

  function scanDir(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (entry.name.endsWith(".contract")) {
        try {
          const content = readFileSync(fullPath, "utf-8");
          // Attempt to extract compiler version from artifact metadata
          // The format varies by compiler version; this is a best-effort parse
          const versionMatch = content.match(/"compiler_version"\s*:\s*"([^"]+)"/);
          const compilerVersion = versionMatch ? versionMatch[1] : "unknown";

          results.push({
            path: fullPath.replace(projectDir + "/", ""),
            compilerVersion,
            expectedVersion: expectedCompilerVersion,
            isStale: compilerVersion !== "unknown" && compilerVersion !== expectedCompilerVersion,
          });
        } catch {
          // Binary artifact — cannot parse
          results.push({
            path: fullPath.replace(projectDir + "/", ""),
            compilerVersion: "binary",
            expectedVersion: expectedCompilerVersion,
            isStale: false, // Cannot determine
          });
        }
      }
    }
  }

  scanDir(managedDir);
  return results;
}

/**
 * Scan source files for @midnight-ntwrk imports.
 */
function scanImports(projectDir: string): { file: string; importPath: string; line: number }[] {
  const srcDir = join(projectDir, "src");
  const results: { file: string; importPath: string; line: number }[] = [];

  if (!existsSync(srcDir)) {
    return results;
  }

  function scanDir(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        const content = readFileSync(fullPath, "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const match = lines[i].match(/from\s+["'](@midnight-ntwrk\/[^"']+)["']/);
          if (match) {
            results.push({
              file: fullPath.replace(projectDir + "/", ""),
              importPath: match[1],
              line: i + 1,
            });
          }
        }
      }
    }
  }

  scanDir(srcDir);
  return results;
}

/**
 * Main detection routine.
 */
function main() {
  const args = process.argv.slice(2);
  const checkArtifactsFlag = args.includes("--check-artifacts") || args.includes("--full-audit");
  const fullAudit = args.includes("--full-audit");
  const projectDir = resolve(process.cwd());

  console.log("=== Midnight SDK Change Report ===\n");

  // 1. Get version info
  console.log("Checking installed packages...");
  const versions = getVersionInfo(projectDir);

  const breaking = versions.filter((v) => v.isBreaking);
  const upToDate = versions.filter((v) => !v.isBreaking && v.current !== "not installed");

  if (breaking.length > 0) {
    console.log("\nBREAKING CHANGES DETECTED:");
    for (const pkg of breaking) {
      const changeType = parseSemver(pkg.current).major === 0 ? "MINOR (pre-1.0 = BREAKING)" : "MAJOR";
      console.log(`  ${pkg.name}: ${pkg.current} → ${pkg.latest} (${changeType})`);
      console.log(`    Layer: ${pkg.layer}`);
    }
  } else {
    console.log("\nNo breaking changes detected. All packages are up to date.");
  }

  if (upToDate.length > 0) {
    console.log("\nUP TO DATE:");
    for (const pkg of upToDate) {
      console.log(`  ${pkg.name}: ${pkg.current}`);
    }
  }

  // 2. Check artifacts
  if (checkArtifactsFlag) {
    console.log("\n--- Artifact Compatibility ---");
    const compactcPkg = versions.find((v) => v.name.includes("compactc"));
    const expectedVersion = compactcPkg?.current || "unknown";
    const artifacts = checkArtifacts(projectDir, expectedVersion);

    const staleArtifacts = artifacts.filter((a) => a.isStale);
    if (staleArtifacts.length > 0) {
      console.log("\nSTALE ARTIFACTS:");
      for (const art of staleArtifacts) {
        console.log(`  ${art.path}: built with ${art.compilerVersion}, expected ${art.expectedVersion}`);
      }
      console.log("\n  Fix: rm -rf contracts/managed/ && compactc contracts/*.compact contracts/managed/");
    } else if (artifacts.length > 0) {
      console.log(`\nAll ${artifacts.length} artifacts are current.`);
    }
  }

  // 3. Full audit
  if (fullAudit) {
    console.log("\n--- Import Path Scan ---");
    const imports = scanImports(projectDir);
    if (imports.length > 0) {
      const uniquePaths = [...new Set(imports.map((i) => i.importPath))];
      console.log(`\nFound ${imports.length} imports of ${uniquePaths.length} unique Midnight packages:`);
      for (const path of uniquePaths) {
        const count = imports.filter((i) => i.importPath === path).length;
        console.log(`  ${path} (${count} imports)`);
      }
    } else {
      console.log("  No Midnight imports found in src/.");
    }
  }

  // 4. Action summary
  if (breaking.length > 0) {
    console.log("\nACTION REQUIRED:");
    const hasCompilerChange = breaking.some((v) => v.layer === "compiler");
    const hasRuntimeChange = breaking.some((v) => v.layer === "runtime" || v.layer === "provider");

    if (hasCompilerChange) {
      console.log("  1. Recompile all .compact contracts with the new compactc");
      console.log("  2. Review compile errors — new compiler may tighten type checking");
    }
    if (hasRuntimeChange) {
      console.log(`  ${hasCompilerChange ? "3" : "1"}. Update provider construction code`);
      console.log(`  ${hasCompilerChange ? "4" : "2"}. Regenerate TypeScript bindings`);
      console.log(`  ${hasCompilerChange ? "5" : "3"}. Run full test suite`);
    }
    process.exit(1);
  }
}

main();
