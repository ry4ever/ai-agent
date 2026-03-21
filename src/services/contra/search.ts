/**
 * Contra.com Job Search
 *
 * Searches for freelance jobs on Contra.com using Playwright browser automation.
 * Targets Software Development, AI/ML Engineering, and Data Science categories.
 *
 * Main flow:
 *   1. Navigate to contra.com/opportunities
 *   2. Apply keyword/skill/budget filters
 *   3. Scrape job listing cards
 *   4. Optionally fetch full details for each job
 */

import { Page } from 'playwright';
import { ensureLoggedIn } from './auth';
import { ContraJob, SearchFilters } from './types';
import { logger } from '../../middleware/logger';

const CONTRA_BASE = 'https://contra.com';
const OPPORTUNITIES_URL = `${CONTRA_BASE}/opportunities`;

// Category keyword mappings for Contra.com's search
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  'software': ['software engineer', 'developer', 'full-stack', 'backend', 'frontend', 'typescript', 'node.js'],
  'ai-ml': ['machine learning', 'AI', 'LLM', 'NLP', 'deep learning', 'data science', 'MLOps'],
  'data-science': ['data scientist', 'data analyst', 'data engineer', 'SQL', 'Python', 'analytics'],
};

/**
 * Search for jobs on Contra.com.
 * Returns a list of matching job postings.
 */
export async function searchJobs(filters: SearchFilters = {}): Promise<ContraJob[]> {
  const page = await ensureLoggedIn();

  try {
    const url = buildSearchUrl(filters);
    logger.info('[Contra] Searching jobs', { url, filters });

    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

    // Wait for job listings to load
    await page.waitForSelector(
      '[data-testid="opportunity-card"], .opportunity-card, [class*="OpportunityCard"], article',
      { timeout: 15000 }
    ).catch(() => {
      logger.warn('[Contra] No job cards found — page may have changed structure');
    });

    // Scroll to load more jobs (lazy loading)
    await autoScroll(page, 3);

    // Scrape all visible job cards
    const jobs = await page.evaluate((limit: number) => {
      const cards = Array.from(
        document.querySelectorAll(
          '[data-testid="opportunity-card"], .opportunity-card, article[class*="opportunity" i], div[class*="OpportunityCard"]'
        )
      ).slice(0, limit);

      return cards.map((card) => {
        const titleEl = card.querySelector('h1, h2, h3, [class*="title" i], [data-testid="title"]');
        const descEl = card.querySelector('[class*="description" i], [class*="desc" i], p');
        const skillEls = card.querySelectorAll('[class*="skill" i], [class*="tag" i], [class*="badge" i]');
        const budgetEl = card.querySelector('[class*="budget" i], [class*="rate" i], [class*="price" i]');
        const clientEl = card.querySelector('[class*="client" i], [class*="company" i], [class*="user" i]');
        const linkEl = card.querySelector('a[href*="/opportunity"], a[href*="/project"], a[href]');
        const dateEl = card.querySelector('[class*="date" i], [class*="time" i], time');

        const href = linkEl?.getAttribute('href') ?? '';
        const fullUrl = href.startsWith('http') ? href : `https://contra.com${href}`;
        const jobId = href.split('/').filter(Boolean).pop() ?? Math.random().toString(36).slice(2);

        const budgetText = budgetEl?.textContent?.trim() ?? '';
        const budgetMatch = budgetText.match(/[\$€£]?([\d,]+)/g);
        const budgetNums = (budgetMatch ?? []).map((s) => parseFloat(s.replace(/[^0-9.]/g, '')));

        return {
          id: jobId,
          title: titleEl?.textContent?.trim() ?? 'Untitled',
          description: descEl?.textContent?.trim() ?? '',
          skills: Array.from(skillEls).map((el) => el.textContent?.trim() ?? '').filter(Boolean),
          budgetMin: budgetNums[0],
          budgetMax: budgetNums[1] ?? budgetNums[0],
          budgetType: (budgetText.toLowerCase().includes('/hr') || budgetText.toLowerCase().includes('hour'))
            ? 'hourly' as const
            : budgetText ? 'fixed' as const : 'unknown' as const,
          clientName: clientEl?.textContent?.trim() ?? 'Unknown Client',
          postedAt: dateEl?.getAttribute('datetime') ?? dateEl?.textContent?.trim() ?? new Date().toISOString(),
          url: fullUrl,
          isRemote: card.textContent?.toLowerCase().includes('remote') ?? true,
        };
      });
    }, filters.limit ?? 20);

    logger.info(`[Contra] Found ${jobs.length} jobs`);
    return jobs as ContraJob[];

  } finally {
    await page.close();
  }
}

