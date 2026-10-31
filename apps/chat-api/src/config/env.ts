import { randomBytes } from 'node:crypto';
import { GOOGLE_ENDPOINTS, type GoogleOAuthConfig } from '../auth/google-oidc.js';

/** The Gmail OAuth client of its own Google Cloud project (not the sign-in client). */
export interface GmailOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authorizationUrl: string;
  tokenUrl: string;
  revokeUrl: string;
  apiBaseUrl: string;
}
export const GMAIL_ENDPOINTS = {
  authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  revokeUrl: 'https://oauth2.googleapis.com/revoke',
  apiBaseUrl: 'https://gmail.googleapis.com',
};
const GMAIL_ENDPOINT_OVERRIDES = { authorizationUrl: 'GMAIL_OAUTH_AUTH_URL', tokenUrl: 'GMAIL_OAUTH_TOKEN_URL', revokeUrl: 'GMAIL_OAUTH_REVOKE_URL', apiBaseUrl: 'GMAIL_API_BASE_URL' } as const;

export const MYCALENDAR_ENDPOINTS = {
  authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  revokeUrl: 'https://oauth2.googleapis.com/revoke',
  apiBaseUrl: 'https://www.googleapis.com',
};
const MYCALENDAR_ENDPOINT_OVERRIDES = { authorizationUrl: 'MYCALENDAR_OAUTH_AUTH_URL', tokenUrl: 'MYCALENDAR_OAUTH_TOKEN_URL', revokeUrl: 'MYCALENDAR_OAUTH_REVOKE_URL', apiBaseUrl: 'MYCALENDAR_API_BASE_URL' } as const;

export const MYSHEETS_ENDPOINTS = {
  authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  revokeUrl: 'https://oauth2.googleapis.com/revoke',
  apiBaseUrl: 'https://sheets.googleapis.com',
};
const MYSHEETS_ENDPOINT_OVERRIDES = { authorizationUrl: 'MYSHEETS_OAUTH_AUTH_URL', tokenUrl: 'MYSHEETS_OAUTH_TOKEN_URL', revokeUrl: 'MYSHEETS_OAUTH_REVOKE_URL', apiBaseUrl: 'MYSHEETS_API_BASE_URL' } as const;

export interface TrelloOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authorizationUrl: string;
  tokenUrl: string;
  apiBaseUrl: string;
}
export const TRELLO_ENDPOINTS = {
  authorizationUrl: 'https://auth.atlassian.com/authorize',
  tokenUrl: 'https://auth.atlassian.com/oauth/token',
  apiBaseUrl: 'https://api.trello.com/1',
};
const TRELLO_ENDPOINT_OVERRIDES = { authorizationUrl: 'TRELLO_OAUTH_AUTH_URL', tokenUrl: 'TRELLO_OAUTH_TOKEN_URL', apiBaseUrl: 'TRELLO_API_BASE_URL' } as const;

