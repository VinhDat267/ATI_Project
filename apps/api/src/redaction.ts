import { safeProject } from "@wap/engine";

export function redact(
  value: unknown,
  secrets: readonly string[] = [],
): unknown {
  return safeProject(value, secrets);
}
