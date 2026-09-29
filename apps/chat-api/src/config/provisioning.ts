export interface ProvisioningConfig {
  databaseUrl: string;
  email: string;
  password: string;
  name: string;
}

export function readProvisioningConfig(env: Record<string, string | undefined>): ProvisioningConfig {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error('DATABASE_URL is required for user provisioning');
  const email = env.CHAT_ADMIN_EMAIL?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('CHAT_ADMIN_EMAIL must be a valid email');
  const password = env.CHAT_ADMIN_PASSWORD;
  if (!password || password.length < 12) throw new Error('CHAT_ADMIN_PASSWORD must be at least 12 characters');
  return { databaseUrl, email, password, name: env.CHAT_ADMIN_NAME?.trim() || 'Service Administrator' };
}
