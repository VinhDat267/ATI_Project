import type { Database } from "@wap/db";
import type { Gateway } from "./gateway.js";
import { Store } from "./store.js";
import { EngineError } from "./snapshot.js";
import { prepare } from "./prepare.js";
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
  preview(id: string) {
    return this.store.preview(id);
  }
  trace(id: string) {
    return this.store.trace(id);
  }
  events(id: string, sinceSeq = 0) {
    return this.store.events(id, sinceSeq);
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
