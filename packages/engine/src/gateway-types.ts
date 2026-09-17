import type { CheckedFilesystemPath } from "./filesystem-paths.js";
import type { EngineTool } from "./snapshot.js";

export type ToolTarget = {
  server: "task_hub" | "filesystem";
  name: string;
};

export type GatewayServerStatus =
  "connected" | "disconnected" | "error" | "unreviewed";

export type GatewayServerInspection = {
  server: ToolTarget["server"];
  status: GatewayServerStatus;
  policyVersion: string | null;
  tools: readonly EngineTool[];
};

export interface CallContext {
  timeZone: string;
  worker?: { id: string; assertActive: () => Promise<void> };
}

export interface GatewayResult {
  isError?: boolean;
  content?: unknown[];
  structuredContent?: unknown;
}

export interface Gateway {
  readonly userId: string;
  readonly tools: readonly EngineTool[];
  ensureConnected?(): Promise<void>;
  inspectServers?(): Promise<readonly GatewayServerInspection[]>;
  /**
   * Optional active catalog check. Implementations may inspect reviewed
   * presets independently without installing a partial gateway for workflow
   * execution. The engine still applies the strict catalog projection.
   */
  catalogCheck?(): Promise<readonly GatewayServerInspection[]>;
  isConnected?(): boolean;
  assertCurrent(): Promise<void>;
  call(
    target: ToolTarget,
    args: Record<string, unknown>,
    authorization: Record<string, string> | undefined,
    timeoutMs: number,
    context?: CallContext,
  ): Promise<GatewayResult>;
  close(): Promise<void>;
}

export interface ServerConnection {
  readonly server: ToolTarget["server"];
  readonly userId: string;
  readonly tools: readonly EngineTool[];
  isConnected?(): boolean;
  assertCurrent(): Promise<void>;
  call(
    name: string,
    args: Record<string, unknown>,
    authorization: Record<string, string> | undefined,
    timeoutMs: number,
    context?: CallContext,
  ): Promise<GatewayResult>;
  close(): Promise<void>;
}

export interface FilesystemLaunch {
  presetId: "filesystem-local-v1";
  allowedRoot: string;
  policyFile?: string;
  artifactFile?: string;
}

export interface LocalGatewayConfig {
  root: string;
  databaseUrl: string;
  userId: string;
  filesystem?: FilesystemLaunch;
}

export interface FilesystemWriteRequest {
  tool: EngineTool;
  args: { path: string; content: string };
  authorization: {
    approval_id: string;
    operation_id: string;
    snapshot_hash: string;
  };
  checkedPath: CheckedFilesystemPath;
  worker: { id: string; assertActive: () => Promise<void> };
}

export interface FilesystemDispatchContext extends FilesystemWriteRequest {
  store: import("./store.js").Store;
  gateway: Gateway;
}

export interface FilesystemWriteHooks {
  reserve(request: FilesystemWriteRequest): Promise<void>;
  recheck(request: FilesystemWriteRequest): Promise<void>;
}
