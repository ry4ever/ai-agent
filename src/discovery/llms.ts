import { Request, Response } from 'express';
import { SERVICE_DEFINITIONS } from '../config/services';

const AGENT_BASE = process.env.AGENT_URL ?? 'https://agents.aiscale.pro';

/**
 * Serves /llms.txt in the llmstxt.org format — a plain-text catalogue that
 * LLM-powered crawlers can read without a browser or OpenAPI parser.
 *
 * The crawler observed at 2026-10-11T02:30 probed this exact path; returning
 * a structured answer gives it a direct path to the paid resources.
 */
export function llmsHandler(_req: Request, res: Response): void {
  const dataApis = SERVICE_DEFINITIONS.filter((s) => s.category === 'data-api');
  const subAgents = SERVICE_DEFINITIONS.filter((s) => s.category === 'sub-agent');

  const line = (s: (typeof SERVICE_DEFINITIONS)[number]): string =>
    `- [${s.method} ${s.endpoint}](${AGENT_BASE}${s.endpoint}): ${s.priceDisplay} per call — ${s.description}`;

  const body = `# AiScale Agent Services

> Pay-per-call AI APIs secured by x402 micropayments in USDC on Base. No API keys, no accounts, no subscriptions. Agents discover endpoints here, send a normal request, receive a 402 with payment details, sign a USDC transfer, retry, and get JSON back.

## Discovery

- [Resource registry](${AGENT_BASE}/.well-known/x402): machine-readable list of endpoints, prices, and the x402 facilitator.
- [Agent card](${AGENT_BASE}/.well-known/agent.json): A2A-format service description.
- [OpenAPI 3 spec](${AGENT_BASE}/openapi.json): standard OpenAPI document covering every paid endpoint.
- [Service manifest](${AGENT_BASE}/.well-known/agent-services): same payload as /.well-known/x402, legacy path.

## Data APIs
${dataApis.map(line).join('\n')}

## Sub-agent services
${subAgents.map(line).join('\n')}

## Protocol

Payments use x402 (HTTP 402 Payment Required). Clients that speak x402 — including the x402 Bazaar's discovery feed, [@x402/fetch](https://www.npmjs.com/package/@x402/fetch), and MCP-connected agents — can call these endpoints autonomously. For a one-command demo of the full pay-and-retry flow, see \`npx aiscale-pay sentiment AAPL\`.
`;

  res.type('text/plain; charset=utf-8').send(body);
}
