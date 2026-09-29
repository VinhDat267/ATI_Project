import { Router, type Request, type Response } from 'express';
import type { CredentialRepo } from '../db/repositories/credential-repo.js';
import { encryptCredentials, decryptCredentials } from '@wap/tool-adapters';
import { REGISTERED_SERVICES, getRegisteredService, hasValidCredentials, normalizeAllowedScope } from '../services/registered-services.js';

export interface ServicesRoutesOptions {
  credentialRepo?: CredentialRepo;
  encryptionKey?: string;
  fetchFn?: typeof fetch;
  onCredentialsChanged?: (service: string) => void;
  adminUserIds?: string[];
}

async function verifyService(service: string, config: Record<string, unknown>, fetchFn: typeof fetch): Promise<{ healthy: boolean; message: string; latencyMs: number }> {
  const registration = getRegisteredService(service);
  if (!registration) throw new Error(`Unsupported service '${service}'`);
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const healthy = await registration.transport.checkConnection(config, fetchFn, controller.signal);
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
      const services = await Promise.all(REGISTERED_SERVICES.map(async ({ id, name, description, scopes, scopeKey, credentialFields }) => {
        const record = await credentialRepo?.getCredentials(id);
        const config = record && encryptionKey ? decryptCredentials(record.config, encryptionKey) : null;
        const scope = config?.allowedScope as Record<string, unknown> | undefined;
        const entries = scope?.[scopeKey];
        return {
          id, name, description, scopes, scopeKey, credentialFields,
          connected: Boolean(record) && verified.has(id),
          allowedScope: Array.isArray(entries) ? entries : [],
        };
      }));
      res.status(200).json({ services });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to list services' });
    }
  });

  // POST /api/services/:service/test
  router.post('/:service/test', async (req: Request, res: Response): Promise<void> => {
    try {
      const service = String(req.params.service);
      if (!getRegisteredService(service)) {
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
      const registration = getRegisteredService(service);
      if (!registration) {
        res.status(400).json({ error: 'Unsupported service' });
        return;
      }

      if (!credentialRepo) {
        res.status(500).json({ error: 'Credential repository not configured' });
        return;
      }

      const fields = registration.definition.credentialFields;
      if (!hasValidCredentials(fields, credentials)) {
        res.status(400).json({ error: 'Valid service credentials are required' });
        return;
      }
      const scope = normalizeAllowedScope(registration.definition.scopeKey, allowedScope);
      if (!scope || !encryptionKey) {
        res.status(400).json({ error: 'A non-empty allowed scope and encryption key are required' });
        return;
      }
      const encrypted = encryptCredentials({ ...Object.fromEntries(fields.map(({ key }) => [key, credentials[key]])), allowedScope: scope }, encryptionKey);
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
