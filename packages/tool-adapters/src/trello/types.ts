import type { BaseAdapterConfig } from '../base-adapter.js';

export interface TrelloCredentials {
  accessToken: string;
}

export interface TrelloBaseAdapterConfig extends BaseAdapterConfig {
  credentials: TrelloCredentials;
  allowedBoardIds?: readonly string[];
  baseUrl?: string;
  fetchFn?: typeof fetch;
}