export interface EnvConfig {
  DATABASE_URL: string;
  JWT_SECRET: string;
  ENCRYPTION_KEY: string;
  GEMINI_API_KEY: string;
  LLM_PROVIDER: 'gemini' | 'openai-compatible';
  /** 'llm': the model calls search tools itself; 'regex': registry gather rules resolve names first. */
  PLANNER_SEARCH_MODE: 'llm' | 'regex';
  PLANNER_READ_ANSWERS: boolean;
  /** IANA zone the planner resolves relative dates such as "thứ 6" in. */
  APP_TIME_ZONE: string;
  PORT: number;
  RUNTIME_MODE: 'live' | 'sandbox';
  AUTH_SIGNUP_ENABLED: boolean;
  /** Google registration uses the raw account policy independently of SMTP availability. */
  GOOGLE_SIGNUP_ENABLED: boolean;
  GOOGLE_OAUTH?: GoogleOAuthConfig;
  /** The GMAIL_ENABLED flag (default off). Gmail is usable only with GMAIL_OAUTH and PostgreSQL as well. */
  GMAIL_ENABLED: boolean;
  /** Complete only when the flag is on; sandbox also needs every fake endpoint. Missing in sandbox means 503. */
  GMAIL_OAUTH?: GmailOAuthConfig;
  /** The MYCALENDAR_ENABLED flag (default off). Personal Calendar is usable only with MYCALENDAR_OAUTH and PostgreSQL as well. */
  MYCALENDAR_ENABLED: boolean;
  /** Complete only when the flag is on; sandbox also needs every fake endpoint. Missing in sandbox means 503. */
  MYCALENDAR_OAUTH?: GmailOAuthConfig;
  /** The MYSHEETS_ENABLED flag (default off). Personal Sheets is usable only with MYSHEETS_OAUTH and PostgreSQL as well. */
  MYSHEETS_ENABLED: boolean;
  /** Complete only when the flag is on; sandbox also needs every fake endpoint. Missing in sandbox means 503. */
  MYSHEETS_OAUTH?: GmailOAuthConfig;
  MYSHEETS_PICKER?: { apiKey: string; appId: string };
  TRELLO_OAUTH?: TrelloOAuthConfig;
  /** The SCHEDULES_ENABLED flag (default off). Schedules also need PostgreSQL. */
  SCHEDULES_ENABLED: boolean;
  /** False only in live without SMTP: signup and every email route answer 503 (AUTH-02b). Sandbox uses the outbox. */
  EMAIL_ENABLED: boolean;
  APP_BASE_URL: string;
  SMTP_HOST: string;
  SMTP_PORT: number;
  SMTP_USER: string;
  SMTP_PASSWORD: string;
  MAIL_FROM: string;
}

