import type { BaseAdapterConfig } from '../base-adapter.js';

export interface TrelloCredentials {
  apiKey: string;
  token: string;
}

export interface TrelloBaseAdapterConfig extends BaseAdapterConfig {
  credentials: TrelloCredentials;
  baseUrl?: string;
  fetchFn?: typeof fetch;
}
