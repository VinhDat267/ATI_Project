import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { G1_DATABASE_URL, migrate } from '@wap/db';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = path.join(
  root,
  'docs',
  'antigravity',
  'filesystem-handoff-baseline.json'
);
const migrationFiles = [
  '0001_init.sql',
  '0002_audit_contracts.sql',
  '0003_task_hub_local.sql',
  '0004_task_hub_cards.sql',
  '0005_filesystem_dispatches.sql',
];

const normalize = (value) => value.replaceAll('\\', '/');
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const sortedRecord = (record) =>
  Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));

function hashCurrentFiles(expected) {
  return sortedRecord(
    Object.fromEntries(
      Object.keys(expected).map((relativePath) => {
        const file = path.join(root, relativePath);
        return [relativePath, existsSync(file) ? sha256(file) : null];
      })
    )
  );
}

function runGit(args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  } catch {
    return null;
  }
}

function parseWorkingTreePaths(status) {
  if (status === '') return [];
  const paths = [];
  for (const line of status.split(/\r?\n/)) {
    if (line === '') continue;
    if (line.length < 4 || !/^[ MADRCU?!]{2} /.test(line))
      throw new Error(`Unexpected git status --short line: ${JSON.stringify(line)}`);
    const pathText = line.slice(3);
    if (pathText === '') throw new Error('git status --short reported an empty path');
    paths.push(normalize(pathText));
  }
  return [...new Set(paths)].sort((left, right) => left.localeCompare(right));
}

function currentWorkingTreePaths() {
  const status = runGit(['-c', 'core.quotepath=false', 'status', '--short']);
  return status === null ? [] : parseWorkingTreePaths(status);
}

function splitSqlStatements(text) {
  const statements = [];
  let statement = '';
  let parentheses = 0;
  let state = 'normal';
  let dollarTag = null;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];

    if (state === 'line-comment') {
      if (character === '\n') {
        state = 'normal';
        statement += ' ';
      }
      continue;
    }
    if (state === 'block-comment') {
      if (character === '*' && next === '/') {
        state = 'normal';
        statement += ' ';
        index += 1;
      }
      continue;
    }
    if (state === 'single-quote') {
      statement += character;
      if (character === "'" && next === "'") {
        statement += next;
        index += 1;
      } else if (character === "'") state = 'normal';
      continue;
    }
    if (state === 'double-quote') {
      statement += character;
      if (character === '"' && next === '"') {
        statement += next;
        index += 1;
      } else if (character === '"') state = 'normal';
      continue;
    }
    if (state === 'dollar-quote') {
      if (text.startsWith(dollarTag, index)) {
        statement += dollarTag;
        index += dollarTag.length - 1;
        dollarTag = null;
        state = 'normal';
      } else statement += character;
      continue;
    }

    if (character === '-' && next === '-') {
      state = 'line-comment';
      index += 1;
    } else if (character === '/' && next === '*') {
      state = 'block-comment';
      index += 1;
    } else if (character === "'") {
      state = 'single-quote';
      statement += character;
    } else if (character === '"') {
      state = 'double-quote';
      statement += character;
    } else if (character === '$') {
      const tag = text.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
      if (tag) {
        state = 'dollar-quote';
        dollarTag = tag;
        statement += tag;
        index += tag.length - 1;
      } else statement += character;
    } else if (character === '(') {
      parentheses += 1;
      statement += character;
    } else if (character === ')') {
      if (parentheses === 0) return null;
      parentheses -= 1;
      statement += character;
    } else if (character === ';') {
      if (parentheses !== 0 || statement.trim() === '') return null;
      statements.push(statement.trim());
      statement = '';
    } else statement += character;
  }

  if (state !== 'normal' || parentheses !== 0 || statement.trim() !== '') return null;
  return statements.length === 0 ? null : statements;
}

