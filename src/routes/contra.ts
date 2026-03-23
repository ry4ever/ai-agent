/**
 * Contra.com REST API Routes
 *
 * Exposes Contra job search and application functionality as HTTP endpoints.
 * Designed for GLM-5 (and any OpenAI-compatible LLM) to call via function calling.
 *
 * Endpoints:
 *   GET  /api/v1/contra/schemas          — OpenAI-compatible function schemas for GLM-5
 *   POST /api/v1/contra/search           — Search for jobs
 *   GET  /api/v1/contra/jobs/:id         — Get job details
 *   POST /api/v1/contra/apply            — Apply to a job
 *   GET  /api/v1/contra/applications     — List submitted applications
 *   POST /api/v1/contra/auto-apply       — Run full autonomous apply loop
 *   GET  /api/v1/contra/health           — Check Contra service health
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { searchJobs, getJobDetails } from '../services/contra/search';
import { applyToJob, getMyApplications } from '../services/contra/apply';
import { runAutoApply } from '../services/contra/index';
import { getGLM5FunctionSchemas } from '../services/contra/glm5-client';
import { logger } from '../middleware/logger';

export const contraRouter = Router();

const PLATFORM_URL = process.env.PLATFORM_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const SearchSchema = z.object({
  keywords: z.string().optional(),
  skills: z.array(z.string()).optional(),
  budgetMin: z.number().optional(),
  budgetMax: z.number().optional(),
  jobType: z.enum(['hourly', 'fixed']).optional(),
  limit: z.number().min(1).max(50).default(10),
  category: z.enum(['software', 'ai-ml', 'data-science', 'all']).optional(),
});

const ApplySchema = z.object({
  jobId: z.string().min(1),
  coverLetter: z.string().min(50).max(5000),
});

const AutoApplySchema = z.object({
  keywords: z.string().optional(),
  maxApplications: z.number().min(1).max(20).default(5),
  minFitScore: z.number().min(0).max(100).default(65),
  dryRun: z.boolean().default(false),
});

// ---------------------------------------------------------------------------
// Helper to check if Contra credentials are configured
// ---------------------------------------------------------------------------
function checkContraConfig(res: Response): boolean {
  // Allow either Contra credentials OR Browserbase/CDP mode
  const hasContraCreds = !!(process.env.CONTRA_EMAIL && process.env.CONTRA_PASSWORD);
  const hasBrowserbase = !!(process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID);
  const cdpMode = process.env.CONTRA_EMAIL === 'cdp-user';
  
  if (!hasContraCreds && !hasBrowserbase && !cdpMode) {
    res.status(503).json({
      error: 'Contra credentials not configured',
      details: 'Set CONTRA_EMAIL and CONTRA_PASSWORD, or BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID',
    });
    return false;
  }
  return true;
}

function checkGLM5Config(res: Response): boolean {
  if (!process.env.GLM5_API_KEY) {
    res.status(503).json({
      error: 'GLM-5 API key not configured',
      details: 'Set GLM5_API_KEY environment variable',
    });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// GET /api/v1/contra/schemas
// Returns OpenAI-compatible function schemas for GLM-5 to use
// ---------------------------------------------------------------------------
contraRouter.get('/schemas', (_req: Request, res: Response) => {
  const schemas = getGLM5FunctionSchemas(PLATFORM_URL);
  res.json({
    description: 'OpenAI-compatible function schemas for Contra.com job search tools',
    model_compatibility: ['GLM-4', 'GLM-4-Plus', 'GPT-4', 'Claude'],
    usage: {
      note: 'Pass these schemas to your LLM as the `tools` parameter in the chat completions API',
      api_base: PLATFORM_URL,
      authentication: 'No auth required for local use; add X-API-Key header if deployed publicly',
    },
    tools: schemas,
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/contra/health
// ---------------------------------------------------------------------------
contraRouter.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    contra_configured: !!(process.env.CONTRA_EMAIL && process.env.CONTRA_PASSWORD),
    glm5_configured: !!process.env.GLM5_API_KEY,
    user_profile: {
      name: process.env.USER_NAME ?? '(not set)',
      skills: (process.env.USER_SKILLS ?? '').split(',').filter(Boolean).length,
    },
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/contra/search
// ---------------------------------------------------------------------------
contraRouter.post('/search', async (req: Request, res: Response) => {
  if (!checkContraConfig(res)) return;

  const parse = SearchSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid request', details: parse.error.errors });
    return;
  }

  try {
    logger.info('[Route] contra/search', { filters: parse.data });
    const jobs = await searchJobs(parse.data);
    res.json({
      count: jobs.length,
      jobs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('[Route] contra/search failed', { message });
    res.status(502).json({ error: 'Search failed', details: message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/v1/contra/jobs/:id
// ---------------------------------------------------------------------------
contraRouter.get('/jobs/:id', async (req: Request, res: Response) => {
  if (!checkContraConfig(res)) return;

  const jobId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!jobId) {
    res.status(400).json({ error: 'Job ID is required' });
    return;
  }

  try {
    logger.info('[Route] contra/jobs/:id', { jobId });
    const job = await getJobDetails(jobId);
    res.json(job);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('[Route] contra/jobs/:id failed', { jobId, message });
    res.status(502).json({ error: 'Failed to fetch job details', details: message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/contra/apply
// ---------------------------------------------------------------------------
contraRouter.post('/apply', async (req: Request, res: Response) => {
  if (!checkContraConfig(res)) return;

  const parse = ApplySchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid request', details: parse.error.errors });
    return;
  }

  const { jobId, coverLetter } = parse.data;

  try {
    logger.info('[Route] contra/apply', { jobId });
    const result = await applyToJob(jobId, coverLetter);

    if (!result.success) {
      res.status(422).json({ error: 'Application failed', details: result.message, result });
      return;
    }

    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('[Route] contra/apply failed', { jobId, message });
    res.status(502).json({ error: 'Application failed', details: message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/v1/contra/applications
// ---------------------------------------------------------------------------
contraRouter.get('/applications', async (_req: Request, res: Response) => {
  if (!checkContraConfig(res)) return;

  try {
    logger.info('[Route] contra/applications');
    const applications = await getMyApplications();
    res.json({
      count: applications.length,
      applications,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('[Route] contra/applications failed', { message });
    res.status(502).json({ error: 'Failed to fetch applications', details: message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/contra/auto-apply
// ---------------------------------------------------------------------------
contraRouter.post('/auto-apply', async (req: Request, res: Response) => {
  if (!checkContraConfig(res)) return;
  if (!checkGLM5Config(res)) return;

  const parse = AutoApplySchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid request', details: parse.error.errors });
    return;
  }

  try {
    logger.info('[Route] contra/auto-apply', { options: parse.data });
    const summary = await runAutoApply(parse.data);
    res.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('[Route] contra/auto-apply failed', { message });
    res.status(502).json({ error: 'Auto-apply loop failed', details: message });
  }
});
