import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  EngineError,
  ToolSchema,
  canonicalJson,
  hash,
} from "./snapshot.js";
import type {
  CallContext,
  GatewayResult,
  LocalGatewayConfig,
  ServerConnection,
} from "./gateway-types.js";

export async function openTaskHubConnection(
  config: LocalGatewayConfig,
): Promise<ServerConnection> {
  const root = path.resolve(config.root),
    userId = z.uuid().parse(config.userId);
  const address = new URL(config.databaseUrl);
  if (!["127.0.0.1", "localhost"].includes(address.hostname))
    throw new EngineError(
      "CONFIG",
      "This launcher only supports a loopback PostgreSQL database",
    );
  const serverPath = path.join(root, "apps/mcp-task-hub/dist/server.js");
  const policy = {
    read_sheet_range: "read",
    append_sheet_rows: "write",
    send_slack_message: "write",
    list_cards: "read",
    get_card: "read",
    list_members: "read",
    create_card: "write",
    move_card: "write",
  } as const;
  const artifact = () => {
    const files = ["package-lock.json", "testdata/tools.json"];
    for (const directory of [
      "apps/mcp-task-hub/dist",
      "packages/db/dist",
      "packages/dsl/dist",
      "packages/engine/dist",
    ]) {
      for (const file of readdirSync(path.join(root, directory), {
        recursive: true,
      }))
        if (typeof file === "string" && file.endsWith(".js"))
          files.push(path.join(directory, file));
    }
    return hash({
      command: process.execPath,
      args: [serverPath],
      files: files.sort().map((p) => [
        p,
        createHash("sha256")
          .update(readFileSync(path.join(root, p)))
          .digest("hex"),
      ]),
    });
  };
  const artifactHash = artifact();
  const catalog = JSON.parse(
    readFileSync(path.join(root, "testdata/tools.json"), "utf8"),
  );
  const listed =
    catalog.servers.find((s: { slug: string }) => s.slug === "task_hub")
      ?.tools ?? [];
  const tools = Object.entries(policy).map(([name, sideEffect]) => {
    const item = listed.find((t: { name: string }) => t.name === name);
    if (
      !item ||
      item.sideEffect !== sideEffect ||
      item.policyVersion !== "b-local-1" ||
      item.evidence !== "IMPLEMENTED_LIVE_DISCOVERY_CHECKED"
    )
      throw new EngineError(
        "REGISTRY_CHANGED",
        "Reviewed local tool policy is missing or inconsistent",
      );
    return ToolSchema.parse({
      server: "task_hub",
      name,
      sideEffect,
      policyVersion: item.policyVersion,
      inputSchema: item.inputSchema,
      outputSchema: item.outputSchema,
      artifactHash,
    });
  });
  const client = new Client({ name: "ati-local-engine", version: "0.1.0" });
  try {
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [serverPath],
        cwd: root,
        env: { G1_DATABASE_URL: config.databaseUrl, G1_USER_ID: userId },
        stderr: "pipe",
      }),
    );
    const discovered = await client.listTools();
    if (
      discovered.tools.length !== tools.length ||
      client.getServerVersion()?.name !== "ati-task-hub-local" ||
      client.getServerVersion()?.version !== "0.1.0"
    )
      throw new EngineError(
        "REGISTRY_CHANGED",
        "Unexpected MCP server identity/catalog",
      );
    for (const tool of tools) {
      const actual = discovered.tools.find((t) => t.name === tool.name);
      if (
        !actual ||
        canonicalJson(actual.inputSchema) !== canonicalJson(tool.inputSchema) ||
        canonicalJson(actual.outputSchema) !== canonicalJson(tool.outputSchema)
      )
        throw new EngineError(
          "REGISTRY_CHANGED",
          "Live MCP schemas differ from reviewed catalog",
        );
    }
    const assertCurrent = async () => {
      if (artifact() !== artifactHash)
        throw new EngineError(
          "REGISTRY_CHANGED",
          "Tool artifact or reviewed catalog changed; prepare a new run",
        );
    };
    return {
      server: "task_hub" as const,
      userId,
      get tools() {
        return structuredClone(tools);
      },
      assertCurrent,
      async call(
        name: string,
        args: Record<string, unknown>,
        authorization: Record<string, string> | undefined,
        timeoutMs: number,
        context?: CallContext,
      ): Promise<GatewayResult> {
        const meta = {
          ...(authorization ? { "ati/authorization": authorization } : {}),
          ...(context
            ? { "ati/runtime": { time_zone: context.timeZone } }
            : {}),
        };
        return CallToolResultSchema.parse(
          await client.callTool(
            {
              name,
              arguments: args,
              ...(Object.keys(meta).length > 0 ? { _meta: meta } : {}),
            },
            undefined,
            { timeout: timeoutMs },
          ),
        );
      },
      close: () => client.close(),
    } satisfies ServerConnection;
  } catch (error) {
    await client.close();
    throw error;
  }
}
