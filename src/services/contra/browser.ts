/**
 * Playwright Browser Manager — Singleton
 *
 * Manages a single persistent Chromium browser instance for all Contra.com
 * automation. Reuses the same browser across multiple requests to avoid
 * the overhead of launching a new browser each time.
 *
 * Session persistence: browser context is saved to CONTRA_SESSION_FILE
 * so that logins survive process restarts.
 */

import { Browser, BrowserContext, Page, chromium } from 'playwright';
import path from 'path';
import { logger } from '../../middleware/logger';

let browser: Browser | null = null;
let context: BrowserContext | null = null;

const SESSION_FILE = process.env.CONTRA_SESSION_FILE ?? './contra-session.json';

/**
 * Get or launch the shared Chromium browser instance.
 */
export async function getBrowser(): Promise<Browser> {
  if (browser && browser.isConnected()) return browser;

  logger.info('[Contra] Launching Chromium browser...');
  browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  browser.on('disconnected', () => {
    logger.warn('[Contra] Browser disconnected');
    browser = null;
    context = null;
  });

  return browser;
}

/**
 * Get or create the shared browser context.
 * Attempts to restore a saved session from disk.
 */
export async function getContext(): Promise<BrowserContext> {
  if (context) return context;

  const b = await getBrowser();
  const sessionPath = path.resolve(SESSION_FILE);

  try {
    // Try to restore saved session (cookies + localStorage)
    context = await b.newContext({
      storageState: sessionPath,
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
    });
    logger.info('[Contra] Restored browser session from disk');
  } catch {
    // No saved session — start fresh
    context = await b.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
    });
    logger.info('[Contra] Starting fresh browser session');
  }

  return context;
}

/**
 * Get a new page from the shared context.
 */
export async function getPage(): Promise<Page> {
  const ctx = await getContext();
  const page = await ctx.newPage();

  // Block images, fonts, and media to speed up scraping
  await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf,mp4,webm}', (route) =>
    route.abort()
  );

  return page;
}

/**
 * Save the current browser session to disk for persistence across restarts.
 */
export async function saveSession(): Promise<void> {
  if (!context) return;
  try {
    const sessionPath = path.resolve(SESSION_FILE);
    await context.storageState({ path: sessionPath });
    logger.info('[Contra] Session saved to disk');
  } catch (err) {
    logger.warn('[Contra] Failed to save session', { err });
  }
}

/**
 * Close the browser and clean up resources.
 */
export async function closeBrowser(): Promise<void> {
  await saveSession();
  if (context) {
    await context.close().catch(() => {});
    context = null;
  }
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
  logger.info('[Contra] Browser closed');
}
