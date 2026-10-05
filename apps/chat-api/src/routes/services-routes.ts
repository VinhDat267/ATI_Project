import { Router, type Request, type Response } from 'express';
import type { CredentialRepo } from '../db/repositories/credential-repo.js';
import { encryptCredentials, decryptCredentials } from '@wap/tool-adapters';
import { ALL_TOOLS } from '@wap/tool-schemas';
import { createHash } from 'node:crypto';
import { getRegisteredServices, getRegisteredService, hasValidCredentials, normalizeAllowedScope } from '../services/registered-services.js';
import { isAdmin } from '../auth/jwt.js';

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
  const generations = new Map<string, number>();
  const versionOf = (config: string) => createHash('sha256').update(config).digest('hex');
  const checks = new Map<string, { credentialVersion: string | null; connectionStatus: 'healthy' | 'unhealthy' | 'unconfigured'; lastCheckedAt: string }>();

  // GET /api/services
  router.get('/', async (_req: Request, res: Response): Promise<void> => {
    try {
      const services = await Promise.all(getRegisteredServices().map(async definition => {
        const { id, name, description, scopes, scopeKey, scopeLabel, credentialFields } = definition;
        const record = await credentialRepo?.getCredentials(id);
        const config = record && encryptionKey ? decryptCredentials(record.config, encryptionKey) : null;
        const scope = config?.allowedScope as Record<string, unknown> | undefined;
        const entries = scope?.[scopeKey];
        const configured = Boolean(config && hasValidCredentials(credentialFields, config) && normalizeAllowedScope(definition, scope));
        const savedCheck = checks.get(id);
        const check = savedCheck?.credentialVersion === (record ? versionOf(record.config) : null) ? savedCheck : undefined;
        return {
          id, name, description, scopes, scopeKey, scopeLabel, credentialFields,
          tools: ALL_TOOLS.filter(tool => tool.service === id).map(tool => tool.name),
          configured,
          connected: configured && check?.connectionStatus === 'healthy',
          connectionStatus: configured ? (check?.connectionStatus ?? 'unchecked') : 'unconfigured',
          lastCheckedAt: check?.lastCheckedAt ?? null,
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
    const service = String(req.params.service);
    const generation = generations.get(service) ?? 0;
    let credentialVersion: string | null = null;
    try {
      if (!getRegisteredService(service)) {
        res.status(400).json({ error: `Unsupported service: ${service}` });
        return;
      }

      const record = await credentialRepo?.getCredentials(service);
      credentialVersion = record ? versionOf(record.config) : null;
      if (!record || !encryptionKey) {
        if ((generations.get(service) ?? 0) === generation) checks.set(service, { credentialVersion, connectionStatus: 'unconfigured', lastCheckedAt: new Date().toISOString() });
        res.status(409).json({ service, status: 'unconfigured', message: `${service} credentials are not configured` });
        return;
      }
      const config = decryptCredentials(record.config, encryptionKey);
      const result = await verifyService(service, config, fetchFn);
      // An in-flight check belongs to the credentials it read, never to a replacement.
      if ((generations.get(service) ?? 0) === generation) checks.set(service, { credentialVersion, connectionStatus: result.healthy ? 'healthy' : 'unhealthy', lastCheckedAt: new Date().toISOString() });
      res.status(result.healthy ? 200 : 502).json({ service, status: result.healthy ? 'healthy' : 'unhealthy', ...result });
    } catch (err: any) {
      if ((generations.get(service) ?? 0) === generation) checks.set(service, { credentialVersion, connectionStatus: 'unhealthy', lastCheckedAt: new Date().toISOString() });
      res.status(502).json({ status: 'unhealthy', error: 'Service connection verification failed' });
    }
  });

  // POST /api/services/:service/credentials
  router.post('/:service/credentials', async (req: Request, res: Response): Promise<void> => {
    try {
      if (!isAdmin((req as any).user, options.adminUserIds)) {
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
      const scope = normalizeAllowedScope(registration.definition, allowedScope);
      if (!scope || !encryptionKey) {
        res.status(400).json({ error: 'A non-empty allowed scope and encryption key are required' });
        return;
      }
      const encrypted = encryptCredentials({ ...Object.fromEntries(fields.map(({ key }) => [key, credentials[key]])), allowedScope: scope }, encryptionKey);
      await credentialRepo.saveCredentials(service, encrypted);
      generations.set(service, (generations.get(service) ?? 0) + 1);
      checks.delete(service);
      options.onCredentialsChanged?.(service);
      res.status(200).json({ success: true, message: `Credentials saved for ${service}` });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to save credentials' });
    }
  });

  // PUT /api/services/:service/scope
  router.put('/:service/scope', async (req: Request, res: Response): Promise<void> => {
    try {
      if (!isAdmin((req as any).user, options.adminUserIds)) {
        res.status(403).json({ error: 'Only a configured service administrator can change shared credentials' });
        return;
      }
      const service = String(req.params.service);
      const registration = getRegisteredService(service);
      if (!registration) {
        res.status(400).json({ error: 'Unsupported service' });
        return;
      }
      if (!credentialRepo) {
        res.status(500).json({ error: 'Credential repository not configured' });
        return;
      }
      const scope = normalizeAllowedScope(registration.definition, req.body?.allowedScope);
      if (!scope || !encryptionKey) {
        res.status(400).json({ error: 'A non-empty allowed scope and encryption key are required' });
        return;
      }
      const saved = await credentialRepo.updateCredentials(service, config => encryptCredentials({
        ...decryptCredentials(config, encryptionKey), allowedScope: scope,
      }, encryptionKey));
      if (!saved) {
        res.status(409).json({ error: 'Hãy lưu thông tin kết nối dịch vụ trước khi đổi phạm vi tài nguyên.' });
        return;
      }
      generations.set(service, (generations.get(service) ?? 0) + 1);
      checks.delete(service);
      options.onCredentialsChanged?.(service);
      res.status(200).json({ success: true, message: `Allowed scope saved for ${service}` });
    } catch {
      res.status(500).json({ error: 'Không thể lưu phạm vi tài nguyên. Hãy thử lại.' });
    }
  });

  return router;
}
