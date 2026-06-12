---
title: "Running a Midnight Node: Setup, Sync & Monitoring"
description: "A comprehensive guide to setting up a Midnight full node from scratch — including installation, sync troubleshooting, monitoring, and production deployment."
tags: [midnight, node, infrastructure, devops, tutorial]
published: false
---

# Running a Midnight Node: Setup, Sync & Monitoring

## Introduction

Running your own Midnight node gives you direct access to the blockchain without relying on third-party RPC providers. It's essential for production dApps, block explorers, and any application requiring low-latency access to chain data.

This guide walks you through the entire process — from spinning up your first node to diagnosing the edge cases that make node operators' lives difficult.

## Prerequisites

Before starting, make sure you have:

- **A Linux server** (Ubuntu 20.04 LTS or later recommended) or macOS with Docker
- **A Cardano-db-sync instance** set up with an accessible PostgreSQL port (Midnight anchors on Cardano)
- **Sufficient resources**:
  - CPU: 4+ cores (8+ recommended for mainnet)
  - RAM: 8GB minimum (16GB recommended)
  - Storage: 100GB+ SSD (archive node: 500GB+)
  - Network: Stable connection with port 30333 open

## Step 1: Install the Midnight Node

### Create Directories

```bash
# Create required directories
mkdir -p ~/data ~/res ~/.local/bin

# ~/data       : Node database and base path
# ~/res        : Chain configuration files
# ~/.local/bin : Node binary location
```

### Download the Binary

```bash
# Create a temporary directory
mkdir -p ~/tmp && cd ~/tmp

# Download the latest Midnight node binary
# Always check the latest version at:
# https://github.com/midnightntwrk/midnight-node/releases
curl -L -O https://github.com/midnightntwrk/midnight-node/releases/download/node-0.22.5/midnight-node-0.22.5-linux-amd64.tar.gz

# Extract the binary
tar -xvzf midnight-node-0.22.5-linux-amd64.tar.gz

# Move binary and config files
mv ~/tmp/midnight-node ~/.local/bin/
mv ~/tmp/res ~/res

# Reload shell environment
source ~/.bashrc
# or: source ~/.zshrc

# Verify installation
midnight-node --version
```

### Using Docker (Alternative)

```bash
# Pull the Midnight node Docker image
docker pull midnightntwrk/node:0.22.5

# Run the node
docker run -d \
  --name midnight-node \
  -p 9944:9944 \
  -p 30333:30333 \
  -v midnight-data:/data \
  midnightntwrk/node:0.22.5 \
  --chain mainnet \
  --base-path /data \
  --name "my-midnight-node"
```

## Step 2: Configure Environment Variables

Create a `.env` configuration file:

```bash
cat > ~/.env << 'EOF'
# PostgreSQL connection (for Cardano-db-sync)
export POSTGRES_HOST="localhost"
export POSTGRES_DB="cexplorer"
export POSTGRES_PORT="5432"
export POSTGRES_USER="midnight"
export POSTGRES_PASSWORD="YOUR_POSTGRES_PASSWORD"

# Cardano database connection string
export DB_SYNC_POSTGRES_CONNECTION_STRING="postgresql://midnight:YOUR_POSTGRES_PASSWORD@localhost:5432/cexplorer"

# Node identity
export NODE_NAME="my-midnight-node"
EOF

# Load environment variables
source ~/.env

# Verify
echo $DB_SYNC_POSTGRES_CONNECTION_STRING
```

## Step 3: Run a Full Node

### Preview Network (Recommended for Testing)

```bash
midnight-node \
  --chain /home/midnight/res/preview/chain-spec-raw.json \
  --base-path /home/midnight/data \
  --pool-limit 35 \
  --name $NODE_NAME \
  --no-private-ip
```

### Mainnet

```bash
midnight-node \
  --chain /home/midnight/res/mainnet/chain-spec-raw.json \
  --base-path /home/midnight/data \
  --pool-limit 35 \
  --name $NODE_NAME \
  --no-private-ip
```

### Archive Mode (Full History)

```bash
midnight-node \
  --chain /home/midnight/res/mainnet/chain-spec-raw.json \
  --base-path /home/midnight/data \
  --pruning archive \
  --no-private-ip \
  --name $NODE_NAME
```

### Available Networks

| Network | Chain Spec | Use Case |
|---------|------------|----------|
| `local` | Default (no flag needed) | Local development |
| `preview` | `res/preview/chain-spec-raw.json` | Testing and staging |
| `preprod` | `res/preprod/chain-spec-raw.json` | Pre-production validation |
| `mainnet` | `res/mainnet/chain-spec-raw.json` | Production |

## Step 4: Verify Node Health

### Check Logs

```bash
# Check key indicators in node output:
# 1. Cardano DB connection → "Postgres connection established"
# 2. Peers → should see connected peers, not "IDLE (0 peers)"
# 3. Syncing → "Best: #0 ..." should increment

# If running via systemd
journalctl -u midnight-node -f

# If running via docker
docker logs -f midnight-node
```

### Key Log Indicators

| Log Message | Meaning | Status |
|-------------|---------|--------|
| `Postgres connection established` | Cardano-db-sync connection OK | ✅ Good |
| `Best: #12345` | Block height progressing | ✅ Syncing |
| `Connected 3 peers` | P2P networking working | ✅ Good |
| `IDLE (0 peers)` | No peers connected | ❌ Check firewall |
| `Cannot connect to Postgres` | DB connection failed | ❌ Check credentials |
| `Imported #12345` | Blocks being imported | ✅ Node working |

## Step 5: Systemd Service (Production)

For production deployments, run the node as a systemd service:

