import type { Database } from "@wap/db";
import type { Gateway } from "./gateway.js";
import { Store } from "./store.js";
import { EngineError } from "./snapshot.js";
import { prepare, prepareAccepted } from "./prepare.js";
import { accept } from "./accept.js";
import type { PlannerPort } from "./planner-port.js";
import { decide } from "./approval.js";
import { execute } from "./execute.js";
import { cancel, recoverOrphans, reconcile } from "./recovery.js";
export class WorkflowEngine {
  private readonly store: Store;
  constructor(
    db: Database,
    private readonly gateway: Gateway | undefined,
    userId: string,
  ) {
    if (gateway && gateway.userId !== userId)
      throw new EngineError(
        "CONFIG",
        "Gateway principal must match controller principal",
      );
    this.store = new Store(db, userId);
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
  prepareAccepted(id: string, planner: PlannerPort) {
    return prepareAccepted(this.store, this.executionGateway(), id, planner);
  }
  prepare(
    plan: unknown,
    options: { inputs?: unknown; timeZone?: string } = {},
  ) {
    return prepare(this.store, this.executionGateway(), plan, options);
  }
  decide(id: string, decision: unknown) {
    return decide(this.store, this.executionGateway(), id, decision);
  }
  execute(id: string) {
    return execute(this.store, this.executionGateway(), id);
  }
  detail(id: string) {
    return this.store.detail(id);
  }
  list() {
    return this.store.list();
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
  events(id: string, sinceSeq = 0, limit = 100) {
    return this.store.events(id, sinceSeq, limit);
  }
  cancel(id: string) {
    return cancel(this.store, id);
  }
  recoverOrphans() {
    return recoverOrphans(this.store);
  }
  reconcile(id: string) {
    return reconcile(this.store, id);
  }
}
