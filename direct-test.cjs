// Direct debug - test Contra scraping
const { chromium } = require('playwright');

async function test() {
  console.log('\n🔍 Testing Contra scraping directly\n');

  try {
    console.log('Connecting to Chrome CDP...');
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    console.log('✅ Connected to Chrome via CDP');

    const context = browser.contexts()[0];
    console.log(`Contexts: ${browser.contexts().length}`);

    const pages = context.pages();
    console.log(`Pages: ${pages.length}`);
    
    // Get or create a page
    const page = pages[0] || await context.newPage();
    console.log(`Using page: ${page.url()}`);

    // Navigate to Contra jobs
    console.log('\nNavigating to Contra jobs...');
    await page.goto('https://contra.com/jobs', { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log(`URL: ${page.url()}`);
    await page.waitForTimeout(5000);

    // Click All tab
    try {
      const allBtn = page.locator('button:has-text("All")').first();
      await allBtn.click({ timeout: 5000 });
      console.log('✅ Clicked All tab');
      await page.waitForTimeout(3000);
    } catch (e) {
      console.log('All tab not found or already selected');
    }

    // Wait for job cards
    console.log('\nWaiting for job cards...');
    try {
      await page.waitForSelector('[data-sentry-component="OpportunityPost"], div[aria-label*="View opportunity"]', { timeout: 20000 });
      console.log('✅ Job cards found');
    } catch (e) {
      console.log('❌ No job cards found');
      
      // Screenshot
      await page.screenshot({ path: 'debug-no-cards.png', fullPage: true });
      console.log('📸 Screenshot: debug-no-cards.png');
      
      // Get page text
      const text = await page.locator('body').allInnerTexts();
      console.log('\n📄 Page text:');
      console.log(text.join('\n').substring(0, 1000));
      return;
    }

    // Count job cards
    const cards = await page.locator('[data-sentry-component="OpportunityPost"], div[aria-label*="View opportunity"]').all();
    console.log(`\n✅ Found ${cards.length} job cards`);

    // Get first job details
    if (cards.length > 0) {
      const firstCard = cards[0];
      const text = await firstCard.textContent();
      console.log('\nFirst job text:');
      console.log(text);
    }

    // Screenshot
    await page.screenshot({ path: 'debug-with-cards.png', fullPage: true });
    console.log('\n📸 Screenshot: debug-with-cards.png');

    console.log('\n✅ Test complete!');
  } catch (error) {
    console.error('❌ Error:', error.message);
    
    // Try to get more error info
    if (error.stack) console.error(error.stack);
  }
}

test();
