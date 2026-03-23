// Quick test - check Contra selectors
const { chromium } = require('playwright');

async function test() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  const page = context.pages()[0] || await context.newPage();

  console.log('📍 Going to Contra jobs...');
  await page.goto('https://contra.com/jobs', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000);

  console.log(`URL: ${page.url()}`);

  // Check for different selectors
  const selectors = [
    '[data-sentry-component="OpportunityPost"]',
    'div[aria-label*="View opportunity"]',
    'div[aria-label*="opportunity"]',
    '[role="button"][aria-label*="opportunity"]',
    'button:has-text("Apply")'
  ];

  for (const sel of selectors) {
    const count = await page.locator(sel).count();
    console.log(`${sel}: ${count}`);
  }

  // Get page text
  const text = await page.locator('body').allInnerTexts();
  console.log('\nPage text preview:');
  console.log(text.join('\n').substring(0, 1500));

  await page.screenshot({ path: 'test-contra.png' });
  console.log('\n📸 Screenshot: test-contra.png');
}

test().catch(e => console.error('Error:', e.message));
