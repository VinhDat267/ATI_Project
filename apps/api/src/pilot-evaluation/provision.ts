import { randomBytes, randomUUID, createHash } from "node:crypto";
import postgres from "postgres";
import { migrate } from "@wap/db";
import { assertFrozen } from "./manifest.js";
import { DatabaseIdentitySchema, type DatabaseIdentity, type FrozenManifest } from "./contracts.js";
import { EVALUATION_SCHEMA_SQL } from "./schema.js";
import { EvaluationStore } from "./store.js";

export interface PrivateBootstrapReceipt {
  readonly identity: DatabaseIdentity;
  readonly manifest: FrozenManifest;
  readonly runtimeUrl: string;
  readonly reportUrl: string;
  readonly reportRole: string;
  readonly logins: readonly [
    { readonly alias: string; readonly email: string; readonly password: string; readonly passwordHash: string },
    { readonly alias: string; readonly email: string; readonly password: string; readonly passwordHash: string },
  ];
}

const identifier = (name: string) => {
  if (!/^(?:pilot_eval|pilot_runtime|pilot_report)_[0-9a-f]{32}$/.test(name))
    throw new Error("Untrusted database identifier");
  return `"${name}"`;
};
const approvedAdminUrl = (base: string): string => {
  const result = new URL(base);
  if (result.hostname !== "127.0.0.1" || result.port !== "55532" || result.protocol !== "postgresql:" ||
      result.search || result.hash || !/^\/[a-zA-Z0-9_-]+$/.test(result.pathname))
    throw new Error("Only approved isolated loopback PostgreSQL is supported");
  return result.href;
};
const urlFor = (base: string, db: string, user?: string, password?: string) => {
  const result = new URL(base);
  result.pathname = `/${db}`;
  if (user !== undefined) { result.username = user; result.password = password!; }
  return result.href;
};

