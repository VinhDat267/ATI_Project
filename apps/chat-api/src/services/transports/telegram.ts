import { TelegramAdapter } from '@wap/tool-adapters';
import type { ServiceTransport } from './types.js';

export const TELEGRAM_TRANSPORT: ServiceTransport = {
  id: 'telegram',
  createAdapter: (config, allowedScope) => new TelegramAdapter({ credentials: { botToken: String(config.botToken) }, allowedScope }),
  checkConnection: (config, fetchFn, signal) => new TelegramAdapter({ credentials: { botToken: String(config.botToken) }, fetchFn }).checkConnection(signal),
};
