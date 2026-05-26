<!--
This file is part of contributor-hub.
Copyright (C) 2025 Midnight Foundation
SPDX-License-Identifier: Apache-2.0
Licensed under the Apache License, Version 2.0.
-->

# When Proofs Fail: Debugging Proof Server Errors and ZK Generation Failures

Midnight applications rely on zero-knowledge proofs for private transaction execution. When a DApp sends a transaction, the application does not send the private inputs to the chain. It sends a proof that the private computation was valid. The local proof server is the component that builds that proof.

That design is useful for privacy, but it changes how failures look during development. A broken proof flow might appear as a wallet error, an HTTP error, a timeout, or a transaction rejection from the node. The root cause might be Docker, a cold cache, stale contract artifacts, mismatched wire formats, or a proof server image that does not match the Ledger version used by the SDK.

This tutorial gives you a practical debugging path for the most common proof failures:

- the proof server is not responding
- the first proof times out while ZK parameters are downloaded
- the proof is rejected because the client and server disagree on wire format
- the proof server Docker tag does not match the Ledger version
- the server is running, but you still need to verify that it is healthy

The examples assume a local proof server on port `6300`, Docker, and a Midnight TypeScript application that uses the Midnight SDK.

## Start with a Known Version

Before debugging individual errors, pin your proof server version. Do not use `latest` for local development, CI, or shared examples. Midnight proof generation is version-sensitive because the proof server, Ledger package, Compact output, and verification logic must agree on circuit and proof formats.

The current Midnight compatibility matrix lists Ledger `8.0.3` and Proof server `8.0.3` as the latest tested pair at the time this tutorial was written. Always check the current matrix before copying these versions into a long-lived project:

<https://docs.midnight.network/relnotes/support-matrix>

Run the proof server with an explicit tag:

```sh
docker run --rm \
  --name midnight-proof-server \
  -p 6300:6300 \
  midnightntwrk/proof-server:8.0.3
```

If future release notes specify a different official image namespace, use that namespace consistently, but keep the tag pinned to the version that matches your Ledger dependency. The important rule is not the local container name. The important rule is that the proof server version and Ledger version match.

In a project, check your Ledger dependency:

```sh
npm ls @midnight-ntwrk/ledger
```

If your project uses the versioned package name, check that package instead:

```sh
npm ls @midnight-ntwrk/ledger-v8
```

You can also inspect `package.json` directly:

```sh
node -p "require('./package.json').dependencies"
```

If the Ledger package is `8.0.3`, use proof server `8.0.3`. If the Ledger package changes, update the proof server image tag in the same change.

## Verify That the Server Is Running

When a wallet or SDK reports a message such as `TypeError: Failed to fetch`, `ECONNREFUSED`, `connection refused`, or `proof server not responding`, first prove that the server process is reachable. Do not start by editing contract code.

Check whether the container exists:

```sh
docker ps --filter "name=midnight-proof-server"
```

If no container is listed, start it again:

```sh
docker run --rm \
  --name midnight-proof-server \
  -p 6300:6300 \
  midnightntwrk/proof-server:8.0.3
```

If the container is listed but your application still cannot connect, inspect the port mapping:

```sh
docker port midnight-proof-server
```

You should see host port `6300` mapped to container port `6300`. If the port is missing or mapped to a different host port, update either the Docker command or your application configuration.

Then check the HTTP health response:

```sh
curl -fsS http://127.0.0.1:6300/health
```

Some proof server builds expose a root health response instead. If `/health` returns `404`, test the root endpoint:

```sh
curl -fsS http://127.0.0.1:6300/
```

A healthy response is typically a small success body such as `{"status":"ok"}`. The exact JSON fields can vary by release, so treat HTTP success as the key signal.

If both requests fail, check whether the process is listening:

```sh
docker logs --tail 100 midnight-proof-server
```

The logs are the fastest way to separate Docker problems from proof problems.

## Read Docker Logs Before Changing Code

Proof server startup logs usually tell you which phase failed. Use a longer log window when the server exits quickly:

```sh
docker logs midnight-proof-server
```

Follow logs while reproducing a failed proof:

```sh
docker logs -f midnight-proof-server
```

Common Docker-level failures include:

- `bind: address already in use`: another process already uses port `6300`
- image pull errors: Docker cannot download the proof server image
- permission errors: your user cannot access the Docker daemon
- repeated restarts: the container command or environment is wrong
- network errors during startup: the server cannot fetch required ZK parameters

Fix a port conflict by stopping the old container:

