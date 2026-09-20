export interface EvaluationDatabaseIdentity {
  readonly host: string;
  readonly port: string;
  readonly database: string;
}

function canonicalHost(hostname: string): string {
  const host = hostname.trim().toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
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
  if (!parsed.hostname || parsed.pathname === "/") {
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