export function validateEnv(env: Record<string, string | undefined> = process.env): EnvConfig {
  const isProduction = env.NODE_ENV === 'production';
  const isLive = env.RUNTIME_MODE === 'live';
  if (env.RUNTIME_MODE && env.RUNTIME_MODE !== 'live' && env.RUNTIME_MODE !== 'sandbox') {
    throw new Error('RUNTIME_MODE must be live or sandbox');
  }
  if (isProduction && env.RUNTIME_MODE !== 'live') {
    throw new Error('RUNTIME_MODE=live is required in production');
  }
  const LLM_PROVIDER = env.LLM_PROVIDER || 'gemini';
  if (LLM_PROVIDER !== 'gemini' && LLM_PROVIDER !== 'openai-compatible') {
    throw new Error('LLM_PROVIDER must be gemini or openai-compatible');
  }
  const PLANNER_SEARCH_MODE = env.PLANNER_SEARCH_MODE || (isLive ? 'llm' : 'regex');
  const readAnswers = env.PLANNER_READ_ANSWERS ?? 'off';
  if (readAnswers !== 'on' && readAnswers !== 'off') throw new Error('PLANNER_READ_ANSWERS must be on or off');
  const PLANNER_READ_ANSWERS = readAnswers === 'on';
  if (PLANNER_SEARCH_MODE !== 'llm' && PLANNER_SEARCH_MODE !== 'regex') {
    throw new Error('PLANNER_SEARCH_MODE must be llm or regex');
  }
  const APP_TIME_ZONE = env.APP_TIME_ZONE || 'Asia/Ho_Chi_Minh';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: APP_TIME_ZONE });
  } catch {
    throw new Error(`APP_TIME_ZONE must be an IANA time zone such as Asia/Ho_Chi_Minh, got ${APP_TIME_ZONE}`);
  }

  if (isProduction || isLive) {
    if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required in production/live mode');
    if (!env.JWT_SECRET || env.JWT_SECRET === 'default_jwt_secret_min_32_characters_long_for_dev') {
      throw new Error('JWT_SECRET must be explicitly provided with a secure secret in production/live mode');
    }
    if (Buffer.byteLength(env.JWT_SECRET, 'utf8') < 32) {
      throw new Error('JWT_SECRET must be at least 32 bytes in production/live mode');
    }
    if (!env.ENCRYPTION_KEY || env.ENCRYPTION_KEY === '01234567890123456789012345678901') {
      throw new Error('ENCRYPTION_KEY must be explicitly provided in production/live mode (32 bytes)');
    }
    if (Buffer.byteLength(env.ENCRYPTION_KEY, 'utf8') !== 32 && !/^[0-9a-fA-F]{64}$/.test(env.ENCRYPTION_KEY)) {
      throw new Error('ENCRYPTION_KEY must be 32 bytes or 64 hex characters');
    }
    if (LLM_PROVIDER === 'openai-compatible') {
      if (!env.LLM_BASE_URL) throw new Error('LLM_BASE_URL must be provided for LLM_PROVIDER=openai-compatible');
      if (!env.LLM_MODEL) throw new Error('LLM_MODEL must be provided for LLM_PROVIDER=openai-compatible');
    } else if (!env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY must be provided in production/live mode');
    }
  }

  const DATABASE_URL = env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ati_v3';
  if (env.JWT_SECRET && (
    env.JWT_SECRET === 'default_jwt_secret_min_32_characters_long_for_dev' ||
    Buffer.byteLength(env.JWT_SECRET, 'utf8') < 32
  )) {
    throw new Error('JWT_SECRET must be a private secret of at least 32 bytes');
  }
  const JWT_SECRET = env.JWT_SECRET || randomBytes(32).toString('hex');
  const ENCRYPTION_KEY = env.ENCRYPTION_KEY || '01234567890123456789012345678901';
  const GEMINI_API_KEY = env.GEMINI_API_KEY || '';
  const PORT = Number(env.PORT) || 3000;
  const RUNTIME_MODE = (env.RUNTIME_MODE === 'live' ? 'live' : 'sandbox') as 'live' | 'sandbox';

  if (env.AUTH_SIGNUP_ENABLED && !['true', 'false'].includes(env.AUTH_SIGNUP_ENABLED)) {
    throw new Error('AUTH_SIGNUP_ENABLED must be true or false');
  }
  const smtpFields = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'MAIL_FROM'];
  const EMAIL_ENABLED = !isLive || smtpFields.some(field => env[field]?.trim());
  // Live may start without any SMTP setting; a partial configuration is still a startup error.
  if (isLive && EMAIL_ENABLED) {
    for (const field of [...smtpFields, 'APP_BASE_URL']) {
      if (!env[field]?.trim()) throw new Error(`${field} is required in live mode`);
    }
  }
  const AUTH_SIGNUP_ENABLED = EMAIL_ENABLED && env.AUTH_SIGNUP_ENABLED !== 'false';
  const SMTP_PORT = env.SMTP_PORT ? Number(env.SMTP_PORT) : 465;
  if (!Number.isInteger(SMTP_PORT) || SMTP_PORT < 1 || SMTP_PORT > 65535) throw new Error('SMTP_PORT must be a valid TCP port');
  const MAIL_FROM = env.MAIL_FROM || '';
  if (/[\r\n]/.test(MAIL_FROM)) throw new Error('MAIL_FROM must not contain line breaks');
  let APP_BASE_URL: string;
  try {
    const url = new URL(env.APP_BASE_URL || 'http://127.0.0.1:5174');
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if (!['https:', 'http:'].includes(url.protocol) || (isLive && url.protocol !== 'https:' && !loopback)
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
    APP_BASE_URL = url.origin;
  } catch { throw new Error('APP_BASE_URL must be a web origin (HTTPS in live, or loopback HTTP)'); }

  let GOOGLE_OAUTH: GoogleOAuthConfig | undefined;
  if (env.GOOGLE_OAUTH_CLIENT_ID?.trim() && env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() && env.GOOGLE_OAUTH_REDIRECT_URI?.trim()) {
    let redirectUri: string;
    try {
      const url = new URL(env.GOOGLE_OAUTH_REDIRECT_URI.trim());
      const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
      if (!['http:', 'https:'].includes(url.protocol) || (isLive && url.protocol !== 'https:' && !loopback)
        || url.username || url.password || url.pathname !== '/auth/google/callback' || url.search || url.hash) throw new Error();
      redirectUri = url.href;
    } catch { throw new Error('GOOGLE_OAUTH_REDIRECT_URI must be the web /auth/google/callback URL without query, fragment or credentials'); }
    const endpoints = { ...GOOGLE_ENDPOINTS };
    if (!isLive) {
      for (const [key, field] of Object.entries({ authorizationUrl: 'GOOGLE_OAUTH_AUTH_URL', tokenUrl: 'GOOGLE_OAUTH_TOKEN_URL', jwksUrl: 'GOOGLE_OAUTH_JWKS_URL' })) {
        if (!env[field]?.trim()) continue;
        try {
          const url = new URL(env[field]!.trim());
          if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error();
          endpoints[key as keyof typeof endpoints] = url.href;
        } catch { throw new Error(`${field} must be an HTTP(S) endpoint without credentials or fragment`); }
      }
    }
    GOOGLE_OAUTH = { clientId: env.GOOGLE_OAUTH_CLIENT_ID.trim(), clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET.trim(), redirectUri, ...endpoints };
  }

  if (env.GMAIL_ENABLED && !['on', 'off'].includes(env.GMAIL_ENABLED)) throw new Error('GMAIL_ENABLED must be on or off');
  const GMAIL_ENABLED = env.GMAIL_ENABLED === 'on';
  const GMAIL_OAUTH = GMAIL_ENABLED ? gmailOAuth(env, isLive) : undefined;
  if (env.MYCALENDAR_ENABLED && !['on', 'off'].includes(env.MYCALENDAR_ENABLED)) throw new Error('MYCALENDAR_ENABLED must be on or off');
  const MYCALENDAR_ENABLED = env.MYCALENDAR_ENABLED === 'on';
  const MYCALENDAR_OAUTH = MYCALENDAR_ENABLED ? mycalendarOAuth(env, isLive) : undefined;
  if (env.MYSHEETS_ENABLED && !['on', 'off'].includes(env.MYSHEETS_ENABLED)) throw new Error('MYSHEETS_ENABLED must be on or off');
  const MYSHEETS_ENABLED = env.MYSHEETS_ENABLED === 'on';
  const MYSHEETS_OAUTH = MYSHEETS_ENABLED ? mysheetsOAuth(env, isLive) : undefined;
  const MYSHEETS_PICKER = MYSHEETS_ENABLED ? mysheetsPicker(env, isLive) : undefined;
  if (isLive && (MYCALENDAR_ENABLED || MYSHEETS_ENABLED)) validatePersonalGoogleProjects(env);
  if (env.SCHEDULES_ENABLED && !['on', 'off'].includes(env.SCHEDULES_ENABLED)) throw new Error('SCHEDULES_ENABLED must be on or off');
  const SCHEDULES_ENABLED = env.SCHEDULES_ENABLED === 'on';
  const TRELLO_OAUTH = trelloOAuth(env, isLive);

  return {
    DATABASE_URL,
    JWT_SECRET,
    ENCRYPTION_KEY,
    GEMINI_API_KEY,
    LLM_PROVIDER,
    PLANNER_SEARCH_MODE,
    PLANNER_READ_ANSWERS,
    APP_TIME_ZONE,
    PORT,
    RUNTIME_MODE,
    AUTH_SIGNUP_ENABLED,
    GOOGLE_SIGNUP_ENABLED: env.AUTH_SIGNUP_ENABLED !== 'false',
    GOOGLE_OAUTH,
    GMAIL_ENABLED,
    GMAIL_OAUTH,
    MYCALENDAR_ENABLED,
    MYCALENDAR_OAUTH,
    MYSHEETS_ENABLED,
    MYSHEETS_OAUTH,
    MYSHEETS_PICKER,
    TRELLO_OAUTH,
    SCHEDULES_ENABLED,
    EMAIL_ENABLED,
    APP_BASE_URL,
    SMTP_HOST: env.SMTP_HOST || '',
    SMTP_PORT,
    SMTP_USER: env.SMTP_USER || '',
    SMTP_PASSWORD: env.SMTP_PASSWORD || '',
    MAIL_FROM,
  };
}