function matchingParenthesis(text, openingIndex) {
  let depth = 0;
  let state = 'normal';
  let dollarTag = null;
  for (let index = openingIndex; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (state === 'single-quote') {
      if (character === "'" && next === "'") index += 1;
      else if (character === "'") state = 'normal';
      continue;
    }
    if (state === 'double-quote') {
      if (character === '"' && next === '"') index += 1;
      else if (character === '"') state = 'normal';
      continue;
    }
    if (state === 'dollar-quote') {
      if (text.startsWith(dollarTag, index)) {
        index += dollarTag.length - 1;
        dollarTag = null;
        state = 'normal';
      }
      continue;
    }
    if (character === "'") state = 'single-quote';
    else if (character === '"') state = 'double-quote';
    else if (character === '$') {
      const tag = text.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
      if (tag) {
        dollarTag = tag;
        state = 'dollar-quote';
        index += tag.length - 1;
      }
    } else if (character === '(') depth += 1;
    else if (character === ')') {
      depth -= 1;
      if (depth === 0) return index;
      if (depth < 0) return -1;
    }
  }
  return -1;
}

function splitTopLevelCommaList(text) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let state = 'normal';
  let dollarTag = null;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (state === 'single-quote') {
      if (character === "'" && next === "'") index += 1;
      else if (character === "'") state = 'normal';
      continue;
    }
    if (state === 'double-quote') {
      if (character === '"' && next === '"') index += 1;
      else if (character === '"') state = 'normal';
      continue;
    }
    if (state === 'dollar-quote') {
      if (text.startsWith(dollarTag, index)) {
        index += dollarTag.length - 1;
        dollarTag = null;
        state = 'normal';
      }
      continue;
    }
    if (character === "'") state = 'single-quote';
    else if (character === '"') state = 'double-quote';
    else if (character === '$') {
      const tag = text.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
      if (tag) {
        dollarTag = tag;
        state = 'dollar-quote';
        index += tag.length - 1;
      }
    } else if (character === '(') depth += 1;
    else if (character === ')') {
      depth -= 1;
      if (depth < 0) return null;
    } else if (character === ',' && depth === 0) {
      const part = text.slice(start, index).trim();
      if (part === '') return null;
      parts.push(part);
      start = index + 1;
    }
  }
  const finalPart = text.slice(start).trim();
  if (state !== 'normal' || depth !== 0 || finalPart === '') return null;
  parts.push(finalPart);
  return parts;
}

function firstTopLevelUpdateClause(text) {
  let depth = 0;
  let state = 'normal';
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (state === 'single-quote') {
      if (character === "'" && next === "'") index += 1;
      else if (character === "'") state = 'normal';
      continue;
    }
    if (state === 'double-quote') {
      if (character === '"' && next === '"') index += 1;
      else if (character === '"') state = 'normal';
      continue;
    }
    if (character === "'") state = 'single-quote';
    else if (character === '"') state = 'double-quote';
    else if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    else if (depth === 0 && (index === 0 || /\s/.test(text[index - 1]))) {
      const clause = text.slice(index).match(/^(?:FROM|WHERE)\b/i)?.[0];
      if (clause) return index;
    }
  }
  return text.length;
}

const identifier = '(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)';

function hasCompleteTableConstraint(clause) {
  const named = clause.match(new RegExp(`^CONSTRAINT\\s+${identifier}\\s+(.+)$`, 'is'));
  const body = named ? named[1] : clause;
  return [
    /^PRIMARY\s+KEY\s*\(.+\)$/is,
    /^UNIQUE\s*\(.+\)$/is,
    new RegExp(`^FOREIGN\\s+KEY\\s*\\(.+\\)\\s+REFERENCES\\s+${identifier}\\s*\\(.+\\)$`, 'is'),
    /^CHECK\s*\(.+\)$/is,
  ].some((shape) => shape.test(body));
}

