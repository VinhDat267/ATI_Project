import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';

interface FormattedDiagnostic {
  code: number;
  message: string;
}

const testDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(testDir, '..');
const contractsTsconfigPath = path.resolve(packageRoot, 'tsconfig.contracts.json');
const barrelEntryPath = path.resolve(packageRoot, 'src', 'index.ts');
const fixtureFilePath = path.resolve(
  packageRoot,
  'tests',
  'fixtures',
  'gmail-digest-binding-compile-fixture.ts',
);
const virtualProbePath = path.resolve(
  packageRoot,
  'tests',
  '__gmail_digest_binding_contract_probe__.ts',
);

let compilerOptions: ts.CompilerOptions;
let baseHost: ts.CompilerHost;
let baseProgram: ts.Program;

function formatDiagnostics(diagnostics: readonly ts.Diagnostic[]): FormattedDiagnostic[] {
  return diagnostics.map((diag) => ({
    code: diag.code,
    message: ts.flattenDiagnosticMessageText(diag.messageText, ' '),
  }));
}

function compileVirtualProbe(sourceText: string): FormattedDiagnostic[] {
  const virtualSourceFile = ts.createSourceFile(
    virtualProbePath,
    sourceText,
    compilerOptions.target ?? ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const isVirtualProbe = (fileName: string) => path.resolve(fileName) === virtualProbePath;

  const host: ts.CompilerHost = {
    ...baseHost,
    fileExists: (fileName) =>
      isVirtualProbe(fileName) ? true : baseHost.fileExists(fileName),
    readFile: (fileName) =>
      isVirtualProbe(fileName) ? sourceText : baseHost.readFile(fileName),
    getSourceFile: (fileName, languageVersion, onError, shouldCreateNewSourceFile) =>
      isVirtualProbe(fileName)
        ? virtualSourceFile
        : baseHost.getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile),
  };

  const program = ts.createProgram([virtualProbePath], compilerOptions, host, baseProgram);
  const targetFile = program.getSourceFile(virtualProbePath);
  if (!targetFile) {
    throw new Error('Failed to load virtual probe source file in TypeScript program');
  }

  return formatDiagnostics([
    ...program.getSyntacticDiagnostics(targetFile),
    ...program.getSemanticDiagnostics(targetFile),
  ]);
}

function compileFixtureOnDisk(targetPath: string): FormattedDiagnostic[] {
  const program = ts.createProgram([targetPath], compilerOptions, baseHost, baseProgram);
  const targetFile = program.getSourceFile(targetPath);
  if (!targetFile) {
    throw new Error(`Failed to load fixture source file: ${targetPath}`);
  }
  return formatDiagnostics([
    ...program.getSyntacticDiagnostics(targetFile),
    ...program.getSemanticDiagnostics(targetFile),
  ]);
}

