import { SheetsAdapter, type GoogleServiceAccountCredentials } from '@wap/tool-adapters';
import type { AllowedScope } from '@wap/tool-schemas';
import type { ServiceTransport } from './types.js';

export const SHEETS_TRANSPORT: ServiceTransport = {
  id: 'sheets',
  createAdapter: (config, allowedScope) => new SheetsAdapter({ credentials: { clientEmail: String(config.clientEmail), privateKey: String(config.privateKey) }, allowedScope }),
  checkConnection: (config, fetchFn, signal) => new SheetsAdapter({
    credentials: config as unknown as GoogleServiceAccountCredentials,
    allowedScope: config.allowedScope as AllowedScope, fetchFn,
  }).checkConnection(signal),
};