function hasCompleteCreateTable(statement) {
  const header = statement.match(new RegExp(`^CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${identifier}\\s*\\(`, 'i'));
  if (!header) return false;
  const opening = statement.indexOf('(', header.index + header[0].length - 1);
  const closing = matchingParenthesis(statement, opening);
  if (closing < 0 || statement.slice(closing + 1).trim() !== '') return false;
  const columns = splitTopLevelCommaList(statement.slice(opening + 1, closing));
  if (columns === null) return false;
  return columns.every((column) =>
    hasCompleteTableConstraint(column)
    || (!/^(?:CONSTRAINT|PRIMARY|FOREIGN|UNIQUE|CHECK)\b/i.test(column)
      && new RegExp(`^${identifier}\\s+.+$`, 'is').test(column))
  );
}

function hasCompleteCreateEnum(statement) {
  const header = statement.match(new RegExp(`^CREATE\\s+TYPE\\s+${identifier}\\s+AS\\s+ENUM\\s*\\(`, 'i'));
  if (!header) return false;
  const opening = statement.indexOf('(', header.index + header[0].length - 1);
  const closing = matchingParenthesis(statement, opening);
  if (closing < 0 || statement.slice(closing + 1).trim() !== '') return false;
  const values = splitTopLevelCommaList(statement.slice(opening + 1, closing));
  return values !== null && values.every((value) => /^'(?:[^']|'')*'$/.test(value));
}

function hasCompleteCreateIndex(statement) {
  const header = statement.match(new RegExp(`^CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+${identifier}\\s+ON\\s+${identifier}(?:\\s+USING\\s+${identifier})?\\s*\\(`, 'i'));
  if (!header) return false;
  const opening = statement.indexOf('(', header.index + header[0].length - 1);
  const closing = matchingParenthesis(statement, opening);
  if (closing < 0 || splitTopLevelCommaList(statement.slice(opening + 1, closing)) === null) return false;
  const suffix = statement.slice(closing + 1).trim();
  return suffix === '' || /^WHERE\s+.+$/is.test(suffix);
}

function hasCompleteUpdate(statement) {
  const match = statement.match(new RegExp(`^UPDATE\\s+${identifier}(?:\\s+${identifier})?\\s+SET\\s+(.+)$`, 'is'));
  if (!match) return false;
  const assignmentArea = match[1].slice(0, firstTopLevelUpdateClause(match[1])).trim();
  const assignments = splitTopLevelCommaList(assignmentArea);
  const target = new RegExp(`^${identifier}(?:\\.${identifier})?$`, 'is');
  return assignments !== null && assignments.every((assignment) => {
    const equals = assignment.indexOf('=');
    if (equals <= 0 || assignment[equals + 1] === '=') return false;
    const left = assignment.slice(0, equals).trim();
    const right = assignment.slice(equals + 1).trim();
    return target.test(left)
      && right !== ''
      && !/^[=,;]/.test(right)
      && /(?:[A-Za-z0-9_$'"\)\]])$/.test(right);
  });
}

function isRecognizedMigrationStatement(statement) {
  return [
    /^BEGIN$/i,
    /^COMMIT$/i,
    /^CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)$/i,
    hasCompleteCreateEnum,
    hasCompleteCreateTable,
    hasCompleteCreateIndex,
    /^CREATE\s+OR\s+REPLACE\s+FUNCTION\s+.+\s+RETURNS\s+.+\s+AS\s+\$.*\$\s+LANGUAGE\s+[A-Za-z_][A-Za-z0-9_]*$/is,
    /^CREATE\s+TRIGGER\s+[A-Za-z_][A-Za-z0-9_]*\s+(?:BEFORE|AFTER)\s+.+\s+ON\s+.+\s+FOR\s+EACH\s+ROW\s+EXECUTE\s+FUNCTION\s+.+\)$/is,
    /^ALTER\s+TYPE\s+.+\s+ADD\s+VALUE\s+IF\s+NOT\s+EXISTS\s+'.+'$/is,
    /^ALTER\s+TABLE\s+.+\s+(?:ADD|ALTER)\s+.+$/is,
    hasCompleteUpdate,
    /^COMMENT\s+ON\s+(?:TABLE|COLUMN)\s+.+\s+IS\s+'.*'$/is,
  ].some((validator) => typeof validator === 'function'
    ? validator(statement)
    : validator.test(statement));
}

