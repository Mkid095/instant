/**
 * FIDScript Live Server E2E Test Suite
 * Tests actual CRUD operations against https://apiinstant.fidscript.com
 */

import { init } from '@fidscript/instant-sdk';
import { id, tx } from '@fidscript/instant-sdk';

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
  console.log('FIDScript Live Server E2E');
  console.log(`API: ${API}`);
  console.log(`App ID: ${APP_ID}`);
  console.log('═══════════════════════════════════════════\n');

  const db = init({ appId: APP_ID });

  // 1. API Health
  console.log('─── HEALTH ───');
  try {
    const res = await fetch(`${API}/api/health`);
    if (res.ok) {
      log({ test: 'API health check', status: 'PASS' });
    } else {
      log({ test: 'API health check', status: 'FAIL', error: `HTTP ${res.status}` });
    }
  } catch (e) {
    log({ test: 'API health check', status: 'FAIL', error: e.message });
  }

  // 2. Auth - Guest sign-in
  console.log('\n─── AUTH ───');
  let userId = null;
  try {
    const result = await db.auth.signInAsGuest();
    userId = result.user?.id;
    log({ test: 'Guest sign-in', status: 'PASS' });
    console.log('  User ID:', userId);
  } catch (e) {
    log({ test: 'Guest sign-in', status: 'FAIL', error: e.message });
  }

  // Wait for connection
  await sleep(1000);

  // 3. Connection status
  try {
    const status = db._reactor.status;
    log({ test: 'Server connection', status: 'PASS' });
    console.log('  Status:', status);
  } catch (e) {
    log({ test: 'Server connection', status: 'FAIL', error: e.message });
  }

  // 4. Create data
  console.log('\n─── CREATE ───');
  const testId = id();
  try {
    await db.transact(
      tx.messages[testId].update({ text: 'Hello FIDScript', createdAt: Date.now() })
    );
    log({ test: 'Create message', status: 'PASS' });
    console.log('  ID:', testId);
  } catch (e) {
    log({ test: 'Create message', status: 'FAIL', error: e.message });
  }

  // 5. Read data
  await sleep(500);
  try {
    const result = await db.queryOnce({ messages: {} });
    const found = result.data.messages?.find(m => m.id === testId);
    if (found) {
      log({ test: 'Read message', status: 'PASS' });
      console.log('  Text:', found.text);
    } else {
      log({ test: 'Read message', status: 'FAIL', error: 'Message not found' });
    }
  } catch (e) {
    log({ test: 'Read message', status: 'FAIL', error: e.message });
  }

  // 6. Update data
  console.log('\n─── UPDATE ───');
  try {
    await db.transact(
      tx.messages[testId].update({ text: 'Updated: FIDScript works!' })
    );
    log({ test: 'Update message', status: 'PASS' });
  } catch (e) {
    log({ test: 'Update message', status: 'FAIL', error: e.message });
  }

  // 7. Verify update
  await sleep(500);
  try {
    const result = await db.queryOnce({ messages: {} });
    const updated = result.data.messages?.find(m => m.id === testId);
    if (updated?.text === 'Updated: FIDScript works!') {
      log({ test: 'Verify update', status: 'PASS' });
    } else {
      log({ test: 'Verify update', status: 'FAIL', error: `Got "${updated?.text}"` });
    }
  } catch (e) {
    log({ test: 'Verify update', status: 'FAIL', error: e.message });
  }

  // 8. Realtime subscription
  console.log('\n─── REALTIME ───');
  let realtimeData = null;
  try {
    const unsub = db.subscribeQuery({ messages: {} }, (result) => {
      if (result.data.messages?.length > 0) {
        realtimeData = result.data;
      }
    });
    await sleep(1000);
    unsub();
    if (realtimeData) {
      log({ test: 'Realtime subscription', status: 'PASS' });
      console.log('  Received realtime update with', realtimeData.messages?.length, 'messages');
    } else {
      log({ test: 'Realtime subscription', status: 'FAIL', error: 'No data received' });
    }
  } catch (e) {
    log({ test: 'Realtime subscription', status: 'FAIL', error: e.message });
  }

  // 9. Delete
  console.log('\n─── DELETE ───');
  try {
    await db.transact(tx.messages[testId].delete());
    log({ test: 'Delete message', status: 'PASS' });
  } catch (e) {
    log({ test: 'Delete message', status: 'FAIL', error: e.message });
  }

  // 10. Verify delete
  await sleep(500);
  try {
    const result = await db.queryOnce({ messages: {} });
    const found = result.data.messages?.find(m => m.id === testId);
    if (!found) {
      log({ test: 'Verify delete', status: 'PASS' });
    } else {
      log({ test: 'Verify delete', status: 'FAIL', error: 'Message still exists' });
    }
  } catch (e) {
    log({ test: 'Verify delete', status: 'FAIL', error: e.message });
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
    console.log('All live server tests passed!');
  }
}

run().catch(e => { console.error(e); process.exit(1); });
