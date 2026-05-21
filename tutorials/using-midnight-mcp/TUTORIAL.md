# Using midnight-mcp for Contract Development with AI Assistants

> **Audience:** Developers building on Midnight Network using AI coding assistants  
> **Prerequisites:** Node.js 18+, an AI assistant that supports MCP (Claude Desktop, Cursor, VS Code with Clines, etc.)  
> **Reading time:** 12 minutes

---

## Table of Contents

1. [What is midnight-mcp?](#what-is-midnight-mcp)
2. [Installation and Setup](#installation-and-setup)
3. [Core Tools Overview](#core-tools-overview)
4. [Compiling Compact Contracts](#compiling-compact-contracts)
5. [Security Pattern Analysis](#security-pattern-analysis)
6. [Documentation and Code Search](#documentation-and-code-search)
7. [Live Debugging Walkthrough](#live-debugging-walkthrough)
8. [Configuration Reference](#configuration-reference)

---

## What is midnight-mcp?

[`midnight-mcp`](https://www.npmjs.com/package/midnight-mcp) is an MCP (Model Context Protocol) server that gives AI coding assistants direct access to the Midnight development toolchain. Instead of copying code into a terminal or manually running the Midnight SDK, your AI assistant can:

- **Compile** Compact contracts in real time and surface compiler errors
- **Analyze** contracts for known security patterns and anti-patterns
- **Search** Midnight documentation, API references, and code examples
- **Validate** code against the latest Midnight SDK version

For Midnight developers, this means faster iteration cycles. For AI assistants writing Midnight code, it means catching bugs before they reach the test phase.

---

## Installation and Setup

### Prerequisites

```bash
node --version  # v18.0.0 or higher
npm --version   # v9.0.0 or higher
```

### Install the Package

```bash
npm install -g midnight-mcp
```

### Configure with Your AI Assistant

**Claude Desktop (claude_desktop_config.json):**

```json
{
  "mcpServers": {
    "midnight": {
      "command": "midnight-mcp",
      "args": []
    }
  }
}
```

**Cursor:**

1. Open Cursor Settings → Features → MCP Servers
2. Click "Add new MCP Server"
3. Name: `midnight`
4. Type: `command`
5. Command: `midnight-mcp`

**VS Code with Clines:**

```json
{
  "mcpServers": {
    "midnight": {
      "command": "midnight-mcp",
      "args": []
    }
  }
}
```

### Verify Installation

After configuring, restart your AI assistant. Ask it:

> "What Midnight MCP tools are available?"

A properly configured assistant will list the available tools from midnight-mcp. If you see an error, check that `midnight-mcp` is on your PATH and the configuration JSON is valid.

---

## Core Tools Overview

midnight-mcp exposes these tools to your AI assistant:

| Tool | Description | Use Case |
|------|-------------|----------|
| `compile_contract` | Compiles Compact code and returns errors/warnings | Validate contract syntax before deployment |
| `analyze_contract` | Scans for security anti-patterns | Pre-deployment security audit |
| `search_docs` | Queries Midnight documentation and API references | Find function signatures, code examples |
| `get_contract_template` | Generates starter contract templates | Rapid prototyping |
| `validate_ledger_state` | Checks ledger field declarations for common issues | Prevent deployment-time errors |

Each tool accepts a Compact code snippet or query string and returns structured results. The AI assistant handles the formatting — you just describe what you want to build.

---

## Compiling Compact Contracts

The most frequently used feature is real-time compilation. When your AI assistant writes a Compact contract, it can compile it immediately instead of waiting for a manual `compact compile` step.

### Example: AI-Aided Development Session

**You ask:** *"Create a simple token contract in Compact that supports mint and transfer."*

The AI writes the contract code, then calls `compile_contract` to verify it. If there's a syntax error, the AI sees the compiler output and fixes it immediately:

```compact
// First attempt — the AI writes this:
contract Token {
    export ledger totalSupply: Uint<64>;
    
    export circuit mint(amount: Uint<64>): [] {
        totalSupply = totalSupply + amount;  // ❌ Error: cannot modify ledger directly
    }
}
```

The compiler returns an error. The AI fixes it:

```compact
// Fixed version:
contract Token {
    export ledger totalSupply: Uint<64>;
    
    export circuit mint(amount: Uint<64>): [] {
        totalSupply = disclose(totalSupply + amount);  // ✅ Correct: use disclose()
    }
}
```

This iterative compile-fix loop happens in seconds, entirely within your AI assistant's conversation.

### What the Compiler Checks

The `compile_contract` tool validates:

| Check | What It Catches |
|-------|----------------|
| Syntax errors | Missing semicolons, unmatched brackets, wrong type names |
| Type mismatches | `Uint<64>` vs `Bytes<32>` in expressions |
| Missing imports | References to undeclared imports |
| Circuit signature | Wrong number or types of parameters |
| Ledger field access | Using `disclose()` correctly on public state changes |
| Witness declarations | Missing or mismatched witness declarations |

---

## Security Pattern Analysis

The `analyze_contract` tool is a lightweight security scanner that checks for common Midnight anti-patterns. Run it before every deployment.

### Example: Catching a Security Bug

Consider this contract with a subtle vulnerability:

```compact
export circuit withdraw(amount: Uint<64>): [] {
    const caller = ownPublicKey();
    assert(caller == authority, "Unauthorized");
    balance = disclose(balance - amount);
}
```

Ask your AI assistant: *"Analyze this contract for security issues."*

The AI calls `analyze_contract` and reports:

```
⚠️ SECURITY ISSUE DETECTED:
Pattern: ownPublicKey() used for authentication
Risk: HIGH — ownPublicKey() is a witness function that returns user-provided data.
      An attacker can forge the caller identity.

Fix: Use hash-based authentication instead:
  circuit publicKey(_sk: Bytes<32>): Bytes<32> {
      return persistentHash([pad(32, "auth"), _sk]);
  }
```

The AI can then fix the code automatically based on the analysis.

### Security Patterns Checked

| Pattern | Risk Level | What It Does |
|---------|-----------|-------------|
| `ownPublicKey()` for auth | 🔴 High | Witness function, can be forged |
| Missing `disclose()` on ledger writes | 🔴 High | State change won't persist |
| Missing nullifier/nonce | 🟡 Medium | Replay attacks possible |
| Large `disclose()` payload | 🟡 Medium | Gas cost warning |
| Unbounded loop in circuit | 🟢 Low | Proof generation slowdown |

---

## Documentation and Code Search

The `search_docs` tool queries the Midnight documentation index, including:

- **Compact Language Reference** — all keywords, types, and syntax
- **API Reference** — `@midnight-ntwrk/compact-runtime`, `midnight-js`, `midnight-ledger`
- **Code Examples** — from the official Midnight tutorials and example repos
- **Security Best Practices** — the full security checklist

### Example Queries

> **"How do I use persistentCommit?"**

The AI searches docs and returns:
```compact
// persistentCommit creates a privacy-preserving commitment
// Signature: persistentCommit<T>(value: T, randomness: Bytes<32>): Bytes<32>
// Example from docs:
const commitment = persistentCommit(balance, randomSeed);
```

> **"What's the correct way to declare multi-party private state?"**

The AI searches for the `n-party` pattern and returns relevant code examples and explanations.

### How It Accelerates Development

Without midnight-mcp, searching Midnight docs means:
1. Open a browser
2. Navigate to docs.midnight.network
3. Search for the function
4. Read the API reference
5. Switch back to your editor

With midnight-mcp, the AI does all of this in one step and inserts the correct code directly into your contract.

---

## Live Debugging Walkthrough

Let's walk through a real debugging session where the AI assistant identifies and fixes a bug using midnight-mcp.

### The Scenario

You're building a voting contract. You ask the AI to add a "commit vote" feature.

### Step 1: AI Writes Initial Code

The AI produces a `commitVote` circuit:

```compact
export circuit commitVote(voter: Bytes<32>, choice: Boolean, secret: Bytes<32>): [] {
    const commitment = persistentCommit(choice, secret);
    votes[voter] = commitment;  // ❌ Potential issue
}
```

### Step 2: AI Runs Compile

```json
// compile_contract result:
{
  "success": true,
  "warnings": [
    "Using Bytes<32> as a map key. Consider using a hash for Gas optimization.",
    "No disclose() on commitment storage — value may not persist to ledger."
  ]
}
```

### Step 3: AI Runs Security Analysis

```
⚠️ Pattern: Map keyed by public address
Risk: Linkability — anyone who knows the voter address can see their commitment.
Suggestion: Use a nullifier-based approach for privacy.
```

### Step 4: AI Fixes Issues

```compact
export circuit commitVote(choice: Boolean, secret: Bytes<32>): [] {
    const _sk = secretKey();
    const nullifier = persistentHash([pad(32, "vote"), _sk]);
    
    assert(!usedNullifiers.member(nullifier), "Already voted");
    usedNullifiers.insert(disclose(nullifier));
    
    const commitment = persistentCommit(choice, secret);
    voteCommitments = disclose(commitment);
}
```

### Step 5: Final Verification

The AI compiles again — ✅ success — and runs one more security scan — ✅ all clear.

This entire workflow takes under 30 seconds. Without midnight-mcp, the same workflow requires 5+ context switches and manual terminal commands.

---

## Configuration Reference

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `MIDNIGHT_MCP_PORT` | `0` (auto) | Port for the MCP server |
| `MIDNIGHT_MCP_LOG_LEVEL` | `info` | Logging verbosity |

### Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| "Tool not found" after config | MCP server not on PATH | `which midnight-mcp` — if empty, reinstall |
| Compiler returns empty result | SDK version mismatch | `npm update -g midnight-mcp` |
| Security analysis slow | First run downloads data | Wait 10-20s, subsequent runs are cached |
| AI assistant says "I don't have that tool" | MCP config not loaded | Restart the AI assistant after adding MCP server |
| "Failed to connect to MCP server" | Port conflict | Restart the MCP process: `pkill midnight-mcp` |

---

## Further Resources

- [midnight-mcp on npm](https://www.npmjs.com/package/midnight-mcp)
- [MCP Specification](https://modelcontextprotocol.io)
- [Midnight Documentation](https://docs.midnight.network)
- [Claude Desktop MCP Setup](https://docs.anthropic.com/en/docs/claude-desktop/mcp)
- [Cursor MCP Configuration](https://docs.cursor.com/advanced/mcp)

---

*Published for the Midnight Network developer community. Tested against midnight-mcp v0.2.19 and Claude Desktop/Cursor. Found an error? Submit a PR to keep this guide current.*