function hasValidMigrationSql(text) {
  const statements = splitSqlStatements(text);
  return statements !== null && statements.every(isRecognizedMigrationStatement);
}

function dedicatedAdminAddress(value) {
  const address = new URL(value);
  if (
    address.protocol !== 'postgresql:'
    || !['127.0.0.1', 'localhost'].includes(address.hostname)
    || address.port !== '55532'
    || address.pathname !== '/wap_g1'
    || address.search !== ''
    || address.hash !== ''
  ) throw new Error('Database configuration rejected');
  return address;
}

function assertMigrationParserFixtures() {
  const fixtures = [
    ['valid_create_table', 'CREATE TABLE audit_fixture (id INTEGER);', true],
    ['unrecognized_statement', 'CREATE TABLE audit_fixture (id INTEGER); MALFORMED SQL;', false],
    ['unterminated_statement', 'CREATE TABLE audit_fixture (id INTEGER', false],
    ['trailing_table_comma', 'CREATE TABLE x (id INTEGER,);', false],
    ['missing_column_type', 'CREATE TABLE x (id);', false],
    ['trailing_index_syntax', 'CREATE INDEX i ON x (id) TRAILING GARBAGE;', false],
    ['incomplete_update', 'UPDATE x SET nonsense;', false],
    ['empty_update_right', 'UPDATE x SET id =;', false],
    ['empty_update_left', 'UPDATE x SET = 1;', false],
    ['duplicate_update_operator', 'UPDATE x SET id == 1;', false],
    ['trailing_enum_comma', "CREATE TYPE mood AS ENUM ('ok',);", false],
    ['bare_named_constraint', 'CREATE TABLE x (CONSTRAINT nonsense);', false],
    ['incomplete_named_constraint', 'CREATE TABLE x (CONSTRAINT nonsense UNIQUE);', false],
  ];
  for (const [name, sql, expected] of fixtures) {
    if (hasValidMigrationSql(sql) !== expected)
      throw new Error(`Migration parser fixture failed: ${name}`);
  }
  for (const name of migrationFiles) {
    const migration = path.join(root, 'db', 'migrations', name);
    if (!hasValidMigrationSql(readFileSync(migration, 'utf8')))
      throw new Error(`Migration parser rejected checked-in migration: ${name}`);
  }
  const statusFixture = parseWorkingTreePaths(' M README.md\n?? folder with spaces/file.txt\n');
  if (!statusFixture.includes('README.md') || !statusFixture.includes('folder with spaces/file.txt'))
    throw new Error('git status parser fixture failed');
  const credentialFixture = JSON.stringify({
    password: 'abcdefghijklmnop',
    api_key: 'abcdefghijklmnop',
    authorization: 'Bearer abcdefghijklmnop',
  });
  const credentialKinds = credentialMatches(credentialFixture).map(({ kind }) => kind);
  if (!credentialKinds.includes('named_secret') || !credentialKinds.includes('authorization_bearer'))
    throw new Error('credential scanner fixture failed');
  if (credentialMatches(JSON.stringify({ credential_scan: { status: 'PENDING', matches: [] } })).length !== 0)
    throw new Error('credential scanner clean fixture failed');
  let queryOverrideRejected = false;
  try {
    dedicatedAdminAddress('postgresql://wap:wap@127.0.0.1:55532/wap_g1?database=wap_g1');
  } catch {
    queryOverrideRejected = true;
  }
  if (!queryOverrideRejected) throw new Error('database URL query override fixture failed');
}

