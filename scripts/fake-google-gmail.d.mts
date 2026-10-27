import type { Server } from 'node:http';

export const GMAIL_MODIFY_SCOPE: string;
export type FakeOutcome = 'ok' | 'server_error' | 'hang';
export interface FakeGoogleGmailSettings {
  email: string;
  grantedScopes: string[];
  issueRefreshToken: boolean;
  accessTokenTtlSeconds: number;
  accessTokenPrefix: string;
  exchange: FakeOutcome;
  exchangeDelayMs: number;
  refresh: FakeOutcome | 'invalid_grant';
  refreshDelayMs: number;
  revoke: FakeOutcome;
  profile: 'ok' | 'server_error';
  threads: { id: string; messages: any[] }[];
  apiResponses: { status?: number; reason?: string; retryAfter?: string; body?: unknown; mode?: 'hang' | 'disconnect' | 'invalid_json' | 'redirect' | 'server_error' }[];
}
export interface FakeGoogleGmail {
  server: Server;
  origin: string;
  settings: FakeGoogleGmailSettings;
  stats: { authorizations: number; exchanges: number; refreshes: number; revocations: number; profiles: number; writes: number; apiRequests: { method: string; path: string; query: Record<string, string>; body?: any }[] };
  endpoints: { authorizationUrl: string; tokenUrl: string; revokeUrl: string; apiBaseUrl: string };
  mintRefreshToken(email?: string, scopes?: string[], clientId?: string): string;
  isRevoked(token: string): boolean;
  close(): Promise<void>;
}
export function startFakeGoogleGmail(options?: {
  port?: number; now?: () => number; clientId?: string; clientSecret?: string; redirectUri?: string; email?: string;
  clientIds?: string[]; clientProjects?: Record<string, string>; redirectUris?: string[];
  settings?: Partial<FakeGoogleGmailSettings>;
}): Promise<FakeGoogleGmail>;
