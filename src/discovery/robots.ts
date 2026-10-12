import { Request, Response } from 'express';

const AGENT_BASE = process.env.AGENT_URL ?? 'https://agents.aiscale.pro';

/**
 * Static robots.txt. Observed crawlers (152.233.30.101 on 2026-10-11) hit this
 * before any API calls. Keeping it polite and surfacing the x402 discovery
 * endpoint helps compliant indexers find the resource catalogue.
 */
export function robotsHandler(_req: Request, res: Response): void {
  res.type('text/plain; charset=utf-8').send(
    `User-agent: *
Allow: /

# x402 payment-required API server. Resource discovery:
#   ${AGENT_BASE}/.well-known/x402
#   ${AGENT_BASE}/.well-known/agent.json
#   ${AGENT_BASE}/openapi.json
#   ${AGENT_BASE}/llms.txt
Sitemap: ${AGENT_BASE}/.well-known/x402
`,
  );
}
