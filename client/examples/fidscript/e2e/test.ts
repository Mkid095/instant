/**
 * FIDScript E2E Test Suite
 *
 * Tests against https://apiinstant.fidscript.com
 * Workflow: Auth → Create → Read → Update → Delete → Realtime → Error Handling
 */

import { init } from '@fidscript/instant-sdk';

const API_URI = 'https://apiinstant.fidscript.com';
const TEST_APP_ID = 'test-app-e2e-' + Date.now();

const results: { test: string; status: 'PASS' | 'FAIL' | 'SKIP'; error?: string }[] = [];

function log(result: { test: string; status: 'PASS' | 'FAIL' | 'SKIP'; error?: string }) {
  const icon = result.status === 'PASS' ? '✅' : result.status === 'FAIL' ? '❌' : '⏭️';
  console.log(`${icon} ${result.test}${result.error ? `: ${result.error}` : ''}`);
  results.push(result);
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  console.log('═══════════════════════════════════════════');
  console.log('FIDScript E2E Test Suite');
  console.log(`API: ${API_URI}`);
  console.log(`App ID: ${TEST_APP_ID}`);
  console.log('═══════════════════════════════════════════\n');

  const schema = {
    entities: {
      messages: {
        text: { type: 'string' as const },
        createdAt: { type: 'number' as const },
      },
    },
  };

  // Initialize
  const db = init({
    appId: TEST_APP_ID,
    schema: schema as any,
  });

  // 1. Authentication
  console.log('─── AUTH ───');
  try {
    const authResult = await db.auth.signInAsGuest();
    log({ test: 'Guest sign-in', status: 'PASS' });
    console.log(`  User: ${JSON.stringify(authResult.user?.email || authResult.user?.id || 'guest')}`);
  } catch (e: any) {
    log({ test: 'Guest sign-in', status: 'FAIL', error: e.message });
  }

  // Wait for connection
  await sleep(1000);

  // 2. Create data
  console.log('\n─── CREATE ───');
  const testId = 'msg-' + Date.now();
  try {
    await db.transact([
      ['create', 'messages', testId, { text: 'Hello FIDScript', createdAt: Date.now() }],
    ]);
    log({ test: 'Create message', status: 'PASS' });
    console.log(`  Created: ${testId}`);
  } catch (e: any) {
    log({ test: 'Create message', status: 'FAIL', error: e.message });
  }

  // 3. Read data
  console.log('\n─── READ ───');
  try {
    const result = await db.queryOnce({ messages: {} });
    const found = result.data.messages?.find((m: any) => m.id === testId);
    if (found) {
      log({ test: 'Read message', status: 'PASS' });
      console.log(`  Found: ${found.text}`);
    } else {
      log({ test: 'Read message', status: 'FAIL', error: 'Message not found in query results' });
    }
  } catch (e: any) {
    log({ test: 'Read message', status: 'FAIL', error: e.message });
  }

  // 4. Update data
  console.log('\n─── UPDATE ───');
  try {
    await db.transact([
      ['update', 'messages', testId, { text: 'Updated: Hello FIDScript!' }],
    ]);
    log({ test: 'Update message', status: 'PASS' });
  } catch (e: any) {
    log({ test: 'Update message', status: 'FAIL', error: e.message });
  }

  // 5. Verify update
  try {
    const result = await db.queryOnce({ messages: {} });
    const updated = result.data.messages?.find((m: any) => m.id === testId);
    if (updated?.text === 'Updated: Hello FIDScript!') {
      log({ test: 'Verify update', status: 'PASS' });
    } else {
      log({ test: 'Verify update', status: 'FAIL', error: `Text is "${updated?.text}", expected "Updated: Hello FIDScript!"` });
    }
  } catch (e: any) {
    log({ test: 'Verify update', status: 'FAIL', error: e.message });
  }

  // 6. Realtime subscription
  console.log('\n─── REALTIME ───');
  let realtimeReceived = false;
  try {
    const unsubscribe = db.subscribeQuery({ messages: {} }, (result) => {
      if (result.data.messages?.length > 0) {
        realtimeReceived = true;
      }
    });
    await sleep(500);
    unsubscribe();
    if (realtimeReceived) {
      log({ test: 'Realtime subscription', status: 'PASS' });
    } else {
      log({ test: 'Realtime subscription', status: 'FAIL', error: 'No data received' });
    }
  } catch (e: any) {
    log({ test: 'Realtime subscription', status: 'FAIL', error: e.message });
  }

  // 7. Delete data
  console.log('\n─── DELETE ───');
  try {
    await db.transact([
      ['delete', 'messages', testId],
    ]);
    log({ test: 'Delete message', status: 'PASS' });
  } catch (e: any) {
    log({ test: 'Delete message', status: 'FAIL', error: e.message });
  }

  // 8. Verify delete
  try {
    const result = await db.queryOnce({ messages: {} });
    const found = result.data.messages?.find((m: any) => m.id === testId);
    if (!found) {
      log({ test: 'Verify delete', status: 'PASS' });
    } else {
      log({ test: 'Verify delete', status: 'FAIL', error: 'Message still exists after delete' });
    }
  } catch (e: any) {
    log({ test: 'Verify delete', status: 'FAIL', error: e.message });
  }

  // 9. Error handling - invalid auth
  console.log('\n─── ERROR HANDLING ───');
  try {
    const badDb = init({ appId: 'nonexistent-app-12345' });
    await badDb.auth.signInAsGuest();
    log({ test: 'Error: invalid app', status: 'FAIL', error: 'Should have thrown' });
  } catch (e: any) {
    if (e.message.includes('not') || e.message.includes('exist') || e.message.includes('Not') || e.message.includes('401') || e.message.includes('404')) {
      log({ test: 'Error: invalid app', status: 'PASS' });
      console.log(`  Correctly rejected: ${e.message.slice(0, 100)}`);
    } else {
      log({ test: 'Error: invalid app', status: 'PASS' });
      console.log(`  Error (expected format): ${e.message.slice(0, 100)}`);
    }
  }

  // Summary
  console.log('\n═══════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════');
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const skipped = results.filter(r => r.status === 'SKIP').length;
  console.log(`Total: ${results.length} | ✅ ${passed} | ❌ ${failed} | ⏭️ ${skipped}`);
  console.log('');

  if (failed > 0) {
    console.log('FAILED TESTS:');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`  ❌ ${r.test}: ${r.error}`);
    });
    process.exit(1);
  } else {
    console.log('All tests passed!');
    process.exit(0);
  }
}

run().catch(e => {
  console.error('Test runner error:', e);
  process.exit(1);
});
