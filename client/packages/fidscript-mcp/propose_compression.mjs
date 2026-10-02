// Propose before/after compression for the largest tools
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
const client = new Client({ name: 'propose', version: '1.0.0' }, { capabilities: {} });
await client.connect(transport);
const result = await client.listTools();
const tools = result.tools;

// Compute top-10 by description+schema size
const ranked = tools.slice().map(t => {
  const props = t.inputSchema?.properties || {};
  const descChars = (t.description || '').length;
  let schemaChars = 0;
  for (const [, v] of Object.entries(props)) {
    schemaChars += JSON.stringify(v).length;
  }
  return { name: t.name, descChars, schemaChars, total: descChars + schemaChars };
}).sort((a, b) => b.total - a.total);

console.log('=== TOP 10 COMPRESSION TARGETS ===\n');
for (const t of ranked.slice(0, 10)) {
  console.log(`${t.name.padEnd(28)} | desc: ${String(t.descChars).padStart(5)} | schema: ${String(t.schemaChars).padStart(5)} | total: ${t.total}`);
}

await client.close();
