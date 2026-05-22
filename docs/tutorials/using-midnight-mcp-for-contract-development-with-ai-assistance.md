# Using midnight-mcp for Contract Development with AI Assistance

## Overview

`midnight-mcp` is a Model Context Protocol server that exposes Midnight Network smart contract tools to AI assistants like Claude and Cursor. Instead of switching between your editor, terminal, and documentation, you can write Compact contracts, compile them, and get instant security analysis — all through natural language in your AI coding assistant.

This tutorial covers:
- Installing and configuring midnight-mcp with Claude Desktop or Cursor
- Compiling Compact contracts through MCP tools
- Running security analysis on contract code
- Searching Midnight docs and code examples
- A real debugging session where an AI catches a Compact language bug

## What You'll Learn

| Skill | Why It Matters |
|-------|---------------|
| MCP server setup | Bridge AI tools to blockchain tooling |
| `midnight-mcp` toolset | Compile, analyze, search without leaving AI chat |
| Compact code compilation via AI | Faster feedback loop while coding |
| Security pattern detection | Catch common contract bugs before deployment |
| AI-assisted debugging | Natural language troubleshooting |

## Prerequisites

- Node.js 18+
- Claude Desktop or Cursor editor
- Rust + Cargo (for Compact compiler)
- Midnight testnet CLI installed

## Architecture

```
┌─────────────────┐     MCP Protocol     ┌──────────────────┐
│  Claude / Cursor │◄────────────────────▶│  midnight-mcp    │
│  (AI Assistant)  │                       │  Server          │
└────────┬────────┘                       └────────┬─────────┘
         │                                             │
         │  "Compile my contract"                      │ calls Compact
         │  "Check for security issues"                │ compiler & APIs
         ▼                                             ▼
   Compact Contract                              Midnight Docs /
   (your code)                                  L1 Network
```

## Step 1: Install midnight-mcp

```bash
# Install globally via npm
npm install -g @midnight-ntwrk/midnight-mcp

# Verify installation
midnight-mcp --version
# Should output: 0.x.x
```

The MCP server exposes these tools:

| Tool | Purpose |
|------|---------|
| `midnight-mcp.compile` | Compile .compact files |
| `midnight-mcp.analyze` | Security patterns & issues |
| `midnight-mcp.search` | Search Midnight documentation |
| `midnight-mcp.deploy` | Deploy to testnet (requires wallet) |

## Step 2: Configure Claude Desktop

Edit your Claude Desktop config file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Linux**: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "midnight": {
      "command": "midnight-mcp",
      "args": ["--network", "testnet"]
    }
  }
}
```

Restart Claude Desktop after saving. You should see the 🔌 MCP icon in the bottom-right corner.

**If you hit "command not found"** — use the full path:
```json
{
  "command": "/usr/local/bin/midnight-mcp",
  "args": ["--network", "testnet"]
}
```

## Step 3: Configure Cursor

In Cursor, open Settings → MCP Servers → Add Server:

```
Name: midnight
Command: midnight-mcp
Args: --network testnet
```

Save and restart Cursor's MCP panel. The tools appear in your AI chat context.

## Step 4: Write a Compact Contract with AI Assistance

With MCP configured, open a new conversation with your AI assistant and say:

```
I'm writing a Midnight smart contract. Here's my Compact code:

[compact code here]

Please compile it using the midnight-mcp tools and tell me if there are any errors.
```

The AI calls `midnight-mcp.compile` automatically:

```
Claude: Let me compile your contract first.
[Calls midnight-mcp.compile]

Compilation result: ✅ SUCCESS
- Warnings: 0
- Output bytecode: 0xabc123...
- TypeScript bindings: artifacts/contract.ts
```

## Step 5: Security Analysis

Ask your AI assistant to run a security check:

```
Please analyze this contract for common security issues using the midnight-mcp MCP tools.
```

The AI calls `midnight-mcp.analyze`, which checks for:

| Pattern Check | What It Catches |
|--------------|-----------------|
| Unchecked arithmetic | Integer overflow/underflow |
| Missing access control | `pub` vs `priv` fn exposure |
| Reentrancy risk | External calls before state update |
| Secret exposure | Private data in public structs |
| ZK circuit complexity | Overly large public inputs |

```
Claude: Security analysis complete: ⚠️ 2 issues found

