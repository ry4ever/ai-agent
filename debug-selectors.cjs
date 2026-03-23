// Debug Contra selectors
const { chromium } = require('playwright');

async function debug() {
  console.log('\n🔍 Debug Contra Selectors\n');

  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  const page = context.pages()[0] || await context.newPage();

  console.log('📍 Navigating to Contra opportunities...');
  await page.goto('https://contra.com/opportunities', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(5000);

  // Check if logged in
  const url = page.url();
  console.log(`🔗 URL: ${url}`);
  
  if (url.includes('/login') || url.includes('/sign')) {
    console.log('❌ NOT LOGGED IN - redirected to login page');
    console.log('   Please log in to Contra in the Chrome window first!');
    return;
  }

  // Screenshot
  await page.screenshot({ path: 'debug-contra-opportunities.png', fullPage: true });
  console.log('📸 Screenshot saved: debug-contra-opportunities.png');

  // Test selectors
  const selectors = [
    '[data-testid="opportunity-card"]',
    '.opportunity-card',
    '[class*="OpportunityCard"]',
    '[class*="opportunity"]',
    '[class*="job-card"]',
    '[class*="JobCard"]',
    'article',
    'a[href*="/opportunity/"]',
    '[class*="card"]',
    '[role="article"]',
    'li[class*="item"]'
  ];

  console.log('\n📊 Selector counts:');
  for (const sel of selectors) {
    const count = await page.locator(sel).count();
    if (count > 0) console.log(`   ${sel}: ${count}`);
  }

  // Get all links to opportunities
  const links = await page.locator('a[href*="/opportunity/"]').all();
  console.log(`\n🔗 Opportunity links found: ${links.length}`);
  
  for (let i = 0; i < Math.min(5, links.length); i++) {
    const href = await links[i].getAttribute('href');
    const text = await links[i].textContent();
    console.log(`   ${href} - "${text?.substring(0, 50)}"`);
  }

  // Get page HTML snippet
  const html = await page.content();
  const classMatches = html.match(/class="[^"]*(?:opportunity|job|card|listing|project)[^"]*"/gi);
  if (classMatches) {
    console.log('\n🎯 Job-related classes found:');
    [...new Set(classMatches)].slice(0, 15).forEach(c => console.log(`   ${c}`));
  }

  console.log('\n✅ Debug complete!');
}

debug().catch(e => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
