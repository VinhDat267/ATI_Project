import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  WorkflowPlanSchema,
  type WorkflowPlan,
  type PlannerResult,
} from "@wap/dsl";
import {
  WorkflowEngine,
  openLocalGateway,
  type Gateway,
  type LocalReplanPort,
  type LocalReplanInput,
} from "../src/index.js";
import { makeFilesystemFixture } from "./filesystem-fixture.js";

let fixture: Awaited<ReturnType<typeof makeFilesystemFixture>>;
let gateway: Gateway;

const decisionFor = (run: {
  approval: { id: string; snapshot_hash: string };
  workflow_version_id: string;
}) => ({
  approval_id: run.approval.id,
  workflow_version_id: run.workflow_version_id,
  snapshot_hash: run.approval.snapshot_hash,
  decision: "approved",
});

beforeAll(async () => {
  fixture = await makeFilesystemFixture();
  gateway = await openLocalGateway(fixture.gatewayConfig);
});


async function waitForLockRelease(
  db: { client: any },
  objid: number,
  timeoutMs = 5000,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const remaining = await db.client`
      SELECT pid
      FROM pg_locks
      WHERE locktype='advisory' AND objid=${objid}
        AND database=(SELECT oid FROM pg_database WHERE datname=current_database())
    `;
    if (remaining.length === 0) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`Timeout waiting for advisory lock ${objid} to be released`);
}

afterAll(async () => {
  await gateway?.close();
  await fixture?.close();
});

