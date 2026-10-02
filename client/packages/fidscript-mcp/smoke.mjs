// Smoke test representative tools from each domain
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node',
  args: ['/home/ken/projects/core/instant/client/packages/fidscript-mcp/dist/index.js'],
  env: {
    ...process.env,
    INSTANT_API_URI: 'https://apiinstant.fidscript.com',
    INSTANT_ACCESS_TOKEN: 'per_21442d466d63e1fbdd0ccfb0bad79007502e52e8de0574c8a2a6a08edff2163e',
    INSTANT_APP_ID: '5b6b71eb-f36b-45c7-90a6-a475a71621b4',
  },
});
const client = new Client({ name: 'smoke', version: '1.0.0' }, { capabilities: {} });
await client.connect(transport);

const tests = [
  // domain, tool, args
  ['auth',          'send-magic-code',                  { email: 'test@example.com' }],
  ['apps',          'list-apps',                         {}],
  ['schema',        'get-schema',                        { appId: '5b6b71eb-f36b-45c7-90a6-a475a71621b4' }],
  ['query',         'query',                             { appId: '5b6b71eb-f36b-45c7-90a6-a475a71621b4', query: { todos: {} } }],
  ['transact',      'transact',                          { appId: '5b6b71eb-f36b-45c7-90a6-a475a71621b4', steps: [] }],
  ['storage',       'get-storage-config',                { appId: '5b6b71eb-f36b-45c7-90a6-a475a71621b4' }],
  ['storage-url',   'get-upload-url',                    { appId: '5b6b71eb-f36b-45c7-90a6-a475a71621b4', path: 'smoke-test/foo.png' }],
  ['oauth',         'list-oauth-providers',              { appId: '5b6b71eb-f36b-45c7-90a6-a475a71621b4' }],
  ['pat',           'list-personal-access-tokens',       {}],
  ['webhooks',      'list-webhooks',                     { appId: '5b6b71eb-f36b-45c7-90a6-a475a71621b4' }],
  ['backups',       'list-backups',                      { appId: '5b6b71eb-f36b-45c7-90a6-a475a71621b4' }],
  ['email',         'get-email-template',                { appId: '5b6b71eb-f36b-45c7-90a6-a475a71621b4' }],
  ['org',           'list-orgs',                         {}],
  ['perms',         'get-perms',                         { appId: '5b6b71eb-f36b-45c7-90a6-a475a71621b4' }],
  ['learn',         'learn',                             {}],
];

let pass = 0, fail = 0;
for (const [domain, name, args] of tests) {
  try {
    const r = await client.callTool({ name, arguments: args });
    const ok = !r.isError && r.content;
    console.log(`[${ok ? '✓' : '✗'}] ${domain.padEnd(12)} ${name.padEnd(35)} (${r.content?.[0]?.text?.length || 0} chars)`);
    if (ok) pass++; else fail++;
  } catch (e) {
    console.log(`[✗] ${domain.padEnd(12)} ${name.padEnd(35)} ERROR: ${e.message?.slice(0, 80)}`);
    fail++;
  }
}
console.log(`\nResult: ${pass} passed, ${fail} failed of ${tests.length}`);
await client.close();
process.exit(fail > 0 ? 1 : 0);