```sh
docker ps --filter "publish=6300"
docker stop midnight-proof-server
```

If the container has a generated name, stop it by ID:

```sh
docker ps --filter "publish=6300"
docker stop <container-id>
```

Fix Docker daemon permission issues on Linux by adding your user to the Docker group, then opening a new shell:

```sh
sudo usermod -aG docker "$USER"
newgrp docker
```

If logs show that the proof server started and is listening on `0.0.0.0:6300`, the container is probably fine. Move on to application configuration.

## Confirm the Application Uses the Same URL

Many proof failures are simple URL mismatches. A browser app, a Node.js backend, and a Dockerized service see `localhost` differently.

For an application running directly on your host machine, use:

```txt
http://127.0.0.1:6300
```

For one Docker Compose service connecting to another service named `proof-server`, use the service DNS name:

```txt
http://proof-server:6300
```

Do not use `localhost` from inside an application container unless the proof server runs in the same container. Inside a container, `localhost` means that container itself.

A minimal Compose service looks like this:

```yaml
services:
  proof-server:
    image: midnightntwrk/proof-server:8.0.3
    ports:
      - "6300:6300"
```

After Compose starts the service, run the health check from the host or from another container that has `curl` installed:

```sh
curl -fsS http://127.0.0.1:6300/health || curl -fsS http://127.0.0.1:6300/
```

In TypeScript, configure the proof provider with the same base URL:

```ts
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';

export const proofProvider = httpClientProofProvider('http://127.0.0.1:6300');
```

When the app runs in Compose, inject the URL from the environment:

```ts
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';

const proofServerUrl = process.env.PROOF_SERVER_URL ?? 'http://127.0.0.1:6300';

export const proofProvider = httpClientProofProvider(proofServerUrl);
```

Then set:

```yaml
environment:
  PROOF_SERVER_URL: http://proof-server:6300
```

This keeps host development and container development explicit.

## Understand First-Proof Timeouts

The first proof can take much longer than later proofs. That is expected. The proof server may need to download zero-knowledge parameter material before it can generate a proof for a circuit. For common flows, this first download is roughly 30 MB. The exact amount can vary by release and circuit set.

If the first transaction times out, do not assume the proof is invalid. Check the logs:

```sh
docker logs -f midnight-proof-server
```

Look for messages that indicate missing parameters, parameter downloads, key material downloads, or data-provider fetches. If the logs are still active, wait for the download to finish and try the transaction again.

Client-side timeouts are common during this cold-start path. A DApp might give up after 30 seconds while the proof server is still downloading and preparing parameters. The next proof usually completes faster because the image layers, downloaded material, or mounted cache are already present.

For a better development experience, mount a cache directory so downloads survive container restarts:

```sh
mkdir -p .cache/midnight/zk-params

docker run --rm \
  --name midnight-proof-server \
  -p 6300:6300 \
  -v "$PWD/.cache/midnight/zk-params:/.cache/midnight/zk-params" \
  midnightntwrk/proof-server:8.0.3
```

If your release notes specify a different cache path, use that path. The principle is to keep ZK parameter material persistent across restarts.

In CI, make the first proof part of setup rather than part of a narrow user-facing timeout. If your test suite starts a fresh proof server for every run, give the first proof a longer timeout than ordinary application requests.

## Debug Proof Rejection from Wire Format Mismatch

A wire format mismatch means the client and server are not encoding or decoding proof requests in the same way. The proof server may be reachable, but the request body does not match what that proof server version expects. Symptoms include HTTP `400` responses from `/prove`, decoding errors in server logs, invalid proof responses, or node rejection after a proof appears to generate.

This usually happens after one of these changes:

- the proof server image was upgraded without upgrading Midnight SDK packages
- the SDK packages were upgraded without changing the proof server
- generated Compact artifacts are stale
- multiple generated contract artifact directories are mixed together
- a DApp uses old serialized transaction data with new Ledger code

Start with the logs from the failing request:

```sh
docker logs --tail 200 midnight-proof-server
```

If the server reports request decoding, deserialization, transcript, verifier key, or public input mismatch errors, treat the failure as a version or artifact consistency problem before treating it as a contract logic problem.

Regenerate contract artifacts from a clean directory:

```sh
rm -rf ./dist ./generated ./contract-artifacts
npm run build
```

Use the actual output paths from your project. The goal is not to delete random files. The goal is to remove stale Compact outputs before recompiling.

Then reinstall dependencies and confirm there are not multiple Ledger versions:

