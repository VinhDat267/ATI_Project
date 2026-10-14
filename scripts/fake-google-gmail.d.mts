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
  refresh: FakeOutcome | 'invalid_grant';
  refreshDelayMs: number;
  revoke: FakeOutcome;
  profile: 'ok' | 'server_error';
}
export interface FakeGoogleGmail {
  server: Server;
  origin: string;
  settings: FakeGoogleGmailSettings;
  stats: { authorizations: number; exchanges: number; refreshes: number; revocations: number; profiles: number };
  endpoints: { authorizationUrl: string; tokenUrl: string; revokeUrl: string; apiBaseUrl: string };
  mintRefreshToken(email?: string): string;
  isRevoked(token: string): boolean;
  close(): Promise<void>;
}
export function startFakeGoogleGmail(options?: {
  port?: number; now?: () => number; clientId?: string; clientSecret?: string; redirectUri?: string; email?: string;
  settings?: Partial<FakeGoogleGmailSettings>;
}): Promise<FakeGoogleGmail>;
