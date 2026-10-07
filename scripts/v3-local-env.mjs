const githubCiDatabaseUrl = 'postgresql://ati_v3:ati_v3_ci_only@127.0.0.1:5432/ati_v3';

export function assertLocalV3Environment(env) {
  if (env.RUNTIME_MODE !== 'sandbox') {
    throw new Error('Local v3 commands require RUNTIME_MODE=sandbox');
  }
  const port = env.V3_LOCAL_DB_PORT || '55533';
  const validPort = /^[1-9]\d*$/.test(port) && Number(port) >= 1024 && Number(port) <= 65535 && ![5432, 15433].includes(Number(port));
  const localDatabaseUrl = `postgresql://ati_v3:ati_v3_local_only@127.0.0.1:${port}/ati_v3`;
  if (!validPort || env.DATABASE_URL !== localDatabaseUrl) {
    throw new Error(`Local v3 commands require the dedicated local v3 database at 127.0.0.1:${port}/ati_v3`);
  }
}

export function assertBrowserV3Environment(env) {
  if (env.RUNTIME_MODE !== 'sandbox') {
    throw new Error('Browser E2E requires RUNTIME_MODE=sandbox');
  }
  if (env.GITHUB_ACTIONS === 'true') {
    if (env.DATABASE_URL !== githubCiDatabaseUrl) {
      throw new Error('Browser E2E requires the dedicated GitHub CI v3 database');
    }
    return;
  }
  assertLocalV3Environment(env);
}
