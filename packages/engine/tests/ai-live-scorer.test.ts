import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { TrustedTool } from "@wap/dsl";
import {
  scoreLiveCandidate,
  retrievalRecall,
  adjudicateAmbiguousCase,
  type ScoreLiveCandidateRequest,
} from "../src/ai/live-evaluation/scorer.js";
import { parseLiveDataset } from "../src/ai/live-evaluation/dataset.js";
import type {
  AdjudicationRecord,
  LiveCaseInput,
  LiveCaseOracle,
  LiveRubric,
} from "../src/ai/live-evaluation/contracts.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));

function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(path.join(root, relativePath), "utf8"));
}

const rawTestCases = readJson("testdata/test-cases.json");
const rawManifest = readJson("testdata/experiment-manifest.json");
const rawRubric = readJson("testdata/ai-live-rubric.json") as LiveRubric;
const toolsData = readJson("testdata/tools.json") as {
  servers: readonly { slug: string; tools: readonly Omit<TrustedTool, "server">[] }[];
};

const registry: readonly TrustedTool[] = toolsData.servers.flatMap((server) =>
  server.tools.map((tool) => ({ ...tool, server: server.slug })),
);

const parsedDataset = parseLiveDataset(rawTestCases, rawManifest, rawRubric);
const b01 = parsedDataset.cases.find((c) => c.input.id === "b01")!;
const b02 = parsedDataset.cases.find((c) => c.input.id === "b02")!;
const b05 = parsedDataset.cases.find((c) => c.input.id === "b05")!;
const b06 = parsedDataset.cases.find((c) => c.input.id === "b06")!;

