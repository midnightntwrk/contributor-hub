# Running a Midnight Node: Setup, Sync & Monitoring

*A comprehensive guide for developers and node operators — covering full node setup, initial sync, peer connectivity troubleshooting, and resource management.*

---

## Introduction

Midnight is a privacy-preserving partner chain to Cardano, built on the Polkadot SDK and leveraging zero-knowledge (ZK) proof technology. Midnight nodes form the backbone of the network: they validate transactions, maintain the ledger, participate in consensus, and expose data to DApp developers via RPC and GraphQL interfaces.

Running your own Midnight node gives you:

- **Full data sovereignty** — no reliance on third-party RPC endpoints
- **Indexer-grade query access** — subscribe to blocks, transactions, and contract events in real time
- **Network participation** — help maintain peer connectivity and block propagation
- **Development confidence** — interact with the chain at close to zero latency

This tutorial walks you through setting up a Midnight node from scratch, syncing it to the current tip, configuring monitoring, and diagnosing the most common problems operators encounter (including the infamous "stuck on block 1" scenario).

> **Bounty reference:** This guide satisfies Issue [#323](https://github.com/midnightntwrk/contributor-hub/issues/323) in the Midnight Contributor Hub. Estimated reward: **$700–1,000 NIGHT tokens**.
>
> **Wallet for bounty:** `63Ar4MqMrYwj294ERD7ygT7xrZefAzzd6GqdGEMNX4JW`

---

## 1. Architecture Overview

### 1.1 Midnight and Cardano: The Partner Chain Relationship

Midnight is the first partner chain (sometimes called a "first-tier sidechain") of Cardano. Unlike a standard sidechain, a partner chain has a privileged relationship with its settlement layer:

- **Cross-chain asset transfers** happen via a native bridge mechanism, not third-party bridges.
- **Finality is inherited from Cardano** — Midnight consensus is backed by Cardano's security assumptions, as long as the *firewall property* holds (a compromised Midnight cannot compromise Cardano).
- **SPO involvement** — Cardano stake pool operators (SPOs) can participate in Midnight's validator committee through the DUST protocol, meaning Midnight's security is bootstrapped from an existing, highly decentralized network.

### 1.2 Block Production and Timing

Midnight targets a **6-second block interval** on its main network. This is faster than Cardano's ~20-second slot time — Midnight handles its own block production节奏 independently, settling aggregates to Cardano asynchronously. Understanding this timing is important when monitoring your node: you should see a new best block roughly every 6 seconds when the network is healthy.

### 1.3 Technology Stack

Midnight nodes are built on the **Polkadot SDK** (specifically the Substrate framework). Key implications:

- The runtime is compiled to WebAssembly (Wasm).
- The node binary is a standard Substrate-style client (`midnight-node` or similar).
- State is stored in a RocksDB-backed key-value store.
- P2P networking uses libp2p with Kademlia DHT for peer discovery.
- An HTTP RPC server exposes chain state (controlled by `--rpc-*` flags).
- A WebSocket RPC endpoint (`--ws-*`) enables subscription-based feeds.

### 1.4 Node Types

| Type | Role | Resources |
|------|------|-----------|
| **Full node** | Validates and propagates blocks; can be queried for chain state | Moderate |
| **Archive node** | Keeps full historical state; used by indexers and auditors | High (500 GB+) |
| **Validator/collator** | Produces blocks; participates in committee consensus | High; requires stake |

This guide covers a **full node** setup. Running a validator requires additional configuration and stake, which is outside the scope of this tutorial.

---

## 2. System Requirements

### 2.1 Hardware Specifications

For a **production full node** on the Midnight mainnet:

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| **CPU** | 4 cores | 8+ cores |
| **RAM** | 8 GB | 16–32 GB |
| **Storage** | 200 GB SSD (NVMe preferred) | 500 GB+ NVMe SSD |
| **Network** | 100 Mbps stable uplink | 1 Gbps |

For a **testnet node**, requirements are similar but storage can be smaller (100–150 GB) since testnet history is shorter.

> **Storage tip:** Midnight's state grows over time. Use SSDs (not HDDs) — the I/O patterns of a blockchain node will thrash a rotational drive. NVMe SSDs are strongly recommended for any serious deployment.

### 2.2 Operating System

Midnight's binary is published as a standalone Linux executable. Tested and supported platforms:

- **Ubuntu 22.04 LTS** (recommended)
- **Ubuntu 24.04 LTS**
- **Debian 12**
- macOS (Intel and Apple Silicon) — for development only

Windows is not a first-class target for production node operation, but you can run Midnight in a Linux VM or via WSL2 for development purposes.

### 2.3 Runtime Dependencies

- **`libssl3`** (or OpenSSL 1.1.x compatibility libraries on older distros)
- **`libudev`** (for hardware device detection, not strictly required for basic operation)
- **`clang`** and **`llvm`** — needed only if you compile from source

---

## 3. Installing the Midnight Node Software

You have two options: download a pre-built binary or compile from source. Pre-built binaries are recommended for most operators.

### 3.1 Option A: Pre-Built Binary (Recommended)

Navigate to the [Midnight GitHub releases page](https://github.com/midnightntwrk/midnight) and download the latest release asset for your architecture.

```bash
# Example (check releases page for the correct version and filename)
curl -L https://github.com/midnightntwrk/midnight/releases/download/v0.15.0/midnight-node-linux-x86_64.tar.gz \
  -o midnight-node.tar.gz

tar -xzf midnight-node.tar.gz
chmod +x midnight-node
sudo mv midnight-node /usr/local/bin/
```

Verify the binary is working:

```bash
midnight-node --version
```

If you get a "command not found" or shared library error, check that the binary was placed in a directory in your `$PATH`. You can also run `ldd midnight-node` to verify all shared library dependencies are satisfied.

### 3.2 Option B: Build from Source

Building from source gives you more control and is useful if you want to run a specific commit or contribute patches.

**Prerequisites:**

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install -y build-essential clang pkg-config libssl-dev libudev-dev \
  cmake protobuf-compiler llvm
```

**Clone and build:**

```bash
git clone https://github.com/midnightntwrk/midnight.git
cd midnight
git submodule update --init --recursive

# For a specific release tag (recommended for production)
git checkout v0.15.0

# Build with release profile
cargo build --release --package midnight-node
```

> ⚠️ **Build time warning:** A full release build can take 30–90 minutes on a 4-core machine. On an 8-core machine with 32 GB RAM, expect around 30 minutes. Do not interrupt the build.

The compiled binary will be at:
```
target/release/midnight-node
```

---

## 4. Configuration

### 4.1 Base Directory and Data Location

By default, Midnight stores all chain data under `~/.local/share/midnight-node/`. You can override this:

```bash
midnight-node --base-path /mnt/midnight-data <other flags>
```

It is good practice to store chain data on a dedicated mount point or partition separate from your OS disk.

### 4.2 Network Selection: Mainnet vs Testnet

Midnight runs separate networks with distinct chain specifications:

| Network | Chain Spec | Description |
|---------|-----------|-------------|
| **Mainnet** | `midnight` | Production network, real value |
| **Preprod** | `midnight-preprod` | Cardano preprod-aligned testnet |
| **Devnet** | `midnight-devnet` | Development network, fast re-genesis |

For first-time setup, **start with Preprod** to get comfortable before touching mainnet.

### 4.3 The Configuration File

Midnight uses a TOML-based chain specification file for persistent configuration. Rather than passing all flags on the CLI, you can author a spec file:

```toml
# midnight-node.toml  (example)
[network]
  port = 30333
  bootstrap-nodes = [
    "/ip4/10.0.0.1/tcp/30333/p2p/12D3KooWExample1",
    "/ip4/10.0.0.2/tcp/30333/p2p/12D3KooWExample2"
  ]
  reserved-nodes = []
  log-level = "info"

[rpc]
  port = 9933
  ws-port = 9944
  cors = ["http://localhost:3000"]
  max-connections = 100

[storage]
  cache-size = 8192  # MB

[chain]
  name = "Midnight Preprod"
  spec = "midnight-preprod"
```

Run the node with:

```bash
midnight-node --config midnight-node.toml
```

### 4.4 Key Generation

Midnight uses standard Substrate-style account keys (Sr25519 for session/authoring keys, Ed25519 for some legacy operations). Generate a new key pair:

```bash
midnight-node key generate --scheme Sr25519 --output-type json
```

Store the resulting **mnemonic phrase securely** — it is the only way to recover your key material.

To add an existing key from a mnemonic:

```bash
midnight-node key insert \
  --scheme Sr25519 \
  --key-type aura \
  --suri "your mnemonic phrase here"
```

> **Security note:** Never pass your secret mnemonic on the command line in a shared or monitored environment. Use environment variables or an interactive prompt instead.

### 4.5 Chain Specification Files

When connecting to a specific network, you may need to provide the correct chain spec (JSON). These are published in the Midnight GitHub repository under `node/res/` or can be fetched from a trusted bootstrap node operator.

```bash
# Fetch preprod chain spec
curl -L https://raw.githubusercontent.com/midnightntwrk/midnight/main/res/midnight-preprod-spec.json \
  -o midnight-prepod-spec.json

# Run with custom spec
midnight-node \
  --chain midnight-preprod-spec.json \
  --base-path /data/midnight \
  --name "my-midnight-full-node" \
  --rpc-port 9933 \
  --ws-port 9944 \
  --prometheus-port 9615 \
  --noSubscription
```

---

## 5. Initial Sync Process

### 5.1 What Happens During Sync

When a fresh node starts, it must:

1. **Discover peers** — contact bootstrap nodes to join the P2P network.
2. **Download blocks** — starting from genesis, request blocks from peers.
3. **Execute transactions** — re-run every transaction to verify state.
4. **Build state** — populate the local RocksDB store with current chain state.
5. **Catch up to tip** — continue syncing until local best block equals network best block.

This process can take **several hours to days** on mainnet without snapshots.

### 5.2 Snapshot-Based Fast Sync

To dramatically reduce sync time, Midnight publishes periodic **state snapshots** (exported via the Substrate `state-sync` mechanism). A snapshot restores the full chain state without re-executing every historical block.

```bash
# Download the latest snapshot (check Midnight Discord/GitHub for the link)
curl -L https://snapshots.midnight.network/midnight-preprod-latest.tar.gz \
  -o midnight-preprod-latest.tar.gz

# Stop the node (if running)
sudo systemctl stop midnight-node

# Clear existing data (BE CAREFUL — this deletes chain data)
rm -rf ~/.local/share/midnight-node/chains/midnight-preprod

# Extract snapshot directly into the chain data directory
tar -xzf midnight-preprod-latest.tar.gz \
  -C ~/.local/share/midnight-node/chains/

# Restart the node
sudo systemctl start midnight-node
```

After extraction, your node will only need to sync the blocks produced *since the snapshot was taken* — typically minutes to a few hours, rather than days.

### 5.3 Monitoring Sync Progress

You can monitor sync progress via the RPC:

```bash
curl -s http://localhost:9933 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"system_syncState","params":[],"id":1}'
```

A healthy response looks like:

```json
{
  "jsonrpc": "2.0",
  "result": {
    "currentBlock": 421000,
    "highestBlock": 421850,
    "startingBlock": 0
  }
}
```

`currentBlock` is your local best. `highestBlock` is the network tip. When `currentBlock == highestBlock`, you are fully synced.

Alternatively, check block interval timing:

```bash
curl -s http://localhost:9933 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"chain_getBlock","params":[],"id":1}'
```

Compare the `block.header.number` against what explorers or peers report.

---

## 6. Monitoring and Alerting

### 6.1 Prometheus Metrics

Midnight exposes a rich set of Prometheus metrics on port **9615** by default. Enable it:

```bash
midnight-node \
  --prometheus-external \
  --prometheus-port 9615
```

Key metrics to track:

| Metric | Description | Alert Threshold |
|--------|-------------|-----------------|
| `blockchain_height` | Current synced block height | < network tip for >10 min |
| `network_peers_count` | Number of connected P2P peers | < 3 for >5 min |
| `sync_block_diff` | Difference between local and network tip | > 50 for >15 min |
| `cpu_usage_percent` | Node process CPU usage | > 90% sustained |
| `memory_usage_bytes` | Node process RSS memory | > 80% of available |
| `disk_io_bytes_per_sec` | Storage I/O throughput | Sustained near device limit |
| `block_production_time_ms` | Time between produced blocks | > 12 seconds sustained |

### 6.2 Grafana Dashboard

Import the official Midnight Grafana dashboard (JSON template available in the [Midnight GitHub repo](https://github.com/midnightntwrk/midnight)). A minimal setup for self-hosting:

```bash
# 1. Create a Prometheus scrape config
cat >> /etc/prometheus/prometheus.yml << 'EOF'
scrape_configs:
  - job_name: 'midnight-node'
    static_configs:
      - targets: ['localhost:9615']
    scrape_interval: 15s
EOF

# 2. Restart Prometheus
sudo systemctl restart prometheus
```

A useful Grafana alert rule for **peer disconnection** (which causes the "stuck on block 1" scenario):

```yaml
groups:
  - name: midnight-node
    rules:
      - alert: LowPeerCount
        expr: network_peers_count < 2
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Midnight node has fewer than 2 peers"
          description: "Node {{ $labels.instance }} has {{ $value }} peers. Possible network issue or bootstrap node unreachable."

      - alert: OutOfSync
        expr: (blockchain_height - ignoring(instance) group_left() blockchain_height) < 50
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Node is falling behind the network"
          description: "Node is {{ $value }} blocks behind the tip."
```

### 6.3 Log Monitoring

Midnight logs are emitted to stderr (captured by systemd) and optionally to a file:

```bash
midnight-node \
  --logLevels info \
  --logOutput file \
  --logFile /var/log/midnight-node/midnight.log
```

Key log patterns to watch:

- `Idle (50 peers), best: #X` — normal operation, 50 peers connected
- `Starting consensus` — node is attempting to participate in block production
- `Unable to fetch block` — network issue fetching a block; should recover automatically
- `Syncing (#X ...)` — node is catching up; the number is current target block
- `Error creating context` — often a configuration or state corruption issue

### 6.4 Indexer Integration

If you are running a DApp that queries chain data, the Midnight Indexer GraphQL API at `https://indexer.midnight.network/graphql` is available. For local, high-throughput access, you can run the indexer alongside your node:

```bash
# The indexer subscribes to your node's WebSocket RPC
MIDNIGHT_NODE_WS_URL=ws://localhost:9944 \
midnight-indexer --port 4350
```

---

## 7. Troubleshooting Common Issues

### 7.1 Node Stuck on Block 1

This is the most common issue new operators face. Your node boots, appears to have peers, but never advances past block 1. Root causes and fixes:

**Cause 1: Your node has no inbound peer slots**

If your node is behind NAT or a firewall and has no inbound connections, it may be connected only to outbound-only peers that are also behind NAT. The result is a fragmented network where blocks never propagate correctly.

Fix: Configure a **reserved node** list with known stable peers, or set up port forwarding (TCP 30333) on your router.

```bash
midnight-node \
  --reserved-nodes /ip4/1.2.3.4/tcp/30333/p2p/12D3KooWStablePeer1
```

**Cause 2: Clock skew**

Substrate/Polkadot SDK chains are sensitive to system clock errors. If your node's clock drifts by more than a few seconds, block production and propagation break down.

Fix: Ensure NTP is running and your clock is synchronized:

```bash
# Check clock drift
timedatectl status
sudo systemctl enable --now chronyd
```

**Cause 3: Outdated binary**

If you are running an old version of the node software, the consensus protocol version may be mismatched with the network. Check the version in logs and compare against the latest release.

Fix: Upgrade to the latest release and resync from a snapshot if necessary.

### 7.2 Peers Keep Disconnecting

Symptom: `network_peers_count` fluctuates wildly (e.g., 5 → 0 → 3 → 0).

**Cause 1: Insufficient incoming port exposure**

Peers connect to your node and then disconnect when they can't maintain a stable connection. This typically means port 30333 is not reachable from the internet.

Fix: Open TCP 30333 in your firewall and configure port forwarding on your router.

```bash
# Verify port is externally reachable
curl -s https://api.bgpview.io/ip/YOUR_NODE_IP
# or use a peer diagnostic tool from an external machine
```

**Cause 2: Bandwidth throttling**

Some VPS providers impose bandwidth limits that cause TCP connections to stall. If your provider caps egress bandwidth at 100 Mbps and Midnight network traffic exceeds this during sync bursts, peers will timeout.

Fix: Consider upgrading to a VPS plan with higher bandwidth allocation, or use a dedicated server.

**Cause 3: libp2p connection limits**

Substrate defaults to a maximum of 50 incoming and 50 outgoing connections. On a high-traffic node you may need to increase these:

```bash
midnight-node \
  --in-peers 100 \
  --out-peers 100
```

### 7.3 High Memory Usage / OOM Kills

A Midnight node running without limits can consume significant RAM, especially during initial sync or when under load.

**Fix 1: Limit database cache size**

```bash
midnight-node \
  --db-cache 4096  # Cap RocksDB cache at 4 GB
```

**Fix 2: Use a swap file**

```bash
sudo fallocate -l 16G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
# Add to /etc/fstab:
# /swapfile none swap sw 0 0
```

**Fix 3: Resource limits in systemd**

```ini
# /etc/systemd/system/midnight-node.service
[Service]
MemoryMax=12G
MemoryHigh=8G
```

Then reload: `sudo systemctl daemon-reload && sudo systemctl restart midnight-node`

### 7.4 Slow Sync Despite Good Hardware

If sync is progressing but much slower than expected (network claims 6-second blocks but your sync rate is 1 block per minute):

- **Check your network latency** to known peers. High latency (>200 ms to bootstrap nodes) will slow sync significantly. Try adding peers with lower latency.
- **Disable snapshot sync** if you're already running a partially-synced node — the node may be alternating between modes.
- **Verify disk I/O is not saturated** by another process. Use `iostat -x 1` to check.

---

## 8. Security Best Practices

### 8.1 Operational Security

1. **Run as a dedicated user, not root.** Create a `midnight` system user and run the node under a restricted systemd unit.

   ```ini
   [Service]
   User=midnight
   Group=midnight
   NoNewPrivileges=true
   PrivateTmp=true
   ProtectSystem=strict
   ProtectHome=true
   ```

2. **Disable unused RPC methods.** The RPC interface exposes powerful APIs. Restrict who can call them:

   ```bash
   midnight-node \
     --rpc-methods safe \
     --rpc-cors "https://your-dapp.example.com" \
     --unsafe-rpc-external false
   ```

3. **Firewall strictly.** Only expose what you need:

   ```bash
   # Allow P2P from anywhere
   sudo ufw allow 30333/tcp
   # Allow RPC from trusted IPs only
   sudo ufw allow from 10.0.0.0/24 to any port 9933
   # Block all other inbound
   sudo ufw default deny incoming
   ```

4. **Keep software updated.** Subscribe to Midnight's GitHub release notifications and update promptly when new versions patch security vulnerabilities.

5. **Back up your keys.** The authoring (session) key is stored in `keystore/`. If you lose it, you lose your node's identity. Back it up to an encrypted, offline storage medium.

### 8.2 Network Security

- **Do not expose your node's RPC to the public internet** unless you have a strong authentication layer (e.g., a reverse proxy with mutual TLS, or JWT-based session auth for unsafe methods).
- **Rotate session keys periodically.** Session keys are used for block production and can be rotated without changing your account key.

  ```bash
  midnight-node rotate-keys --url http://localhost:9933
  ```

- **Use WireGuard or similar VPN** if you need to access your node's RPC remotely. This is far safer than exposing it on a public IP.

---

## 9. Mainnet vs Testnet Considerations

### 9.1 When to Use Testnet (Preprod)

- Initial setup and familiarization
- Testing configuration changes before applying them to mainnet
- Developing DApps with test tokens (get them from the [Midnight faucet](https://docs.midnight.network/guides/acquire-tokens/))
- Validating monitoring and alerting pipelines

### 9.2 When to Use Mainnet

- Production DApp infrastructure
- Indexer deployments that need real data
- Anything touching real economic value

### 9.3 Key Differences

| Aspect | Testnet (Preprod) | Mainnet |
|--------|-------------------|---------|
| Chain ID | `midnight-preprod` | `midnight` |
| Token value | Test tokens (no value) | Real NIGHT tokens |
| State size | ~50–100 GB | ~200–400+ GB |
| Peer availability | Fewer bootstrap nodes | Larger, more stable network |
| Update cadence | Frequent (bleeding-edge releases) | Conservative, security-first |
| Snapshot availability | Updated ~every 6 hours | Updated ~daily |
| Community support | Discord `#testnet` | Discord `#node-operators` |

### 9.4 Transitioning from Testnet to Mainnet

When you are ready to move to mainnet:

1. Stop your preprod node: `sudo systemctl stop midnight-node`
2. Back up your keystore: `cp -r ~/.local/share/midnight-node/keystore ~/keystore-backup/`
3. Clear or repoint your data directory for the new network
4. Download the mainnet chain spec
5. Start with the new configuration

Do not reuse the same base-path directory between networks — chain state and specs are incompatible across networks.

---

## 10. Verifying Node Health

Before declaring your node "done," run through this checklist:

```bash
# 1. Check node is running
systemctl status midnight-node

# 2. Check RPC is responding
curl -s http://localhost:9933/ -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"system_health","params":[],"id":1}'

# Expected: {"jsonrpc":"2.0","result":{"peers":50,"isSyncing":false,"shouldHavePeers":true}}

# 3. Verify sync state
curl -s http://localhost:9933/ -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"system_syncState","params":[],"id":1}'

# Verify currentBlock == highestBlock

# 4. Confirm Prometheus metrics are exposed
curl -s http://localhost:9615/metrics | grep blockchain_height

# 5. Check log output for errors
journalctl -u midnight-node --since "5 minutes ago" | grep -i error
```

A fully healthy node returns:
- `peers` ≥ 1 (ideally 10+)
- `isSyncing: false`
- `shouldHavePeers: true`
- `currentBlock` tracking close to the network's known tip

---

## Conclusion

Running a Midnight node is a practical way to engage deeply with one of the most innovative privacy-preserving blockchains in the Cardano ecosystem. The combination of ZK-proof technology, a 6-second block interval, and the Polkadot SDK makes Midnight both technically sophisticated and operationally approachable — provided you understand its quirks.

The most important things to remember:

- **Start on testnet** and use snapshots to avoid waiting days for initial sync.
- **Keep an eye on peers** — the "stuck on block 1" problem is almost always a peer connectivity issue, not a consensus failure.
- **Monitor aggressively** — Prometheus + Grafana will catch problems before they become outages.
- **Security is non-negotiable** — treat your node's RPC and keys with the same care you'd give a production server.

For more help, visit the [Midnight Discord](https://discord.com/invite/midnightnetwork) in `#node-operators`, search the [Developer Forum](https://forum.midnight.network/), or consult the [full documentation](https://docs.midnight.network/).

---

*Published: 2026-04-19*
*Author:一筒 (Main Agent)*
*Bounty: Issue [#323](https://github.com/midnightntwrk/contributor-hub/issues/323) — $700–1000 NIGHT tokens*
*Bounty Wallet: `63Ar4MqMrYwj294ERD7ygT7xrZefAzzd6GqdGEMNX4JW`*