describe("AI-03 Local Replan Integration Tests", () => {

beforeEach(async () => {
  if (fixture?.db) {
    await fixture.db.client`
      UPDATE runs SET status = 'cancelled'
      WHERE status NOT IN ('succeeded', 'failed', 'rejected', 'cancelled', 'expired', 'refused')
    `;
  }
});

  it("[AI-03-01] safe read failure triggers local replan, creates new version, and completes", async () => {
    // Initial draft: list_cards with invalid date range (since > until)
    const badReadDraft = {
      version: "1.0" as const,
      name: "Bad read range",
      source_prompt: "List cards",
      steps: [
        {
          id: "read_1",
          description: "Read cards inverted",
          tool: {
            server: "task_hub",
            name: "list_cards",
            args: {
              board_id: "board_a",
              since: "2026-09-30",
              until: "2026-09-01",
            },
          },
          side_effect: "read" as const,
          on_error: "replan" as const,
        },
      ],
      outputs: { count: "${steps.read_1.output.count}" },
    };

    const fixedReadDraft = {
      ...badReadDraft,
      steps: [
        {
          ...badReadDraft.steps[0]!,
          tool: {
            server: "task_hub",
            name: "list_cards",
            args: {
              board_id: "board_a",
              since: "2026-09-01",
              until: "2026-09-30",
            },
          },
        },
      ],
    };

    let replanCalled = false;
    const replanPort: LocalReplanPort = {
      async replan(input: LocalReplanInput): Promise<PlannerResult> {
        replanCalled = true;
        expect(input.failedStepId).toBe("read_1");
        expect(input.replanCount).toBe(1);
        expect(input.errorClass).toBe("bad_args");
        return {
          kind: "plan",
          plan: fixedReadDraft,
        };
      },
    };

    const engine = new WorkflowEngine(fixture.db, gateway, fixture.userId, {
      replan: replanPort,
    });

    const accepted = await engine.accept({
      source_prompt: "List cards",
      inputs: {},
    });

    const initialPlanner = {
      mode: "ai" as const,
      produce: async () => ({ kind: "plan" as const, plan: badReadDraft }),
    };

    const run = await engine.prepareAccepted(accepted.run_id, initialPlanner);
    expect(replanCalled).toBe(true);
    expect(run.status).toBe("succeeded");

    // Verify events: replan.started and replan.applied
    const events = (await fixture.db.client`
      SELECT type, payload FROM run_events WHERE run_id=${run.run_id} ORDER BY seq
    `) as { type: string; payload: any }[];

    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain("replan.started");
    expect(eventTypes).toContain("replan.applied");

    const replanStarted = events.find((e) => e.type === "replan.started");
    expect(replanStarted?.payload).toMatchObject({
      failed_step_id: "read_1",
      error_class: "bad_args",
      scope: "local",
      replan_count: 1,
    });

    const replanApplied = events.find((e) => e.type === "replan.applied");
    expect(replanApplied?.payload).toMatchObject({
      version_no: 2,
      changed_step_ids: ["read_1"],
    });

    // Verify workflow_versions in DB has origin = 'replan'
    const [runRow] = await fixture.db
      .client`SELECT workflow_id FROM runs WHERE id=${run.run_id}`;
    const versions = await fixture.db.client`
      SELECT version_no, origin FROM workflow_versions WHERE workflow_id=${runRow!.workflow_id} ORDER BY version_no
    `;
    expect(versions).toHaveLength(2);
    expect(versions[0]?.origin).toBe("initial");
    expect(versions[1]?.origin).toBe("replan");
  });

  it("[AI-03-02] safe write failure triggers local replan, supersedes old approval, and requires new approval", async () => {
    // Initial plan: list_cards (succeeds) + create_card with nonexistent list (fails at runtime with NOT_FOUND -> bad_tool)
    const writePlanWithBadArgs = WorkflowPlanSchema.parse({
      version: "1.0",
      name: "Write with bad args",
      source_prompt: "Create card in nonexistent list",
      inputs: {},
      steps: [
        {
          id: "read_cards",
          description: "Read cards first",
          tool: {
            server: "task_hub",
            name: "list_cards",
            args: { board_id: "board_a" },
          },
          side_effect: "read",
          on_error: "fail",
          retry: {
            max_attempts: 1,
            backoff: "exponential",
            initial_delay_ms: 0,
          },
        },
        {
          id: "write_card",
          description: "Create card with invalid list",
          tool: {
            server: "task_hub",
            name: "create_card",
            args: {
              board_id: "board_a",
              list_name: "Nonexistent_List",
              title: "Valid Title",
            },
          },
          side_effect: "write",
          idempotency_key: "create-invalid-due-date",
          on_error: "replan",
          depends_on: ["read_cards"],
        },
      ],
      outputs: { card_id: "${steps.write_card.output.id}" },
    });

    const fixedWritePlan: WorkflowPlan = {
      ...writePlanWithBadArgs,
      steps: [
        writePlanWithBadArgs.steps[0]!,
        {
          ...writePlanWithBadArgs.steps[1]!,
          tool: {
            server: "task_hub",
            name: "create_card",
            args: {
              board_id: "board_a",
              list_name: "Doing",
              title: "Valid Title",
            },
          },
        },
      ],
    };

    let replanInvoked = false;
    const replanPort: LocalReplanPort = {
      async replan(input: LocalReplanInput): Promise<PlannerResult> {
        replanInvoked = true;
        expect(input.failedStepId).toBe("write_card");
        expect(input.errorClass).toBe("bad_tool");
        expect(input.completedOutputs).toHaveProperty("read_cards");
        return {
          kind: "plan",
          plan: fixedWritePlan,
        };
      },
    };

    const engine = new WorkflowEngine(fixture.db, gateway, fixture.userId);

    const preparedRun = await engine.prepare(writePlanWithBadArgs);
    expect(preparedRun.status).toBe("awaiting_approval");
    const firstApprovalId = preparedRun.approval!.id;
    const firstVersionId = preparedRun.workflow_version_id!;

    // Approve version 1
    await engine.decide(preparedRun.run_id, decisionFor(preparedRun as any));

    // Execute with replanPort
    const replannedRun = await engine.execute(preparedRun.run_id, {
      replanPort,
    });
    expect(replanInvoked).toBe(true);

    // After replan of write, the run MUST transition to 'awaiting_approval' with a new approval
    expect(replannedRun.status).toBe("awaiting_approval");
    expect(replannedRun.workflow_version_id).not.toBe(firstVersionId);
    expect(replannedRun.approval?.id).not.toBe(firstApprovalId);

    // Verify first approval was superseded in database
    const [oldApproval] = await fixture.db.client`
      SELECT decision FROM approvals WHERE id=${firstApprovalId}
    `;
    expect(oldApproval?.decision).toBe("superseded");

    // Check new approval preview has the fixed list_name
    const newApproval = replannedRun.approval!;
    expect(newApproval.decision).toBe("pending");
    expect(newApproval.actions).toHaveLength(1);
    expect(newApproval.actions[0]?.resolved_args).toMatchObject({
      board_id: "board_a",
      list_name: "Doing",
      title: "Valid Title",
    });

    // Approve the new version
    await engine.decide(replannedRun.run_id, decisionFor(replannedRun as any));

    // Execute the approved new version
    const finalRun = await engine.execute(replannedRun.run_id);
    expect(finalRun.status).toBe("succeeded");
  });

  it("[AI-03-03] preserves already-successful write operations and never re-executes them", async () => {
    // Plan with 2 write steps:
    // Step 1: create_card (valid title "Card One")
    // Step 2: create_card (invalid list_name "Nonexistent_List", on_error: "replan")
    const twoWritePlan = WorkflowPlanSchema.parse({
      version: "1.0",
      name: "Two writes sequence",
      source_prompt: "Create two cards",
      inputs: {},
      steps: [
        {
          id: "write_1",
          description: "Create first card",
          tool: {
            server: "task_hub",
            name: "create_card",
            args: {
              board_id: "board_a",
              list_name: "Doing",
              title: "Card One Unique",
            },
          },
          side_effect: "write",
          idempotency_key: "two-write-first-card",
          on_error: "fail",
        },
        {
          id: "write_2",
          description: "Create second card with bad list",
          tool: {
            server: "task_hub",
            name: "create_card",
            args: {
              board_id: "board_a",
              list_name: "Nonexistent_List",
              title: "Card Two",
            },
          },
          side_effect: "write",
          idempotency_key: "two-write-second-card",
          on_error: "replan",
          depends_on: ["write_1"],
        },
      ],
      outputs: {},
    });

    const fixedPlan: WorkflowPlan = {
      ...twoWritePlan,
      steps: [
        twoWritePlan.steps[0]!,
        {
          ...twoWritePlan.steps[1]!,
          tool: {
            server: "task_hub",
            name: "create_card",
            args: {
              board_id: "board_a",
              list_name: "Doing",
              title: "Card Two Fixed",
            },
          },
        },
      ],
    };

    const replanPort: LocalReplanPort = {
      async replan(input: LocalReplanInput): Promise<PlannerResult> {
        expect(input.completedOutputs).toHaveProperty("write_1");
        return {
          kind: "plan",
          plan: fixedPlan,
        };
      },
    };

    const engine = new WorkflowEngine(fixture.db, gateway, fixture.userId);
    const run = await engine.prepare(twoWritePlan);
    expect(run.approval?.actions).toHaveLength(2);

    // Approve version 1
    await engine.decide(run.run_id, decisionFor(run as any));

    // Execute: write_1 succeeds, write_2 fails with BAD_ARGS -> triggers replan
    const replanned = await engine.execute(run.run_id, { replanPort });
    expect(replanned.status).toBe("awaiting_approval");

    // Crucial check: in the new preview, ONLY write_2 is present! write_1 was already committed!
    expect(replanned.approval?.actions).toHaveLength(1);
    expect(replanned.approval?.actions[0]?.step_id).toBe("write_2");

    // Approve version 2
    await engine.decide(replanned.run_id, decisionFor(replanned as any));

    // Execute version 2
    const finished = await engine.execute(replanned.run_id);
    expect(finished.status).toBe("succeeded");

    // Verify in DB that write_1 was executed exactly once
    const attempts = await fixture.db.client`
      SELECT s.step_id, a.attempt_no
      FROM step_attempts a
      JOIN step_states s ON s.id=a.step_state_id
      WHERE s.run_id=${run.run_id} AND s.step_id='write_1'
    `;
    expect(attempts).toHaveLength(1);
  });

  it("[AI-03-07] rejects an untrusted replan that adds a duplicate of a successful write", async () => {
    const initialPlan = WorkflowPlanSchema.parse({
      version: "1.0",
      name: "Reject duplicate successful write",
      source_prompt: "Create two cards safely",
      inputs: {},
      steps: [
        {
          id: "write_succeeded",
          description: "Create the first card",
          tool: {
            server: "task_hub",
            name: "create_card",
            args: {
              board_id: "board_a",
              list_name: "Doing",
              title: "AI-03 guarded first card",
            },
          },
          side_effect: "write",
          idempotency_key: "ai-03-guarded-first-card",
          on_error: "fail",
        },
        {
          id: "write_failed",
          description: "Create the second card with a bad list",
          tool: {
            server: "task_hub",
            name: "create_card",
            args: {
              board_id: "board_a",
              list_name: "Missing_AI_03_List",
              title: "AI-03 guarded second card",
            },
          },
          side_effect: "write",
          idempotency_key: "ai-03-guarded-second-card",
          on_error: "replan",
          depends_on: ["write_succeeded"],
        },
      ],
      outputs: {},
    });
    const maliciousPlan: WorkflowPlan = {
      ...initialPlan,
      steps: [
        initialPlan.steps[0]!,
        {
          ...initialPlan.steps[1]!,
          tool: {
            server: "task_hub",
            name: "create_card",
            args: {
              board_id: "board_a",
              list_name: "Doing",
              title: "AI-03 guarded second card",
            },
          },
        },
        {
          ...initialPlan.steps[0]!,
          id: "write_succeeded_again",
          description: "Replay the successful first write",
          idempotency_key: "ai-03-duplicate-successful-write",
          depends_on: ["write_failed"],
        },
      ],
    };
    const replanPort: LocalReplanPort = {
      async replan(): Promise<PlannerResult> {
        return { kind: "plan", plan: maliciousPlan };
      },
    };
    const engine = new WorkflowEngine(fixture.db, gateway, fixture.userId);
    const prepared = await engine.prepare(initialPlan);
    await engine.decide(prepared.run_id, decisionFor(prepared as any));

    const result = await engine.execute(prepared.run_id, { replanPort });

    expect(result.status).toBe("failed");
    const [run] = await fixture.db.client`
      SELECT workflow_id FROM runs WHERE id=${prepared.run_id}
    `;
    const versions = await fixture.db.client`
      SELECT version_no FROM workflow_versions
      WHERE workflow_id=${run!.workflow_id}
      ORDER BY version_no
    `;
    expect(versions).toHaveLength(1);
  });

  it("[AI-03-08] rejects an untrusted replan that changes a nonfailed pending step", async () => {
    const initialPlan = WorkflowPlanSchema.parse({
      version: "1.0",
      name: "Reject pending step mutation",
      source_prompt: "Read then create one card",
      inputs: {},
      steps: [
        {
          id: "read_failed",
          description: "Read cards with an invalid date range",
          tool: {
            server: "task_hub",
            name: "list_cards",
            args: {
              board_id: "board_a",
              since: "2026-10-01",
              until: "2026-09-01",
            },
          },
          side_effect: "read",
          on_error: "replan",
        },
        {
          id: "write_pending",
          description: "Create the planned card",
          tool: {
            server: "task_hub",
            name: "create_card",
            args: {
              board_id: "board_a",
              list_name: "Doing",
              title: "AI-03 original pending card",
            },
          },
          side_effect: "write",
          idempotency_key: "ai-03-original-pending-card",
          on_error: "fail",
          depends_on: ["read_failed"],
        },
      ],
      outputs: {},
    });
    const maliciousPlan: WorkflowPlan = {
      ...initialPlan,
      steps: [
        {
          ...initialPlan.steps[0]!,
          tool: {
            server: "task_hub",
            name: "list_cards",
            args: {
              board_id: "board_a",
              since: "2026-09-01",
              until: "2026-10-01",
            },
          },
        },
        {
          ...initialPlan.steps[1]!,
          tool: {
            server: "task_hub",
            name: "create_card",
            args: {
              board_id: "board_a",
              list_name: "Doing",
              title: "AI-03 altered pending card",
            },
          },
        },
      ],
    };
    const replanPort: LocalReplanPort = {
      async replan(): Promise<PlannerResult> {
        return { kind: "plan", plan: maliciousPlan };
      },
    };
    const engine = new WorkflowEngine(fixture.db, gateway, fixture.userId, {
      replan: replanPort,
    });
    const accepted = await engine.accept({
      source_prompt: initialPlan.source_prompt,
      inputs: {},
    });

    const result = await engine.prepareAccepted(accepted.run_id, {
      mode: "ai",
      async produce() {
        return { kind: "plan", plan: initialPlan };
      },
    });

    expect(result.status).toBe("failed");
    const [run] = await fixture.db.client`
      SELECT workflow_id FROM runs WHERE id=${accepted.run_id}
    `;
    const versions = await fixture.db.client`
      SELECT origin FROM workflow_versions
      WHERE workflow_id=${run!.workflow_id}
    `;
    expect(
      versions.filter((version) => version.origin === "replan"),
    ).toHaveLength(0);
  });

  it("[AI-03-09] rejects a replanned write payload containing a configured secret before preview persistence", async () => {
    const secret = `ai-03-replan-secret-${crypto.randomUUID()}`;
    const initialPlan = WorkflowPlanSchema.parse({
      version: "1.0",
      name: "Reject secret from replanned write",
      source_prompt: "Create a local card",
      inputs: {},
      steps: [
        {
          id: "write_failed",
          description: "Create a card with a bad list",
          tool: {
            server: "task_hub",
            name: "create_card",
            args: {
              board_id: "board_a",
              list_name: "Missing_AI_03_Secret_List",
              title: "Safe initial title",
            },
          },
          side_effect: "write",
          idempotency_key: "ai-03-replan-secret",
          on_error: "replan",
        },
      ],
      outputs: {},
    });
    const replannedSecretPlan: WorkflowPlan = {
      ...initialPlan,
      steps: [
        {
          ...initialPlan.steps[0]!,
          tool: {
            server: "task_hub",
            name: "create_card",
            args: {
              board_id: "board_a",
              list_name: "Doing",
              title: `Protected ${secret} payload`,
            },
          },
        },
      ],
    };
    const replanPort: LocalReplanPort = {
      async replan(): Promise<PlannerResult> {
        return { kind: "plan", plan: replannedSecretPlan };
      },
    };
    const engine = new WorkflowEngine(fixture.db, gateway, fixture.userId, {
      secrets: [secret],
    });
    const prepared = await engine.prepare(initialPlan);
    await engine.decide(prepared.run_id, decisionFor(prepared as any));

    const result = await engine.execute(prepared.run_id, { replanPort });

    expect(result.status).toBe("failed");
    const approvals = await fixture.db.client`
      SELECT preview::text AS preview
      FROM approvals
      WHERE run_id=${prepared.run_id}
      ORDER BY created_at
    `;
    const operations = await fixture.db.client`
      SELECT resolved_args::text AS resolved_args
      FROM tool_operations
      WHERE run_id=${prepared.run_id}
      ORDER BY created_at
    `;
    const versions = await fixture.db.client`
      SELECT plan::text AS plan
      FROM workflow_versions
      WHERE workflow_id=(SELECT workflow_id FROM runs WHERE id=${prepared.run_id})
      ORDER BY version_no
    `;
    const replanEvents = await fixture.db.client`
      SELECT payload::text AS payload
      FROM run_events
      WHERE run_id=${prepared.run_id} AND type='replan.applied'
      ORDER BY seq
    `;
    expect(approvals).toHaveLength(1);
    expect(operations).toHaveLength(1);
    expect(versions).toHaveLength(1);
    expect(replanEvents).toHaveLength(0);
    expect(JSON.stringify(approvals)).not.toContain(secret);
    expect(JSON.stringify(operations)).not.toContain(secret);
    expect(JSON.stringify(versions)).not.toContain(secret);
    expect(JSON.stringify(replanEvents)).not.toContain(secret);
  });

  it("[AI-03-10] rejects a replanned intent key resolved from a configured secret", async () => {
    const secret = `ai-03-replan-intent-${crypto.randomUUID()}`;
    const initialPlan = WorkflowPlanSchema.parse({
      version: "1.0",
      name: "Reject secret from replanned intent",
      source_prompt: "Create a local card with a safe initial key",
      inputs: {
        protected_intent: { type: "string", required: true },
      },
      steps: [
        {
          id: "write_failed",
          description: "Create a card with a bad list",
          tool: {
            server: "task_hub",
            name: "create_card",
            args: {
              board_id: "board_a",
              list_name: "Missing_AI_03_Intent_List",
              title: "Safe initial title",
            },
          },
          side_effect: "write",
          idempotency_key: "ai-03-safe-initial-intent",
          on_error: "replan",
        },
      ],
      outputs: {},
    });
    const replannedIntentPlan: WorkflowPlan = {
      ...initialPlan,
      steps: [
        {
          ...initialPlan.steps[0]!,
          tool: {
            server: "task_hub",
            name: "create_card",
            args: {
              board_id: "board_a",
              list_name: "Doing",
              title: "Safe replanned title",
            },
          },
          idempotency_key: "${inputs.protected_intent}",
        },
      ],
    };
    const replanPort: LocalReplanPort = {
      async replan(): Promise<PlannerResult> {
        return { kind: "plan", plan: replannedIntentPlan };
      },
    };
    const unguardedEngine = new WorkflowEngine(
      fixture.db,
      gateway,
      fixture.userId,
    );
    const prepared = await unguardedEngine.prepare(initialPlan, {
      inputs: { protected_intent: secret },
    });
    await unguardedEngine.decide(prepared.run_id, decisionFor(prepared as any));
    const guardedEngine = new WorkflowEngine(
      fixture.db,
      gateway,
      fixture.userId,
      {
        secrets: [secret],
      },
    );

    const result = await guardedEngine.execute(prepared.run_id, { replanPort });

    expect(result.status).toBe("failed");
    const operations = await fixture.db.client`
      SELECT intent_key
      FROM tool_operations
      WHERE run_id=${prepared.run_id}
      ORDER BY created_at
    `;
    expect(operations).toHaveLength(1);
    expect(JSON.stringify(operations)).not.toContain(secret);
  });

  it("[AI-03-04] enforces local replan limit (max 2 replans per run)", async () => {
    const alwaysBadDraft = {
      version: "1.0" as const,
      name: "Persistent bad args",
      source_prompt: "Bad prompt",
      steps: [
        {
          id: "bad_step",
          description: "Always bad range",
          tool: {
            server: "task_hub",
            name: "list_cards",
            args: {
              board_id: "board_a",
              since: "2026-10-01",
              until: "2026-09-01",
            },
          },
          side_effect: "read" as const,
          on_error: "replan" as const,
        },
      ],
      outputs: {},
    };

    let replanCount = 0;
    const replanPort: LocalReplanPort = {
      async replan(): Promise<PlannerResult> {
        replanCount++;
        return {
          kind: "plan",
          plan: alwaysBadDraft,
        };
      },
    };

    const engine = new WorkflowEngine(fixture.db, gateway, fixture.userId, {
      replan: replanPort,
    });

    const accepted = await engine.accept({
      source_prompt: "Bad prompt",
      inputs: {},
    });

    const initialPlanner = {
      mode: "ai" as const,
      produce: async () => ({ kind: "plan" as const, plan: alwaysBadDraft }),
    };

    const finished = await engine.prepareAccepted(
      accepted.run_id,
      initialPlanner,
    );
    // Failure 1 -> replan 1 -> failure 2 -> replan 2 -> failure 3 -> max replans reached -> failed
    expect(finished.status).toBe("failed");
    const [runRow] = await fixture.db.client`
      SELECT error_message FROM runs WHERE id=${accepted.run_id}
    `;
    expect(runRow?.error_message ?? "").toContain("Local replan limit reached");
    expect(replanCount).toBe(2);
  });

  it("[AI-03-05] strictly rejects replan when write certainty is unknown", async () => {
    const plan = WorkflowPlanSchema.parse({
      version: "1.0",
      name: "Unknown certainty run",
      source_prompt: "Test unknown",
      inputs: {},
      steps: [
        {
          id: "step_write",
          description: "Write step",
          tool: {
            server: "task_hub",
            name: "create_card",
            args: {
              board_id: "board_a",
              list_name: "Doing",
              title: "Card Title",
            },
          },
          side_effect: "write",
          idempotency_key: "unknown-certainty-key",
          on_error: "replan",
        },
      ],
      outputs: {},
    });

    let replanCalled = false;
    const replanPort: LocalReplanPort = {
      async replan(): Promise<PlannerResult> {
        replanCalled = true;
        return { kind: "plan", plan };
      },
    };

    const engine = new WorkflowEngine(fixture.db, gateway, fixture.userId, {
      replan: replanPort,
    });

    const run = await engine.prepare(plan);
    expect(run.status).toBe("awaiting_approval");

    // Invoke executeReplan directly with certainty: 'unknown'
    const { executeReplan } = await import("../src/replan.js");
    const result = await executeReplan({
      store: (engine as any).store,
      gateway,
      runId: run.run_id,
      failedStepId: "step_write",
      errorClass: "fatal",
      errorMessage: "Connection timed out with unknown certainty",
      replanPort,
      certainty: "unknown",
    });

    expect(result.status).toBe("reconciliation_required");
    expect(replanCalled).toBe(false);

    // Verify 0 replan events in DB
    const replanEvents = await fixture.db.client`
      SELECT id FROM run_events WHERE run_id=${run.run_id} AND type LIKE 'replan.%'
    `;
    expect(replanEvents).toHaveLength(0);
  });

  it("[AI-03-06] handles cancellation gracefully during replanning", async () => {
    const draft = {
      version: "1.0" as const,
      name: "Cancel during replan",
      source_prompt: "Cancel test",
      steps: [
        {
          id: "read_step",
          description: "Read step",
          tool: {
            server: "task_hub",
            name: "list_cards",
            args: {
              board_id: "board_a",
              since: "2026-10-01",
              until: "2026-09-01",
            },
          },
          side_effect: "read" as const,
          on_error: "replan" as const,
        },
      ],
      outputs: {},
    };

    const replanPort: LocalReplanPort = {
      async replan(input: LocalReplanInput): Promise<PlannerResult> {
        // While replan is in progress, mark cancel_requested_at on run
        await fixture.db.client`
          UPDATE runs SET cancel_requested_at=now() WHERE id=${input.runId}
        `;
        return {
          kind: "plan",
          plan: {
            ...draft,
            steps: [
              {
                ...draft.steps[0]!,
                tool: {
                  server: "task_hub",
                  name: "list_cards",
                  args: {
                    board_id: "board_a",
                    since: "2026-09-01",
                    until: "2026-10-01",
                  },
                },
              },
            ],
          },
        };
      },
    };

    const engine = new WorkflowEngine(fixture.db, gateway, fixture.userId, {
      replan: replanPort,
    });

    const accepted = await engine.accept({
      source_prompt: "Cancel test",
      inputs: {},
    });

    const initialPlanner = {
      mode: "ai" as const,
      produce: async () => ({ kind: "plan" as const, plan: draft }),
    };

    const result = await engine.prepareAccepted(
      accepted.run_id,
      initialPlanner,
    );
    expect(result.status).toBe("cancelled");
  });

  it("[AI-03-11] ignores a late refusal after the replan worker loses its advisory lease", async () => {
    const draft = {
      version: "1.0" as const,
      name: "Lease loss during replan",
      source_prompt: "Fence a late replan result",
      steps: [
        {
          id: "read_step",
          description: "Read with an invalid range",
          tool: {
            server: "task_hub",
            name: "list_cards",
            args: {
              board_id: "board_a",
              since: "2026-10-01",
              until: "2026-09-01",
            },
          },
          side_effect: "read" as const,
          on_error: "replan" as const,
        },
      ],
      outputs: {},
    };
    let signalEntered!: () => void;
    let releaseResult!: () => void;
    const entered = new Promise<void>((resolve) => {
      signalEntered = resolve;
    });
    const resultReleased = new Promise<void>((resolve) => {
      releaseResult = resolve;
    });
    const replanPort: LocalReplanPort = {
      async replan(): Promise<PlannerResult> {
        signalEntered();
        await resultReleased;
        return { kind: "refusal", reason: "Late model response" };
      },
    };
    const leaseGateway = await openLocalGateway(fixture.gatewayConfig);
    const engine = new WorkflowEngine(
      fixture.db,
      leaseGateway,
      fixture.userId,
      {
        replan: replanPort,
      },
    );
    const accepted = await engine.accept({
      source_prompt: draft.source_prompt,
      inputs: {},
    });
    const execution = engine.prepareAccepted(accepted.run_id, {
      mode: "ai",
      async produce() {
        return { kind: "plan", plan: draft };
      },
    });

    await entered;
    const leases = await fixture.db.client`
      SELECT pid
      FROM pg_locks
      WHERE locktype='advisory' AND objid=638019814
        AND database=(SELECT oid FROM pg_database WHERE datname=current_database())
    `;
    expect(leases).toHaveLength(1);
    const [termination] = await fixture.db.client`
      SELECT pg_terminate_backend(${leases[0]!.pid}) AS terminated
    `;
    expect(termination!.terminated).toBe(true);
    await waitForLockRelease(fixture.db, 638019814);

    releaseResult();
    const result = await execution;

    expect(result.status).toBe("replanning");
    const versions = await fixture.db.client`
      SELECT id FROM workflow_versions
      WHERE workflow_id=(SELECT workflow_id FROM runs WHERE id=${accepted.run_id})
    `;
    const events = await fixture.db.client`
      SELECT type FROM run_events WHERE run_id=${accepted.run_id} ORDER BY seq
    `;
    expect(versions).toHaveLength(1);
    expect(events.map((event) => event.type)).not.toContain("run.finished");
    await engine.recoverOrphans();
    await leaseGateway.close();
  });

  it("[AI-03-12] ignores a late replacement plan after the replan worker loses its advisory lease", async () => {
    const draft = {
      version: "1.0" as const,
      name: "Lease loss before replacement plan",
      source_prompt: "Fence a late replacement plan",
      steps: [
        {
          id: "read_step",
          description: "Read with an invalid range",
          tool: {
            server: "task_hub",
            name: "list_cards",
            args: {
              board_id: "board_a",
              since: "2026-10-01",
              until: "2026-09-01",
            },
          },
          side_effect: "read" as const,
          on_error: "replan" as const,
        },
      ],
      outputs: {},
    };
    const replacement = {
      ...draft,
      steps: [
        {
          ...draft.steps[0]!,
          tool: {
            server: "task_hub",
            name: "list_cards",
            args: {
              board_id: "board_a",
              since: "2026-09-01",
              until: "2026-10-01",
            },
          },
        },
      ],
    };
    let signalEntered!: () => void;
    let releaseResult!: () => void;
    const entered = new Promise<void>((resolve) => {
      signalEntered = resolve;
    });
    const resultReleased = new Promise<void>((resolve) => {
      releaseResult = resolve;
    });
    const replanPort: LocalReplanPort = {
      async replan(): Promise<PlannerResult> {
        signalEntered();
        await resultReleased;
        return { kind: "plan", plan: replacement };
      },
    };
    const leaseGateway = await openLocalGateway(fixture.gatewayConfig);
    const engine = new WorkflowEngine(
      fixture.db,
      leaseGateway,
      fixture.userId,
      {
        replan: replanPort,
      },
    );
    const accepted = await engine.accept({
      source_prompt: draft.source_prompt,
      inputs: {},
    });
    const execution = engine.prepareAccepted(accepted.run_id, {
      mode: "ai",
      async produce() {
        return { kind: "plan", plan: draft };
      },
    });

    await entered;
    const [lease] = await fixture.db.client`
      SELECT pid
      FROM pg_locks
      WHERE locktype='advisory' AND objid=638019814
        AND database=(SELECT oid FROM pg_database WHERE datname=current_database())
    `;
    const [termination] = await fixture.db.client`
      SELECT pg_terminate_backend(${lease!.pid}) AS terminated
    `;
    expect(termination!.terminated).toBe(true);
    await waitForLockRelease(fixture.db, 638019814);

    releaseResult();
    const result = await execution;

    expect(result.status).toBe("replanning");
    const versions = await fixture.db.client`
      SELECT id FROM workflow_versions
      WHERE workflow_id=(SELECT workflow_id FROM runs WHERE id=${accepted.run_id})
    `;
    const approvals = await fixture.db.client`
      SELECT id FROM approvals WHERE run_id=${accepted.run_id}
    `;
    expect(versions).toHaveLength(1);
    expect(approvals).toHaveLength(0);
    await engine.recoverOrphans();
    await leaseGateway.close();
  });

  it("[AI-03-13] rejects a replacement plan when the reviewed gateway drifts before version publication", async () => {
    const draft = {
      version: "1.0" as const,
      name: "Gateway drift during replan",
      source_prompt: "Reject drifted catalog",
      steps: [
        {
          id: "read_step",
          description: "Read with an invalid range",
          tool: {
            server: "task_hub",
            name: "list_cards",
            args: {
              board_id: "board_a",
              since: "2026-10-01",
              until: "2026-09-01",
            },
          },
          side_effect: "read" as const,
          on_error: "replan" as const,
        },
      ],
      outputs: {},
    };
    const replacement = {
      ...draft,
      steps: [
        {
          ...draft.steps[0]!,
          tool: {
            server: "task_hub",
            name: "list_cards",
            args: {
              board_id: "board_a",
              since: "2026-09-01",
              until: "2026-10-01",
            },
          },
        },
      ],
    };
    let drifted = false;
    const driftingGateway: Gateway = {
      ...gateway,
      async assertCurrent() {
        if (drifted) throw new Error("reviewed gateway drifted");
        await gateway.assertCurrent();
      },
    };
    const replanPort: LocalReplanPort = {
      async replan(): Promise<PlannerResult> {
        drifted = true;
        return { kind: "plan", plan: replacement };
      },
    };
    const engine = new WorkflowEngine(
      fixture.db,
      driftingGateway,
      fixture.userId,
      { replan: replanPort },
    );
    const accepted = await engine.accept({
      source_prompt: draft.source_prompt,
      inputs: {},
    });

    const result = await engine.prepareAccepted(accepted.run_id, {
      mode: "ai",
      async produce() {
        return { kind: "plan", plan: draft };
      },
    });

    expect(result.status).toBe("failed");
    const versions = await fixture.db.client`
      SELECT id FROM workflow_versions
      WHERE workflow_id=(SELECT workflow_id FROM runs WHERE id=${accepted.run_id})
    `;
    const approvals = await fixture.db.client`
      SELECT id FROM approvals WHERE run_id=${accepted.run_id}
    `;
    const appliedEvents = await fixture.db.client`
      SELECT id FROM run_events
      WHERE run_id=${accepted.run_id} AND type='replan.applied'
    `;
    expect(versions).toHaveLength(1);
    expect(approvals).toHaveLength(0);
    expect(appliedEvents).toHaveLength(0);
  });

  it("[AI-03-14] does not persist a late replan read outcome after its advisory lease is lost", async () => {
    const draft = {
      version: "1.0" as const,
      name: "Lease loss after replanned read",
      source_prompt: "Fence a late read result",
      steps: [
        {
          id: "read_step",
          description: "Read with an invalid range",
          tool: {
            server: "task_hub",
            name: "list_cards",
            args: {
              board_id: "board_a",
              since: "2026-10-01",
              until: "2026-09-01",
            },
          },
          side_effect: "read" as const,
          on_error: "replan" as const,
        },
      ],
      outputs: {},
    };
    const replacement = {
      ...draft,
      steps: [
        {
          ...draft.steps[0]!,
          tool: {
            server: "task_hub",
            name: "list_cards",
            args: { board_id: "board_a" },
          },
        },
      ],
    };
    const realGateway = await openLocalGateway(fixture.gatewayConfig);
    let readCalls = 0;
    let lostLease = false;
    const gatewayLosingLease: Gateway = {
      ...realGateway,
      async call(...args: Parameters<typeof realGateway.call>) {
        const response = await realGateway.call(...args);
        if (args[0].name === "list_cards" && ++readCalls === 2) {
          const [lease] = await fixture.db.client`
            SELECT pid
            FROM pg_locks
            WHERE locktype='advisory' AND objid=638019814
              AND database=(SELECT oid FROM pg_database WHERE datname=current_database())
          `;
          const [termination] = await fixture.db.client`
            SELECT pg_terminate_backend(${lease!.pid}) AS terminated
          `;
          expect(termination!.terminated).toBe(true);
          await waitForLockRelease(fixture.db, 638019814);
          lostLease = true;
        }
        return response;
      },
    };
    const replanPort: LocalReplanPort = {
      async replan(): Promise<PlannerResult> {
        return { kind: "plan", plan: replacement };
      },
    };
    const engine = new WorkflowEngine(
      fixture.db,
      gatewayLosingLease,
      fixture.userId,
      { replan: replanPort },
    );
    const accepted = await engine.accept({
      source_prompt: draft.source_prompt,
      inputs: {},
    });

    const result = await engine.prepareAccepted(accepted.run_id, {
      mode: "ai",
      async produce() {
        return { kind: "plan", plan: draft };
      },
    });

    expect(lostLease).toBe(true);
    expect(result.status).toBe("dry_running");
    const finishedEvents = await fixture.db.client`
      SELECT id FROM run_events
      WHERE run_id=${accepted.run_id} AND type='run.finished'
    `;
    const successfulReads = await fixture.db.client`
      SELECT id FROM run_events
      WHERE run_id=${accepted.run_id} AND type='step.succeeded'
    `;
    expect(finishedEvents).toHaveLength(0);
    expect(successfulReads).toHaveLength(0);
    await engine.recoverOrphans();
    await realGateway.close();
  });

  it("[AI-03-15] stops before preview publication when the gateway drifts after a replanned read", async () => {
    const draft = {
      version: "1.0" as const,
      name: "Gateway drift before replan preview",
      source_prompt: "Do not publish a drifted preview",
      steps: [
        {
          id: "read_step",
          description: "Read with an invalid range",
          tool: {
            server: "task_hub",
            name: "list_cards",
            args: {
              board_id: "board_a",
              since: "2026-10-01",
              until: "2026-09-01",
            },
          },
          side_effect: "read" as const,
          on_error: "replan" as const,
        },
      ],
      outputs: {},
    };
    const replacement = {
      ...draft,
      steps: [
        {
          ...draft.steps[0]!,
          tool: {
            server: "task_hub",
            name: "list_cards",
            args: { board_id: "board_a" },
          },
        },
      ],
    };
    let currentChecks = 0;
    const gatewayDriftingBeforePreview: Gateway = {
      ...gateway,
      async assertCurrent() {
        currentChecks++;
        if (currentChecks === 3)
          throw new Error("reviewed gateway drifted before preview");
        await gateway.assertCurrent();
      },
    };
    const replanPort: LocalReplanPort = {
      async replan(): Promise<PlannerResult> {
        return { kind: "plan", plan: replacement };
      },
    };
    const engine = new WorkflowEngine(
      fixture.db,
      gatewayDriftingBeforePreview,
      fixture.userId,
      { replan: replanPort },
    );
    const accepted = await engine.accept({
      source_prompt: draft.source_prompt,
      inputs: {},
    });

    const result = await engine.prepareAccepted(accepted.run_id, {
      mode: "ai",
      async produce() {
        return { kind: "plan", plan: draft };
      },
    });

    expect(result.status).toBe("failed");
    const versions = await fixture.db.client`
      SELECT id FROM workflow_versions
      WHERE workflow_id=(SELECT workflow_id FROM runs WHERE id=${accepted.run_id})
    `;
    const approvals = await fixture.db.client`
      SELECT id FROM approvals WHERE run_id=${accepted.run_id}
    `;
    const readyEvents = await fixture.db.client`
      SELECT id FROM run_events
      WHERE run_id=${accepted.run_id} AND type='dryrun.ready'
    `;
    expect(versions).toHaveLength(2);
    expect(approvals).toHaveLength(0);
    expect(readyEvents).toHaveLength(0);
  });

  it("[AI-03-16] ignores a replacement plan whose replan owner changed while the model was waiting", async () => {
    const draft = {
      version: "1.0" as const,
      name: "Owner change during replan",
      source_prompt: "Fence an old owner",
      steps: [
        {
          id: "read_step",
          description: "Read with an invalid range",
          tool: {
            server: "task_hub",
            name: "list_cards",
            args: {
              board_id: "board_a",
              since: "2026-10-01",
              until: "2026-09-01",
            },
          },
          side_effect: "read" as const,
          on_error: "replan" as const,
        },
      ],
      outputs: {},
    };
    const replacement = {
      ...draft,
      steps: [
        {
          ...draft.steps[0]!,
          tool: {
            server: "task_hub",
            name: "list_cards",
            args: { board_id: "board_a" },
          },
        },
      ],
    };
    const replanPort: LocalReplanPort = {
      async replan(input): Promise<PlannerResult> {
        await fixture.db.client`
          UPDATE runs SET claimed_by=${crypto.randomUUID()} WHERE id=${input.runId}
        `;
        return { kind: "plan", plan: replacement };
      },
    };
    const engine = new WorkflowEngine(fixture.db, gateway, fixture.userId, {
      replan: replanPort,
    });
    const accepted = await engine.accept({
      source_prompt: draft.source_prompt,
      inputs: {},
    });

    const result = await engine.prepareAccepted(accepted.run_id, {
      mode: "ai",
      async produce() {
        return { kind: "plan", plan: draft };
      },
    });

    expect(result.status).toBe("replanning");
    const versions = await fixture.db.client`
      SELECT id FROM workflow_versions
      WHERE workflow_id=(SELECT workflow_id FROM runs WHERE id=${accepted.run_id})
    `;
    expect(versions).toHaveLength(1);
    await engine.recoverOrphans();
  });

  it("[AI-03-17] returns the current run when the lease is lost before replan initialization", async () => {
    const draft = {
      version: "1.0" as const,
      name: "Lease loss before replan initialization",
      source_prompt: "Do not terminally settle a stale replan",
      steps: [
        {
          id: "read_step",
          description: "Read with an invalid range",
          tool: {
            server: "task_hub",
            name: "list_cards",
            args: {
              board_id: "board_a",
              since: "2026-10-01",
              until: "2026-09-01",
            },
          },
          side_effect: "read" as const,
          on_error: "replan" as const,
        },
      ],
      outputs: {},
    };
    const realGateway = await openLocalGateway(fixture.gatewayConfig);
    let lostLease = false;
    const gatewayLosingLease: Gateway = {
      ...realGateway,
      async call(...args: Parameters<typeof realGateway.call>) {
        const response = await realGateway.call(...args);
        if (args[0].name === "list_cards") {
          const [lease] = await fixture.db.client`
            SELECT pid
            FROM pg_locks
            WHERE locktype='advisory' AND objid=638019814
              AND database=(SELECT oid FROM pg_database WHERE datname=current_database())
          `;
          const [termination] = await fixture.db.client`
            SELECT pg_terminate_backend(${lease!.pid}) AS terminated
          `;
          expect(termination!.terminated).toBe(true);
          await waitForLockRelease(fixture.db, 638019814);
          lostLease = true;
        }
        return response;
      },
    };
    let replanCalled = false;
    const engine = new WorkflowEngine(
      fixture.db,
      gatewayLosingLease,
      fixture.userId,
      {
        replan: {
          async replan(): Promise<PlannerResult> {
            replanCalled = true;
            throw new Error("replan must not start after lease loss");
          },
        },
      },
    );
    const accepted = await engine.accept({
      source_prompt: draft.source_prompt,
      inputs: {},
    });

    const result = await engine.prepareAccepted(accepted.run_id, {
      mode: "ai",
      async produce() {
        return { kind: "plan", plan: draft };
      },
    });

    expect(lostLease).toBe(true);
    expect(replanCalled).toBe(false);
    expect(result.status).toBe("dry_running");
    const versions = await fixture.db.client`
      SELECT id FROM workflow_versions
      WHERE workflow_id=(SELECT workflow_id FROM runs WHERE id=${accepted.run_id})
    `;
    const startedEvents = await fixture.db.client`
      SELECT id FROM run_events
      WHERE run_id=${accepted.run_id} AND type='replan.started'
    `;
    const finishedEvents = await fixture.db.client`
      SELECT id FROM run_events
      WHERE run_id=${accepted.run_id} AND type='run.finished'
    `;
    expect(versions).toHaveLength(1);
    expect(startedEvents).toHaveLength(0);
    expect(finishedEvents).toHaveLength(0);
    await engine.recoverOrphans();
    await realGateway.close();
  });

  it("[AI-03-18] returns the current run when its owner changes before replan initialization", async () => {
    const draft = {
      version: "1.0" as const,
      name: "Owner change before replan initialization",
      source_prompt: "Do not terminally settle another owner's run",
      steps: [
        {
          id: "read_step",
          description: "Read with an invalid range",
          tool: {
            server: "task_hub",
            name: "list_cards",
            args: {
              board_id: "board_a",
              since: "2026-10-01",
              until: "2026-09-01",
            },
          },
          side_effect: "read" as const,
          on_error: "replan" as const,
        },
      ],
      outputs: {},
    };
    let ownerChanged = false;
    let runId: string | undefined;
    const gatewayChangingOwner: Gateway = {
      ...gateway,
      async call(...args: Parameters<typeof gateway.call>) {
        const response = await gateway.call(...args);
        if (args[0].name === "list_cards") {
          if (!runId) throw new Error("Run must be accepted before dispatch");
          await fixture.db.client`
            UPDATE runs SET claimed_by=${crypto.randomUUID()}
            WHERE id=${runId}
          `;
          ownerChanged = true;
        }
        return response;
      },
    };
    let replanCalled = false;
    const engine = new WorkflowEngine(
      fixture.db,
      gatewayChangingOwner,
      fixture.userId,
      {
        replan: {
          async replan(): Promise<PlannerResult> {
            replanCalled = true;
            throw new Error("replan must not start after owner change");
          },
        },
      },
    );
    const accepted = await engine.accept({
      source_prompt: draft.source_prompt,
      inputs: {},
    });
    runId = accepted.run_id;

    const result = await engine.prepareAccepted(accepted.run_id, {
      mode: "ai",
      async produce() {
        return { kind: "plan", plan: draft };
      },
    });

    expect(ownerChanged).toBe(true);
    expect(replanCalled).toBe(false);
    expect(result.status).toBe("dry_running");
    const versions = await fixture.db.client`
      SELECT id FROM workflow_versions
      WHERE workflow_id=(SELECT workflow_id FROM runs WHERE id=${accepted.run_id})
    `;
    const finishedEvents = await fixture.db.client`
      SELECT id FROM run_events
      WHERE run_id=${accepted.run_id} AND type='run.finished'
    `;
    expect(versions).toHaveLength(1);
    expect(finishedEvents).toHaveLength(0);
    await engine.recoverOrphans();
  });
});
