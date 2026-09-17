import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WorkflowPlanSchema, type WorkflowPlan, type PlannerResult } from "@wap/dsl";
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

afterAll(async () => {
  await gateway?.close();
  await fixture?.close();
});

describe("AI-03 Local Replan Integration Tests", () => {
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
            args: { board_id: "board_a", since: "2026-09-30", until: "2026-09-01" },
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
            args: { board_id: "board_a", since: "2026-09-01", until: "2026-09-30" },
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
    const [runRow] = await fixture.db.client`SELECT workflow_id FROM runs WHERE id=${run.run_id}`;
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
          tool: { server: "task_hub", name: "list_cards", args: { board_id: "board_a" } },
          side_effect: "read",
          on_error: "fail",
          retry: { max_attempts: 1, backoff: "exponential", initial_delay_ms: 0 },
        },
        {
          id: "write_card",
          description: "Create card with invalid list",
          tool: {
            server: "task_hub",
            name: "create_card",
            args: { board_id: "board_a", list_name: "Nonexistent_List", title: "Valid Title" },
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
            args: { board_id: "board_a", list_name: "Doing", title: "Valid Title" },
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
    const replannedRun = await engine.execute(preparedRun.run_id, { replanPort });
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
            args: { board_id: "board_a", list_name: "Doing", title: "Card One Unique" },
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
            args: { board_id: "board_a", list_name: "Nonexistent_List", title: "Card Two" },
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
            args: { board_id: "board_a", list_name: "Doing", title: "Card Two Fixed" },
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
            args: { board_id: "board_a", since: "2026-10-01", until: "2026-09-01" },
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

    const finished = await engine.prepareAccepted(accepted.run_id, initialPlanner);
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
            args: { board_id: "board_a", list_name: "Doing", title: "Card Title" },
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
            args: { board_id: "board_a", since: "2026-10-01", until: "2026-09-01" },
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
                  args: { board_id: "board_a", since: "2026-09-01", until: "2026-10-01" },
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

    const result = await engine.prepareAccepted(accepted.run_id, initialPlanner);
    expect(result.status).toBe("cancelled");
  });
});
