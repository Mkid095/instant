// Focused test: ensures no underscore-alias duplicates in the MCP tool list.
// Spawns the actual server, requests tools/list, and asserts:
//   1. total tools = 65 (no underscore aliases)
//   2. no tool name appears more than once
//   3. no tool name contains an underscore (canonical names are hyphenated)

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node',
  args: [new URL('./dist/index.js', import.meta.url).pathname],
  env: {
    ...process.env,
    INSTANT_API_URI: 'https://apiinstant.fidscript.com',
    INSTANT_ACCESS_TOKEN: 'per_21442d466d63e1fbdd0ccfb0bad79007502e52e8de0574c8a2a6a08edff2163e',
  },
});
const client = new Client({ name: 'dup-test', version: '1.0.0' }, { capabilities: {} });
await client.connect(transport);

const result = await client.listTools();
const tools = result.tools;

const errors = [];

if (tools.length !== 76) {
  errors.push(`Expected 76 tools (67 baseline + 9 android), got ${tools.length}`);
}

const names = tools.map((t) => t.name);
const seen = new Map();
for (const n of names) {
  seen.set(n, (seen.get(n) ?? 0) + 1);
}
const dups = [...seen.entries()].filter(([, c]) => c > 1);
if (dups.length > 0) {
  errors.push(`Duplicate tool names: ${JSON.stringify(dups)}`);
}

const underscored = names.filter((n) => n.includes('_'));
if (underscored.length > 0) {
  errors.push(`Tools with underscore (should be hyphenated only): ${JSON.stringify(underscored)}`);
}

await client.close();

if (errors.length > 0) {
  console.error('FAIL:');
  for (const e of errors) console.error('  -', e);
  process.exit(1);
} else {
  console.log(`PASS: ${tools.length} tools, no duplicates, no underscore aliases`);
  process.exit(0);
}
