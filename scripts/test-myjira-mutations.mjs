import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function replaceWithLineEndings(source, target, replacement) {
  if (source.includes(target)) {
    return source.replace(target, replacement);
  }
  const crlfTarget = target.replace(/\n/g, '\r\n');
  if (source.includes(crlfTarget)) {
    return source.replace(crlfTarget, replacement.replace(/\n/g, '\r\n'));
  }
  return null;
}

const isWin = process.platform === 'win32';
const npmCli = process.env.npm_execpath || (isWin ? 'npm.cmd' : 'npm');

const mutations = [
  {
    id: 'M1',
    name: 'Bỏ kiểm tra owner (user_id, workspace_id) trên plan/source',
    file: 'packages/tool-schemas/src/myjira-policy.ts',
    target: 'if (!sameJiraBinding(validatedPolicySource.binding, validatedCurrentBinding)) {',
    mutated: 'if (false && !sameJiraBinding(validatedPolicySource.binding, validatedCurrentBinding)) {',
    command: ['test', '-w', '@wap/tool-schemas', '--', 'tests/myjira-policy.test.ts'],
  },
  {
    id: 'M2',
    name: 'Cho pending member qua policy gate',
    file: 'packages/tool-schemas/src/myjira-policy.ts',
    target: "if (policy.membershipStatus !== 'active') {",
    mutated: "if (policy.membershipStatus !== 'active' && policy.membershipStatus !== 'pending') {",
    command: ['test', '-w', '@wap/tool-schemas', '--', 'tests/myjira-policy.test.ts'],
  },
  {
    id: 'M3',
    name: 'Bỏ kiểm tra giao giữa site/project workspace và quyền user ở adapter',
    file: 'packages/tool-adapters/src/jira/personal-jira-adapter.ts',
    target: "if (!project) {\n      throw fail('AUTH_ERROR', 403);\n    }",
    mutated: "if (!project) {\n      return { id: '999', key: String(projectKey), name: String(projectKey) };\n    }",
    command: ['test', '-w', '@wap/tool-adapters', '--', 'tests/personal-jira-adapter.test.ts'],
  },
  {
    id: 'M4',
    name: 'Bỏ workspaceId khỏi namespace WorkingMemory',
    file: 'packages/planner/src/search.ts',
    target: "if (typeof entity.workspaceId === 'string' && entity.workspaceId.trim()) {\n    scope.push(`ws:${entity.workspaceId.trim()}`);\n  }",
    mutated: "if (false && typeof entity.workspaceId === 'string' && entity.workspaceId.trim()) {\n    scope.push(`ws:${entity.workspaceId.trim()}`);\n  }",
    command: ['test', '-w', '@wap/planner', '--', 'tests/myjira-grounding.test.ts'],
  },
  {
    id: 'M5',
    name: 'Ground projectKey/issueKey không kèm (workspaceId, siteId)',
    file: 'packages/planner/src/validator.ts',
    target: "if (step.tool.startsWith('myjira.') && (resource === 'jira_project' || resource === 'jira_issue') &&\n          typeof step.args.siteId === 'string') {",
    mutated: "if (false && step.tool.startsWith('myjira.') && (resource === 'jira_project' || resource === 'jira_issue') &&\n          typeof step.args.siteId === 'string') {",
    command: ['test', '-w', '@wap/planner', '--', 'tests/myjira-grounding.test.ts'],
  },
  {
    id: 'M6',
    name: 'Bỏ gắn connections.myjira trước khi băm plan hoặc chấp nhận connections.myjira giả mạo',
    file: 'apps/chat-api/src/services/jira/jira-plan-binding.ts',
    target: 'atiUserId: userId,',
    mutated: "atiUserId: 'spoofed-user-id',",
    command: ['test', '-w', '@wap/chat-api', '--', 'tests/services/jira-plan-binding.test.ts'],
  },
  {
    id: 'M7',
    name: 'Bỏ khoá refresh hoặc không chuyển reconnect_required khi invalid_grant',
    file: 'apps/chat-api/src/services/jira/jira-token-manager.ts',
    target: "SET status = 'reconnect_required',",
    mutated: "SET status = 'active',",
    command: ['test', '-w', '@wap/chat-api', '--', 'tests/services/jira-token-manager.test.ts'],
  },
  {
    id: 'M8',
    name: 'Bỏ lọc source stale khi version/workspace đổi',
    file: 'packages/tool-schemas/src/myjira-policy.ts',
    target: 'if (validatedPolicySource.sitePolicyVersion !== policy.currentSitePolicyVersion) {',
    mutated: 'if (false && validatedPolicySource.sitePolicyVersion !== policy.currentSitePolicyVersion) {',
    command: ['test', '-w', '@wap/tool-schemas', '--', 'tests/myjira-policy.test.ts'],
  },
  {
    id: 'M9',
    name: 'Cho phép fallback sang jira.* cũ khi bật myjira',
    file: 'apps/chat-api/src/config/gmail-tools-runtime.ts',
    target: "...SERVICE_REGISTRY.filter((s) => !myjiraEnabled || s.id !== 'jira'),",
    mutated: '...SERVICE_REGISTRY,',
    command: ['test', '-w', '@wap/chat-api', '--', 'tests/services/jira-runtime-catalog.test.ts'],
  },
  {
    id: 'M10',
    name: 'Bỏ xoá query OAuth hoặc cho replay callback khi 401/tab cũ',
    file: 'apps/chat-web/src/views/JiraCallbackView.tsx',
    target: 'const live = () => mounted && !invalidated && owns.current();',
    mutated: 'const live = () => true;',
    command: ['test', '-w', '@wap/chat-web', '--', 'tests/jira-callback.test.tsx'],
  },
  {
    id: 'M11',
    name: 'Cho auto-retry khi myjira.create_issue hoặc myjira.add_comment timeout/5xx',
    file: 'packages/tool-adapters/src/jira/personal-jira-http.ts',
    target: "if (writing) {\n          throw createJiraStepError('UNKNOWN', response.status);\n        }",
    mutated: "if (false && writing) {\n          throw createJiraStepError('UNKNOWN', response.status);\n        }",
    command: ['test', '-w', '@wap/tool-adapters', '--', 'tests/personal-jira-adapter.test.ts'],
  },
];

