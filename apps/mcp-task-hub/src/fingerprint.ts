import { createHash } from "node:crypto";
import { POLICY_VERSION } from "./contracts.js";
/** Canonical JSON subset used by the local controller/receiver payload contract. */
export function canonicalJson(value: unknown): string {
  const normalize = (v: unknown): unknown => {
    if (v === null || typeof v === "string" || typeof v === "boolean") return v;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (Array.isArray(v)) return v.map(normalize);
    if (
      v &&
      typeof v === "object" &&
      Object.getPrototypeOf(v) === Object.prototype
    ) {
      return Object.fromEntries(
        Object.keys(v)
          .sort()
          .map((k) => [k, normalize((v as Record<string, unknown>)[k])]),
      );
    }
    throw new Error("Fingerprint requires finite JSON values");
  };
  return JSON.stringify(normalize(value));
}
export function writeFingerprint(name: string, args: unknown): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        server: "task_hub",
        tool: name,
        policy_version: POLICY_VERSION,
        args,
      }),
    )
    .digest("hex");
}
