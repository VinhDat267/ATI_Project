import { Router, type Request, type Response } from 'express';
import type { CredentialRepo } from '../db/repositories/credential-repo.js';
import { encryptCredentials, decryptCredentials } from '@wap/tool-adapters';
import type { AllowedScope } from '@wap/tool-schemas';

export interface ServicesRoutesOptions {
  credentialRepo?: CredentialRepo;
  encryptionKey?: string;
  fetchFn?: typeof fetch;
  onCredentialsChanged?: (service: string) => void;
  adminUserIds?: string[];
}

function normalizeScope(service: string, value: unknown): AllowedScope | null {
  const entries = Array.isArray(value)
    ? value
    : typeof value === 'object' && value !== null
      ? (value as any)[service === 'trello' ? 'boards' : 'channels']
      : null;
  if (!Array.isArray(entries) || entries.length === 0 || !entries.every((x) => typeof x === 'string' && x.trim().length > 0)) return null;
  const ids = [...new Set(entries.map((x: string) => x.trim()))];
  return service === 'trello' ? { boards: ids } : { channels: ids };
}

async function verifyService(service: string, config: any, fetchFn: typeof fetch): Promise<{ healthy: boolean; message: string; latencyMs: number }> {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    let response: globalThis.Response;
    if (service === 'trello') {
      const url = new URL('https://api.trello.com/1/members/me');
      url.searchParams.set('key', config.apiKey);
      url.searchParams.set('token', config.token);
      response = await fetchFn(url, { method: 'GET', signal: controller.signal });
    } else {
      response = await fetchFn('https://slack.com/api/auth.test', {
        method: 'POST', headers: { Authorization: `Bearer ${config.botToken}` }, signal: controller.signal,
      });
    }
    const body = await response.json().catch(() => ({})) as any;
    const healthy = response.ok && (service === 'trello' ? Boolean(body?.id) : body?.ok === true);
    return { healthy, message: healthy ? `Successfully connected to ${service}` : `Provider rejected ${service} credentials`, latencyMs: Math.round(performance.now() - started) };
  } finally {
    clearTimeout(timer);
  }
}

export function createServicesRoutes(options: ServicesRoutesOptions = {}): Router {
  const router = Router();
  const { credentialRepo, encryptionKey } = options;
  const fetchFn = options.fetchFn || fetch;
  const verified = new Set<string>();

  // GET /api/services
  router.get('/', async (_req: Request, res: Response): Promise<void> => {
    try {
      let trelloConnected = false;
      let slackConnected = false;
      let trelloScope: string[] = [];
      let slackScope: string[] = [];

      if (credentialRepo) {
        const trelloCreds = await credentialRepo.getCredentials('trello');
        trelloConnected = Boolean(trelloCreds) && verified.has('trello');
        const slackCreds = await credentialRepo.getCredentials('slack');
        slackConnected = Boolean(slackCreds) && verified.has('slack');
        if (encryptionKey && trelloCreds) {
          const saved = decryptCredentials(trelloCreds.config, encryptionKey) as any;
          trelloScope = saved.allowedScope?.boards ?? [];
        }
        if (encryptionKey && slackCreds) {
          const saved = decryptCredentials(slackCreds.config, encryptionKey) as any;
          slackScope = saved.allowedScope?.channels ?? [];
        }
      } else {
        trelloConnected = false;
        slackConnected = false;
      }

      res.status(200).json({
        services: [
          {
            id: 'trello',
            name: 'Trello',
            connected: trelloConnected,
            allowedScope: trelloScope,
            description: 'Task and project management',
            scopes: ['read:boards', 'write:cards', 'write:checklists'],
          },
          {
            id: 'slack',
            name: 'Slack',
            connected: slackConnected,
            allowedScope: slackScope,
            description: 'Team messaging and notifications',
            scopes: ['chat:write', 'channels:read'],
          },
        ],
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to list services' });
    }
  });

  // POST /api/services/:service/test
  router.post('/:service/test', async (req: Request, res: Response): Promise<void> => {
    try {
      const { service } = req.params;
      if (service !== 'trello' && service !== 'slack') {
        res.status(400).json({ error: `Unsupported service: ${service}` });
        return;
      }

      const record = await credentialRepo?.getCredentials(service);
      if (!record || !encryptionKey) {
        res.status(409).json({ service, status: 'unconfigured', message: `${service} credentials are not configured` });
        return;
      }
      const config = decryptCredentials(record.config, encryptionKey);
      const result = await verifyService(service, config, fetchFn);
      if (result.healthy) verified.add(service);
      else verified.delete(service);
      res.status(result.healthy ? 200 : 502).json({ service, status: result.healthy ? 'healthy' : 'unhealthy', ...result });
    } catch (err: any) {
      res.status(502).json({ status: 'unhealthy', error: 'Service connection verification failed' });
    }
  });

  // POST /api/services/:service/credentials
  router.post('/:service/credentials', async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.id;
      if (!userId || !options.adminUserIds?.includes(userId)) {
        res.status(403).json({ error: 'Only a configured service administrator can change shared credentials' });
        return;
      }
      const service = String(req.params.service);
      const { credentials, allowedScope } = req.body || {};

      if (service !== 'trello' && service !== 'slack') {
        res.status(400).json({ error: 'Unsupported service' });
        return;
      }

      if (!credentialRepo) {
        res.status(500).json({ error: 'Credential repository not configured' });
        return;
      }

      const fields = service === 'trello' ? ['apiKey', 'token'] : ['botToken'];
      if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials) ||
          !fields.every((field) => typeof credentials[field] === 'string' && credentials[field].trim())) {
        res.status(400).json({ error: 'Valid service credentials are required' });
        return;
      }
      const scope = normalizeScope(service, allowedScope);
      if (!scope || !encryptionKey) {
        res.status(400).json({ error: 'A non-empty allowed scope and encryption key are required' });
        return;
      }
      const encrypted = encryptCredentials({ ...Object.fromEntries(fields.map((field) => [field, credentials[field]])), allowedScope: scope }, encryptionKey);
      await credentialRepo.saveCredentials(service, encrypted);
      verified.delete(service);
      options.onCredentialsChanged?.(service);
      res.status(200).json({ success: true, message: `Credentials saved for ${service}` });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to save credentials' });
    }
  });

  return router;
}
