import postgres from "postgres";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

export async function migrate(
  url: string,
  directory = fileURLToPath(
    new URL("../../../db/migrations/", import.meta.url),
  ),
) {
  // One connection keeps the advisory lock across the enum autocommit prelude.
  const client = postgres(url, {
    max: 1,
    connect_timeout: 5,
    onnotice: () => {},
  });
  const applied: string[] = [];
  try {
    await client`SELECT pg_advisory_lock(638019813)`;
    await client`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
    const files = (await readdir(directory))
      .filter((n) => /^\d{4}_[a-z0-9_]+\.sql$/.test(n))
      .sort();
    const existing = await client<
      { name: string; checksum: string }[]
    >`SELECT name,checksum FROM schema_migrations ORDER BY name`;
    if (existing.some((row) => !files.includes(row.name)))
      throw new Error("Applied migration file is missing");
    // Check ALL historical hashes before any new DDL.
    const migrations = await Promise.all(
      files.map(async (name) => {
        const content = await readFile(path.join(directory, name), "utf8");
        const checksum = createHash("sha256").update(content).digest("hex");
        const old = existing.find((row) => row.name === name);
        if (old && old.checksum !== checksum)
          throw new Error(`Migration checksum mismatch: ${name}`);
        return { name, content, checksum, alreadyApplied: !!old };
      }),
    );
    for (const item of migrations) {
      if (item.alreadyApplied) continue;
      let body = item.content;
      if (item.name === "0002_audit_contracts.sql") {
        const boundary = body.indexOf("\nBEGIN;");
        if (boundary < 0)
          throw new Error("0002 must separate enum prelude from transaction");
        const prelude = body
          .slice(0, boundary)
          .replace(/--[^\n]*/g, "")
          .trim();
        const statements = prelude
          .split(";")
          .map((s) => s.trim())
          .filter(Boolean);
        if (
          !statements.every((s) =>
            /^ALTER TYPE run_status ADD VALUE IF NOT EXISTS '[a-z_]+'$/.test(s),
          )
        )
          throw new Error("Unsupported autocommit prelude");
        for (const statement of statements) await client.unsafe(statement);
        body = body
          .slice(boundary)
          .replace(/^\s*BEGIN;/, "")
          .replace(/COMMIT;\s*$/, "");
      }
      await client.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`INSERT INTO schema_migrations(name,checksum) VALUES (${item.name},${item.checksum})`;
      });
      applied.push(item.name);
    }
    return { applied, total: files.length };
  } finally {
    try {
      await client`SELECT pg_advisory_unlock(638019813)`;
    } finally {
      await client.end({ timeout: 5 });
    }
  }
}