```bash
sudo tee /etc/systemd/system/midnight-node.service << 'EOF'
[Unit]
Description=Midnight Node
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=midnight
Group=midnight
WorkingDirectory=/home/midnight
EnvironmentFile=/home/midnight/.env
ExecStart=/home/midnight/.local/bin/midnight-node \
  --chain /home/midnight/res/mainnet/chain-spec-raw.json \
  --base-path /home/midnight/data \
  --pool-limit 35 \
  --name ${NODE_NAME} \
  --no-private-ip
Restart=always
RestartSec=10
LimitNOFILE=100000

[Install]
WantedBy=multi-user.target
EOF

# Create midnight user
sudo useradd -m -s /bin/bash midnight
sudo chown -R midnight:midnight /home/midnight

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable midnight-node
sudo systemctl start midnight-node

# Check status
sudo systemctl status midnight-node
```

## Step 6: Monitoring and Metrics

### Prometheus Metrics

Midnight nodes expose Prometheus-compatible metrics on port 9615:

```bash
# Check if metrics are enabled
curl -s http://localhost:9615/metrics | head -20

# Key metrics to monitor:
# - substrate_block_height{status="best"}
# - substrate_block_height{status="finalized"}
# - substrate_sync_peers
# - substrate_state_cache_size_bytes
```

### Prometheus Configuration

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'midnight-node'
    static_configs:
      - targets: ['localhost:9615']
```

### Grafana Dashboard Variables

| Metric | Description | Alert Threshold |
|--------|-------------|-----------------|
| `substrate_block_height{status="best"}` | Current block height | No increase for 10 min |
| `substrate_sync_peers` | Number of connected peers | < 3 for 5 min |
| `substrate_state_cache_size_bytes` | State cache size | > 80% of max |
| Disk usage | Node database storage | > 90% capacity |

## Troubleshooting

### Stuck at Block 1 (No Peers)

**Symptom:** Node starts but stays at block 1 with "IDLE (0 peers)".

**Root causes:**
1. Firewall blocking port 30333
2. Bootnode addresses are incorrect or unreachable
3. NAT configuration issue

**Diagnosis:**

```bash
# Check if port is open
nc -zv <your-server-ip> 30333

# Check firewall rules
sudo ufw status
# Ensure port 30333 is open: sudo ufw allow 30333

# Check bootnode connectivity
curl -s -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"system_peers","params":[],"id":1}' \
  http://localhost:9944
```

**Resolution:**

```bash
# 1. Open firewall port
sudo ufw allow 30333

# 2. Explicitly specify bootnodes
midnight-node \
  --chain mainnet \
  --bootnodes /ip4/3.14.159.265/tcp/30333/p2p/12D3KooW... \
  --base-path ~/data \
  --name $NODE_NAME \
  --no-private-ip \
  --reserved-only

# 3. Check if ISP blocks P2P traffic
# Try changing to a different port:
midnight-node --listen-addr /ip4/0.0.0.0/tcp/30334
```

### Sync Stalls After Initial Catch-Up

**Symptom:** Node syncs to near the tip but then slows dramatically or stops.

**Root causes:**
1. Insufficient CPU for block verification
2. PostgreSQL connection issues under load
3. Memory pressure causing swap thrashing

**Diagnosis:**

```bash
# Check system resources during sync
htop
# Look for CPU/memory pressure

# Check PostgreSQL connections
sudo -u postgres psql -c "SELECT count(*) FROM pg_stat_activity;"

# Check disk I/O
iotop -o
```

**Resolution:**

```bash
# 1. Increase PostgreSQL connection pool
# Edit /etc/postgresql/14/main/postgresql.conf:
#   max_connections = 200
#   shared_buffers = 4GB
#   effective_cache_size = 12GB

# 2. Add swap space if memory-constrained
sudo fallocate -l 16G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# 3. Reduce sync speed with --pool-limit
midnight-node --pool-limit 20
```

## Full Node vs Archive Node

| Feature | Full Node | Archive Node |
|---------|-----------|-------------|
| State storage | Prunes after 256 blocks | Full history |
| Disk usage | ~100GB | ~500GB+ |
| Use case | Real-time dApps | Block explorers, analytics |
| Historical queries | Recent only | Any block |
| Command | Default | `--pruning archive` |

## Performance Tuning

### Kernel Parameters

```bash
# Optimize network and file handle limits
cat >> /etc/sysctl.conf << 'EOF'
net.core.rmem_max = 134217728
net.core.wmem_max = 134217728
net.ipv4.tcp_rmem = 4096 87380 134217728
net.ipv4.tcp_wmem = 4096 65536 134217728
net.core.netdev_max_backlog = 5000
fs.file-max = 100000
EOF

sysctl -p
```

### Node Flags

| Flag | Purpose | Recommended Value |
|------|---------|-------------------|
| `--pool-limit` | Transaction pool capacity | 35 (default) |
| `--no-private-ip` | Disable private IP discovery | Always set for public nodes |
| `--pruning` | State pruning mode | `archive` or omit |
| `--name` | Node identity in telemetry | Unique name per node |
| `--bootnodes` | Initial peer discovery addresses | At least 3 bootnodes |

## Conclusion

Running a Midnight node requires:
1. A Cardano-db-sync instance with PostgreSQL
2. Adequate hardware (4+ cores, 8GB+ RAM, 100GB+ SSD)
3. Proper network configuration (port 30333 open)
4. Regular monitoring via Prometheus metrics and log checks

The most common issues are firewall blocking P2P ports (stuck at block 1) and insufficient hardware for archive nodes. Start with the preview network to validate your setup before mainnet.
