// Measure MCP tools/list response size and approximate token count
// Spawns the MCP server, sends tools/list, measures the response

import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function measure(version = 'current') {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['/home/ken/projects/core/instant/client/packages/fidscript-mcp/dist/index.js'],
    env: {
      ...process.env,
      INSTANT_API_URI: 'https://apiinstant.fidscript.com',
      INSTANT_ACCESS_TOKEN: 'per_21442d466d63e1fbdd0ccfb0bad79007502e52e8de0574c8a2a6a08edff2163e',
    },
  });
  const client = new Client({ name: 'measure', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);

  const result = await client.listTools();
  const tools = result.tools;

  // Serialize as the MCP server would
  const serialized = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    result: { tools },
  });

  // Approximate token count (chars / 4 is a rough heuristic for English/code)
  const approxTokens = Math.ceil(serialized.length / 4);

  console.log(`[${version}]`);
  console.log(`  Tools: ${tools.length}`);
  console.log(`  Serialized tools/list: ${serialized.length} chars`);
  console.log(`  Approx tokens: ${approxTokens}`);

  // Check for duplicates
  const names = tools.map(t => t.name);
  const unique = new Set(names);
  console.log(`  Unique names: ${unique.size}`);
  console.log(`  Duplicates: ${tools.length - unique.size}`);
  if (tools.length > unique.size) {
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    console.log(`  Sample dupes: ${[...new Set(dupes)].slice(0, 5).join(', ')}`);
  }

  await client.close();
  return { tools: tools.length, chars: serialized.length, tokens: approxTokens };
}

await measure(process.argv[2] || 'current');
