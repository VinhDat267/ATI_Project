const SENSITIVE_KEY =
  /^(authorization|password|password_hash|token|access_token|refresh_token|secret|api_key|cookie|set-cookie)$/i;

export function redact(
  value: unknown,
  secrets: readonly string[] = [],
): unknown {
  if (typeof value === "string") {
    return secrets.reduce(
      (text, secret) => (secret ? text.split(secret).join("[REDACTED]") : text),
      value,
    );
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, secrets));
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value))
      output[key] = SENSITIVE_KEY.test(key)
        ? "[REDACTED]"
        : redact(item, secrets);
    return output;
  }
  return value;
}
