import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import {
  BeforeDispatchError,
  EngineError,
  ToolSchema,
  canonicalJson,
  hash,
  type EngineTool,
} from "./snapshot.js";
import {
  inspectFilesystemPath,
  readBoundedUtf8,
  validateWriteText,
} from "./filesystem-paths.js";
import {
  captureFilesystemArtifactDeep,
  verifyFilesystemArtifact,
  type DeepArtifactRecord,
} from "./launch-policy.js";
import { FilesystemAlreadyDispatchedError } from "./filesystem-authorization.js";
import type {
  CallContext,
  FilesystemLaunch,
  FilesystemWriteHooks,
  FilesystemWriteRequest,
  GatewayResult,
  LocalGatewayConfig,
  ServerConnection,
} from "./gateway-types.js";

const ReadArguments = z.object({ path: z.string() }).strict();
const WriteArguments = z
  .object({ path: z.string(), content: z.string() })
  .strict();
const RawReadContent = z.object({ content: z.string() }).strict();
const RawTool = z.object({
  name: z.string(),
  inputSchema: z.record(z.string(), z.unknown()),
  outputSchema: z.record(z.string(), z.unknown()),
}).passthrough();

type ReviewedFilesystem = {
  package: "@modelcontextprotocol/server-filesystem";
  version: "2026.8.31";
  integrity: string;
  entry: "dist/index.js";
  serverIdentity: { name: "secure-filesystem-server"; version: "0.2.0" };
  policyVersion: "b-local-fs-1";
  rootStrategy: "project-runtime-principal";
  enabledTools: ["read_file", "write_file"];
  maxBytes: 65536;
  artifact: DeepArtifactRecord;
  rawDiscovery: { count: number; names: string[] };
  rawTools: Record<string, { inputSchema: Record<string, unknown>; outputSchema: Record<string, unknown> }>;
  publicTools: {
    read_file: { inputSchema: Record<string, unknown>; outputSchema: Record<string, unknown> };
    write_file: { inputSchema: Record<string, unknown>; outputSchema: Record<string, unknown> };
  };
};

function loadReviewed(policyFile: string): ReviewedFilesystem {
  try {
    const value = JSON.parse(readFileSync(policyFile, "utf8"));
    if (
      value?.package !== "@modelcontextprotocol/server-filesystem" ||
      value?.version !== "2026.8.31" ||
      value?.entry !== "dist/index.js" ||
      value?.serverIdentity?.name !== "secure-filesystem-server" ||
      value?.serverIdentity?.version !== "0.2.0" ||
      value?.policyVersion !== "b-local-fs-1" ||
      value?.rootStrategy !== "project-runtime-principal" ||
      JSON.stringify(value?.enabledTools) !== JSON.stringify(["read_file", "write_file"]) ||
      value?.maxBytes !== 65536
    )
      throw new Error("FILESYSTEM_POLICY_INVALID");
    return value as ReviewedFilesystem;
  } catch (error) {
    throw new EngineError(
      "CONFIG",
      error instanceof Error ? error.message : "Invalid filesystem review",
    );
  }
}

export function normalizeFilesystemReadResult(
  raw: GatewayResult,
  expectedText: string,
): GatewayResult {
  if (raw.isError) return { isError: true, content: raw.content };
  const body = RawReadContent.parse(raw.structuredContent);
  const firstContent = raw.content?.[0] as
    | { type?: unknown; text?: unknown }
    | undefined;
  if (
    !Array.isArray(raw.content) ||
    raw.content.length !== 1 ||
    firstContent?.type !== "text" ||
    firstContent.text !== body.content ||
    body.content !== expectedText
  )
    throw new Error("Read output differs from reviewed UTF-8 content");
  validateWriteText(body.content);
  return { structuredContent: { text: body.content } };
}

function assertRootIdentity(
  checked: Awaited<ReturnType<typeof inspectFilesystemPath>>,
  rootId: string,
  rootStat: { dev: number; ino: number },
) {
  if (
    checked.rootId !== rootId ||
    checked.rootStat.dev !== rootStat.dev ||
    checked.rootStat.ino !== rootStat.ino
  )
    throw new Error("FILESYSTEM_ROOT_CHANGED");
}

export async function normalizeFilesystemWriteResult(
  raw: GatewayResult,
  expectedAck: string,
): Promise<GatewayResult> {
  if (raw.isError) return { isError: true, content: raw.content };
  const body = RawReadContent.parse(raw.structuredContent);
  const firstContent = raw.content?.[0] as
    | { type?: unknown; text?: unknown }
    | undefined;
  if (
    !Array.isArray(raw.content) ||
    raw.content.length !== 1 ||
    firstContent?.type !== "text" ||
    firstContent.text !== body.content ||
    body.content !== expectedAck
  )
    throw new Error("Filesystem acknowledgement invalid after dispatch");
  return { structuredContent: { acknowledged: true } };
}

