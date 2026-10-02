// Detailed MCP tools/list breakdown by component
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
const client = new Client({ name: 'measure-detailed', version: '1.0.0' }, { capabilities: {} });
await client.connect(transport);

const result = await client.listTools();
const tools = result.tools;

const totals = {
  tool_name: 0,
  description: 0,
  property_names: 0,
  property_descriptions: 0,
  enums: 0,
  defaults: 0,
  required_meta: 0,
  other_metadata: 0,
  total_chars: 0,
};

const perTool = tools.map((t) => {
  const nameChars = (t.name || '').length;
  const descChars = (t.description || '').length;
  let propNames = 0;
  let propDescs = 0;
  let enumChars = 0;
  let defaultChars = 0;
  let requiredChars = 0;
  let otherMeta = 0;

  const props = t.inputSchema?.properties || {};
  const required = t.inputSchema?.required || [];

  for (const [k, v] of Object.entries(props)) {
    propNames += k.length + JSON.stringify(k).length;
    if (v.description) propDescs += v.description.length + JSON.stringify(v.description).length;
    if (v.enum) {
      const enumStr = JSON.stringify(v.enum);
      enumChars += enumStr.length;
    }
    if (v.default !== undefined) defaultChars += JSON.stringify(v.default).length + 8; // ,"default":
    if (v.type) otherMeta += JSON.stringify(v.type).length + 8;
    if (v.format) otherMeta += JSON.stringify(v.format).length + 10;
    if (v.minimum !== undefined) otherMeta += 12;
    if (v.maximum !== undefined) otherMeta += 12;
    if (v.pattern) otherMeta += JSON.stringify(v.pattern).length + 12;
  }
  requiredChars = JSON.stringify(required).length;

  const totalForTool = nameChars + descChars + propNames + propDescs + enumChars + defaultChars + requiredChars + otherMeta + 60; // JSON overhead

  totals.tool_name += nameChars;
  totals.description += descChars;
  totals.property_names += propNames;
  totals.property_descriptions += propDescs;
  totals.enums += enumChars;
  totals.defaults += defaultChars;
  totals.required_meta += requiredChars;
  totals.other_metadata += otherMeta;
  totals.total_chars += totalForTool;

  return {
    name: t.name,
    description_chars: descChars,
    description_tokens: Math.ceil(descChars / 4),
    schema_chars: propNames + propDescs + enumChars + defaultChars + requiredChars + otherMeta,
    schema_tokens: Math.ceil((propNames + propDescs + enumChars + defaultChars + requiredChars + otherMeta) / 4),
    total_chars: totalForTool,
    total_tokens: Math.ceil(totalForTool / 4),
    prop_count: Object.keys(props).length,
    fields_with_descriptions: Object.values(props).filter((v) => v.description).length,
  };
});

// Total JSON size
const fullSerialized = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools } });
const fullSize = fullSerialized.length;

console.log('=== STEP 1: BASELINE BREAKDOWN ===');
console.log(`Total serialized tools/list: ${fullSize} chars (${Math.ceil(fullSize/4)} tokens)`);
console.log(`Tools count: ${tools.length}`);
console.log();
console.log('Component breakdown:');
for (const [k, v] of Object.entries(totals)) {
  if (k === 'total_chars') continue;
  console.log(`  ${k.padEnd(22)} ${String(v).padStart(7)} chars  ~${Math.ceil(v/4)} tokens`);
}
console.log();
console.log('Note: total_chars includes per-tool JSON wrapping overhead (~60 chars/tool)');
console.log(`Sum of components: ${totals.total_chars} chars (vs actual JSON: ${fullSize} chars)`);
console.log();

// Sort by total size
perTool.sort((a, b) => b.total_chars - a.total_chars);

console.log('=== STEP 2: TOP 20 LARGEST TOOLS ===');
console.log('name                              | desc_chars | schema_chars | fields | with-desc | total_chars | ~tokens');
console.log('-'.repeat(110));
for (const t of perTool.slice(0, 20)) {
  const name = t.name.padEnd(35);
  console.log(`${name} | ${String(t.description_chars).padStart(10)} | ${String(t.schema_chars).padStart(12)} | ${String(t.prop_count).padStart(6)} | ${String(t.fields_with_descriptions).padStart(10)} | ${String(t.total_chars).padStart(11)} | ${String(t.total_tokens).padStart(7)}`);
}

await client.close();

// Emit data for further analysis
import { writeFileSync } from 'node:fs';
writeFileSync('/tmp/mcp-tools-analysis.json', JSON.stringify({
  totals,
  fullSize,
  tools: perTool,
}, null, 2));
