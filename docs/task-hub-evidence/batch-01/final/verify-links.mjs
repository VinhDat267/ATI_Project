import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../../../');

// 12 primary documentation and report files to verify
const targetDocs = [
  'docs/TASK-HUB-STATUS-2026-09-13.md',
  'README.md',
  'docs/BASELINE.md',
  'docs/00-BAT-DAU.md',
  'docs/KE-HOACH-6-TUAN.md',
  'docs/EXECUTION-CONTRACT.md',
  'db/DATABASE.md',
  'testdata/TESTDATA.md',
  'apps/mcp-task-hub/README.md',
  'packages/engine/README.md',
  'docs/task-hub-evidence/batch-01/TH-07.md',
  'docs/task-hub-evidence/batch-01/final/README.md',
];

// Documented future/skeleton scopes that may appear as bare paths in text (not markdown links)
const plannedBarePaths = new Set([
  'apps/api',
  'apps/web',
]);

console.log('================================================================');
console.log('ATI Platform Documentation & Link Integrity Checker');
console.log(`Root directory: ${rootDir}`);
console.log(`Checking ${targetDocs.length} documentation files...`);
console.log('================================================================\n');

let missingSourceDocs = 0;
let totalLinksChecked = 0;
let brokenLinks = 0;
const plannedBarePathsFound = new Set();

for (const relDoc of targetDocs) {
  const fullDocPath = path.resolve(rootDir, relDoc);
  if (!fs.existsSync(fullDocPath)) {
    console.error(`[ERROR] Target documentation file missing: ${relDoc}`);
    missingSourceDocs++;
    continue;
  }

  const content = fs.readFileSync(fullDocPath, 'utf8');

  // Exclude fenced code blocks (```...```) to prevent false positives from code examples
  const strippedContent = content.replace(/```[\s\S]*?```/g, '');

  // 1. Verify markdown links: [text](target)
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match;
  let fileLinksCount = 0;

  while ((match = linkRegex.exec(strippedContent)) !== null) {
    const rawLink = match[2].trim();

    // Skip external URLs, mailto, and pure in-page anchors
    if (
      rawLink.startsWith('http://') ||
      rawLink.startsWith('https://') ||
      rawLink.startsWith('mailto:') ||
      rawLink.startsWith('#')
    ) {
      continue;
    }

    // Strip hash anchor if present (e.g. file.md#section -> file.md)
    const [linkTarget] = rawLink.split('#');
    if (!linkTarget) continue;

    totalLinksChecked++;
    fileLinksCount++;

    const resolvedTarget = path.resolve(path.dirname(fullDocPath), linkTarget);
    if (!fs.existsSync(resolvedTarget)) {
      console.error(`[BROKEN LINK] in ${relDoc}:`);
      console.error(`  Link syntax: [${match[1]}](${rawLink})`);
      console.error(`  Resolved to: ${resolvedTarget}`);
      brokenLinks++;
    }
  }

  // 2. Scan text outside code fences for bare path references and distinguish planned bare paths
  const barePathRegex = /\b(apps\/[a-z0-9_-]+|packages\/[a-z0-9_-]+|docs\/[a-z0-9_.-]+)\b/g;
  let bareMatch;
  while ((bareMatch = barePathRegex.exec(strippedContent)) !== null) {
    const candidate = bareMatch[1];
    if (plannedBarePaths.has(candidate)) {
      plannedBarePathsFound.add(candidate);
    }
  }

  console.log(`[OK] ${relDoc} (${fileLinksCount} internal markdown links verified)`);
}

console.log('\n================================================================');
console.log('Integrity Verification Summary:');
console.log(`- Documentation files checked: ${targetDocs.length}`);
console.log(`- Missing documentation files: ${missingSourceDocs}`);
console.log(`- Internal markdown links checked: ${totalLinksChecked}`);
console.log(`- Broken links detected: ${brokenLinks}`);
console.log(`- Planned bare paths distinguished: ${Array.from(plannedBarePathsFound).join(', ') || 'none'}`);
console.log('================================================================\n');

if (missingSourceDocs > 0 || brokenLinks > 0) {
  console.error('[FAIL] Documentation or link integrity check failed.');
  process.exit(1);
} else {
  console.log('[PASS] All documentation files and internal links are intact.');
  process.exit(0);
}
