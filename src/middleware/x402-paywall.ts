import { paymentMiddleware } from '@x402/express';
import { x402ResourceServer, HTTPFacilitatorClient } from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { bazaarResourceServerExtension } from '@x402/extensions/bazaar';
import type { RequestHandler } from 'express';
import { routeConfigs } from '../config/x402-bazaar-config';
import { logger } from './logger';

// --- Singleton resource server ---

let _resourceServer: x402ResourceServer | null = null;

export function getResourceServer(): x402ResourceServer {
  if (_resourceServer) return _resourceServer;

  const facilitatorUrl = process.env.X402_FACILITATOR_URL ?? 'https://x402.org/facilitator';

  const facilitatorClient = new HTTPFacilitatorClient({ url: facilitatorUrl });

  _resourceServer = new x402ResourceServer(facilitatorClient)
    .register('eip155:84532', new ExactEvmScheme())  // Base Sepolia (testnet)
    .register('eip155:8453', new ExactEvmScheme());   // Base Mainnet

  _resourceServer.registerExtension(bazaarResourceServerExtension);

  logger.info('x402 resource server initialized', { facilitator: facilitatorUrl });

  return _resourceServer;
}

// --- Single paywall middleware covering all routes (from x402-bazaar-config.ts) ---

let _paywall: RequestHandler | null = null;

export function getPaywall(): RequestHandler {
  if (_paywall) return _paywall;
  _paywall = paymentMiddleware(routeConfigs, getResourceServer()) as RequestHandler;
  return _paywall;
}
