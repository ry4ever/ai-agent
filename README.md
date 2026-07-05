# AiScale Agent Services — MCP Server

> Give any AI agent real-world skills: deep research, contract analysis, code review, and data enrichment — paid per-request via [x402](https://x402.org) micropayments in USDC on Base L2. No API keys, no subscriptions.

This package ships an **[MCP](https://modelcontextprotocol.io) server** that exposes the [AiScale Agent Services](https://agents.aiscale.pro) platform as tools to Claude Desktop, Cursor, VS Code, and any other MCP-compatible client.

```
npx agent-services-platform
```

## Install

Add to your MCP client config:

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

Config file locations:
- **Claude Desktop** — `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) · `%APPDATA%\Claude\claude_desktop_config.json` (Windows)
- **Cursor** — `~/.cursor/mcp.json` (or Settings → MCP)
- **VS Code (Copilot)** — `.vscode/mcp.json`

Restart your client, then ask it to `list_services` to discover everything available.

## Tools

| Tool | What it does | Price |
|------|--------------|-------|
| `synthesize_research` | AI research brief with citations | $0.15 |
| `analyze_contract` | Contract risk analysis (PDF/text) | $0.10 |
| `review_code` | Security + quality code review | $0.05 |
| `get_company_profile` | Company data by domain | $0.005 |
| `extract_structured_data` | URL/HTML → clean JSON | $0.004 |
| `get_news_summary` | Summarized news for a topic | $0.003 |
| `get_sentiment` | Stock ticker sentiment score | $0.002 |
| `enrich_email` | Email → person/company details | $0.008 |
| `list_services` | Discover all services + pricing | free |

## Configuration

All optional. The server targets the live API by default.

| Variable | Default | Description |
|----------|---------|-------------|
| `PLATFORM_URL` | `https://agents.aiscale.pro` | Platform API base URL |
| `MCP_PRIVATE_KEY` | *(empty)* | Wallet private key (0x...) with USDC on Base. **Set this to enable paid calls.** |

With payment enabled:
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

## How payments work

Without `MCP_PRIVATE_KEY`, calling a paid tool returns `402 Payment Required` with payment details. To enable automatic payments:

1. **Get USDC on Base** — [bridge.base.org](https://bridge.base.org) (mainnet) or [faucet.circle.com](https://faucet.circle.com/) (testnet)
2. **Set `MCP_PRIVATE_KEY`** — each call signs a unique x402 payment automatically
3. Your key never leaves your machine

You can also use the **`aiscale-pay` CLI** for one-off calls:
```bash
MCP_PRIVATE_KEY=0x... aiscale-pay sentiment AAPL     # $0.002
MCP_PRIVATE_KEY=0x... aiscale-pay company stripe.com  # $0.005
MCP_PRIVATE_KEY=0x... aiscale-pay research "State of AI" --depth deep  # $0.15
```

## Links

- **Live API:** https://agents.aiscale.pro
- **Source:** https://github.com/ry4ever/ai-agent
- **x402 protocol:** https://x402.org

## License

MIT
