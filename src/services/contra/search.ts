/**
 * Contra.com Job Search
 *
 * Searches for freelance jobs on Contra.com using Browserbase browser automation.
 * Targets Software Development, AI/ML Engineering, and Data Science categories.
 *
 * Main flow:
 *   1. Navigate to contra.com/jobs
 *   2. Apply keyword/skill/budget filters
 *   3. Scrape job listing cards
 *   4. Optionally fetch full details for each job
 */

import { Page } from 'playwright';
import { ensureLoggedIn } from './auth';
import { ContraJob, SearchFilters } from './types';
import { logger } from '../../middleware/logger';

const CONTRA_BASE = 'https://contra.com';
const JOBS_URL = `${CONTRA_BASE}/jobs`;

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
    // Always go to /jobs (not with search params - Contra's search is too strict)
    logger.info('[Contra] Searching jobs', { filters });
    await page.goto(JOBS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);

    // Click "All" tab to see all jobs (not just "For You")
    try {
      const allTab = page.locator('button:has-text("All")').first();
      if (await allTab.count() > 0) {
        await allTab.click({ timeout: 5000 });
        await page.waitForTimeout(3000);
        logger.info('[Contra] Clicked All tab');
      }
    } catch {
      logger.info('[Contra] All tab not found or already selected');
    }

    // Wait for job listings to load
    await page.waitForSelector(
      '[data-sentry-component="OpportunityPost"], div[aria-label*="View opportunity"]',
      { timeout: 20000 }
    ).catch(() => {
      logger.warn('[Contra] No job cards found — page may have changed structure');
    });

    // Scroll to load more jobs (lazy loading)
    await autoScroll(page, 5);

    // Scrape all visible job cards
    const jobs = await page.evaluate((args: { limit: number; keywords: string }) => {
      // Contra uses data-sentry-component="OpportunityPost" for job cards
      const cards = Array.from(
        document.querySelectorAll(
          '[data-sentry-component="OpportunityPost"], div[aria-label*="View opportunity"]'
        )
      );

      // Filter cards by keywords if provided
      const keywordsLower = args.keywords.toLowerCase().split(/\s+/).filter(k => k.length > 2);
      
      const filteredCards = keywordsLower.length > 0 
        ? cards.filter(card => {
            const text = (card.textContent || '').toLowerCase();
            return keywordsLower.some(kw => text.includes(kw));
          })
        : cards;

      // Limit results
      const limitedCards = filteredCards.slice(0, args.limit);

      return limitedCards.map((card) => {
        // Find elements within the card
        const titleEl = card.querySelector('p, h1, h2, h3, [class*="title"]');
        const descEl = card.querySelector('[class*="description"] p, p + p');
        const skillEls = card.querySelectorAll('[class*="skill"], [class*="tag"], span[class*="css"]');
        const clientEl = card.querySelector('span');

        // Get aria-label for client name (format: "View opportunity from Client Name")
        const ariaLabel = card.getAttribute('aria-label') || '';
        const clientMatch = ariaLabel.match(/from\s+(.+)$/i);
        const clientName = clientMatch ? clientMatch[1] : (clientEl?.textContent?.trim() ?? 'Unknown Client');

        // Get all text content to parse
        const allText = card.textContent || '';
        
        // Parse budget from text like "$5,000 - $10,000 • One-time • 6 weeks delivery"
        const budgetMatch = allText.match(/\$?([\d,]+)\s*-\s*\$?([\d,]+)/);
        const budgetMin = budgetMatch ? parseFloat(budgetMatch[1].replace(/,/g, '')) : undefined;
        const budgetMax = budgetMatch ? parseFloat(budgetMatch[2].replace(/,/g, '')) : undefined;
        
        // Determine budget type
        const budgetType = allText.toLowerCase().includes('hour') ? 'hourly' as const : 
                          allText.includes('$') || allText.includes('€') ? 'fixed' as const : 'unknown' as const;

        // Get title - usually the longest paragraph or first significant text
        const paragraphs = Array.from(card.querySelectorAll('p')).map(p => p.textContent?.trim() || '');
        const title = paragraphs.find(p => p.length > 10 && !p.includes('$')) || 
                     (titleEl?.textContent?.trim() ?? 'Untitled');

        // Get skills - look for short text spans
        const skills = Array.from(skillEls)
          .map(el => el.textContent?.trim() || '')
          .filter(s => s.length > 1 && s.length < 30 && !s.includes('$'))
          .slice(0, 10);

        // Generate job ID from aria-label or use random
        const jobId = ariaLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 
                     Math.random().toString(36).slice(2);

        return {
          id: jobId,
          title,
          description: descEl?.textContent?.trim() ?? '',
          skills,
          budgetMin,
          budgetMax,
          budgetType,
          clientName,
          postedAt: new Date().toISOString(),
          url: '',
          isRemote: allText.toLowerCase().includes('remote'),
        };
      });
    }, { limit: filters.limit ?? 20, keywords: filters.keywords || '' });

    // Get URLs for each job by clicking and getting the URL
    for (let i = 0; i < jobs.length; i++) {
      try {
        const cardHandles = await page.$$('[data-sentry-component="OpportunityPost"], div[aria-label*="View opportunity"]');
        if (cardHandles[i]) {
          // Get the onclick or data attribute for URL
          const ariaLabel = await cardHandles[i].getAttribute('aria-label');
          // Jobs typically link to /opportunity/[id] or similar
          // For now, we'll construct URL from job ID
          if (jobs[i]) {
            jobs[i].url = `https://contra.com/opportunity/${jobs[i].id}`;
          }
        }
      } catch {
        // URL construction failed, use default
      }
    }

    logger.info(`[Contra] Found ${jobs.length} jobs`);
    return jobs as ContraJob[];

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('[Contra] Search failed', { message });
    throw err;
  }
  // Don't close page - we reuse it for CDP connections
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
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

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
    params.set('search', keywords.slice(0, 3).join(' '));
  }

  if (filters.budgetMin) params.set('budgetMin', String(filters.budgetMin));
  if (filters.budgetMax) params.set('budgetMax', String(filters.budgetMax));
  if (filters.jobType) params.set('type', filters.jobType);

  const queryString = params.toString();
  // Use /jobs instead of /opportunities (Contra's current URL structure)
  return queryString ? `${JOBS_URL}?${queryString}` : JOBS_URL;
}

async function autoScroll(page: Page, times = 3): Promise<void> {
  for (let i = 0; i < times; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
    await page.waitForTimeout(1500);
  }
}
