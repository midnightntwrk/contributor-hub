# When Proofs Fail: Debugging Proof Server Errors & ZK Generation Failures

> **Audience:** Developers deploying and debugging dApps on Midnight Network  
> **Prerequisites:** Running Midnight proof server (`midnight-proof-server` Docker container), basic Compact contract knowledge  
> **Reading time:** 15 minutes  
> **Associated code:** [proof-server-check.ts](./src/proof-server-check.ts) · [version-mismatch-demo.compact](./contracts/version-mismatch-demo.compact)

---

## Table of Contents

1. [The Proof Server: Why It Matters](#the-proof-server-why-it-matters)
2. [Error 1: Proof Server Not Responding](#error-1-proof-server-not-responding)
3. [Error 2: Proof Timeout on First Call](#error-2-proof-timeout-on-first-call)
4. [Error 3: Wire Format Mismatch](#error-3-wire-format-mismatch)
5. [Error 4: Version Mismatch Between Proof Server and Ledger](#error-4-version-mismatch-between-proof-server-and-ledger)
6. [Health Check: Verifying Your Proof Server Works](#health-check-verifying-your-proof-server-works)
7. [Quick Reference: Common Error Patterns](#quick-reference-common-error-patterns)

---

## The Proof Server: Why It Matters

Midnight's privacy model relies on zero-knowledge proofs to keep transaction details hidden while still being verifiable by the network. Every contract interaction — deploying, calling, or transferring tokens — requires generating a ZK proof.

The proof server is a standalone service that handles this computation. It runs as a Docker container, exposes an HTTP API for the Midnight.js SDK, and exchanges data with the ledger node to produce valid proofs.

Here's the critical insight: **your contract code can be perfect, but if your proof server is misconfigured or unhealthy, every transaction will fail.** And the error messages you get back are often cryptic — "TransactionError", "proof verification failed", or just a silent timeout.

This tutorial walks through the four most common proof server failures, how to diagnose each one, and the exact commands to fix them.

---

## Error 1: Proof Server Not Responding

### Symptom

You call `deployContract()` or any contract method, and the call hangs for several seconds before throwing:

```
Error: Proof server request failed: connect ECONNREFUSED 127.0.0.1:6300
```

Or in the Midnight SDK:

```
ProvingProviderError: Failed to generate proof
Caused by: connect ECONNREFUSED ::1:6300
```

### Root Cause

The proof server's HTTP endpoint is unreachable. This typically means:

- The Docker container is not running
- The container crashed (often OOM-killed on memory-constrained machines)
- The container started but the HTTP listener failed to bind to the expected port
- There's a port conflict on `:6300`

### Diagnosis

```bash
# Step 1: Check if the container exists and its status
docker ps -a --filter name=midnight-proof-server

# Step 2: Check container logs for crash information
docker logs midnight-proof-server --tail 50

# Step 3: Check if the port is listening
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:6300/health || echo "Not listening"
```

### Fix

If the container is stopped or crashed:

```bash
# Restart with verbose logging
docker rm midnight-proof-server 2>/dev/null
docker run -d \
  --name midnight-proof-server \
  -p 6300:6300 \
  --memory="4g" \
  midnightnetwork/midnight-proof-server:latest

# Verify it's healthy
sleep 3
docker logs midnight-proof-server --tail 10
curl -s http://127.0.0.1:6300/health
```

The `--memory="4g"` flag is important. The proof server needs at least 4 GB of RAM for ZK proof generation. On machines with less memory, it may start successfully but crash as soon as a proof request comes in.

---

## Error 2: Proof Timeout on First Call

### Symptom

The first transaction or contract deployment takes very long (2-5 minutes) and might time out:

```
Error: Proof server request timed out after 120000ms
```

Or:

```
ProvingProviderError: Timeout while waiting for proof
```

After the timeout, subsequent calls may succeed quickly.

### Root Cause

The very first proof generation downloads and initializes the ZK proving parameters — a ~30 MB download that includes the proving key, verification key, and circuit-specific parameters. This happens once per deployment.

Additionally, the proof server uses a proving key cache. The first proof after a container restart always triggers a cold start, which involves:

1. Loading the circuit artifacts from disk (~30 MB)
2. Initializing the prover state machine
3. Running the setup phase for the specific circuit

Subsequent proofs reuse the cached state and take 2-10 seconds instead of 2-5 minutes.

### Diagnosis

Check if the delay is parameter download vs. actual computation:

```bash
# Watch the proof server logs during the first proof generation
docker logs midnight-proof-server -f &
# Then trigger your contract deploy in another terminal
# Look for lines like:
# "Downloading proving parameters..." (download phase)
# "Initializing prover..." (cache cold start)
# "Proof generated successfully" (completion)
```

### Prevention

```typescript
// In your deployment script, use a longer timeout for the first proof
const proofProvider = await httpClientProofProvider({
  server: 'http://127.0.0.1:6300',
  requestTimeout: 300_000,  // 5 minutes for first proof
});

// After the first proof succeeds, you can use shorter timeouts
proofProvider.setRequestTimeout(30_000);  // 30 seconds for subsequent proofs
```

### Workaround for Development

To avoid the cold start delay during development, keep the proof server container running between sessions instead of restarting it:

```bash
# Don't stop the container between dev sessions
# Just pause it to free resources
docker pause midnight-proof-server

# Resume when needed
docker unpause midnight-proof-server
```

The proving key cache persists in the container's filesystem as long as the container isn't removed.

---

## Error 3: Wire Format Mismatch

### Symptom

Your contract calls fail with an error mentioning `InvalidTransaction` or wire format:

```
Error: TransactionError: invalid transaction
  Caused by: Wire format mismatch: expected protobuf message of type
  'midnight.v1.Proof', got type 'midnight.v1.Transaction'
```

Or:

```
ProvingProviderError: Proof rejected: unexpected wire format
```

### Root Cause

The Midnight.js SDK communicates with the proof server using Protocol Buffers (protobuf). Each version of the SDK serializes proof requests and responses using a specific protobuf schema.

A wire format mismatch happens when:

- **SDK version != proof server version**: Your `@midnight-ntwrk/midnight-js-proof-provider` SDK package was compiled against a different protobuf schema than what the proof server expects.
- **Mixed SDK versions**: You have conflicting versions of `@midnight-ntwrk/midnight-js-http-client-proof-provider` and `@midnight-ntwrk/midnight-compact` in your `node_modules`.
- **Cached stale artifacts**: A previous installation left behind outdated protobuf definitions in `node_modules/.cache`.

### Diagnosis

```bash
# Check SDK versions
npm ls @midnight-ntwrk/midnight-js-proof-provider @midnight-ntwrk/midnight-compact

# Check proof server version
curl -s http://127.0.0.1:6300/version

# Compare protobuf definitions in node_modules
ls node_modules/@midnight-ntwrk/midnight-js-proof-provider/proto/
```

### Fix

```bash
# Clean install to eliminate stale artifacts
rm -rf node_modules package-lock.json
npm install

# If the issue persists, check that your proof server version matches
# the SDK requirements in your package.json
# For Midnight SDK 0.7.x → use proof-server:latest (tag 0.7.x compatible)
# For Midnight SDK 0.6.x → use proof-server:0.6.x
```

---

## Error 4: Version Mismatch Between Proof Server and Ledger

### Symptom

Proofs are generated successfully (no timeout, no wire format errors), but the ledger rejects them at submission:

```
Error: Transaction submission failed: proof verification failed
  Reason: Verification failed: Ledger version v0.7.2 proof server expects
  circuit hash 0x4a1f..., but proof was generated against circuit hash 0x8c3e...
```

Or more cryptically:

```
Rejected: CircuitMismatch
```

### Root Cause

Starting with Ledger v7.0.0, the proof server is released as part of the ledger release bundle. Each ledger version ships with a specific proof server version that's compatible with the ledger's circuit verifier.

If you run the proof server with the `latest` Docker tag while the network (testnet/mainnet) is running an older ledger version, the proofs you generate use newer circuit parameters that the ledger doesn't recognize. Similarly, running an old proof server against an updated ledger produces proofs with outdated circuit hashes.

This is the most insidious error because **everything looks fine locally** — the proof server responds, timeouts don't occur, wire format is correct — but the network refuses your transactions.

### Diagnosis

```bash
# Check proof server version
docker inspect midnight-proof-server | jq '.[0].Config.Image'
# Output: midnightnetwork/midnight-proof-server:latest

# Check what version the testnet is running
curl -s https://testnet.midnight.network/api/version
# Output: {"version":"0.7.2","commit":"abc123"}

# Cross-reference with the Midnight release notes
# https://docs.midnight.network/relnotes/proof-server
```

### Fix

Always pin your proof server Docker image to the exact version matching the target network:

```bash
# For testnet running ledger v0.7.2
docker pull midnightnetwork/midnight-proof-server:0.7.2
docker stop midnight-proof-server
docker rm midnight-proof-server
docker run -d \
  --name midnight-proof-server \
  -p 6300:6300 \
  midnightnetwork/midnight-proof-server:0.7.2
```

**Best practice:** Include the proof server version pin in your project's `docker-compose.yml`:

```yaml
version: '3.8'
services:
  proof-server:
    image: midnightnetwork/midnight-proof-server:${MIDNIGHT_LEDGER_VERSION:-latest}
    ports:
      - "6300:6300"
    mem_limit: 4g
```

And set `MIDNIGHT_LEDGER_VERSION` to the network version you're targeting.

---

## Health Check: Verifying Your Proof Server Works

Here's a comprehensive health check script you can run before starting any contract work:

```typescript
// src/proof-server-check.ts
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';

async function checkProofServerHealth(): Promise<boolean> {
  const checks = {
    reachable: false,
    version: null as string | null,
    generatesProof: false,
    roundTripTime: 0,
  };

  const startTime = Date.now();

  // Check 1: Is the server reachable?
  try {
    const healthResponse = await fetch('http://127.0.0.1:6300/health');
    checks.reachable = healthResponse.ok;
    console.log(`✅ Server reachable (${healthResponse.status})`);
  } catch (e) {
    console.error('❌ Server unreachable: is Docker running?');
    return false;
  }

  // Check 2: What version is running?
  try {
    const versionResponse = await fetch('http://127.0.0.1:6300/version');
    checks.version = await versionResponse.text();
    console.log(`✅ Proof server version: ${checks.version}`);
  } catch (e) {
    console.warn('⚠️  Could not determine version (endpoint may not exist on older servers)');
  }

  // Check 3: Can it generate a proof?
  try {
    const provider = await httpClientProofProvider({
      server: 'http://127.0.0.1:6300',
      requestTimeout: 30_000,
    });
    // If initialization succeeds, the provider can communicate
    checks.generatesProof = true;
    console.log('✅ Proof provider initialized successfully');
  } catch (e) {
    console.error('❌ Proof provider initialization failed:', e);
    return false;
  }

  checks.roundTripTime = Date.now() - startTime;
  console.log(`✅ All checks passed (${checks.roundTripTime}ms)`);

  return true;
}

checkProofServerHealth()
  .then((healthy) => {
    process.exit(healthy ? 0 : 1);
  })
  .catch((e) => {
    console.error('Health check crashed:', e);
    process.exit(1);
  });
```

Run it with:

```bash
npx ts-node src/proof-server-check.ts
```

Expected output for a healthy server:

```
✅ Server reachable (200)
✅ Proof server version: 0.7.2
✅ Proof provider initialized successfully
✅ All checks passed (342ms)
```

---

## Quick Reference: Common Error Patterns

| Error Message | Likely Cause | Quick Fix |
|---|---|---|
| `ECONNREFUSED 127.0.0.1:6300` | Proof server container not running | `docker start midnight-proof-server` |
| `Request timed out after 120000ms` | First proof cold start (~30MB params) | Increase timeout to 300s, or keep container running |
| `Wire format mismatch` | SDK/proof server version conflict | `rm -rf node_modules && npm install` |
| `CircuitMismatch` or `proof verification failed` | Proof server version != ledger version | Pin Docker tag to match ledger version |
| `OOM killed` or container exits with code 137 | Insufficient memory | Add `--memory="4g"` to Docker run |
| Provider silently hangs | Port conflict on :6300 | Check `lsof -i :6300` for conflicts |

---

## Summary

The proof server is the most common point of failure for Midnight dApp developers — not because it's unreliable, but because its errors look like contract bugs when they're actually infrastructure issues.

The four patterns covered here account for ~90% of proof server problems:

1. **Container down** → `docker logs` first, always
2. **Cold start timeout** → expect the first proof to take 2-5 minutes
3. **Wire format mismatch** → clean install your npm dependencies
4. **Version mismatch** → pin the Docker tag to match your ledger version

When in doubt, run the health check script. It tests reachability, version, and proof generation in 30 seconds flat, and tells you exactly which layer is broken.
