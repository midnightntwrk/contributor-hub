# Using midnight-mcp for Contract Development with AI Assistants

## Introduction

Midnight MCP is a powerful tool that integrates AI assistants with the Midnight blockchain development environment. This tutorial will show you how to install, configure, and use midnight-mcp to compile, analyze, and search Midnight contracts.

## Prerequisites

- Node.js 18+ and npm
- Claude Desktop or Cursor (or any MCP-compatible client)
- Basic knowledge of Compact (Midnight's smart contract language)

## Installation

Install the midnight-mcp package globally:

```bash
npm install -g midnight-mcp
```

## Configuration

### For Claude Desktop

Edit your `claude_desktop_config.json` to add the MCP server:

```json
{
  "mcpServers": {
    "midnight-mcp": {
      "command": "midnight-mcp",
      "args": [],
      "env": {
        "MIDNIGHT_MCP_ALLOW_COMPILATION": "true"
      }
    }
  }
}
```

### For Cursor

Add the MCP server in Cursor settings:

```json
{
  "name": "midnight-mcp",
  "type": "command",
  "command": "midnight-mcp",
  "env": {
    "MIDNIGHT_MCP_ALLOW_COMPILATION": "true"
  }
}
```

## Using the Compilation Endpoint

The `midnight_mcp_compile` tool validates Compact code. Here's an example:

```compact
contract Counter {
    storage: { value: Int }
    constructor(initialValue: Int) {
        storage.value = initialValue
    }
    function increment() {
        storage.value += 1
    }
    function getValue(): Int {
        return storage.value
    }
}
```

Send this to the MCP server:

```json
{
  "tool": "midnight_mcp_compile",
  "arguments": {
    "code": "contract Counter { storage: { value: Int } constructor(initialValue: Int) { storage.value = initialValue } function increment() { storage.value += 1 } function getValue(): Int { return storage.value } }"
  }
}
```

Response:

```json
{
  "status": "success",
  "compiled": true,
  "bytecode": "..."
}
```

## Running Contract Analysis

The `midnight_mcp_analyze` tool checks for security issues:

```json
{
  "tool": "midnight_mcp_analyze",
  "arguments": {
    "code": "..."
  }
}
```

Example analysis output:

```json
{
  "issues": [
    {
      "type": "missing_access_control",
      "severity": "high",
      "line": 5,
      "description": "The function `increment` lacks access control. Anyone can increment the counter."
    }
  ]
}
```

## Searching Docs and Examples

Use `midnight_mcp_search` to query documentation:

```json
{
  "tool": "midnight_mcp_search",
  "arguments": {
    "query": "how to secure a counter contract"
  }
}
```

Response:

```json
{
  "results": [
    {
      "title": "Access Control Patterns",
      "url": "https://docs.midnight.network/patterns/access-control",
      "snippet": "Use a caller verification pattern to restrict function access..."
    }
  ]
}
```

## Walkthrough: AI Assistant Catches a Bug

Let's walk through a development session where we intentionally introduce a bug.

**Step 1: Write a contract**

```compact
contract Vault {
    storage: { balance: Int }
    constructor() {
        storage.balance = 0
    }
    function deposit(amount: Int) {
        storage.balance += amount
    }
    function withdraw(amount: Int) {
        if (storage.balance >= amount) {
            storage.balance -= amount
        }
    }
}
```

**Step 2: Compile and analyze**

The AI assistant runs `midnight_mcp_compile` and `midnight_mcp_analyze`. The analysis reveals:

- Missing access control on `withdraw` (anyone can call it)
- No reentrancy protection

**Step 3: AI proposes fix**

The assistant suggests adding an owner and access control:

```compact
contract Vault {
    storage: { balance: Int, owner: Address }
    constructor() {
        storage.balance = 0
        storage.owner = caller()
    }
    function deposit(amount: Int) {
        storage.balance += amount
    }
    function withdraw(amount: Int) {
        require(caller() == storage.owner, "Only owner can withdraw")
        require(storage.balance >= amount, "Insufficient balance")
        storage.balance -= amount
    }
}
```

**Step 4: Re-analyze**

After the fix, analysis shows no critical issues.

## Conclusion

Midnight MCP integrates seamlessly with AI assistants to streamline contract development. With compilation, analysis, and search capabilities, you can catch bugs early and develop secure contracts faster.

## Resources

- [Midnight Docs](https://docs.midnight.network/getting-started)
- [Midnight MCP on npm](https://www.npmjs.com/package/midnight-mcp)
- [Developer Forum](https://forum.midnight.network/)
- [Discord](https://discord.com/invite/midnightnetwork)