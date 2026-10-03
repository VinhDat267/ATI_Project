import pg from 'pg';
import { UserRepo } from '../db/repositories/user-repo.js';
import { readProvisioningConfig } from '../config/provisioning.js';

async function main(): Promise<void> {
  const config = readProvisioningConfig(process.env);
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 1 });
  try {
    const userRepo = new UserRepo(pool);
    const user = await userRepo.provisionAdmin(config);
    console.log(`Provisioned active, verified v3 administrator ${user.email} with ID ${user.id}.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`Provisioning failed: ${err instanceof Error ? err.message : 'unknown error'}`);
  process.exitCode = 1;
});
