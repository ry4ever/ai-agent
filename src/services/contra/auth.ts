/**
 * Contra.com Authentication
 *
 * Handles login/session management for the Contra.com Pro account.
 * Credentials are read from environment variables:
 *   CONTRA_EMAIL    — account email
 *   CONTRA_PASSWORD — account password
 *
 * Sessions are persisted to disk via the browser module to avoid
 * re-logging in on every run.
 */

import { Page } from 'playwright';
import { getPage, saveSession } from './browser';
import { logger } from '../../middleware/logger';

const CONTRA_BASE = 'https://contra.com';
const LOGIN_URL = `${CONTRA_BASE}/login`;
const DASHBOARD_PATTERN = /contra\.com\/(home|dashboard|feed|opportunities)/;

/**
 * Check if the current page/session is authenticated.
 * For CDP connections, just checks if we can navigate without being redirected to login.
 */
export async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    const currentUrl = page.url();
    
    // If already on contra.com and not on login page, assume logged in
    if (currentUrl.includes('contra.com') && !currentUrl.includes('/login') && !currentUrl.includes('/signup')) {
      return true;
    }
    
    // Try to navigate to opportunities
    await page.goto(`${CONTRA_BASE}/opportunities`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    
    const newUrl = page.url();
    // If redirected to login, we're not authenticated
    return !newUrl.includes('/login') && !newUrl.includes('/signup');
  } catch {
    return false;
  }
}

/**
 * Log in to Contra.com with the configured credentials.
 * Throws if login fails.
 */
export async function login(): Promise<Page> {
  const email = process.env.CONTRA_EMAIL;
  const password = process.env.CONTRA_PASSWORD;

  if (!email || !password) {
    throw new Error('CONTRA_EMAIL and CONTRA_PASSWORD environment variables are required');
  }

  const page = await getPage();

  // Check if already logged in
  const alreadyLoggedIn = await isLoggedIn(page);
  if (alreadyLoggedIn) {
    logger.info('[Contra] Already logged in — reusing session');
    return page;
  }

  logger.info('[Contra] Logging in...');

  await page.goto(LOGIN_URL, { waitUntil: 'networkidle', timeout: 30000 });

  // Fill email field
  await page.waitForSelector('input[type="email"], input[name="email"], input[placeholder*="email" i]', {
    timeout: 10000,
  });
  await page.fill('input[type="email"], input[name="email"], input[placeholder*="email" i]', email);

  // Fill password field
  await page.fill('input[type="password"]', password);

  // Submit the form
  await page.click('button[type="submit"], button:has-text("Log in"), button:has-text("Sign in")');

  // Wait for navigation to dashboard/home
  await page.waitForURL(DASHBOARD_PATTERN, { timeout: 20000 }).catch(async () => {
    // Check for error messages
    const errorEl = await page.$('[data-testid="error"], .error-message, [role="alert"]');
    if (errorEl) {
      const msg = await errorEl.textContent();
      throw new Error(`Login failed: ${msg}`);
    }
    throw new Error('Login did not redirect to dashboard — check credentials');
  });

  logger.info('[Contra] Login successful');
  await saveSession();
  return page;
}

/**
 * Ensure a page is authenticated, re-logging in if needed.
 * For CDP connections, assumes the existing session is valid.
 */
export async function ensureLoggedIn(): Promise<Page> {
  const page = await getPage();
  const loggedIn = await isLoggedIn(page);
  if (!loggedIn) {
    // For CDP connections, we can't login programmatically with Google OAuth
    // The user needs to be logged in in their browser
    if (process.env.CHROME_CDP_URL || process.env.CONTRA_EMAIL === 'cdp-user') {
      throw new Error('Not logged in to Contra. Please log in via Google OAuth in your Chrome browser (CDP window) and try again.');
    }
    await page.close();
    return login();
  }
  return page;
}
