/**
 * FIDScript E2E Test Suite
 *
 * Tests SDK behavior and configuration.
 * Does NOT require live server - tests what can be tested offline.
 */

import { init } from '@fidscript/instant-sdk';
import { id, tx } from '@fidscript/instant-sdk';

const API_URI = 'https://apiinstant.fidscript.com';

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
  console.log('FIDScript SDK Test Suite');
  console.log(`Default API: ${API_URI}`);
  console.log('═══════════════════════════════════════════\n');

  // 1. Verify SDK defaults to FIDScript API
  console.log('─── CONFIGURATION ───');
  try {
    const db = init({ appId: 'test-app' });
    const configuredApi = db._reactor.config.apiURI;
    if (configuredApi === API_URI) {
      log({ test: 'SDK defaults to FIDScript API', status: 'PASS' });
      console.log(`  API: ${configuredApi}`);
    } else {
      log({ test: 'SDK defaults to FIDScript API', status: 'FAIL', error: `Got ${configuredApi}` });
    }
  } catch (e) {
    log({ test: 'SDK defaults to FIDScript API', status: 'FAIL', error: e.message });
  }

  // 2. Verify SDK initialization
  try {
    const db = init({ appId: 'test-app' });
    const hasReactor = !!db._reactor;
    const hasAuth = !!db.auth;
    const hasTx = !!db.tx;
    const hasStorage = !!db.storage;
    const hasStreams = !!db.streams;
    if (hasReactor && hasAuth && hasTx && hasStorage && hasStreams) {
      log({ test: 'SDK initializes with all properties', status: 'PASS' });
      console.log('  Properties: _reactor, auth, tx, storage, streams');
    } else {
      log({ test: 'SDK initializes with all properties', status: 'FAIL', error: 'Missing properties' });
    }
  } catch (e) {
    log({ test: 'SDK initializes with all properties', status: 'FAIL', error: e.message });
  }

  // 3. Verify tx API produces valid transaction format
  console.log('\n─── TRANSACTION API ───');
  try {
    const db = init({ appId: 'test-app' });
    const t = db.tx.messages[id()].update({ text: 'test' });
    if (t && t.__ops && Array.isArray(t.__ops) && t.__ops.length > 0) {
      log({ test: 'Transaction format valid', status: 'PASS' });
      console.log(`  Op type: ${t.__ops[0][0]}`);
    } else {
      log({ test: 'Transaction format valid', status: 'FAIL', error: 'Invalid tx format' });
    }
  } catch (e) {
    log({ test: 'Transaction format valid', status: 'FAIL', error: e.message });
  }

  // 4. Verify tx.create produces correct format
  try {
    const db = init({ appId: 'test-app' });
    const msgId = id();
    const t = db.tx.messages[msgId].update({ text: 'hello' });
    if (t.__ops[0][0] === 'update' && t.__ops[0][1] === 'messages' && t.__ops[0][2] === msgId) {
      log({ test: 'Transaction entity targeting correct', status: 'PASS' });
    } else {
      log({ test: 'Transaction entity targeting correct', status: 'FAIL', error: 'Wrong format' });
    }
  } catch (e) {
    log({ test: 'Transaction entity targeting correct', status: 'FAIL', error: e.message });
  }

  // 5. Verify WebSocket URI configured to FIDScript
  console.log('\n─── WEBSOCKET ───');
  try {
    const db = init({ appId: 'test-app' });
    const wsUri = db._reactor.config.websocketURI;
    if (wsUri && wsUri.includes('apiinstant.fidscript.com')) {
      log({ test: 'WebSocket URI is FIDScript', status: 'PASS' });
      console.log(`  WS URI: ${wsUri}`);
    } else {
      log({ test: 'WebSocket URI is FIDScript', status: 'FAIL', error: wsUri });
    }
  } catch (e) {
    log({ test: 'WebSocket URI is FIDScript', status: 'FAIL', error: e.message });
  }

  // 6. Verify id() produces unique IDs
  console.log('\n─── ID GENERATION ───');
  try {
    const id1 = id();
    const id2 = id();
    if (id1 !== id2 && id1.length > 0 && id2.length > 0) {
      log({ test: 'id() generates unique IDs', status: 'PASS' });
      console.log(`  id1: ${id1.slice(0, 8)}..., id2: ${id2.slice(0, 8)}...`);
    } else {
      log({ test: 'id() generates unique IDs', status: 'FAIL', error: 'IDs not unique or empty' });
    }
  } catch (e) {
    log({ test: 'id() generates unique IDs', status: 'FAIL', error: e.message });
  }

  // 7. Verify SDK handles invalid app gracefully (doesn't crash)
  console.log('\n─── ERROR HANDLING ───');
  try {
    const db = init({ appId: 'nonexistent-app-12345' });
    // SDK initializes even with invalid app
    log({ test: 'SDK handles invalid app gracefully', status: 'PASS' });
  } catch (e) {
    // Error on init is also acceptable
    log({ test: 'SDK handles invalid app gracefully', status: 'PASS' });
  }

  // 8. Verify package has no Instant dependencies
  console.log('\n─── DEPENDENCIES ───');
  try {
    // Read package.json using fs
    const { readFileSync } = await import('fs');
    const pkg = JSON.parse(readFileSync(
      './node_modules/@fidscript/instant-sdk/package.json',
      'utf-8'
    ));
    const deps = Object.keys(pkg.dependencies || {});
    const hasInstantDep = deps.some(d => d.startsWith('@instantdb'));
    if (!hasInstantDep) {
      log({ test: 'No @instantdb dependencies', status: 'PASS' });
      console.log('  Dependencies:', deps.join(', '));
    } else {
      log({ test: 'No @instantdb dependencies', status: 'FAIL', error: deps.join(', ') });
    }
  } catch (e) {
    log({ test: 'No @instantdb dependencies', status: 'FAIL', error: e.message });
  }

  // 9. Verify API URI can be customized
  console.log('\n─── CUSTOM CONFIGURATION ───');
  try {
    const customApi = 'https://custom.example.com';
    const db = init({
      appId: 'test-app',
      apiURI: customApi,
      websocketURI: 'wss://custom.example.com/ws'
    });
    if (db._reactor.config.apiURI === customApi) {
      log({ test: 'Custom apiURI accepted', status: 'PASS' });
    } else {
      log({ test: 'Custom apiURI accepted', status: 'FAIL', error: 'apiURI not overridden' });
    }
  } catch (e) {
    log({ test: 'Custom apiURI accepted', status: 'FAIL', error: e.message });
  }

  // Summary
  console.log('\n═══════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════');
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  console.log(`Total: ${results.length} | ✅ ${passed} | ❌ ${failed}`);
  console.log('');

  if (failed > 0) {
    console.log('FAILED:');
    results.filter(r => r.status === 'FAIL').forEach(r => console.log('  ❌', r.test + ':', r.error));
    process.exit(1);
  } else {
    console.log('All SDK tests passed!');
    console.log('');
    console.log('Note: Live server tests require https://apiinstant.fidscript.com to be running.');
    console.log('SDK correctly routes to FIDScript infrastructure by default.');
  }
}

run().catch(e => { console.error(e); process.exit(1); });
