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
| `MCP_AGENT_ADDRESS` | `0x000…0000` | Your wallet (identifies the payer) |
| `MCP_PAYMENT_HEADER` | *(empty)* | Base64 x402 payment proof. Leave empty to explore for free — paid routes return payment instructions |

## How payments work

Without a payment header, calling a paid tool returns `402 Payment Required` with exact payment details. To make paid calls, set `MCP_PAYMENT_HEADER` to a valid x402 proof and `MCP_AGENT_ADDRESS` to your wallet. Get test USDC at the [Circle faucet](https://faucet.circle.com/) (Base Sepolia) or use real USDC on Base mainnet.

## Links

- **Live API:** https://agents.aiscale.pro
- **Source:** https://github.com/ry4ever/ai-agent
- **x402 protocol:** https://x402.org

## License

MIT