function credentialMatches(serializedJson) {
  const patterns = [
    ['connection_uri', /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+\w+)?):\/\/[^\s"'\\]+:[^\s"'\\]+@/gi],
    ['authorization_bearer', /"authorization"\s*:\s*"bearer\s+[^"\\]+"/gi],
    ['named_secret', /"(?:api[_-]?key|secret|password|access[_-]?token|refresh[_-]?token)"\s*:\s*"[^"\\]{12,}"/gi],
  ];

  return patterns.flatMap(([kind, pattern]) =>
    [...serializedJson.matchAll(pattern)].map(() => ({ kind }))
  );
}

async function applyMigrationsWithPostgres(expectedChecksums) {
  const database = `fs06_parse_${randomUUID().replaceAll('-', '')}`;
  const result = {
    status: 'FAIL',
    database,
    applied: [],
    schema_migrations: [],
    db_dropped: false,
    error_kind: null,
  };
  let admin;
  let isolated;
  let created = false;
  try {
    if (!/^fs06_parse_[a-f0-9]{32}$/.test(database))
      throw new Error('Invalid generated database name');
    const adminAddress = dedicatedAdminAddress(process.env.G1_DATABASE_URL ?? G1_DATABASE_URL);
    const isolatedAddress = new URL(adminAddress);
    isolatedAddress.search = '';
    isolatedAddress.hash = '';
    isolatedAddress.pathname = `/${database}`;
    if (
      isolatedAddress.pathname !== `/${database}`
      || isolatedAddress.search !== ''
      || isolatedAddress.hash !== ''
    ) throw new Error('Generated database URL construction failed');
    admin = postgres(adminAddress.href, { max: 1, connect_timeout: 5, onnotice: () => {} });
    await admin.unsafe(`CREATE DATABASE "${database}"`);
    created = true;
    const migrationRun = await migrate(isolatedAddress.href);
    isolated = postgres(isolatedAddress.href, { max: 1, connect_timeout: 5, onnotice: () => {} });
    const rows = await isolated`SELECT name, checksum FROM schema_migrations ORDER BY name`;
    const expectedByName = Object.fromEntries(
      migrationFiles.map((name) => [name, expectedChecksums[`db/migrations/${name}`]])
    );
    if (
      migrationRun.total !== migrationFiles.length
      || rows.length !== migrationFiles.length
      || rows.some((row) => expectedByName[row.name] !== row.checksum)
    ) throw new Error('PostgreSQL migration rows did not match the five expected checksums');
    result.applied = [...migrationRun.applied].sort((left, right) => left.localeCompare(right));
    result.schema_migrations = rows.map(({ name, checksum }) => ({ name, checksum }));
    result.status = 'PASS';
  } catch (error) {
    result.error_kind = error instanceof Error && error.message === 'Database configuration rejected'
      ? 'DatabaseConfigurationRejected'
      : error instanceof Error ? error.name : 'UnknownError';
  } finally {
    try {
      await isolated?.end({ timeout: 5 });
    } catch {
      result.status = 'FAIL';
      result.error_kind ??= 'IsolatedDatabaseCloseError';
    }
    try {
      if (created) {
        if (!/^fs06_parse_[a-f0-9]{32}$/.test(database))
          throw new Error('Refusing to drop a database outside the generated scope');
        await admin.unsafe(`DROP DATABASE "${database}" WITH (FORCE)`);
        const remaining = await admin`SELECT datname FROM pg_database WHERE datname = ${database}`;
        if (remaining.length !== 0) throw new Error('Generated database remained after drop');
        result.db_dropped = true;
      }
    } catch {
      result.status = 'FAIL';
      result.error_kind ??= 'GeneratedDatabaseDropError';
    }
    try {
      await admin?.end({ timeout: 5 });
    } catch {
      result.status = 'FAIL';
      result.error_kind ??= 'AdminDatabaseCloseError';
    }
  }
  if (!result.db_dropped) result.status = 'FAIL';
  return result;
}

if (process.argv.includes('--self-test')) {
  assertMigrationParserFixtures();
  console.log('Migration parser fixtures passed');
  process.exit(0);
}

