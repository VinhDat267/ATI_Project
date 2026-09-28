export interface EnvConfig {
  DATABASE_URL: string;
  JWT_SECRET: string;
  ENCRYPTION_KEY: string;
  GEMINI_API_KEY: string;
  PORT: number;
}

export function validateEnv(env: Record<string, string | undefined> = process.env): EnvConfig {
  const DATABASE_URL = env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ati_v3';
  const JWT_SECRET = env.JWT_SECRET || 'default_jwt_secret_min_32_characters_long_for_dev';
  const ENCRYPTION_KEY = env.ENCRYPTION_KEY || '01234567890123456789012345678901';
  const GEMINI_API_KEY = env.GEMINI_API_KEY || '';
  const PORT = Number(env.PORT) || 3000;

  return {
    DATABASE_URL,
    JWT_SECRET,
    ENCRYPTION_KEY,
    GEMINI_API_KEY,
    PORT,
  };
}