/** Google revoke affects every client of a project, including disabled services' existing grants. */
function validatePersonalGoogleProjects(env: Record<string, string | undefined>): void {
  const projectId = (field: string, triggerFlag: string = 'MYCALENDAR_ENABLED') => {
    const value = env[field]?.trim();
    if (!value || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(value)) {
      throw new Error(`${field} must declare the Google Cloud project ID when ${triggerFlag}=on in live mode`);
    }
    return value;
  };

  const services: Array<{ name: string; prefix: string; on: boolean; hasClient: boolean }> = [
    { name: 'Gmail', prefix: 'GMAIL', on: env.GMAIL_ENABLED === 'on', hasClient: Boolean(env.GMAIL_OAUTH_CLIENT_ID?.trim() || env.GMAIL_OAUTH_PROJECT_ID?.trim()) },
    { name: 'MyCalendar', prefix: 'MYCALENDAR', on: env.MYCALENDAR_ENABLED === 'on', hasClient: Boolean(env.MYCALENDAR_OAUTH_CLIENT_ID?.trim() || env.MYCALENDAR_OAUTH_PROJECT_ID?.trim()) },
    { name: 'MySheets', prefix: 'MYSHEETS', on: env.MYSHEETS_ENABLED === 'on', hasClient: Boolean(env.MYSHEETS_OAUTH_CLIENT_ID?.trim() || env.MYSHEETS_OAUTH_PROJECT_ID?.trim()) },
  ];

  const activeServices = services.filter((s) => s.on || s.hasClient);
  if (activeServices.length === 0) return;

  const projectMap = new Map<string, string>();
  const clientMap = new Map<string, string>();

  for (const s of activeServices) {
    const trigger = s.on ? `${s.prefix}_ENABLED` : (env.MYCALENDAR_ENABLED === 'on' ? 'MYCALENDAR_ENABLED' : `${s.prefix}_ENABLED`);
    const pId = projectId(`${s.prefix}_OAUTH_PROJECT_ID`, trigger);
    projectMap.set(s.name, pId);

    const cId = env[`${s.prefix}_OAUTH_CLIENT_ID`]?.trim();
    if (cId) {
      clientMap.set(s.name, cId);
    }
  }

  const names = ['Gmail', 'MyCalendar', 'MySheets'];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const nameA = names[i]!;
      const nameB = names[j]!;
      const projA = projectMap.get(nameA);
      const projB = projectMap.get(nameB);
      if (projA && projB && projA === projB) {
        throw new Error(`${nameA} and ${nameB} must use separate Google Cloud projects for independent token revocation`);
      }
      const clientA = clientMap.get(nameA);
      const clientB = clientMap.get(nameB);
      if (clientA && clientB && clientA === clientB) {
        throw new Error(`${nameA} and ${nameB} must use different OAuth clients from separate Google Cloud projects`);
      }
    }
  }
}

