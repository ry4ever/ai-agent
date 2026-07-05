# AiScale MCP Server

Expose the [AiScale Agent Services](https://agents.aiscale.pro) platform — AI research, contract analysis, code review, and data enrichment — as tools to any MCP-compatible client (Claude Desktop, Cursor, VS Code, and 100+ others).

Payments are handled via the [x402](https://x402.org) micropayment protocol on Base L2. The server talks to the **live production API by default** — no local backend required.

## Quick start

Add this to your MCP client config:

```json
{
  "mcpServers": {
    "aiscale": {
      "command": "npx",
      "args": ["-y", "agent-services-platform"]
    }
  }
}
```

That's it. Your client can now call `list_services` to see everything available.

## Install by client

### Claude Desktop
Edit the config file, then restart Claude Desktop:
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "aiscale": {
      "command": "npx",
      "args": ["-y", "agent-services-platform"]
    }
  }
}
```

### Cursor
Add to `~/.cursor/mcp.json` (or **Settings → MCP**):
```json
{
  "mcpServers": {
    "aiscale": {
      "command": "npx",
      "args": ["-y", "agent-services-platform"]
    }
  }
}
```

### VS Code (Copilot)
Add to `.vscode/mcp.json` in your workspace, or via **Preferences: Open MCP settings**:
```json
{
  "servers": {
    "aiscale": {
      "command": "npx",
      "args": ["-y", "agent-services-platform"]
    }
  }
}
```

### Smithery / other registries
This repo is Smithery-ready. The MCP server is declared via the `bin` entry in `package.json` (`aiscale-mcp → dist/mcp/server.js`). To list it:
1. Go to [smithery.ai](https://smithery.ai) → **Publish**
2. Connect the GitHub repo `ry4ever/ai-agent`
3. Smithery auto-detects the server — confirm and publish

## Configuration

All settings are optional environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PLATFORM_URL` | `https://agents.aiscale.pro` | The platform API base URL |
| `MCP_PRIVATE_KEY` | *(empty)* | Wallet private key (0x...) with USDC on Base. **Set this to enable paid calls.** |
| `MCP_AGENT_ADDRESS` | `0x000…0000` | Your wallet address (identifies the payer) |

Example with payment configured:
```json
{
  "mcpServers": {
    "aiscale": {
      "command": "npx",
      "args": ["-y", "agent-services-platform"],
      "env": {
        "MCP_PRIVATE_KEY": "0xYOUR_PRIVATE_KEY"
      }
    }
  }
}
```

## Available tools

| Tool | Description | Price (USDC) |
|------|-------------|--------------|
| `synthesize_research` | AI research brief with citations | $0.15 |
| `analyze_contract` | Contract risk analysis (PDF/text) | $0.10 |
| `review_code` | Security + quality code review | $0.05 |
| `get_company_profile` | Company data by domain | $0.005 |
| `extract_structured_data` | URL/HTML → clean JSON | $0.004 |
| `get_news_summary` | Summarized news for a topic | $0.003 |
| `get_sentiment` | Stock ticker sentiment score | $0.002 |
| `enrich_email` | Email → person/company details | $0.008 |
| `list_services` | Discover all services + pricing | free |

## How payments work

Without `MCP_PRIVATE_KEY`, calling a paid tool returns a `402 Payment Required` with payment details (amount, recipient, network). Your AI client will show these details and ask you to configure payment.

To enable automatic payments:
1. Get USDC on Base — [bridge.base.org](https://bridge.base.org) (mainnet) or [faucet.circle.com](https://faucet.circle.com/) (testnet)
2. Set `MCP_PRIVATE_KEY` to your wallet's private key
3. Each API call automatically signs and sends a unique x402 payment — your key never leaves your machine

You can also use the `aiscale-pay` CLI for one-off paid calls:
```bash
MCP_PRIVATE_KEY=0x... aiscale-pay sentiment AAPL
```

## Local development

```bash
npm install
npm run build          # compiles to dist/mcp/server.js
npm run mcp            # run via ts-node (dev)
node dist/mcp/server.js   # run the built server
```

Point at a local backend during development:
```json
{
  "mcpServers": {
    "aiscale": {
      "command": "node",
      "args": ["dist/mcp/server.js"],
      "env": { "PLATFORM_URL": "http://localhost:3000" }
    }
  }
}
```