export async function openFilesystemConnection(
  config: LocalGatewayConfig,
  launch: FilesystemLaunch,
  hooks?: FilesystemWriteHooks,
): Promise<ServerConnection> {
  if (launch.presetId !== "filesystem-local-v1" || !path.isAbsolute(launch.allowedRoot))
    throw new EngineError("CONFIG", "Filesystem launch preset or root is invalid");
  const policyFile = launch.policyFile ?? path.join(config.root, "config", "filesystem-reviewed.json");
  const review = loadReviewed(policyFile);
  const policyHash = hash(JSON.parse(readFileSync(policyFile, "utf8")));
  const artifact = verifyFilesystemArtifact(config.root, review.artifact);
  const entryPath = path.resolve(
    config.root,
    "node_modules/@modelcontextprotocol/server-filesystem",
    review.entry,
  );
  if (artifact.entryPath.replace(/\\/g, "/") !== entryPath.replace(/\\/g, "/"))
    throw new EngineError("REGISTRY_CHANGED", "Filesystem entry path changed");

  let rootProbe: Awaited<ReturnType<typeof inspectFilesystemPath>>;
  try {
    rootProbe = await inspectFilesystemPath(
      launch.allowedRoot,
      "notes.txt",
      "read",
      config.userId,
    );
  } catch (error) {
    throw new EngineError(
      "CONFIG",
      error instanceof Error ? error.message : "Filesystem root is invalid",
    );
  }

  const client = new Client(
    { name: "ati-filesystem-adapter", version: "0.1.0" },
    { capabilities: {} },
  );
  try {
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [entryPath, launch.allowedRoot],
        cwd: config.root,
        env: { NODE_ENV: "production" },
        stderr: "pipe",
      }),
    );
    const serverVersion = client.getServerVersion();
    if (
      serverVersion?.name !== review.serverIdentity.name ||
      serverVersion?.version !== review.serverIdentity.version
    )
      throw new EngineError("REGISTRY_CHANGED", "Unexpected filesystem server identity");

    const discovered: Record<string, { inputSchema: Record<string, unknown>; outputSchema: Record<string, unknown> }> = {};
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined);
      for (const raw of page.tools) {
        const parsed = RawTool.parse(raw);
        if (discovered[parsed.name])
          throw new EngineError("REGISTRY_CHANGED", `Duplicate filesystem tool: ${parsed.name}`);
        discovered[parsed.name] = {
          inputSchema: parsed.inputSchema,
          outputSchema: parsed.outputSchema,
        };
      }
      cursor = page.nextCursor;
      if (cursor) {
        if (seenCursors.has(cursor))
          throw new EngineError("REGISTRY_CHANGED", "Filesystem tools/list cursor loop");
        seenCursors.add(cursor);
      }
    } while (cursor);
    if (Object.keys(discovered).length !== review.rawDiscovery.count ||
        Object.keys(discovered).sort().join("\n") !== review.rawDiscovery.names.slice().sort().join("\n"))
      throw new EngineError("REGISTRY_CHANGED", "Filesystem raw discovery changed");
    for (const name of ["read_text_file", "write_file"])
      if (
        !discovered[name] ||
        canonicalJson(discovered[name]) !== canonicalJson(review.rawTools[name])
      )
        throw new EngineError("REGISTRY_CHANGED", `Filesystem raw schema changed: ${name}`);

    const artifactHash = hash({
      preset: launch.presetId,
      root: launch.allowedRoot,
      artifact,
      policyHash,
    });
    const readTool: EngineTool = ToolSchema.parse({
      server: "filesystem",
      name: "read_file",
      sideEffect: "read",
      policyVersion: review.policyVersion,
      inputSchema: review.publicTools.read_file.inputSchema,
      outputSchema: review.publicTools.read_file.outputSchema,
      artifactHash,
    });
    const writeTool: EngineTool = ToolSchema.parse({
      server: "filesystem",
      name: "write_file",
      sideEffect: "write",
      policyVersion: review.policyVersion,
      inputSchema: review.publicTools.write_file.inputSchema,
      outputSchema: review.publicTools.write_file.outputSchema,
      artifactHash,
    });
    const assertCurrent = async () => {
      const latestPolicyHash = hash(JSON.parse(readFileSync(policyFile, "utf8")));
      if (latestPolicyHash !== policyHash)
        throw new EngineError("REGISTRY_CHANGED", "Filesystem review policy changed");
      verifyFilesystemArtifact(config.root, review.artifact);
    };
    return {
      server: "filesystem",
      userId: config.userId,
      tools: [readTool, writeTool],
      assertCurrent,
      async call(
        name: string,
        args: Record<string, unknown>,
        authorization: Record<string, string> | undefined,
        timeoutMs: number,
        context?: CallContext,
      ): Promise<GatewayResult> {
        const isRead = name === "read_file";
        const isWrite = name === "write_file";
        if (!isRead && !isWrite)
          throw new BeforeDispatchError("Filesystem tool is not public in the reviewed gateway");
        try {
          await context?.worker?.assertActive();
        } catch (error) {
          throw new BeforeDispatchError(error instanceof Error ? error.message : "Worker is not active");
        }
        const pathOnly = z.object({ path: z.string() }).safeParse(args);
        if (!pathOnly.success)
          throw new BeforeDispatchError("Filesystem arguments do not match reviewed schema");
        let content: string | undefined;
        if (isWrite) {
          const parsedWrite = WriteArguments.safeParse(args);
          if (!parsedWrite.success)
            throw new BeforeDispatchError("Filesystem write arguments do not match reviewed schema");
          content = parsedWrite.data.content;
          validateWriteText(content);
        } else {
          const parsedRead = ReadArguments.safeParse(args);
          if (!parsedRead.success)
            throw new BeforeDispatchError("Filesystem read arguments do not match reviewed schema");
        }
        const deadline = performance.now() + timeoutMs;
        let checked: Awaited<ReturnType<typeof inspectFilesystemPath>>;
        try {
          checked = await inspectFilesystemPath(
            launch.allowedRoot,
            pathOnly.data.path,
            isWrite ? "write" : "read",
            config.userId,
          );
          assertRootIdentity(checked, rootProbe.rootId, rootProbe.rootStat);
        } catch (error) {
          throw new BeforeDispatchError(error instanceof Error ? error.message : "Filesystem path rejected");
        }
        if (isWrite) {
          if (!hooks || !context?.worker || !authorization)
            throw new BeforeDispatchError("Filesystem write requires the approved dispatch context");
          const request: FilesystemWriteRequest = {
            tool: writeTool,
            args: { path: pathOnly.data.path, content: content! },
            authorization: authorization as FilesystemWriteRequest["authorization"],
            checkedPath: checked,
            worker: context.worker,
          };
          try {
            await hooks.reserve(request);
          } catch (error) {
            if (error instanceof FilesystemAlreadyDispatchedError) throw error;
            throw error;
          }
          let latest: Awaited<ReturnType<typeof inspectFilesystemPath>>;
          try {
            latest = await inspectFilesystemPath(
              launch.allowedRoot,
              pathOnly.data.path,
              "write",
              config.userId,
            );
            assertRootIdentity(latest, rootProbe.rootId, rootProbe.rootStat);
          } catch (error) {
            throw new BeforeDispatchError(error instanceof Error ? error.message : "Filesystem path changed before dispatch");
          }
          await hooks.recheck({ ...request, checkedPath: latest });
          const remainingMs = Math.ceil(deadline - performance.now());
          if (remainingMs <= 0)
            throw new BeforeDispatchError("Filesystem write deadline expired before dispatch");
          const raw = await client.callTool(
            {
              name: "write_file",
              arguments: { path: latest.absolute, content: content! },
            },
            undefined,
            { timeout: remainingMs },
          );
          const expectedAck = `Successfully wrote to ${latest.absolute}`;
          const normalized = await normalizeFilesystemWriteResult(
            CallToolResultSchema.parse(raw),
            expectedAck,
          );
          if (normalized.isError)
            throw new Error("Filesystem acknowledgement reported an error after dispatch");
          const readBack = await inspectFilesystemPath(
            launch.allowedRoot,
            pathOnly.data.path,
            "read",
            config.userId,
          );
          assertRootIdentity(readBack, rootProbe.rootId, rootProbe.rootStat);
          const written = await readBoundedUtf8(readBack.absolute);
          if (written !== content)
            throw new Error("Write read-back differs after dispatch");
          return { structuredContent: { path: pathOnly.data.path } };
        }
        const remainingMs = Math.ceil(deadline - performance.now());
        if (remainingMs <= 0) throw new BeforeDispatchError("Filesystem read deadline expired before dispatch");
        const raw = await client.callTool(
          { name: "read_text_file", arguments: { path: checked.absolute } },
          undefined,
          { timeout: remainingMs },
        );
        return normalizeFilesystemReadResult(
          CallToolResultSchema.parse(raw),
          checked.expectedReadText!,
        );
      },
      close: () => client.close(),
    };
  } catch (error) {
    await client.close();
    throw error;
  }
}
