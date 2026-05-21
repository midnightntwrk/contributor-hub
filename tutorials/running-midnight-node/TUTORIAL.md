# Running a Midnight Node: Setup, Sync & Monitoring

*A comprehensive guide for developers and node operators*

## Introduction

Running a Midnight node is the foundation for interacting with the Midnight network — whether you're deploying privacy-preserving DApps, validating transactions, or building infrastructure. This tutorial covers everything from bare-metal setup to production monitoring.

**What you'll learn:**
- System requirements and planning
- Full node setup from scratch
- Initial blockchain sync
- Block height monitoring and health checks
- Peer connectivity troubleshooting
- Resource optimization

**Prerequisites:** Linux server (Ubuntu 22.04+ recommended), basic command-line knowledge, Docker installed.

---

## 1. System Requirements

Before setting up a Midnight node, ensure your hardware meets the minimum requirements:

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 4 cores | 8 cores |
| RAM | 8 GB | 16 GB |
| Storage | 100 GB SSD | 500 GB NVMe |
| Network | 100 Mbps | 1 Gbps |
| OS | Ubuntu 22.04 | Ubuntu 24.04 |

*Storage requirements grow as the blockchain expands. Plan for 500 GB+ if running a full archival node.*

---

## 2. Installing Dependencies

Midnight nodes require Docker for the proof server and several CLI tools:

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker (if not installed)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER

# Install Midnight toolchain
curl -sSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
source ~/.bashrc

# Verify installation
compact --version
```

---

## 3. Starting the Proof Server

The proof server generates zero-knowledge proofs for transactions. It runs as a Docker container:

```bash
# Start proof server in background
docker run -d --name midnight-proof-server \
  -p 6300:6300 \
  midnightntwrk/proof-server:8.0.3

# Check it's running
docker logs midnight-proof-server --tail 10
docker ps | grep proof-server
```

Expected output:
```
[INFO] Proof server listening on 0.0.0.0:6300
```

---

## 4. Node Setup

Midnight provides RPC endpoints for the node and indexer. For a local node:

### Option A: Docker (Recommended)

```bash
# Pull the Midnight node image
docker pull midnightntwrk/midnight-node:latest

# Create data directory
mkdir -p ~/midnight/data

# Start the node
docker run -d --name midnight-node \
  -p 9944:9944 \
  -v ~/midnight/data:/data \
  -e RUST_LOG=info \
  midnightntwrk/midnight-node:latest \
  --chain mainnet \
  --base-path /data \
  --rpc-external \
  --rpc-cors all \
  --no-prometheus
```

### Option B: Binary Installation

```bash
# Download the Midnight node binary
wget https://github.com/midnightntwrk/midnight-node/releases/latest/download/midnight-node-x86_64-linux.tar.gz
tar xzf midnight-node-x86_64-linux.tar.gz
sudo mv midnight-node /usr/local/bin/

# Create systemd service
sudo tee /etc/systemd/system/midnight-node.service << 'EOF'
[Unit]
Description=Midnight Node
After=network.target

[Service]
Type=simple
User=midnight
ExecStart=/usr/local/bin/midnight-node --chain mainnet --base-path /var/lib/midnight --rpc-external
Restart=on-failure
RestartSec=10
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

# Create user and directories
sudo useradd -r -s /bin/false midnight
sudo mkdir -p /var/lib/midnight
sudo chown -R midnight:midnight /var/lib/midnight

# Enable and start service
sudo systemctl daemon-reload
sudo systemctl enable midnight-node
sudo systemctl start midnight-node
```

---

## 5. Monitoring Sync Progress

After starting the node, it begins syncing from the genesis block. Monitor progress:

```bash
# Check node status via RPC
curl -s http://localhost:9944/health
# Returns: {"isSyncing": true, "peers": 3, "blockHeight": 15234}

# Get detailed sync status
curl -s -X POST http://localhost:9944 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "system_syncState",
    "params": [],
    "id": 1
  }' | python3 -m json.tool

