# Running a Midnight Node: Setup, Sync & Monitoring

*A practical guide to deploying a Midnight full node from scratch — with automated health checks and troubleshooting for the most common sync issues.*

---

## Prerequisites

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 2 cores (x86_64) | 4 cores (ARM64 or x86_64) |
| RAM | 4 GB | 8 GB |
| Storage | 100 GB SSD | 500 GB NVMe |
| Network | 10 Mbps | 50+ Mbps |
| OS | Ubuntu 22.04 / Debian 12 | Ubuntu 24.04 |

> **Why SSD/NVMe?** Midnight's state model generates frequent random reads. HDDs cause sync to stall at block 1 — the #1 issue new operators hit.

### Software Dependencies

```bash
# Ubuntu/Debian
sudo apt update && sudo apt install -y curl jq build-essential git

# Install Docker (recommended path)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker

# Verify
docker --version
```

---

## Step 1: Pull the Midnight Node Image

Midnight publishes official Docker images for devnet and testnet:

```bash
# Latest testnet image
docker pull midnightnetwork/midnight-node:testnet

# Verify the image
docker images midnightnetwork/midnight-node
```

<details>
<summary>Building from source (alternative)</summary>

```bash
# Clone the node software
git clone https://github.com/midnightntwrk/midnight-node.git
cd midnight-node

# Build with Cargo (requires Rust 1.75+)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env
cargo build --release

# The binary will be at target/release/midnight-node
```

</details>

---

## Step 2: Configure the Node

Create a directory structure for persistent data:

```bash
mkdir -p ~/.midnight/{data,config,logs}
```

Create `~/.midnight/config/node.toml`:

```toml
# Midnight Node Configuration
[network]
# Testnet bootnodes
bootnodes = [
  "/dns/testnet-bootnode-1.midnight.network/tcp/30333/p2p/12D3KooWExample1",
  "/dns/testnet-bootnode-2.midnight.network/tcp/30333/p2p/12D3KooWExample2",
]

# Your node's external address (set if behind NAT)
# external_address = "/ip4/YOUR_PUBLIC_IP/tcp/30333"

[chain]
# Genesis spec for testnet
chain_spec = "testnet"

[rpc]
# RPC endpoint (keep 127.0.0.1 for security)
host = "127.0.0.1"
port = 9944
ws_port = 9945

[telemetry]
# Optional: report to Midnight telemetry
enable = true
```

---

## Step 3: Launch the Node

### Docker (recommended)

```bash
docker run -d \
  --name midnight-node \
  --restart unless-stopped \
  -p 30333:30333 \
  -p 9944:9944 \
  -p 9945:9945 \
  -v ~/.midnight/data:/data \
  -v ~/.midnight/config:/config \
  midnightnetwork/midnight-node:testnet \
  --config /config/node.toml \
  --base-path /data \
  --log-file /data/node.log
```

### Verify startup

```bash
# Check container status
docker ps | grep midnight

# Tail logs
docker logs -f midnight-node --tail 50
```

You should see log lines like:

```
2026-05-21 14:30:00 🎁 Starting Midnight Node (testnet)
2026-05-21 14:30:01 🏷  Local node identity: 12D3KooW...
2026-05-21 14:30:02 🔄 Syncing — target block #42187, local #0
```

---

## Step 4: Monitor Initial Sync

### Watch sync progress

```bash
# One-liner sync monitor
watch -n 5 'docker exec midnight-node midnight-node --rpc-port 9944 \
  system_syncState 2>/dev/null | jq "{current: .currentBlock, target: .highestBlock, pct: ((.currentBlock / .highestBlock) * 100 | floor)}"'
```

Or use our health check script (Step 6):

```bash
bash midnight-healthcheck.sh
```

### Expected sync timeline

| Phase | Blocks | Typical Duration |
|-------|--------|-----------------|
| Initial peer discovery | 0–100 | 5–15 min |
| Fast sync (warp) | 100–50,000 | 1–4 hours |
| Full sync | 50,000+ | 6–24 hours |

