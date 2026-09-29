import postgres from "postgres";
import { z } from "zod";
import { DatabaseIdentitySchema, DigestSchema, SlotDescriptorSchema,
  type DatabaseIdentity } from "./contracts.js";

const GradeSchema = z.enum(["pass", "fail", "not_run"]);
const GradeReasonSchema = z.enum([
  "STRUCTURAL_MATCH", "STRUCTURAL_MISMATCH", "NOT_MEASURED", "INCOMPLETE_EVIDENCE",
]);

/** The grader owns only grade INSERT, never producer or report mutations. */
export class GraderEvaluationStore {
  constructor(readonly client: ReturnType<typeof postgres>, readonly identity: DatabaseIdentity) {}
  async close(): Promise<void> { await this.client.end({ timeout: 5 }); }

  async appendGrade(slotId: string, rubricHash: string, sealHash: string,
    grade: z.infer<typeof GradeSchema>, reason: z.infer<typeof GradeReasonSchema>): Promise<void> {
    const slot = SlotDescriptorSchema.shape.slotId.parse(slotId);
    const rubric = DigestSchema.parse(rubricHash);
    const seal = DigestSchema.parse(sealHash);
    const validGrade = GradeSchema.parse(grade), validReason = GradeReasonSchema.parse(reason);
    const inserted = await this.client`INSERT INTO pilot_eval.grades(measurement_id,slot_id,rubric_hash,seal_hash,grade,reason)
      VALUES (${this.identity.measurementId},${slot},${rubric},${seal},${validGrade},${validReason}) RETURNING slot_id`;
    if (inserted.length !== 1) throw new Error("Grade append was not acknowledged");
  }
}

export async function openGraderEvaluationStore(url: string, expected: DatabaseIdentity): Promise<GraderEvaluationStore> {
  const identity = DatabaseIdentitySchema.parse(expected);
  const address = new URL(url);
  const graderRole = `pilot_grader_${identity.databaseName.slice("pilot_eval_".length)}`;
  if (address.protocol !== "postgresql:" || address.hostname !== "127.0.0.1" || address.port !== "55532" ||
      address.pathname !== `/${identity.databaseName}` || address.search || address.hash ||
      decodeURIComponent(address.username) !== graderRole)
    throw new Error("Grader identity mismatch");
  const client = postgres(url, { max: 1, connect_timeout: 5 });
  try {
    const marker = await client`SELECT measurement_id,schema_version,nonce_hash,database_name,runtime_role,grader_role,
      current_database() AS actual_database,current_user AS actual_role FROM pilot_eval_bootstrap.marker`;
    if (marker.length !== 1 || marker[0]?.measurement_id !== identity.measurementId ||
        marker[0]?.schema_version !== identity.schemaVersion || marker[0]?.nonce_hash !== identity.markerNonceHash ||
        marker[0]?.database_name !== identity.databaseName || marker[0]?.runtime_role !== identity.expectedRuntimeRole ||
        marker[0]?.grader_role !== graderRole || marker[0]?.actual_database !== identity.databaseName ||
        marker[0]?.actual_role !== graderRole)
      throw new Error("Grader marker mismatch");
    const privileges = await client`SELECT r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolbypassrls,
      has_database_privilege(current_user,current_database(),'CREATE') AS db_create,
      has_schema_privilege(current_user,'public','CREATE') AS public_create,
      has_schema_privilege(current_user,'pilot_eval','CREATE') AS eval_create,
      has_table_privilege(current_user,'pilot_eval.grades','INSERT') AS grade_insert,
      has_table_privilege(current_user,'pilot_eval.seals','SELECT') AS seal_read,
      has_table_privilege(current_user,'pilot_eval.campaigns','SELECT') AS campaign_read,
      (SELECT count(*)::int FROM pg_auth_members WHERE member=r.oid) AS memberships,
      (SELECT count(*)::int FROM pg_class WHERE relowner=r.oid) AS owned,
      EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        LEFT JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
        WHERE n.nspname IN ('public','pilot_eval','pilot_eval_bootstrap') AND c.relkind IN ('r','p')
          AND (n.nspname <> 'pilot_eval' OR c.relname <> 'grades') AND
          (has_table_privilege(current_user,c.oid,'INSERT') OR
           has_table_privilege(current_user,c.oid,'UPDATE') OR
           has_table_privilege(current_user,c.oid,'DELETE') OR
           (a.attnum IS NOT NULL AND (has_column_privilege(current_user,c.oid,a.attnum,'INSERT') OR
             has_column_privilege(current_user,c.oid,a.attnum,'UPDATE'))))) AS other_write,
      has_table_privilege(current_user,'pilot_eval.grades','UPDATE') AS grade_update,
      has_table_privilege(current_user,'pilot_eval.grades','DELETE') AS grade_delete
      FROM pg_roles r WHERE r.rolname=current_user`;
    const role = privileges[0];
    if (!role || role.rolsuper || role.rolcreatedb || role.rolcreaterole || role.rolbypassrls ||
        role.db_create || role.public_create || role.eval_create || role.memberships !== 0 || role.owned !== 0 ||
        role.other_write || role.grade_update || role.grade_delete || !role.grade_insert ||
        !role.seal_read || !role.campaign_read)
      throw new Error("Grader role has broken DML or DDL privilege");
    return new GraderEvaluationStore(client, identity);
  } catch (error) { await client.end(); throw error; }
}
