import { CalendarAdapter, type GoogleServiceAccountCredentials } from '@wap/tool-adapters';
import type { AllowedScope } from '@wap/tool-schemas';
import type { ServiceTransport } from './types.js';

export const CALENDAR_TRANSPORT: ServiceTransport = {
  id: 'calendar',
  createAdapter: (config, allowedScope) => new CalendarAdapter({ credentials: { clientEmail: String(config.clientEmail), privateKey: String(config.privateKey) }, allowedScope }),
  checkConnection: (config, fetchFn, signal) => new CalendarAdapter({ credentials: config as unknown as GoogleServiceAccountCredentials, allowedScope: config.allowedScope as AllowedScope, fetchFn }).checkConnection(signal),
};
