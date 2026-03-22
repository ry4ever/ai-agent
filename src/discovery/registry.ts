import { Request, Response } from 'express';
import { SERVICE_DEFINITIONS } from '../config/services';

export function registryHandler(_req: Request, res: Response): void {
  res.json({
    provider: process.env.PROVIDER_NAME ?? 'AiScale',
    providerUrl: process.env.PROVIDER_URL ?? '',
    x402Version: 1,
    network: process.env.NETWORK ?? 'base-sepolia',
    payTo: process.env.WALLET_ADDRESS ?? '',
    usdcContract: process.env.USDC_CONTRACT ?? '',
    facilitatorUrl: process.env.X402_FACILITATOR_URL ?? 'https://api.cdp.coinbase.com/platform/v2/x402',
    services: SERVICE_DEFINITIONS.map((svc) => ({
      endpoint: svc.endpoint,
      method: svc.method,
      description: svc.description,
      priceUSDC: svc.priceUSDC,
      priceDisplay: svc.priceDisplay,
      category: svc.category,
      responseSchema: svc.responseSchema,
      sla: svc.sla,
      ...(svc.params ? { params: svc.params } : {}),
    })),
    updatedAt: new Date().toISOString(),
  });
}
