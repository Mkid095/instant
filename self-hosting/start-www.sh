#!/bin/sh
set -eu

# Generate config
node <<'NODE'
const fs = require('fs');
const apiURI = (process.env.INSTANT_API_URI || process.env.INSTANT_BACKEND_URL || '').trim();
try {
  const url = new URL(apiURI);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Unsupported protocol');
  }
} catch (_e) {
  console.error('INSTANT_API_URI or INSTANT_BACKEND_URL must be a valid HTTP(S) URL.');
  process.exit(1);
}
fs.writeFileSync(
  '/app/www/public/publicSelfHostedVariables.js',
  `window.__instantConfig = ${JSON.stringify({ apiURI })};\n`,
);
NODE

exec node www/server.js
