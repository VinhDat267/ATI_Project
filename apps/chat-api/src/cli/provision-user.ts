import pg from 'pg';
import { UserRepo } from '../db/repositories/user-repo.js';
import { AccountRepo } from '../auth/accounts.js';
import { readProvisioningConfig } from '../config/provisioning.js';

async function main(): Promise<void> {
  const config = readProvisioningConfig(process.env);
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 1 });
  try {
    const userRepo = new UserRepo(pool);
    const existing = await userRepo.findByEmail(config.email);
    if (existing) {
      await userRepo.updatePassword(config.email, config.password);
      await new AccountRepo(pool).revoke(existing.id);
      console.log(`Updated password for existing v3 user ${config.email}.`);
    } else {
      const user = await userRepo.createUser({
        email: config.email, password: config.password, name: config.name,
      });
      console.log(`Created v3 administrator ${user.email} with ID ${user.id}.`);
    }
    await pool.query("UPDATE users SET role='admin',status='active',email_verified=TRUE,updated_at=NOW() WHERE email=$1",[config.email.trim().toLowerCase()]);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`Provisioning failed: ${err instanceof Error ? err.message : 'unknown error'}`);
  process.exitCode = 1;
});
