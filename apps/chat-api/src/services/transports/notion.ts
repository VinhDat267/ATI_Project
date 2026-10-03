import { NotionAdapter } from '@wap/tool-adapters';
import type { AllowedScope } from '@wap/tool-schemas';
import type { ServiceTransport } from './types.js';

export const NOTION_TRANSPORT: ServiceTransport = {
  id: 'notion',
  createAdapter: (config, allowedScope) => new NotionAdapter({ credentials: { token: String(config.token) }, allowedScope }),
  checkConnection: (config, fetchFn, signal) => new NotionAdapter({ credentials: { token: String(config.token) }, allowedScope: config.allowedScope as AllowedScope, fetchFn }).checkConnection(signal),
};
