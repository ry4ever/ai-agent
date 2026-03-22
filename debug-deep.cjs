// Deep debug Contra selectors
const { chromium } = require('playwright');
const fs = require('fs');

async function debug() {
  console.log('\n🔍 Deep Debug Contra\n');

  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  const page = context.pages()[0] || await context.newPage();

  // Try both URLs
  const urls = [
    'https://contra.com/jobs',
    'https://contra.com/opportunities'
  ];

  for (const url of urls) {
    console.log(`\n📍 Trying: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(5000);

    const currentUrl = page.url();
    console.log(`   Redirected to: ${currentUrl}`);

    // Screenshot
    const filename = url.includes('opportunities') ? 'debug-opportunities.png' : 'debug-jobs.png';
    await page.screenshot({ path: filename, fullPage: true });
    console.log(`   📸 Saved: ${filename}`);

    // Check login
    if (currentUrl.includes('login') || currentUrl.includes('sign')) {
      console.log('   ❌ Not logged in');
      continue;
    }

    // Get ALL link hrefs
    const allLinks = await page.locator('a').all();
    console.log(`   🔗 Total links: ${allLinks.length}`);
    
    const jobLinks = [];
    for (const link of allLinks) {
      const href = await link.getAttribute('href').catch(() => '');
      if (href && (href.includes('/opportunity/') || href.includes('/project/') || href.includes('/job/'))) {
        const text = await link.textContent().catch(() => '');
        jobLinks.push({ href, text: text.substring(0, 50) });
      }
    }
    console.log(`   🎯 Job links: ${jobLinks.length}`);
    jobLinks.slice(0, 5).forEach(l => console.log(`      ${l.href}`));

    // Get page text
    const body = await page.locator('body').allInnerTexts();
    const text = body.join('\n');
    console.log(`\n   📄 Text preview (${text.length} chars):`);
    console.log('   ' + text.substring(0, 500).split('\n').join('\n   '));

    // Find all buttons
    const buttons = await page.locator('button').all();
    console.log(`\n   🔘 Buttons: ${buttons.length}`);
    const buttonTexts = [];
    for (const btn of buttons.slice(0, 20)) {
      const txt = await btn.textContent().catch(() => '');
      if (txt.trim()) buttonTexts.push(txt.trim());
    }
    console.log('   ' + buttonTexts.join(', '));

    // Save HTML for inspection
    const html = await page.content();
    fs.writeFileSync('debug-page.html', html);
    console.log(`   💾 HTML saved: debug-page.html (${html.length} chars)`);

    // Look for data-testid attributes
    const testIds = html.match(/data-testid="[^"]+"/g);
    if (testIds) {
      console.log(`\n   🏷️ data-testid attributes (${testIds.length}):`);
      [...new Set(testIds)].slice(0, 20).forEach(t => console.log(`      ${t}`));
    }

    // Look for class names with opportunity/job/card
    const classes = html.match(/class="[^"]*(?:opportunity|job|card|listing|project)[^"]*"/gi);
    if (classes) {
      console.log(`\n   🎨 Relevant classes (${classes.length}):`);
      [...new Set(classes)].slice(0, 20).forEach(c => console.log(`      ${c}`));
    }
  }

  console.log('\n✅ Deep debug complete!');
}

debug().catch(e => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
