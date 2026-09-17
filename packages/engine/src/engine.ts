import type { Database } from "@wap/db";
import { ServerCatalogSchema } from "@wap/dsl";
import type { Gateway, GatewayServerInspection } from "./gateway.js";
import { Store } from "./store.js";
import { EngineError } from "./snapshot.js";
import { prepare, prepareAccepted } from "./prepare.js";
import { accept } from "./accept.js";
import type { PlannerPort } from "./planner-port.js";
import { decide } from "./approval.js";
import { execute } from "./execute.js";
import {
  cancel,
  recoverOrphans,
  reconcile,
  settleDispatchFailure,
} from "./recovery.js";
import { safeProject } from "./redaction.js";

const reviewedServers = [
  { slug: "task_hub" as const, policyVersion: "b-local-1" },
  { slug: "filesystem" as const, policyVersion: "b-local-fs-1" },
];

export type ServerCatalogOptions = {
  connect?: boolean;
  observedAt?: Date | string;
};

function defaultInspections(status: "disconnected" | "error") {
  return reviewedServers.map(({ slug, policyVersion }) => ({
    server: slug,
    status,
    policyVersion,
    tools: [],
  }));
}

export class WorkflowEngine {
  private readonly store: Store;
  constructor(
    db: Database,
    private readonly gateway: Gateway | undefined,
    userId: string,
    options: { secrets?: readonly string[] } = {},
  ) {
    if (gateway && gateway.userId !== userId)
      throw new EngineError(
        "CONFIG",
        "Gateway principal must match controller principal",
      );
    this.store = new Store(db, userId, options.secrets);
  }
  private executionGateway() {
    if (!this.gateway)
      throw new EngineError(
        "CONFIG",
        "This action requires the reviewed MCP gateway",
      );
    return this.gateway;
  }
  accept(request: unknown) {
    return accept(this.store, request);
  }
  async prepareAccepted(id: string, planner: PlannerPort) {
    await this.store.run(this.store.db.client, id);
    const gateway = this.executionGateway();
    await gateway.ensureConnected?.();
    return prepareAccepted(this.store, gateway, id, planner);
  }
  prepare(
    plan: unknown,
    options: { inputs?: unknown; timeZone?: string } = {},
  ) {
    return prepare(this.store, this.executionGateway(), plan, options);
  }
  async decide(id: string, decision: unknown) {
    await this.store.run(this.store.db.client, id);
    const gateway = this.executionGateway();
    await gateway.ensureConnected?.();
    return decide(this.store, gateway, id, decision);
  }
  async execute(id: string) {
    await this.store.run(this.store.db.client, id);
    const gateway = this.executionGateway();
    await gateway.ensureConnected?.();
    return execute(this.store, gateway, id);
  }
  detail(id: string) {
    return this.store.detail(id);
  }
  list() {
    return this.store.list();
  }
  safeProjection<T>(value: T): T {
    return safeProject(value, this.store.secrets);
  }
  async serverSummaries() {
    const defaults = [
      { slug: "task_hub" as const, policyVersion: "b-local-1" },
      { slug: "filesystem" as const, policyVersion: "b-local-fs-1" },
    ];
    const tools = this.gateway?.tools ?? [];
    const configured = new Set(tools.map((tool) => tool.server));
    let current = true;
    if (tools.length && this.gateway) {
      try {
        await this.gateway.assertCurrent();
      } catch {
        current = false;
      }
    }
    return defaults.map(({ slug, policyVersion }) => {
      const versions = [
        ...new Set(
          tools
            .filter((tool) => tool.server === slug)
            .map((tool) => tool.policyVersion),
        ),
      ];
      return {
        slug,
        status: configured.has(slug)
          ? current
            ? ("connected" as const)
            : ("error" as const)
          : ("disconnected" as const),
        policy_version:
          versions.length === 1
            ? versions[0]!
            : versions.length === 0
              ? policyVersion
              : null,
      };
    });
  }
  async serverCatalog(options: ServerCatalogOptions = {}) {
    const observedAt = new Date(options.observedAt ?? Date.now()).toISOString();
    let inspections: readonly GatewayServerInspection[] | undefined;
    if (!this.gateway) {
      inspections = defaultInspections("disconnected");
    } else {
      // A catalog read never launches a gateway. An explicit connect request
      // may use a dedicated catalog check that opens reviewed presets
      // independently; that result must never become the execution gateway.
      // Older gateways retain the ensure-then-inspect fallback.
      if (options.connect) {
        if (this.gateway.catalogCheck) {
          try {
            inspections = await this.gateway.catalogCheck();
          } catch {
            inspections = defaultInspections("error");
          }
        } else {
          try {
            await this.gateway.ensureConnected?.();
          } catch {
            inspections = defaultInspections("error");
          }
        }
      }
      if (!inspections && this.gateway.inspectServers) {
        try {
          inspections = await this.gateway.inspectServers();
        } catch {
          inspections = defaultInspections(
            options.connect ? "error" : "disconnected",
          );
        }
      }
      if (!inspections) {
        let tools: readonly GatewayServerInspection["tools"][number][];
        try {
          tools = this.gateway.tools;
        } catch {
          tools = [];
          inspections = defaultInspections(
            options.connect ? "error" : "disconnected",
          );
        }
        if (!inspections) {
          // Old gateway fakes do not expose per-server inspection. Preserve a
          // safe aggregate fallback while leaving unconfigured servers
          // disconnected even if another configured server has drifted.
          let current = true;
          if (tools.length) {
            try {
              await this.gateway.assertCurrent();
            } catch {
              current = false;
            }
          }
          inspections = reviewedServers.map(({ slug, policyVersion }) => {
            const owned = tools.filter((tool) => tool.server === slug);
            const versions = [
              ...new Set(owned.map((tool) => tool.policyVersion)),
            ];
            return {
              server: slug,
              status: owned.length
                ? current
                  ? ("connected" as const)
                  : ("error" as const)
                : ("disconnected" as const),
              policyVersion:
                versions.length === 1
                  ? versions[0]!
                  : versions.length === 0
                    ? policyVersion
                    : null,
              tools: current ? owned : [],
            };
          });
        }
      }
    }
    const byServer = new Map(
      inspections.map((inspection) => [inspection.server, inspection]),
    );
    return structuredClone(
      ServerCatalogSchema.parse(
        reviewedServers.map(({ slug, policyVersion }) => {
          const inspection = byServer.get(slug);
          const validConnected =
            inspection?.status === "connected" &&
            inspection.policyVersion === policyVersion &&
            inspection.policyVersion !== null &&
            inspection.tools.length > 0 &&
            inspection.tools.every(
              (tool) =>
                tool.server === slug &&
                tool.policyVersion === inspection.policyVersion,
            );
          const tools = validConnected
            ? inspection!.tools.map((tool) => ({
                server: tool.server,
                name: tool.name,
                side_effect: tool.sideEffect,
                policy_version: tool.policyVersion,
                artifact_hash: tool.artifactHash,
                input_schema: structuredClone(tool.inputSchema),
                output_schema: structuredClone(tool.outputSchema),
              }))
            : [];
          return {
            slug,
            status: inspection
              ? inspection.status === "connected"
                ? validConnected
                  ? "connected"
                  : "unreviewed"
                : inspection.status
              : "disconnected",
            policy_version:
              inspection?.status === "connected" && !validConnected
                ? null
                : inspection
                  ? inspection.policyVersion
                  : policyVersion,
            observed_at: observedAt,
            tools,
          };
        }),
      ),
    );
  }
  preview(id: string) {
    return this.store.preview(id);
  }
  trace(id: string) {
    return this.store.trace(id);
  }
  tracePage(id: string, cursor?: { snapshotId: string; offset: number }) {
    return this.store.tracePage(id, cursor);
  }
  expireApprovals() {
    return this.store.expireApprovals();
  }
  cleanupExpiredTraceSnapshots(limit = 100) {
    return this.store.cleanupExpiredTraceSnapshots(limit);
  }
  events(id: string, sinceSeq = 0, limit = 100) {
    return this.store.events(id, sinceSeq, limit);
  }
  cancel(id: string, options: { strictTerminal?: boolean } = {}) {
    return cancel(this.store, id, options);
  }
  recoverOrphans() {
    return recoverOrphans(this.store);
  }
  settleDispatchFailure(id: string, job: "prepare" | "execute") {
    return settleDispatchFailure(this.store, id, job);
  }
  reconcile(id: string) {
    return reconcile(this.store, id);
  }
}
