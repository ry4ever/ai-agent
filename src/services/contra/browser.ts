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
let cdpFailed = false; // Track if CDP has failed

const SESSION_FILE = process.env.CONTRA_SESSION_FILE ?? './contra-session.json';

/**
 * Get or launch the shared Chromium browser instance.
 * Prioritizes connecting to existing CDP endpoint (port 9222) for session reuse.
 */
export async function getBrowser(): Promise<Browser> {
  // If we previously failed CDP and launched headless, reuse that
  if (browser && browser.isConnected()) return browser;

  // If CDP previously failed, don't keep trying
  if (cdpFailed && browser && browser.isConnected()) return browser;

  // Try to connect to existing Chrome CDP first (unless we already failed)
  if (!cdpFailed) {
    const cdpUrl = process.env.CHROME_CDP_URL || 'http://127.0.0.1:9222';
    try {
      logger.info('[Contra] Connecting to Chrome CDP...', { cdpUrl });
      browser = await chromium.connectOverCDP(cdpUrl);
      logger.info('[Contra] Connected to Chrome via CDP');
      
      browser.on('disconnected', () => {
        logger.warn('[Contra] Browser disconnected');
        browser = null;
        context = null;
        cdpFailed = false; // Reset CDP failed flag on disconnect
      });
      
      return browser;
    } catch (e) {
      logger.info('[Contra] CDP not available, launching headless browser...');
      cdpFailed = true; // Mark CDP as failed for this session
    }
  }

  // Fall back to launching new browser
  logger.info('[Contra] Launching headless browser...');
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
 * For CDP connections, reuses the first existing context.
 */
export async function getContext(): Promise<BrowserContext> {
  if (context) return context;

  const b = await getBrowser();

  // If connected via CDP, use the first existing context
  const contexts = b.contexts();
  if (contexts.length > 0) {
    context = contexts[0];
    logger.info('[Contra] Using existing browser context from CDP');
    return context;
  }

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
 * For CDP connections, tries to reuse existing page if available.
 */
export async function getPage(): Promise<Page> {
  const ctx = await getContext();
  
  // For CDP connections, try to reuse an existing page instead of creating new one
  const existingPages = ctx.pages();
  if (existingPages.length > 0) {
    // Find a page that's not on a special URL (like chrome:// or about:)
    const usablePage = existingPages.find(p => {
      const url = p.url();
      return url.startsWith('http');
    });
    
    if (usablePage) {
      logger.info('[Contra] Reusing existing page from CDP context');
      return usablePage;
    }
  }
  
  // Create new page if no reusable one exists
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
  cdpFailed = false; // Reset CDP failed flag
  logger.info('[Contra] Browser closed');
}

/**
 * Reset browser state to allow fresh CDP connection.
 */
export function resetBrowserState(): void {
  browser = null;
  context = null;
  cdpFailed = false;
  logger.info('[Contra] Browser state reset');
}
