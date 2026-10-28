import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

const isWin = process.platform === 'win32';
const npmCli = process.env.npm_execpath || (isWin ? 'npm.cmd' : 'npm');

const mutations = [
  {
    id: 'M1',
    name: 'Rơi về sheets.* chung khi chưa kết nối mysheets (mayFallbackToShared)',
    file: 'apps/chat-api/src/config/gmail-tools-runtime.ts',
    target: "if (mysheetsEnabled && routed.includes('mysheets')) return false;",
    mutated: "// MUTATION M1: if (mysheetsEnabled && routed.includes('mysheets')) return false;",
    command: ['test', '-w', '@wap/chat-api', '--', 'tests/routes/mysheets-services.test.ts', '-t', 'mayFallbackToShared prevents shared fallback when mysheets intent is routed'],
  },
  {
    id: 'M2',
    name: 'Cho mysheets.* vào catalog khi đang scope_required',
    file: 'apps/chat-api/src/services/registered-services.ts',
    target: "if (spreadsheets.length > 0) {\n          catalog = [...catalog, ...MYSHEETS_TOOLS];\n        }",
    mutated: "if (true) {\n          catalog = [...catalog, ...MYSHEETS_TOOLS];\n        }",
    command: ['test', '-w', '@wap/chat-api', '--', 'tests/routes/mysheets-services.test.ts', '-t', 'excludes MYSHEETS_TOOLS in getToolCatalogFor when in scope_required state'],
  },
  {
    id: 'M3a',
    name: 'PUT /scope bỏ kiểm tra fileId hợp lệ từ Google Drive',
    file: 'apps/chat-api/src/routes/connections/mysheets.ts',
    target: "if (driveRes.status === 404) {\n          res.status(400).json({",
    mutated: "if (false && driveRes.status === 404) {\n          res.status(400).json({",
    command: ['test', '-w', '@wap/chat-api', '--', 'tests/routes/mysheets-connections.test.ts', '-t', 'rejects invalid or ungranted spreadsheet IDs'],
  },
  {
    id: 'M3b',
    name: 'bindConnections bỏ kiểm tra allowedSpreadsheets',
    file: 'apps/chat-api/src/services/chat-service.ts',
    target: "if (forbiddenStep) {\n          const sId = String(forbiddenStep.args.spreadsheetId);",
    mutated: "if (false && forbiddenStep) {\n          const sId = String(forbiddenStep.args.spreadsheetId);",
    command: ['test', '-w', '@wap/chat-api', '--', 'tests/routes/mysheets-services.test.ts', '-t', 'bindConnections refuses plan when spreadsheetId is not in allowedSpreadsheets'],
  },
  {
    id: 'M3c',
    name: 'AdapterFactory bỏ kiểm tra allowedSpreadsheets lúc thực thi',
    file: 'apps/chat-api/src/services/adapter-factory.ts',
    target: "if (!Array.isArray(previewed.allowedSpreadsheets) || !previewed.allowedSpreadsheets.every((id) => currentSet.has(id))) {",
    mutated: "if (false && (!Array.isArray(previewed.allowedSpreadsheets) || !previewed.allowedSpreadsheets.every((id) => currentSet.has(id)))) {",
    command: ['test', '-w', '@wap/chat-api', '--', 'tests/routes/mysheets-services.test.ts', '-t', 'AdapterFactory throws AUTH_ERROR when spreadsheetId not in current allowedScope'],
  },
  {
    id: 'M3d',
    name: 'PersonalSheetsAdapter bỏ kiểm tra assertAllowedScope',
    file: 'packages/tool-adapters/src/sheets/personal-sheets-adapter.ts',
    target: "this.assertAllowedScope('spreadsheets', value);",
    mutated: "// MUTATION M3d: this.assertAllowedScope('spreadsheets', value);",
    command: ['test', '-w', '@wap/tool-adapters', '--', 'tests/sheets/personal-sheets-adapter.test.ts', '-t', 'rejects spreadsheetId not in allowedScope.spreadsheets'],
  },
  {
    id: 'M4',
    name: 'PUT /scope không gọi Drive files.get, lấy tên bảng giả lập',
    file: 'apps/chat-api/src/routes/connections/mysheets.ts',
    target: "fileData = await driveRes.json();",
    mutated: "fileData = { name: 'Untrusted Client Title', capabilities: { canEdit: true } };",
    command: ['test', '-w', '@wap/chat-api', '--', 'tests/routes/mysheets-connections.test.ts', '-t', 'fetches title and canEdit directly from Google Drive API'],
  },
  {
    id: 'M5',
    name: 'AdapterFactory bỏ kiểm tra credentialId lúc thực thi',
    file: 'apps/chat-api/src/services/adapter-factory.ts',
    target: "const previewed = context.connections?.mysheets;\n      if (!previewed || record.id !== previewed.credentialId) {",
    mutated: "const previewed = context.connections?.mysheets;\n      if (false && (!previewed || record.id !== previewed.credentialId)) {",
    command: ['test', '-w', '@wap/chat-api', '--', 'tests/routes/mysheets-services.test.ts', '-t', 'previewed credentialId does not match current'],
  },
  {
    id: 'M6',
    name: 'DELETE /connections/mysheets xoá luôn dòng gmail của cùng người dùng',
    file: 'apps/chat-api/src/routes/connections/mysheets.ts',
    target: "const removed = await options.repo!.disconnect(user.id);",
    mutated: "const removed = await options.repo!.disconnect(user.id);\n      await options.credentialRepo!.deleteCredentials('gmail', user.id);",
    command: ['test', '-w', '@wap/chat-api', '--', 'tests/routes/mysheets-connections.test.ts', '-t', 'leaving gmail row active and untouched'],
  },
  {
    id: 'M7',
    name: 'MYSHEETS_ENABLED=off vẫn thêm MYSHEETS_TOOLS vào catalog',
    file: 'apps/chat-api/src/services/registered-services.ts',
    target: "if (options.mysheetsEnabled) {",
    mutated: "if (true || options.mysheetsEnabled) {",
    command: ['test', '-w', '@wap/chat-api', '--', 'tests/routes/mysheets-services.test.ts', '-t', 'excludes MYSHEETS_TOOLS from getToolCatalogFor when mysheetsEnabled is false'],
  },
  {
    id: 'M8',
    name: 'POST /picker-session thiếu header Cache-Control: no-store',
    file: 'apps/chat-api/src/routes/connections/mysheets.ts',
    target: "router.post('/picker-session', async (req, res) => {\n    const user = (req as any).user as AuthUser;\n    res.setHeader('Cache-Control', 'no-store');",
    mutated: "router.post('/picker-session', async (req, res) => {\n    const user = (req as any).user as AuthUser;\n    // MUTATION M8: res.setHeader('Cache-Control', 'no-store');",
    command: ['test', '-w', '@wap/chat-api', '--', 'tests/routes/mysheets-connections.test.ts', '-t', 'returns accessToken and fake picker info with Cache-Control: no-store'],
  },
  {
    id: 'M9',
    name: 'PersonalSheetsAdapter bỏ chặn công thức (=, +, -, @, \\t, \\r)',
    file: 'packages/tool-adapters/src/sheets/sheets-shared.ts',
    target: "row.map((cell: string) => (/^\\s*[=+\\-@]/u.test(cell) ? \"'\" + cell : cell))",
    mutated: "row.map((cell: string) => cell)",
    command: ['test', '-w', '@wap/tool-adapters', '--', 'tests/sheets/personal-sheets-adapter.test.ts', '-t', 'mysheets.append_rows applies formula protection and escapes =, +, -, @'],
  },
  {
    id: 'M10',
    name: 'Lỗi mạng sau khi gửi append_rows bị xếp vào FAILED thay vì UNKNOWN',
    file: 'packages/tool-adapters/src/sheets/personal-sheets-adapter.ts',
    target: "category: writing ? 'UNKNOWN' : 'NETWORK',",
    mutated: "category: 'NETWORK',",
    command: ['test', '-w', '@wap/tool-adapters', '--', 'tests/sheets/personal-sheets-adapter.test.ts', '-t', 'when fetchFn rejects after append_rows is sent, throws StepError with category UNKNOWN and never retries'],
  },
];

