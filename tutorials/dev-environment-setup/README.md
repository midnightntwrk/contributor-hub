<!--
  Copyright 2026 Midnight Foundation
  SPDX-License-Identifier: Apache-2.0
-->

# Setting Up Your Midnight Developer Environment — Complete Guide (2026 Edition)

> **Companion text for [Issue #283](https://github.com/midnightntwrk/contributor-hub/issues/283): Setting Up Your Midnight Developer Environment**
>
> This written tutorial walks through every step of configuring a fully working Midnight Network development environment from scratch. Whether you prefer reading alongside a video or working at your own pace, this guide has you covered.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites Overview](#prerequisites-overview)
3. [Step 1 — Installing Node.js and npm](#step-1--installing-nodejs-and-npm)
4. [Step 2 — Installing and Configuring Docker](#step-2--installing-and-configuring-docker)
5. [Step 3 — Installing the Compact Compiler](#step-3--installing-the-compact-compiler)
6. [Step 4 — Setting Up the Proof Server](#step-4--setting-up-the-proof-server)
7. [Step 5 — Configuring the Midnight Wallet](#step-5--configuring-the-midnight-wallet)
8. [Step 6 — Deploying Your First Smart Contract](#step-6--deploying-your-first-smart-contract)
9. [Troubleshooting Common Issues](#troubleshooting-common-issues)
10. [Next Steps](#next-steps)

---

## Introduction

The Midnight Network is a privacy-focused blockchain platform built by the team behind Cardano. It introduces **Compact**, a domain-specific language for writing privacy-preserving smart contracts, along with a zero-knowledge proof infrastructure that lets developers build dApps where user data stays private.

Setting up a Midnight development environment involves several interlocking pieces: the Node.js runtime, Docker for containerized services, the Compact compiler for turning your contract source code into deployable artifacts, a proof server for generating zero-knowledge proofs, and a wallet for managing keys and submitting transactions. This guide walks you through each component in order, so that by the end you will have a fully functional local development stack capable of compiling, deploying, and interacting with a Compact smart contract.

This tutorial targets **macOS and Linux** users. Windows users can follow along via WSL2 (Windows Subsystem for Linux) — the steps are nearly identical once you have a Linux terminal available.

---

## Prerequisites Overview

Before diving in, here is the full list of what you will set up:

| Component | Purpose |
|---|---|
| **Node.js (LTS)** | Runtime for the Midnight CLI tools and JavaScript/TypeScript SDK |
| **Docker & Docker Compose** | Runs the local Midnight node, proof server, and other services |
| **Compact Compiler (`compactc`)** | Compiles Compact smart contracts into circuit artifacts |
| **Proof Server** | Generates zero-knowledge proofs for transactions |
| **Midnight Wallet** | Manages keys, addresses, and submits transactions to the network |
| **midnight-mcp** | Midnight CLI tool for contract deployment and interaction |

You will need approximately **8 GB of RAM** and **10 GB of free disk space** to run the full local stack comfortably.

---

## Step 1 — Installing Node.js and npm

Midnight's tooling requires Node.js. The recommended approach is to use a version manager so you can switch versions without conflicts.

### Using nvm (Node Version Manager)

```bash
# Install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash

# Reload your shell
source ~/.bashrc   # or source ~/.zshrc on macOS

# Install the latest LTS version of Node.js
nvm install --lts

# Verify installation
node --version
# Expected: v22.x.x or later LTS

npm --version
# Expected: 10.x.x or later
```

### Alternative: Using fnm (Fast Node Manager)

If you prefer a Rust-based, faster alternative:

```bash
# macOS via Homebrew
brew install fnm

# Add to shell config
echo 'eval "$(fnm env --use-on-cd)"' >> ~/.zshrc
source ~/.zshrc

# Install LTS
fnm install --lts
fnm use --lts

node --version
```

### Verifying Your Setup

Run these checks to make sure Node.js is ready:

```bash
# Confirm global npm packages directory is writable
npm config get prefix
# Should point to your user directory, not /usr

# If it points to /usr, fix permissions:
mkdir -p ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.zshrc
source ~/.zshrc
```

> **Tip:** Always use the LTS release. Midnight's SDK is tested against LTS versions and using odd-numbered releases (e.g., v23) may cause unexpected issues.

---

## Step 2 — Installing and Configuring Docker

Docker is essential for running the local Midnight testnet node and the proof server. The recommended setup is Docker Desktop on macOS or Docker Engine + Docker Compose on Linux.

### macOS — Docker Desktop

```bash
# Via Homebrew
brew install --cask docker

# Launch Docker Desktop from Applications
# Wait for the whale icon in the menu bar to stabilize

# Verify
docker --version
docker compose version
```

### Linux — Docker Engine

```bash
# Ubuntu / Debian
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg

# Add Docker's official GPG key
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Add the repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Add your user to the docker group (avoids needing sudo)
sudo usermod -aG docker $USER
newgrp docker

# Verify
docker --version
docker compose version
```

### Allocating Sufficient Resources

The Midnight stack can be memory-hungry. Make sure Docker has enough resources:

- **Docker Desktop (macOS):** Go to Settings → Resources → set Memory to at least **6 GB**, CPUs to at least **4**.
- **Linux:** Docker Engine uses host resources directly, so ensure your machine has enough.

### Pulling Required Images

Pre-pull the images you will need to avoid waiting during startup:

```bash
# These are example image names — check the Midnight docs for current tags
docker pull midnightnetwork/proof-server:latest
docker pull midnightnetwork/node:latest
```

> **Note:** Image names and tags may change. Always refer to the [official Midnight documentation](https://docs.midnight.network/getting-started) for the latest image references.

---

## Step 3 — Installing the Compact Compiler

The **Compact compiler** (`compactc`) is the tool that takes your `.compact` source files and produces the circuit artifacts and TypeScript bindings needed for deployment. This is the heart of the Midnight development workflow.

### Installation via npm

```bash
# Install the Compact compiler globally
npm install -g @midnight-ntwrk/compactc

# Verify
compactc --version
```

### Installation from Source (Advanced)

If you need a specific version or want to contribute to the compiler:

```bash
# Clone the compiler repository
git clone https://github.com/midnightntwrk/compactc.git
cd compactc

# Follow the build instructions in the repo's README
# Typically involves:
cargo build --release
# The binary will be in target/release/compactc
```

### Understanding the Compact Language

Compact is Midnight's domain-specific language for writing smart contracts. It is syntactically similar to TypeScript but adds privacy-specific constructs:

- **`ledger`**: Defines the on-chain state (public data visible on the blockchain).
- **`contract`**: The main contract block containing circuit definitions.
- **`witness`**: Private inputs that only the prover can see — used for zero-knowledge proofs.
- **`circuit`**: Functions that define the logic and constraints of the contract.

Here is a minimal example contract (`hello.compact`):

```compact
ledger counter: Counter;

export circuit increment(): void {
    counter.value = counter.value + 1;
}

export circuit get_value(): Counter {
    return counter.value;
}
```

### Compiling a Contract

```bash
# Create a project directory
mkdir -p ~/my-first-midnight-contract
cd ~/my-first-midnight-contract

# Write your .compact file (see example above)
# Then compile it:
compactc --out-dir ./build hello.compact

# Check the output
ls ./build/
# You should see generated TypeScript files and circuit artifacts
```

The compiler produces:
- **TypeScript bindings** for interacting with the contract from your application
- **Circuit files** (`.dat`) that the proof server uses to generate zero-knowledge proofs
- **Contract module** that you import into your deployment script

---

## Step 4 — Setting Up the Proof Server

The proof server is a critical piece of the Midnight infrastructure. It takes circuit descriptions and witness data, then produces zero-knowledge proofs that can be verified on-chain without revealing the private inputs.

### Running via Docker

The simplest way to run the proof server locally:

```bash
# Create a working directory for the proof server
mkdir -p ~/midnight-proof-server
cd ~/midnight-proof-server

# Create a docker-compose.yml file
cat > docker-compose.yml << 'EOF'
version: '3.8'

services:
  proof-server:
    image: midnightnetwork/proof-server:latest
    ports:
      - "6300:6300"
    environment:
      - PROOF_SERVER_PORT=6300
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:6300/health"]
      interval: 10s
      timeout: 5s
      retries: 5
EOF

# Start the proof server
docker compose up -d

# Check that it's running
docker compose ps

# Verify the health endpoint
curl http://localhost:6300/health
# Expected: {"status":"ok"} or similar
```

### Verifying the Proof Server

```bash
# Check logs for any errors
docker compose logs proof-server

# A healthy proof server will show something like:
# "Proof server listening on port 6300"
# "Ready to accept proof generation requests"
```

> **Troubleshooting:** If port 6300 is already in use, change the left side of the port mapping in `docker-compose.yml` (e.g., `6301:6300`) and update your application configuration accordingly.

---

## Step 5 — Configuring the Midnight Wallet

The Midnight wallet manages your cryptographic keys and addresses. For local development, you will work with a testnet wallet that interacts with your local Docker stack.

### Installing the Midnight CLI

```bash
# Install midnight-mcp globally
npm install -g midnight-mcp

# Verify
midnight-mcp --version
```

### Creating a Wallet

```bash
# Generate a new wallet
midnight-mcp wallet create --network testnet

# This will output:
# - Your wallet address
# - A seed phrase (WRITE THIS DOWN SECURELY, even for dev)
# - A keystore file location

# The keystore is typically stored at:
# ~/.midnight/wallet/keystore.json
```

### Wallet Configuration

Create or edit the Midnight configuration file:

```bash
mkdir -p ~/.midnight

cat > ~/.midnight/config.json << 'EOF'
{
  "network": "testnet",
  "proofServer": {
    "host": "localhost",
    "port": 6300
  },
  "node": {
    "host": "localhost",
    "port": 8080
  },
  "logLevel": "info"
}
EOF
```

### Funding Your Wallet (Testnet)

For the local Docker stack, you typically fund your wallet through a faucet or genesis allocation:

```bash
# If using a local node, the genesis block may pre-fund test addresses
# Check the node's documentation for the default funded mnemonic

# For testnet, request tokens from the faucet:
midnight-mcp wallet fund --address <your-wallet-address>

# Check balance
midnight-mcp wallet balance
```

### Exporting Keys for Development

```bash
# Export your wallet's public address
midnight-mcp wallet address

# Export the viewing key (for debugging)
midnight-mcp wallet export-viewing-key
```

> **Security Note:** Never commit seed phrases, private keys, or keystore files to version control. Add them to your `.gitignore`:

```bash
echo ".env" >> .gitignore
echo "*.keystore.json" >> .gitignore
echo "node_modules/" >> .gitignore
echo "build/" >> .gitignore
```

---

## Step 6 — Deploying Your First Smart Contract

Now for the exciting part — deploying a contract to your local Midnight stack. This brings together everything you have set up so far.

### Project Setup

```bash
# Create a new project
mkdir -p ~/midnight-hello-world
cd ~/midnight-hello-world

# Initialize npm project
npm init -y

# Install Midnight SDK dependencies
npm install @midnight-ntwrk/midnight-js-sdk
npm install @midnight-ntwrk/compactc

# Install TypeScript (recommended)
npm install -D typescript @types/node ts-node

# Initialize TypeScript
npx tsc --init
```

### Writing the Contract

Create `contracts/counter.compact`:

```bash
mkdir -p contracts

cat > contracts/counter.compact << 'EOF'
import CompactStandardLibrary;

ledger counter: Counter;

export circuit increment(): void {
    counter.value = counter.value + 1;
}

export circuit decrement(): void {
    assert(counter.value > 0, "Counter cannot go below zero");
    counter.value = counter.value - 1;
}

export circuit get_value(): Counter {
    return counter.value;
}
EOF
```

### Compiling the Contract

```bash
# Compile
compactc --out-dir ./build contracts/counter.compact

# Verify output
ls -la build/
# Should contain:
# - counter.ts (TypeScript bindings)
# - counter.circuit (circuit data)
# - counter.ark (constraint system)
```

### Writing the Deployment Script

Create `src/deploy.ts`:

```bash
mkdir -p src

cat > src/deploy.ts << 'EOF'
import { MidnightProvider, WalletProvider } from '@midnight-ntwrk/midnight-js-sdk';
import * as counterContract from '../build/counter';

async function main() {
  // Connect to the local proof server
  const proofServerUrl = 'http://localhost:6300';
  
  // Connect to the local node
  const nodeUrl = 'http://localhost:8080';
  
  console.log('🔗 Connecting to Midnight local stack...');
  console.log(`   Proof Server: ${proofServerUrl}`);
  console.log(`   Node: ${nodeUrl}`);
  
  // Initialize providers
  const walletProvider = new WalletProvider({
    networkId: 'testnet',
  });
  
  const midnightProvider = new MidnightProvider({
    nodeUrl,
    proofServerUrl,
  });
  
  console.log('📦 Deploying counter contract...');
  
  // Deploy the contract
  const deployment = await counterContract.deploy(
    midnightProvider,
    walletProvider,
    {} // Initial state
  );
  
  console.log(`✅ Contract deployed!`);
  console.log(`   Contract address: ${deployment.contractAddress}`);
  console.log(`   Transaction hash: ${deployment.deployTxHash}`);
  
  // Interact with the contract
  console.log('\n📊 Reading initial value...');
  const initialValue = await deployment.call.get_value();
  console.log(`   Value: ${initialValue}`);
  
  console.log('\n⬆️  Incrementing counter...');
  await deployment.call.increment();
  
  const newValue = await deployment.call.get_value();
  console.log(`   Value after increment: ${newValue}`);
  
  console.log('\n⬆️  Incrementing again...');
  await deployment.call.increment();
  
  const finalValue = await deployment.call.get_value();
  console.log(`   Final value: ${finalValue}`);
  
  console.log('\n🎉 Success! Your first Midnight contract is deployed and working.');
}

main().catch(console.error);
EOF
```

### Running the Deployment

```bash
# Make sure all Docker services are running
docker compose -f ~/midnight-proof-server/docker-compose.yml ps

# Compile the contract (if not already done)
compactc --out-dir ./build contracts/counter.compact

# Run the deployment script
npx ts-node src/deploy.ts
```

Expected output:

```
🔗 Connecting to Midnight local stack...
   Proof Server: http://localhost:6300
   Node: http://localhost:8080
📦 Deploying counter contract...
✅ Contract deployed!
   Contract address: mn_contract1q...
   Transaction hash: 0xabc123...

📊 Reading initial value...
   Value: 0

⬆️  Incrementing counter...
   Value after increment: 1

⬆️  Incrementing again...
   Final value: 2

🎉 Success! Your first Midnight contract is deployed and working.
```

---

## Troubleshooting Common Issues

### Docker Issues

**Problem:** `Cannot connect to the Docker daemon`
```bash
# Make sure Docker is running
docker info

# On macOS: open Docker Desktop
open -a Docker

# On Linux: start the service
sudo systemctl start docker
```

**Problem:** `Port already in use`
```bash
# Find what's using the port
lsof -i :6300

# Kill the process or change the port in docker-compose.yml
```

### Node.js Issues

**Problem:** `npm ERR! EACCES permission denied`
```bash
# Fix npm permissions
mkdir -p ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.zshrc
source ~/.zshrc
```

**Problem:** `Unsupported engine` warnings
```bash
# Check your Node version
node --version

# Switch to LTS
nvm install --lts
nvm use --lts
```

### Compact Compiler Issues

**Problem:** `compactc: command not found`
```bash
# Check if it's installed
npm list -g @midnight-ntwrk/compactc

# Reinstall if needed
npm install -g @midnight-ntwrk/compactc

# Check npm global bin path
npm bin -g
```

**Problem:** `Compilation failed: unknown type`
```bash
# Make sure you're importing the standard library
# Add to the top of your .compact file:
import CompactStandardLibrary;
```

### Proof Server Issues

**Problem:** `Connection refused to proof server`
```bash
# Check if the container is running
docker compose ps

# Check logs for errors
docker compose logs proof-server

# Restart if needed
docker compose restart proof-server
```

### Wallet Issues

**Problem:** `Insufficient funds for transaction`
```bash
# Check your balance
midnight-mcp wallet balance

# Request more testnet tokens
midnight-mcp wallet fund --address <your-address>
```

---

## Next Steps

Congratulations! You now have a fully working Midnight development environment. Here is where to go from here:

1. **Read the Compact Language Specification** — Understand privacy circuits, witnesses, and the full type system in the [official documentation](https://docs.midnight.network/getting-started).

2. **Explore Example Contracts** — The [Midnight GitHub organization](https://github.com/midnightntwrk) has several example projects demonstrating different patterns.

3. **Join the Community:**
   - [Developer Forum](https://forum.midnight.network/) — Ask questions and share your projects
   - [Discord](https://discord.com/invite/midnightnetwork) — Real-time chat with other developers
   - [GitHub](https://github.com/midnightntwrk) — Contribute to the ecosystem

4. **Build Something** — Try implementing:
   - A private voting system
   - A sealed-bid auction
   - A credential verification system
   - A private token with confidential transfers

5. **Contribute to the Ecosystem** — Check the [Contributor Hub](https://github.com/midnightntwrk/contributor-hub) for open bounties and ways to contribute.

---

## Resources

- **Midnight Documentation:** https://docs.midnight.network/getting-started
- **Midnight MCP (npm):** https://www.npmjs.com/package/midnight-mcp
- **Developer Forum:** https://forum.midnight.network/
- **Discord Community:** https://discord.com/invite/midnightnetwork
- **GitHub Organization:** https://github.com/midnightntwrk
- **Bounty Program:** https://github.com/midnightntwrk/contributor-hub

---

*This tutorial was created as a companion written guide for [Issue #283](https://github.com/midnightntwrk/contributor-hub/issues/283). For the video version, check the issue thread for links.*
