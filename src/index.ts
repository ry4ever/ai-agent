/**
 * Contra Jobs — Express Server
 *
 * Standalone HTTP API for Contra.com job search and application.
 * Designed for GLM-5 (Zhipu AI) to call as function tools.
 *
 * Usage:
 *   npm run dev           — Start dev server with hot reload
 *   npm start             — Start production server
 *   npm run contra:dry    — Run CLI autonomous agent (dry run)
 *   npm run contra        — Run CLI autonomous agent (live)
 *
 * Endpoints:
 *   GET  /health                        — Health check
 *   GET  /api/v1/contra/schemas         — GLM-5 function schemas
 *   POST /api/v1/contra/search          — Search jobs
 *   GET  /api/v1/contra/jobs/:id        — Get job details
 *   POST /api/v1/contra/apply           — Apply to a job
 *   GET  /api/v1/contra/applications    — List applications
 *   POST /api/v1/contra/auto-apply      — Full autonomous loop
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { requestLogger, logger } from './middleware/logger';
import { contraRouter } from './routes/contra';
import { closeBrowser } from './services/contra/browser';

const app = express();
const PORT = parseInt(process.env.PORT ?? '3000', 10);

app.use(helmet());
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'] }));
app.use(express.json({ limit: '5mb' }));
app.use(requestLogger);

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'contra-jobs',
    contra_configured: !!(process.env.CONTRA_EMAIL && process.env.CONTRA_PASSWORD),
    glm5_configured: !!process.env.GLM5_API_KEY,
  });
});

// Contra job routes
app.use('/api/v1/contra', contraRouter);

// Error handler
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    logger.error('Unhandled error', { err: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
);

// Graceful shutdown
async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received — shutting down`);
  await closeBrowser();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

app.listen(PORT, () => {
  logger.info(`Contra Jobs server listening on port ${PORT}`, {
    env: process.env.NODE_ENV ?? 'development',
    contra: process.env.CONTRA_EMAIL ? 'configured' : 'NOT CONFIGURED',
    glm5: process.env.GLM5_API_KEY ? 'configured' : 'NOT CONFIGURED',
  });
});
