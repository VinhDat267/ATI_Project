import { startProbeServer, validateRunnerConfig } from './server.mjs';

const help = `ATI Jira OAuth feasibility probe (JIRA-01)
  --help          Show this message; no network requests
  --check-config  Validate local configuration without starting a server
  --live          Start loopback runner; provider requests require browser actions

Configure JIRA_PROBE_CLIENT_ID, JIRA_PROBE_CLIENT_SECRET, JIRA_PROBE_REDIRECT_URI.
Example: node --env-file=.env.jira-probe packages/tool-adapters/scripts/jira-probe/cli.mjs --live
Callback: http://127.0.0.1:4187/oauth/callback
Never paste client secrets or report raw provider responses into chat.
`;

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') { process.stdout.write(help); return; }
  if (args.length !== 1 || !['--live', '--check-config'].includes(args[0])) { process.stderr.write('Explicit --live is required. Use --help or --check-config.\n'); process.exitCode = 2; return; }
  const fields = ['JIRA_PROBE_CLIENT_ID', 'JIRA_PROBE_CLIENT_SECRET', 'JIRA_PROBE_REDIRECT_URI'];
  const missing = fields.filter(key => !process.env[key]?.trim());
  if (missing.length) { process.stderr.write(`Missing configuration: ${missing.join(', ')}\n`); process.exitCode = 2; return; }
  const config = { clientId: process.env.JIRA_PROBE_CLIENT_ID.trim(), clientSecret: process.env.JIRA_PROBE_CLIENT_SECRET.trim(), redirectUri: process.env.JIRA_PROBE_REDIRECT_URI.trim(), mode: 'live' };
  try {
    validateRunnerConfig(config);
    if (args[0] === '--check-config') { process.stdout.write('Configuration is valid. Provider behavior has NOT_RUN.\n'); return; }
    const server = await startProbeServer(config);
    process.stdout.write(`Jira OAuth probe: ${server.url}\nNo Jira issue/comment writes. Open this URL in one browser. Ctrl+C stops the probe.\n`);
    const stop = () => server.close().then(() => { process.exitCode = 0; });
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  } catch { process.stderr.write('Jira probe configuration/start failed (INVALID_CONFIG_OR_PORT). No secret values are printed.\n'); process.exitCode = 2; }
}

main().catch(() => { process.stderr.write('Jira probe failed. No secret values are printed.\n'); process.exitCode = 2; });