const filterArg = process.argv[2];
const activeMutations = filterArg
  ? mutations.filter((m) => m.id.toLowerCase() === filterArg.toLowerCase())
  : mutations;

console.log(`Starting ${activeMutations.length} mandatory myjira security mutations from Spec §12...\n`);

const results = [];
let allPassed = true;

for (const m of activeMutations) {
  const filePath = resolve(m.file);
  const original = readFileSync(filePath, 'utf8');
  const hashBefore = sha256(original);

  const mutatedContent = replaceWithLineEndings(original, m.target, m.mutated);
  if (mutatedContent === null) {
    console.error(`[ERROR] Target string for ${m.id} not found in ${m.file}!`);
    process.exit(1);
  }

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

console.log('\n====================================================================================================');
console.log('| ID   | Đột biến bảo mật myjira (Spec §12)                                        | Exit | Bị bắt? |');
console.log('====================================================================================================');
for (const r of results) {
  console.log(
    `| ${r.id.padEnd(4)} | ${r.name.slice(0, 69).padEnd(69)} | ${String(r.exitCode).padEnd(4)} | ${
      r.caught ? 'PASS ✅' : 'FAIL ❌'
    } |`
  );
}
console.log('====================================================================================================\n');

if (!allPassed) {
  console.error('Some myjira security mutations survived! Review test coverage.');
  process.exit(1);
} else {
  console.log(`All ${activeMutations.length} myjira security mutations caught and verified! Files 100% restored.`);
}
