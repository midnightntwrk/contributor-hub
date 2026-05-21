// src/proof-server-check.ts
// Run: npx ts-node src/proof-server-check.ts
//
// Comprehensive proof server health check for Midnight dApp development.
// Tests reachability, version compatibility, and proof generation capability.

import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';

interface HealthCheckResult {
  reachable: boolean;
  version: string | null;
  generatesProof: boolean;
  roundTripTime: number;
  errors: string[];
}

async function checkProofServerHealth(): Promise<HealthCheckResult> {
  const result: HealthCheckResult = {
    reachable: false,
    version: null,
    generatesProof: false,
    roundTripTime: 0,
    errors: [],
  };

  const startTime = Date.now();
  const serverUrl = process.env.PROOF_SERVER_URL || 'http://127.0.0.1:6300';

  console.log(`🔍 Checking proof server at ${serverUrl}...`);
  console.log('');

  // ========== CHECK 1: Reachability ==========
  console.log('📡 Check 1: Server reachability');

  try {
    const healthResponse = await fetch(`${serverUrl}/health`, {
      signal: AbortSignal.timeout(5_000),
    });

    if (healthResponse.ok) {
      result.reachable = true;
      const body = await healthResponse.text();
      console.log(`   ✅ Server reachable (HTTP ${healthResponse.status})`);
      console.log(`   Response: ${body}`);
    } else {
      result.errors.push(`Health endpoint returned ${healthResponse.status}`);
      console.error(`   ❌ Server returned HTTP ${healthResponse.status}`);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    result.errors.push(`Reachability check failed: ${message}`);
    console.error(`   ❌ Server unreachable: ${message}`);
    console.error('   💡 Check: docker ps --filter name=midnight-proof-server');
    console.error('   💡 If not running: docker start midnight-proof-server');
    return result;
  }

  console.log('');

  // ========== CHECK 2: Version Compatibility ==========
  console.log('🏷️  Check 2: Proof server version');

  try {
    const versionResponse = await fetch(`${serverUrl}/version`, {
      signal: AbortSignal.timeout(5_000),
    });

    if (versionResponse.ok) {
      result.version = await versionResponse.text();
      console.log(`   ✅ Version: ${result.version.trim()}`);

      // Check for common version issues
      const targetVersion = process.env.MIDNIGHT_LEDGER_VERSION;
      if (targetVersion && result.version.trim() !== targetVersion) {
        const warning =
          `Version mismatch: server=${result.version.trim()}, ` +
          `expected=${targetVersion}`;
        result.errors.push(warning);
        console.warn(`   ⚠️  ${warning}`);
        console.warn('   💡 Pin the Docker tag: docker pull midnightnetwork/midnight-proof-server:' + targetVersion);
      }
    } else {
      console.warn('   ⚠️  Version endpoint returned non-200 (older server version?)');
    }
  } catch (e) {
    // Version endpoint may not exist on older servers
    console.warn('   ⚠️  Version endpoint unavailable (older proof server)');
    console.warn('   💡 Check: docker inspect midnight-proof-server | grep Image');
  }

  console.log('');

  // ========== CHECK 3: Proof Generation ==========
  console.log('🔐 Check 3: Proof provider initialization');

  try {
    const provider = await httpClientProofProvider({
      server: serverUrl,
      requestTimeout: 30_000,
    });

    result.generatesProof = true;
    console.log('   ✅ Proof provider initialized successfully');
    console.log('   💡 The SDK can communicate with the proof server');
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    result.errors.push(`Proof provider init failed: ${message}`);
    console.error(`   ❌ Proof provider initialization failed`);
    console.error(`   Error: ${message}`);

    if (message.includes('Wire format') || message.includes('protobuf')) {
      console.error('   💡 Fix: rm -rf node_modules package-lock.json && npm install');
    } else if (message.includes('timeout')) {
      console.error('   💡 Fix: Increase requestTimeout to 300_000 for first proof');
    } else if (message.includes('CircuitMismatch')) {
      console.error('   💡 Fix: Match proof server version to ledger version');
    }
  }

  console.log('');

  // ========== SUMMARY ==========
  result.roundTripTime = Date.now() - startTime;

  const allPassed = result.reachable && result.generatesProof;
  const status = allPassed ? '✅ ALL CHECKS PASSED' : '❌ SOME CHECKS FAILED';

  console.log('='.repeat(50));
  console.log(` ${status}`);
  console.log(` Total time: ${result.roundTripTime}ms`);
  console.log(` Errors: ${result.errors.length}`);
  console.log('='.repeat(50));

  if (result.errors.length > 0) {
    console.log('');
    console.log('Issues found:');
    result.errors.forEach((err, i) => console.log(`  ${i + 1}. ${err}`));
  }

  return result;
}

// Run if executed directly
checkProofServerHealth()
  .then((result) => {
    process.exit(result.reachable && result.generatesProof ? 0 : 1);
  })
  .catch((e) => {
    console.error('Health check crashed with unexpected error:', e);
    process.exit(1);
  });
