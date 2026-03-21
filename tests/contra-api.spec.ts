/**
 * Playwright tests for the Contra.com Job Search & Apply API
 *
 * These tests cover the REST API layer without requiring real Contra.com
 * credentials or a live GLM-5 key. They verify:
 *   - Route availability and response shapes
 *   - Input validation (400 errors)
 *   - Credential guard (503 when env vars are missing)
 *   - Schema endpoint returns correct function definitions
 *
 * The server is started in-process before the test suite runs.
 */

import { test, expect, APIRequestContext, request } from '@playwright/test';
import { ChildProcess, spawn } from 'child_process';
import { AddressInfo } from 'net';
import http from 'http';
import express from 'express';
import cors from 'cors';
import { contraRouter } from '../src/routes/contra';

// ---------------------------------------------------------------------------
// In-process test server (no DB / wallet / Redis needed)
// ---------------------------------------------------------------------------

let server: http.Server;
let baseURL: string;

test.beforeAll(async () => {
  // Spin up a minimal Express app with only the contra router
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use('/api/v1/contra', contraRouter);

  server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  const port = (server.address() as AddressInfo).port;
  baseURL = `http://127.0.0.1:${port}`;

  // Ensure no Contra / GLM-5 credentials bleed in from the environment
  delete process.env.CONTRA_EMAIL;
  delete process.env.CONTRA_PASSWORD;
  delete process.env.GLM5_API_KEY;
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function api(): Promise<APIRequestContext> {
  return request.newContext({ baseURL });
}

// ---------------------------------------------------------------------------
// GET /api/v1/contra/health
// ---------------------------------------------------------------------------

test('GET /health returns status ok', async () => {
  const ctx = await api();
  const res = await ctx.get('/api/v1/contra/health');
  expect(res.status()).toBe(200);

  const body = await res.json();
  expect(body).toMatchObject({
    status: 'ok',
    contra_configured: false,
    glm5_configured: false,
  });
  expect(body.user_profile).toBeDefined();
});

// ---------------------------------------------------------------------------
// GET /api/v1/contra/schemas
// ---------------------------------------------------------------------------

test('GET /schemas returns GLM-5 function schemas', async () => {
  const ctx = await api();
  const res = await ctx.get('/api/v1/contra/schemas');
  expect(res.status()).toBe(200);

  const body = await res.json();
  expect(body.tools).toBeInstanceOf(Array);
  expect(body.tools.length).toBeGreaterThanOrEqual(5);

  const names = body.tools.map((t: { function: { name: string } }) => t.function.name);
  expect(names).toContain('contra_search_jobs');
  expect(names).toContain('contra_get_job');
  expect(names).toContain('contra_apply_to_job');
  expect(names).toContain('contra_get_applications');
  expect(names).toContain('contra_auto_apply');
});

test('GET /schemas includes model_compatibility list', async () => {
  const ctx = await api();
  const body = await (await ctx.get('/api/v1/contra/schemas')).json();
  expect(body.model_compatibility).toContain('GLM-4');
  expect(body.model_compatibility).toContain('Claude');
});

test('GET /schemas tools have correct structure', async () => {
  const ctx = await api();
  const body = await (await ctx.get('/api/v1/contra/schemas')).json();

  for (const tool of body.tools) {
    expect(tool.type).toBe('function');
    expect(typeof tool.function.name).toBe('string');
    expect(typeof tool.function.description).toBe('string');
    expect(tool.function.parameters).toBeDefined();
    expect(typeof tool.function.endpoint).toBe('string');
    expect(typeof tool.function.method).toBe('string');
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/contra/search — credential guard
// ---------------------------------------------------------------------------

test('POST /search returns 503 when Contra credentials are missing', async () => {
  const ctx = await api();
  const res = await ctx.post('/api/v1/contra/search', {
    data: { keywords: 'TypeScript' },
  });
  expect(res.status()).toBe(503);

  const body = await res.json();
  expect(body.error).toMatch(/contra credentials not configured/i);
});

// ---------------------------------------------------------------------------
// POST /api/v1/contra/search — input validation
// ---------------------------------------------------------------------------

test('POST /search with invalid limit returns 400', async () => {
  // Temporarily set credentials to bypass the credential guard
  process.env.CONTRA_EMAIL = 'test@example.com';
  process.env.CONTRA_PASSWORD = 'test-password';

  try {
    const ctx = await api();
    const res = await ctx.post('/api/v1/contra/search', {
      data: { limit: 999 }, // max is 50
    });
    expect(res.status()).toBe(400);

    const body = await res.json();
    expect(body.error).toMatch(/invalid request/i);
  } finally {
    delete process.env.CONTRA_EMAIL;
    delete process.env.CONTRA_PASSWORD;
  }
});

test('POST /search with invalid jobType returns 400', async () => {
  process.env.CONTRA_EMAIL = 'test@example.com';
  process.env.CONTRA_PASSWORD = 'test-password';

  try {
    const ctx = await api();
    const res = await ctx.post('/api/v1/contra/search', {
      data: { jobType: 'contract' }, // must be 'hourly' or 'fixed'
    });
    expect(res.status()).toBe(400);
  } finally {
    delete process.env.CONTRA_EMAIL;
    delete process.env.CONTRA_PASSWORD;
  }
});

test('POST /search with invalid category returns 400', async () => {
  process.env.CONTRA_EMAIL = 'test@example.com';
  process.env.CONTRA_PASSWORD = 'test-password';

  try {
    const ctx = await api();
    const res = await ctx.post('/api/v1/contra/search', {
      data: { category: 'unknown-category' },
    });
    expect(res.status()).toBe(400);
  } finally {
    delete process.env.CONTRA_EMAIL;
    delete process.env.CONTRA_PASSWORD;
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/contra/apply — credential guard & validation
// ---------------------------------------------------------------------------

test('POST /apply returns 503 when Contra credentials are missing', async () => {
  const ctx = await api();
  const res = await ctx.post('/api/v1/contra/apply', {
    data: { jobId: 'job-123', coverLetter: 'A'.repeat(60) },
  });
  expect(res.status()).toBe(503);
});

test('POST /apply returns 400 when coverLetter is too short', async () => {
  process.env.CONTRA_EMAIL = 'test@example.com';
  process.env.CONTRA_PASSWORD = 'test-password';

  try {
    const ctx = await api();
    const res = await ctx.post('/api/v1/contra/apply', {
      data: { jobId: 'job-123', coverLetter: 'Too short' }, // min 50 chars
    });
    expect(res.status()).toBe(400);

    const body = await res.json();
    expect(body.error).toMatch(/invalid request/i);
  } finally {
    delete process.env.CONTRA_EMAIL;
    delete process.env.CONTRA_PASSWORD;
  }
});

test('POST /apply returns 400 when jobId is empty', async () => {
  process.env.CONTRA_EMAIL = 'test@example.com';
  process.env.CONTRA_PASSWORD = 'test-password';

  try {
    const ctx = await api();
    const res = await ctx.post('/api/v1/contra/apply', {
      data: { jobId: '', coverLetter: 'A'.repeat(60) },
    });
    expect(res.status()).toBe(400);
  } finally {
    delete process.env.CONTRA_EMAIL;
    delete process.env.CONTRA_PASSWORD;
  }
});

// ---------------------------------------------------------------------------
// GET /api/v1/contra/applications — credential guard
// ---------------------------------------------------------------------------

test('GET /applications returns 503 when credentials are missing', async () => {
  const ctx = await api();
  const res = await ctx.get('/api/v1/contra/applications');
  expect(res.status()).toBe(503);
});

// ---------------------------------------------------------------------------
// GET /api/v1/contra/jobs/:id — credential guard
// ---------------------------------------------------------------------------

test('GET /jobs/:id returns 503 when credentials are missing', async () => {
  const ctx = await api();
  const res = await ctx.get('/api/v1/contra/jobs/some-job-id');
  expect(res.status()).toBe(503);
});

// ---------------------------------------------------------------------------
// POST /api/v1/contra/auto-apply — credential & GLM-5 guards
// ---------------------------------------------------------------------------

test('POST /auto-apply returns 503 when Contra credentials are missing', async () => {
  const ctx = await api();
  const res = await ctx.post('/api/v1/contra/auto-apply', {
    data: { dryRun: true },
  });
  expect(res.status()).toBe(503);
  const body = await res.json();
  expect(body.error).toMatch(/contra credentials not configured/i);
});

test('POST /auto-apply returns 503 when GLM-5 key is missing', async () => {
  process.env.CONTRA_EMAIL = 'test@example.com';
  process.env.CONTRA_PASSWORD = 'test-password';
  // GLM5_API_KEY intentionally not set

  try {
    const ctx = await api();
    const res = await ctx.post('/api/v1/contra/auto-apply', {
      data: { dryRun: true },
    });
    expect(res.status()).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/glm-5 api key not configured/i);
  } finally {
    delete process.env.CONTRA_EMAIL;
    delete process.env.CONTRA_PASSWORD;
  }
});

test('POST /auto-apply returns 400 with invalid maxApplications', async () => {
  process.env.CONTRA_EMAIL = 'test@example.com';
  process.env.CONTRA_PASSWORD = 'test-password';
  process.env.GLM5_API_KEY = 'test-key';

  try {
    const ctx = await api();
    const res = await ctx.post('/api/v1/contra/auto-apply', {
      data: { maxApplications: 100 }, // max is 20
    });
    expect(res.status()).toBe(400);
  } finally {
    delete process.env.CONTRA_EMAIL;
    delete process.env.CONTRA_PASSWORD;
    delete process.env.GLM5_API_KEY;
  }
});

test('POST /auto-apply returns 400 with invalid minFitScore', async () => {
  process.env.CONTRA_EMAIL = 'test@example.com';
  process.env.CONTRA_PASSWORD = 'test-password';
  process.env.GLM5_API_KEY = 'test-key';

  try {
    const ctx = await api();
    const res = await ctx.post('/api/v1/contra/auto-apply', {
      data: { minFitScore: 150 }, // max is 100
    });
    expect(res.status()).toBe(400);
  } finally {
    delete process.env.CONTRA_EMAIL;
    delete process.env.CONTRA_PASSWORD;
    delete process.env.GLM5_API_KEY;
  }
});

// ---------------------------------------------------------------------------
// Schema endpoint content validation
// ---------------------------------------------------------------------------

test('contra_search_jobs schema has correct parameter types', async () => {
  const ctx = await api();
  const body = await (await ctx.get('/api/v1/contra/schemas')).json();

  const searchTool = body.tools.find(
    (t: { function: { name: string } }) => t.function.name === 'contra_search_jobs'
  );
  expect(searchTool).toBeDefined();

  const props = searchTool.function.parameters.properties;
  expect(props.keywords.type).toBe('string');
  expect(props.skills.type).toBe('array');
  expect(props.budgetMin.type).toBe('number');
  expect(props.budgetMax.type).toBe('number');
  expect(props.limit.type).toBe('number');
});

test('contra_apply_to_job schema has required fields', async () => {
  const ctx = await api();
  const body = await (await ctx.get('/api/v1/contra/schemas')).json();

  const applyTool = body.tools.find(
    (t: { function: { name: string } }) => t.function.name === 'contra_apply_to_job'
  );
  expect(applyTool).toBeDefined();
  expect(applyTool.function.parameters.required).toContain('jobId');
  expect(applyTool.function.parameters.required).toContain('coverLetter');
});

test('health endpoint reflects user profile skill count', async () => {
  process.env.USER_SKILLS = 'TypeScript,Python,Node.js,React,GraphQL';

  try {
    const ctx = await api();
    const body = await (await ctx.get('/api/v1/contra/health')).json();
    expect(body.user_profile.skills).toBe(5);
  } finally {
    delete process.env.USER_SKILLS;
  }
});