/** Live with the flag on refuses to start on a missing variable; sandbox disables Gmail instead. */
function gmailOAuth(env: Record<string, string | undefined>, isLive: boolean): GmailOAuthConfig | undefined {
  const required = ['GMAIL_OAUTH_CLIENT_ID', 'GMAIL_OAUTH_CLIENT_SECRET', 'GMAIL_OAUTH_REDIRECT_URI'];
  const missing = required.find((field) => !env[field]?.trim());
  if (missing && isLive) throw new Error(`${missing} is required when GMAIL_ENABLED=on in live mode`);
  let redirectUri: string | undefined;
  if (env.GMAIL_OAUTH_REDIRECT_URI?.trim()) {
    try {
      const url = new URL(env.GMAIL_OAUTH_REDIRECT_URI.trim());
      const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
      if (!['http:', 'https:'].includes(url.protocol) || (isLive && url.protocol !== 'https:' && !loopback)
        || url.username || url.password || url.pathname !== '/connections/gmail/callback' || url.search || url.hash) throw new Error();
      redirectUri = url.href;
    } catch { throw new Error('GMAIL_OAUTH_REDIRECT_URI must be the web /connections/gmail/callback URL without query, fragment or credentials (HTTPS in live, or loopback HTTP)'); }
  }
  // Live always talks to Google; elsewhere every endpoint must point at a stand-in, so a sandbox never reaches Google.
  const endpoints = { ...GMAIL_ENDPOINTS };
  if (!isLive) {
    for (const [key, field] of Object.entries(GMAIL_ENDPOINT_OVERRIDES)) {
      if (!env[field]?.trim()) return undefined;
      try {
        const url = new URL(env[field]!.trim());
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error();
        endpoints[key as keyof typeof endpoints] = url.href.replace(/\/$/, '');
      } catch { throw new Error(`${field} must be an HTTP(S) endpoint without credentials or fragment`); }
    }
  }
  if (missing || !redirectUri) return undefined;
  return { clientId: env.GMAIL_OAUTH_CLIENT_ID!.trim(), clientSecret: env.GMAIL_OAUTH_CLIENT_SECRET!.trim(), redirectUri, ...endpoints };
}

