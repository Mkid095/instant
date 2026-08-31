#!/usr/bin/env node
/**
 * Documentation URL Validator
 *
 * Scans documentation source for hardcoded production URLs that should be
 * deployment-aware. This helps catch accidental leaks of Instant Cloud URLs
 * into self-hosted documentation.
 *
 * Usage: node scripts/check-docs-urls.js
 *
 * Exit codes:
 *   0 - All checks passed
 *   1 - Issues found (see output)
 */

const fs = require('fs');
const path = require('path');

const DOCS_DIR = path.join(__dirname, '../app/docs');

// URLs that are acceptable (not errors)
const WHITELISTED_URLS = [
  // Instant Cloud - legitimate upstream references
  'https://instantdb.com',
  'https://api.instantdb.com',
  'https://www.instantdb.com',
  'wss://api.instantdb.com',

  // SDK default values in documentation (these document what the SDK defaults to)
  // These are NOT pointing to actual endpoints - they document SDK behavior
  "'wss://api.instantdb.com/runtime/session'",
  "'https://api.instantdb.com'",

  // External third-party services - correctly external
  'https://github.com/instantdb',
  'https://discord.gg',
  'https://twitter.com',
  'https://npmjs.com',
  'https://stripe.com',
  'https://postmarkapp.com',
  'https://sendgrid.com',
  'https://digitalocean.com',
  'https://hetzner.com',
  'https://vercel.com',
  'https://nextjs.org',
  'https://nodejs.org',
  'https://typescriptlang.org',

  // Demo instances - not production
  'https://demo.instantdb.com',
  'wss://demo.instantdb.com',

  // Local development - acceptable in dev docs
  'http://localhost:',
  'http://127.0.0.1:',

  // Example data - not real endpoints
  'alyssa@instantdb.com',
  'dww@instantdb.com',
];

// URL patterns that should be flagged
const SUSPICIOUS_PATTERNS = [
  {
    pattern: /https:\/\/api\.instantdb\.com/g,
    message: 'Found api.instantdb.com - this should use a deployment-aware variable for self-hosted',
    severity: 'warning',
  },
  {
    pattern: /wss:\/\/api\.instantdb\.com/g,
    message: 'Found wss://api.instantdb.com - this should use a deployment-aware variable for self-hosted',
    severity: 'warning',
  },
  {
    pattern: /https:\/\/www\.instantdb\.com/g,
    message: 'Found www.instantdb.com - verify this is an intentional upstream reference',
    severity: 'info',
  },
];

// Files to skip
const SKIP_FILES = [
  // Generated files
  'node_modules',
  '.next',
  'dist',
];

function shouldSkip(filePath) {
  return SKIP_FILES.some(skip => filePath.includes(skip));
}

function isWhitelisted(url) {
  return WHITELISTED_URLS.some(whitelisted => {
    if (whitelisted.endsWith('/')) {
      return url.startsWith(whitelisted);
    }
    return url === whitelisted || url.startsWith(whitelisted + '/');
  });
}

function extractUrls(content) {
  const urlRegex = /https?:\/\/[^\s<>"'\)]+/g;
  const urls = content.match(urlRegex) || [];
  const wssRegex = /wss?:\/\/[^\s<>"'\)]+/g;
  const wssUrls = content.match(wssRegex) || [];
  return [...urls, ...wssUrls];
}

function scanFile(filePath) {
  if (shouldSkip(filePath)) {
    return { issues: [], skipped: true };
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const issues = [];

  for (const { pattern, message, severity } of SUSPICIOUS_PATTERNS) {
    const matches = content.match(pattern);
    if (matches) {
      // Check if each match is whitelisted
      for (const match of matches) {
        if (!isWhitelisted(match)) {
          issues.push({
            file: path.relative(process.cwd(), filePath),
            url: match,
            message,
            severity,
          });
        }
      }
    }
  }

  return { issues, skipped: false };
}

function scanDirectory(dir) {
  let allIssues = [];
  let filesScanned = 0;

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (!shouldSkip(fullPath)) {
          walk(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (['.md', '.tsx', '.ts', '.jsx', '.js'].includes(ext)) {
          filesScanned++;
          const { issues } = scanFile(fullPath);
          allIssues = allIssues.concat(issues);
        }
      }
    }
  }

  walk(dir);
  return { issues: allIssues, filesScanned };
}

function main() {
  console.log('🔍 Scanning documentation for hardcoded production URLs...\n');

  const { issues, filesScanned } = scanDirectory(DOCS_DIR);

  console.log(`📄 Scanned ${filesScanned} files\n`);

  if (issues.length === 0) {
    console.log('✅ No suspicious hardcoded production URLs found!');
    process.exit(0);
  }

  // Group by severity
  const warnings = issues.filter(i => i.severity === 'warning');
  const infos = issues.filter(i => i.severity === 'info');

  if (warnings.length > 0) {
    console.log(`⚠️  Found ${warnings.length} warning(s):\n`);
    for (const issue of warnings) {
      console.log(`  ${issue.file}`);
      console.log(`    URL: ${issue.url}`);
      console.log(`    ${issue.message}\n`);
    }
  }

  if (infos.length > 0) {
    console.log(`ℹ️  Found ${infos.length} info message(s):\n`);
    for (const issue of infos) {
      console.log(`  ${issue.file}`);
      console.log(`    URL: ${issue.url}`);
      console.log(`    ${issue.message}\n`);
    }
  }

  console.log('\n📝 Note: Whitelisted URLs include:');
  console.log('  - Instant Cloud upstream references (appropriate for documentation)');
  console.log('  - External third-party services (GitHub, npm, etc.)');
  console.log('  - Localhost development URLs');
  console.log('  - Example/demo data\n');

  process.exit(warnings.length > 0 ? 1 : 0);
}

main();