/** Privileged bootstrap is separate from the runner; no existing database is migrated. */
export async function provisionOfflineCampaign(adminUrl: string, manifest: FrozenManifest): Promise<PrivateBootstrapReceipt> {
  assertFrozen(manifest, manifest.artifacts);
  const approvedUrl = approvedAdminUrl(adminUrl);
  const suffix = randomUUID().replaceAll("-", "");
  const dbName = `pilot_eval_${suffix}`;
  const runtimeRole = `pilot_runtime_${suffix}`;
  const reportRole = `pilot_report_${suffix}`;
  const nonceHash = createHash("sha256").update(randomBytes(32)).digest("hex");
  const identity = DatabaseIdentitySchema.parse({ measurementId: manifest.measurementId,
    databaseName: dbName, schemaVersion: manifest.schemaVersion,
    markerNonceHash: nonceHash, expectedRuntimeRole: runtimeRole });
  const admin = postgres(approvedUrl, { max: 1, connect_timeout: 5 });
  const password = randomBytes(32).toString("hex");
  const reportPassword = randomBytes(32).toString("hex");
  let createdDb = false;
  let runtimeCreated = false;
  let reportCreated = false;
  try {
    // CREATE DATABASE is not transactional. Only cleanup names this invocation created.
    await admin.unsafe(`CREATE DATABASE ${identifier(dbName)}`);
    createdDb = true;
    await admin.unsafe(`CREATE ROLE ${identifier(runtimeRole)} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`);
    runtimeCreated = true;
    await admin.unsafe(`CREATE ROLE ${identifier(reportRole)} LOGIN PASSWORD '${reportPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`);
    reportCreated = true;
    const adminDbUrl = urlFor(approvedUrl, dbName);
    const owner = postgres(adminDbUrl, { max: 1, connect_timeout: 5 });
    try {
      await owner.unsafe(`REVOKE ALL ON DATABASE ${identifier(dbName)} FROM PUBLIC`);
      await owner.unsafe(`GRANT CONNECT ON DATABASE ${identifier(dbName)} TO ${identifier(runtimeRole)},${identifier(reportRole)}`);
      // Immutable bootstrap marker exists before any evaluator installation or seed.
      await owner`CREATE SCHEMA pilot_eval_bootstrap`;
      await owner`CREATE TABLE pilot_eval_bootstrap.marker (
        measurement_id uuid PRIMARY KEY, schema_version text NOT NULL, nonce_hash text NOT NULL,
        database_name text NOT NULL, runtime_role text NOT NULL
      )`;
      await owner`INSERT INTO pilot_eval_bootstrap.marker(measurement_id,schema_version,nonce_hash,database_name,runtime_role)
        VALUES (${identity.measurementId},${identity.schemaVersion},${identity.markerNonceHash},${dbName},${runtimeRole})`;
      await assertBootstrapMarker(owner, identity);
      await migrate(adminDbUrl);
      await assertBootstrapMarker(owner, identity);
      await owner.unsafe(EVALUATION_SCHEMA_SQL);
      const { hashPassword } = await import("../auth.js");
      const makeLogin = async (principal: FrozenManifest["principals"][number]) => {
        const secret = randomBytes(24).toString("hex");
        return { alias: principal.alias, email: `${principal.id}@offline.invalid`,
          password: secret, passwordHash: await hashPassword(secret) };
      };
      const logins = await Promise.all([
        makeLogin(manifest.principals[0]), makeLogin(manifest.principals[1]),
      ]);
      for (const [index, principal] of manifest.principals.entries()) {
        const login = logins[index]!;
        await owner`INSERT INTO users(id,email,password_hash) VALUES (${principal.id},${login.email},${login.passwordHash})`;
        const campaignId = `pilot-v2:${principal.id}`;
        await owner`INSERT INTO ai_provider_campaigns(campaign_id,user_id,limit_micros)
          VALUES (${campaignId},${principal.id},${principal.limitMicros})`;
        await owner`INSERT INTO pilot_ai_grants(campaign_id,principal_id,provider,model,max_calls,max_estimated_cost_micros,expires_at)
          VALUES (${campaignId},${principal.id},${manifest.provider},${manifest.model},${principal.maxCalls},${manifest.estimatedCostMicros},clock_timestamp() + interval '12 hours')`;
      }
      await owner`INSERT INTO pilot_eval.campaigns(measurement_id,manifest_json,manifest_hash)
        VALUES (${manifest.measurementId},${owner.json(manifest)},${manifest.manifestHash})`;
      for (const slot of manifest.slots) {
        const principal = manifest.principals.find((entry) => entry.alias === slot.principalAlias)!;
        await owner`INSERT INTO pilot_eval.slots(measurement_id,slot_id,ordinal,principal_id,input_hash,eligibility)
          VALUES (${manifest.measurementId},${slot.slotId},${slot.ordinal},${principal.id},${slot.inputHash},${slot.declaredEligibility})`;
      }
      await owner`REVOKE ALL ON SCHEMA public FROM PUBLIC`;
      await owner.unsafe(`GRANT USAGE ON SCHEMA public TO ${identifier(runtimeRole)},${identifier(reportRole)}`);
      await owner.unsafe(`GRANT USAGE ON SCHEMA pilot_eval_bootstrap TO ${identifier(runtimeRole)},${identifier(reportRole)}`);
      await owner.unsafe(`GRANT SELECT ON pilot_eval_bootstrap.marker TO ${identifier(runtimeRole)},${identifier(reportRole)}`);
      await owner.unsafe(`GRANT USAGE ON SCHEMA pilot_eval TO ${identifier(runtimeRole)},${identifier(reportRole)}`);
      await owner.unsafe(`GRANT SELECT ON pilot_eval.campaigns,pilot_eval.slots,pilot_eval.events,pilot_eval.seals,pilot_eval.grades TO ${identifier(runtimeRole)},${identifier(reportRole)}`);
      await owner.unsafe(`GRANT UPDATE(state,sealed_hash) ON pilot_eval.campaigns TO ${identifier(runtimeRole)}`);
      await owner.unsafe(`GRANT UPDATE(run_id,call_id,precleanup_status,cleanup_status) ON pilot_eval.slots TO ${identifier(runtimeRole)}`);
      await owner.unsafe(`GRANT INSERT ON pilot_eval.events,pilot_eval.seals TO ${identifier(runtimeRole)}`);
      const reads = "users,workflows,workflow_versions,runs,run_events,source_snapshots,pilot_profiles,pilot_approvals,pilot_ai_grants,pilot_ai_attempts,pilot_planner_outcomes,ai_provider_campaigns,ai_provider_calls,business_reservations";
      await owner.unsafe(`GRANT SELECT ON ${reads} TO ${identifier(runtimeRole)},${identifier(reportRole)}`);
      const writes = "workflows,workflow_versions,runs,run_events,source_snapshots,pilot_approvals,pilot_ai_attempts,pilot_planner_outcomes,ai_provider_campaigns,ai_provider_calls,business_reservations";
      await owner.unsafe(`GRANT INSERT,UPDATE ON ${writes} TO ${identifier(runtimeRole)}`);
      // Admission locks grant rows FOR UPDATE; only this inert column is writable.
      await owner.unsafe(`GRANT UPDATE(updated_at) ON pilot_ai_grants TO ${identifier(runtimeRole)}`);
      await owner.unsafe(`GRANT USAGE ON SEQUENCE run_events_id_seq TO ${identifier(runtimeRole)}`);
      const receipt = { identity, manifest, runtimeUrl: urlFor(approvedUrl, dbName, runtimeRole, password),
        reportUrl: urlFor(approvedUrl, dbName, reportRole, reportPassword), reportRole, logins };
      const store = await openEvaluationStore(receipt.runtimeUrl, identity);
      await store.close();
      return receipt;
    } finally { await owner.end(); }
  } catch (error) {
    // Cleanup only after successful CREATE acknowledgement; never infer ownership from prefix.
    try {
      if (createdDb) await admin.unsafe(`DROP DATABASE ${identifier(dbName)} WITH (FORCE)`);
      if (reportCreated) await admin.unsafe(`DROP ROLE ${identifier(reportRole)}`);
      if (runtimeCreated) await admin.unsafe(`DROP ROLE ${identifier(runtimeRole)}`);
    } catch {
      throw new Error("Offline bootstrap incomplete: operator must inspect newly created resources", { cause: error });
    }
    throw error;
  } finally { await admin.end(); }
}