/**
 * Get full details for a specific job by its ID or URL.
 */
export async function getJobDetails(jobIdOrUrl: string): Promise<ContraJob> {
  const page = await ensureLoggedIn();

  try {
    const url = jobIdOrUrl.startsWith('http')
      ? jobIdOrUrl
      : `${CONTRA_BASE}/opportunity/${jobIdOrUrl}`;

    logger.info('[Contra] Fetching job details', { url });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

    const job = await page.evaluate((pageUrl: string) => {
      const titleEl = document.querySelector('h1, [class*="title" i][class*="project" i]');
      const descEls = document.querySelectorAll('[class*="description" i] p, [class*="body" i] p, article p');
      const skillEls = document.querySelectorAll('[class*="skill" i], [class*="tag" i], [class*="requirement" i] li');
      const budgetEl = document.querySelector('[class*="budget" i], [class*="rate" i], [class*="compensation" i]');
      const clientEl = document.querySelector('[class*="client" i] [class*="name" i], [class*="company" i] h3');

      const description = Array.from(descEls).map((el) => el.textContent?.trim()).filter(Boolean).join('\n\n');
      const budgetText = budgetEl?.textContent?.trim() ?? '';
      const budgetMatch = budgetText.match(/[\$€£]?([\d,]+)/g);
      const budgetNums = (budgetMatch ?? []).map((s) => parseFloat(s.replace(/[^0-9.]/g, '')));
      const jobId = pageUrl.split('/').filter(Boolean).pop() ?? 'unknown';

      return {
        id: jobId,
        title: titleEl?.textContent?.trim() ?? 'Untitled',
        description,
        skills: Array.from(skillEls).map((el) => el.textContent?.trim() ?? '').filter(Boolean).slice(0, 20),
        budgetMin: budgetNums[0],
        budgetMax: budgetNums[1] ?? budgetNums[0],
        budgetType: (budgetText.toLowerCase().includes('/hr') || budgetText.toLowerCase().includes('hour'))
          ? 'hourly' as const
          : budgetText ? 'fixed' as const : 'unknown' as const,
        clientName: clientEl?.textContent?.trim() ?? 'Unknown Client',
        postedAt: new Date().toISOString(),
        url: pageUrl,
        isRemote: document.body.textContent?.toLowerCase().includes('remote') ?? true,
      };
    }, url);

    return job as ContraJob;
  } finally {
    await page.close();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSearchUrl(filters: SearchFilters): string {
  const params = new URLSearchParams();

  // Build keyword string from filters + category defaults
  const keywords: string[] = [];
  if (filters.keywords) keywords.push(filters.keywords);
  if (filters.skills?.length) keywords.push(...filters.skills);
  if (filters.category && filters.category !== 'all') {
    const defaults = CATEGORY_KEYWORDS[filters.category] ?? [];
    if (!filters.keywords) keywords.push(defaults[0]); // add one default keyword
  }

  if (keywords.length > 0) {
    params.set('q', keywords.slice(0, 3).join(' '));
  }

  if (filters.budgetMin) params.set('budgetMin', String(filters.budgetMin));
  if (filters.budgetMax) params.set('budgetMax', String(filters.budgetMax));
  if (filters.jobType) params.set('type', filters.jobType);

  const queryString = params.toString();
  return queryString ? `${OPPORTUNITIES_URL}?${queryString}` : OPPORTUNITIES_URL;
}

async function autoScroll(page: Page, times = 3): Promise<void> {
  for (let i = 0; i < times; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
    await page.waitForTimeout(1500);
  }
}