> **Tip:** If sync stays at block 0 or 1 for more than 30 minutes, jump to the [Troubleshooting](#troubleshooting) section.

---

## Step 5: Verify Your Node is Healthy

### 5.1 Block height check

```bash
# Current block vs. network target
curl -s -H "Content-Type: application/json" \
  -d '{"id":1,"jsonrpc":"2.0","method":"system_syncState"}' \
  http://127.0.0.1:9944 | jq '.result'
```

A healthy node shows `currentBlock` close to `highestBlock` (within 10–20 blocks).

### 5.2 Peer connectivity

```bash
# Number of connected peers
curl -s -H "Content-Type: application/json" \
  -d '{"id":1,"jsonrpc":"2.0","method":"system_health"}' \
  http://127.0.0.1:9944 | jq '.result'
```

You want `peers >= 3` and `isSyncing = false` once caught up.

### 5.3 System health at a glance

```bash
curl -s -H "Content-Type: application/json" \
  -d '{"id":1,"jsonrpc":"2.0","method":"system_health"}' \
  http://127.0.0.1:9944 | jq '.result | {isSyncing, peers, shouldHavePeers}'
```

Expected output when synced:
```json
{
  "isSyncing": false,
  "peers": 15,
  "shouldHavePeers": true
}
```

---

## Step 6: Automated Health Monitoring

Save this script as `midnight-healthcheck.sh`:

```bash
#!/usr/bin/env bash
# midnight-healthcheck.sh — One-command node health check
# Usage: bash midnight-healthcheck.sh [--watch] [--alert]

set -euo pipefail

RPC_HOST="${MIDNIGHT_RPC_HOST:-127.0.0.1:9944}"
ALERT_PEER_THRESHOLD="${ALERT_PEER_MIN:-3}"
ALERT_SYNC_LAG="${ALERT_SYNC_LAG:-50}"

rpc_call() {
  curl -sf -H "Content-Type: application/json" \
    -d "{\"id\":1,\"jsonrpc\":\"2.0\",\"method\":\"$1\"}" \
    "http://${RPC_HOST}" 2>/dev/null
}

check_health() {
  local health sync_state

  health=$(rpc_call "system_health" | jq -r '.result')
  sync_state=$(rpc_call "system_syncState" | jq -r '.result')

  local is_syncing peers current_block target_block
  is_syncing=$(echo "$health" | jq '.isSyncing')
  peers=$(echo "$health" | jq '.peers')
  current_block=$(echo "$sync_state" | jq '.currentBlock')
  target_block=$(echo "$sync_state" | jq '.highestBlock')

  local sync_pct=0
  if [ "$target_block" -gt 0 ]; then
    sync_pct=$(( current_block * 100 / target_block ))
  fi

  local status="✅ HEALTHY"
  local issues=""

  if [ "$is_syncing" = "true" ]; then
    status="🔄 SYNCING"
  fi

  if [ "$peers" -lt "$ALERT_PEER_THRESHOLD" ]; then
    status="⚠️ LOW PEERS"
    issues="${issues}PEERS=${peers} (<${ALERT_PEER_THRESHOLD}) "
  fi

  local lag=$(( target_block - current_block ))
  if [ "$lag" -gt "$ALERT_SYNC_LAG" ] && [ "$is_syncing" = "false" ]; then
    status="⚠️ STALE"
    issues="${issues}LAG=${lag} (>${ALERT_SYNC_LAG}) "
  fi

  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) ${status}"
  echo "  Block: ${current_block}/${target_block} (${sync_pct}%)"
  echo "  Peers: ${peers} | Syncing: ${is_syncing}"
  [ -n "$issues" ] && echo "  Issues: ${issues}"

  # Return non-zero for alert mode
  if [ "$1" = "--alert" ] && [ "$status" != "✅ HEALTHY" ]; then
    return 1
  fi
  return 0
}

# --- Main ---
if [ "${1:-}" = "--watch" ]; then
  while true; do
    check_health "" 2>/dev/null || true
    echo "---"
    sleep 30
  done
else
  check_health "${1:-}"
fi
```

```bash
chmod +x midnight-healthcheck.sh

# One-shot check
./midnight-healthcheck.sh

# Continuous monitoring (every 30s)
./midnight-healthcheck.sh --watch

# Alert mode (exits 1 if unhealthy — useful for cron)
./midnight-healthcheck.sh --alert
```

### Cron alert (optional)

```bash
# Add to crontab — check every 5 minutes, alert if unhealthy
(crontab -l 2>/dev/null; echo "*/5 * * * * /path/to/midnight-healthcheck.sh --alert || echo 'Midnight node unhealthy!' | mail -s 'Midnight Alert' you@example.com") | crontab -
```

---

## Step 7: Resource Monitoring

```bash
# Docker resource usage
docker stats midnight-node --no-stream

# Disk usage of chain data
du -sh ~/.midnight/data/

# Watch for storage growth
watch -n 60 'du -sh ~/.midnight/data/ && docker exec midnight-node midnight-node system_syncState 2>/dev/null | jq ".result.currentBlock"'
```

### Setting up Prometheus + Grafana (optional)

<details>
<summary>Click to expand — full monitoring stack setup</summary>

Create `docker-compose.monitoring.yml`:

```yaml
version: "3.8"
services:
  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus_data:/prometheus

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    volumes:
      - grafana_data:/var/lib/grafana

  node-exporter:
    image: prom/node-exporter:latest
    ports:
      - "9100:9100"
    volumes:
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /:/rootfs:ro
    command:
      - '--path.procfs=/host/proc'
      - '--path.sysfs=/host/sys'
      - '--path.rootfs=/rootfs'

volumes:
  prometheus_data:
  grafana_data:
```

```bash
docker compose -f docker-compose.monitoring.yml up -d
```

Access Grafana at `http://your-node:3000` (admin/admin).

</details>

---

## Troubleshooting

### Problem: Node stuck at block 0 or 1

**Symptoms:** `currentBlock` stays at 0 or 1 for 30+ minutes. `peers = 0` or very low.

**Root causes and fixes:**

| Cause | Fix |
|-------|-----|
| Firewall blocking P2P | Open port 30333 TCP+UDP: `sudo ufw allow 30333/tcp && sudo ufw allow 30333/udp` |
| NAT traversal failure | Set `external_address` in `node.toml` to your public IP |
| Bootnode connectivity | Try alternate bootnodes from the Midnight Discord #node-operators channel |
| DNS resolution failure | Add `8.8.8.8` to `/etc/resolv.conf` or use IP-based bootnodes |
| Clock drift | Sync system clock: `sudo timedatectl set-ntp true` |

**Debug steps:**

```bash
# 1. Check port reachability
nc -zv testnet-bootnode-1.midnight.network 30333

# 2. Check your own port
sudo ss -tlnp | grep 30333

# 3. Verify firewall
sudo ufw status | grep 30333

# 4. Check system clock
timedatectl status | grep "System clock"

# 5. Restart with fresh peers
docker restart midnight-node
sleep 10
docker logs midnight-node --tail 20 | grep -i "peer\|connect"
```

### Problem: Peers keep disconnecting

**Symptoms:** Peer count fluctuates between 0 and 2. Logs show frequent peer disconnections.

**Fixes:**

1. **Increase peer count** — add more bootnodes to your config
2. **Check bandwidth** — run `speedtest-cli` to verify >= 10 Mbps upload
3. **Check for resource exhaustion:**
   ```bash
   # RAM usage
   free -h
   # CPU load
   uptime
   # Disk I/O wait
   iostat -x 5 3
   ```
4. **Enable UPnP** on your router (or manually forward port 30333)

### Problem: Sync is extremely slow

**Symptoms:** Block progress is <100 blocks/hour after initial warp sync.

**Fixes:**

1. **Switch to NVMe** — HDD random I/O is the #1 cause of slow sync
2. **Increase Docker memory** — add `--memory=8g` to your `docker run`
3. **Prune and restart:**
   ```bash
   docker stop midnight-node
   docker run --rm -v ~/.midnight/data:/data midnightnetwork/midnight-node:testnet \
     purge-chain --base-path /data --chain testnet
   docker start midnight-node
   ```
4. **Enable warp sync** — ensure `[network].warp_sync = true` in config

### Problem: RPC not responding

**Symptoms:** `curl` to port 9944 times out or returns connection refused.

**Fixes:**

```bash
# Check if container is running
docker ps | grep midnight

# Check if RPC port is mapped correctly
docker port midnight-node

# Try from inside the container
docker exec midnight-node curl -s http://127.0.0.1:9944/health
```

### Problem: Out of disk space

**Symptoms:** Node crashes with "No space left on device".

```bash
# Check disk usage
df -h ~/.midnight/data/

# Prune old state (keeps last 256 blocks)
docker exec midnight-node midnight-node db purge --blocks 256

# Or use a larger volume
sudo lvextend -L +100G /dev/mapper/vg-data
sudo resize2fs /dev/mapper/vg-data
```

---

## Upgrading the Node

When a new testnet release is published:

```bash
# 1. Pull the latest image
docker pull midnightnetwork/midnight-node:testnet

# 2. Stop the old container
docker stop midnight-node

# 3. Rename for rollback
docker rename midnight-node midnight-node-old

# 4. Start with the new image (same volumes)
docker run -d \
  --name midnight-node \
  --restart unless-stopped \
  -p 30333:30333 \
  -p 9944:9944 \
  -p 9945:9945 \
  -v ~/.midnight/data:/data \
  -v ~/.midnight/config:/config \
  midnightnetwork/midnight-node:testnet \
  --config /config/node.toml \
  --base-path /data

# 5. Verify it's syncing
./midnight-healthcheck.sh

# 6. If OK, remove the old container
docker rm midnight-node-old
```

---

## Security Hardening

```bash
# 1. Keep RPC on localhost (default — do NOT expose 9944 publicly)
# Verify:
ss -tlnp | grep 9944  # Should show 127.0.0.1, not 0.0.0.0

# 2. Firewall — only expose P2P port
sudo ufw default deny incoming
sudo ufw allow ssh
sudo ufw allow 30333/tcp
sudo ufw allow 30333/udp
sudo ufw enable

# 3. Run as non-root user
docker run --user 1000:1000 ...

# 4. Keep system updated
sudo unattended-upgrade enable
```

---

## Quick Reference Card

```bash
# Start node
docker start midnight-node

# Stop node
docker stop midnight-node

# View logs
docker logs -f midnight-node --tail 100

# Health check
curl -s -H "Content-Type: application/json" \
  -d '{"id":1,"jsonrpc":"2.0","method":"system_health"}' \
  http://127.0.0.1:9944 | jq '.result'

# Sync status
curl -s -H "Content-Type: application/json" \
  -d '{"id":1,"jsonrpc":"2.0","method":"system_syncState"}' \
  http://127.0.0.1:9944 | jq '.result'

# Peer info
curl -s -H "Content-Type: application/json" \
  -d '{"id":1,"jsonrpc":"2.0","method":"system_peers"}' \
  http://127.0.0.1:9944 | jq '.result | length'

# Restart
docker restart midnight-node
```

---

## Further Reading

- [Midnight Official Docs](https://docs.midnight.network/getting-started)
- [Midnight Developer Forum](https://forum.midnight.network/)
- [Midnight Discord — #node-operators](https://discord.com/invite/midnightnetwork)
- [Midnight MCP for AI-assisted development](https://www.npmjs.com/package/midnight-mcp)

---

*Last updated: 2026-05-21 | Node version: testnet | Author: lloupp*
