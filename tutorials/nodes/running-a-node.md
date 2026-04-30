
# Running a Midnight Node

This guide provides step-by-step instructions for setting up and running a Midnight Network node.

---

## Table of Contents
1. [Server Requirements](#server-requirements)
2. [Installation](#installation)
3. [Syncing the Network](#syncing-the-network)
4. [Monitoring with Prometheus and Grafana](#monitoring-with-prometheus-and-grafana)

---

## Server Requirements

To run a Midnight Network node, your server must meet the following requirements:

### Hardware Requirements
- **CPU**: 4+ cores (8+ recommended for full nodes)
- **RAM**: 8GB+ (16GB+ recommended for full nodes)
- **Storage**: 1TB+ SSD (NVMe preferred) for the node data directory
- **Network**: 100 Mbps+ dedicated connection with low latency

### Software Requirements
- **Operating System**: Linux (Ubuntu 22.04 LTS recommended)
- **Docker**: Version 20.10+ (for containerized deployment)
- **Docker Compose**: Version 1.29+ (for managing services)
- **Persistent Storage**: For the node data directory

---

## Installation

### Prerequisites
1. Set up a Linux server with root access
2. Update your system packages:
   ```bash
   sudo apt update && sudo apt upgrade -y
   ```

### Install Docker and Docker Compose
```bash
# Install Docker
curl -fsSL https://get.docker.com | sh

# Add your user to the docker group
sudo usermod -aG docker $USER

# Install Docker Compose
sudo apt install docker-compose-plugin -y

# Log out and log back in for group changes to take effect
exit
# After logging back in:
newgrp docker
```

### Clone the Midnight Network Repository
```bash
git clone https://github.com/midnightntwrk/midnight-node.git
cd midnight-node
```

### Configure the Node
1. Create a configuration file for your node:
   ```bash
   mkdir -p ~/.midnight
   nano ~/.midnight/config.toml
   ```

2. Add your node configuration (example):
   ```toml
   [node]
   id = "your-node-id"  # Generate a unique ID for your node
   network = "mainnet"   # or "testnet" for testing
   ```

3. Save and exit the configuration file

---

## Syncing the Network

### Start the Node
```bash
docker-compose up -d
```

### Monitor Sync Progress
Check the node's sync status:
```bash
docker-compose logs -f midnight-node
```

### Verify Node Status
Once synced, you can check your node's status:
```bash
docker exec -it midnight-node midnight-node status
```

### Expected Sync Time
- **Light nodes**: ~1 hour
- **Full nodes**: ~24-48 hours (depending on hardware)

---

## Monitoring with Prometheus and Grafana

### Set Up Monitoring Stack
1. Create a directory for monitoring:
   ```bash
   mkdir -p ~/monitoring
   cd ~/monitoring
   ```

2. Create a `docker-compose.yml` file for monitoring:
   ```yaml
   version: '3.8'

   services:
     prometheus:
       image: prom/prometheus:latest
       ports:
         - "9090:9090"
       volumes:
         - ./prometheus.yml:/etc/prometheus/prometheus.yml
       command:
         - '--config.file=/etc/prometheus/prometheus.yml'
         - '--storage.tsdb.path=/prometheus'
         - '--web.console.libraries=/usr/share/prometheus/console_libraries'
         - '--web.console.templates=/usr/share/prometheus/consoles'

     grafana:
       image: grafana/grafana:latest
       ports:
         - "3000:3000"
       volumes:
         - grafana-storage:/var/lib/grafana
       depends_on:
         - prometheus

   volumes:
     grafana-storage:
   ```

3. Create a `prometheus.yml` file:
   ```yaml
   global:
     scrape_interval: 15s

   scrape_configs:
     - job_name: 'midnight-node'
       static_configs:
         - targets: ['host.docker.internal:9091']
   ```

4. Start the monitoring stack:
   ```bash
   docker-compose up -d
   ```

### Configure Node Metrics Export
1. Edit your node's configuration to enable metrics:
   ```toml
   [metrics]
   enabled = true
   port = 9091
   ```

2. Restart your node:
   ```bash
   docker-compose restart midnight-node
   ```

### Access Monitoring Dashboards
- **Prometheus**: http://your-server-ip:9090
- **Grafana**: http://your-server-ip:3000 (default credentials: admin/admin)

### Import Midnight Network Dashboard
1. In Grafana, import the Midnight Network dashboard using the provided JSON file (available in the Midnight Network GitHub repository).

---

## Troubleshooting

### Common Issues
- **Slow sync**: Ensure your server meets hardware requirements and has a stable network connection
- **Connection errors**: Check your firewall settings and ensure ports are open
- **Disk space**: Monitor disk usage and ensure you have enough space for node data

### Support
For additional help, join the Midnight Network community:
- [Discord](https://discord.gg/midnight)
- [GitHub Issues](https://github.com/midnightntwrk/midnight-node/issues)

---

## Contributing
We welcome contributions to improve this guide! Please submit any corrections or suggestions as pull requests to the [contributor-hub repository](https://github.com/midnightntwrk/contributor-hub).