/** Live with the flag on refuses to start on a missing variable; sandbox disables MyCalendar instead. */
function mycalendarOAuth(env: Record<string, string | undefined>, isLive: boolean): GmailOAuthConfig | undefined {
  const required = ['MYCALENDAR_OAUTH_CLIENT_ID', 'MYCALENDAR_OAUTH_CLIENT_SECRET', 'MYCALENDAR_OAUTH_REDIRECT_URI'];
  const missing = required.find((field) => !env[field]?.trim());
  if (missing && isLive) throw new Error(`${missing} is required when MYCALENDAR_ENABLED=on in live mode`);
  let redirectUri: string | undefined;
  if (env.MYCALENDAR_OAUTH_REDIRECT_URI?.trim()) {
    try {
      const url = new URL(env.MYCALENDAR_OAUTH_REDIRECT_URI.trim());
      const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
      if (!['http:', 'https:'].includes(url.protocol) || (isLive && url.protocol !== 'https:' && !loopback)
        || url.username || url.password || url.pathname !== '/connections/mycalendar/callback' || url.search || url.hash) throw new Error();
      redirectUri = url.href;
    } catch { throw new Error('MYCALENDAR_OAUTH_REDIRECT_URI must be the web /connections/mycalendar/callback URL without query, fragment or credentials (HTTPS in live, or loopback HTTP)'); }
  }
  // Live always talks to Google; elsewhere every endpoint must point at a stand-in, so a sandbox never reaches Google.
  const endpoints = { ...MYCALENDAR_ENDPOINTS };
  if (!isLive) {
    for (const [key, field] of Object.entries(MYCALENDAR_ENDPOINT_OVERRIDES)) {
      if (!env[field]?.trim()) return undefined;
      try {
        const url = new URL(env[field]!.trim());
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error();
        endpoints[key as keyof typeof endpoints] = url.href.replace(/\/$/, '');
      } catch { throw new Error(`${field} must be an HTTP(S) endpoint without credentials or fragment`); }
    }
  }
  if (missing || !redirectUri) return undefined;
  return { clientId: env.MYCALENDAR_OAUTH_CLIENT_ID!.trim(), clientSecret: env.MYCALENDAR_OAUTH_CLIENT_SECRET!.trim(), redirectUri, ...endpoints };
}

