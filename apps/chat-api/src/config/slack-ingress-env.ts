export interface SlackIngressEnvConfig {
  signingSecret: string;
  appId: string;
  automationEnabled: boolean;
}

const APP_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Reads the signed-ingress configuration. Any failure to obtain a complete config leaves the
 * endpoint mounted but fail-closed (every request answers CONFIG_MISSING), except in live mode
 * where a misconfigured deployment should refuse to boot rather than silently drop Slack events.
 */
export function slackIngressEnv(
  env: Record<string, string | undefined>,
  live: boolean
): SlackIngressEnvConfig | undefined {
  if (env.MYSLACK_ENABLED && !['on', 'off'].includes(env.MYSLACK_ENABLED)) {
    throw new Error('MYSLACK_ENABLED must be on or off');
  }
  if (env.MYSLACK_AUTOMATION_ENABLED && !['on', 'off'].includes(env.MYSLACK_AUTOMATION_ENABLED)) {
    throw new Error('MYSLACK_AUTOMATION_ENABLED must be on or off');
  }
  const required = ['SLACK_SIGNING_SECRET', 'MYSLACK_APP_ID'] as const;
  // Lifecycle cleanup remains available independently of content feature flags.
  // An entirely unconfigured disabled deployment stays fail closed.
  const configured = required.some(key => Boolean(env[key]?.trim()));
  if (env.MYSLACK_ENABLED !== 'on' && !configured) return undefined;
  const missing = required.find(key => !env[key]?.trim());
  if (missing) {
    if (live) throw new Error(`${missing} is required for configured Slack ingress`);
    return undefined;
  }

  const appId = env.MYSLACK_APP_ID!.trim();
  if (!APP_ID.test(appId)) throw new Error('MYSLACK_APP_ID must be a bounded Slack app id');

  return {
    signingSecret: env.SLACK_SIGNING_SECRET!.trim(),
    appId,
    automationEnabled: env.MYSLACK_ENABLED === 'on' && env.MYSLACK_AUTOMATION_ENABLED === 'on',
  };
}