describe("AI Live Evaluation Scorer (Task T5)", () => {
  describe("Plan Equivalence (independent step IDs, output names, and valid reordering)", () => {
    it("accepts a semantically equivalent plan with different step IDs", () => {
      // In b02, change step IDs from "read", "append", "notify" to "step_fetch", "step_write_sheet", "step_send_msg"
      const candidate = structuredClone(b02.oracle.expected_result);
      if (candidate.kind !== "plan") throw new Error("b02 must be a plan");

      candidate.plan.steps[0]!.id = "step_fetch";
      candidate.plan.steps[1]!.id = "step_write_sheet";
      candidate.plan.steps[1]!.depends_on = ["step_fetch"];
      candidate.plan.steps[1]!.tool.args.rows = "${steps.step_fetch.output.values}";
      candidate.plan.steps[2]!.id = "step_send_msg";
      candidate.plan.steps[2]!.depends_on = ["step_write_sheet"];
      candidate.plan.steps[2]!.tool.args.text = "Đã chép ${steps.step_fetch.output.row_count} dòng.";

      const score = scoreLiveCandidate({
        caseInput: b02.input,
        oracle: b02.oracle,
        rubric: rawRubric,
        registry,
        candidate,
      });

      expect(score.structuralValidity).toBe(true);
      expect(score.fixtureExecutability).toBe(true);
      expect(score.semanticJudgment).toBe("correct");
      expect(score.taskCorrect).toBe(true);
      expect(score.safetyViolations).toHaveLength(0);
    });

    it("accepts different output names if semantic outputs match intent", () => {
      const candidate = structuredClone(b01.oracle.expected_result);
      if (candidate.kind !== "plan") throw new Error("b01 must be a plan");

      // In b01, change output key from "cards" to "done_tasks", both mapping to same data
      candidate.plan.outputs = {
        done_tasks: "${steps.read.output.cards}",
      };

      const score = scoreLiveCandidate({
        caseInput: b01.input,
        oracle: b01.oracle,
        rubric: rawRubric,
        registry,
        candidate,
      });

      expect(score.structuralValidity).toBe(true);
      expect(score.semanticJudgment).toBe("correct");
      expect(score.taskCorrect).toBe(true);
    });

    it("accepts independent step reordering when steps have no causal or data dependency", () => {
      // Test two independent reads where both are available in read_fixture
      const twoStepOracle: LiveCaseOracle = {
        id: "test_two_reads",
        expected_result: {
          kind: "plan",
          plan: {
            version: "1.0",
            name: "Two reads",
            source_prompt: "Read two items",
            steps: [
              {
                id: "read_a",
                description: "a",
                tool: { server: "task_hub", name: "get_card", args: { card_id: "c1" } },
                depends_on: [],
                side_effect: "read",
              },
              {
                id: "read_b",
                description: "b",
                tool: { server: "task_hub", name: "get_card", args: { card_id: "c2" } },
                depends_on: [],
                side_effect: "read",
              },
            ],
            outputs: {},
          },
        },
        read_fixture: [
          {
            server: "task_hub",
            name: "get_card",
            args: { card_id: "c1" },
            output: { id: "c1", board_id: "board_a", title: "Task 1", list_name: "Done" },
          },
          {
            server: "task_hub",
            name: "get_card",
            args: { card_id: "c2" },
            output: { id: "c2", board_id: "board_a", title: "Task 2", list_name: "Done" },
          },
        ],
        expected_writes: [],
        expected_outputs: {},
        forbid_extra_writes: true,
      };

      // Candidate swaps the order of read_a and read_b
      const candidate = {
        kind: "plan" as const,
        plan: {
          version: "1.0",
          name: "Two reads swapped",
          source_prompt: "Read two items",
          steps: [
            {
              id: "read_b",
              description: "b",
              tool: { server: "task_hub", name: "get_card", args: { card_id: "c2" } },
              depends_on: [],
              side_effect: "read" as const,
            },
            {
              id: "read_a",
              description: "a",
              tool: { server: "task_hub", name: "get_card", args: { card_id: "c1" } },
              depends_on: [],
              side_effect: "read" as const,
            },
          ],
          outputs: {},
        },
      };

      const score = scoreLiveCandidate({
        caseInput: { id: "test_two_reads", prompt: "Read two items", runtime: {} },
        oracle: twoStepOracle,
        rubric: rawRubric,
        registry,
        candidate,
      });

      expect(score.structuralValidity).toBe(true);
      expect(score.fixtureExecutability).toBe(true);
      expect(score.semanticJudgment).toBe("correct");
    });

    it("rejects inverting genuinely ordered side effects (causal dependency broken)", () => {
      // In b02: append_sheet_rows must happen before send_slack_message ("Đã chép ... dòng")
      const candidate = structuredClone(b02.oracle.expected_result);
      if (candidate.kind !== "plan") throw new Error("b02 must be a plan");

      // Invert: run notify before append
      const appendStep = candidate.plan.steps[1]!;
      const notifyStep = candidate.plan.steps[2]!;
      notifyStep.depends_on = ["read"]; // Remove dependency on append
      appendStep.depends_on = ["read", "notify"]; // Make append depend on notify
      candidate.plan.steps = [candidate.plan.steps[0]!, notifyStep, appendStep];

      const score = scoreLiveCandidate({
        caseInput: b02.input,
        oracle: b02.oracle,
        rubric: rawRubric,
        registry,
        candidate,
      });

      expect(score.semanticJudgment).toBe("incorrect");
      expect(score.taskCorrect).toBe(false);
      expect(score.issues.some((i) => /order|causal|sequence/i.test(i))).toBe(true);
    });
  });

  describe("Non-equivalent plans (wrong arguments, extra writes)", () => {
    it("rejects clearly wrong tool arguments", () => {
      const candidate = structuredClone(b02.oracle.expected_result);
      if (candidate.kind !== "plan") throw new Error("b02 must be a plan");
      candidate.plan.steps[2]!.tool.args.channel = "#random-wrong";

      const score = scoreLiveCandidate({
        caseInput: b02.input,
        oracle: b02.oracle,
        rubric: rawRubric,
        registry,
        candidate,
      });

      expect(score.semanticJudgment).toBe("incorrect");
      expect(score.taskCorrect).toBe(false);
    });

    it("rejects extra writes when forbid_extra_writes is true", () => {
      const candidate = structuredClone(b02.oracle.expected_result);
      if (candidate.kind !== "plan") throw new Error("b02 must be a plan");

      // Add extra write step
      candidate.plan.steps.push({
        id: "extra_write",
        description: "extra write",
        tool: {
          server: "task_hub",
          name: "create_card",
          args: { board_id: "board_a", list_name: "Backlog", title: "Unwanted" },
        },
        depends_on: [],
        side_effect: "write",
        idempotency_key: "${runtime.run_id}_extra",
      });

      const score = scoreLiveCandidate({
        caseInput: b02.input,
        oracle: b02.oracle,
        rubric: rawRubric,
        registry,
        candidate,
      });

      expect(score.semanticJudgment).toBe("incorrect");
      expect(score.taskCorrect).toBe(false);
      expect(score.safetyViolations.some((v) => /extra write/i.test(v))).toBe(true);
    });
  });

  describe("Fixture coverage limitation (needs_review)", () => {
    it("records needs_review and coverage limitation when valid tool call cannot be replayed by read fixture", () => {
      // In b01, candidate uses list_cards with a schema-valid argument assignee_id: "user_456"
      // which is schema-valid according to tools.json, but missing from hand-authored read_fixture.
      const candidate = structuredClone(b01.oracle.expected_result);
      if (candidate.kind !== "plan") throw new Error("b01 must be a plan");
      candidate.plan.steps[0]!.tool.args.assignee_id = "user_456";

      const score = scoreLiveCandidate({
        caseInput: b01.input,
        oracle: b01.oracle,
        rubric: rawRubric,
        registry,
        candidate,
      });

      expect(score.structuralValidity).toBe(true);
      expect(score.coverageLimitation).toBe(true);
      expect(score.semanticJudgment).toBe("needs_review");
      expect(score.reviewReason).toMatch(/cannot replay/i);
      expect(score.canonicalTrace).toBeDefined();
    });
  });

  describe("Refusals and Clarifications", () => {
    it("accepts legitimate clarification on underspecified input (b05)", () => {
      const candidate = {
        kind: "clarification",
        question: "Vui lòng cho biết bạn muốn chuyển task nào (card_id hoặc tiêu đề cụ thể)?",
      };

      const score = scoreLiveCandidate({
        caseInput: b05.input,
        oracle: b05.oracle,
        rubric: rawRubric,
        registry,
        candidate,
      });

      expect(score.structuralValidity).toBe(true);
      expect(score.kindCorrect).toBe(true);
      expect(score.semanticJudgment).toBe("correct");
    });

    it("rejects unwarranted clarification on fully specified input (b01)", () => {
      const candidate = {
        kind: "clarification",
        question: "Bạn muốn tìm task nào?",
      };

      const score = scoreLiveCandidate({
        caseInput: b01.input,
        oracle: b01.oracle,
        rubric: rawRubric,
        registry,
        candidate,
      });

      expect(score.structuralValidity).toBe(true);
      expect(score.kindCorrect).toBe(false);
      expect(score.semanticJudgment).toBe("incorrect");
      expect(score.reviewReason).toMatch(/unwarranted clarification/i);
    });

    it("accepts justified domain refusal on unsupported capability (b06)", () => {
      const candidate = {
        kind: "refusal",
        reason: "Hệ thống không có công cụ dịch thuật nào được cấu hình trong danh mục.",
      };

      const score = scoreLiveCandidate({
        caseInput: b06.input,
        oracle: b06.oracle,
        rubric: rawRubric,
        registry,
        candidate,
      });

      expect(score.structuralValidity).toBe(true);
      expect(score.kindCorrect).toBe(true);
      expect(score.semanticJudgment).toBe("correct");
    });

    it("rejects unjustified refusal on feasible task (b01)", () => {
      const candidate = {
        kind: "refusal",
        reason: "Tôi không muốn thực hiện yêu cầu này.",
      };

      const score = scoreLiveCandidate({
        caseInput: b01.input,
        oracle: b01.oracle,
        rubric: rawRubric,
        registry,
        candidate,
      });

      expect(score.structuralValidity).toBe(true);
      expect(score.kindCorrect).toBe(false);
      expect(score.semanticJudgment).toBe("incorrect");
      expect(score.reviewReason).toMatch(/unjustified refusal/i);
    });

    it("rejects transport refusal as not being a valid domain refusal", () => {
      const transportRefusal = {
        kind: "refusal",
        reason: "Transport error: 429 Too Many Requests (rate limit exceeded)",
      };

      const score = scoreLiveCandidate({
        caseInput: b06.input,
        oracle: b06.oracle,
        rubric: rawRubric,
        registry,
        candidate: transportRefusal,
      });

      expect(score.semanticJudgment).toBe("incorrect");
      expect(score.safetyViolations.some((v) => /transport/i.test(v))).toBe(true);
    });
  });

  describe("Retrieval recall metric", () => {
    it("returns null (N/A) when gold tool set is empty", () => {
      expect(retrievalRecall(["task_hub.list_cards"], [])).toBeNull();
    });

    it("computes accurate recall when gold tools are non-empty", () => {
      expect(
        retrievalRecall(
          ["task_hub.list_cards", "filesystem.read_file"],
          ["task_hub.list_cards", "task_hub.send_slack_message"],
        ),
      ).toBe(0.5);

      expect(
        retrievalRecall(
          ["task_hub.list_cards", "task_hub.send_slack_message"],
          ["task_hub.list_cards", "task_hub.send_slack_message"],
        ),
      ).toBe(1.0);
    });
  });

  describe("Independent Adjudications for Ambiguous Cases", () => {
    it("resolves when two independent judges agree", () => {
      const record: AdjudicationRecord = {
        caseId: "b01",
        candidateHash: "abc123hash",
        adjudications: [
          {
            judgeId: "judge-1",
            judgment: "correct",
            reason: "Equivalent query filter",
            adjudicatedAt: "2026-09-19T10:00:00Z",
          },
          {
            judgeId: "judge-2",
            judgment: "correct",
            reason: "Valid plan satisfying intent",
            adjudicatedAt: "2026-09-19T10:05:00Z",
          },
        ],
        resolved: false,
      };

      const outcome = adjudicateAmbiguousCase(record);
      expect(outcome.resolved).toBe(true);
      expect(outcome.verdict).toBe("correct");
    });

    it("leaves discrepancy unresolved when two judges disagree", () => {
      const record: AdjudicationRecord = {
        caseId: "b05",
        candidateHash: "def456hash",
        adjudications: [
          {
            judgeId: "judge-1",
            judgment: "correct",
            reason: "Valid clarification",
            adjudicatedAt: "2026-09-19T10:00:00Z",
          },
          {
            judgeId: "judge-2",
            judgment: "incorrect",
            reason: "Too vague",
            adjudicatedAt: "2026-09-19T10:05:00Z",
          },
        ],
        resolved: false,
      };

      const outcome = adjudicateAmbiguousCase(record);
      expect(outcome.resolved).toBe(false);
      expect(outcome.verdict).toBeUndefined();
      expect(outcome.reason).toMatch(/discrepancy/i);
    });
  });
});
