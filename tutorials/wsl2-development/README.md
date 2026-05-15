# Midnight Development on Windows via WSL2

## A Complete Guide to Setting Up Your Midnight Development Environment on Windows

**Author:** billbtbillb  
**Date:** May 2026  
**Platform:** Windows 10/11 with WSL2  
**Estimated Setup Time:** 45-60 minutes

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Installing WSL2](#installing-wsl2)
4. [Configuring WSL2 Memory and Performance](#configuring-wsl2-memory-and-performance)
5. [Installing Docker Desktop with WSL2 Backend](#installing-docker-desktop-with-wsl2-backend)
6. [Setting Up Node.js and npm in WSL2](#setting-up-nodejs-and-npm-in-wsl2)
7. [Installing the Midnight Compact Compiler](#installing-the-midnight-compact-compiler)
8. [Setting Up the Midnight Proof Server](#setting-up-the-midnight-proof-server)
9. [End-to-End Verification: Compile and Deploy a Contract](#end-to-end-verification-compile-and-deploy-a-contract)
10. [What Does NOT Work](#what-does-not-work)
11. [Troubleshooting](#troubleshooting)
12. [Additional Resources](#additional-resources)

---

## Introduction

Midnight's development toolchain is built for Linux and macOS. If you're a Windows developer, you'll need to use Windows Subsystem for Linux 2 (WSL2) to run the Compact compiler, the proof server, and the Midnight node. This tutorial walks you through the complete setup process, from enabling WSL2 on your Windows machine to deploying your first smart contract on a local Midnight node.

**Why WSL2?** WSL2 runs a real Linux kernel inside Windows, giving you native Linux performance without the overhead of a traditional virtual machine. This is essential for Midnight's toolchain, which relies on Linux-specific system calls and file system behaviors.

---

## Prerequisites

Before you begin, ensure you have:

- **Windows 10 version 2004 or later** (Build 19041 or higher) or **Windows 11**
- **Administrator access** to your Windows machine
- **At least 8 GB of RAM** (16 GB recommended)
- **At least 20 GB of free disk space**
- **A stable internet connection**

To check your Windows version, press `Win + R`, type `winver`, and press Enter.

---

## Installing WSL2

### Step 1: Enable WSL2

Open **Windows PowerShell** as Administrator (right-click the Start menu → "Windows Terminal (Admin)" or "PowerShell (Admin)") and run:

```powershell
wsl --install
```

This command will:
- Enable the Windows Subsystem for Linux optional feature
- Enable the Virtual Machine Platform optional feature
- Download and install the latest Linux kernel
- Set WSL2 as the default version
- Install Ubuntu as the default distribution

**Note:** If you already have WSL1 installed, upgrade to WSL2 with:

```powershell
wsl --set-default-version 2
```

### Step 2: Restart Your Computer

After the installation completes, restart your computer when prompted.

### Step 3: Set Up Ubuntu

After restarting, Ubuntu will launch automatically. If it doesn't, open the Start menu and search for "Ubuntu". You'll be prompted to create a user account:

```
Enter new UNIX username: your_username
New password: ********
Retype new password: ********
```

### Step 4: Verify WSL2 Installation

In your **WSL terminal** (Ubuntu), verify that WSL2 is running:

```bash
wsl --list --verbose
```

You should see output similar to:

```
  NAME      STATE           VERSION
* Ubuntu    Running         2
```

If the VERSION column shows `2`, you're running WSL2. If it shows `1`, upgrade with:

```powershell
wsl --set-version Ubuntu 2
```

---

## Configuring WSL2 Memory and Performance

WSL2 defaults to using 50% of your system's RAM or 8 GB, whichever is less. However, the Midnight proof server requires at least 4 GB of RAM to function properly. Without explicit configuration, WSL2 may allocate too little memory, causing the proof server to crash with out-of-memory (OOM) errors.

### Create or Edit `.wslconfig`

In your **Windows terminal** (not WSL), create or edit the `.wslconfig` file:

```powershell
notepad "$env:USERPROFILE\.wslconfig"
```

Add the following configuration:

```ini
[wsl2]
memory=8GB
processors=4
swap=4GB
localhostForwarding=true

[experimental]
sparseVhd=true
```

**Configuration explained:**

- **memory=8GB**: Allocates 8 GB of RAM to WSL2. Adjust based on your system's total RAM. If you have 16 GB total, use 8 GB. If you have 32 GB, you can allocate 16 GB.
- **processors=4**: Dedicates 4 CPU cores to WSL2. Adjust based on your CPU.
- **swap=4GB**: Provides 4 GB of swap space as a safety net when RAM is exhausted.
- **localhostForwarding=true**: Enables access to WSL2 services from Windows via localhost.
- **sparseVhd=true**: Reduces disk space usage by allowing the WSL2 virtual disk to shrink dynamically.

### Apply the Configuration

In your **Windows PowerShell**, shut down WSL2 and restart it:

```powershell
wsl --shutdown
wsl
```

### Verify Memory Allocation

In your **WSL terminal**, check the available memory:

```bash
free -h
```

You should see approximately 8 GB of total memory (or whatever you configured).

---

## Installing Docker Desktop with WSL2 Backend

Docker is required for running the Midnight node and the proof server locally.

### Step 1: Install Docker Desktop

1. Download [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/)
2. Run the installer and ensure **"Use WSL 2 instead of Hyper-V"** is selected
3. Complete the installation and restart if prompted

### Step 2: Enable WSL2 Integration

1. Open Docker Desktop
2. Go to **Settings → Resources → WSL Integration**
3. Enable integration with your Ubuntu distribution
4. Click **Apply & Restart**

### Step 3: Verify Docker in WSL2

In your **WSL terminal**, run:

```bash
docker --version
docker run hello-world
```

If you see the "Hello from Docker!" message, Docker is working correctly in WSL2.

### Step 4: Install Docker Compose

Docker Compose is typically included with Docker Desktop. Verify it's available:

```bash
docker compose version
```

If it's not installed, install it manually:

```bash
sudo apt update
sudo apt install docker-compose-plugin
```

---

## Setting Up Node.js and npm in WSL2

Midnight's JavaScript SDK and CLI tools require Node.js. We'll use `nvm` (Node Version Manager) to manage Node.js versions.

### Step 1: Install nvm

In your **WSL terminal**:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
```

Close and reopen your terminal, or run:

```bash
source ~/.bashrc
```

### Step 2: Install Node.js

Install Node.js 20 LTS (recommended for Midnight):

```bash
nvm install 20
nvm use 20
nvm alias default 20
```

### Step 3: Verify Node.js and npm

```bash
node --version
npm --version
```

You should see Node.js v20.x.x and npm 10.x.x or later.

### Step 4: Configure npm for Global Packages

To avoid permission issues with global npm packages:

```bash
mkdir -p ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
```

---

## Installing the Midnight Compact Compiler

The Compact compiler translates Midnight's smart contract language into executable bytecode. It must be installed inside WSL2.

### Step 1: Download the Compact Compiler

In your **WSL terminal**, download the latest Compact compiler release:

```bash
mkdir -p ~/midnight-tools
cd ~/midnight-tools

# Download the latest Compact compiler
curl -L -o compactc https://github.com/midnightntwrk/compact/releases/latest/download/compactc-linux-x86_64
chmod +x compactc
```

### Step 2: Add to PATH

Move the compiler to a directory in your PATH:

```bash
sudo mv compactc /usr/local/bin/
```

Or add the `midnight-tools` directory to your PATH:

```bash
echo 'export PATH=~/midnight-tools:$PATH' >> ~/.bashrc
source ~/.bashrc
```

### Step 3: Verify Installation

```bash
compactc --version
```

You should see the Compact compiler version information.

---

## Setting Up the Midnight Proof Server

The proof server generates zero-knowledge proofs for Midnight transactions. It runs as a Docker container and requires significant memory.

### Step 1: Pull the Proof Server Image

In your **WSL terminal**:

```bash
docker pull midnightntwrk/proof-server:latest
```

### Step 2: Start the Proof Server

Run the proof server with appropriate memory limits:

```bash
docker run -d \
  --name midnight-proof-server \
  -p 6300:6300 \
  -e PROOF_SERVER_PORT=6300 \
  --memory=4g \
  --memory-swap=4g \
  midnightntwrk/proof-server:latest
```

**Important:** The `--memory=4g` flag is critical. The proof server will crash if allocated less than 4 GB of RAM.

### Step 3: Verify the Proof Server

Check that the proof server is running:

```bash
docker ps | grep midnight-proof-server
```

Test the proof server endpoint:

```bash
curl http://localhost:6300/health
```

You should receive a healthy response.

---

## End-to-End Verification: Compile and Deploy a Contract

Let's verify your setup by compiling and deploying a simple Midnight contract.

### Step 1: Install Midnight MCP

In your **WSL terminal**:

```bash
npm install -g midnight-mcp
```

### Step 2: Create a New Project

```bash
mkdir -p ~/midnight-projects/my-first-contract
cd ~/midnight-projects/my-first-contract
midnight-mcp init
```

This creates a project structure with a sample contract.

### Step 3: Compile the Contract

```bash
midnight-mcp compile
```

If the Compact compiler is correctly installed, you'll see compilation output ending with a success message.

### Step 4: Start a Local Midnight Node

In a separate **WSL terminal** window:

```bash
docker run -d \
  --name midnight-node \
  -p 9944:9944 \
  -p 8080:8080 \
  midnightntwrk/node:latest
```

### Step 5: Deploy the Contract

Back in your project directory:

```bash
midnight-mcp deploy --network local
```

If everything is configured correctly, you'll see deployment confirmation with a contract address.

### Step 6: Verify Deployment

```bash
midnight-mcp status --contract <contract-address>
```

You should see the contract status on the local Midnight node.

**Congratulations!** You have successfully set up a complete Midnight development environment on Windows using WSL2.

---

## What Does NOT Work

Understanding what doesn't work on Windows is just as important as knowing what does. Here are the explicit limitations:

### ❌ Native Windows PowerShell / Command Prompt

The Compact compiler, Midnight MCP, and proof server **do not run natively on Windows**. Attempting to run them in PowerShell or CMD will result in:

```
'compactc' is not recognized as an internal or external command
```

or Linux binary execution errors.

**Solution:** Always use WSL2 for Midnight development.

### ❌ Windows-native npm/node

Installing Node.js directly on Windows (via the Windows installer) and running Midnight tools from PowerShell **will not work**. The Midnight SDK relies on Linux-specific system calls.

**Solution:** Install Node.js inside WSL2 using nvm (as described above).

### ❌ Running Docker on Windows without WSL2 Backend

If Docker Desktop is configured to use Hyper-V instead of WSL2, you may experience:

- Slower container startup times
- Inability to access containers from WSL2
- File permission issues when mounting WSL2 paths

**Solution:** Always use the WSL2 backend for Docker Desktop.

### ❌ Windows File System Paths

Do not store your Midnight projects on Windows-mounted drives (e.g., `/mnt/c/Users/...`). WSL2 has significantly slower I/O performance on Windows file systems.

**Solution:** Store all projects in the WSL2 file system (e.g., `~/midnight-projects/`).

### ❌ WSL1

WSL1 does not support Docker and has incompatible system call behavior. Midnight tools require WSL2.

**Solution:** Upgrade to WSL2 using `wsl --set-version Ubuntu 2`.

---

## Troubleshooting

### Proof Server Crashes with OOM (Out of Memory)

**Symptom:** The proof server container exits unexpectedly, and `docker logs midnight-proof-server` shows memory allocation errors.

**Cause:** WSL2 has insufficient memory allocated.

**Solution:**
1. Edit `~/.wslconfig` on Windows and increase the `memory` value to at least 8 GB
2. Run `wsl --shutdown` in PowerShell
3. Restart WSL2 and the proof server

### Docker Permission Denied in WSL2

**Symptom:** Running `docker` commands returns "permission denied".

**Cause:** Your user is not in the `docker` group.

**Solution:**
```bash
sudo usermod -aG docker $USER
newgrp docker
```

Then log out and log back in to WSL2.

### Compact Compiler Not Found

**Symptom:** `compactc: command not found` even after installation.

**Cause:** The compiler binary is not in your PATH.

**Solution:**
1. Verify the binary location: `which compactc` or `find / -name compactc 2>/dev/null`
2. Add the directory to PATH: `echo 'export PATH=/path/to/directory:$PATH' >> ~/.bashrc`
3. Reload: `source ~/.bashrc`
4. Ensure the binary is executable: `chmod +x /path/to/compactc`

### Slow File Operations

**Symptom:** `npm install` or file operations are extremely slow.

**Cause:** You're working on a Windows-mounted drive (`/mnt/c/...`).

**Solution:** Move your project to the WSL2 file system:
```bash
mv /mnt/c/Users/your_username/projects ~/projects
```

### WSL2 Cannot Access Docker

**Symptom:** `docker` commands fail with connection errors.

**Cause:** Docker Desktop is not running or WSL2 integration is disabled.

**Solution:**
1. Open Docker Desktop on Windows
2. Go to Settings → Resources → WSL Integration
3. Ensure your Ubuntu distribution is enabled
4. Restart Docker Desktop

### Port Conflicts

**Symptom:** Services fail to start because ports are already in use.

**Cause:** Another service is using the same port.

**Solution:**
```bash
# Check what's using a port
sudo lsof -i :6300

# Kill the process
sudo kill -9 <PID>

# Or use a different port
docker run -p 6301:6300 midnightntwrk/proof-server:latest
```

---

## Additional Resources

- **Midnight Documentation:** https://docs.midnight.network/getting-started
- **Midnight MCP (npm):** https://www.npmjs.com/package/midnight-mcp
- **Midnight Developer Forum:** https://forum.midnight.network/
- **Midnight Discord:** https://discord.com/invite/midnightnetwork
- **WSL2 Documentation:** https://learn.microsoft.com/en-us/windows/wsl/
- **Docker Desktop WSL2 Backend:** https://docs.docker.com/desktop/wsl/

---

## Summary

This tutorial covered the complete process of setting up a Midnight development environment on Windows using WSL2. Here's what we accomplished:

1. **Installed and configured WSL2** with Ubuntu
2. **Tuned WSL2 memory allocation** via `.wslconfig` to support the proof server
3. **Set up Docker Desktop** with the WSL2 backend
4. **Installed Node.js and npm** using nvm inside WSL2
5. **Installed the Compact compiler** for smart contract development
6. **Deployed the proof server** as a Docker container
7. **Compiled and deployed a contract** to a local Midnight node
8. **Documented what doesn't work** on Windows
9. **Provided troubleshooting solutions** for common issues

With this setup, you can develop, compile, and test Midnight smart contracts directly on your Windows machine. The WSL2 environment provides native Linux performance while keeping you in your familiar Windows desktop environment.

---

*This tutorial is part of the Midnight Network Contributor Hub bounty program. For questions or feedback, join the [Midnight Discord](https://discord.com/invite/midnightnetwork) or visit the [Developer Forum](https://forum.midnight.network/).*
