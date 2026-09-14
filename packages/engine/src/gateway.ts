import { z } from "zod";
import { BeforeDispatchError, EngineError } from "./snapshot.js";
import { openTaskHubConnection } from "./gateway-task-hub.js";
import { openFilesystemConnection } from "./gateway-filesystem.js";
import { openDatabase } from "@wap/db";
import { Store } from "./store.js";
import {
  reserveFilesystemDispatch,
  recheckFilesystemDispatch,
} from "./filesystem-authorization.js";
import type {
  Gateway,
  GatewayResult,
  CallContext,
  ToolTarget,
  ServerConnection,
  LocalGatewayConfig,
  FilesystemWriteRequest,
} from "./gateway-types.js";

export type {
  Gateway,
  GatewayResult,
  CallContext,
  ToolTarget,
  ServerConnection,
  LocalGatewayConfig,
  FilesystemLaunch,
  FilesystemWriteHooks,
  FilesystemWriteRequest,
  FilesystemDispatchContext,
} from "./gateway-types.js";

const targetKey = (target: ToolTarget) => `${target.server}\u0000${target.name}`;

/** Compose reviewed server connections behind an exact server-qualified target. */
export function composeGateway(
  userId: string,
  connections: readonly ServerConnection[],
): Gateway {
  const parsedUserId = z.uuid().parse(userId);
  const byServer = new Map(
    connections.map((connection) => [connection.server, connection]),
  );
  if (byServer.size !== connections.length)
    throw new EngineError("REGISTRY_CHANGED", "Duplicate gateway server");
  for (const connection of connections)
    if (connection.userId !== parsedUserId)
      throw new EngineError(
        "CONFIG",
        "Gateway connection principal must match controller principal",
      );

  const toolMap = new Map<string, ServerConnection["tools"][number]>();
  for (const connection of connections)
    for (const tool of connection.tools) {
      if (tool.server !== connection.server)
        throw new EngineError(
          "REGISTRY_CHANGED",
          "Tool server does not match its gateway connection",
        );
      const key = targetKey(tool);
      if (toolMap.has(key))
        throw new EngineError(
          "REGISTRY_CHANGED",
          "Duplicate gateway tool identity",
        );
      toolMap.set(key, tool);
    }

  return {
    userId: parsedUserId,
    get tools() {
      return structuredClone([...toolMap.values()]);
    },
    async assertCurrent() {
      const results = await Promise.allSettled(
        connections.map((connection) => connection.assertCurrent()),
      );
      const failures = results
        .filter(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected",
        )
        .map((result) => result.reason);
      if (failures.length)
        throw new AggregateError(failures, "Gateway registry changed");
    },
    async call(
      target: ToolTarget,
      args: Record<string, unknown>,
      authorization: Record<string, string> | undefined,
      timeoutMs: number,
      context?: CallContext,
    ): Promise<GatewayResult> {
      const connection = byServer.get(target.server);
      if (!connection || !toolMap.has(targetKey(target)))
        throw new BeforeDispatchError(
          `Tool is not in the reviewed gateway: ${target.server}.${target.name}`,
        );
      try {
        await connection.assertCurrent();
      } catch (error) {
        throw new BeforeDispatchError(
          error instanceof Error ? error.message : "Gateway validation failed",
        );
      }
      return connection.call(target.name, args, authorization, timeoutMs, context);
    },
    async close() {
      const results = await Promise.allSettled(
        connections.map((connection) => connection.close()),
      );
      const failures = results
        .filter(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected",
        )
        .map((result) => result.reason);
      if (failures.length)
        throw new AggregateError(failures, "Gateway close failed");
    },
  };
}

export async function openLocalGateway(
  config: LocalGatewayConfig,
): Promise<Gateway> {
  const opened: ServerConnection[] = [];
  let guardDb: ReturnType<typeof openDatabase> | undefined;
  let guardStore: Store | undefined;
  let composite: Gateway | undefined;
  try {
    opened.push(await openTaskHubConnection(config));
    if (config.filesystem) {
      guardDb = openDatabase(config.databaseUrl);
      guardStore = new Store(guardDb, config.userId);
      const hooks = {
        reserve: (request: FilesystemWriteRequest) => {
          if (!composite || !guardStore)
            throw new BeforeDispatchError("Filesystem gateway is not fully initialized");
          return reserveFilesystemDispatch({
            ...request,
            store: guardStore,
            gateway: composite,
          });
        },
        recheck: (request: FilesystemWriteRequest) => {
          if (!composite || !guardStore)
            throw new BeforeDispatchError("Filesystem gateway is not fully initialized");
          return recheckFilesystemDispatch({
            ...request,
            store: guardStore,
            gateway: composite,
          });
        },
      };
      opened.push(await openFilesystemConnection(config, config.filesystem, hooks));
    }
    composite = composeGateway(config.userId, opened);
    if (!guardDb) return composite;
    const base = composite;
    return {
      userId: base.userId,
      get tools() {
        return base.tools;
      },
      assertCurrent: () => base.assertCurrent(),
      call: (...args) => base.call(...args),
      async close() {
        try {
          await base.close();
        } finally {
          await guardDb!.close();
        }
      },
    };
  } catch (error) {
    await Promise.allSettled(opened.map((connection) => connection.close()));
    await guardDb?.close();
    throw error;
  }
}
