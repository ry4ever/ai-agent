/**
 * Contra.com Service Orchestrator
 *
 * Ties together search, evaluation, cover letter generation, and application
 * into a single autonomous loop. This is the core engine used by the
 * auto-apply REST endpoint and the standalone contra-agent script.
 *
 * Flow:
 *   1. Search Contra.com for jobs matching filters
 *   2. Evaluate each job's fit score via GLM-5
 *   3. Generate a tailored cover letter for high-fit jobs
 *   4. Apply to the job on Contra.com
 *   5. Return a summary of all actions
 */

import { searchJobs, getJobDetails } from './search';
import { applyToJob } from './apply';
import { evaluateJobFit, generateCoverLetter } from './glm5-client';
import { AutoApplyOptions, AutoApplySummary, ContraJob, UserProfile } from './types';
import { logger } from '../../middleware/logger';

/**
 * Build the user profile from environment variables.
 * These are used for cover letter generation and job fit evaluation.
 */
export function getUserProfile(): UserProfile {
  const skillsRaw = process.env.USER_SKILLS ?? 'TypeScript,Python,Node.js';
  return {
    name: process.env.USER_NAME ?? 'Freelancer',
    skills: skillsRaw.split(',').map((s) => s.trim()).filter(Boolean),
    bio: process.env.USER_BIO ?? 'Experienced software engineer specializing in modern web and AI technologies.',
    hourlyRate: process.env.USER_HOURLY_RATE ? parseFloat(process.env.USER_HOURLY_RATE) : undefined,
    portfolioUrl: process.env.USER_PORTFOLIO_URL,
  };
}

/**
 * Run the full autonomous job search and application loop.
 *
 * @param options - Search filters and safety limits
 * @returns Summary of what was found and applied to
 */
export async function runAutoApply(options: AutoApplyOptions = {}): Promise<AutoApplySummary> {
  const maxApplications = options.maxApplications ?? parseInt(process.env.JOB_MAX_APPLICATIONS_PER_RUN ?? '5');
  const minFitScore = options.minFitScore ?? 65;
  const dryRun = options.dryRun ?? false;
  const keywords = options.keywords ?? process.env.JOB_SEARCH_KEYWORDS ?? 'software engineer AI';

  const summary: AutoApplySummary = {
    jobsFound: 0,
    jobsEvaluated: 0,
    jobsApplied: 0,
    jobsSkipped: 0,
    applications: [],
    errors: [],
  };

  logger.info('[Contra] Starting auto-apply loop', {
    keywords,
    maxApplications,
    minFitScore,
    dryRun,
  });

  try {
    // Step 1: Search for jobs
    const jobs = await searchJobs({
      keywords,
      limit: maxApplications * 3, // Fetch 3x so we have options after filtering
    });

    summary.jobsFound = jobs.length;
    logger.info(`[Contra] Found ${jobs.length} jobs to evaluate`);

    if (jobs.length === 0) {
      summary.errors.push('No jobs found matching the search criteria');
      return summary;
    }

    const profile = getUserProfile();
    let applied = 0;

    // Step 2: Evaluate and apply to each job
    for (const job of jobs) {
      if (applied >= maxApplications) {
        logger.info('[Contra] Reached max applications limit', { maxApplications });
        break;
      }

      try {
        // Fetch full job details if description is short
        let fullJob: ContraJob = job;
        if (job.description.length < 100 && job.url) {
          try {
            fullJob = await getJobDetails(job.url);
          } catch {
            // Use partial data if full fetch fails
          }
        }

        // Step 3: Evaluate fit score via GLM-5
        logger.info(`[Contra] Evaluating job fit: ${fullJob.title}`, { jobId: fullJob.id });
        const evaluation = await evaluateJobFit(fullJob, profile);
        summary.jobsEvaluated++;

        logger.info(`[Contra] Job fit score: ${evaluation.fitScore}/100`, {
          jobId: fullJob.id,
          shouldApply: evaluation.shouldApply,
          reasoning: evaluation.reasoning,
        });

        if (!evaluation.shouldApply || evaluation.fitScore < minFitScore) {
          summary.jobsSkipped++;
          logger.info(`[Contra] Skipping job (score too low)`, {
            jobId: fullJob.id,
            fitScore: evaluation.fitScore,
            threshold: minFitScore,
          });
          continue;
        }

        // Step 4: Generate cover letter via GLM-5
        logger.info(`[Contra] Generating cover letter for: ${fullJob.title}`);
        const coverLetter = await generateCoverLetter(fullJob, profile);

        // Step 5: Apply (unless dry run)
        if (dryRun) {
          logger.info(`[Contra] [DRY RUN] Would apply to: ${fullJob.title}`, {
            jobId: fullJob.id,
            fitScore: evaluation.fitScore,
          });
          summary.applications.push({
            success: true,
            jobId: fullJob.id,
            message: `[DRY RUN] Would apply — fit score: ${evaluation.fitScore}/100`,
          });
          applied++;
          continue;
        }

        logger.info(`[Contra] Applying to: ${fullJob.title}`, { jobId: fullJob.id });
        const result = await applyToJob(fullJob.id, coverLetter);
        summary.applications.push(result);

        if (result.success) {
          applied++;
          summary.jobsApplied++;
          logger.info(`[Contra] Successfully applied to: ${fullJob.title}`, {
            jobId: fullJob.id,
            applicationId: result.applicationId,
          });
        } else {
          summary.errors.push(`Failed to apply to ${fullJob.title}: ${result.message}`);
        }

        // Polite delay between applications
        await delay(3000 + Math.random() * 2000);

      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('[Contra] Error processing job', { jobId: job.id, message });
        summary.errors.push(`Error on job ${job.id}: ${message}`);
      }
    }

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('[Contra] Auto-apply loop failed', { message });
    summary.errors.push(`Auto-apply loop failed: ${message}`);
  }

  logger.info('[Contra] Auto-apply loop complete', summary);
  return summary;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
