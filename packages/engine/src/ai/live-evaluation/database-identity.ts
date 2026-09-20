import type { Database } from "@wap/db";

export interface EvaluationDatabaseIdentity {
  readonly host: string;
  readonly port: string;
  readonly database: string;
}

function canonicalHost(hostname: string): string {
  let host = hostname.trim().toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) {
    host = host.slice(1, -1);
  }
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "0.0.0.0"
  ) {
    return "loopback";
  }
  return host;
}

export function parseEvaluationDatabaseIdentity(
  rawUrl: string,
  label = "AI_EVAL_DATABASE_URL",
): EvaluationDatabaseIdentity {
  if (!rawUrl.trim()) throw new Error(`${label} is required`);
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`${label} is not a valid PostgreSQL URL`);
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(`${label} must use PostgreSQL`);
  }
  if (!parsed.hostname || parsed.pathname === "/" || !parsed.pathname) {
    throw new Error(`${label} must include a database name`);
  }
  const database = decodeURIComponent(parsed.pathname.slice(1));
  if (!database) throw new Error(`${label} must include a database name`);
  return {
    host: canonicalHost(parsed.hostname),
    port: parsed.port || "5432",
    database,
  };
}

export function sameEvaluationDatabase(
  left: EvaluationDatabaseIdentity,
  right: EvaluationDatabaseIdentity,
): boolean {
  return (
    left.host === right.host &&
    left.port === right.port &&
    left.database === right.database
  );
}

export function assertEvaluationDatabaseIsolation(
  evalUrl: string,
  appUrl: string,
): void {
  const evaluation = parseEvaluationDatabaseIdentity(evalUrl);
  const application = parseEvaluationDatabaseIdentity(appUrl, "DATABASE_URL");
  if (sameEvaluationDatabase(evaluation, application)) {
    throw new Error(
      "AI_EVAL_DATABASE_URL must target a different database from DATABASE_URL",
    );
  }
}

export interface ConnectedDatabaseIdentity {
  readonly currentDatabase: string;
  readonly currentUser: string;
}

/**
 * Queries connected database and user to verify runtime identity matches expected evaluation DB
 * and does not collide with the application database before any mutations.
 */
export async function verifyConnectedEvaluationDatabaseIdentity(
  database: Database,
  expectedEvalIdentity: EvaluationDatabaseIdentity,
  appIdentity?: EvaluationDatabaseIdentity,
): Promise<ConnectedDatabaseIdentity> {
  const rows = await (database.client as any)`SELECT current_database(), current_user;`;
  const row = (rows as any)?.[0];
  if (!row || typeof row.current_database !== "string") {
    throw new Error("Unable to query connected database identity");
  }
  if (row.current_database !== expectedEvalIdentity.database) {
    throw new Error(
      `Connected database mismatch: connected to "${row.current_database}", expected "${expectedEvalIdentity.database}"`,
    );
  }
  if (
    appIdentity &&
    sameEvaluationDatabase(
      {
        host: expectedEvalIdentity.host,
        port: expectedEvalIdentity.port,
        database: row.current_database,
      },
      appIdentity,
    )
  ) {
    throw new Error(
      `Connected database "${row.current_database}" matches forbidden application database`,
    );
  }
  return {
    currentDatabase: row.current_database,
    currentUser: row.current_user ?? "unknown",
  };
}
