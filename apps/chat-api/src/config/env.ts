import { randomBytes } from 'node:crypto';

export interface EnvConfig {
  DATABASE_URL: string;
  JWT_SECRET: string;
  ENCRYPTION_KEY: string;
  GEMINI_API_KEY: string;
  LLM_PROVIDER: 'gemini' | 'openai-compatible';
  /** 'llm': the model calls search tools itself; 'regex': registry gather rules resolve names first. */
  PLANNER_SEARCH_MODE: 'llm' | 'regex';
  /** IANA zone the planner resolves relative dates such as "thứ 6" in. */
  APP_TIME_ZONE: string;
  PORT: number;
  RUNTIME_MODE: 'live' | 'sandbox';
  AUTH_SIGNUP_ENABLED: boolean;
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
  const AUTH_SIGNUP_ENABLED = env.AUTH_SIGNUP_ENABLED !== 'false';
  if (isLive) {
    for (const field of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'MAIL_FROM', 'APP_BASE_URL']) {
      if (!env[field]?.trim()) throw new Error(`${field} is required in live mode`);
    }
  }
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

  return {
    DATABASE_URL,
    JWT_SECRET,
    ENCRYPTION_KEY,
    GEMINI_API_KEY,
    LLM_PROVIDER,
    PLANNER_SEARCH_MODE,
    APP_TIME_ZONE,
    PORT,
    RUNTIME_MODE,
    AUTH_SIGNUP_ENABLED,
    APP_BASE_URL,
    SMTP_HOST: env.SMTP_HOST || '',
    SMTP_PORT,
    SMTP_USER: env.SMTP_USER || '',
    SMTP_PASSWORD: env.SMTP_PASSWORD || '',
    MAIL_FROM,
  };
}
