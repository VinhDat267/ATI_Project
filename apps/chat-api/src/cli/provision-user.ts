import pg from 'pg';
import { UserRepo } from '../db/repositories/user-repo.js';
import { readProvisioningConfig } from '../config/provisioning.js';

async function main(): Promise<void> {
  const config = readProvisioningConfig(process.env);
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 1 });
  try {
    const userRepo = new UserRepo(pool);
    const existing = await userRepo.findByEmail(config.email);
    if (existing) {
      await userRepo.updatePassword(config.email, config.password);
      console.log(`Updated password for existing v3 user ${config.email}.`);
    } else {
      const user = await userRepo.createUser({
        email: config.email, password: config.password, name: config.name,
      });
      console.log(`Created v3 user ${user.email} with ID ${user.id}. Set SERVICE_ADMIN_USER_IDS to this ID to grant shared credential management.`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`Provisioning failed: ${err instanceof Error ? err.message : 'unknown error'}`);
  process.exitCode = 1;
});