describe('GMAIL-G2 A0 — GmailDigestBinding & TelegramDigest source-binding type contracts', () => {
  beforeAll(() => {
    const rawConfig = ts.readConfigFile(contractsTsconfigPath, ts.sys.readFile);
    if (rawConfig.error) {
      throw new Error(ts.flattenDiagnosticMessageText(rawConfig.error.messageText, '\n'));
    }
    const parsed = ts.parseJsonConfigFileContent(rawConfig.config, ts.sys, packageRoot);
    if (parsed.errors.length > 0) {
      throw new Error(
        parsed.errors
          .map((err) => ts.flattenDiagnosticMessageText(err.messageText, '\n'))
          .join('\n'),
      );
    }
    compilerOptions = parsed.options;
    baseHost = ts.createCompilerHost(compilerOptions, true);
    baseProgram = ts.createProgram([barrelEntryPath], compilerOptions, baseHost);
  });

  it('accepts legacy non-Gmail and legacy unbound TelegramDigestSource / TelegramDigestConfig decoding', () => {
    const diagnostics = compileVirtualProbe(`
      import type { TelegramDigestConfig, TelegramDigestSource } from '../src/index.js';

      const githubSource: TelegramDigestSource = {
        service: 'github',
        tool: 'github.search_issues',
        args: { repo: 'acme/platform', query: 'open' },
        label: 'GitHub Issues đang mở (acme/platform)',
      };

      const calendarSource: TelegramDigestSource = {
        service: 'calendar',
        tool: 'calendar.list_events',
        label: 'Lịch nhóm hôm nay',
      };

      const legacyGmailSource: TelegramDigestSource = {
        service: 'gmail',
        tool: 'gmail.search_threads',
        args: { query: 'in:inbox is:unread' },
        label: 'Email chưa đọc',
      };

      export const legacyConfig: TelegramDigestConfig = {
        credentialId: 'cred-tg-legacy-01',
        telegramUserId: '100200300',
        username: 'legacy_owner',
        chatId: '-1009988776655',
        chatTitle: 'Engineering Digest',
        sources: [githubSource, calendarSource, legacyGmailSource],
        recurrence: { type: 'daily', time: '08:30' },
        timeZone: 'Asia/Ho_Chi_Minh',
      };
    `);

    expect(diagnostics).toEqual([]);
  });

  it('accepts valid GmailDigestBinding literal on TelegramDigestSource.binding and sourceBindingVersion: 1 on TelegramDigestConfig', () => {
    const diagnostics = compileVirtualProbe(`
      import type { TelegramDigestConfig, TelegramDigestSource } from '../src/index.js';

      const gmailBoundSource: TelegramDigestSource = {
        service: 'gmail',
        tool: 'gmail.search_threads',
        args: { query: 'in:inbox is:unread' },
        label: 'Email chưa đọc',
        binding: {
          kind: 'gmail',
          credentialId: 'cred-gmail-gen-01',
          email: 'owner@example.com',
          oauthClientId: '123456789012-synthetic.apps.googleusercontent.com',
        },
      };

      export const versionedConfig: TelegramDigestConfig = {
        credentialId: 'cred-tg-01',
        telegramUserId: '100200300',
        username: 'owner_tg',
        chatId: '-1009988776655',
        chatTitle: 'Personal Mail Digest',
        sourceBindingVersion: 1,
        sources: [gmailBoundSource],
        recurrence: { type: 'daily', time: '09:00' },
        timeZone: 'Asia/Ho_Chi_Minh',
      };
    `);

    expect(diagnostics).toEqual([]);
  });

  it('exports GmailDigestBinding through src/index.ts with exact four-field contract matching TelegramDigestSource.binding', () => {
    const diagnostics = compileVirtualProbe(`
      import type {
        GmailDigestBinding,
        TelegramDigestConfig,
        TelegramDigestSource,
      } from '../src/index.js';

      type ExactEqual<A, B> =
        (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
          ? true
          : false;

      interface ExpectedGmailDigestBinding {
        kind: 'gmail';
        credentialId: string;
        email: string;
        oauthClientId: string;
      }

      const exactShape: ExactEqual<GmailDigestBinding, ExpectedGmailDigestBinding> = true;
      const exactSourceField: ExactEqual<TelegramDigestSource['binding'], GmailDigestBinding | undefined> = true;
      const sourceBindingOptional: {} extends Pick<TelegramDigestSource, 'binding'> ? true : false = true;
      const exactVersionField: ExactEqual<TelegramDigestConfig['sourceBindingVersion'], 1 | undefined> = true;
      const configVersionOptional: {} extends Pick<TelegramDigestConfig, 'sourceBindingVersion'> ? true : false = true;

      export const contractProof = [
        exactShape,
        exactSourceField,
        sourceBindingOptional,
        exactVersionField,
        configVersionOptional,
      ] as const;
    `);

    expect(diagnostics).toEqual([]);
  });

  it('rejects wrong binding kind literal with TS2322 against literal "gmail"', () => {
    const diagnostics = compileVirtualProbe(`
      import type { TelegramDigestSource } from '../src/index.js';

      export const wrongKindSource: TelegramDigestSource = {
        service: 'gmail',
        tool: 'gmail.search_threads',
        label: 'Email chưa đọc',
        binding: {
          kind: 'mycalendar',
          credentialId: 'cred-gmail-gen-01',
          email: 'owner@example.com',
          oauthClientId: '123456789012-synthetic.apps.googleusercontent.com',
        },
      };
    `);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe(2322);
    expect(diagnostics[0]?.message).toContain('"gmail"');
  });

  it.each(['credentialId', 'email', 'oauthClientId'] as const)(
    'rejects Gmail binding missing required %s with TS2741 against GmailDigestBinding',
    (missingField) => {
      const fields: Record<string, string> = {
        kind: "'gmail'",
        credentialId: "'cred-gmail-gen-01'",
        email: "'owner@example.com'",
        oauthClientId: "'123456789012-synthetic.apps.googleusercontent.com'",
      };
      delete fields[missingField];
      const objectBody = Object.entries(fields)
        .map(([key, val]) => `${key}: ${val}`)
        .join(',\n          ');

      const diagnostics = compileVirtualProbe(`
        import type { TelegramDigestSource } from '../src/index.js';

        export const incompleteSource: TelegramDigestSource = {
          service: 'gmail',
          tool: 'gmail.search_threads',
          label: 'Email chưa đọc',
          binding: {
            ${objectBody}
          },
        };
      `);

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.code).toBe(2741);
      expect(diagnostics[0]?.message).toContain(`Property '${missingField}' is missing`);
      expect(diagnostics[0]?.message).toContain('GmailDigestBinding');
    },
  );

  it.each(['2', '0', "'1'"] as const)(
    'rejects invalid TelegramDigestConfig.sourceBindingVersion %s with TS2322 against literal 1',
    (invalidVersionExpr) => {
      const diagnostics = compileVirtualProbe(`
        import type { TelegramDigestConfig } from '../src/index.js';

        export const invalidVersionConfig: TelegramDigestConfig = {
          credentialId: 'cred-tg-01',
          telegramUserId: '100200300',
          username: 'owner_tg',
          chatId: '-1009988776655',
          chatTitle: 'Personal Mail Digest',
          sourceBindingVersion: ${invalidVersionExpr},
          sources: [],
          recurrence: { type: 'daily', time: '09:00' },
          timeZone: 'Asia/Ho_Chi_Minh',
        };
      `);

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.code).toBe(2322);
      expect(diagnostics[0]?.message).toContain("to type '1'");
    },
  );

  it.each(['accessToken', 'refreshToken', 'clientSecret'] as const)(
    'rejects secret field %s inside GmailDigestBinding with TS2353',
    (secretField) => {
      const diagnostics = compileVirtualProbe(`
        import type { TelegramDigestSource } from '../src/index.js';

        export const secretLeakSource: TelegramDigestSource = {
          service: 'gmail',
          tool: 'gmail.search_threads',
          label: 'Email chưa đọc',
          binding: {
            kind: 'gmail',
            credentialId: 'cred-gmail-gen-01',
            email: 'owner@example.com',
            oauthClientId: '123456789012-synthetic.apps.googleusercontent.com',
            ${secretField}: 'synthetic-non-secret-value',
          },
        };
      `);

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.code).toBe(2353);
      expect(diagnostics[0]?.message).toContain(`'${secretField}' does not exist in type 'GmailDigestBinding'`);
    },
  );

  it('compiles tests/fixtures/gmail-digest-binding-compile-fixture.ts cleanly under tsconfig.contracts.json', () => {
    expect(compileFixtureOnDisk(fixtureFilePath)).toEqual([]);
  });
});
