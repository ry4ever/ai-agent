import { paymentMiddleware } from '@x402/express';
import { x402ResourceServer, HTTPFacilitatorClient } from '@x402/core/server';
import type { PaywallProvider, PaywallConfig } from '@x402/core/server';
import { createFacilitatorConfig } from '@coinbase/x402';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { bazaarResourceServerExtension } from '@x402/extensions/bazaar';
import type { RequestHandler } from 'express';
import { routeConfigs } from '../config/x402-bazaar-config';
import { logger } from './logger';
import { sec1ToP256Pkcs8Pem } from '../utils/pem';

// Normalise CDP_API_KEY_SECRET once at module load:
//   1. Replace literal \n (Railway env var storage) with real newlines
//   2. Convert SEC1 PEM (BEGIN EC PRIVATE KEY) → PKCS#8 (BEGIN PRIVATE KEY)
//      because jose v6 / importPKCS8 rejects SEC1 format
{
  let key = (process.env.CDP_API_KEY_SECRET || '').replace(/\\n/g, '\n');
  if (key.includes('-----BEGIN EC PRIVATE KEY-----')) {
    key = sec1ToP256Pkcs8Pem(key);
  }
  process.env.CDP_API_KEY_SECRET = key;
}

/**
 * Custom paywall provider that fixes the x402 library's display bug:
 * the library's getDisplayAmount checks for `amount` but the V1 type
 * field is `maxAmountRequired`, so it always falls back to 0 → "$0.00".
 * This provider reads the correct field and formats sub-cent amounts properly.
 */
const aiscalePaywallProvider: PaywallProvider = {
  generateHtml(paymentRequired: Parameters<PaywallProvider['generateHtml']>[0], config?: PaywallConfig): string {
    const firstReq = paymentRequired?.accepts?.[0] as unknown as Record<string, string> | undefined;
    const rawAmount = firstReq?.maxAmountRequired ?? firstReq?.amount ?? '0';
    const usdAmount = parseFloat(rawAmount) / 1e6;
    // Format with enough decimals to show sub-cent amounts (e.g. $0.002)
    const displayAmount = usdAmount < 0.01
      ? usdAmount.toFixed(4).replace(/0+$/, '')
      : usdAmount.toFixed(2);
    const appName = config?.appName ?? 'AiScale Agent Services';
    const testnet = config?.testnet !== false;
    const network = testnet ? 'Base Sepolia (testnet)' : 'Base Mainnet';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Required — ${appName}</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0a0a0a; color: #e5e5e5; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 12px; padding: 2rem; max-width: 420px; width: 90%; text-align: center; }
    h1 { font-size: 1.4rem; margin: 0 0 0.5rem; }
    .amount { font-size: 2.5rem; font-weight: 700; color: #60a5fa; margin: 1rem 0; }
    .token { font-size: 1rem; color: #9ca3af; }
    p { color: #9ca3af; font-size: 0.9rem; line-height: 1.5; }
    .network { display: inline-block; background: #2a2a2a; border-radius: 6px; padding: 0.25rem 0.75rem; font-size: 0.8rem; margin-top: 1rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Payment Required</h1>
    <div class="amount">$${displayAmount}</div>
    <div class="token">USDC</div>
    <p>This endpoint requires a micropayment via the <strong>x402</strong> protocol.<br>
       Send your request with a valid <code>X-PAYMENT</code> header.</p>
    <div class="network">${network}</div>
  </div>
</body>
</html>`;
  },
};

// --- Singleton resource server ---

let _resourceServer: x402ResourceServer | null = null;

export function getResourceServer(): x402ResourceServer {
  if (_resourceServer) return _resourceServer;

  // For mainnet use the CDP facilitator with JWT auth (CDP_API_KEY_ID + CDP_API_KEY_SECRET).
  // For testnet use x402.org which requires no auth and supports Base Sepolia.
  const isMainnet = process.env.NETWORK === 'base-mainnet';

  const facilitatorConfig = isMainnet
    ? createFacilitatorConfig(process.env.CDP_API_KEY_ID, process.env.CDP_API_KEY_SECRET)
    : { url: process.env.X402_FACILITATOR_URL ?? 'https://x402.org/facilitator' };

  const facilitatorClient = new HTTPFacilitatorClient(facilitatorConfig);

  _resourceServer = new x402ResourceServer(facilitatorClient)
    .register('eip155:84532', new ExactEvmScheme())  // Base Sepolia (testnet)
    .register('eip155:8453', new ExactEvmScheme());   // Base Mainnet

  _resourceServer.registerExtension(bazaarResourceServerExtension);

  logger.info('x402 resource server initialized', {
    facilitator: facilitatorConfig.url,
    network: process.env.NETWORK ?? 'base-sepolia',
  });

  return _resourceServer;
}

// --- Single paywall middleware covering all routes (from x402-bazaar-config.ts) ---

let _paywall: RequestHandler | null = null;

export function getPaywall(): RequestHandler {
  if (_paywall) return _paywall;
  _paywall = paymentMiddleware(
    routeConfigs,
    getResourceServer(),
    { appName: 'AiScale Agent Services', testnet: process.env.NETWORK !== 'base-mainnet' },
    aiscalePaywallProvider,
  ) as RequestHandler;
  return _paywall;
}
