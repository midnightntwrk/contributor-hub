---
title: "Running a Midnight Node: Setup, Sync & Monitoring"
description: "A complete guide to setting up, syncing, and monitoring a Midnight Network node from scratch."
author: chinfoo35-sys
---

# Running a Midnight Node: Setup, Sync & Monitoring

## Introduction

Midnight Network is a data protection blockchain that uses zero-knowledge proofs to keep sensitive data private while still allowing verifiable computation. Running a node is the first step to participating in the network—whether you're a developer building dApps, an operator securing the chain, or just someone who wants to support decentralization.

This guide will walk you through everything you need: what hardware to get, how to install and configure the node software, how to sync with the network, and how to monitor your node's health once it's running.

By the end, you'll have a fully operational Midnight node that you can verify is synced and healthy.

---

## 1. Prerequisites

### Hardware Requirements

Before you start, make sure your machine meets these minimum specs:

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | 4 cores | 8+ cores |
| RAM | 16 GB | 32 GB |
| Storage | 500 GB SSD | 1 TB NVMe |
| Bandwidth | 100 Mbps | 1 Gbps |
| OS | Ubuntu 22.04+ | Ubuntu 24.04 LTS |

Storage is the most important factor. Midnight's ledger grows continuously, and an NVMe drive makes a noticeable difference during the initial sync.

### Software Dependencies

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl wget git build-essential pkg-config libssl-dev
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
docker --version
```

### Network

- Static public IP (or a stable dynamic DNS setup)
- Port 30333 (P2P) forwarded and reachable
- Ports 9933 (RPC) and 9944 (WebSocket) optional, for dApp access

---

## 2. Installation

### Option A: Docker (Recommended)

```bash
mkdir -p ~/midnight-node && cd ~/midnight-node
docker pull midnightnetwork/node:latest

# Generate node key
mkdir -p config data
openssl rand -hex 32 > config/node-key

# Start it
docker run -d --name midnight-node --restart unless-stopped \
  -p 30333:30333 -p 9933:9933 -p 9944:9944 \
  -v $(pwd)/data:/data -v $(pwd)/config:/config \
  midnightnetwork/node:latest \
  --base-path /data --chain mainnet \
  --name "my-midnight-node" \
  --node-key-file /config/node-key --port 30333 \
  --rpc-port 9933 --ws-port 9944 --rpc-cors all

# Check
docker logs midnight-node --tail-20
```

### Option B: Native Binary

```bash
wget https://github.com/midnight-network/midnight-node/releases/latest/download/midnight-node-linux-x86_64.tar.gz
tar -xzf midnight-node-linux-x86_64.tar.gz
sudo mv midnight-node /usr/local/bin/

mkdir -p ~/midnight-data
openssl rand -hex 32 > ~/midnight-data/node-key

midnight-node \
  --base-path ~/midnight-data --chain mainnet \
  --name "my-midnight-node" \
  --node-key-file ~/midnight-data/node-key \
  --port 30333
```

---

## 3. Initial Sync Process

Takes **6–24 hours** depending on hardware. Your node downloads and verifies every block from genesis.

### Monitoring Sync

```bash
# Check block height
curl -s http://localhost:9933 -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"chain_getHeader"}' | \
  python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('result',{}).get('number','?'))"

# Check peer count
curl -s http://localhost:9933 -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"system_health"}'
```

You're fully synced when your block height matches the [network explorer](https://explorer.midnight.network) and `isSyncing` is `false`.

---

## 4. Peer Connectivity Troubleshooting

**Symptom**: Stuck on block 1, constant "No peers available" in logs.

**Fix checklist:**

1. **Verify port forwarding** — Check if 30333 is reachable from outside
2. **Check local firewall** — `sudo ufw status` → allow 30333 if blocked
3. **Add bootnodes manually** — `--bootnodes /dns4/bootnode-1.midnight.network/tcp/30333/p2k/PEER_ID`
4. **Sync system clock** — `sudo timedatectl set-ntp true`
5. **Restart** — `docker restart midnight-node`

Healthy output: "Connected to 8+ peers"

---

## 5. Monitoring

```bash
# Quick health check
echo "Block: $(curl -s http://localhost:9933 -H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"chain_getHeader\"}' | python3 -c 'import json,sys;print(json.load(sys.stdin).get(\"result\",{}).get(\"number\",\"?\"))') - Health: $(curl -s http://localhost:9933 -H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"system_health\"}')"
```

Prometheus metrics available on port 9615: `/metrics` endpoint exposes block height, peer count, memory, CPU.

### systemd Service (Native Binary)

```ini
[Unit]
Description=Midnight Node
After=network-online.target

[Service]
User=$USER
ExecStart=/usr/local/bin/midnight-node --base-path /home/$USER/midnight-data --chain mainnet --name "my-midnight-node" --port 30333
Restart=always
RestartSec=30

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now midnight-node
```

---

## 6. Verification Checklist

- [ ] Port 30333 reachable from outside
- [ ] 8+ connected peers
- [ ] Block height matches explorer
- [ ] `isSyncing: false`
- [ ] CPU < 50% idle (post-sync)
- [ ] No swapping
- [ ] 20%+ free disk
- [ ] 24h+ uptime
- [ ] No persistent errors in logs

---

*Published for the Midnight Contributor Hub bounty program (#323). Feedback welcome via [Forum](https://forum.midnight.network/) or [Discord](https://discord.com/invite/midnightnetwork).*
