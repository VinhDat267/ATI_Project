import type { BaseAdapterConfig } from '../base-adapter.js';

export interface SlackCredentials {
  botToken: string;
}

export interface SlackAdapterConfig extends BaseAdapterConfig {
  credentials: SlackCredentials;
  baseUrl?: string;
  fetchFn?: typeof fetch;
}
