/**
 * GLM-5 API Client (Zhipu AI)
 *
 * Connects to the Zhipu AI API (OpenAI-compatible) to:
 *   1. Evaluate job fit — score how well a job matches the user profile
 *   2. Generate tailored cover letters for job applications
 *   3. Provide the OpenAI-compatible function schemas for GLM-5 to call
 *
 * Environment variables:
 *   GLM5_API_KEY   — Zhipu AI API key (from open.bigmodel.cn)
 *   GLM5_MODEL     — Model name (default: glm-4)
 *   GLM5_API_BASE  — API base URL (default: https://open.bigmodel.cn/api/paas/v4)
 */

import axios from 'axios';
import { ContraJob, JobFitEvaluation, UserProfile } from './types';
import { logger } from '../../middleware/logger';

const GLM5_API_BASE =
  process.env.GLM5_API_BASE ?? 'https://open.bigmodel.cn/api/paas/v4';
const GLM5_MODEL = process.env.GLM5_MODEL ?? 'glm-4-air';

interface GLM5Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface GLM5Response {
  choices: Array<{
    message: { content: string };
    finish_reason: string;
  }>;
  usage?: { total_tokens: number };
}

/**
 * Call the GLM-5 API with a list of messages.
 */
async function callGLM5(messages: GLM5Message[], temperature = 0.7): Promise<string> {
  const apiKey = process.env.GLM5_API_KEY;
  if (!apiKey) throw new Error('GLM5_API_KEY environment variable is required');

  const response = await axios.post<GLM5Response>(
    `${GLM5_API_BASE}/chat/completions`,
    {
      model: GLM5_MODEL,
      messages,
      temperature,
      max_tokens: 2000,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    }
  );

  const content = response.data.choices[0]?.message?.content ?? '';
  logger.info('[GLM-5] API call successful', {
    model: GLM5_MODEL,
    tokens: response.data.usage?.total_tokens,
  });
  return content;
}

/**
 * Evaluate how well a job fits the user's profile.
 * Returns a score from 0-100 and reasoning.
 */
export async function evaluateJobFit(
  job: ContraJob,
  profile: UserProfile
): Promise<JobFitEvaluation> {
  const systemPrompt = `You are a career advisor helping a freelancer evaluate job opportunities.
Analyze the job and the freelancer's profile, then return a JSON object with:
- fitScore: number 0-100 (how well this job matches the freelancer's skills and goals)
- reasoning: string (brief explanation of the score)
- shouldApply: boolean (true if fitScore >= 60)

Return only valid JSON, no markdown.`;

  const userPrompt = `Freelancer Profile:
Name: ${profile.name}
Skills: ${profile.skills.join(', ')}
Bio: ${profile.bio}
${profile.hourlyRate ? `Desired Rate: $${profile.hourlyRate}/hr` : ''}

Job Posting:
Title: ${job.title}
Description: ${job.description.slice(0, 1000)}
Required Skills: ${job.skills.join(', ')}
Budget: ${job.budgetMin ? `$${job.budgetMin}` : 'Not specified'}${job.budgetMax && job.budgetMax !== job.budgetMin ? ` - $${job.budgetMax}` : ''} ${job.budgetType !== 'unknown' ? `(${job.budgetType})` : ''}
Remote: ${job.isRemote ? 'Yes' : 'No'}
Client: ${job.clientName}

Evaluate the fit and return JSON.`;

  try {
    const raw = await callGLM5(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      0.3
    );

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in GLM-5 response');

    const parsed = JSON.parse(jsonMatch[0]) as {
      fitScore: number;
      reasoning: string;
      shouldApply: boolean;
    };

    return {
      jobId: job.id,
      fitScore: Math.max(0, Math.min(100, parsed.fitScore ?? 0)),
      reasoning: parsed.reasoning ?? '',
      shouldApply: parsed.shouldApply ?? parsed.fitScore >= 60,
    };
  } catch (err) {
    logger.error('[GLM-5] Job fit evaluation failed', { jobId: job.id, err });
    return {
      jobId: job.id,
      fitScore: 0,
      reasoning: 'Evaluation failed',
      shouldApply: false,
    };
  }
}

/**
 * Generate a tailored cover letter for a job application.
 */
