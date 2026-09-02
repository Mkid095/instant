/**
 * FIDScript Live Server Connectivity Test
 * Tests that SDK can communicate with the server
 */

import { init } from '@fidscript/instant-sdk';

const API = 'https://apiinstant.fidscript.com';
const APP_ID = '24a4d71b-7bb2-4630-9aee-01146af26239';

const results = [];

function log(result) {
  const icon = result.status === 'PASS' ? '✅' : result.status === 'FAIL' ? '❌' : '⏭️';
  console.log(`${icon} ${result.test}${result.error ? ': ' + result.error : ''}`);
  results.push(result);
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  console.log('═══════════════════════════════════════════');
  console.log('FIDScript Live Server Connectivity Test');
  console.log(`API: ${API}`);
  console.log(`App ID: ${APP_ID}`);
  console.log('═══════════════════════════════════════════\n');

  // 1. API health
  console.log('─── HEALTH ───');
  try {
    const res = await fetch(`${API}/api/health`);
    if (res.ok) log({ test: 'API health check', status: 'PASS' });
    else log({ test: 'API health check', status: 'FAIL', error: `HTTP ${res.status}` });
  } catch (e) {
    log({ test: 'API health check', status: 'FAIL', error: e.message });
  }

  // 2. SDK initializes
  console.log('\n─── SDK INIT ───');
  try {
    const db = init({ appId: APP_ID });
    if (db._reactor && db.auth) {
      log({ test: 'SDK initializes', status: 'PASS' });
    } else {
      log({ test: 'SDK initializes', status: 'FAIL', error: 'Missing properties' });
    }
  } catch (e) {
    log({ test: 'SDK initializes', status: 'FAIL', error: e.message });
  }

  // 3. Direct auth API test
  console.log('\n─── AUTH API ───');
  try {
    const res = await fetch(`${API}/runtime/auth/sign_in_guest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ 'app-id': APP_ID }),
    });
    const data = await res.json();
    if (data.user) {
      log({ test: 'Auth API responds', status: 'PASS' });
      console.log('  User:', data.user.id, data.user.isGuest ? '(guest)' : '');
    } else {
      log({ test: 'Auth API responds', status: 'FAIL', error: JSON.stringify(data).slice(0,100) });
    }
  } catch (e) {
    log({ test: 'Auth API responds', status: 'FAIL', error: e.message });
  }

  // 4. SDK auth method
  const db = init({ appId: APP_ID });
  console.log('\n─── SDK AUTH ───');
  try {
    const result = await db.auth.signInAsGuest();
    if (result.user) {
      log({ test: 'SDK auth.signInAsGuest', status: 'PASS' });
      console.log('  User:', result.user.id);
    } else {
      log({ test: 'SDK auth.signInAsGuest', status: 'FAIL', error: JSON.stringify(result).slice(0,100) });
    }
  } catch (e) {
    log({ test: 'SDK auth.signInAsGuest', status: 'FAIL', error: e.message });
  }

  // Wait for WS connection
  await sleep(2000);

  // 5. Connection status
  try {
    const status = db._reactor.status;
    if (status === 'connected' || status === 'authenticated') {
      log({ test: 'WebSocket connected', status: 'PASS' });
      console.log('  Status:', status);
    } else {
      log({ test: 'WebSocket connected', status: 'FAIL', error: `Status: ${status}` });
    }
  } catch (e) {
    log({ test: 'WebSocket connected', status: 'FAIL', error: e.message });
  }

  // Summary
  console.log('\n═══════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════');
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  console.log(`Total: ${results.length} | ✅ ${passed} | ❌ ${failed}`);

  if (failed > 0) {
    console.log('\nFAILED:');
    results.filter(r => r.status === 'FAIL').forEach(r => console.log('  ❌', r.test + ':', r.error));
    process.exit(1);
  } else {
    console.log('\n✅ All connectivity tests passed!');
    console.log('\nNote: Full CRUD tests require a schema to be pushed via CLI.');
  }
}

run().catch(e => { console.error(e); process.exit(1); });
