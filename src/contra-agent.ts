/**
 * Contra.com Autonomous Job Search Agent
 *
 * Standalone script that runs the full job search and application loop.
 * Can be executed directly or scheduled via cron.
 *
 * Usage:
 *   ts-node src/contra-agent.ts
 *   ts-node src/contra-agent.ts --keywords "TypeScript AI" --max 3 --dry-run
 *
 * Environment variables (see .env.example for full list):
 *   CONTRA_EMAIL          — Contra.com Pro account email
 *   CONTRA_PASSWORD       — Contra.com Pro account password
 *   GLM5_API_KEY          — Zhipu AI API key for GLM-5
 *   USER_NAME             — Your name (for cover letters)
 *   USER_SKILLS           — Comma-separated skills
 *   USER_BIO              — Brief professional bio
 *   USER_HOURLY_RATE      — Your hourly rate (for proposals)
 *   JOB_SEARCH_KEYWORDS   — Default search keywords
 *   JOB_MIN_BUDGET        — Minimum job budget
 *   JOB_MAX_APPLICATIONS_PER_RUN — Max applications per run (safety limit)
 */

import 'dotenv/config';
import { runAutoApply } from './services/contra/index';
import { closeBrowser } from './services/contra/browser';
import { logger } from './middleware/logger';

// ---------------------------------------------------------------------------
// Parse CLI arguments
// ---------------------------------------------------------------------------
function parseArgs(): {
  keywords?: string;
  maxApplications: number;
  minFitScore: number;
  dryRun: boolean;
} {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : undefined;
  };

  return {
    keywords: get('--keywords') ?? process.env.JOB_SEARCH_KEYWORDS,
    maxApplications: parseInt(get('--max') ?? process.env.JOB_MAX_APPLICATIONS_PER_RUN ?? '5'),
    minFitScore: parseInt(get('--min-score') ?? '65'),
    dryRun: args.includes('--dry-run'),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const opts = parseArgs();

  logger.info('=== Contra.com Job Search Agent Starting ===', {
    keywords: opts.keywords ?? '(default)',
    maxApplications: opts.maxApplications,
    minFitScore: opts.minFitScore,
    dryRun: opts.dryRun,
  });

  // Validate required config
  if (!process.env.CONTRA_EMAIL || !process.env.CONTRA_PASSWORD) {
    logger.error('CONTRA_EMAIL and CONTRA_PASSWORD are required. Set them in .env');
    process.exit(1);
  }
  if (!process.env.GLM5_API_KEY) {
    logger.error('GLM5_API_KEY is required for job evaluation and cover letter generation. Set it in .env');
    process.exit(1);
  }

  try {
    const summary = await runAutoApply(opts);

    // Print results
    console.log('\n========== AUTO-APPLY SUMMARY ==========');
    console.log(`Jobs Found:     ${summary.jobsFound}`);
    console.log(`Jobs Evaluated: ${summary.jobsEvaluated}`);
    console.log(`Jobs Applied:   ${summary.jobsApplied}`);
    console.log(`Jobs Skipped:   ${summary.jobsSkipped}`);
    console.log(`Mode:           ${opts.dryRun ? 'DRY RUN (no actual applications sent)' : 'LIVE'}`);

    if (summary.applications.length > 0) {
      console.log('\nApplications:');
      for (const app of summary.applications) {
        const status = app.success ? '✓' : '✗';
        console.log(`  ${status} ${app.jobId}: ${app.message}`);
      }
    }

    if (summary.errors.length > 0) {
      console.log('\nErrors:');
      for (const err of summary.errors) {
        console.log(`  ! ${err}`);
      }
    }

    console.log('=========================================\n');
    process.exit(0);
  } catch (err) {
    logger.error('Agent crashed', { err });
    process.exit(1);
  } finally {
    await closeBrowser();
  }
}

main();