Issue 1 — [MEDIUM] Reentrancy in `withdraw()`
   Line 42: External L1 call before balance update
   Fix: Update state before calling send()

Issue 2 — [LOW] Public initializer
   Line 10: `new()` is `pub` — any address can initialize
   Fix: Add `owner` check or make `new()` private
```

## Step 6: Search Midnight Documentation

Without leaving your chat:

```
Search midnight-mcp documentation for "Compact ownership patterns"
```

The AI queries `midnight-mcp.search` and returns relevant docs with inline citations:

```
Claude: Found 3 relevant docs:

1. 📄 Ownership Patterns (midnight.network/docs/ownership)
   "Use #[private] on owner field to prevent frontrunning on init..."

2. 📄 Security Checklist (midnight.network/docs/security)
   "Always check !unauthorized before state-changing operations..."

3. 📄 Compact Examples (github.com/midnightntwrk/compact-examples)
   [Code snippet: owner-pattern.compact]
```

## Step 7: Real Debugging Session

Here's a real session where the AI catches a bug via MCP tools:

```compact
// ❌ Buggy contract
use zero_copy::Vec;

struct ContractState {
    balances: Map<Address, u64>,
}

impl ContractState {
    pub fn transfer(&mut self, to: &Address, amount: u64) -> bool {
        let sender = self.caller();
        let bal = self.balances.get(&sender);
        *bal -= amount;        // ← Bug: borrow error
        self.balances.set(to, amount);
        true
    }
}
```

AI with MCP detects the bug on compilation:

```
Claude: Compiled your contract. Found 1 error:

Error [E0382]: "Cannot assign twice to immutable variable `bal`"
The expression `*bal -= amount` tries to mutate a Map::get()
return value, which is a copy (not mutable reference).

Fix: Use a mutable split borrow:
  let (sender_bal, rest) = self.balances.split_at_mut(&sender);
  sender_bal[to] = sender_bal.get(&sender).unwrap() - amount;
  sender_bal.set(to, amount);
```

The AI displayed the compilation error (from `midnight-mcp.compile`) and proposed the fix — all in natural language.

## Midday-MCP vs Manual Tooling Comparison

| Workflow | Without MCP | With MCP |
|----------|------------|----------|
| Compile contract | `midnight compile x.compact` (terminal switch) | "Compile this" (stay in chat) |
| Fix error | Copy error, Google it, come back | AI explains inline with fix |
| Security check | Read docs manually | "Analyze for issues" → instant report |
| Deploy | Multiple CLI commands | "Deploy to testnet" → one-shot |

## Integration with Claude Projects

For a dedicated Midnight workspace:

```json
{
  "projects": {
    "Midnight-Contract-Dev": {
      "mcpServers": {
        "midnight": {
          "command": "midnight-mcp",
          "args": ["--network", "testnet", "--timeout", "30"]
        }
      }
    }
  }
}
```

Now every conversation in that project has midnight tools pre-loaded.

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| MCP server won't start | `midnight-mcp` not in PATH | Use full path in config |
| Claude shows "No tools available" | Config file JSON error | Validate with `python3 -m json.tool` |
| Compile hangs | Compact compiler not installed | `cargo install midnight-compact` |
| Analyze returns empty | Contract file too large | Split contract before analyzing |
| Network unreachable | Testnet node not running | `midnight node start --testnet` |
| "Tool call failed" | Wrong `--network` flag | Ensure flag matches midnight config |

## Summary Checklist

```
[ ] midnight-mcp installed globally
[ ] Claude Desktop / Cursor MCP config added
[ ] Server restarts without errors
[ ] <!-- X --> MCP icon (🔌) visible in AI assistant
[ ] Test compile: AI compiles sample contract successfully
[ ] Test analyze: AI reports security issues on buggy contract
[ ] Test search: AI returns relevant doc snippets
[ ] Bug fix session completed end-to-end
[ ] Commit MCP config to your dotfiles
```

## Next Steps

- Extend midnight-mcp with custom plugins for your team
- Write Cursor rules that auto-invoke `midnight-mcp.analyze` on save
- Add fast-compile to CI: `midnight-mcp --ci-contract-check`
- Set up a shared Cursor/Claude project for your Midnight workspace
