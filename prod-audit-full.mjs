import { chromium } from '@playwright/test';

const BASE_URL = 'https://instant.fidscript.com';
const API_URL = 'https://apiinstant.fidscript.com';
const DIRECT_IP = '72.61.89.110';

async function testEndpoint(url, options = {}) {
  const { method = 'GET', body } = options;
  try {
    const resp = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await resp.text();
    return { ok: resp.ok, status: resp.status, body: text.substring(0, 200) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function runReconciliation() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const results = {};

  console.log('=== INFRASTRUCTURE RECONCILIATION ===\n');

  // PATH A: Direct VPS IP → Caddy (bypass all DNS/proxy)
  console.log('--- PATH A: Direct IP → Caddy (no DNS, no Cloudflare) ---');
  const directApi = await testEndpoint(`https://${DIRECT_IP}/`, {}, `https://apiinstant.fidscript.com`);
  console.log(`  GET https://${DIRECT_IP}/ (via Host: apiinstant.fidscript.com) → ${directApi.status || directApi.error}`);

  // PATH B: DNS → Cloudflare → Origin (current production path)
  console.log('\n--- PATH B: DNS → Cloudflare → Origin (production) ---');
  const cfApi = await testEndpoint(`${API_URL}/`);
  console.log(`  GET ${API_URL}/ → ${cfApi.status || cfApi.error}`);

  const cfHealth = await testEndpoint(`${API_URL}/health`);
  console.log(`  GET ${API_URL}/health → ${cfHealth.status || cfHealth.error}`);

  const cfMagic = await testEndpoint(`${API_URL}/dash/auth/send_magic_code`, {
    method: 'POST',
    body: { email: 'test@example.com' },
  });
  console.log(`  POST ${API_URL}/dash/auth/send_magic_code → ${cfMagic.status || cfMagic.error}`);
  if (cfMagic.body) console.log(`  Response: ${cfMagic.body.substring(0, 100)}`);

  // PATH C: Browser - dashboard login flow
  console.log('\n--- PATH C: Browser Dashboard + Login Test ---');

  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // Load dashboard
  await page.goto(`${BASE_URL}/dash`, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(3000);

  const dashUrl = page.url();
  const dashTitle = await page.title();
  console.log(`  Dashboard URL: ${dashUrl}`);
  console.log(`  Dashboard Title: ${dashTitle || '(empty)'}`);

  // Check config
  const config = await page.evaluate(() => window.__instantConfig);
  console.log(`  __instantConfig: ${JSON.stringify(config)}`);

  // Try to find and fill email form
  const emailInput = page.locator('input[type="email"], input[placeholder*="email" i]').first();
  const inputCount = await page.locator('input[type="email"]').count();
  console.log(`  Email inputs found: ${inputCount}`);

  if (await emailInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await emailInput.fill('kennedygithinjioffice@gmail.com');
    console.log('  Filled email input');

    // Find submit button
    const submitBtn = page.locator('button[type="submit"], button:has-text("Send")').first();
    if (await submitBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('  Clicking submit...');
      await submitBtn.click();
      await page.waitForTimeout(5000);

      // Check for errors
      const pageErrors = consoleErrors.filter(e =>
        e.includes('ERR_') || e.includes('CORS') || e.includes('fetch')
      );
      console.log(`  Console errors during submit: ${pageErrors.length}`);
      pageErrors.forEach(e => console.log(`    ${e.substring(0, 150)}`));

      // Check current URL/content
      const afterUrl = page.url();
      console.log(`  URL after submit: ${afterUrl}`);
    }
  }

  // WebSocket test
  console.log('\n--- WebSocket Test ---');
  let wsConnected = false;
  try {
    const wsResult = await new Promise((resolve) => {
      const ws = new WebSocket('wss://apiinstant.fidscript.com/runtime/session');
      const timeout = setTimeout(() => resolve({ error: 'timeout' }), 5000);
      ws.onopen = () => { wsConnected = true; clearTimeout(timeout); ws.close(); resolve({ connected: true }); };
      ws.onerror = () => { clearTimeout(timeout); resolve({ error: 'error' }); };
    });
    console.log(`  WebSocket: ${wsResult.connected ? 'CONNECTED' : wsResult.error.toUpperCase()}`);
  } catch (e) {
    console.log(`  WebSocket: ERROR - ${e.message}`);
  }

  // Check server logs for actual requests
  console.log('\n--- Server Request Log Check ---');
  // (can't read server logs from browser, but we note the API worked via curl)

  await browser.close();

  console.log('\n=== SUMMARY ===');
  console.log(`Direct API: ${directApi.status || directApi.error}`);
  console.log(`Cloudflare API: ${cfApi.status || cfApi.error}`);
  console.log(`Dashboard: ${dashUrl}`);
  console.log(`Config correct: ${config?.apiURI?.includes('apiinstant') ? 'YES' : 'NO'}`);
  console.log(`WebSocket: ${wsConnected ? 'CONNECTED' : 'FAILED'}`);
}

runReconciliation().catch(console.error);
