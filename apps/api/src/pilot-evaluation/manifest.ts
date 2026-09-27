import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  ArtifactHashesSchema, FixtureBundleSchema, FrozenManifestSchema,
  ManifestDraftSchema, type ArtifactHashes, type FixtureBundle,
  type FrozenManifest, type ManifestDraft,
} from "./contracts.js";

export { ArtifactHashesSchema, FixtureBundleSchema, FrozenManifestSchema };

/** Only plain parsed JSON records are hashable; executable input is never enumerated. */
function normalized(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(normalized).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype)
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${normalized((value as Record<string, unknown>)[key])}`).join(",")}}`;
  throw new Error("Untrusted non-JSON value");
}
export function canonicalHash(value: unknown): string {
  return createHash("sha256").update(normalized(value)).digest("hex");
}
export function canonicalJson(value: unknown): string { return normalized(value); }

/** Byte boundary: bounded UTF-8 JSON, rejecting duplicate keys and executable objects. */
type JsonValue = null | string | number | boolean | JsonValue[] | { [key: string]: JsonValue };

export function parseBoundedJson(bytes: Uint8Array, maxBytes = 1_048_576): JsonValue {
  if (bytes.byteLength > maxBytes || bytes.byteLength === 0 || maxBytes > 1_048_576 || maxBytes < 1)
    throw new Error("JSON artifact exceeds bound");
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  let position = 0;
  const space = () => { while (/\s/.test(source[position] ?? "" ) && position < source.length) position++; };
  const string = (): string => {
    const start = position++;
    while (position < source.length) {
      if (source[position] === "\\") { position += 2; continue; }
      if (source[position++] === '"') return JSON.parse(source.slice(start, position)) as string;
    }
    throw new Error("Invalid JSON string");
  };
  const value = (depth: number): JsonValue => {
    if (depth > 32) throw new Error("JSON depth exceeded");
    space();
    if (source[position] === '"') return string();
    if (source[position] === "[") {
      position++; space(); const items: JsonValue[] = [];
      if (source[position] === "]") { position++; return items; }
      do {
        items.push(value(depth + 1)); space();
        if (source[position] === "]") { position++; return items; }
        if (source[position++] !== ",") throw new Error("Invalid JSON array");
      } while (items.length <= 100_000);
      throw new Error("JSON array exceeds bound");
    }
    if (source[position] === "{") {
      position++; space(); const record: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
      if (source[position] === "}") { position++; return record; }
      do {
        space(); if (source[position] !== '"') throw new Error("Invalid JSON object");
        const key = string(); space();
        if (source[position++] !== ":") throw new Error("Invalid JSON object");
        if (Object.hasOwn(record, key)) throw new Error("Duplicate JSON key");
        record[key] = value(depth + 1); space();
        if (source[position] === "}") { position++; return record; }
        if (source[position++] !== ",") throw new Error("Invalid JSON object");
      } while (position < source.length);
      throw new Error("Invalid JSON object");
    }
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(source.slice(position));
    if (!match) throw new Error("Invalid JSON value");
    position += match[0].length;
    const primitive = JSON.parse(match[0]) as null | boolean | number;
    if (typeof primitive === "number" && !Number.isSafeInteger(primitive))
      throw new Error("JSON number must be a safe integer");
    return primitive;
  };
  const parsed = value(0); space();
  if (position !== source.length) throw new Error("Trailing JSON bytes");
  return parsed;
}

export function parseManifestBytes(bytes: Uint8Array): FrozenManifest {
  return FrozenManifestSchema.parse(parseBoundedJson(bytes));
}
export function parseFixtureBytes(bytes: Uint8Array): FixtureBundle {
  return FixtureBundleSchema.parse(parseBoundedJson(bytes));
}

export function freezeManifest(input: ManifestDraft, artifacts: ArtifactHashes): FrozenManifest {
  const draft = ManifestDraftSchema.parse(input);
  const hashes = ArtifactHashesSchema.parse(artifacts);
  const body = { ...draft, artifacts: hashes };
  if (Buffer.byteLength(canonicalJson(body)) > 1_048_576)
    throw new Error("Manifest exceeds bound");
  return FrozenManifestSchema.parse({ ...body, manifestHash: canonicalHash(body) });
}
export function assertFrozen(manifest: FrozenManifest, artifacts: ArtifactHashes): void {
  const parsed = FrozenManifestSchema.parse(manifest);
  const { manifestHash, ...body } = parsed;
  if (manifestHash !== canonicalHash(body) ||
      canonicalHash(parsed.artifacts) !== canonicalHash(ArtifactHashesSchema.parse(artifacts)))
    throw new Error("Frozen manifest mismatch");
}

/** Campaign proof requires an actual clean Git checkout at the exact frozen commit. */
export function assertCleanProvenance(manifest: FrozenManifest, cwd: string): void {
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  if (git("rev-parse", "HEAD") !== manifest.gitCommit ||
      git("status", "--porcelain=v1", "-uall") !== "")
    throw new Error("Frozen campaign requires clean exact Git checkout");
}
