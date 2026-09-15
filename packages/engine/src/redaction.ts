const SENSITIVE_KEY =
  /^(authorization|password|password_hash|token|access_token|refresh_token|secret|api_key|cookie|set-cookie)$/i;

const SCHEMA_MAP_KEYS = new Set([
  "properties",
  "patternProperties",
  "dependentSchemas",
  "$defs",
  "definitions",
]);
const SCHEMA_ROOT_PATHS = new Set([
  "tools.inputSchema",
  "tools.outputSchema",
  "tool_snapshot.input_schema",
  "tool_snapshot.output_schema",
  "attempts.tool_snapshot.input_schema",
  "attempts.tool_snapshot.output_schema",
]);

function normalizedSecrets(secrets: readonly string[]): readonly string[] {
  return [...new Set(secrets.filter((secret) => secret.length > 0))].sort(
    (a, b) => b.length - a.length,
  );
}

function redactText(value: string, secrets: readonly string[]): string {
  return secrets.reduce(
    (text, secret) => text.split(secret).join("[REDACTED]"),
    value,
  );
}

/**
 * Return a JSON-compatible safe view without mutating the source. JSON Schema
 * property names remain intact, while sensitive data keys and configured
 * secret values are removed from arbitrary payloads.
 */
export function safeProject<T>(value: T, secrets: readonly string[] = []): T {
  const known = normalizedSecrets(secrets);
  const visit = (
    current: unknown,
    path: readonly string[] = [],
    schemaContext = false,
    preserveMapKeys = false,
  ): unknown => {
    if (typeof current === "string") return redactText(current, known);
    if (Array.isArray(current))
      return current.map((item) => visit(item, path, schemaContext));
    if (current && typeof current === "object") {
      const output: Record<string, unknown> = {};
      for (const [rawKey, item] of Object.entries(current)) {
        const key = redactText(rawKey, known);
        if (!preserveMapKeys && SENSITIVE_KEY.test(rawKey)) {
          output[key] = "[REDACTED]";
          continue;
        }
        const childPath = [...path, rawKey];
        const childSchemaContext =
          schemaContext || SCHEMA_ROOT_PATHS.has(childPath.join("."));
        output[key] = visit(
          item,
          childPath,
          childSchemaContext,
          childSchemaContext && SCHEMA_MAP_KEYS.has(rawKey),
        );
      }
      return output;
    }
    return current;
  };
  return visit(value) as T;
}

export function containsConfiguredSecret(
  value: unknown,
  secrets: readonly string[],
): boolean {
  const known = normalizedSecrets(secrets);
  if (!known.length) return false;
  const visit = (current: unknown): boolean => {
    if (typeof current === "string")
      return known.some((secret) => current.includes(secret));
    if (Array.isArray(current)) return current.some(visit);
    if (current && typeof current === "object")
      return Object.entries(current).some(
        ([key, item]) => visit(key) || visit(item),
      );
    return false;
  };
  return visit(value);
}
