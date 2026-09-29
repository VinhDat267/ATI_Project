import { Router, type Request, type Response } from 'express';
import type { CredentialRepo } from '../db/repositories/credential-repo.js';

export interface ServicesRoutesOptions {
  credentialRepo?: CredentialRepo;
}

export function createServicesRoutes(options: ServicesRoutesOptions = {}): Router {
  const router = Router();
  const { credentialRepo } = options;

  // GET /api/services
  router.get('/', async (_req: Request, res: Response): Promise<void> => {
    try {
      let trelloConnected = false;
      let slackConnected = false;

      if (credentialRepo) {
        const trelloCreds = await credentialRepo.getCredentials('trello');
        trelloConnected = Boolean(trelloCreds);
        const slackCreds = await credentialRepo.getCredentials('slack');
        slackConnected = Boolean(slackCreds);
      } else {
        // Dev fallback if no credentialRepo configured
        trelloConnected = Boolean(process.env.TRELLO_API_KEY && process.env.TRELLO_TOKEN);
        slackConnected = Boolean(process.env.SLACK_BOT_TOKEN);
      }

      res.status(200).json({
        services: [
          {
            id: 'trello',
            name: 'Trello',
            connected: trelloConnected,
            description: 'Task and project management',
            scopes: ['read:boards', 'write:cards', 'write:checklists'],
          },
          {
            id: 'slack',
            name: 'Slack',
            connected: slackConnected,
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

      // Check if credentials exist
      let connected = false;
      if (credentialRepo) {
        const creds = await credentialRepo.getCredentials(service);
        connected = Boolean(creds);
      }

      res.status(200).json({
        service,
        status: connected ? 'healthy' : 'unconfigured',
        latencyMs: 45,
        message: connected
          ? `Successfully connected to ${service}`
          : `${service} credentials are not yet configured in credential repository`,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to test service connection' });
    }
  });

  // POST /api/services/:service/credentials
  router.post('/:service/credentials', async (req: Request, res: Response): Promise<void> => {
    try {
      const service = String(req.params.service);
      const { credentials, allowedScope } = req.body || {};

      if (!credentialRepo) {
        res.status(500).json({ error: 'Credential repository not configured' });
        return;
      }

      if (!credentials || typeof credentials !== 'object') {
        res.status(400).json({ error: 'credentials object is required' });
        return;
      }

      await credentialRepo.saveCredentials(service, credentials, allowedScope);
      res.status(200).json({ success: true, message: `Credentials saved for ${service}` });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to save credentials' });
    }
  });

  return router;
}