# Response example:
# {
#   "jsonrpc": "2.0",
#   "result": {
#     "currentBlock": 15234,
#     "highestBlock": 1500000,
#     "startingBlock": 0
#   },
#   "id": 1
# }
```

### Creating a Sync Monitor Script

Save this as `monitor-sync.sh`:

```bash
#!/bin/bash
while true; do
  SYNC=$(curl -s -X POST http://localhost:9944 \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"system_syncState","params":[],"id":1}')
  
  CURRENT=$(echo $SYNC | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['currentBlock'])")
  HIGHEST=$(echo $SYNC | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['highestBlock'])")
  PERCENT=$(echo "scale=2; $CURRENT * 100 / $HIGHEST" | bc)
  
  echo "[$(date)] Block: $CURRENT / $HIGHEST ($PERCENT%)"
  sleep 60
done
```

Run it:
```bash
chmod +x monitor-sync.sh
./monitor-sync.sh
```

---

## 6. Peer Connectivity

A healthy node needs good peer connections. Troubleshoot peer issues:

### Check Peer Count
```bash
curl -s -X POST http://localhost:9944 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"system_peers","params":[],"id":1}'
```

### Common Issues & Fixes

**Problem: "Stuck on block 1"**
- Cause: Proof server not running or unreachable
- Fix: `docker restart midnight-proof-server`

**Problem: "0 peers"**
- Cause: Firewall blocking P2P port (30333)
- Fix:
  ```bash
  sudo ufw allow 30333/tcp
  sudo ufw reload
  ```

**Problem: "Peers keep disconnecting"**
- Cause: Outdated node version or network congestion
- Fix:
  ```bash
  # Update to latest
  docker pull midnightntwrk/midnight-node:latest
  docker stop midnight-node && docker rm midnight-node
  # Restart with updated image
  ```

### Add Bootnodes Manually
```bash
curl -s -X POST http://localhost:9944 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "system_addReservedPeer",
    "params": ["/ip4/3.14.159.265/tcp/30333/p2p/12D3KooW..."]},
    "id": 1
  }'
```

---

## 7. Verifying Your Node is Healthy

### Health Check Endpoint
```bash
# Quick health check
curl -s http://localhost:9944/health | python3 -m json.tool

# Full system information
curl -s -X POST http://localhost:9944 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"system_health","params":[],"id":1}'
```

### Prometheus Metrics
If enabled with `--prometheus-external`:
```bash
curl -s http://localhost:9615/metrics | grep midnight | head -10
```

### Docker Health Check
```bash
docker inspect --format='{{json .State.Health.Status}}' midnight-node
```

### System Resource Monitoring
```bash
# Check node resource usage
docker stats midnight-node --no-stream

# Disk usage
du -sh ~/midnight/data

# Network traffic
iftop -P -p -N
```

---

## 8. Production Considerations

### Security Hardening
- Run the node under a dedicated non-root user
- Use a firewall to restrict RPC access to trusted IPs
- Configure SSL/TLS for remote RPC access
- Regular security updates via unattended-upgrades

### Backup Strategy
```bash
# Backup node database
tar czf midnight-backup-$(date +%Y%m%d).tar.gz ~/midnight/data

# Restore from backup
rm -rf ~/midnight/data
tar xzf midnight-backup-20250601.tar.gz -C ~/midnight/
```

### Logging and Alerting
```bash
# Set up log rotation
sudo tee /etc/logrotate.d/midnight-node << 'EOF'
/var/log/midnight-node/*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    postrotate
        systemctl restart midnight-node
    endscript
}
EOF
```

---

## 9. Troubleshooting Checklist

| Symptom | Check | Solution |
|---------|-------|----------|
| Node won't start | Docker logs | Check port conflicts |
| Sync stuck | Peer count | Add bootnodes |
| High memory | `docker stats` | Increase swap |
| Disk full | `df -h` | Prune old data |
| RPC timeout | Network latency | Check firewall |

### Reset and Full Resync
```bash
# Stop node
docker stop midnight-node && docker rm midnight-node

# Clear data (WARNING: deletes all synced data)
rm -rf ~/midnight/data

# Restart from scratch
docker run -d --name midnight-node \
  -p 9944:9944 \
  -v ~/midnight/data:/data \
  midnightntwrk/midnight-node:latest \
  --chain mainnet --base-path /data --rpc-external --rpc-cors all
```

---

## Conclusion

You now have a fully operational Midnight node with monitoring, backup, and troubleshooting capabilities. Key takeaways:

1. **Start with Docker** for the easiest setup path
2. **Monitor sync progress** with the provided script
3. **Check peer connectivity** as the first troubleshooting step
4. **Set up health checks** for production deployments
5. **Regular backups** prevent data loss

The Midnight network's privacy-preserving architecture makes node operation different from traditional blockchains — the proof server is a critical component that must run alongside the node. Keep both services healthy for reliable operation.

**Next steps:**
- Explore the [Midnight Docs](https://docs.midnight.network) for DApp development
- Join the [Developer Forum](https://forum.midnight.network/)
- Share your node setup on X with **#MidnightforDevs** and tag **@midnightntwrk**

---

*Published for the Midnight Network Developer Program. Follow [@midnightntwrk](https://x.com/midnightntwrk) for updates.*
