import { Request, Response } from 'express';
import { SERVICE_DEFINITIONS } from '../config/services';

const AGENT_BASE = process.env.AGENT_URL ?? 'https://agents.aiscale.pro';

/**
 * OpenAPI 3.1 spec generated from SERVICE_DEFINITIONS (single source of truth).
 *
 * Standard discovery URL for API-aware crawlers. The crawler at 2026-10-11
 * probed /openapi.json and got 404 — now it gets an OpenAPI document that
 * declares every paid endpoint, including the x402 payment response.
 */
export function openapiHandler(_req: Request, res: Response): void {
  const paths: Record<string, unknown> = {};
  for (const svc of SERVICE_DEFINITIONS) {
    const specPath = svc.endpoint.replace(/:([^/]+)/g, '{$1}');
    const operationId = svc.endpoint
      .replace(/^\/api\/v1\//, '')
      .replace(/\//g, '_')
      .replace(/:/g, '')
      .replace(/_+/g, '_');
    const parameters = svc.params
      ? Object.entries(svc.params).map(([name, description]) => ({
          in: 'path',
          name,
          required: true,
          schema: { type: 'string' },
          description,
        }))
      : [];

    paths[specPath] = {
      [svc.method.toLowerCase()]: {
        operationId,
        summary: svc.description,
        tags: [svc.category],
        parameters,
        responses: {
          '200': {
            description: `Successful response. Price: ${svc.priceDisplay} USDC settled on-chain via x402.`,
            content: {
              'application/json': {
                schema: { type: 'object', additionalProperties: true, example: svc.responseSchema },
              },
            },
          },
          '402': {
            description:
              'Payment Required. The response body is empty; the x402 PaymentRequired payload is base64-encoded in the `payment-required` response header. Clients using @x402/fetch or any x402-aware client will sign and retry automatically.',
          },
          '400': { description: 'Invalid request body (POST endpoints) — rejected before payment settlement.' },
          '502': { description: 'Upstream failure (Anthropic or external data provider). Payment is cancelled, no settlement.' },
        },
      },
    };
  }

  res.json({
    openapi: '3.1.0',
    info: {
      title: 'AiScale Agent Services',
      version: '1.1.0',
      description:
        'Pay-per-call AI APIs secured by x402 micropayments in USDC on Base. See https://agents.aiscale.pro for details.',
      contact: { url: 'https://agents.aiscale.pro' },
      license: { name: 'MIT' },
    },
    servers: [{ url: AGENT_BASE }],
    paths,
    components: {
      securitySchemes: {
        x402: {
          type: 'http',
          scheme: 'x402',
          description:
            'All paid endpoints require an X-PAYMENT header carrying a signed EIP-3009 USDC authorization. See https://www.x402.org and the resource registry at /.well-known/x402.',
        },
      },
    },
    security: [{ x402: [] }],
  });
}