```sh
npm install
npm ls @midnight-ntwrk/ledger
npm ls @midnight-ntwrk/ledger-v8
```

If `npm ls` shows duplicate major versions, resolve that before continuing. A project that compiles against one Ledger format and proves against another can fail in ways that look unrelated to dependency management.

Finally, restart the proof server with the matching pinned tag:

```sh
docker stop midnight-proof-server

docker run --rm \
  --name midnight-proof-server \
  -p 6300:6300 \
  midnightntwrk/proof-server:8.0.3
```

Retry the same transaction only after the server is healthy and artifacts are fresh.

## Debug Version Mismatch Between Proof Server and Ledger

Version mismatch is the highest-value check because it can produce misleading errors. A mismatched proof server can generate a proof request failure, return a proof that the node rejects, or trigger errors that mention verification rather than versions.

Check the official matrix:

```txt
https://docs.midnight.network/relnotes/support-matrix
```

Then check that the pinned Docker tag exists:

```sh
docker manifest inspect midnightntwrk/proof-server:8.0.3 >/dev/null
```

Check the running container image:

```sh
docker inspect midnight-proof-server \
  --format '{{ .Config.Image }}'
```

Check the Ledger dependency:

```sh
npm ls @midnight-ntwrk/ledger @midnight-ntwrk/ledger-v8
```

These values should tell the same story. If the project uses Ledger `8.0.3`, the proof server should be `8.0.3`. If the project uses an older supported Ledger, use the matching proof server for that supported release. Do not assume that a newer proof server can prove for an older Ledger.

Pin the version in Compose:

```yaml
services:
  proof-server:
    image: midnightntwrk/proof-server:8.0.3
    ports:
      - "6300:6300"
```

Pin the dependency in `package.json` according to your project policy. For reproducible applications, prefer exact versions or a lockfile committed with the project:

```json
{
  "dependencies": {
    "@midnight-ntwrk/ledger-v8": "8.0.3"
  }
}
```

After changing versions, rebuild generated artifacts. Version alignment is not complete until the contract outputs, SDK packages, proof server, and runtime expectations all agree.

## A Practical Triage Checklist

Use this order when a proof fails:

1. Is Docker running?

   ```sh
   docker version
   ```

2. Is the proof server container running?

   ```sh
   docker ps --filter "name=midnight-proof-server"
   ```

3. Is port `6300` mapped?

   ```sh
   docker port midnight-proof-server
   ```

4. Does the health endpoint return success?

   ```sh
   curl -fsS http://127.0.0.1:6300/health || curl -fsS http://127.0.0.1:6300/
   ```

5. Do logs show startup, parameter download, or request errors?

   ```sh
   docker logs --tail 200 midnight-proof-server
   ```

6. Does the DApp use the correct URL for its runtime location?

   ```sh
   node -p "process.env.PROOF_SERVER_URL"
   ```

7. Does the proof server tag match the Ledger version?

   ```sh
   docker inspect midnight-proof-server --format '{{ .Config.Image }}'
   npm ls @midnight-ntwrk/ledger @midnight-ntwrk/ledger-v8
   ```

8. Are generated artifacts fresh?

   ```sh
   npm run build
   ```

If the failure survives all eight checks, collect the proof server logs, SDK versions, Docker image tag, Ledger version, Compact compiler version, network name, and the smallest reproducible transaction. That information is what maintainers need on the Midnight developer forum or Discord.

## Summary

Most proof failures are not mysterious once you identify which boundary failed. Connection errors point to Docker, port mapping, or URL configuration. First-proof timeouts often mean the server is downloading about 30 MB of ZK parameters and needs a longer initial timeout or a persistent cache. HTTP `400` and decoding-style errors usually point to wire format or artifact mismatches. Node-level proof rejection often points to stale artifacts, invalid transaction construction, or a proof server tag that does not match the Ledger version.

Start every investigation with health checks and `docker logs`. Then verify version alignment against the official compatibility matrix. Only after the server is reachable, healthy, warm, and version-matched should you spend time debugging contract logic.

## Resources

- Midnight documentation: <https://docs.midnight.network/getting-started>
- Compatibility matrix: <https://docs.midnight.network/relnotes/support-matrix>
- Proof Server release notes: <https://docs.midnight.network/relnotes/proof-server>
- Midnight MCP: <https://www.npmjs.com/package/midnight-mcp>
- Developer forum: <https://forum.midnight.network/>
- Discord: <https://discord.com/invite/midnightnetwork>