console.log(`Starting ${mutations.length} mandatory mutations from Spec §8.2...\n`);

const results = [];
let allPassed = true;

for (const m of mutations) {
  const filePath = resolve(m.file);
  const original = readFileSync(filePath, 'utf8');
  const hashBefore = sha256(original);

  if (!original.includes(m.target)) {
    console.error(`[ERROR] Target string for ${m.id} not found in ${m.file}!`);
    process.exit(1);
  }

  const mutatedContent = original.replace(m.target, m.mutated);
  writeFileSync(filePath, mutatedContent, 'utf8');

  try {
    const res = spawnSync(npmCli, m.command, {
      shell: isWin,
      stdio: 'pipe',
      encoding: 'utf8',
      env: process.env,
    });

    const exitCode = res.status;
    const caught = exitCode !== 0;

    results.push({
      id: m.id,
      name: m.name,
      file: m.file,
      exitCode,
      caught,
    });

    if (!caught) {
      allPassed = false;
      console.log(`❌ ${m.id} SURVIVED! (exit code 0)\nCommand output:\n${res.stdout}\n${res.stderr}`);
    } else {
      console.log(`✅ ${m.id} CAUGHT: ${m.name} (exit code ${exitCode})`);
    }
  } finally {
    writeFileSync(filePath, original, 'utf8');
    const hashAfter = sha256(readFileSync(filePath, 'utf8'));
    if (hashBefore !== hashAfter) {
      console.error(`[FATAL] SHA256 mismatch after restoring ${m.file}!`);
      process.exit(1);
    }
  }
}

console.log('\n========================================================================================');
console.log('| ID   | Đột biến (Spec §8.2)                                            | Exit | Bị bắt? |');
console.log('========================================================================================');
for (const r of results) {
  console.log(`| ${r.id.padEnd(4)} | ${r.name.slice(0, 57).padEnd(57)} | ${String(r.exitCode).padEnd(4)} | ${r.caught ? 'PASS ✅' : 'FAIL ❌'} |`);
}
console.log('========================================================================================\n');

if (!allPassed) {
  console.error('Some mutations survived! Review test coverage.');
  process.exit(1);
} else {
  console.log(`All ${mutations.length} mutations successfully caught and verified! Files 100% restored.`);
}
