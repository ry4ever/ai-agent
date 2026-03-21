/**
 * Contra.com Job Application
 *
 * Handles submitting proposals/applications to jobs on Contra.com Pro.
 * Uses Playwright to fill out and submit the application form.
 *
 * Pro subscription allows unlimited applications per month.
 */

import { ensureLoggedIn } from './auth';
import { Application, ApplicationResult } from './types';
import { logger } from '../../middleware/logger';

const CONTRA_BASE = 'https://contra.com';

/**
 * Apply to a job on Contra.com.
 *
 * @param jobId   - The job's ID or full URL
 * @param coverLetter - The cover letter / proposal text to submit
 */
export async function applyToJob(
  jobId: string,
  coverLetter: string
): Promise<ApplicationResult> {
  const page = await ensureLoggedIn();

  const jobUrl = jobId.startsWith('http')
    ? jobId
    : `${CONTRA_BASE}/opportunity/${jobId}`;

  try {
    logger.info('[Contra] Navigating to job page for application', { jobUrl });
    await page.goto(jobUrl, { waitUntil: 'networkidle', timeout: 30000 });

    // Click the "Apply" / "Submit Proposal" button
    const applyBtn = await page.$(
      'button:has-text("Apply"), button:has-text("Submit Proposal"), ' +
      'button:has-text("Propose"), a:has-text("Apply Now"), ' +
      '[data-testid="apply-button"]'
    );

    if (!applyBtn) {
      logger.warn('[Contra] Apply button not found — job may be closed or already applied');
      return {
        success: false,
        jobId,
        message: 'Apply button not found — job may be closed, already applied, or page structure changed',
      };
    }

    await applyBtn.click();
    await page.waitForTimeout(2000);

    // Look for cover letter / proposal textarea
    const textareaSelector =
      'textarea[name*="cover"], textarea[name*="proposal"], textarea[name*="message"], ' +
      'textarea[placeholder*="cover" i], textarea[placeholder*="proposal" i], ' +
      'textarea[placeholder*="tell" i], [contenteditable="true"][class*="editor" i], ' +
      'textarea:first-of-type';

    await page.waitForSelector(textareaSelector, { timeout: 10000 });
    await page.fill(textareaSelector, coverLetter);

    // Handle rate/budget fields if present
    const rateInput = await page.$('input[name*="rate"], input[name*="budget"], input[placeholder*="rate" i]');
    if (rateInput) {
      const userRate = process.env.USER_HOURLY_RATE ?? '150';
      await rateInput.fill(userRate);
    }

    // Submit the application
    const submitBtn = await page.$(
      'button[type="submit"]:has-text("Submit"), ' +
      'button:has-text("Send Proposal"), button:has-text("Apply"), ' +
      'button:has-text("Send Application"), [data-testid="submit-application"]'
    );

    if (!submitBtn) {
      throw new Error('Submit button not found after opening application form');
    }

    await submitBtn.click();

    // Wait for confirmation
    await page.waitForTimeout(3000);
    const confirmationEl = await page.$(
      '[class*="success" i], [class*="confirm" i], [data-testid*="success"], ' +
      '.toast-success, [role="alert"][class*="success" i]'
    );

    const applicationId = `app_${Date.now()}`;
    const appliedAt = new Date().toISOString();

    if (confirmationEl) {
      const confirmText = await confirmationEl.textContent();
      logger.info('[Contra] Application submitted successfully', { jobId, applicationId });
      return {
        success: true,
        jobId,
        applicationId,
        message: confirmText?.trim() ?? 'Application submitted successfully',
        appliedAt,
      };
    }

    // Check if we're redirected away from the form (also indicates success)
    const currentUrl = page.url();
    if (!currentUrl.includes('/apply') && !currentUrl.includes('/proposal')) {
      logger.info('[Contra] Application likely submitted (no error detected)', { jobId });
      return {
        success: true,
        jobId,
        applicationId,
        message: 'Application submitted (redirected from form)',
        appliedAt,
      };
    }

    // Look for error messages
    const errorEl = await page.$('[class*="error" i], [role="alert"][class*="error" i]');
    if (errorEl) {
      const errorText = await errorEl.textContent();
      throw new Error(`Application error: ${errorText}`);
    }

    return {
      success: true,
      jobId,
      applicationId,
      message: 'Application submitted',
      appliedAt,
    };

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('[Contra] Application failed', { jobId, message });
    return {
      success: false,
      jobId,
      message: `Application failed: ${message}`,
    };
  } finally {
    await page.close();
  }
}

/**
 * List all submitted applications (from the Contra dashboard).
 */
export async function getMyApplications(): Promise<Application[]> {
  const page = await ensureLoggedIn();

  try {
    await page.goto(`${CONTRA_BASE}/proposals`, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    // Try alternative URL patterns
    if (page.url().includes('/login') || page.url().includes('/signup')) {
      await page.goto(`${CONTRA_BASE}/dashboard/proposals`, {
        waitUntil: 'networkidle',
        timeout: 15000,
      });
    }

    await page.waitForSelector('[data-testid="proposal"], [class*="proposal" i], [class*="application" i]', {
      timeout: 10000,
    }).catch(() => {
      logger.warn('[Contra] No application cards found');
    });

    const applications = await page.evaluate(() => {
      const cards = Array.from(
        document.querySelectorAll('[data-testid="proposal"], [class*="proposal" i], [class*="application" i]')
      );

      return cards.map((card) => {
        const titleEl = card.querySelector('h2, h3, [class*="title" i]');
        const statusEl = card.querySelector('[class*="status" i], [class*="badge" i]');
        const dateEl = card.querySelector('time, [class*="date" i]');
        const linkEl = card.querySelector('a[href]');
        const snippetEl = card.querySelector('p, [class*="preview" i]');

        const href = linkEl?.getAttribute('href') ?? '';
        const jobId = href.split('/').filter(Boolean).pop() ?? '';

        return {
          id: `app_${jobId}`,
          jobId,
          jobTitle: titleEl?.textContent?.trim() ?? 'Unknown Job',
          status: (statusEl?.textContent?.trim().toLowerCase() ?? 'pending') as Application['status'],
          appliedAt: dateEl?.getAttribute('datetime') ?? dateEl?.textContent?.trim() ?? '',
          coverLetterSnippet: snippetEl?.textContent?.trim().slice(0, 200) ?? '',
        };
      });
    });

    return applications as Application[];
  } finally {
    await page.close();
  }
}
