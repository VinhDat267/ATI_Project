import pg from 'pg';
import { SlackConsentRepo, type SlackPurpose, ALLOWED_SLACK_PURPOSES } from '../db/repositories/slack-consent-repo.js';
import { resolveRuntimeProviderIdentity } from '../config/slack-policy-runtime.js';

function parseArgs(args: string[]): { command?: string; options: Record<string, string | boolean> } {
  const options: Record<string, string | boolean> = {};
  let command: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        options[key] = next;
        i++;
      } else {
        options[key] = true;
      }
    } else if (!command) {
      command = arg;
    }
  }

  return { command, options };
}

function printUsage() {
  console.log(`
Usage: slack-consent <command> [options]

Commands:
  attest-provider
    --id <id>                    Provider ID (e.g. gemini, openai-compatible)
    --name <name>                Display name for provider
    --verified                   Mark provider as verified (default false)
    --no-training                Provider contractually does not train on data
    --max-retention <days>       Maximum allowed retention days (default 0)
    --fingerprint <hash>         Runtime config fingerprint (defaults to env-based fingerprint)
    --evidence-ref <ref>         Audit / contract evidence ref (required if verified)
    --by <operator>              Operator identity performing attestation (required if verified)
    --expected-revision <rev>    CAS expected revision check

  grant
    --workspace <id>             Slack workspace ID (e.g. T12345)
    --provider <id>              Provider ID
    --policy-version <ver>       Policy version string (e.g. v1.0.0)
    --purposes <list>            Comma-separated allowed purposes (e.g. manual_lookup,triage)
    --retention <days>           Retention TTL in days (>= 0, default 0)
    --representative <name>      Organization representative authorizing processing
    --evidence-ref <ref>         DPA / SLA document reference
    --by <operator>              Operator recording the consent
    --expected-revision <rev>    CAS expected revision check

  revoke
    --workspace <id>             Slack workspace ID
    --provider <id>              Provider ID
    --reason <reason>            Reason for revocation
    --by <operator>              Operator recording the revocation
    --expected-revision <rev>    CAS expected revision check

  list
    --workspace <id>             Optional: workspace ID to filter consents
`);
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));

  if (options.help || !command) {
    printUsage();
    process.exit(0);
  }

  const dbUrl = process.env.DATABASE_URL || 'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3';
  const pool = new pg.Pool({ connectionString: dbUrl });
  const repo = new SlackConsentRepo(pool);

  try {
    switch (command) {
      case 'attest-provider': {
        const id = typeof options.id === 'string' ? options.id.trim() : '';
        const name = typeof options.name === 'string' ? options.name.trim() : '';
        const verified = options.verified === true || options.verified === 'true';
        const noTraining = options['no-training'] === true || options['no-training'] === 'true';
        const maxRetentionRaw = options['max-retention'] !== undefined ? Number(options['max-retention']) : 0;
        const evidenceRef = typeof options['evidence-ref'] === 'string' ? options['evidence-ref'].trim() : undefined;
        const verifiedBy = typeof options.by === 'string' ? options.by.trim() : undefined;
        const expectedRevision = options['expected-revision'] !== undefined ? BigInt(String(options['expected-revision'])) : undefined;

        if (!id) throw new Error("Missing required flag: --id");
        if (!name) throw new Error("Missing required flag: --name");

        if (verified) {
          if (!evidenceRef) throw new Error("Verified provider requires non-blank --evidence-ref");
          if (!verifiedBy) throw new Error("Verified provider requires non-blank --by");
        }

        let fingerprint = typeof options.fingerprint === 'string' ? options.fingerprint.trim() : '';
        if (!fingerprint) {
          const runtimeId = resolveRuntimeProviderIdentity();
          fingerprint = runtimeId.fingerprint;
        }

        const res = await repo.attestProvider({
          id,
          name,
          verified,
          noTraining,
          maxRetentionDays: maxRetentionRaw,
          configurationFingerprint: fingerprint,
          evidenceRef,
          verifiedBy,
          verifiedAt: verified ? new Date() : undefined,
          expectedRevision,
        });

        console.log(JSON.stringify({
          status: 'ok',
          provider: {
            ...res,
            revision: res.revision.toString(),
          },
        }, null, 2));
        break;
      }

      case 'grant': {
        const workspaceId = typeof options.workspace === 'string' ? options.workspace.trim() : '';
        const providerId = typeof options.provider === 'string' ? options.provider.trim() : '';
        const policyVersion = typeof options['policy-version'] === 'string' ? options['policy-version'].trim() : '';
        const representative = typeof options.representative === 'string' ? options.representative.trim() : '';
        const evidenceRef = typeof options['evidence-ref'] === 'string' ? options['evidence-ref'].trim() : '';
        const recordedBy = typeof options.by === 'string' ? options.by.trim() : '';
        const retentionDays = options.retention !== undefined ? Number(options.retention) : 0;
        const expectedRevision = options['expected-revision'] !== undefined ? BigInt(String(options['expected-revision'])) : undefined;

        if (!workspaceId) throw new Error("Missing required flag: --workspace");
        if (!providerId) throw new Error("Missing required flag: --provider");
        if (!policyVersion) throw new Error("Missing required flag: --policy-version");
        if (!representative) throw new Error("Missing required flag: --representative");
        if (!evidenceRef) throw new Error("Missing required flag: --evidence-ref");
        if (!recordedBy) throw new Error("Missing required flag: --by");

        const rawPurposes = typeof options.purposes === 'string' ? options.purposes.split(',').map(s => s.trim()).filter(Boolean) : [];
        if (rawPurposes.length === 0) {
          throw new Error(`Missing or empty --purposes flag. Allowed: ${ALLOWED_SLACK_PURPOSES.join(', ')}`);
        }

        const res = await repo.grantConsent({
          workspaceId,
          providerId,
          policyVersion,
          purposes: rawPurposes as SlackPurpose[],
          retentionDays,
          organizationRepresentative: representative,
          evidenceRef,
          recordedBy,
          expectedRevision,
        });

        console.log(JSON.stringify({
          status: 'ok',
          consent: {
            ...res,
            revision: res.revision.toString(),
          },
        }, null, 2));
        break;
      }

      case 'revoke': {
        const workspaceId = typeof options.workspace === 'string' ? options.workspace.trim() : '';
        const providerId = typeof options.provider === 'string' ? options.provider.trim() : '';
        const reason = typeof options.reason === 'string' ? options.reason.trim() : '';
        const recordedBy = typeof options.by === 'string' ? options.by.trim() : '';
        const expectedRevision = options['expected-revision'] !== undefined ? BigInt(String(options['expected-revision'])) : undefined;

        if (!workspaceId) throw new Error("Missing required flag: --workspace");
        if (!providerId) throw new Error("Missing required flag: --provider");
        if (!reason) throw new Error("Missing required flag: --reason");
        if (!recordedBy) throw new Error("Missing required flag: --by");

        const res = await repo.revokeConsent({
          workspaceId,
          providerId,
          reason,
          recordedBy,
          expectedRevision,
        });

        if (!res) {
          throw new Error(`No consent record found for workspace '${workspaceId}' and provider '${providerId}'`);
        }

        console.log(JSON.stringify({
          status: 'ok',
          consent: {
            ...res,
            revision: res.revision.toString(),
          },
        }, null, 2));
        break;
      }

      case 'list': {
        const workspaceId = typeof options.workspace === 'string' ? options.workspace.trim() : '';
        if (workspaceId) {
          const consents = await repo.listConsentsForWorkspace(workspaceId);
          console.log(JSON.stringify(consents.map(c => ({ ...c, revision: c.revision.toString() })), null, 2));
        } else {
          const providers = await repo.listTrustedProviders();
          console.log(JSON.stringify(providers.map(p => ({ ...p, revision: p.revision.toString() })), null, 2));
        }
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        printUsage();
        process.exit(1);
    }
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Execute when invoked directly
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').includes('slack-consent.ts')) {
  main();
}

