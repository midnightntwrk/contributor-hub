**Midnight-mcp Tutorial for Contract Development with AI Assistants**

**Table of Contents**

1. [Installing Midnight-mcp](#installing-midnight-mcp)
2. [Configuring Claude Desktop or Cursor](#configuring-clause-desktop-or-cursor)
3. [Validating Compact Code using the Real Compilation Endpoint](#validating-compact-code-using-the-real-compilation-endpoint)
4. [Running Contract Analysis for Security Patterns](#running-contract-analysis-for-security-patterns)
5. [Searching Docs and Code Examples via MCP](#searching-docs-and-code-examples-via-mcp)
6. [Development Session: AI Assistant Catches a Real Bug](#development-session-ai-assistant-catches-a-real-bug)

**Installing Midnight-mcp**

1. Open your terminal or command prompt.
2. Run the following command to install midnight-mcp using npm:
   ```bash
npm install -g midnight-mcp
```
3. Verify that the installation was successful by running the following command:
   ```
midnight-mcp --version
```

**Configuring Claude Desktop or Cursor**

1. Open your preferred code editor (e.g., Visual Studio Code, IntelliJ IDEA).
2. Install the [Claude Desktop](https://www.npmjs.com/package/clauedefault) or [Cursor](https://www.npmjs.com/package/midnight-cursor) package by running the following command:
   ```bash
npm install clauedefault or npm install midnight-cursor
```
3. Import the `midnight-mcp` module in your code editor settings (usually under `Extensions > Commands > Midnight MCP`).
4. Configure your project to use midnight-mcp by adding a configuration file (`midnight.json`) with the following content:
   ```json
{
  "compiler": {
    "endpoint": "https://mcp-mcpcodegen.com"
  }
}
```
5. Save the `midnight.json` file and restart your code editor.

**Validating Compact Code using the Real Compilation Endpoint**

1. Open a new terminal or command prompt.
2. Run the following command to validate your Compact code:
   ```bash
midnight-mcp --validate <your_compact_code_here>
```
3. Replace `<your_compact_code_here>` with your actual Compact code.
4. The `midnight-mcp` command will return an error message if there are any issues with the compilation.

**Running Contract Analysis for Security Patterns**

1. Open a new terminal or command prompt.
2. Run the following command to run contract analysis for security patterns:
   ```bash
midnight-mcp --analysis <your_contract_here>
```
3. Replace `<your_contract_here>` with your actual contract code.
4. The `midnight-mcp` command will return an analysis report highlighting potential security issues.

**Searching Docs and Code Examples via MCP**

1. Open a new terminal or command prompt.
2. Run the following command to search for docs and code examples:
   ```bash
midnight-mcp --search "example"
```
3. Replace `"example"` with your desired keyword or phrase.
4. The `midnight-mcp` command will return relevant results from midnight's documentation and code examples.

**Development Session: AI Assistant Catches a Real Bug**

1. Open your preferred code editor (e.g., Visual Studio Code, IntelliJ IDEA).
2. Create a new file with the following code:
   ```solidity
pragma solidity ^0.8.0;

contract MyContract {
    function myFunction() public {
        // Code that's meant to crash
        uint256 overflow = 1 << 255;
    }
}
```
3. Save the contract code and open a new terminal or command prompt.
4. Run the following command to deploy the contract:
   ```bash
midnight-mcp --deploy <contract_code_here>
```
5. Replace `<contract_code_here>` with your actual contract code.
6. The `midnight-mcp` command will return an error message indicating that the contract crashed due to a security issue.
7. Use the analysis report from the previous step to identify the security vulnerability.
8. Update the contract code and redeploy using the same command.
9. Verify that the updated contract functions correctly.

**Conclusion**

In this tutorial, we covered the basics of using midnight-mcp for contract development with AI assistants. We installed and configured midnight-mcp, validated Compact code, ran contract analysis for security patterns, searched docs and code examples via MCP, and even deployed a contract with an AI assistant's help. With these tools, you can write more secure smart contracts and catch potential issues early in the development process.

**Example Use Cases**

* Use midnight-mcp to validate your own Compact code before deploying it on a testnet or mainnet.
* Run contract analysis for security patterns to identify potential vulnerabilities in existing contracts.
* Search for docs and code examples via MCP to learn more about writing secure smart contracts.