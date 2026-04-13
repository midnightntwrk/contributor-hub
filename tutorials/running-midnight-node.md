# Running a Midnight Node: Setup, Sync & Monitoring

A comprehensive guide to running your own Midnight Network node — from installation to production monitoring.

## Why Run a Midnight Node?

Running your own Midnight node gives you:
- **Direct network access** — no dependency on third-party RPCs
- **Privacy** — your queries never leave your infrastructure
- **Low latency** — local access to blockchain data
- **Network support** — help decentralize the Midnight ecosystem
- **Staking rewards** — earn NIGHT tokens for participating (when enabled)

## Prerequisites

### Hardware Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | 4 cores | 8+ cores |
| RAM | 8 GB | 16+ GB |
| Storage | 500 GB SSD | 1 TB NVMe |
| Network | 50 Mbps | 100+ Mbps |
| OS | Ubuntu 22.04 | Ubuntu 22.04 LTS |

### Software Requirements

- Docker and Docker Compose
- Git
- curl, jq

## Installation

### Step 1: Install Docker

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker

# Install Docker Compose
sudo apt install docker-compose-plugin -y

# Verify
docker --version
docker compose version
```

### Step 2: Clone the Midnight Node Repository

```bash
git clone https://github.com/midnightntwrk/midnight-node.git
cd midnight-node
```

### Step 3: Configure Your Node

```bash
# Copy the example environment file
cp .env.example .env

# Edit configuration
nano .env
```

Key configuration options in `.env`:

```env
# Network selection
MIDNIGHT_NETWORK=mainnet  # or testnet

# Node identity
NODE_NAME=your-node-name

# RPC settings
RPC_PORT=9944
WS_PORT=9945

# Storage path
DATA_DIR=./data

# Log level
LOG_LEVEL=info
```

### Step 4: Start the Node

```bash
# Start with Docker Compose
docker compose up -d

# Check status
docker compose ps
docker compose logs -f --tail 100
```

## Syncing the Blockchain

### Initial Sync

When first started, your node will begin syncing from genesis or a snapshot. This can take several hours to days depending on hardware and network conditions.

```bash
# Monitor sync progress
docker compose logs -f | grep "sync"

# Check current block height
curl -s -X POST http://localhost:9944 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"chain_getBlock","params":[]}' | jq '.result.block.header.number'
```

### Using a Snapshot (Faster Sync)

```bash
# Download latest snapshot from official source
SNAP_URL=$(curl -s https://snapshots.midnight.network/latest.json | jq -r '.url')
wget -O snapshot.tar.lz4 "$SNAP_URL"

# Stop node before restoring
docker compose down

# Extract snapshot
lz4 -c -d snapshot.tar.lz4 | tar -x -C ./data/

# Restart
docker compose up -d
```

## Monitoring

### Health Check Script

Create a monitoring script:

```bash
#!/bin/bash
# Midnight Node Monitor

RPC="http://localhost:9944"
ALERT_WEBHOOK=""  # Add your Discord/Slack webhook

# Check if node is running
if ! docker compose ps | grep -q "running"; then
  echo "CRITICAL: Node container not running!"
  exit 2
fi

# Check sync status
SYNC_STATE=$(curl -s -X POST "$RPC" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"system_health","params":[]}' 2>/dev/null)

IS_SYNCING=$(echo "$SYNC_STATE" | jq -r '.result.isSyncing // true')
PEERS=$(echo "$SYNC_STATE" | jq -r '.result.peers // 0')

if [ "$IS_SYNCING" = "true" ]; then
  echo "WARNING: Node is still syncing"
fi

if [ "$PEERS" -lt 5 ]; then
  echo "WARNING: Low peer count: $PEERS"
fi

BLOCK=$(curl -s -X POST "$RPC" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"chain_getBlock","params":[]}' 2>/dev/null \
  | jq -r '.result.block.header.number // 0')

echo "Status: Block #$BLOCK | Peers: $PEERS | Syncing: $IS_SYNCING"

# Disk space check
DISK_USAGE=$(df -h ./data | awk 'NR==2{print $5}' | tr -d '%')
if [ "$DISK_USAGE" -gt 85 ]; then
  echo "WARNING: Disk usage at ${DISK_USAGE}%"
fi
```

### Running as a Cron Job

```bash
# Check every 5 minutes
(crontab -l 2>/dev/null; echo "*/5 * * * * /path/to/midnight-node/monitor.sh >> /var/log/midnight-monitor.log 2>&1") | crontab -
```

### Prometheus + Grafana (Advanced)

```yaml
# docker-compose.monitoring.yml
version: '3.8'
services:
  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus-data:/prometheus

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3000:3000"
    volumes:
      - grafana-data:/var/lib/grafana
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin

volumes:
  prometheus-data:
  grafana-data:
```

## Systemd Service (Auto-Restart)

For production deployments, run as a systemd service:

```ini
# /etc/systemd/system/midnight-node.service
[Unit]
Description=Midnight Network Node
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/path/to/midnight-node
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable midnight-node
sudo systemctl start midnight-node
sudo systemctl status midnight-node
```

## Troubleshooting

| Symptom | Likely Cause | Solution |
|---------|-------------|----------|
| Node won't start | Port conflict | Check `RPC_PORT` not in use: `ss -tlnp \| grep 9944` |
| Sync stuck at block X | Corrupted data | Stop node, delete `data/`, restart from snapshot |
| Low peers (0-2) | Firewall/network | Open P2P port: `sudo ufw allow 30333` |
| High memory usage | Large chain state | Increase RAM or enable pruning |
| Disk full | Chain growth | Add storage or enable pruning |
| Container restarts | OOM kill | Increase Docker memory limit |

### Useful Commands

```bash
# View real-time logs
docker compose logs -f --tail 500

# Restart node
docker compose restart

# Full reset (deletes all data!)
docker compose down -v
rm -rf data/
docker compose up -d

# Check resource usage
docker stats midnight-node
```

## Keeping Your Node Updated

```bash
# Pull latest changes
cd midnight-node
git pull origin main

# Rebuild and restart
docker compose down
docker compose pull
docker compose up -d

# Verify version
docker compose exec midnight-node --version
```

## Security Best Practices

1. **Firewall** — Only expose necessary ports (RPC, P2P)
2. **TLS** — Use a reverse proxy (nginx/Caddy) for RPC access
3. **Authentication** — Never expose RPC without auth
4. **Updates** — Keep Docker and the node software updated
5. **Backups** — Regular backups of your node identity/keys
6. **Monitoring** — Set up alerts for downtime, disk usage, sync issues

## Summary

| Task | Command |
|------|---------|
| Start node | `docker compose up -d` |
| Stop node | `docker compose down` |
| Check status | `docker compose ps` |
| View logs | `docker compose logs -f` |
| Check sync | `curl -s -X POST localhost:9944 -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"system_health","params":[]}' \| jq` |
| Update | `git pull && docker compose pull && docker compose up -d` |

---

*This tutorial was created for the Midnight Network Contributor Program. For the latest documentation, visit [docs.midnight.network](https://docs.midnight.network).*
