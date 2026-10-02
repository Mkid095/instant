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
const client = new Client({ name: 'inspect', version: '1.0.0' }, { capabilities: {} });
await client.connect(transport);
const result = await client.listTools();
const tools = result.tools;

// Top 10 descriptions and field descriptions
const sorted = tools.slice().sort((a, b) => (b.description?.length || 0) - (a.description?.length || 0));
console.log('=== TOP 10 LONGEST TOOL DESCRIPTIONS ===\n');
for (const t of sorted.slice(0, 10)) {
  console.log(`### ${t.name} (${t.description?.length || 0} chars)`);
  console.log(t.description);
  console.log();
  console.log('Field descriptions:');
  const props = t.inputSchema?.properties || {};
  for (const [k, v] of Object.entries(props)) {
    if (v.description) {
      console.log(`  ${k}: "${v.description}"`);
    }
  }
  console.log('-'.repeat(80));
}

await client.close();
