import { pathToFileURL } from 'node:url';
import pg from 'pg';
import {
  runSheetsDigestV2Migration,
  type RunSheetsDigestV2MigrationOptions,
  type SheetsDigestMigrationMode,
  type SheetsDigestMigrationReport,
  type SheetsDigestV1CompatPolicy,
} from '../services/schedules/sheets-digest-v2-migration.js';

export interface ParsedMigrationCliArgs {
  mode: SheetsDigestMigrationMode;
  v1CompatPolicy: SheetsDigestV1CompatPolicy;
  confirmProductionApply: boolean;
  confirmProductionRollback: boolean;
  scheduleId: string | undefined;
}

const VALID_MODES = new Set<SheetsDigestMigrationMode>([
  'inventory',
  'dry-run',
  'apply',
  'rollback',
]);

function normalizePolicy(raw: string): SheetsDigestV1CompatPolicy {
  const val = raw.trim().toLowerCase();
  if (val === 'allow_consistency_candidate') {
    return 'allow_consistency_candidate';
  }
  if (val === 'strict_pause_all' || val === 'pause_all') {
    return 'strict_pause_all';
  }
  throw new Error(
    `INVALID_V1_COMPAT_POLICY: Unsupported policy "${raw}". Expected "strict_pause_all" or "allow_consistency_candidate".`
  );
}

export function parseMigrationCliArgs(argv: string[]): ParsedMigrationCliArgs {
  let mode: SheetsDigestMigrationMode = 'inventory';
  let v1CompatPolicy: SheetsDigestV1CompatPolicy =
    process.env.SHEETS_DIGEST_V1_COMPAT_POLICY === 'allow_consistency_candidate'
      ? 'allow_consistency_candidate'
      : 'strict_pause_all';
  let confirmProductionApply = false;
  let confirmProductionRollback = false;
  let scheduleId: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith('--mode=')) {
      const val = arg.slice('--mode='.length).trim() as SheetsDigestMigrationMode;
      if (!VALID_MODES.has(val)) {
        throw new Error(
          `INVALID_MIGRATION_MODE: Unsupported mode "${val}". Expected inventory | dry-run | apply | rollback.`
        );
      }
      mode = val;
    } else if (arg === '--mode' && i + 1 < argv.length) {
      const val = argv[++i]!.trim() as SheetsDigestMigrationMode;
      if (!VALID_MODES.has(val)) {
        throw new Error(
          `INVALID_MIGRATION_MODE: Unsupported mode "${val}". Expected inventory | dry-run | apply | rollback.`
        );
      }
      mode = val;
    } else if (arg.startsWith('--v1-compat-policy=')) {
      v1CompatPolicy = normalizePolicy(arg.slice('--v1-compat-policy='.length));
    } else if (arg === '--v1-compat-policy' && i + 1 < argv.length) {
      v1CompatPolicy = normalizePolicy(argv[++i]!);
    } else if (arg.startsWith('--class-a-policy=')) {
      v1CompatPolicy = normalizePolicy(arg.slice('--class-a-policy='.length));
    } else if (arg === '--class-a-policy' && i + 1 < argv.length) {
      v1CompatPolicy = normalizePolicy(argv[++i]!);
    } else if (arg === '--confirm-production-apply' || arg === '--confirm-production-apply=true') {
      confirmProductionApply = true;
    } else if (
      arg === '--confirm-production-rollback' ||
      arg === '--confirm-production-rollback=true'
    ) {
      confirmProductionRollback = true;
    } else if (arg.startsWith('--schedule-id=')) {
      scheduleId = arg.slice('--schedule-id='.length).trim() || undefined;
    } else if (arg === '--schedule-id' && i + 1 < argv.length) {
      scheduleId = argv[++i]!.trim() || undefined;
    }
  }

  return {
    mode,
    v1CompatPolicy,
    confirmProductionApply,
    confirmProductionRollback,
    scheduleId,
  };
}

export async function runSheetsDigestV2MigrationCli(
  argv: string[],
  poolOverride?: pg.Pool,
  optionsOverride?: Partial<RunSheetsDigestV2MigrationOptions>
): Promise<SheetsDigestMigrationReport> {
  const parsed = parseMigrationCliArgs(argv);
  const connectionString = process.env.DATABASE_URL;
  if (!poolOverride && !connectionString) {
    throw new Error('DATABASE_URL environment variable is required to run sheets-digest-v2-migrate.');
  }

  const pool = poolOverride ?? new pg.Pool({ connectionString });
  try {
    return await runSheetsDigestV2Migration(pool, {
      mode: parsed.mode,
      v1CompatPolicy: parsed.v1CompatPolicy,
      confirmProductionApply: parsed.confirmProductionApply,
      confirmProductionRollback: parsed.confirmProductionRollback,
      scheduleId: parsed.scheduleId,
      ...optionsOverride,
    });
  } finally {
    if (!poolOverride) {
      await pool.end();
    }
  }
}

async function main(): Promise<void> {
  const report = await runSheetsDigestV2MigrationCli(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

const isDirectExecution =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  main().catch((err) => {
    process.stderr.write(
      `[sheets-digest-v2-migrate] ERROR: ${err instanceof Error ? err.message : String(err)}\n`
    );
    process.exitCode = 1;
  });
}
