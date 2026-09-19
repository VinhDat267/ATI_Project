import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";
export const G1_DATABASE_URL =
  process.env.G1_DATABASE_URL ?? "postgresql://wap:wap@127.0.0.1:55532/wap_g1";
export function openDatabase(url: string) {
  const options = {
    max: 5,
    connect_timeout: 5,
    onnotice: () => {},
  };
  // Drizzle replaces JSON/date codecs on its postgres.js client. Native SQL
  // needs an independent lazy pool; never mix the two transaction handles.
  const client = postgres(url, options);
  const ormClient = postgres(url, options);
  return {
    client,
    db: drizzle(ormClient, { schema }),
    // Dedicated worker leases must not reuse a pooled connection after disconnect.
    createWorkerClient: (onDisconnect: () => void) =>
      postgres(url, {
        ...options,
        max: 1,
        idle_timeout: 0,
        max_lifetime: 0,
        onclose: onDisconnect,
      }),
    close: async () => {
      await Promise.all([
        client.end({ timeout: 5 }),
        ormClient.end({ timeout: 5 }),
      ]);
    },
  };
}
export type Database = ReturnType<typeof openDatabase>;