async function assertBootstrapMarker(db: ReturnType<typeof postgres>, identity: DatabaseIdentity): Promise<void> {
  const rows = await db`SELECT measurement_id,schema_version,nonce_hash,database_name,runtime_role,
    current_database() AS actual_database FROM pilot_eval_bootstrap.marker`;
  if (rows.length !== 1 || rows[0]?.measurement_id !== identity.measurementId ||
      rows[0]?.schema_version !== identity.schemaVersion || rows[0]?.nonce_hash !== identity.markerNonceHash ||
      rows[0]?.database_name !== identity.databaseName || rows[0]?.runtime_role !== identity.expectedRuntimeRole ||
      rows[0]?.actual_database !== identity.databaseName)
    throw new Error("Evaluator bootstrap marker mismatch");
}

export async function openEvaluationStore(runtimeUrl: string, expected: DatabaseIdentity): Promise<EvaluationStore> {
  const identity = DatabaseIdentitySchema.parse(expected);
  const address = new URL(runtimeUrl);
  if (address.protocol !== "postgresql:" || address.hostname !== "127.0.0.1" || address.port !== "55532" ||
      address.pathname !== `/${identity.databaseName}` || decodeURIComponent(address.username) !== identity.expectedRuntimeRole)
    throw new Error("Evaluator connection identity mismatch");
  const client = postgres(runtimeUrl, { max: 3, connect_timeout: 5 });
  try {
    const rows = await client`SELECT current_user AS role, current_database() AS db,
      rolcreatedb,rolcreaterole,rolsuper,rolbypassrls
      FROM pg_roles WHERE rolname=current_user`;
    const role = rows[0];
    if (rows.length !== 1 || role?.role !== identity.expectedRuntimeRole || role?.db !== identity.databaseName ||
        role.rolcreatedb || role.rolcreaterole || role.rolsuper || role.rolbypassrls)
      throw new Error("Evaluator runtime role is privileged");
    const marker = await client`SELECT measurement_id,schema_version,nonce_hash,database_name,runtime_role
      FROM pilot_eval_bootstrap.marker`;
    if (marker.length !== 1 || marker[0]?.measurement_id !== identity.measurementId ||
        marker[0]?.nonce_hash !== identity.markerNonceHash || marker[0]?.schema_version !== identity.schemaVersion ||
        marker[0]?.database_name !== identity.databaseName || marker[0]?.runtime_role !== identity.expectedRuntimeRole)
      throw new Error("Evaluator marker mismatch");
    const privileges = await client`SELECT has_database_privilege(current_user,current_database(),'CREATE') AS db_create,
      has_schema_privilege(current_user,'public','CREATE') AS public_create,
      has_schema_privilege(current_user,'pilot_eval','CREATE') AS eval_create,
      (SELECT count(*)::int FROM pg_class WHERE relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS owned,
      (SELECT count(*)::int FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS memberships`;
    if (privileges[0]?.db_create || privileges[0]?.public_create || privileges[0]?.eval_create ||
        privileges[0]?.owned !== 0 || privileges[0]?.memberships !== 0)
      throw new Error("Evaluator runtime role has DDL or membership privileges");
    const dml = await client`SELECT
      has_table_privilege(current_user,'pilot_ai_grants','SELECT') AS grant_read,
      has_column_privilege(current_user,'pilot_ai_grants','updated_at','UPDATE') AS grant_lock,
      has_table_privilege(current_user,'ai_provider_calls','SELECT') AS call_read,
      has_table_privilege(current_user,'ai_provider_calls','INSERT') AS call_insert,
      has_table_privilege(current_user,'runs','INSERT') AS run_insert,
      has_table_privilege(current_user,'pilot_eval.events','INSERT') AS event_insert,
      has_table_privilege(current_user,'pilot_eval.events','UPDATE') AS event_update,
      has_table_privilege(current_user,'pilot_eval.events','DELETE') AS event_delete,
      has_table_privilege(current_user,'pilot_eval.seals','INSERT') AS seal_insert,
      has_table_privilege(current_user,'pilot_eval.seals','UPDATE') AS seal_update,
      has_table_privilege(current_user,'pilot_eval.seals','DELETE') AS seal_delete,
      has_table_privilege(current_user,'pilot_eval.grades','INSERT') AS grade_insert,
      has_column_privilege(current_user,'pilot_eval.campaigns','manifest_hash','UPDATE') AS manifest_update,
      has_column_privilege(current_user,'pilot_eval.slots','input_hash','UPDATE') AS descriptor_update,
      has_table_privilege(current_user,'pilot_eval_bootstrap.marker','UPDATE') AS marker_update,
      has_sequence_privilege(current_user,'run_events_id_seq','USAGE') AS event_sequence`;
    const grants = dml[0];
    if (!grants || Object.entries(grants).some(([key, allowed]) =>
      ["event_update", "event_delete", "seal_update", "seal_delete", "grade_insert", "manifest_update", "descriptor_update", "marker_update"].includes(key)
        ? allowed !== false : allowed !== true))
      throw new Error("Evaluator runtime role has broken DML privilege");
    return new EvaluationStore(client, identity);
  } catch (error) { await client.end(); throw error; }
}
