#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPilotConfig } from './config.js';
import { runPilotLivePreflight, type PreflightCheckResult } from './live-preflight.js';

export interface PreflightCliIO {
  stdout?: (msg: string) => void;
  stderr?: (msg: string) => void;
  writeFileFn?: (path: string, content: string) => Promise<void>;
}

export interface ParsedCliArgs {
  principal?: string;
  requestId?: string;
  outputPath?: string;
  hasHelp: boolean;
  hasProhibitedWrite: boolean;
  hasProhibitedFallback: boolean;
}

export function parseCliArgs(args: readonly string[]): ParsedCliArgs {
  let principal: string | undefined;
  let requestId: string | undefined;
  let outputPath: string | undefined;
  let hasHelp = false;
  let hasProhibitedWrite = false;
  let hasProhibitedFallback = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;

    if (arg === '-h' || arg === '--help') {
      hasHelp = true;
    } else if (
      /^--(?:write|execute|allow-write|allowWrite|writes-allowed|force)$/i.test(arg) ||
      arg === '--dry-run=false'
    ) {
      hasProhibitedWrite = true;
    } else if (/^--(?:allow-simulated-fallback|allowSimulatedFallback)$/i.test(arg)) {
      hasProhibitedFallback = true;
    } else if (arg === '-p' || arg === '--principal') {
      const next = args[++i];
      if (next !== undefined) principal = next;
    } else if (arg.startsWith('--principal=')) {
      principal = arg.slice('--principal='.length);
    } else if (arg === '-r' || arg === '--request-id' || arg === '--requestId') {
      const next = args[++i];
      if (next !== undefined) requestId = next;
    } else if (arg.startsWith('--request-id=')) {
      requestId = arg.slice('--request-id='.length);
    } else if (arg.startsWith('--requestId=')) {
      requestId = arg.slice('--requestId='.length);
    } else if (arg === '-o' || arg === '--output') {
      const next = args[++i];
      if (next !== undefined) outputPath = next;
    } else if (arg.startsWith('--output=')) {
      outputPath = arg.slice('--output='.length);
    }
  }

  return {
    principal,
    requestId,
    outputPath,
    hasHelp,
    hasProhibitedWrite,
    hasProhibitedFallback,
  };
}

export function getCliUsage(): string {
  return `Usage: live-preflight-cli --principal <operator-id> --request-id <req-id> [--output <path>]

Options:
  -p, --principal   [REQUIRED] Active operator principal ID (no fallback defaults)
  -r, --request-id  [REQUIRED] Unique test request ID in target Sheet (no fallback defaults)
  -o, --output      [OPTIONAL] File path to save the redacted JSON preflight result
  -h, --help        Show this help message

Security Invariants:
  - Strictly read-only: accepts zero write options (writesAttempted: 0)
  - Zero credential leakage: all secrets redacted from outputs and errors
  - Exits 0 only if both Google Sheets and Trello live reads pass
`;
}

/**
 * BE-26: CLI Runner for Pilot Live Preflight
 * Requires explicit principal and request-id flags, rejects write flags,
 * emits redacted JSON, and exits 0 only on pass.
 */
export async function runPreflightCli(
  args: readonly string[],
  io: PreflightCliIO = {},
): Promise<number> {
  const writeOut = io.stdout ?? ((msg: string) => process.stdout.write(msg));
  const writeErr = io.stderr ?? ((msg: string) => process.stderr.write(msg));
  const saveFile = io.writeFileFn ?? ((path: string, content: string) => writeFile(path, content, 'utf-8'));

  const parsed = parseCliArgs(args);

  if (parsed.hasHelp) {
    writeOut(getCliUsage());
    return 0;
  }

  if (parsed.hasProhibitedWrite) {
    writeErr('CLI_ERROR: Preflight CLI is strictly read-only and accepts no write options.\n');
    return 1;
  }

  if (parsed.hasProhibitedFallback) {
    writeErr('CONFIG_ERROR: Simulated fallback is rejected for live preflight invocation.\n');
    return 1;
  }

  if (!parsed.principal || !parsed.principal.trim()) {
    writeErr('CLI_ERROR: Missing required flag --principal <operator-id>\n');
    return 1;
  }

  if (!parsed.requestId || !parsed.requestId.trim()) {
    writeErr('CLI_ERROR: Missing required flag --request-id <req-id>\n');
    return 1;
  }

  const principalId = parsed.principal.trim();
  const testRequestId = parsed.requestId.trim();

  let config;
  try {
    config = loadPilotConfig();
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    writeErr(`CONFIG_ERROR: ${errorMsg}\n`);
    return 1;
  }

  let result: PreflightCheckResult;
  try {
    result = await runPilotLivePreflight({
      config,
      principalId,
      testRequestId,
      allowSimulatedFallback: false,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    writeErr(`PREFLIGHT_EXECUTION_ERROR: ${errorMsg}\n`);
    return 1;
  }

  const jsonStr = `${JSON.stringify(result, null, 2)}\n`;
  writeOut(jsonStr);

  if (parsed.outputPath) {
    try {
      await saveFile(parsed.outputPath, jsonStr);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      writeErr(`OUTPUT_WRITE_ERROR: Could not write output file to ${parsed.outputPath}: ${errorMsg}\n`);
      return 1;
    }
  }

  // Strict exit code: exit 0 ONLY if both live reads passed
  const passed =
    result.status === 'passed' &&
    result.checks.sheetsRead.status === 'pass' &&
    result.checks.trelloRead.status === 'pass' &&
    result.checks.writeVerification.writesAttempted === 0;

  return passed ? 0 : 1;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const exitCode = await runPreflightCli(process.argv.slice(2));
  process.exitCode = exitCode;
}
