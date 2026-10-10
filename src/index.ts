import 'dotenv/config';
import express from 'express';
import { Server } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import { requestLogger, logger } from './middleware/logger';
import { initRateLimiter, rateLimitByAgent } from './middleware/rate-limiter';
import { getPaywall } from './middleware/x402-paywall';
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
import { statsHandler } from './discovery/stats';
import { transactionsHandler } from './discovery/transactions';
import { landingHandler } from './discovery/landing';
import { requireAdmin } from './middleware/admin-auth';
import { validateBody } from './middleware/validate-body';
import { mcpHttpHandler } from './mcp/http-server';
import { ExtractRequestSchema } from './services/data-api/extract';
import { ContractRequestSchema } from './services/sub-agents/contract-analyzer';
import { CodeReviewRequestSchema } from './services/sub-agents/code-reviewer';
import { ResearchRequestSchema } from './services/sub-agents/research-synth';

const app = express();
const PORT = parseInt(process.env.PORT ?? '3000', 10);

// Trust proxy so req.ip reflects the real client IP behind Railway / load balancers
app.set('trust proxy', 1);

// --- Core middleware ---
// Helmet with permissive CSP for the inline-styled landing + paywall HTML pages
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
    },
  },
}));
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'] }));
app.use(express.json({ limit: '10mb' }));
app.use(requestLogger);
app.use(rateLimitByAgent);

// --- Discovery / utility (no paywall) ---
app.get('/', landingHandler);
app.get('/health', healthHandler);
app.get('/stats', requireAdmin, statsHandler);
app.get('/stats/transactions', requireAdmin, transactionsHandler);
app.get('/.well-known/agent-services', registryHandler);
app.get('/.well-known/agent.json', agentCardHandler);
app.get('/.well-known/agent-card.json', agentCardHandler);

// --- MCP Streamable HTTP endpoint ---
// Smithery and remote MCP clients connect here. Tool calls route to the
// paywalled API endpoints internally — payment is handled per-call.
app.post('/mcp', mcpHttpHandler());
app.get('/mcp', mcpHttpHandler()); // SSE stream for server-initiated notifications
app.delete('/mcp', mcpHttpHandler()); // session termination

// --- x402 Paywalled Routes ---
// A single paymentMiddleware instance (from x402-bazaar-config.ts) covers all routes.

function mountPaywalledRoutes(): void {
  const paywall = getPaywall();

  // Revenue is recorded by the x402 resource server's AfterSettleHook
  // (see src/middleware/x402-paywall.ts), so no per-route tracking middleware
  // is needed here — the hook only fires on successful settlement, so
  // cancelled payments on 4xx/5xx no longer leave ghost DB rows.

  // Data API
  app.get('/api/v1/sentiment/:ticker', paywall, sentimentHandler);
  app.get('/api/v1/company/:domain', paywall, companyHandler);
  app.get('/api/v1/enrich/email/:email', paywall, enrichHandler);
  app.get('/api/v1/news/summary', paywall, newsHandler);
  // POST routes validate the body BEFORE the paywall. A bad body short-
  // circuits with 400 before any x402 verification runs — avoiding a
  // facilitator round-trip plus the verify-then-cancel cycle entirely.
  app.post('/api/v1/extract', validateBody(ExtractRequestSchema), paywall, extractHandler);

  // Sub-agent services
  app.post('/api/v1/analyze/contract', validateBody(ContractRequestSchema), paywall, contractAnalyzerHandler);
  app.post('/api/v1/review/code', validateBody(CodeReviewRequestSchema), paywall, codeReviewerHandler);
  app.post('/api/v1/research', validateBody(ResearchRequestSchema), paywall, researchSynthHandler);
}

// --- Startup ---
let server: Server | null = null;

async function start(): Promise<void> {
  try {
    logger.info('Starting Agent Services Platform...');

    // Pre-flight: critical env vars.
    // Without WALLET_ADDRESS, every paywalled route advertises an empty payTo
    // (getPayTo in x402-bazaar-config) and cannot route x402 payments — a silent
    // failure best caught at boot rather than as malformed 402s in production.
    const missing: string[] = [];
    if (!process.env.DATABASE_URL) missing.push('DATABASE_URL');
    if (!process.env.WALLET_ADDRESS) missing.push('WALLET_ADDRESS');

    if (missing.length > 0) {
      const hints: Record<string, string> = {
        DATABASE_URL: 'Add a PostgreSQL service on Railway and ensure DATABASE_URL is set.',
        WALLET_ADDRESS: 'Set WALLET_ADDRESS to the USDC (Base) address that should receive x402 payments.',
      };
      const detail = missing.map((m) => `  • ${m}: ${hints[m] ?? ''}`).join('\n');
      const msg = `Missing required environment variables:\n${detail}`;
      logger.error('Configuration error', { missing, detail: msg });
      console.error(`[FATAL] ${msg}`);
      process.exit(1);
    }

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

    server = app.listen(PORT, () => {
      logger.info(`Server listening on port ${PORT}`, {
        network: process.env.NETWORK ?? 'base-sepolia',
        wallet: process.env.WALLET_ADDRESS ?? 'NOT SET',
        env: process.env.NODE_ENV ?? 'development',
      });
    });
  } catch (err) {
    // Extract a human-readable message — winston swallows Error.message
    // when passed as a nested { err } property, and pg AggregateError has
    // an empty .message with the real info in .code, so flatten everything.
    const errMsg = err instanceof Error
      ? (err.message || (err as NodeJS.ErrnoException).code || err.constructor.name)
      : String(err);
    const errStack = err instanceof Error ? err.stack : undefined;
    logger.error(`Startup failed: ${errMsg}`, { stack: errStack });
    console.error('[FATAL] Startup failed:', errMsg);
    if (errStack) console.error(errStack);
    process.exit(1);
  }
}

// --- Graceful shutdown ---
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received — shutting down gracefully`);

  // Stop accepting new connections and drain in-flight requests
  if (server) {
    await new Promise<void>((resolve) => {
      server!.close(() => resolve());
    });
    logger.info('HTTP server closed — all requests drained');
  }

  await Promise.all([closePool(), closeRedis()]);
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// --- Global crash handlers ---
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason: String(reason) });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { err: err.message, stack: err.stack });
  // Give the process a moment to flush logs, then exit — the container
  // orchestrator (Railway / Docker / k8s) will restart it.
  shutdown('uncaughtException');
});

start();
