import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { requestLogger, logger } from './middleware/logger';
import { initRateLimiter, rateLimitByAgent } from './middleware/rate-limiter';
import { getPaywall } from './middleware/x402-paywall';
import { trackRevenue } from './payments/revenue-tracker';
import { initWallet } from './payments/wallet';
import { runMigrations, closePool } from './db/queries';
import { closeRedis } from './utils/redis';

// Route handlers
import { sentimentHandler } from './services/data-api/sentiment';
import { companyHandler } from './services/data-api/company';
import { enrichHandler } from './services/data-api/enrich';
import { newsHandler } from './services/data-api/news';
import { extractHandler } from './services/data-api/extract';
import { contractAnalyzerHandler } from './services/sub-agents/contract-analyzer';
import { codeReviewerHandler } from './services/sub-agents/code-reviewer';
import { researchSynthHandler } from './services/sub-agents/research-synth';
import { registryHandler } from './discovery/registry';
import { agentCardHandler } from './discovery/agent-card';
import { healthHandler } from './discovery/health';
import { landingHandler } from './discovery/landing';
import { PRICING } from './config/pricing';

const app = express();
const PORT = parseInt(process.env.PORT ?? '3000', 10);

// --- Core middleware ---
app.use(helmet());
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'] }));
app.use(express.json({ limit: '10mb' }));
app.use(requestLogger);
app.use(rateLimitByAgent);

// --- Discovery / utility (no paywall) ---
app.get('/', landingHandler);
app.get('/health', healthHandler);
app.get('/.well-known/agent-services', registryHandler);
app.get('/.well-known/agent.json', agentCardHandler);
app.get('/.well-known/agent-card.json', agentCardHandler);

// --- x402 Paywalled Routes ---
// A single paymentMiddleware instance (from x402-bazaar-config.ts) covers all routes.

function mountPaywalledRoutes(): void {
  const paywall = getPaywall();

  // Data API
  app.get('/api/v1/sentiment/:ticker', paywall, trackRevenue('/api/v1/sentiment', PRICING.SENTIMENT), sentimentHandler);
  app.get('/api/v1/company/:domain', paywall, trackRevenue('/api/v1/company', PRICING.COMPANY), companyHandler);
  app.get('/api/v1/enrich/email/:email', paywall, trackRevenue('/api/v1/enrich/email', PRICING.ENRICH), enrichHandler);
  app.get('/api/v1/news/summary', paywall, trackRevenue('/api/v1/news/summary', PRICING.NEWS), newsHandler);
  app.post('/api/v1/extract', paywall, trackRevenue('/api/v1/extract', PRICING.EXTRACT), extractHandler);

  // Sub-agent services
  app.post('/api/v1/analyze/contract', paywall, trackRevenue('/api/v1/analyze/contract', PRICING.CONTRACT_ANALYZER), contractAnalyzerHandler);
  app.post('/api/v1/review/code', paywall, trackRevenue('/api/v1/review/code', PRICING.CODE_REVIEWER), codeReviewerHandler);
  app.post('/api/v1/research', paywall, trackRevenue('/api/v1/research', PRICING.RESEARCH_SYNTH), researchSynthHandler);
}

// --- Startup ---
async function start(): Promise<void> {
  try {
    logger.info('Starting Agent Services Platform...');

    // Run DB migrations
    await runMigrations();
    logger.info('Database migrations complete');

    // Initialize wallet management
    await initWallet();

    // Initialize rate limiter
    initRateLimiter();

    // Mount all paywalled routes
    mountPaywalledRoutes();

    // Error handler must be registered AFTER all routes to catch their errors
    app.use(
      (
        err: Error,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction
      ) => {
        logger.error('Unhandled error', { err: err.message, stack: err.stack });
        res.status(500).json({ error: 'Internal server error' });
      }
    );

    app.listen(PORT, () => {
      logger.info(`Server listening on port ${PORT}`, {
        network: process.env.NETWORK ?? 'base-sepolia',
        wallet: process.env.WALLET_ADDRESS ?? 'NOT SET',
        env: process.env.NODE_ENV ?? 'development',
      });
    });
  } catch (err) {
    logger.error('Startup failed', { err });
    process.exit(1);
  }
}

// --- Graceful shutdown ---
async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received — shutting down gracefully`);
  await Promise.all([closePool(), closeRedis()]);
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start();