export async function generateCoverLetter(
  job: ContraJob,
  profile: UserProfile
): Promise<string> {
  const systemPrompt = `You are an expert freelance proposal writer.
Write compelling, personalized cover letters for freelance job applications.
Guidelines:
- Keep it under 300 words
- Address the client's specific needs mentioned in the job description
- Highlight the most relevant skills from the freelancer's profile
- Be professional but conversational
- End with a clear call to action
- Do NOT use generic phrases like "I am writing to express my interest"
- Do NOT use filler or fluff — every sentence must add value`;

  const userPrompt = `Write a cover letter for this job application:

JOB:
Title: ${job.title}
Description: ${job.description.slice(0, 1200)}
Required Skills: ${job.skills.join(', ')}
Budget: ${job.budgetMin ? `$${job.budgetMin}` : 'Not specified'}${job.budgetMax && job.budgetMax !== job.budgetMin ? `-$${job.budgetMax}` : ''} ${job.budgetType !== 'unknown' ? `(${job.budgetType})` : ''}
Client: ${job.clientName}

FREELANCER:
Name: ${profile.name}
Skills: ${profile.skills.join(', ')}
Bio: ${profile.bio}
${profile.hourlyRate ? `Rate: $${profile.hourlyRate}/hr` : ''}
${profile.portfolioUrl ? `Portfolio: ${profile.portfolioUrl}` : ''}

Write the cover letter (plain text, no markdown):`;

  const coverLetter = await callGLM5(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    0.7
  );

  logger.info('[GLM-5] Cover letter generated', { jobId: job.id, length: coverLetter.length });
  return coverLetter.trim();
}

/**
 * OpenAI-compatible function schemas for GLM-5 to call our REST API.
 * GLM-5 (and other LLMs) can use these to discover and call Contra tools.
 */
export function getGLM5FunctionSchemas(apiBaseUrl: string) {
  return [
    {
      type: 'function',
      function: {
        name: 'contra_search_jobs',
        description:
          'Search for freelance jobs on Contra.com. Returns a list of matching job postings ' +
          'with title, description, required skills, budget, and URL. ' +
          'Specializes in Software Development, AI/ML Engineering, and Data Science roles.',
        parameters: {
          type: 'object',
          properties: {
            keywords: {
              type: 'string',
              description: 'Search keywords (e.g. "TypeScript developer", "machine learning engineer")',
            },
            skills: {
              type: 'array',
              items: { type: 'string' },
              description: 'Required skills to filter by (e.g. ["Python", "TensorFlow"])',
            },
            budgetMin: {
              type: 'number',
              description: 'Minimum budget in USD',
            },
            budgetMax: {
              type: 'number',
              description: 'Maximum budget in USD',
            },
            jobType: {
              type: 'string',
              enum: ['hourly', 'fixed'],
              description: 'Job payment type',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of jobs to return (default: 10)',
              default: 10,
            },
          },
        },
        endpoint: `${apiBaseUrl}/api/v1/contra/search`,
        method: 'POST',
      },
    },
    {
      type: 'function',
      function: {
        name: 'contra_get_job',
        description: 'Get full details for a specific Contra.com job posting by its ID or URL.',
        parameters: {
          type: 'object',
          properties: {
            jobId: {
              type: 'string',
              description: 'Job ID or full Contra.com job URL',
            },
          },
          required: ['jobId'],
        },
        endpoint: `${apiBaseUrl}/api/v1/contra/jobs/{jobId}`,
        method: 'GET',
      },
    },
    {
      type: 'function',
      function: {
        name: 'contra_apply_to_job',
        description:
          'Apply to a job on Contra.com with a cover letter. ' +
          'Submits the application via the Contra Pro account. ' +
          'Use contra_search_jobs first to find suitable jobs, then apply to the best matches.',
        parameters: {
          type: 'object',
          properties: {
            jobId: {
              type: 'string',
              description: 'Job ID or full Contra.com job URL',
            },
            coverLetter: {
              type: 'string',
              description: 'Cover letter / proposal text to submit (200-500 words recommended)',
            },
          },
          required: ['jobId', 'coverLetter'],
        },
        endpoint: `${apiBaseUrl}/api/v1/contra/apply`,
        method: 'POST',
      },
    },
    {
      type: 'function',
      function: {
        name: 'contra_get_applications',
        description: 'Get a list of all submitted job applications and their current status.',
        parameters: {
          type: 'object',
          properties: {},
        },
        endpoint: `${apiBaseUrl}/api/v1/contra/applications`,
        method: 'GET',
      },
    },
    {
      type: 'function',
      function: {
        name: 'contra_auto_apply',
        description:
          'Run a fully autonomous job search and application loop. ' +
          'Searches for jobs, evaluates fit using AI, generates cover letters, and applies automatically. ' +
          'Returns a summary of all actions taken.',
        parameters: {
          type: 'object',
          properties: {
            keywords: {
              type: 'string',
              description: 'Search keywords to target specific job types',
            },
            maxApplications: {
              type: 'number',
              description: 'Maximum number of applications to submit (default: 5)',
              default: 5,
            },
            minFitScore: {
              type: 'number',
              description: 'Minimum AI-evaluated fit score (0-100) required to apply (default: 65)',
              default: 65,
            },
            dryRun: {
              type: 'boolean',
              description: 'If true, search and evaluate jobs but do not actually apply (default: false)',
              default: false,
            },
          },
        },
        endpoint: `${apiBaseUrl}/api/v1/contra/auto-apply`,
        method: 'POST',
      },
    },
  ];
}