/** Live with the flag on refuses to start on a missing variable; sandbox disables MySheets instead. */
function mysheetsOAuth(env: Record<string, string | undefined>, isLive: boolean): GmailOAuthConfig | undefined {
  const required = ['MYSHEETS_OAUTH_CLIENT_ID', 'MYSHEETS_OAUTH_CLIENT_SECRET', 'MYSHEETS_OAUTH_REDIRECT_URI'];
  const missing = required.find((field) => !env[field]?.trim());
  if (missing && isLive) throw new Error(`${missing} is required when MYSHEETS_ENABLED=on in live mode`);
  let redirectUri: string | undefined;
  if (env.MYSHEETS_OAUTH_REDIRECT_URI?.trim()) {
    try {
      const url = new URL(env.MYSHEETS_OAUTH_REDIRECT_URI.trim());
      const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
      if (!['http:', 'https:'].includes(url.protocol) || (isLive && url.protocol !== 'https:' && !loopback)
        || url.username || url.password || url.pathname !== '/connections/mysheets/callback' || url.search || url.hash) throw new Error();
      redirectUri = url.href;
    } catch { throw new Error('MYSHEETS_OAUTH_REDIRECT_URI must be the web /connections/mysheets/callback URL without query, fragment or credentials (HTTPS in live, or loopback HTTP)'); }
  }
  // Live always talks to Google; elsewhere every endpoint must point at a stand-in, so a sandbox never reaches Google.
  const endpoints = { ...MYSHEETS_ENDPOINTS };
  if (!isLive) {
    for (const [key, field] of Object.entries(MYSHEETS_ENDPOINT_OVERRIDES)) {
      if (!env[field]?.trim()) return undefined;
      try {
        const url = new URL(env[field]!.trim());
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error();
        endpoints[key as keyof typeof endpoints] = url.href.replace(/\/$/, '');
      } catch { throw new Error(`${field} must be an HTTP(S) endpoint without credentials or fragment`); }
    }
  }
  if (missing || !redirectUri) return undefined;
  return { clientId: env.MYSHEETS_OAUTH_CLIENT_ID!.trim(), clientSecret: env.MYSHEETS_OAUTH_CLIENT_SECRET!.trim(), redirectUri, ...endpoints };
}

function mysheetsPicker(env: Record<string, string | undefined>, isLive: boolean): { apiKey: string; appId: string } | undefined {
  const apiKey = env.MYSHEETS_PICKER_API_KEY?.trim();
  const appId = env.MYSHEETS_PICKER_APP_ID?.trim();
  if (isLive) {
    if (!apiKey) throw new Error('MYSHEETS_PICKER_API_KEY is required when MYSHEETS_ENABLED=on in live mode');
    if (!appId || !/^\d+$/.test(appId)) throw new Error('MYSHEETS_PICKER_APP_ID must be a numeric project number when MYSHEETS_ENABLED=on in live mode');
    return { apiKey, appId };
  }
  if (apiKey || appId) {
    return { apiKey: apiKey || 'fake-picker-api-key', appId: appId && /^\d+$/.test(appId) ? appId : '1234567890' };
  }
  return undefined;
}

function trelloOAuth(env: Record<string, string | undefined>, isLive: boolean): TrelloOAuthConfig | undefined {
  const clientId = env.TRELLO_OAUTH_CLIENT_ID?.trim();
  const clientSecret = env.TRELLO_OAUTH_CLIENT_SECRET?.trim();
  const rawRedirect = env.TRELLO_OAUTH_REDIRECT_URI?.trim();

  if (!clientId || !clientSecret || !rawRedirect) {
    return undefined;
  }

  let redirectUri: string;
  try {
    const url = new URL(rawRedirect);
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      (url.protocol === 'http:' && !loopback) ||
      url.username ||
      url.password ||
      url.pathname !== '/connections/trello/callback' ||
      url.search ||
      url.hash
    ) {
      throw new Error();
    }
    redirectUri = url.href;
  } catch {
    throw new Error('TRELLO_OAUTH_REDIRECT_URI must be the web /connections/trello/callback URL without query, fragment or credentials (HTTPS, or loopback HTTP)');
  }

  const endpoints = { ...TRELLO_ENDPOINTS };
  if (!isLive) {
    for (const [key, field] of Object.entries(TRELLO_ENDPOINT_OVERRIDES)) {
      if (!env[field]?.trim()) continue;
      try {
        const url = new URL(env[field]!.trim());
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error();
        endpoints[key as keyof typeof endpoints] = url.href.replace(/\/$/, '');
      } catch {
        throw new Error(`${field} must be an HTTP(S) endpoint without credentials or fragment`);
      }
    }
  }

  return {
    clientId,
    clientSecret,
    redirectUri,
    ...endpoints,
  };
}
