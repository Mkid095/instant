import { chromium } from '@playwright/test';

const BASE_URL = 'https://instant.fidscript.com';
const API_URL = 'https://apiinstant.fidscript.com';

async function testBrowser(name, options = {}) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ignoreHTTPSErrors: false, // STRICT TLS validation
  });
  const page = await context.newPage();

  const results = { name, tlsErrors: [], consoleErrors: [], response: null, url: null };

  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      results.consoleErrors.push(text.substring(0, 200));
    }
  });

  page.on('requestfailed', req => {
    results.tlsErrors.push(`FAILED: ${req.url()} - ${req.failure()?.errorText}`);
  });

  try {
    await page.goto(`${BASE_URL}/dash`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2000);

    // Check __instantConfig
    const config = await page.evaluate(() => ({
      apiURI: window.__instantConfig?.apiURI,
      wsUrl: window.__instantConfig?.wsUrl,
    }));
    results.config = config;

    // Fill email and submit
    const input = page.locator('input[type="email"]').first();
    if (await input.isVisible({ timeout: 3000 }).catch(() => false)) {
      await input.fill('kennedygithinjioffice@gmail.com');
      const btn = page.locator('button[type="submit"]').first();
      if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await btn.click();
        await page.waitForTimeout(5000);
      }
    }

    results.url = page.url();
    results.title = await page.title();

    // Test API endpoint directly
    try {
      const apiResp = await page.evaluate(async (url) => {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'kennedygithinjioffice@gmail.com' }),
        });
        return { status: r.status, ok: r.ok };
      }, `${API_URL}/dash/auth/send_magic_code`);
      results.apiTest = apiResp;
    } catch (e) {
      results.apiTest = { error: e.message };
    }

    // WebSocket test
    try {
      results.ws = await new Promise((resolve) => {
        const ws = new WebSocket('wss://apiinstant.fidscript.com/runtime/session');
        const t = setTimeout(() => resolve({ err: 'timeout' }), 5000);
        ws.onopen = () => { clearTimeout(t); ws.close(); resolve({ connected: true }); };
        ws.onerror = (e) => { clearTimeout(t); resolve({ connected: false, error: 'ws_error' }); };
      });
    } catch (e) {
      results.ws = { error: e.message };
    }

  } catch (e) {
    results.consoleErrors.push(`Nav: ${e.message}`);
  }

  await browser.close();
  return results;
}

async function main() {
  console.log('=== CONTROLLED TLS-STRICT BROWSER TEST ===\n');
  console.log('Testing with ignoreHTTPSErrors: FALSE (strict TLS validation)\n');

  const result = await testBrowser('Playwright/Chromium (strict TLS)');

  console.log(`URL: ${result.url}`);
  console.log(`Title: ${result.title}`);
  console.log(`Config: ${JSON.stringify(result.config)}`);
  console.log(`API direct test: ${JSON.stringify(result.apiTest)}`);
  console.log(`WebSocket: ${JSON.stringify(result.ws)}`);
  console.log(`TLS/Network failures: ${result.tlsErrors.length}`);
  result.tlsErrors.forEach(e => console.log(`  ${e}`));
  console.log(`Console errors: ${result.consoleErrors.length}`);
  result.consoleErrors.forEach(e => console.log(`  ${e}`));

  console.log('\n=== REFERENCE: curl TLS validation ===');
  const tlsCheck = require('child_process').execSync(
    `echo | openssl s_client -connect apiinstant.fidscript.com:443 -servername apiinstant.fidscript.com 2>/dev/null | openssl x509 -noout -subject -issuer -dates`,
    { encoding: 'utf8' }
  );
  console.log(tlsCheck);
}

main().catch(console.error);
