// Test search URL specifically
const { chromium } = require('playwright');

async function test() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  
  // Create a NEW page (like the search service does)
  const page = await context.newPage();

  const url = 'https://contra.com/jobs?search=AI+backend';
  console.log(`📍 Testing: ${url}`);
  
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000);

  console.log(`URL after load: ${page.url()}`);

  // Check for job cards
  const count = await page.locator('[data-sentry-component="OpportunityPost"]').count();
  console.log(`Job cards found: ${count}`);

  // Get page text
  const text = await page.locator('body').allInnerTexts();
  console.log('\nPage text preview:');
  console.log(text.join('\n').substring(0, 1500));

  await page.screenshot({ path: 'test-search-url.png' });
  console.log('\n📸 Screenshot: test-search-url.png');
  
  await page.close();
}

test().catch(e => console.error('Error:', e.message));
