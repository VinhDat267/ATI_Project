import type { Database } from "@wap/db";
import type { Gateway } from "./gateway.js";
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