assertMigrationParserFixtures();
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const sourceExpected = sortedRecord(baseline.source_sha256 ?? {});
const protectedExpected = sortedRecord(baseline.protected_sha256 ?? {});
const sourceActual = hashCurrentFiles(sourceExpected);
const protectedActual = hashCurrentFiles(protectedExpected);
const sourceChanged = Object.keys(sourceExpected)
  .filter((relativePath) => sourceExpected[relativePath] !== sourceActual[relativePath])
  .sort((left, right) => left.localeCompare(right));
const protectedMismatches = Object.keys(protectedExpected)
  .filter((relativePath) => protectedExpected[relativePath] !== protectedActual[relativePath])
  .map((relativePath) => ({
    path: relativePath,
    expected: protectedExpected[relativePath],
    actual: protectedActual[relativePath],
  }))
  .sort((left, right) => left.path.localeCompare(right.path));

const migrationPaths = migrationFiles.map((file) => `db/migrations/${file}`);
const migrationChecksums = sortedRecord(
  Object.fromEntries(
    migrationPaths.map((relativePath) => {
      const file = path.join(root, relativePath);
      return [relativePath, existsSync(file) ? sha256(file) : null];
    })
  )
);
const lexicalMigrationPreflight = migrationPaths.every((relativePath) => {
  const file = path.join(root, relativePath);
  return existsSync(file) && hasValidMigrationSql(readFileSync(file, 'utf8'));
});
const protectedCountIsExpected = Object.keys(protectedExpected).length === 180;
const evidenceDir = process.env.ATI_EVIDENCE_DIR
  ? path.resolve(process.env.ATI_EVIDENCE_DIR)
  : path.join(root, 'docs', 'task-hub-evidence', 'batch-02', 'FS-06', `${Date.now()}-scope-audit`);
mkdirSync(evidenceDir, { recursive: true });
const migrationApply = await applyMigrationsWithPostgres(migrationChecksums);
migrationApply.lexical_preflight = lexicalMigrationPreflight;
writeFileSync(
  path.join(evidenceDir, 'migration-apply.json'),
  `${JSON.stringify(migrationApply, null, 2)}\n`,
  { flag: 'wx' }
);

const result = {
  status: 'PENDING',
  recorded_at: new Date().toISOString(),
  git_head: runGit(['rev-parse', 'HEAD'])?.trim() ?? null,
  working_tree_paths: currentWorkingTreePaths(),
  source_sha256: {
    expected: sourceExpected,
    actual: sourceActual,
    changed: sourceChanged,
  },
  protected_sha256: {
    expected: protectedExpected,
    actual: protectedActual,
    mismatches: protectedMismatches,
  },
  protected_count: Object.keys(protectedExpected).length,
  migration_files: migrationFiles,
  migration_checksums: migrationChecksums,
  credential_scan: {
    status: 'PENDING',
    matches: [],
  },
};

const credentialFindings = credentialMatches(JSON.stringify(result));
result.credential_scan = {
  status: credentialFindings.length === 0 ? 'PASS' : 'FAIL',
  matches: credentialFindings,
};
result.status = protectedCountIsExpected
  && protectedMismatches.length === 0
  && Object.values(migrationChecksums).every((checksum) => checksum !== null)
  && migrationApply.status === 'PASS'
  && credentialFindings.length === 0
  ? 'PASS'
  : 'FAIL';

writeFileSync(path.join(evidenceDir, 'scope-audit.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({
  status: result.status,
  protected_count: result.protected_count,
  protected_mismatches: result.protected_sha256.mismatches.length,
  source_changed: result.source_sha256.changed.length,
  migration_files: result.migration_files,
  migration_apply: migrationApply.status,
  credential_scan: result.credential_scan.status,
  evidence: normalize(path.join(evidenceDir, 'scope-audit.json')),
}, null, 2));

process.exitCode = result.status === 'PASS' ? 0 : 1;
